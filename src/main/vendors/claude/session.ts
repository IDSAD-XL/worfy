// The session part of the Claude driver (ADR-0094 item 2, worfy-multi-vendor ticket 14): Claude Code
// through the Agent SDK, or the fake agent under WORFY_AGENT=fake, behind worfy's SessionHandle.
//
// One handle is one query() of Claude Code — one process. Its prompt is an async queue the handle
// pushes the user's messages into; the query is not recreated between turns. The handle turns every
// SDK message into worfy's events (src/shared/vendors/claude/events.ts) and adds three of its own:
// `account` once accountInfo() answers (the Session is `starting` until then), `context` after each
// `result` and each compaction (getContextUsage), and the end of its events when Claude Code is gone.
// It keeps the catalog of slash commands from system/init and system/commands_changed, which the
// next handle of the same Session takes over (SessionStart.previous).
//
// Claude Code's canUseTool becomes worfy's neutral permission request (claudeCanUseTool): the options
// are Allow / Always allow / Deny, and the Session's gate (src/main/agent/permissions.ts) waits for the
// user's pick. An unattended Session (Autopilot) answers by the Auto-approval mode instead
// (unattendedCanUseTool, worfy-auto-approve ticket 04): at Off it refuses every call at once, and each
// refusal reaches its subscribers as a `refused_dialog` event; at Shadow and On it asks the approval
// policy, whose every decision is an `auto_approval` event; a request it parks in On waits for the owner
// on the Session's gate (worfy-auto-approve ticket 07, src/main/agent/auto-approve/park.ts).
//
// `null` — "Default" in the pickers — is the user's own model and effort from ~/.claude/settings.json
// (worfy-daily ticket 23; user-model.ts): setModel(null) on a live query calls setModel with that
// model (sonnet for a haiku, Claude Code's own default with none), setEffort(null) applyFlagSettings
// with that effort, and a new query with no model or effort named is asked for the user's. A Session
// runs on sonnet or a larger model (worfy-daily ticket 07): with no model named and a haiku as the
// user's, the query is started on sonnet.
//
// The app's part makes its query factory (query.ts) at its first start. Nothing in this driver imports
// the Session registry (src/main/agent/app-registry.ts), which is made over it: the registry wires
// what the fake agent needs from it itself (test/contract/vendor-imports.test.ts).
import { createParker, PARK_EXPIRED_HINT, type Parker } from '../../agent/auto-approve/park'
import { HINTS } from '../../agent/auto-approve/policy'
import { CommandCatalog } from '../../agent/commands'
import { userContent } from '../../agent/attachments'
import { readUserEffort, readUserModel, type UserEffortReader, type UserModelReader } from '../../claude-home/user-model'
import { InputQueue } from '../../agent/session/input-queue'
import { modelOptions, USER_MODEL_FALLBACK } from '../../agent/session/models'
import type {
  CanUseToolHandler,
  ClaudeUserMessage,
  PermissionAnswer,
  PermissionRequestOptions,
  QueryFactory,
  QueryHandle,
  QueryRequest,
  ToolUseFacts,
} from '../../agent/session/types'
import type { SlashCommand } from '../../../shared/agent/commands'
import type { AgentEvent, PermissionOption } from '../../../shared/agent/events'
import { ASK_USER_QUESTION, parseQuestions } from '../../../shared/agent/questions'
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import { isSelectableModel, PERMISSION_MODES, type EffortChoice, type ModelOption, type PermissionModeChoice, type SessionSettings } from '../../../shared/agent/settings'
import { contextUsageOf, isCompactBoundary, sdkMessageToEvents } from '../../../shared/vendors/claude/events'
import type { ApprovalWhere, PermissionAsker, RefusalDetails, SessionApproval, SessionHandle, SessionMessage, SessionPart, SessionStart } from '../session'
import { claudeSignedIn } from './account'
import { claudeSettings } from './options'
import { queryFactoryFromEnv } from './query'

/** What the model reads when the user pressed "Deny". */
export const DENIED_MESSAGE = 'The user denied this tool call in worfy.'
/** What the model reads when the request was dropped: the turn was interrupted or the Session closed. */
export const CANCELLED_MESSAGE = 'The permission request was cancelled: the user interrupted the turn or closed the Session.'
/** What the model reads when the user pressed "Decline" on a question. */
export const QUESTION_DECLINED_MESSAGE = 'The user declined to answer the questions in worfy.'
/** What the model reads when an unattended Session was asked for a permission. */
export const UNATTENDED_DENIED_MESSAGE =
  'This Session runs unattended (worfy Autopilot): no one is there to answer a permission request, so the tool call is refused.'

/** What the model reads when an unattended Session refused a request Claude Code gave a reason for. */
export const unattendedDeniedMessage = (reason: string): string =>
  `${UNATTENDED_DENIED_MESSAGE}\nrefused because: ${reason}; follow the reason above: give a literal, resolvable target`

/**
 * The answers Claude offers to a permission request (ticket 21): this call; this call and every later
 * call of the same tool until the Session ends; no. Their ids are those `agent.permission` took before
 * worfy-multi-vendor ticket 14.
 */
export const CLAUDE_PERMISSION_OPTIONS: readonly PermissionOption[] = [
  { id: 'allow', label: 'Allow', kind: 'allow' },
  { id: 'always_allow', label: 'Always allow', kind: 'allow_always' },
  { id: 'deny', label: 'Deny', kind: 'deny' },
]

const CANCELLED: PermissionAnswer = { behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true }

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** What a suggestion is and where it would write; for display only. */
function suggestionSummaries(suggestions: readonly unknown[] | undefined): { type: string; destination: string | null }[] {
  return (suggestions ?? []).flatMap((each) => {
    if (typeof each !== 'object' || each === null) return []
    const { type, destination } = each as Record<string, unknown>
    return typeof type === 'string' ? [{ type, destination: typeof destination === 'string' ? destination : null }] : []
  })
}

/**
 * canUseTool of an attended Session: each call becomes a neutral permission request of the Session's
 * gate `asker`, with the tool as its subject and Claude's options ("Always allow" left out when Claude
 * Code says it must not be offered); AskUserQuestion with questions worfy can read becomes questions.
 * No answer passes `updatedPermissions`: the suggestions Claude Code offers write to settings files
 * or switch the mode, so worfy applies none of them and keeps its own list on the gate instead.
 */
export function claudeCanUseTool(asker: PermissionAsker): CanUseToolHandler {
  return async (toolName, input, options) => {
    const questions = toolName === ASK_USER_QUESTION ? parseQuestions(input) : null
    if (questions !== null) {
      // The picks become the `answers` of the tool's input: the only way the model learns them.
      const reply = await asker.askQuestions({ toolUseId: text(options.toolUseID), questions, signal: options.signal })
      if (reply.outcome === 'answered') return { behavior: 'allow', updatedInput: { ...input, answers: reply.answers } }
      return reply.outcome === 'declined' ? { behavior: 'deny', message: QUESTION_DECLINED_MESSAGE } : CANCELLED
    }
    const offered = options.suppressAlwaysAllowRule === true ? CLAUDE_PERMISSION_OPTIONS.filter((option) => option.kind !== 'allow_always') : CLAUDE_PERMISSION_OPTIONS
    const picked = await asker.ask({
      subject: toolName,
      toolName,
      toolUseId: text(options.toolUseID),
      input,
      title: text(options.title),
      description: text(options.description),
      blockedPath: text(options.blockedPath),
      suggestions: suggestionSummaries(options.suggestions),
      options: offered.map((option) => ({ ...option })),
      signal: options.signal,
    })
    if (picked === null) return CANCELLED
    const kind = CLAUDE_PERMISSION_OPTIONS.find((option) => option.id === picked)?.kind ?? 'deny'
    return kind === 'deny' ? { behavior: 'deny', message: DENIED_MESSAGE } : { behavior: 'allow', updatedInput: input }
  }
}

/** What the model reads when the approval policy refused a request (On): Claude Code's reason, then the rule's hint. */
export const approvalDeniedMessage = (reason: string | null, hint: string): string =>
  `${UNATTENDED_DENIED_MESSAGE}${reason === null ? '' : `\nrefused because: ${reason}`}\n${hint}`

/** What Shadow records for an outcome: what would have been done; a hard deny is one in any mode. */
const SHADOW_OUTCOME = { allow: 'would-allow', deny: 'would-deny', park: 'would-park', 'hard-deny': 'hard-deny' } as const

/** How many tool calls the folders are kept for, waiting for canUseTool: most calls are never asked about. */
const TOOL_USES_KEPT = 256

/**
 * Where the shell stood for each tool call, as the PreToolUse hook of the query told it
 * (QueryRequest.toolUse), until canUseTool takes it; and the whole environment the process started
 * with, once the query told it (QueryRequest.processEnv).
 */
export class ToolUseFolders {
  private readonly folders = new Map<string, Omit<ApprovalWhere, 'env'>>()
  private env: Readonly<Record<string, string | undefined>> | null = null

  readonly started = (env: Readonly<Record<string, string | undefined>>): void => {
    this.env = env
  }

  readonly record = (use: ToolUseFacts): void => {
    this.folders.delete(use.toolUseId)
    this.folders.set(use.toolUseId, { cwd: use.cwd, scratchpad: use.scratchpad })
    // The oldest go first: a Map keeps the order things were set in.
    for (const key of this.folders.keys()) {
      if (this.folders.size <= TOOL_USES_KEPT) break
      this.folders.delete(key)
    }
  }

  /** Where the shell stood for the call `toolUseId`; nulls when the hook did not say. */
  take(toolUseId: string | null): ApprovalWhere {
    const where = (toolUseId === null ? undefined : this.folders.get(toolUseId)) ?? { cwd: null, scratchpad: null }
    if (toolUseId !== null) this.folders.delete(toolUseId)
    return this.env === null ? where : { ...where, env: this.env }
  }
}

/** The mode of `approval` now; Off without one, and when reading it fails. */
function modeOf(approval: SessionApproval | undefined): AutoApprovalMode {
  if (approval === undefined) return 'off'
  try {
    return approval.mode()
  } catch (error) {
    console.warn('[agent] could not read the Auto-approval mode, the request is refused as at Off', error)
    return 'off'
  }
}

/**
 * canUseTool of an unattended Session. Claude Code still asks in bypassPermissions for a few of its
 * own checks (`rm -rf` with a target it cannot resolve); its `decisionReason` goes to the model, so it
 * can rewrite the command, and to the subscribers with the Subagent that asked (`agentID`). Without a
 * reason the message is UNATTENDED_DENIED_MESSAGE alone.
 *
 * The Auto-approval mode of `approval` is read at each call (worfy-auto-approve ticket 04):
 * - Off, or no `approval`: refuses at once and tells `refused` the tool's name, the message and who
 *   asked and why — the policy is not asked;
 * - Shadow: asks the policy, reports what it would have done (`would-*`, a hard deny as `hard-deny`),
 *   and refuses with the same message as Off; `refused` is not told;
 * - On: allow answers the call with its input unchanged; deny and hard deny refuse with the rule's hint
 *   after Claude Code's reason; park waits for the owner through `park` (worfy-auto-approve ticket 07):
 *   the owner's Allow lets the call through, Deny refuses it, and no answer (the wait limit, a stop of
 *   the run) refuses it with PARK_EXPIRED_HINT, then the rule's own hint, if any; each end is told as
 *   `park-answered` (with the answer) or `park-expired`. Without `park` it refuses with HINTS.parkPending.
 * `folders` gives where the shell stood for the call (the PreToolUse hook, ToolUseFolders).
 */
export function unattendedCanUseTool(
  refused: (toolName: string, message: string, details: RefusalDetails) => void,
  approval?: SessionApproval,
  folders?: ToolUseFolders,
  park?: Parker,
): CanUseToolHandler {
  return async (toolName, input, options: PermissionRequestOptions) => {
    const reason = text(options.decisionReason)
    const agent = text(options.agentID)
    const message = reason === null ? UNATTENDED_DENIED_MESSAGE : unattendedDeniedMessage(reason)
    const details: RefusalDetails = { ...(agent === null ? {} : { agent }), ...(reason === null ? {} : { reason }) }
    const mode = modeOf(approval)
    if (approval === undefined || mode === 'off') {
      refused(toolName, message, details)
      return { behavior: 'deny', message }
    }
    const where = folders?.take(text(options.toolUseID)) ?? { cwd: null, scratchpad: null }
    const decision = await approval.judge({ tool: toolName, input }, where)
    const command = typeof input['command'] === 'string' ? input['command'] : null
    const outcome = mode === 'shadow' ? SHADOW_OUTCOME[decision.outcome] : decision.outcome
    const line = { mode, rule: decision.rule, tool: toolName, targets: [...decision.targets], command, ...details }
    approval.decided({ ...line, outcome })
    if (mode === 'shadow') return { behavior: 'deny', message }
    if (decision.outcome === 'allow') return { behavior: 'allow', updatedInput: input }
    if (decision.outcome === 'park' && park !== undefined) {
      const end = await park({
        toolName,
        toolUseId: text(options.toolUseID),
        input,
        blockedPath: text(options.blockedPath),
        rule: decision.rule,
        targets: decision.targets,
        options: CLAUDE_PERMISSION_OPTIONS,
        signal: options.signal,
      })
      if (end.outcome === 'answered') {
        const allowed = end.kind !== 'deny'
        approval.decided({ ...line, outcome: 'park-answered', answer: allowed ? 'allow' : 'deny' })
        return allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: DENIED_MESSAGE }
      }
      approval.decided({ ...line, outcome: 'park-expired' })
      return { behavior: 'deny', message: approvalDeniedMessage(reason, decision.hint === null ? PARK_EXPIRED_HINT : `${PARK_EXPIRED_HINT}\n${decision.hint}`) }
    }
    const hint = decision.outcome === 'park' ? HINTS.parkPending : decision.hint
    return { behavior: 'deny', message: hint === null ? message : approvalDeniedMessage(reason, hint) }
  }
}

/** The user's own model and effort (user-model.ts); tests give fixed answers. */
export interface UserDefaults {
  model: UserModelReader
  effort: UserEffortReader
}

const USER_DEFAULTS: UserDefaults = { model: () => readUserModel(), effort: () => readUserEffort() }

/**
 * What the SessionHandle of the Claude driver holds of Claude Code, for the other parts of this
 * driver (commands, capabilities): its live query and the catalog of its slash commands.
 */
export interface ClaudeLiveSession {
  /** The live query; null before it started and once Claude Code is gone. */
  readonly query: QueryHandle | null
  /** The commands of system/init and system/commands_changed (src/main/agent/commands.ts). */
  readonly catalog: CommandCatalog
}

/** What the Claude driver holds of the Session `session`; null for a handle that is not its own. */
export function claudeLive(session: SessionHandle): ClaudeLiveSession | null {
  const live = session as SessionHandle & Partial<ClaudeLiveSession>
  return live.catalog !== undefined && live.query !== undefined ? { query: live.query, catalog: live.catalog } : null
}

/** One query() of Claude Code behind worfy's SessionHandle. */
class ClaudeSession implements SessionHandle, ClaudeLiveSession {
  private queryValue: QueryHandle | null = null
  private readonly input = new InputQueue<ClaudeUserMessage>()
  private readonly out = new InputQueue<AgentEvent>()
  /** Set once the events ended or the handle was closed: nothing more goes out. */
  private done = false
  private reading = false
  /** A message went to Claude Code, or a turn began: a failed start check no longer fails the start. */
  private underway = false
  /** Asks for the context usage so far; an answer to any but the latest is dropped. */
  private contextAsks = 0

  constructor(
    readonly catalog: CommandCatalog,
    private readonly user: UserDefaults,
    /** The SDK session id, for the log. */
    private readonly label: string,
  ) {}

  get query(): QueryHandle | null {
    return this.queryValue
  }

  /** Starts the query; rejects when Claude Code cannot be started. */
  async open(factory: QueryFactory, request: Omit<QueryRequest, 'prompt'>): Promise<void> {
    try {
      this.queryValue = await factory({ ...request, prompt: this.input })
    } catch (error) {
      this.input.end()
      throw error
    }
  }

  /** Read once by the Session; reading starts the message loop and the start check. */
  readonly events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]: () => {
      const query = this.queryValue
      if (!this.reading && query !== null && !this.done) {
        this.reading = true
        void this.checkAccount(query)
        void this.pump(query)
      }
      return this.out[Symbol.asyncIterator]()
    },
  }

  send(message: SessionMessage): Promise<void> {
    this.underway = true
    this.input.push({
      type: 'user',
      message: { role: 'user', content: userContent(message.text, message.attachments) },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    })
    return Promise.resolve()
  }

  async interrupt(): Promise<void> {
    await this.queryValue?.interrupt()
  }

  close(): void {
    const query = this.queryValue
    this.end()
    this.out.end()
    query?.close()
  }

  async setModel(model: string | null): Promise<void> {
    const query = this.live()
    if (model !== null) return query.setModel(model)
    // setModel with no model would put Claude Code on its own default model, not on the user's:
    // "Default" names the user's model (sonnet for a haiku), and only with none goes to Claude Code's.
    const userModel = this.readUser('model', this.user.model)
    return query.setModel(userModel === null ? undefined : isSelectableModel(userModel) ? userModel : USER_MODEL_FALLBACK)
  }

  async setEffort(effort: string | null): Promise<void> {
    const query = this.live()
    await query.applyFlagSettings({ effortLevel: effort === null ? this.readUser('effort', this.user.effort) : (effort as EffortChoice) })
  }

  async setPermissionPreset(id: string): Promise<void> {
    if (!(PERMISSION_MODES as readonly string[]).includes(id)) throw new Error(`${id} is no permission mode of Claude Code`)
    await this.live().setPermissionMode(id as PermissionModeChoice)
  }

  async models(): Promise<ModelOption[]> {
    const query = this.queryValue
    if (query === null) return []
    try {
      return modelOptions(await query.supportedModels())
    } catch (error) {
      console.warn(`[agent] supportedModels of ${this.label} failed`, error)
      return []
    }
  }

  commands(): Promise<SlashCommand[]> {
    return this.catalog.list(this.queryValue)
  }

  /**
   * The settings a new Claude Code process is asked for. With no model named the SDK runs the
   * user's model from settings.json; when that is a haiku the process is asked for sonnet instead.
   * With no effort named the process is asked for the user's effortLevel, which Claude Code would
   * not apply to a newer model (user-model.ts). Only the request changes: the Session's settings
   * (and the Node's saved picks) keep `null`, and the user's settings.json is left as it is (ADR 0005).
   */
  startSettings(settings: SessionSettings): SessionSettings {
    const asked = settings.effort !== null ? settings : { ...settings, effort: this.readUser('effort', this.user.effort) }
    if (asked.model !== null) return asked
    const userModel = this.readUser('model', this.user.model)
    return userModel !== null && !isSelectableModel(userModel) ? { ...asked, model: USER_MODEL_FALLBACK } : asked
  }

  private live(): QueryHandle {
    if (this.queryValue === null || this.done) throw new Error('Claude Code is not running')
    return this.queryValue
  }

  /** One of the user's own settings; null when it cannot be read, so the start or the change goes on. */
  private readUser<T>(what: string, read: () => T | null): T | null {
    try {
      return read()
    } catch (error) {
      console.warn(`[agent] could not read the user's ${what} for ${this.label}`, error)
      return null
    }
  }

  private async pump(query: QueryHandle): Promise<void> {
    try {
      for await (const message of query) {
        if (this.done) return
        this.observe(message)
      }
      this.finish(new Error('Claude Code exited'))
    } catch (error) {
      this.finish(error)
    }
  }

  private observe(message: unknown): void {
    this.catalog.observe(message)
    // A compaction empties most of the window while the turn may go on for long.
    if (isCompactBoundary(message)) this.askContext()
    for (const event of sdkMessageToEvents(message)) {
      if (event.type === 'init') this.underway = true
      this.out.push(event)
      if (event.type === 'result') this.askContext()
    }
  }

  private async checkAccount(query: QueryHandle): Promise<void> {
    try {
      const account = await query.accountInfo()
      if (this.done) return
      this.out.push({
        type: 'account',
        loggedIn: claudeSignedIn(account),
        subscriptionType: account.subscriptionType ?? null,
        apiProvider: account.apiProvider ?? null,
        tokenSource: account.tokenSource ?? null,
      })
    } catch (error) {
      // A dead process also ends the message loop, which reports it; this covers a start that
      // never answers the account request.
      if (!this.done && !this.underway) this.finish(error)
    }
  }

  /**
   * Asks the query how full the context window is. `summary` answers from the last response's usage,
   * without token-count requests. A failed ask is "no data" (`usage: null`), never a failed turn. An
   * answer is dropped when a newer ask was made or the handle is done.
   */
  private askContext(): void {
    const query = this.queryValue
    if (query?.getContextUsage === undefined) return
    const ask = ++this.contextAsks
    void (async () => {
      let usage = null
      try {
        usage = contextUsageOf(await query.getContextUsage?.({ detail: 'summary' }))
      } catch (error) {
        console.warn(`[agent] could not read the context usage of ${this.label}`, error)
      }
      if (ask !== this.contextAsks || this.done) return
      this.out.push({ type: 'context', usage })
    })()
  }

  /** Claude Code is gone, or its start was never confirmed: the events end with `error`. */
  private finish(error: unknown): void {
    if (this.done) return
    this.end()
    this.out.fail(error instanceof Error ? error : new Error(messageOf(error)))
  }

  private end(): void {
    this.done = true
    this.queryValue = null
    this.input.end()
  }
}

/**
 * The session part of the Claude driver over `factory`: the app's (claudeSession, below), or the fake
 * agent's in tests. `given`: readers of the user's own model and effort in place of settings.json's.
 */
export function claudeSessions(factory: QueryFactory, given: Partial<UserDefaults> = {}): SessionPart {
  const user: UserDefaults = { ...USER_DEFAULTS, ...given }
  const open = async (opts: SessionStart, resume: string | undefined, sessionId: string | undefined): Promise<SessionHandle> => {
    const previous = opts.previous === undefined ? null : claudeLive(opts.previous)
    const handle = new ClaudeSession(previous?.catalog ?? new CommandCatalog(), user, resume ?? sessionId ?? 'a new Session')
    // The shell's folder of each tool call, for the approval policy of an unattended Session (worfy-auto-approve ticket 04).
    const folders = opts.unattended && opts.approval !== undefined ? new ToolUseFolders() : undefined
    await handle.open(factory, {
      cwd: opts.cwd,
      resume,
      sessionId: resume === undefined ? sessionId : undefined,
      stderr: opts.stderr,
      settings: handle.startSettings(opts.settings),
      canUseTool: opts.unattended ? unattendedCanUseTool(opts.refused, opts.approval, folders, createParker(opts.permissions)) : claudeCanUseTool(opts.permissions),
      unattended: opts.unattended,
      spawned: opts.spawned,
      orchestrator: opts.orchestrator,
      ...(opts.environment === undefined ? {} : { environment: opts.environment }),
      ...(folders === undefined ? {} : { toolUse: folders.record, processEnv: folders.started }),
    })
    return handle
  }
  return {
    start: (opts) => open(opts, undefined, opts.sessionId),
    resume: (id, opts) => open(opts, id, undefined),
    settingsFor: claudeSettings,
  }
}

let appPart: SessionPart | null = null

/**
 * The app's Claude Sessions: queryFactoryFromEnv — the SDK, or the fake agent under WORFY_AGENT=fake —
 * with every Session's rate_limit_event feeding the Limits (ticket 22), made at the first start.
 */
async function app(): Promise<SessionPart> {
  if (appPart === null) {
    const { appLimits } = await import('../../agent/limits')
    appPart ??= claudeSessions(appLimits().observe(queryFactoryFromEnv()))
  }
  return appPart
}

export const claudeSession: SessionPart = {
  start: async (opts) => (await app()).start(opts),
  resume: async (id, opts) => (await app()).resume(id, opts),
}
