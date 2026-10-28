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
import type { Attachment } from '../../shared/agent/attachments'
import { emptyTaskFold, foldTaskEvent, isTaskEvent, liveTasks, sameTasks, type BackgroundTask, type TaskFold } from '../../shared/agent/background-tasks'
import type { SlashCommand } from '../../shared/agent/commands'
import type { QuestionPick } from '../../shared/agent/questions'
import {
  contextUsageOf,
  isCompactBoundary,
  sameContextUsage,
  sdkMessageToEvents,
  type AgentEvent,
  type ContextUsage,
  type PermissionDecision,
  type QueueSnapshot,
  type SessionState,
} from '../../shared/agent/events'
import {
  DEFAULT_SETTINGS,
  isSelectableModel,
  sameSettings,
  withSelectableModel,
  type ModelOption,
  type SessionSettings,
  type SettingsChange,
} from '../../shared/agent/settings'
import { readUserEffort, readUserModel, type UserEffortReader, type UserModelReader } from '../claude-home/user-model'
import { shownAttachments, userContent } from './attachments'
import { CommandCatalog } from './commands'
import { PermissionGate, unattendedCanUseTool, type CanUseToolHandler, type RefusalDetails } from './permissions'
import { MessageQueue, type QueueEntry } from './queue'
import { InputQueue } from './session/input-queue'
import { mergeSettings, modelOptions, USER_MODEL_FALLBACK } from './session/models'
import { EXIT_WAIT_MS, exitOf, HALT_TURN_MS, hasExited, KILL_EXIT_MS, stopWaiting, waitForExit, within } from './session/process'
import { pushSettings, STDERR_KEEP, type Run } from './session/run'
import type { ClaudeCodeProcess, EventSink, QueryFactory, QueryHandle, QueryRequest, SessionControls, SessionInfo } from './session/types'
import { ATTENDED, launchSettings, settingsChangeRefusal, type SessionLaunch } from './session-settings'

// What the importers of this module read from it lives in src/main/agent/session/; it stays importable from here.
export type {
  AccountInfoLike,
  ClaudeCodeProcess,
  EventSink,
  InputListener,
  ModelInfoLike,
  QueryFactory,
  QueryHandle,
  QueryRequest,
  SessionControls,
  SessionInfo,
} from './session/types'
export { modelOptions, USER_MODEL_FALLBACK } from './session/models'
export { EXIT_WAIT_MS, HALT_TURN_MS, KILL_EXIT_MS } from './session/process'
export { SessionRegistry } from './session/registry'

/** Whether a Session state is a running turn. */
const inTurn = (state: SessionState): boolean => state === 'busy' || state === 'needs_permission'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
  /** The context usage last sent; null: none, or the last ask failed. */
  private contextValue: ContextUsage | null = null
  /** Asks for the context usage so far; an answer to any but the latest is dropped. */
  private contextAsks = 0
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
      ? unattendedCanUseTool((toolName, message, details) => this.refuseDialog('permission_request', toolName, message, details))
      : this.permissions.canUseTool
  }

  /** No person is at this Session (Autopilot): nothing it does may wait for the UI. */
  get unattended(): boolean {
    return this.launch.unattended
  }

  /**
   * Tells the subscribers that this Session refused something that would have waited for a person
   * (a permission request, a Card's `session.ask`), and logs it: the record a check of an
   * unattended run reads. `details`: the Subagent that asked and Claude Code's reason, when given.
   */
  refuseDialog(dialog: 'permission_request' | 'card_ask', subject: string, message: string, details: RefusalDetails = {}): void {
    console.warn(`[agent] unattended Session ${this.current} refused a ${dialog} (${subject})`)
    this.emit({ type: 'refused_dialog', dialog, subject, message, ...details })
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
    await within(Promise.all([...this.alive].map(waitForExit)), left())
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
    if (!(await within(Promise.all(survivors.map(waitForExit)), KILL_EXIT_MS))) {
      console.warn(`[agent] Claude Code of ${this.current} did not exit after SIGKILL; going on without it`)
      for (const child of survivors) stopWaiting(child)
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

  /** The user's picks for an open question request (null: "Decline"); false when it is no longer open. */
  answerQuestion(requestId: string, picks: readonly QuestionPick[] | null): boolean {
    this.assertOpen()
    return this.permissions.answerQuestion(requestId, picks)
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
    // The row shows the text as typed and the attachments by name (worfy-ui ticket 28).
    this.emit({ type: 'prompt', text: text.trim() === '' ? '' : text, attachments: shownAttachments(attachments) })
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
      orchestrator: this.launch.orchestrator === true,
    }
    void this.consume(run, request)
  }

  /** Keeps a started Claude Code process until it exits, for exited(). */
  private watch(child: ClaudeCodeProcess): void {
    if (child.pid === undefined || hasExited(child)) return
    this.alive.add(child)
    void exitOf(child).then(() => this.alive.delete(child))
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
    // A compaction empties most of the window while the turn may go on for long.
    if (isCompactBoundary(message)) this.askContext()
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
        this.askContext()
        this.setState('idle')
        this.next()
        continue
      }
      this.emit(event)
      if (isTaskEvent(event)) this.trackTasks(foldTaskEvent(this.taskFold, event))
    }
  }

  /**
   * Asks the running query how full the context window is and sends a `context` event when the
   * answer differs from the last one. `summary` answers from the last response's usage, without
   * token-count requests. A failed ask is "no data", never a failed turn. An answer is dropped when
   * a newer ask was made, the query was replaced or the Session is closing.
   */
  private askContext(): void {
    const run = this.run
    const query = run?.query
    if (run === null || query?.getContextUsage === undefined) return
    const ask = ++this.contextAsks
    const answer = (async () => {
      try {
        return contextUsageOf(await query.getContextUsage?.({ detail: 'summary' }))
      } catch (error) {
        console.warn(`[agent] could not read the context usage of ${this.current}`, error)
        return null
      }
    })()
    void answer.then((usage) => {
      if (ask !== this.contextAsks || this.run !== run || this.closing) return
      if (sameContextUsage(usage, this.contextValue)) return
      this.contextValue = usage
      this.emit({ type: 'context', usage })
    })
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
