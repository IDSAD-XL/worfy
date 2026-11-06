// The session part of the Codex driver (ADR-0094 item 2, worfy-multi-vendor ticket 20): one
// `codex app-server` process per Session handle (app-server.ts, ticket 19), or the fake app-server under
// WORFY_CODEX=fake, behind worfy's SessionHandle.
//
// - start: `thread/start {cwd, approvalPolicy, sandbox, model}`; resume: `thread/resume {threadId, …}`.
//   A Session in a Project adds worfy's MCP servers to both (`config`, `developerInstructions`; mcp.ts).
//   The start check of a Codex Session is that thread answering: the handle then gives `account`, and the
//   Session takes messages. Whether the user is signed in to Codex is the account part's question
//   (ticket 21); a turn of a signed-out Codex fails with Codex's own error.
// - send: `turn/start` when no turn runs, `turn/steer {expectedTurnId}` into the one that does. The
//   Session's queue stays worfy's own (src/main/agent/queue.ts), not `thread/queue/*`, which is
//   experimental. Sends go one after the other, so a message sent while a turn is being started steers it.
// - setModel, setEffort, setPermissionPreset: what the next `turn/start` takes — only what changed
//   since the thread was last told (the stable surface: a change does not reach a running turn). null
//   — "Default" — is the model `model/list` marks as default, and that model's default effort.
// - a message that starts with a command of the slash menu (commands.ts, ticket 22): `/compact` →
//   `thread/compact/start`, `/review` → `review/start` inline, a skill → its `$name` and a `skill` item
//   in the input of the turn. The skills are those of `skills/list`, asked once per process and again
//   after `skills/changed`.
// - interrupt: every open approval is answered `cancel`, then `turn/interrupt`.
// - close: open approvals are answered `cancel`, then the process ends (CodexAppServer.close).
// - presets → approval policy and sandbox (capabilities.ts, codexPresetFor); notifications → events
//   (items.ts); approvals → permission requests (approvals.ts). An unattended Session (Autopilot) never
//   waits for a person: at Auto-approval Off it declines every approval at once and reports it through
//   `refused`; at Shadow and On the run's approval policy judges it (worfy-auto-approve ticket 05), and the
//   app-server process gets the run's variables (SessionStart.environment).
// - Limits (ticket 26): `account/rateLimits/updated` → a `limits` event, whose windows also go to the
//   app's LimitsTracker for the Limits panel; a turn refused by the Limits (`usageLimitExceeded`) →
//   `limit_reached` (limits.ts, decision 09) before the error that ends the turn.
//
// The process is reported to the Session (SessionStart.spawned) the moment it is spawned, before its
// handshake: a Session closed while the start runs waits for that process too, every failure of the
// start closes it (CodexAppServer.start and open() below), and the Session closes a handle that comes
// after it closed. So the start needs no way of its own to be stopped, and leaves no process behind.
//
// GH_TOKEN (worfy-multi-vendor ticket 36): a Codex hook cannot set the environment of a Session (its
// SessionStart output has additionalContext only), so the token a Claude Session gets from the Harness
// hook (gh-token-env.mjs, `gh auth token -u <github.account of the Profile>`) goes into the environment
// of the app-server process instead, and from there into every shell of the Session. Without an
// account, or without a gh login for it, the process gets worfy's own environment as before, its own
// GH_TOKEN included when it has one. The token is never logged; the reason it is missing names only
// the account (accountAuth).
//
// Texts out of the process: its stderr goes, as it comes, to SessionStart.stderr, which the Session
// keeps a bounded tail of and adds to the error of a process that died (as for Claude Code); the error
// the events end with names only the exit code. An error text of the app-server that goes into an
// event is bounded (items.ts, boundedText).
//
// app-server.ts is loaded at the first start, not with this file: its JSON-RPC client checks every
// message against the JSON Schema bundle of the pinned Codex (rpc.ts), and the driver is loaded at
// every start of worfy, also for users who never start Codex.
import { spawn } from 'node:child_process'
import { messageText } from '../../../shared/agent/attachments'
import type { SlashCommand } from '../../../shared/agent/commands'
import type { AgentEvent } from '../../../shared/agent/events'
import type { LimitWindow } from '../../../shared/agent/limits'
import type { ModelOption } from '../../../shared/agent/settings'
import { InputQueue } from '../../agent/session/input-queue'
import { hasExited, within } from '../../agent/session/process'
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import type { Decision } from '../../agent/auto-approve/policy'
import type { PermissionAsk, SessionApproval, SessionHandle, SessionMessage, SessionPart, SessionStart } from '../session'
import type { CodexAppServer } from './app-server'
import { approvalAsk, decisionOf, isApprovalRequest, policyRequestOf, UNATTENDED_DECLINED_MESSAGE, withGrantRoot, type CodexApprovalRequest, type CodexDecision } from './approvals'
import type { CodexRuntime } from './binary'
import { codexModelOptions, codexPermissionPreset, codexPresetFor, codexSandboxPolicy, codexSettings, type CodexModelSource } from './capabilities'
import { codexCommandOf, codexSlashCommands, CODEX_BUILT_IN_COMMANDS, slashName, type CodexCommand, type CodexSkillSource } from './commands'
import { boundedText, CodexItems } from './items'
import { CODEX_VENDOR, codexLimitReachedEvent, codexLimitsEvent } from './limits'
import type { SpawnProcess } from './launch'
import { appCodexMcp, type CodexMcpResolver } from './mcp'
import type { RequestId } from './protocol/ts/RequestId'
import type { AccountRateLimitsUpdatedNotification } from './protocol/ts/v2/AccountRateLimitsUpdatedNotification'
import type { ServerNotification } from './protocol/ts/ServerNotification'
import type { ServerRequest } from './protocol/ts/ServerRequest'
import type { Model } from './protocol/ts/v2/Model'
import type { ModelListResponse } from './protocol/ts/v2/ModelListResponse'
import type { ReviewStartResponse } from './protocol/ts/v2/ReviewStartResponse'
import type { SkillMetadata } from './protocol/ts/v2/SkillMetadata'
import type { SkillsListResponse } from './protocol/ts/v2/SkillsListResponse'
import type { ThreadStartResponse } from './protocol/ts/v2/ThreadStartResponse'
import type { TurnStartParams } from './protocol/ts/v2/TurnStartParams'
import type { TurnStartResponse } from './protocol/ts/v2/TurnStartResponse'
import type { UserInput } from './protocol/ts/v2/UserInput'
import type { ClientMethod, CodexRpcEvent, ParamsOf } from './rpc'

/** How a Codex app-server is started for a Session; the app's own unless a test gives one. */
export interface CodexServerOptions {
  runtime: CodexRuntime
  /** app.getAppPath(): where the fake and its scripts are under WORFY_CODEX=fake. */
  appPath: string
  /** worfy's version, as clientInfo.version. */
  clientVersion: string
  /** The environment of the process; process.env by default. */
  env?: NodeJS.ProcessEnv
  /** child_process.spawn by default. */
  spawnProcess?: SpawnProcess
  /** How long a request waits for its answer; rpc.ts's REQUEST_TIMEOUT_MS by default. */
  timeoutMs?: number
  log?: (line: string) => void
  /** Where the windows of each `limits` event of the Session go: the app's LimitsTracker; nowhere by default. */
  limits?: (windows: readonly LimitWindow[]) => void
  /** worfy's MCP servers of a Session (mcp.ts, ticket 33); without it a Session gets none. */
  mcp?: CodexMcpResolver
  /**
   * GH_TOKEN of the GitHub account of the Profile at `cwd`, or null when there is none; may reject with
   * a reason that holds no token. Without it the process gets the environment as it is.
   */
  ghToken?: (cwd: string) => Promise<string | null>
}

/** `env` with GH_TOKEN set to `token`, in the one spelling (Windows reads names in any case); `env` itself without one. */
export function withGhToken(env: NodeJS.ProcessEnv, token: string | null): NodeJS.ProcessEnv {
  if (token === null) return env
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() !== 'GH_TOKEN') out[key] = value
  out.GH_TOKEN = token
  return out
}

/** The JSON-RPC error a server→client request worfy does not answer gets (rpc.ts's METHOD_NOT_FOUND). */
const METHOD_NOT_FOUND = -32601

/** What Shadow reports for an outcome: what would have been done; a hard deny is one in any mode. */
const SHADOW_OUTCOME = { allow: 'would-allow', deny: 'would-deny', park: 'would-park', 'hard-deny': 'hard-deny' } as const

/** The mode of `approval` now; Off without one, and when reading it fails. */
function approvalMode(approval: SessionApproval | undefined): AutoApprovalMode {
  if (approval === undefined) return 'off'
  try {
    return approval.mode()
  } catch (error) {
    console.warn('[codex] could not read the Auto-approval mode, the approval is declined as at Off', error)
    return 'off'
  }
}

/** How many pages of `model/list` a Session reads at most. */
const MODEL_PAGES = 10

/** What a turn runs with: the model and effort (null: Codex's default) and the id of a Codex preset. */
interface TurnSettings {
  model: string | null
  effort: string | null
  preset: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/** The exit of the app-server an error tells of (CodexAppServerExit), or null for any other error. */
function exitOf(error: unknown): ProcessExit | null {
  if (!(error instanceof Error) || error.name !== 'CodexAppServerExit') return null
  const { code, signal } = error as Error & Partial<ProcessExit>
  return { code: code ?? null, signal: signal ?? null }
}

/** How the process ended, without its stderr: the Session has that from SessionStart.stderr. */
export function exitText({ code, signal }: ProcessExit): string {
  return `Codex app-server ${signal !== null ? `was stopped by ${signal}` : `exited with code ${code ?? 'unknown'}`}`
}

/** The error a start rejects with: how the process ended, or the error bounded. */
function startError(error: unknown): Error {
  const exit = exitOf(error)
  return new Error(exit !== null ? `${exitText(exit)} before the Session started` : boundedText(`Codex did not start the Session: ${messageOf(error)}`), { cause: error })
}

/**
 * The user's message as Codex's input: each image as a data URL, then the text with the attached files'
 * paths. A message that calls a skill has its `$name` in place of `/name`, and the `skill` item after the text.
 */
export function userInput(message: SessionMessage, skill?: Extract<CodexCommand, { kind: 'skill' }>): UserInput[] {
  const images: UserInput[] = message.attachments.flatMap((each) => (each.kind === 'image' ? [{ type: 'image' as const, url: `data:${each.mediaType};base64,${each.data}` }] : []))
  if (skill !== undefined) return [...images, { type: 'text', text: messageText(skill.text, message.attachments), text_elements: [] }, { type: 'skill', name: skill.name, path: skill.path }]
  const text = messageText(message.text, message.attachments)
  return text === '' && images.length > 0 ? images : [...images, { type: 'text', text, text_elements: [] }]
}

/** One `codex app-server` process of a Session, behind worfy's SessionHandle. */
class CodexSession implements SessionHandle, CodexModelSource, CodexSkillSource {
  private server: CodexAppServer | null = null
  /** The whole environment of the app-server process, which every shell of the Session inherits; null: not known. */
  private processEnv: Readonly<Record<string, string | undefined>> | null = null
  private threadId = ''
  private readonly out = new InputQueue<AgentEvent>()
  /** Set once the events ended or the handle was closed: nothing more goes out. */
  private done = false
  /** The turn that runs, once Codex named it; null between turns. */
  private activeTurn: string | null = null
  /** The turn that ended last: its `turn/start` answer, if late, does not make it run again. */
  private lastEnded: string | null = null
  /** The sends so far, one after the other; never rejects. */
  private sending: Promise<void> = Promise.resolve()
  /** Open approvals, by the id of their request: the controller withdraws the Session's request. */
  private readonly approvals = new Map<RequestId, AbortController>()
  private modelList: Promise<Model[]> | null = null
  /** The skills of `skills/list` for the Session's folder; null until asked, and again after `skills/changed`. */
  private skillList: Promise<SkillMetadata[]> | null = null
  /** The model the thread runs on, as Codex last named it. */
  private model = ''
  /** The version of Codex that runs the thread, as the thread names it. */
  private version: string | null = null
  /** What the next turn is to run with. */
  private readonly wanted: TurnSettings
  /** What the thread was last told: by its start, then by each `turn/start` that named a change. */
  private told: TurnSettings
  private readonly items: CodexItems
  /** The windows of the Session's last `limits` event: what a refusal is decided by when reading them again fails. */
  private limitWindows: readonly LimitWindow[] = []
  /** A refusal by the Limits being decided: the messages that came after it wait for it (receive()). */
  private deciding: Promise<void> | null = null

  constructor(
    private readonly opts: SessionStart,
    preset: string,
    /** Where the windows of each `limits` event go (CodexServerOptions.limits). */
    private readonly recordLimits: (windows: readonly LimitWindow[]) => void = () => undefined,
  ) {
    // Effort is not part of thread/start: the thread starts on Codex's own, and the first turn names the Session's.
    this.told = { model: opts.settings.model, effort: null, preset }
    this.wanted = { model: opts.settings.model, effort: opts.settings.effort, preset }
    this.items = new CodexItems({
      threadId: () => this.threadId,
      cwd: () => opts.cwd,
      version: () => this.version,
      model: () => this.model,
      preset: () => this.told.preset,
    })
  }

  /** The process, once its handshake is done, and the whole environment it started with: what it sends from now on reaches this handle. */
  started(server: CodexAppServer, env: Readonly<Record<string, string | undefined>> | null): void {
    this.server = server
    this.processEnv = env
  }

  /** The thread answered: the Session takes messages, and the end of the process ends the events. */
  attach(response: ThreadStartResponse, outputAfterExitMs: number): void {
    const server = this.server as CodexAppServer
    this.threadId = response.thread.id
    this.model = response.model
    this.version = typeof response.thread.cliVersion === 'string' ? response.thread.cliVersion : null
    const child = server.process
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    const ended = (code: number | null, signal: NodeJS.Signals | null): void => {
      void within(closed, outputAfterExitMs).then(() => this.finish(new Error(exitText({ code, signal }))))
    }
    if (hasExited(child)) ended(child.exitCode, child.signalCode)
    else child.once('exit', ended)
    this.out.push({ type: 'account', loggedIn: true, subscriptionType: null, apiProvider: null, tokenSource: null })
  }

  readonly events: AsyncIterable<AgentEvent> = { [Symbol.asyncIterator]: () => this.out[Symbol.asyncIterator]() }

  /**
   * The app-server's messages, in order. While a refusal by the Limits is decided (refusal()), what
   * comes after it waits: so `limit_reached` comes before the turn's `result`.
   */
  receive(event: CodexRpcEvent): void {
    if (this.done) return
    const wait = this.deciding === null ? this.take(event) : this.deciding.then(() => this.take(event) ?? undefined)
    if (wait === null) return
    this.deciding = wait
    void wait.then(() => {
      if (this.deciding === wait) this.deciding = null
    })
  }

  /** One message of the app-server: null once it is handled, or the decision of a refusal by the Limits to wait for. */
  private take(event: CodexRpcEvent): Promise<void> | null {
    if (this.done) return null
    switch (event.type) {
      case 'notification': {
        const { notification } = event
        if (notification.method === 'error' && notification.params.error.codexErrorInfo === 'usageLimitExceeded' && !notification.params.willRetry) return this.refusal(notification)
        if (notification.method === 'account/rateLimits/updated') this.limitsUpdated(notification.params)
        else this.notified(notification)
        break
      }
      case 'request':
        this.asked(event.request)
        break
      case 'unknown':
        this.out.push({ type: 'unknown', sdkType: event.method ?? 'message' })
        break
      case 'error':
        this.out.push({ type: 'unknown', sdkType: 'not-json' })
        break
    }
    return null
  }

  /**
   * Codex's windows changed (`account/rateLimits/updated`, during a turn): a `limits` event, and the
   * windows go to the Limits panel (CodexServerOptions.limits). The notification names no thread: the
   * windows are the account's.
   */
  private limitsUpdated(params: AccountRateLimitsUpdatedNotification): void {
    const event = codexLimitsEvent(params, Date.now())
    this.limitWindows = event.windows
    this.out.push(event)
    try {
      this.recordLimits(event.windows)
    } catch (error) {
      console.warn('[codex] could not record the Limits of the Session', error)
    }
  }

  /**
   * A turn of this thread refused by the Limits (`usageLimitExceeded`): the windows are read again on
   * this app-server and `limit_reached` goes out (decision 09: a used-up window to wait for, or a quota),
   * then the error itself, which ends the turn. Another thread's refusal (a Subagent's) is only passed on.
   */
  private async refusal(notification: Extract<ServerNotification, { method: 'error' }>): Promise<void> {
    const { threadId } = notification.params
    const server = this.server
    if (server !== null && (this.threadId === '' || threadId === this.threadId)) {
      const decided = await codexLimitReachedEvent(server, notification.params, this.limitWindows)
      if (decided !== null && !this.done) this.out.push(decided.event)
    }
    if (!this.done) this.notified(notification)
  }

  send(message: SessionMessage): Promise<void> {
    this.sending = this.sending.then(() => this.deliver(message))
    return this.sending
  }

  async interrupt(): Promise<void> {
    this.cancelApprovals()
    await this.sending
    const turn = this.activeTurn
    if (turn === null || this.done) return
    try {
      await this.request('turn/interrupt', { threadId: this.threadId, turnId: turn })
    } catch (error) {
      // The turn ended before the request reached it (a `cancel` stops it too), or the process is gone.
      if (this.done || this.activeTurn !== turn || exitOf(error) !== null) return
      throw new Error(boundedText(`Codex did not interrupt the turn: ${messageOf(error)}`), { cause: error })
    }
  }

  close(): void {
    this.cancelApprovals()
    this.done = true
    this.out.end()
    void this.server?.close()
  }

  async setModel(model: string | null): Promise<void> {
    this.live()
    this.wanted.model = model
  }

  async setEffort(effort: string | null): Promise<void> {
    this.live()
    this.wanted.effort = effort
  }

  async setPermissionPreset(id: string): Promise<void> {
    const preset = codexPresetFor(id)
    if (preset === undefined) throw new Error(`${id} is no permission preset of Codex`)
    this.live()
    this.wanted.preset = preset.id
  }

  async models(): Promise<ModelOption[]> {
    try {
      return codexModelOptions(await this.codexModels())
    } catch (error) {
      console.warn(`[codex] model/list of thread ${this.threadId} failed`, error)
      return []
    }
  }

  /**
   * The slash menu (commands.ts): the built-in commands and the skills of `skills/list`; the built-in
   * ones alone when Codex cannot list its skills, none once the process is gone.
   */
  async commands(): Promise<SlashCommand[]> {
    if (this.server === null || this.done) return []
    try {
      return codexSlashCommands(await this.codexSkills())
    } catch (error) {
      console.warn(`[codex] skills/list of thread ${this.threadId} failed`, error)
      return [...CODEX_BUILT_IN_COMMANDS]
    }
  }

  /** The skills of `skills/list` for the Session's folder, asked once per process and again after `skills/changed`; a failed ask is asked again next time. */
  codexSkills(): Promise<SkillMetadata[]> {
    if (this.server === null || this.done) return Promise.reject(new Error('Codex is not running'))
    const list = (this.skillList ??= this.request<SkillsListResponse>('skills/list', { cwds: [this.opts.cwd] }).then((answer) => answer.data.flatMap((entry) => entry.skills)))
    list.catch(() => {
      if (this.skillList === list) this.skillList = null
    })
    return list
  }

  /** The models of `model/list`, asked once per process; a failed ask is asked again next time. */
  codexModels(): Promise<Model[]> {
    if (this.server === null || this.done) return Promise.reject(new Error('Codex is not running'))
    const list = (this.modelList ??= this.listModels())
    list.catch(() => {
      if (this.modelList === list) this.modelList = null
    })
    return list
  }

  private async listModels(): Promise<Model[]> {
    const models: Model[] = []
    let cursor: string | null = null
    for (let page = 0; page < MODEL_PAGES; page++) {
      const answer: ModelListResponse = await this.request<ModelListResponse>('model/list', cursor === null ? {} : { cursor })
      models.push(...answer.data)
      cursor = answer.nextCursor ?? null
      if (cursor === null) break
    }
    return models
  }

  private live(): void {
    if (this.server === null || this.done) throw new Error('Codex is not running')
  }

  private request<R = unknown, M extends ClientMethod = ClientMethod>(method: M, params: ParamsOf<M>): Promise<R> {
    const server = this.server
    return server === null ? Promise.reject(new Error('Codex is not running')) : server.request<R, M>(method, params)
  }

  /** One message: a command of the slash menu, into the turn that runs, or as a new turn. Never rejects. */
  private async deliver(message: SessionMessage): Promise<void> {
    if (this.done) return
    const command = await this.commandOf(message)
    if (this.done) return
    const turn = this.activeTurn
    try {
      if (command?.kind === 'compact' || command?.kind === 'review') return await this.runCommand(command, turn)
      const input = userInput(message, command ?? undefined)
      if (turn !== null && (await this.steer(turn, input))) return
      await this.startTurn(input)
    } catch (error) {
      // A process that is gone ends the events itself.
      if (this.done || exitOf(error) !== null) return
      const what = command === null || command.kind === 'skill' ? 'start the turn' : `run /${command.kind}`
      this.out.push({
        type: 'result',
        subtype: 'error',
        isError: true,
        error: boundedText(`Codex did not ${what}: ${messageOf(error)}`),
        text: null,
        costUsd: 0,
        durationMs: 0,
        numTurns: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        terminalReason: 'error',
        interrupted: false,
      })
    }
  }

  /**
   * The command of the slash menu a message runs, or null. The skills are asked only for a `/name` that
   * is no built-in command; when Codex cannot list them, the message goes as it was typed.
   */
  private async commandOf(message: SessionMessage): Promise<CodexCommand | null> {
    const name = slashName(message.text)
    if (name === null) return null
    if (CODEX_BUILT_IN_COMMANDS.some((each) => each.name === name)) return codexCommandOf(message, [])
    try {
      return codexCommandOf(message, await this.codexSkills())
    } catch (error) {
      console.warn(`[codex] skills/list of thread ${this.threadId} failed; /${name} goes as text`, error)
      return null
    }
  }

  /**
   * `/compact` or `/review`. Each starts a turn of its own, which ends with its `result` as any turn does;
   * while another turn runs Codex would refuse it, so the Session is told to send it again after that one.
   */
  private async runCommand(command: Extract<CodexCommand, { kind: 'compact' | 'review' }>, turn: string | null): Promise<void> {
    if (turn !== null) {
      this.out.push({ type: 'notice', kind: 'notification', text: `Codex runs /${command.kind} only between turns: send it again once this turn ends.` })
      return
    }
    if (command.kind === 'compact') {
      await this.request('thread/compact/start', { threadId: this.threadId })
      return
    }
    const answer = await this.request<ReviewStartResponse>('review/start', { threadId: this.threadId, target: command.target, delivery: 'inline' })
    if (answer.turn.id !== this.lastEnded) this.activeTurn = answer.turn.id
  }

  /**
   * Steers the turn `turn`. False when the turn ended before the message reached it: the message then
   * starts the next one. A refusal while it still runs leaves the turn as it is and says so in a notice.
   */
  private async steer(turn: string, input: UserInput[]): Promise<boolean> {
    try {
      await this.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: turn })
      return true
    } catch (error) {
      if (this.done || exitOf(error) !== null) return true
      if (this.activeTurn !== turn) return false
      this.out.push({ type: 'notice', kind: 'notification', text: boundedText(`Codex did not take the message into the running turn: ${messageOf(error)}`) })
      return true
    }
  }

  private async startTurn(input: UserInput[]): Promise<void> {
    const { params, told, model } = await this.overrides()
    // The turn's `init` may come before the answer to turn/start: it names what the turn runs with already.
    const before = { told: this.told, model: this.model }
    this.told = told
    this.model = model
    let answer: TurnStartResponse
    try {
      answer = await this.request<TurnStartResponse>('turn/start', { threadId: this.threadId, input, ...params })
    } catch (error) {
      // Codex did not take the changes: the next turn names them again.
      this.told = before.told
      this.model = before.model
      throw error
    }
    if (answer.turn.id !== this.lastEnded) this.activeTurn = answer.turn.id
  }

  /** What the next `turn/start` names besides its input: each setting that changed since the thread was told. */
  private async overrides(): Promise<{ params: Partial<TurnStartParams>; told: TurnSettings; model: string }> {
    const { wanted } = this
    const told = { ...this.told }
    const params: Partial<TurnStartParams> = {}
    let model = this.model
    if (wanted.model !== told.model) {
      const named = wanted.model ?? (await this.listed()).find((each) => each.isDefault)?.model
      if (named !== undefined) {
        params.model = named
        model = named
        told.model = wanted.model
      }
    }
    // A thread that did not name its model (thread/start answered an empty one) runs on Codex's default:
    // the turn's `init` names that model of `model/list`, so the header shows what the Session runs on.
    if (model === '') model = (await this.listed()).find((each) => each.isDefault)?.model ?? ''
    if (wanted.effort !== told.effort) {
      const effort = wanted.effort ?? (await this.listed()).find((each) => each.model === model)?.defaultReasoningEffort
      if (effort !== undefined) {
        params.effort = effort
        told.effort = wanted.effort
      }
    }
    const preset = wanted.preset !== told.preset ? codexPermissionPreset(wanted.preset) : undefined
    if (preset !== undefined) {
      params.approvalPolicy = preset.approvalPolicy
      params.sandboxPolicy = codexSandboxPolicy(preset.sandbox)
      told.preset = preset.id
    }
    return { params, told, model }
  }

  /** The models of `model/list`; none when Codex cannot say, and the setting waits for a later turn. */
  private async listed(): Promise<Model[]> {
    try {
      return await this.codexModels()
    } catch (error) {
      console.warn(`[codex] model/list of thread ${this.threadId} failed`, error)
      return []
    }
  }

  private notified(notification: ServerNotification): void {
    // The skills on disk changed: the menu asks `skills/list` again next time.
    if (notification.method === 'skills/changed') {
      this.skillList = null
      return
    }
    // Request ids are the process's, not a thread's: Codex withdraws an approval of any of its threads.
    if (notification.method === 'serverRequest/resolved') this.withdraw(notification.params.requestId)
    const { threadId } = (notification.params ?? {}) as { threadId?: unknown }
    // Another thread of the same process (a Subagent's) is not this Session's: none of its events are
    // shown, but its approvals are asked here, and they name their item only by id.
    if (typeof threadId === 'string' && this.threadId !== '' && threadId !== this.threadId) return this.items.follow(notification)
    if (notification.method === 'turn/started') this.activeTurn = notification.params.turn.id
    for (const event of this.items.take(notification)) {
      if (event.type === 'result') this.turnEnded(notification.method === 'error' ? notification.params.turnId : (notification.params as { turn: { id: string } }).turn.id)
      this.out.push(event)
    }
  }

  private turnEnded(turn: string): void {
    this.lastEnded = turn
    if (this.activeTurn === turn) this.activeTurn = null
  }

  private asked(request: ServerRequest): void {
    const server = this.server
    if (server === null) return
    if (!isApprovalRequest(request)) {
      server.respondError(request.id, METHOD_NOT_FOUND, `worfy does not answer ${request.method}`)
      this.out.push({ type: 'unknown', sdkType: request.method })
      return
    }
    const ask = approvalAsk(request, this.items.item(request.params.itemId))
    if (this.opts.unattended) {
      const approval = this.opts.approval
      const mode = approvalMode(approval)
      if (approval === undefined || mode === 'off') {
        server.respond(request.id, { decision: 'decline' })
        this.opts.refused(ask.subject, UNATTENDED_DECLINED_MESSAGE, ask.description === null ? {} : { reason: ask.description })
        return
      }
      this.judged(request, ask, approval, mode)
      return
    }
    const controller = new AbortController()
    this.approvals.set(request.id, controller)
    this.opts.permissions.ask({ ...ask, signal: controller.signal }).then(
      (picked) => this.answer(request.id, decisionOf(picked)),
      () => this.answer(request.id, 'cancel'),
    )
  }

  /**
   * An approval of an unattended Session at Shadow or On (worfy-auto-approve ticket 05), answered by the approval
   * policy. The request stays open while it is judged: Interrupt and the close answer it `cancel`, and Codex may
   * withdraw it. The command is judged in the folder Codex names for it, a file change in the Session's folder, both
   * in the whole environment the app-server process started with. Shadow declines as Off does and reports what would
   * have been done; On accepts what the policy allows and declines the rest — park too, until the owner can be asked
   * (worfy-auto-approve ticket 07). A decision is for this request only: never `acceptForSession`.
   */
  private judged(request: CodexApprovalRequest, ask: Omit<PermissionAsk, 'signal'>, approval: SessionApproval, mode: Exclude<AutoApprovalMode, 'off'>): void {
    this.approvals.set(request.id, new AbortController())
    const { request: judged, cwd, grantRoot } = policyRequestOf(request, ask)
    const where = { cwd: judged.tool === 'fileChange' ? this.opts.cwd : cwd, scratchpad: null, ...(this.processEnv === null ? {} : { env: this.processEnv }) }
    const failed: Decision = { outcome: 'deny', rule: 'policy-failed', hint: null, targets: [] }
    void approval
      .judge(judged, where)
      .catch(() => failed)
      .then((decision) => {
        const final = withGrantRoot(decision, grantRoot)
        const answered = mode === 'on' && final.outcome === 'allow' ? 'accept' : 'decline'
        // Codex withdrew the request, or the turn was interrupted: the agent got no decision, nothing is reported.
        if (!this.answer(request.id, answered)) return
        // A file change's input has no command: its line names none.
        const command = (ask.input as Record<string, unknown>)['command']
        approval.decided({
          mode,
          outcome: mode === 'shadow' ? SHADOW_OUTCOME[final.outcome] : final.outcome,
          rule: final.rule,
          tool: judged.tool,
          targets: [...final.targets],
          command: typeof command === 'string' ? command : null,
          ...(ask.description === null ? {} : { reason: ask.description }),
        })
      })
  }

  /** Answers an approval still open; one Codex withdrew or worfy already answered gets nothing more. Whether it answered. */
  private answer(id: RequestId, decision: CodexDecision): boolean {
    if (!this.approvals.delete(id)) return false
    this.server?.respond(id, { decision })
    return true
  }

  /** Codex resolved a request itself: the Session's request is withdrawn, and worfy answers nothing. */
  private withdraw(id: RequestId): void {
    const controller = this.approvals.get(id)
    if (controller === undefined) return
    this.approvals.delete(id)
    controller.abort()
  }

  /** Answers `cancel` to every open approval at once, then withdraws the Session's requests. */
  private cancelApprovals(): void {
    const open = [...this.approvals]
    this.approvals.clear()
    for (const [id] of open) this.server?.respond(id, { decision: 'cancel' })
    for (const [, controller] of open) controller.abort()
  }

  /** The process is gone: the events end with how it ended. */
  private finish(error: Error): void {
    if (this.done) return
    this.done = true
    for (const controller of this.approvals.values()) controller.abort()
    this.approvals.clear()
    this.out.fail(error)
  }
}

/** Starts the app-server, then its thread; a failure on the way closes the process and rejects. */
async function open(options: CodexServerOptions, opts: SessionStart, resume: string | undefined): Promise<SessionHandle> {
  const preset = codexPresetFor(opts.settings.permissionMode)
  if (preset === undefined) throw new Error(`${opts.settings.permissionMode} is no permission preset of Codex`)
  const session = new CodexSession(opts, preset.id, options.limits)
  const { CodexAppServer, OUTPUT_AFTER_EXIT_MS } = await import('./app-server')
  const spawnProcess = options.spawnProcess ?? spawn
  // The servers' token goes to the process through its environment only (mcp.ts, MCP_TOKEN_ENV).
  const mcp = (await options.mcp?.({ cwd: opts.cwd, resume, unattended: opts.unattended })) ?? null
  let token: string | null = null
  try {
    token = (await options.ghToken?.(opts.cwd)) ?? null
  } catch (error) {
    // The reason names the account, never a token (accountAuth); the Session starts without one.
    options.log?.(`[codex] no GH_TOKEN for the Session: ${messageOf(error)}`)
  }
  const tokenEnv = withGhToken(options.env ?? process.env, token)
  // The run's TMPDIR and git environment of an unattended Session at Shadow or On (worfy-auto-approve tickets 04, 05);
  // without them, in Off, the environment as before.
  const env = opts.environment === undefined ? tokenEnv : { ...tokenEnv, ...opts.environment }
  /** What the process was spawned with: the approval policy judges each request in it. */
  let processEnv: NodeJS.ProcessEnv | null = null
  let server: CodexAppServer
  try {
    server = await CodexAppServer.start({
      runtime: options.runtime,
      appPath: options.appPath,
      cwd: opts.cwd,
      clientVersion: options.clientVersion,
      env: mcp === null ? env : mcp.env(env),
      timeoutMs: options.timeoutMs,
      log: options.log,
      onEvent: (event) => session.receive(event),
      spawnProcess: (file, args, spawnOptions) => {
        processEnv = spawnOptions.env ?? process.env
        const child = spawnProcess(file, args, spawnOptions)
        opts.spawned(child)
        child.stderr?.on('data', (chunk: unknown) => opts.stderr(String(chunk)))
        return child
      },
    })
  } catch (error) {
    mcp?.close()
    throw startError(error)
  }
  // The token lives as long as the process: it ends when the process exits, or when the handle closes.
  if (mcp !== null) server.process.once('exit', () => mcp.close())
  session.started(server, processEnv)
  try {
    const params = {
      cwd: opts.cwd,
      approvalPolicy: preset.approvalPolicy,
      sandbox: preset.sandbox,
      ...(opts.settings.model === null ? {} : { model: opts.settings.model }),
      ...(mcp === null ? {} : { config: mcp.config, developerInstructions: mcp.developerInstructions }),
    }
    const response =
      resume === undefined
        ? await server.request<ThreadStartResponse, 'thread/start'>('thread/start', params)
        : await server.request<ThreadStartResponse, 'thread/resume'>('thread/resume', { threadId: resume, ...params })
    session.attach(response, OUTPUT_AFTER_EXIT_MS)
  } catch (error) {
    session.close()
    mcp?.close()
    await server.close()
    throw startError(error)
  }
  return mcp === null ? session : mcp.observe(session)
}

/** The session part of the Codex driver over the app-server `options` give: the app's (codexSession), or a test's. */
export function codexSessions(options: () => Promise<CodexServerOptions>): SessionPart {
  return {
    start: async (opts) => open(await options(), opts, undefined),
    resume: async (id, opts) => open(await options(), opts, id),
    settingsFor: codexSettings,
  }
}

/**
 * The app's app-server: the pinned Codex of this build, or the fake under WORFY_CODEX=fake; a Session's
 * windows go to the app's LimitsTracker, worfy's MCP servers come from appCodexMcp.
 */
export async function appServerOptions(): Promise<CodexServerOptions> {
  const [{ app }, { appLimits }] = await Promise.all([import('electron'), import('../../agent/limits')])
  return {
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    appPath: app.getAppPath(),
    clientVersion: app.getVersion(),
    limits: (windows) => appLimits().setWindows(CODEX_VENDOR, windows),
    mcp: appCodexMcp,
    ghToken: appGhToken,
  }
}

/**
 * GH_TOKEN of the Profile's GitHub account for a Session at `cwd`, as the PR tracker takes it
 * (src/main/ipc/checks.ts, appPrOptions): gh with the login shell's environment, or WORFY_GH with
 * worfy's own, and `bin/profile` with the Harness scripts' environment.
 */
async function appGhToken(cwd: string): Promise<string | null> {
  const [{ agentEnv }, { accountAuth, ghRunner }, { readGithubAccount }, { harnessScriptEnv }, { claudeHome }] = await Promise.all([
    import('../../agent/env'),
    import('../../github/prs'),
    import('../../workflow/profile'),
    import('../../harness/script-env'),
    import('../../storage/paths'),
  ])
  const stub = process.env.WORFY_GH
  const run = ghRunner({ command: stub || undefined, env: stub ? () => Promise.resolve(process.env) : async () => (await agentEnv()).env })
  const account = async (root: string): Promise<string | null> => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account
  return (await accountAuth({ account, run })(cwd)).GH_TOKEN ?? null
}

export const codexSession: SessionPart = codexSessions(appServerOptions)
