// Sessions in main: each one is a single long-running SDK query() whose input is an async queue.
// User messages are pushed into it one by one; the query is not recreated between turns.
//
// A Session turns every SDK message into worfy's events (src/shared/agent/events.ts) and keeps
// its state: `busy` from a send until the turn's `result`, which comes once per turn even when
// the user's Stop hook continues the turn (ticket 06, question 2). A `system/init` while idle is
// the start of a queued turn and makes the Session busy again. When Claude Code dies, the Session
// goes to `error`; the next send starts a new query that resumes the same SDK session.
//
// A new Session names its SDK session itself (worfy-daily ticket 24): its id is a new uuid, passed
// to Claude Code as `sessionId`, so the id is known before system/init. Claude Code writes that id
// to ~/.claude/sessions/<pid>.json as soon as it starts; worfy then already knows the entry as its
// own and makes no read-only Node for it. A resumed Session keeps a temporary `pending-…` id until
// system/init, as Claude Code may report another id there; a Claude Code process started after
// one that died before its first turn gets a new uuid, so no two processes are given one id.
//
// A message sent while a turn runs waits in the Session's queue (queue.ts) and goes after the
// turn's `result`, one per turn (ticket 19); Interrupt and a crash hold the queue until "Send
// queued". The model, effort and permission mode (src/shared/agent/settings.ts) are applied to
// the live query through its control calls and passed to every query started later.
//
// A message may carry attachments (ticket 20, attachments.ts): images go as image blocks, other
// files as paths at the end of the text. The slash menu's commands come from the live query and
// the last system/init (commands.ts).
//
// Outside bypassPermissions Claude Code asks before tools (ticket 21): the Session's own
// PermissionGate (permissions.ts) answers canUseTool from the user's choice, and the Session is
// `needs_permission` while a request is open. Interrupt, close and a crash refuse open requests.
//
// A Session launched unattended (Autopilot, worfy-daily ticket 02, session-settings.ts) never waits
// for a person: it runs in bypassPermissions, refuses a change of mode, refuses canUseTool at once,
// and each refusal reaches its subscribers as a `refused_dialog` event.
//
// Stop in Autopilot halts the Orchestrator's Session before the Orchestrator is given back
// (halt(), worfy-week ticket 17, ADR-0050): the queue is held, open requests are refused, and a
// running turn is interrupted and waited for, HALT_TURN_MS at most. From then on the Session sends
// nothing more into its process: what a person queues stays held, for the Session that replaces it.
//
// A Session knows when its Claude Code process has exited (worfy-week ticket 20, ADR-0064): the
// query factory tells it of each process it starts (QueryRequest.spawned), and exited() settles once
// none is left, killing with SIGKILL one that outlives EXIT_WAIT_MS. A Session may also be started
// with its process held back until a promise settles (start(after)): the Orchestrator's relaunch
// starts the new process only once the old one is gone, so two processes never write one transcript.
// Until then the Session is `starting`, and what is sent to it waits in its queue.
//
// A Session runs on sonnet or a larger model, never on haiku (worfy-daily ticket 07,
// isSelectableModel): the model list leaves haiku out, a saved haiku goes back to the default model,
// and when the default model would be a haiku from the user's settings.json (user-model.ts) the
// query is started on sonnet instead. The Session's own settings keep `model: null` then.
//
// `null` — "Default" in the pickers — is the user's own model and effort from settings.json
// (worfy-daily ticket 23): going back to it on a live query calls setModel with that model and
// applyFlagSettings with that effort, and a new query that names no effort is asked for the user's.
// Only the calls change: the Session's settings keep `null`, so its header shows "no pick".
import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { messageLabel, type Attachment } from '../../shared/agent/attachments'
import { emptyTaskFold, foldTaskEvent, isTaskEvent, liveTasks, sameTasks, type BackgroundTask, type TaskFold } from '../../shared/agent/background-tasks'
import type { SlashCommand } from '../../shared/agent/commands'
import { isMainOnlyEvent, sdkMessageToEvents, type AgentEvent, type PermissionDecision, type QueueSnapshot, type SessionState } from '../../shared/agent/events'
import {
  DEFAULT_SETTINGS,
  EFFORT_LEVELS,
  isSelectableModel,
  sameSettings,
  withSelectableModel,
  type EffortChoice,
  type ModelOption,
  type PermissionModeChoice,
  type SessionSettings,
  type SettingsChange,
} from '../../shared/agent/settings'
import { readUserEffort, readUserModel, type UserEffortReader, type UserModelReader } from '../claude-home/user-model'
import { userContent } from './attachments'
import { CommandCatalog, type CommandInfoLike } from './commands'
import { PermissionGate, unattendedCanUseTool, type CanUseToolHandler } from './permissions'
import { MessageQueue, type QueueEntry } from './queue'
import { ATTENDED, launchSettings, settingsChangeRefusal, type SessionLaunch } from './session-settings'

/** What accountInfo() returns, as far as worfy reads it (ADR-0009). */
export interface AccountInfoLike {
  email?: string | undefined
  subscriptionType?: string | undefined
  tokenSource?: string | undefined
  apiProvider?: string | undefined
}

/** A row of supportedModels(), as far as worfy reads it (ticket 06, question 6). */
export interface ModelInfoLike {
  value: string
  displayName?: string | undefined
  supportsEffort?: boolean | undefined
  supportedEffortLevels?: readonly string[] | undefined
}

/**
 * A Claude Code process as far as a Session watches it: Node's ChildProcess has all of it. A process
 * without a pid never started (spawn failed) and is not waited for.
 */
export interface ClaudeCodeProcess {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
  once(event: 'exit', listener: () => void): unknown
}

/** The part of the SDK's Query a Session uses; fake-query.ts implements it too. */
export interface QueryHandle extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>
  close(): void
  accountInfo(): Promise<AccountInfoLike>
  /** undefined: Claude Code's default model. */
  setModel(model?: string): Promise<void>
  setPermissionMode(mode: PermissionModeChoice): Promise<void>
  /** How the SDK changes effort mid-session (ticket 06); null goes back to the model's default. */
  applyFlagSettings(settings: { effortLevel?: EffortChoice | null }): Promise<void>
  supportedModels(): Promise<ModelInfoLike[]>
  /** The slash commands and skills (ticket 20); optional, as a query that lacks it lists those of system/init. */
  supportedCommands?(): Promise<CommandInfoLike[]>
}

export interface QueryRequest {
  prompt: AsyncIterable<SDKUserMessage>
  cwd: string
  /** SDK session id to continue. */
  resume: string | undefined
  /**
   * The id a new SDK session is to have (SDK option `sessionId`): set when `resume` is not, so the
   * Session's id is known before system/init. Never set together with `resume`.
   */
  sessionId?: string | undefined
  /** Claude Code's stderr, kept to explain a crash. */
  stderr: (data: string) => void
  /** The model, effort and permission mode the query starts with. */
  settings: SessionSettings
  /** Answers Claude Code's permission requests (permissions.ts); one gate per Session, across its queries. */
  canUseTool: CanUseToolHandler
  /** No person is at the Session (session-settings.ts): Claude Code must run in bypassPermissions. A Session always sets it. */
  unattended?: boolean | undefined
  /**
   * Told of each Claude Code process the query starts (app-registry.ts, through the SDK's
   * spawnClaudeCodeProcess), so the Session can wait for its exit. A Session always sets it; a
   * factory with no process of its own (the fake agent) never calls it.
   */
  spawned?: ((process: ClaudeCodeProcess) => void) | undefined
}

/** Starts Claude Code for a Session: the real SDK, or the fake agent in tests. */
export type QueryFactory = (request: QueryRequest) => Promise<QueryHandle>

/** Receives every event of every Session, with the Session's current id. */
export type EventSink = (sessionId: string, event: AgentEvent) => void

/** Told when a person acts on a Session through the UI: what they did, in a few words. */
export type InputListener = (session: Session, what: string) => void

export interface SessionInfo {
  sessionId: string
  /** The SDK session it runs or will resume, once known: a resumed Session has it before its id is reported. */
  sdkSessionId: string | null
  cwd: string
  state: SessionState
}

/** What the input field shows of a Session besides its events: its settings and its queue. */
export interface SessionControls {
  settings: SessionSettings
  queue: QueueSnapshot
}

/** The row of the SDK's default model. */
const DEFAULT_MODEL_VALUE = 'default'

const isEffort = (level: string): level is EffortChoice => (EFFORT_LEVELS as readonly string[]).includes(level)

/** What a Session that names no model is started on when the user's own model is a haiku. */
export const USER_MODEL_FALLBACK = 'sonnet'

/** supportedModels() rows as the model picker lists them; models below sonnet are left out. */
export function modelOptions(models: readonly ModelInfoLike[]): ModelOption[] {
  const selectable = models.filter((model) => isSelectableModel(model.value) && isSelectableModel(model.displayName ?? model.value))
  return selectable.map((model) => ({
    value: model.value === DEFAULT_MODEL_VALUE ? null : model.value,
    displayName: model.displayName ?? model.value,
    efforts: model.supportsEffort === false ? [] : (model.supportedEffortLevels ?? []).filter(isEffort),
  }))
}

function mergeSettings(settings: SessionSettings, change: SettingsChange): SessionSettings {
  return {
    model: change.model !== undefined ? change.model : settings.model,
    effort: change.effort !== undefined ? change.effort : settings.effort,
    permissionMode: change.permissionMode ?? settings.permissionMode,
  }
}

/** An async iterable that yields what is pushed into it, until it is ended. */
class InputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private waiting: ((result: IteratorResult<T>) => void) | null = null
  private ended = false

  push(item: T): void {
    if (this.ended) return
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  end(): void {
    this.ended = true
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
          this.waiting = resolve
        })
      },
    }
  }
}

const STDERR_KEEP = 20

/**
 * How long halt() waits for an interrupted turn to end. Past it the caller closes the process,
 * which ends the turn all the same (Orchestrators.giveBackNow).
 */
export const HALT_TURN_MS = 15_000

/**
 * How long exited() waits for a Claude Code process after the Session closed it, before it sends
 * SIGKILL (ADR-0064). The SDK's close() ends stdin, sends SIGTERM 2 s later and SIGKILL 5 s after
 * that (SDK 0.3.289): worfy's own SIGKILL comes after the SDK's, so the graceful path is not cut
 * short, and ends a process the SDK's did not.
 */
export const EXIT_WAIT_MS = 7_500

/** After SIGKILL: how long exited() still waits for the exit before it gives up on the process. */
export const KILL_EXIT_MS = 2_000

/** Whether a process has exited: by itself (an exit code) or by a signal. */
const hasExited = (child: ClaudeCodeProcess): boolean => child.exitCode !== null || child.signalCode !== null

/** Settles once `process` has exited; at once for one that already has. */
const exitOf = (child: ClaudeCodeProcess): Promise<void> =>
  new Promise((done) => {
    if (hasExited(child)) done()
    else child.once('exit', () => done())
  })

/** Settles with true once `work` settles, or with false after `ms`, whichever comes first. */
async function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), ms)
  })
  try {
    return await Promise.race([work.then(() => true), limit])
  } finally {
    clearTimeout(timer)
  }
}

/** Whether a Session state is a running turn. */
const inTurn = (state: SessionState): boolean => state === 'busy' || state === 'needs_permission'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** One live query and what belongs to it; replaced when a crashed Session is resumed. */
interface Run {
  query: QueryHandle | null
  input: InputQueue<SDKUserMessage>
  stderr: string[]
  /** The settings this query runs with: those it started with, then each control call that succeeded. */
  applied: SessionSettings
}

/**
 * Brings a live query to `to`, one control call per changed setting. `run.applied` keeps the
 * Session's own settings; `request` turns them into what the calls ask for (Session.controlSettings):
 * a `null` model or effort becomes the user's own.
 */
async function pushSettings(run: Run, query: QueryHandle, to: SessionSettings, request: (settings: SessionSettings) => SessionSettings): Promise<void> {
  const changed = run.applied.model !== to.model || run.applied.effort !== to.effort
  const asked = changed ? request(to) : to
  if (run.applied.model !== to.model) {
    await query.setModel(asked.model ?? undefined)
    run.applied = { ...run.applied, model: to.model }
  }
  if (run.applied.permissionMode !== to.permissionMode) {
    await query.setPermissionMode(to.permissionMode)
    run.applied = { ...run.applied, permissionMode: to.permissionMode }
  }
  if (run.applied.effort !== to.effort) {
    await query.applyFlagSettings({ effortLevel: asked.effort })
    run.applied = { ...run.applied, effort: to.effort }
  }
}

export class Session {
  private current: string
  private sdkSessionId: string | null
  private stateValue: SessionState = 'starting'
  private run: Run | null = null
  private interrupted = false
  private closing = false
  /** Set by halt(): nothing more goes into the process; queued messages stay held. */
  private halted = false
  /** Told when the running turn ends: the Session leaves `busy` and `needs_permission`. */
  private turnEndWaiters: (() => void)[] = []
  private settingsValue: SessionSettings
  /** Settings changes run one after another, in the order they were asked for. */
  private configuring: Promise<unknown> = Promise.resolve()
  /** The model of the last system/init: the model list's fallback. */
  private initModel: string | null = null
  /** The background tasks of the current Claude Code process (ADR-0029); a new process starts empty. */
  private taskFold: TaskFold = emptyTaskFold()
  /** Claude Code processes started for this Session without an SDK session to resume. */
  private processes = 0
  /** Claude Code processes of this Session that have not exited yet (ADR-0064). */
  private readonly alive = new Set<ClaudeCodeProcess>()
  /** Starts of Claude Code whose factory has not answered yet: a process may still come of them. */
  private readonly pendingStarts = new Set<Promise<unknown>>()
  /** Set while start(after) holds the process back: what is sent waits in the queue. */
  private heldBack = false
  /** Settles once the Session has started its process, or closed before it could (start()). */
  private launched: Promise<void> = Promise.resolve()
  private liveTaskList: BackgroundTask[] = []
  private readonly queue = new MessageQueue((snapshot) => this.emit({ type: 'queue', ...snapshot }))
  private readonly catalog = new CommandCatalog()
  private readonly permissions = new PermissionGate(
    (event) => this.emit(event),
    (pending) => this.permissionsChanged(pending),
  )
  /** The gate's canUseTool, or for an unattended Session a refusal that waits for no one. */
  private readonly canUseTool: CanUseToolHandler

  constructor(
    readonly cwd: string,
    private readonly factory: QueryFactory,
    private readonly sink: EventSink,
    private readonly onRenamed: (from: string, to: string) => void,
    resume: string | undefined,
    settings: SessionSettings = DEFAULT_SETTINGS,
    private readonly launch: SessionLaunch = ATTENDED,
    /** The user's own model, read again for every Claude Code process the Session starts and every "Default". */
    private readonly userModel: UserModelReader = () => readUserModel(),
    /** The user's own effort, read like the model. */
    private readonly userEffort: UserEffortReader = () => readUserEffort(),
  ) {
    // A new Session's id is the SDK session id it asks Claude Code for (begin()).
    this.current = resume === undefined ? randomUUID() : `pending-${randomUUID()}`
    this.sdkSessionId = resume ?? null
    // A haiku saved before ticket 07 goes back to the default model; the start's `settings` event
    // lets the Orchestrator save the corrected picks.
    this.settingsValue = withSelectableModel(launchSettings(settings, launch))
    this.canUseTool = launch.unattended
      ? unattendedCanUseTool((toolName, message) => this.refuseDialog('permission_request', toolName, message))
      : this.permissions.canUseTool
  }

  /** No person is at this Session (Autopilot): nothing it does may wait for the UI. */
  get unattended(): boolean {
    return this.launch.unattended
  }

  /**
   * Tells the subscribers that this Session refused something that would have waited for a person
   * (a permission request, a Card's `session.ask`), and logs it: the record a check of an
   * unattended run reads.
   */
  refuseDialog(dialog: 'permission_request' | 'card_ask', subject: string, message: string): void {
    console.warn(`[agent] unattended Session ${this.current} refused a ${dialog} (${subject})`)
    this.emit({ type: 'refused_dialog', dialog, subject, message })
  }

  get id(): string {
    return this.current
  }

  get state(): SessionState {
    return this.stateValue
  }

  /** The SDK session this one runs or will resume, once known. */
  get sdkId(): string | null {
    return this.sdkSessionId
  }

  get settings(): SessionSettings {
    return { ...this.settingsValue }
  }

  info(): SessionInfo {
    return { sessionId: this.current, sdkSessionId: this.sdkSessionId, cwd: this.cwd, state: this.stateValue }
  }

  /**
   * The live background tasks of the Session's Claude Code process, ambient ones left out
   * (src/shared/agent/background-tasks.ts). Empty while no process runs.
   */
  backgroundTasks(): BackgroundTask[] {
    return this.liveTaskList.map((task) => ({ ...task }))
  }

  controls(): SessionControls {
    return { settings: this.settings, queue: this.queue.snapshot() }
  }

  /**
   * Starts Claude Code; the Session is `starting` until accountInfo() answers. With `after`, the
   * process starts only once `after` settles (Orchestrators.relaunch: the old process has exited);
   * meanwhile messages wait in the queue, and a Session closed before then starts no process.
   */
  start(after?: Promise<void>): void {
    this.emit({ type: 'state', state: 'starting', error: null })
    this.emit({ type: 'settings', settings: this.settings })
    if (after === undefined) {
      this.begin()
      return
    }
    this.heldBack = true
    this.launched = after
      .catch((error: unknown) => console.warn(`[agent] waiting to start ${this.current} failed; starting now`, error))
      .then(() => {
        this.heldBack = false
        // Messages that came meanwhile wait in the queue: they go once the process is idle, as at any start.
        if (!this.closing) this.begin()
      })
  }

  /** Settles once the Session has started its Claude Code process, or was closed before it did. */
  started(): Promise<void> {
    return this.launched
  }

  /**
   * Settles once every Claude Code process of this Session has exited — for a closed Session, the
   * moment its SDK session may be resumed by another process (ADR-0064). A process still held back
   * (start(after)) is waited for first, then a start still in progress. A process alive `killAfterMs`
   * after that gets SIGKILL and is waited for KILL_EXIT_MS more; one that outlives even that is left
   * with a warning, so the caller is never held for good. Never rejects. Meant for a closed Session.
   */
  async exited(killAfterMs = EXIT_WAIT_MS): Promise<void> {
    await this.launched
    const deadline = Date.now() + killAfterMs
    const left = (): number => Math.max(0, deadline - Date.now())
    await within(Promise.allSettled([...this.pendingStarts]), left())
    await within(Promise.all([...this.alive].map(exitOf)), left())
    const survivors = [...this.alive]
    if (survivors.length === 0) return
    for (const child of survivors) {
      console.warn(`[agent] Claude Code ${child.pid ?? ''} of ${this.current} did not exit ${killAfterMs} ms after the close; sending SIGKILL`)
      try {
        child.kill('SIGKILL')
      } catch (error) {
        console.warn(`[agent] could not kill Claude Code ${child.pid ?? ''} of ${this.current}`, error)
      }
    }
    if (!(await within(Promise.all(survivors.map(exitOf)), KILL_EXIT_MS))) {
      console.warn(`[agent] Claude Code of ${this.current} did not exit after SIGKILL; going on without it`)
    }
  }

  /**
   * Sends one user message: at once, or into the queue while a turn runs. A Session in `error` is
   * started again with `resume` first.
   */
  send(text: string, attachments: readonly Attachment[] = []): 'sent' | 'queued' {
    this.assertOpen()
    if (text.trim() === '' && attachments.length === 0) throw new Error('The message is empty')
    if (this.halted) {
      // The process is about to be closed: the message waits, held, for the Session after it.
      this.queue.add(text, attachments)
      this.queue.pause()
      return 'queued'
    }
    if (this.stateValue === 'busy' || this.stateValue === 'needs_permission' || this.heldBack) {
      this.queue.add(text, attachments)
      return 'queued'
    }
    this.deliver(text, attachments)
    return 'sent'
  }

  /** The queue as it is now. */
  queued(): QueueSnapshot {
    return this.queue.snapshot()
  }

  /** Takes a queued message out before it is sent; false when it is not in the queue (any more). */
  removeQueued(id: string): boolean {
    this.assertOpen()
    return this.queue.remove(id)
  }

  /**
   * Takes the queue out for the Session that replaces this one (Orchestrators.relaunch): its
   * messages, and whether they were held. Answers nothing once the Session is closed.
   */
  handOverQueue(): { items: QueueEntry[]; paused: boolean } {
    if (this.closing) return { items: [], paused: false }
    return this.queue.takeAll()
  }

  /**
   * Takes over the queue of the Session this one replaces, held as it was there. Messages that were
   * not held go once this Session is idle; held ones wait for "Send queued", as before.
   */
  adoptQueue(taken: { items: readonly QueueEntry[]; paused: boolean }): void {
    this.assertOpen()
    this.queue.adopt(taken)
    if (!this.queue.paused && (this.stateValue === 'idle' || this.stateValue === 'error')) this.next()
  }

  /** "Send queued": lets a held queue go again; a Session with no turn running sends the next message now. */
  sendQueued(): void {
    this.assertOpen()
    this.queue.resume()
    if (this.stateValue === 'idle' || this.stateValue === 'error') this.next()
  }

  /**
   * Stops the current turn and holds the queue; the turn ends with a `result` marked as
   * interrupted. A permission request still open is refused first.
   */
  async interrupt(): Promise<boolean> {
    const query = this.run?.query
    if ((this.stateValue !== 'busy' && this.stateValue !== 'needs_permission') || !query) return false
    this.interrupted = true
    this.queue.pause()
    this.permissions.cancelAll()
    await query.interrupt()
    return true
  }

  /**
   * Stop in Autopilot (worfy-week ticket 17): holds the queue, refuses open permission requests,
   * and from now on sends nothing more into this process. A running turn is interrupted and waited
   * for — its `result`, an error or the close — `timeoutMs` at most; the caller then closes the
   * process, which ends whatever is still running in it, background tasks included. Answers whether
   * a turn was interrupted.
   */
  async halt(timeoutMs = HALT_TURN_MS): Promise<boolean> {
    if (this.closing) return false
    this.halted = true
    this.queue.pause()
    this.permissions.cancelAll()
    const query = this.run?.query
    if (!inTurn(this.stateValue) || !query) return false
    this.interrupted = true
    const ended = new Promise<void>((done) => this.turnEndWaiters.push(done))
    // Not awaited: an interrupt that never answers must not hold the stop past its limit.
    query.interrupt().catch((error: unknown) => console.warn(`[agent] interrupting ${this.current} failed`, error))
    let timer: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise<void>((done) => {
      timer = setTimeout(done, timeoutMs)
    })
    try {
      await Promise.race([ended, limit])
    } finally {
      clearTimeout(timer)
    }
    return true
  }

  /** The user's answer to an open permission request; false when it is no longer open. */
  answerPermission(requestId: string, decision: PermissionDecision): boolean {
    this.assertOpen()
    return this.permissions.answer(requestId, decision)
  }

  /**
   * Changes the model, effort or permission mode: on the live query through its control calls, and
   * for every query started later. Resolves to the settings now in force; a control call that
   * fails rejects and leaves the settings as they were.
   */
  configure(change: SettingsChange): Promise<SessionSettings> {
    this.assertOpen()
    const refusal = settingsChangeRefusal(this.launch, change)
    if (refusal !== null) return Promise.reject(new Error(refusal))
    if (typeof change.model === 'string' && !isSelectableModel(change.model)) {
      return Promise.reject(new Error(`${change.model}: a Session runs on sonnet or a larger model`))
    }
    const task = this.configuring.then(async () => {
      const before = this.settingsValue
      const wanted = mergeSettings(before, change)
      const run = this.run
      // Without a live query the settings go to the next one (begin() or the query being started).
      if (run?.query) await pushSettings(run, run.query, wanted, (settings) => this.controlSettings(settings))
      this.settingsValue = wanted
      if (!sameSettings(before, wanted)) this.emit({ type: 'settings', settings: this.settings })
      return this.settings
    })
    this.configuring = task.catch(() => undefined)
    return task
  }

  /** The model picker's rows: supportedModels() of the live query, or else the model of the last system/init. */
  async models(): Promise<ModelOption[]> {
    const query = this.run?.query
    if (query) {
      try {
        const listed = modelOptions(await query.supportedModels())
        if (listed.length > 0) return listed
      } catch (error) {
        console.warn(`[agent] supportedModels of ${this.current} failed`, error)
      }
    }
    const model = this.initModel ?? this.settingsValue.model
    return model === null || !isSelectableModel(model) ? [] : [{ value: model, displayName: model, efforts: [] }]
  }

  /** The slash menu's rows: supportedCommands() of the live query, with the names of the last system/init. */
  commands(): Promise<SlashCommand[]> {
    return this.catalog.list(this.run?.query ?? null)
  }

  close(): void {
    if (this.closing) return
    this.closing = true
    this.permissions.cancelAll()
    const run = this.run
    this.run = null
    run?.input.end()
    try {
      run?.query?.close()
    } catch (error) {
      console.warn(`[agent] closing ${this.current} failed`, error)
    }
    // Closing ends the process, and its background tasks with it.
    this.resetTasks()
    this.setState('closed')
  }

  private assertOpen(): void {
    if (this.closing) throw new Error(`Session ${this.current} is closed`)
  }

  /** Gives Claude Code one user message and starts its turn. */
  private deliver(text: string, attachments: readonly Attachment[]): void {
    if (this.stateValue === 'error' || this.run === null) this.begin()
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: userContent(text, attachments) },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    }
    this.emit({ type: 'prompt', text: messageLabel(text, attachments) })
    this.run?.input.push(message)
    this.setState('busy')
  }

  /** Sends the next queued message, unless the queue is held or empty, or the Session is halted. */
  private next(): void {
    if (this.halted) return
    const item = this.queue.take()
    if (item !== undefined) this.deliver(item.text, item.attachments)
  }

  private begin(): void {
    // A new Claude Code process starts with an empty set of background tasks: a new Session has
    // none yet, and fail() emptied it when the process before this one died. The new process
    // reports its own only when they change.
    const settings = this.settings
    const run: Run = { query: null, input: new InputQueue<SDKUserMessage>(), stderr: [], applied: settings }
    this.run = run
    this.interrupted = false
    const resume = this.sdkSessionId ?? undefined
    const request: QueryRequest = {
      prompt: run.input,
      cwd: this.cwd,
      resume,
      sessionId: resume === undefined ? this.newSessionId() : undefined,
      stderr: (data) => {
        run.stderr.push(data)
        if (run.stderr.length > STDERR_KEEP) run.stderr.shift()
      },
      settings: this.querySettings(settings),
      canUseTool: this.canUseTool,
      unattended: this.launch.unattended,
      spawned: (child) => this.watch(child),
    }
    void this.consume(run, request)
  }

  /** Keeps a started Claude Code process until it exits, for exited(). */
  private watch(child: ClaudeCodeProcess): void {
    if (child.pid === undefined || hasExited(child)) return
    this.alive.add(child)
    child.once('exit', () => this.alive.delete(child))
  }

  /**
   * The id a Claude Code process with no SDK session to resume is asked for: the Session's own id
   * for its first process. A process started after one that died before its first turn gets a new
   * id, and the Session is renamed to it: Claude Code may have kept the first one.
   */
  private newSessionId(): string {
    if (this.processes > 0) {
      const from = this.current
      this.current = randomUUID()
      this.onRenamed(from, this.current)
      this.emit({ type: 'renamed', from })
    }
    this.processes += 1
    return this.current
  }

  /**
   * The settings a new Claude Code process is asked for. With no model named the SDK runs the
   * user's model from settings.json; when that is a haiku the process is asked for sonnet instead.
   * With no effort named the process is asked for the user's effortLevel, which Claude Code would
   * not apply to a newer model (user-model.ts). Only the request changes: the Session's settings
   * (and the Node's saved picks) keep `null`, and the user's settings.json is left as it is
   * (ADR 0005).
   */
  private querySettings(settings: SessionSettings): SessionSettings {
    const asked = this.userEffortFor(settings)
    if (asked.model !== null) return asked
    const userModel = this.readUser('model', this.userModel)
    return userModel !== null && !isSelectableModel(userModel) ? { ...asked, model: USER_MODEL_FALLBACK } : asked
  }

  /**
   * What the control calls of a live query ask for. setModel with no model would put Claude Code
   * on its own default model, not on the user's: "Default" names the user's model (sonnet for a
   * haiku), and only with none in settings.json goes to Claude Code's default.
   */
  private controlSettings(settings: SessionSettings): SessionSettings {
    const asked = this.userEffortFor(settings)
    if (asked.model !== null) return asked
    const userModel = this.readUser('model', this.userModel)
    return userModel === null ? asked : { ...asked, model: isSelectableModel(userModel) ? userModel : USER_MODEL_FALLBACK }
  }

  /** `settings` with no effort named asking for the user's effortLevel; still null when there is none. */
  private userEffortFor(settings: SessionSettings): SessionSettings {
    return settings.effort !== null ? settings : { ...settings, effort: this.readUser('effort', this.userEffort) }
  }

  /** One of the user's own settings; null when it cannot be read, so the start or the change goes on. */
  private readUser<T>(what: string, read: () => T | null): T | null {
    try {
      return read()
    } catch (error) {
      console.warn(`[agent] could not read the user's ${what} for ${this.current}`, error)
      return null
    }
  }

  /** Settings changed while the query was being started: the query gets them now. */
  private catchUp(run: Run, query: QueryHandle): void {
    this.configuring = this.configuring.then(async () => {
      if (this.run !== run || sameSettings(run.applied, this.settingsValue)) return
      try {
        await pushSettings(run, query, this.settingsValue, (settings) => this.controlSettings(settings))
      } catch (error) {
        console.warn(`[agent] could not apply the settings of ${this.current}`, error)
      }
    })
  }

  private async consume(run: Run, request: QueryRequest): Promise<void> {
    const isCurrent = () => this.run === run && !this.closing
    try {
      const starting = this.factory(request)
      this.pendingStarts.add(starting)
      const forget = (): boolean => this.pendingStarts.delete(starting)
      // Beside the await, not chained into it: the query is taken as soon as before (an Interrupt
      // right after the send finds it).
      starting.then(forget, forget)
      const query = await starting
      if (!isCurrent()) {
        query.close()
        return
      }
      run.query = query
      this.catchUp(run, query)
      void this.checkAccount(run, query)
      for await (const message of query) {
        if (!isCurrent()) return
        this.handle(message)
      }
      if (isCurrent()) this.fail(run, 'Claude Code exited')
    } catch (error) {
      if (isCurrent()) this.fail(run, messageOf(error))
    }
  }

  private async checkAccount(run: Run, query: QueryHandle): Promise<void> {
    try {
      const account = await query.accountInfo()
      if (this.run !== run || this.closing) return
      this.emit({
        type: 'account',
        // With a login accountInfo() has subscriptionType; without one only apiProvider and
        // tokenSource "none" (ADR-0009, ticket 06 question 3).
        loggedIn: account.subscriptionType !== undefined || (account.tokenSource !== undefined && account.tokenSource !== 'none'),
        subscriptionType: account.subscriptionType ?? null,
        apiProvider: account.apiProvider ?? null,
        tokenSource: account.tokenSource ?? null,
      })
      if (this.stateValue === 'starting') {
        this.setState('idle')
        this.next()
      }
    } catch (error) {
      // A dead process also ends the message loop, which reports it; this covers a start that
      // never answers the account request.
      if (this.run === run && !this.closing && this.stateValue === 'starting') this.fail(run, messageOf(error))
    }
  }

  private fail(run: Run, reason: string): void {
    const details = run.stderr.join('').trim()
    const error = details ? `${reason}\n${details}` : reason
    run.input.end()
    this.run = null
    this.interrupted = false
    // The process is gone, and its background tasks with it.
    this.resetTasks()
    // What waits in the queue goes when the user asks ("Send queued"), not into a new process by itself.
    this.queue.pause()
    this.setState('error', error)
    // Claude Code is gone: nobody waits for these answers any more.
    this.permissions.cancelAll()
  }

  /** `needs_permission` while a request is open during a turn, `busy` again once none is. */
  private permissionsChanged(pending: number): void {
    if (this.closing) return
    if (pending > 0 && this.stateValue === 'busy') this.setState('needs_permission')
    else if (pending === 0 && this.stateValue === 'needs_permission') this.setState('busy')
  }

  private handle(message: unknown): void {
    this.catalog.observe(message)
    for (const event of sdkMessageToEvents(message)) {
      if (event.type === 'init') {
        this.sdkSessionId = event.sdkSessionId
        this.initModel = event.model
        if (event.sdkSessionId !== this.current) {
          const from = this.current
          this.current = event.sdkSessionId
          this.onRenamed(from, this.current)
          this.emit({ type: 'renamed', from })
        }
        this.emit(event)
        // A turn the user queued while the previous one ran starts with its own init.
        if (this.stateValue === 'idle' || this.stateValue === 'starting') this.setState('busy')
        continue
      }
      if (event.type === 'result') {
        // A failed turn after agent.interrupt counts as interrupted even when Claude Code gives
        // no abort reason; a turn that finished normally despite the request does not.
        this.emit({ ...event, interrupted: event.interrupted || (this.interrupted && event.isError) })
        this.interrupted = false
        // A turn that ended leaves no request to answer.
        this.permissions.cancelAll()
        this.setState('idle')
        this.next()
        continue
      }
      this.emit(event)
      if (isTaskEvent(event)) this.trackTasks(foldTaskEvent(this.taskFold, event))
    }
  }

  /** Takes a new fold of the tasks; tells the subscribers when the live set changed. */
  private trackTasks(fold: TaskFold): void {
    this.taskFold = fold
    const live = liveTasks(fold)
    if (sameTasks(live, this.liveTaskList)) return
    this.liveTaskList = live
    this.emit({ type: 'background_tasks', tasks: live.map((task) => ({ ...task })) })
  }

  private resetTasks(): void {
    this.trackTasks(emptyTaskFold())
  }

  private setState(state: SessionState, error: string | null = null): void {
    if (this.stateValue === state && error === null) return
    this.stateValue = state
    if (!inTurn(state)) for (const done of this.turnEndWaiters.splice(0)) done()
    this.emit({ type: 'state', state, error })
  }

  private emit(event: AgentEvent): void {
    this.sink(this.current, event)
  }
}

/** Every live Session of the app, by id; a Session is also found by its temporary id. */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()
  private readonly observers = new Set<EventSink>()
  private readonly inputObservers = new Set<InputListener>()

  /** `userModel` and `userEffort` read the user's own model and effort (user-model.ts); tests give them fixed answers. */
  constructor(
    private readonly factory: QueryFactory,
    private readonly userModel: UserModelReader = () => readUserModel(),
    private readonly userEffort: UserEffortReader = () => readUserEffort(),
  ) {}

  /**
   * Gets every action a person takes on a live Session through the UI (src/main/ipc/agent.ts):
   * Autopilot (worfy-daily ticket 04) journals those on the Session of its run. Answers the
   * unsubscribe.
   */
  observeInput(listener: InputListener): () => void {
    this.inputObservers.add(listener)
    return () => this.inputObservers.delete(listener)
  }

  /**
   * A person acts on the Session `sessionId` through the UI; told before the action runs, whether
   * the Session then takes it or refuses it. An id that is not live is ignored.
   */
  noteInput(sessionId: string, what: string): void {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    for (const listener of this.inputObservers) {
      try {
        listener(session, what)
      } catch (error) {
        console.warn('[agent] an input observer failed', error)
      }
    }
  }

  /** Gets every event of every Session, besides the Session's own sink (notifications, src/main/notify.ts); answers the unsubscribe. */
  observe(listener: EventSink): () => void {
    this.observers.add(listener)
    return () => this.observers.delete(listener)
  }

  /**
   * Starts a Session whose events go to `sink` (the window that asked for it), main-only ones
   * (isMainOnlyEvent) left out: those go to the observers alone. Resuming an SDK
   * session that a live Session already runs is refused: two Claude Code processes would write
   * one transcript, and both Sessions would send events under one id. `launch` is attended unless
   * Autopilot starts the Session unattended (session-settings.ts). With `after`, the Session is live
   * at once but starts its Claude Code process only once `after` settles (Session.start).
   */
  start(cwd: string, resume: string | undefined, sink: EventSink, settings?: SessionSettings, launch?: SessionLaunch, after?: Promise<void>): Session {
    if (resume !== undefined && this.live().some((live) => live.id === resume || live.sdkId === resume)) {
      throw new Error(`Session ${resume} is already live`)
    }
    const session = new Session(
      cwd,
      this.factory,
      (sessionId, event) => {
        for (const observer of this.observers) {
          try {
            observer(sessionId, event)
          } catch (error) {
            console.warn('[agent] an event observer failed', error)
          }
        }
        try {
          // Events for the main process only (task_activity) reach the observers, not the windows.
          if (!isMainOnlyEvent(event)) sink(sessionId, event)
        } finally {
          // A sink that throws (a window already gone) must not keep a closed Session listed.
          if (event.type === 'state' && event.state === 'closed') this.forget(session)
        }
      },
      (_from, to) => this.sessions.set(to, session),
      resume,
      settings,
      launch,
      this.userModel,
      this.userEffort,
    )
    this.sessions.set(session.id, session)
    session.start(after)
    return session
  }

  get(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`No live Session ${sessionId}`)
    return session
  }

  list(): SessionInfo[] {
    return this.live().map((session) => session.info())
  }

  closeAll(): void {
    for (const session of this.live()) session.close()
  }

  private live(): Session[] {
    return [...new Set(this.sessions.values())]
  }

  private forget(session: Session): void {
    for (const [id, value] of this.sessions) if (value === session) this.sessions.delete(id)
  }
}
