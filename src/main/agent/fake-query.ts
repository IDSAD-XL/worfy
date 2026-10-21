// The fake agent (WORFY_AGENT=fake): instead of starting Claude Code, a Session plays a script
// from test/fixtures/agent-scripts/<name>.jsonl. Tests and e2e runs never call the real model.
//
// Each line of a script is either an SDK message, yielded as is, or a directive:
//   {"fake":"account","info":{...}}  what accountInfo() answers (first line only; default: a subscription login)
//   {"fake":"account","error":"..."} accountInfo() rejects with this message (first line only)
//   {"fake":"models","models":[...]} what supportedModels() answers (a head line; default: FAKE_MODELS)
//   {"fake":"commands","commands":[...]} what supportedCommands() answers: rows of {name, description,
//                                    argumentHint} (a head line; default: the slash_commands of the
//                                    script's first system/init, without descriptions)
//   {"fake":"wait_message"}          wait for the next user message (the turn starts)
//   {"fake":"wait_interrupt"}        wait until interrupt() is called
//   {"fake":"wait_release","name":"tasks"} wait until a test releases `name` (FakeReleases.release:
//                                    each release lets one such wait pass, also one made earlier);
//                                    the script stands, as Claude Code does while its background
//                                    tasks run (worfy-daily ticket 29)
//   {"fake":"stderr","text":"..."}   Claude Code writes this to its stderr
//   {"fake":"context","usage":{...}} what getContextUsage() answers from here on: an object of the
//                                    SDK's shape (totalTokens, rawMaxTokens, percentage,
//                                    autoCompactThreshold, isAutoCompactEnabled, …; worfy-polish
//                                    ticket 23). Before any such line getContextUsage() rejects, as
//                                    a Claude Code with no usage to report
//   {"fake":"context","error":"..."} getContextUsage() rejects with this message from here on
//   {"fake":"crash","error":"..."}   Claude Code dies: the message iterator throws
//   {"fake":"exit"}                  Claude Code exits quietly: the message iterator ends
//   {"fake":"permission","toolName":"Bash","toolUseId":"toolu_…","input":{...},"suggestions":[...]}
//                                    the model calls a tool (ticket 21): an assistant tool_use, then —
//                                    unless the mode is bypassPermissions — canUseTool of the request
//                                    with these suggestions, waiting for the answer; then the tool's
//                                    result: what it "ran", or the refusal as an error. Interrupt and
//                                    close abort the request's signal, as Claude Code does — unless
//                                    "keepSignal":true: then only worfy's own refusal ends the request.
//                                    With "crash":"..." Claude Code dies while the request is open
//                                    (the message iterator throws; the signal is never aborted).
//                                    An answer's `updatedPermissions` are applied as Claude Code would:
//                                    localSettings / projectSettings write <cwd>/.claude/settings.local.json
//                                    / settings.json, userSettings writes <settingsHome>/settings.json
//                                    (FakeQueryOptions; not applied without it).
//                                    "decisionReason" and "agentID" go to canUseTool as Claude Code
//                                    gives them: why it asks, which Subagent asks. With
//                                    "bypassImmune":true it asks in bypassPermissions too, as Claude
//                                    Code does for a few of its own checks (dangerousRemoval)
//   {"fake":"question","toolUseId":"toolu_…","questions":[...]}
//                                    the model asks the user questions with answer options (Claude
//                                    Code's AskUserQuestion, worfy-ui ticket 17): a `permission` line
//                                    of that tool with input {questions}, asked in every mode,
//                                    bypassPermissions included, with requiresUserInteraction, as
//                                    Claude Code does. Its result is the text Claude Code gives the
//                                    model for the answer (questionResultText), recorded from the real
//                                    binary in test/contract/ask-user-question-sdk.test.ts
// In SDK messages, "{{session}}" becomes the SDK session id (the id passed as `resume`, else the one
// passed as `sessionId`, else a new uuid), "{{cwd}}" the Session's cwd and "{{home}}" the user's
// home folder (os.homedir()). After the last line the
// script starts over, so one script serves any number of turns; it ends when the Session closes its
// input.
//
// With `registryHome` (FakeQueryOptions) the fake agent registers itself as Claude Code does as
// soon as it starts, before any system/init (worfy-daily ticket 24): <registryHome>/sessions/<n>.json
// with that session id, its cwd and `entrypoint: "sdk-ts"`, removed when the query ends or closes.
// The entry's pid is the process the fake agent runs in, so the registry finds it alive; `n` is a
// number of its own per query, as each Claude Code process has its own pid. Without the option it
// writes nothing.
//
// Head lines (account, models, commands) configure the fake agent and are not played; they may
// stand anywhere, the first of each kind counts. A new directive is one entry in DIRECTIVES and,
// for a head line, one field of FakeConfig.
//
// The fake agent reads the Session's input as soon as a message arrives, as Claude Code does, and
// reports what it gets to `record` (FakeQueryOptions): each user message whole — its text, and its
// content as Claude Code got it, image blocks included (ticket 20) —, each control call
// (setModel, setPermissionMode, applyFlagSettings for effort) and the settings it started with.
// getContextUsage() is a read, not a control call, and is not recorded.
// After setModel or setPermissionMode, its system/init messages carry the new model and mode, as
// Claude Code's next turn does (ticket 06, question 6). Effort is not in system/init, here as in
// Claude Code. Each answer canUseTool gave is recorded with the tool and its input. close() while
// background tasks live — by the last system/background_tasks_changed the fake agent played, not
// counting ambient ones — is recorded with their ids: Claude Code would kill them (ticket 29).
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ASK_USER_QUESTION } from '../../shared/agent/questions'
import type { SessionSettings } from '../../shared/agent/settings'
import type { CommandInfoLike } from './commands'
import type { PermissionAnswer, PermissionRequestOptions } from './permissions'
import type { AccountInfoLike, ModelInfoLike, QueryFactory, QueryHandle, QueryRequest } from './session'
import { removeFile } from '../storage/remove'

/** What the fake agent was asked to do, in the order it happened. */
export type FakeCall =
  /** `orchestrator`: present, and true, only for the Session of a Project's Orchestrator (QueryRequest.orchestrator). */
  | { kind: 'start'; resume: string | null; settings: SessionSettings; orchestrator?: true }
  /** `text`: the message's text blocks; `content`: the message content as sent, image blocks included. */
  | { kind: 'message'; text: string; content: unknown }
  | { kind: 'setModel'; model: string | null }
  | { kind: 'setPermissionMode'; mode: string }
  | { kind: 'applyFlagSettings'; settings: Record<string, unknown> }
  /** What canUseTool answered for a tool call of a `permission` line. */
  | { kind: 'permission'; toolName: string; input: Record<string, unknown>; result: PermissionAnswer }
  /** close() while background tasks lived: Claude Code would have killed these (task ids). */
  | { kind: 'close'; backgroundTasks: string[] }

/** supportedModels() of the fake agent: the shape of SDK 0.3.289, extra keys included. */
export const FAKE_MODELS: ModelInfoLike[] = [
  { value: 'default', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'haiku', displayName: 'Haiku', supportsEffort: false },
].map((model) => ({ ...model, description: `${model.displayName} (fake)`, resolvedModel: `claude-${model.value}-fake` }))

const SUBSCRIPTION: AccountInfoLike = { apiProvider: 'firstParty', subscriptionType: 'Claude Max', tokenSource: 'claude.ai' }

type Account = { info: AccountInfoLike } | { error: string }

/** What getContextUsage() answers: the usage as the SDK gives it, or a rejection. */
type ContextAnswer = { usage: unknown } | { error: string }

/** What the head lines of a script set; absent fields keep the defaults. */
interface FakeConfig {
  account?: Account
  models?: ModelInfoLike[]
  commands?: CommandInfoLike[]
}

/** A line the fake agent plays, in order. */
type Step =
  | { kind: 'message'; message: unknown }
  | { kind: 'wait_message' }
  | { kind: 'wait_interrupt' }
  | { kind: 'wait_release'; name: string }
  | { kind: 'stderr'; text: string }
  | { kind: 'context'; answer: ContextAnswer }
  | { kind: 'crash'; error: string }
  | { kind: 'exit' }
  | {
      kind: 'permission'
      toolName: string
      toolUseId: string
      input: Record<string, unknown>
      suggestions: unknown[]
      /** Interrupt and close leave the request's signal alone. */
      keepSignal: boolean
      /** Claude Code dies with this error while the request is open. */
      crash: string | null
      /** Asked in bypassPermissions too. */
      bypassImmune: boolean
      /** canUseTool's decisionReason and agentID; null: not given. */
      decisionReason: string | null
      agentID: string | null
    }

type Line = Step | { kind: 'config'; config: FakeConfig }

/** Each directive of a script (`{"fake": <name>, ...}`) and the line it makes. */
const DIRECTIVES: Record<string, (value: Record<string, unknown>) => Line> = {
  wait_message: () => ({ kind: 'wait_message' }),
  wait_interrupt: () => ({ kind: 'wait_interrupt' }),
  wait_release: (value) => ({ kind: 'wait_release', name: String(value.name ?? '') }),
  stderr: (value) => ({ kind: 'stderr', text: String(value.text ?? '') }),
  context: (value) => ({ kind: 'context', answer: typeof value.error === 'string' ? { error: value.error } : { usage: value.usage } }),
  crash: (value) => ({ kind: 'crash', error: String(value.error ?? 'Claude Code crashed') }),
  exit: () => ({ kind: 'exit' }),
  permission: (value) => ({
    kind: 'permission',
    toolName: String(value.toolName ?? 'Bash'),
    toolUseId: String(value.toolUseId ?? 'toolu_fake'),
    input: typeof value.input === 'object' && value.input !== null ? (value.input as Record<string, unknown>) : {},
    suggestions: Array.isArray(value.suggestions) ? (value.suggestions as unknown[]) : [],
    keepSignal: value.keepSignal === true,
    crash: typeof value.crash === 'string' ? value.crash : null,
    bypassImmune: value.bypassImmune === true,
    decisionReason: typeof value.decisionReason === 'string' ? value.decisionReason : null,
    agentID: typeof value.agentID === 'string' ? value.agentID : null,
  }),
  question: (value) => ({
    kind: 'permission',
    toolName: ASK_USER_QUESTION,
    toolUseId: String(value.toolUseId ?? 'toolu_fake_question'),
    input: { questions: Array.isArray(value.questions) ? (value.questions as unknown[]) : [] },
    suggestions: [],
    keepSignal: false,
    crash: null,
    bypassImmune: true,
    decisionReason: null,
    agentID: null,
  }),
  account: (value) => ({ kind: 'config', config: { account: typeof value.error === 'string' ? { error: value.error } : { info: value.info as AccountInfoLike } } }),
  models: (value) => ({ kind: 'config', config: { models: value.models as ModelInfoLike[] } }),
  commands: (value) => ({ kind: 'config', config: { commands: value.commands as CommandInfoLike[] } }),
}

function parseScript(path: string, session: string, cwd: string): Line[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((text, index): Line => {
      const value = JSON.parse(
        text
          .replaceAll('{{session}}', session)
          .replaceAll('{{cwd}}', JSON.stringify(cwd).slice(1, -1))
          .replaceAll('{{home}}', JSON.stringify(homedir()).slice(1, -1)),
      ) as Record<string, unknown>
      if (value.fake === undefined) return { kind: 'message', message: value }
      const directive = typeof value.fake === 'string' && Object.hasOwn(DIRECTIVES, value.fake) ? DIRECTIVES[value.fake] : undefined
      if (directive === undefined) throw new Error(`${path}:${index + 1}: unknown directive ${JSON.stringify(value.fake)}`)
      return directive(value)
    })
}

/** The head lines of a script, the first of each kind winning. */
function configOf(lines: readonly Line[]): FakeConfig {
  const config: FakeConfig = {}
  for (const line of lines) {
    if (line.kind !== 'config') continue
    for (const [key, value] of Object.entries(line.config) as [keyof FakeConfig, FakeConfig[keyof FakeConfig]][]) {
      if (config[key] === undefined) Object.assign(config, { [key]: value })
    }
  }
  return config
}

const contentOf = (message: unknown): unknown => (message as { message?: { content?: unknown } }).message?.content

/** The text of a user message: the content when it is a string, else its text blocks. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  return content
    .flatMap((block) => (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text' ? [String((block as { text?: unknown }).text ?? '')] : []))
    .join('\n\n')
}

/**
 * What a test lets through the `wait_release` lines of fake scripts. A release made before the wait
 * is kept: each one lets one wait of its name pass.
 */
export class FakeReleases {
  private readonly pending = new Map<string, number>()
  private readonly waiters = new Map<string, (() => void)[]>()

  release(name: string): void {
    const waiting = this.waiters.get(name)
    const next = waiting?.shift()
    if (next !== undefined) {
      next()
      return
    }
    this.pending.set(name, (this.pending.get(name) ?? 0) + 1)
  }

  /** Settles once `name` is released, or at once for a release made earlier; `cancel` gives up. */
  wait(name: string, cancel: { onCancel(stop: () => void): void }): Promise<void> {
    const kept = this.pending.get(name) ?? 0
    if (kept > 0) {
      this.pending.set(name, kept - 1)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(name) ?? []
      list.push(resolve)
      this.waiters.set(name, list)
      cancel.onCancel(() => {
        const at = list.indexOf(resolve)
        if (at >= 0) list.splice(at, 1)
        resolve()
      })
    })
  }
}

/** The ids of the live, not ambient tasks of a system/background_tasks_changed message; null for any other message. */
function liveTaskIds(message: unknown): string[] | null {
  const value = message as { type?: unknown; subtype?: unknown; tasks?: unknown }
  if (value?.type !== 'system' || value.subtype !== 'background_tasks_changed' || !Array.isArray(value.tasks)) return null
  return (value.tasks as { task_id?: unknown; ambient?: unknown }[]).filter((task) => task.ambient !== true).map((task) => String(task.task_id))
}

/** Registry entries written by fake queries of this process; numbers their files. */
let registered = 0

/**
 * Writes the registry entry of a fake Claude Code that has just started, as the real one writes
 * ~/.claude/sessions/<pid>.json (src/main/claude-home/registry.ts reads it): the file's path.
 */
function register(home: string, sessionId: string, cwd: string): string {
  const dir = join(home, 'sessions')
  mkdirSync(dir, { recursive: true })
  registered += 1
  const file = join(dir, `${process.pid}${String(registered).padStart(4, '0')}.json`)
  const entry = { pid: process.pid, sessionId, cwd, entrypoint: 'sdk-ts', kind: 'sdk', name: `auto-${sessionId.slice(0, 8)}`, startedAt: Date.now() }
  writeFileSync(file, JSON.stringify(entry))
  return file
}

const isInit = (message: unknown): message is Record<string, unknown> =>
  typeof message === 'object' && message !== null && (message as Record<string, unknown>).type === 'system' && (message as Record<string, unknown>).subtype === 'init'

/** The commands of the script's first system/init, as Claude Code knows them before the first turn. */
function initCommands(steps: readonly Step[]): CommandInfoLike[] {
  const init = steps.find((step) => step.kind === 'message' && isInit(step.message))
  const names = init?.kind === 'message' && isInit(init.message) ? init.message.slash_commands : undefined
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string').map((name) => ({ name, description: '', argumentHint: '' })) : []
}

class FakeQuery implements QueryHandle {
  private closed = false
  private interruptRequested = false
  private wakeInterrupt: (() => void) | null = null
  /** Ends a wait_release line that close() cut short. */
  private cancelRelease: (() => void) | null = null
  /** The background tasks the last background_tasks_changed played left alive. */
  private liveTasks: string[] = []
  private readonly steps: Step[]
  private readonly account: Account
  private readonly models: ModelInfoLike[]
  private readonly commands: CommandInfoLike[]
  /** User messages read from the input and not yet taken by a wait_message line. */
  private readonly inbox: unknown[] = []
  private inputEnded = false
  private wakeInbox: (() => void) | null = null
  private reading = false
  private model: string | null
  private permissionMode: string
  /** The SDK session id the messages carry. */
  private readonly session: string
  /** Signals of the permission requests now open; Interrupt and close abort them. */
  private readonly requests = new Set<AbortController>()
  /** The file of this query's entry in the registry of live Sessions, while it stands there. */
  private registryEntry: string | null
  /** What getContextUsage() answers, set by the last `context` line played. */
  private context: ContextAnswer = { error: 'the fake agent has no context usage to report' }

  constructor(
    path: string,
    private readonly request: QueryRequest,
    private readonly record: (call: FakeCall) => void,
    private readonly settingsHome: string | null,
    private readonly releases: FakeReleases,
    registryHome: string | null,
  ) {
    this.session = request.resume ?? request.sessionId ?? randomUUID()
    this.registryEntry = registryHome === null ? null : register(registryHome, this.session, request.cwd)
    const lines = parseScript(path, this.session, request.cwd)
    this.steps = lines.filter((line): line is Step => line.kind !== 'config')
    const config = configOf(lines)
    this.account = config.account ?? { info: SUBSCRIPTION }
    this.models = config.models ?? FAKE_MODELS
    this.commands = config.commands ?? initCommands(this.steps)
    this.model = request.settings.model
    this.permissionMode = request.settings.permissionMode
    record({ kind: 'start', resume: request.resume ?? null, settings: { ...request.settings }, ...(request.orchestrator === true ? { orchestrator: true as const } : {}) })
  }

  accountInfo(): Promise<AccountInfoLike> {
    return 'error' in this.account ? Promise.reject(new Error(this.account.error)) : Promise.resolve(this.account.info)
  }

  setModel(model?: string): Promise<void> {
    this.model = model ?? null
    this.record({ kind: 'setModel', model: model ?? null })
    return Promise.resolve()
  }

  setPermissionMode(mode: string): Promise<void> {
    this.permissionMode = mode
    this.record({ kind: 'setPermissionMode', mode })
    return Promise.resolve()
  }

  applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    this.record({ kind: 'applyFlagSettings', settings: { ...settings } })
    return Promise.resolve()
  }

  supportedModels(): Promise<ModelInfoLike[]> {
    return Promise.resolve(this.models.map((model) => ({ ...model })))
  }

  supportedCommands(): Promise<CommandInfoLike[]> {
    return Promise.resolve(this.commands.map((command) => ({ ...command })))
  }

  /** Answers what the last `context` line set, as it stood when called. */
  getContextUsage(): Promise<unknown> {
    const answer = this.context
    return 'error' in answer ? Promise.reject(new Error(answer.error)) : Promise.resolve(structuredClone(answer.usage))
  }

  /** Reads the Session's input as messages arrive, like Claude Code reading its stdin. */
  private readInput(): void {
    if (this.reading) return
    this.reading = true
    void (async () => {
      try {
        for await (const message of this.request.prompt) {
          const content = contentOf(message)
          this.record({ kind: 'message', text: textOf(content), content })
          this.inbox.push(message)
          this.wake()
        }
      } finally {
        this.inputEnded = true
        this.wake()
      }
    })()
  }

  private wake(): void {
    const resolve = this.wakeInbox
    this.wakeInbox = null
    resolve?.()
  }

  /** Waits for the next user message; false when the input ended or the query closed first. */
  private async nextMessage(): Promise<boolean> {
    while (this.inbox.length === 0) {
      if (this.inputEnded || this.closed) return false
      await new Promise<void>((resolve) => {
        this.wakeInbox = resolve
      })
    }
    this.inbox.shift()
    return !this.closed
  }

  /** A system/init as Claude Code would send it after setModel / setPermissionMode. */
  private current(message: unknown): unknown {
    if (!isInit(message)) return message
    return { ...message, ...(this.model !== null ? { model: this.model } : {}), permissionMode: this.permissionMode }
  }

  /**
   * A tool call of a `permission` line: what canUseTool answered, or null in bypassPermissions,
   * where nothing is asked unless the line is `bypassImmune`.
   */
  private async ask(line: Extract<Step, { kind: 'permission' }>): Promise<PermissionAnswer | null> {
    if (this.permissionMode === 'bypassPermissions' && !line.bypassImmune) return null
    const controller = new AbortController()
    if (!line.keepSignal && line.crash === null) this.requests.add(controller)
    const description = typeof line.input.description === 'string' ? line.input.description : undefined
    const options: PermissionRequestOptions = {
      signal: controller.signal,
      suggestions: line.suggestions,
      toolUseID: line.toolUseId,
      description,
      ...(line.decisionReason === null ? {} : { decisionReason: line.decisionReason }),
      ...(line.agentID === null ? {} : { agentID: line.agentID }),
      ...(line.toolName === ASK_USER_QUESTION ? { requiresUserInteraction: true } : {}),
    }
    const answer = this.request
      .canUseTool(line.toolName, { ...line.input }, options)
      .then((result) => {
        this.record({ kind: 'permission', toolName: line.toolName, input: { ...line.input }, result: { ...result } })
        this.applyUpdates(result)
        return result
      })
      .finally(() => this.requests.delete(controller))
    if (line.crash !== null) {
      // The answer still comes (from worfy's own refusal) and is recorded; nobody reads it.
      void answer.catch(() => undefined)
      throw new Error(line.crash)
    }
    return answer
  }

  /** Writes an answer's `updatedPermissions` to the settings files they name, as Claude Code does. */
  private applyUpdates(result: PermissionAnswer): void {
    const updates = (result as { updatedPermissions?: unknown }).updatedPermissions
    if (!Array.isArray(updates)) return
    for (const update of updates as unknown[]) {
      const destination = typeof update === 'object' && update !== null ? (update as { destination?: unknown }).destination : undefined
      const file =
        destination === 'localSettings'
          ? join(this.request.cwd, '.claude', 'settings.local.json')
          : destination === 'projectSettings'
            ? join(this.request.cwd, '.claude', 'settings.json')
            : destination === 'userSettings' && this.settingsHome !== null
              ? join(this.settingsHome, 'settings.json')
              : null
      if (file === null) continue
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, `${JSON.stringify({ fakeUpdatedPermissions: [update] }, null, 2)}\n`)
    }
  }

  private abortRequests(): void {
    for (const controller of this.requests) controller.abort()
  }

  /** The assistant message that calls the tool of a `permission` line. */
  private toolUse(line: Extract<Step, { kind: 'permission' }>): unknown {
    return {
      type: 'assistant',
      message: { id: `msg_${line.toolUseId}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: line.toolUseId, name: line.toolName, input: line.input }], stop_reason: null },
      parent_tool_use_id: null,
      session_id: this.session,
      uuid: randomUUID(),
    }
  }

  /** The tool's result as Claude Code reports it to the model: what ran, or the refusal. */
  private toolResult(line: Extract<Step, { kind: 'permission' }>, answer: PermissionAnswer | null): unknown {
    const command = typeof line.input.command === 'string' ? line.input.command : JSON.stringify(line.input)
    const refused = answer?.behavior === 'deny'
    const ran = line.toolName === ASK_USER_QUESTION ? questionResultText(line.input, answer) : `(fake) ${line.toolName} ran: ${command}`
    return {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: line.toolUseId, content: refused ? answer.message : ran, is_error: refused }] },
      parent_tool_use_id: null,
      session_id: this.session,
      uuid: randomUUID(),
    }
  }

  interrupt(): Promise<unknown> {
    this.interruptRequested = true
    this.abortRequests()
    this.wakeInterrupt?.()
    return Promise.resolve({ still_queued: [] })
  }

  close(): void {
    if (!this.closed && this.liveTasks.length > 0) this.record({ kind: 'close', backgroundTasks: [...this.liveTasks] })
    this.closed = true
    this.cancelRelease?.()
    this.abortRequests()
    this.wakeInterrupt?.()
    this.wake()
    this.unregister()
  }

  /** Claude Code's entry leaves the registry with its process. */
  private unregister(): void {
    const file = this.registryEntry
    this.registryEntry = null
    if (file !== null) removeFile(file)
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    try {
      yield* this.play()
    } finally {
      // The process ended: by exit, crash or close.
      this.unregister()
    }
  }

  private async *play(): AsyncGenerator<unknown> {
    this.readInput()
    const body = this.steps
    if (body.length === 0) return
    for (;;) {
      for (const line of body) {
        if (this.closed) return
        switch (line.kind) {
          case 'message':
            // Lets the consumer react between messages, as a real stream would.
            await Promise.resolve()
            this.liveTasks = liveTaskIds(line.message) ?? this.liveTasks
            yield this.current(line.message)
            break
          case 'wait_message':
            if (!(await this.nextMessage())) return
            break
          case 'wait_interrupt':
            if (!this.interruptRequested) {
              await new Promise<void>((resolve) => {
                this.wakeInterrupt = resolve
              })
              this.wakeInterrupt = null
            }
            this.interruptRequested = false
            break
          case 'wait_release':
            await this.releases.wait(line.name, {
              onCancel: (stop) => {
                this.cancelRelease = stop
              },
            })
            this.cancelRelease = null
            break
          case 'stderr':
            this.request.stderr(line.text)
            break
          case 'context':
            this.context = line.answer
            break
          case 'crash':
            throw new Error(line.error)
          case 'exit':
            return
          case 'permission': {
            await Promise.resolve()
            yield this.toolUse(line)
            const answer = await this.ask(line)
            if (this.closed) return
            yield this.toolResult(line, answer)
            break
          }
        }
      }
    }
  }
}

/**
 * What Claude Code tells the model for an allowed AskUserQuestion call, as its binary (SDK 0.3.289)
 * does: no `answers` — the user did not answer; every answer one of its question's labels (a
 * multiSelect answer split at ", ") — "have been answered"; any other text — the user's own words.
 */
export function questionResultText(input: Record<string, unknown>, answer: PermissionAnswer | null): string {
  const given = answer?.behavior === 'allow' ? answer.updatedInput.answers : undefined
  const answers = typeof given === 'object' && given !== null ? Object.entries(given as Record<string, unknown>).filter((each): each is [string, string] => typeof each[1] === 'string') : []
  if (answers.length === 0) return 'The user did not answer the questions.'
  const questions = Array.isArray(input.questions) ? (input.questions as { question?: unknown; multiSelect?: unknown; options?: { label?: unknown }[] }[]) : []
  const picked = answers.every(([text, value]) => {
    const question = questions.find((each) => each.question === text)
    const labels = (question?.options ?? []).map((option) => option.label)
    return (question?.multiSelect === true ? value.split(', ') : [value]).every((part) => labels.includes(part))
  })
  const said = answers.map(([text, value]) => `"${text}"="${value}"`).join(', ')
  return picked
    ? `Your questions have been answered: ${said}. You can now continue with these answers in mind.`
    : `The user answered: ${said}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`
}

export interface FakeQueryOptions {
  scriptsDir: string
  /** The script to play for a request; a test may pick one per Session or per resume. */
  script: string | ((request: QueryRequest) => string)
  /** Gets what every fake query was asked to do (FakeCall). */
  record?: ((call: FakeCall) => void) | undefined
  /**
   * Stands for ~/.claude when an answer's `updatedPermissions` write `userSettings`; without it
   * such an update is not applied, so a fake run never writes the real ~/.claude.
   */
  settingsHome?: string | undefined
  /**
   * What lets the `wait_release` lines pass. Without it the factory makes its own and puts its
   * `release` on `globalThis.worfyFakeRelease`, where an e2e test reaches it (app.evaluate).
   */
  releases?: FakeReleases | undefined
  /**
   * Stands for ~/.claude when the fake agent registers itself in <registryHome>/sessions, as Claude
   * Code does before system/init; without it nothing is written.
   */
  registryHome?: string | undefined
}

export function fakeQueryFactory(options: FakeQueryOptions): QueryFactory {
  const record = options.record ?? (() => {})
  let releases = options.releases
  if (releases === undefined) {
    const own = new FakeReleases()
    releases = own
    ;(globalThis as { worfyFakeRelease?: (name: string) => void }).worfyFakeRelease = (name) => own.release(name)
  }
  const shared = releases
  return (request) => {
    const name = typeof options.script === 'string' ? options.script : options.script(request)
    return Promise.resolve(new FakeQuery(join(options.scriptsDir, `${name}.jsonl`), request, record, options.settingsHome ?? null, shared, options.registryHome ?? null))
  }
}
