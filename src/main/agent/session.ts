// Sessions in main. A Session drives its Vendor's agent only through the driver's SessionHandle
// (src/main/vendors/session.ts, ADR-0094; worfy-multi-vendor ticket 14): it sends worfy's messages
// into it and reads worfy's events out of it (src/shared/agent/events.ts). One handle is one process
// of the agent; it is not recreated between turns. The Claude driver (src/main/vendors/claude/session.ts)
// runs Claude Code through the SDK's query() and translates its messages.
//
// The Session keeps its state: `busy` from a send until the turn's `result`, which comes once per
// turn even when the user's Stop hook continues the turn (ticket 06, question 2). An `init` while
// idle is the start of a queued turn and makes the Session busy again. When the agent dies, the
// Session goes to `error`; the next send starts a new process that resumes the same Vendor session.
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
// the live process through the handle (setModel, setEffort, setPermissionPreset) and passed to
// every process started later.
//
// A message may carry attachments (ticket 20, attachments.ts): the driver gives them to its agent.
// The slash menu's commands and the model picker's rows come from the handle.
//
// Outside bypassPermissions the agent asks before tools (ticket 21): the Session's own
// PermissionGate (permissions.ts) waits for the user's pick of the options the Vendor offers, and
// the Session is `needs_permission` while a request is open. Interrupt, close and a crash cancel
// open requests.
//
// A Session launched unattended (Autopilot, worfy-daily ticket 02, session-settings.ts) never waits
// for a person: it runs in bypassPermissions, refuses a change of mode, its driver refuses every
// permission request at once, and each refusal reaches its subscribers as a `refused_dialog` event.
//
// Stop in Autopilot halts the Orchestrator's Session before the Orchestrator is given back
// (halt(), worfy-week ticket 17, ADR-0050): the queue is held, open requests are refused, and a
// running turn is interrupted and waited for, HALT_TURN_MS at most. From then on the Session sends
// nothing more into its process: what a person queues stays held, for the Session that replaces it.
//
// A Session knows when its agent's process has exited (worfy-week ticket 20, ADR-0064): the
// driver tells it of each process it starts (SessionStart.spawned), and exited() settles once
// none is left, killing with SIGKILL one that outlives EXIT_WAIT_MS. A Session may also be started
// with its process held back until a promise settles (start(after)): the Orchestrator's relaunch
// starts the new process only once the old one is gone, so two processes never write one transcript.
// Until then the Session is `starting`, and what is sent to it waits in its queue.
//
// A Session runs on sonnet or a larger model, never on haiku (worfy-daily ticket 07,
// isSelectableModel): the model list leaves haiku out and a saved haiku goes back to the default
// model. `null` — "Default" in the pickers — is the Vendor's default model and effort: the Session's
// settings keep `null`, so its header shows "no pick", and the driver says what it means (Claude:
// the user's own from settings.json, sonnet for a haiku).
import { randomUUID } from 'node:crypto'
import type { Attachment } from '../../shared/agent/attachments'
import { emptyTaskFold, foldTaskEvent, isTaskEvent, liveTasks, sameTasks, type BackgroundTask, type TaskFold } from '../../shared/agent/background-tasks'
import type { SlashCommand } from '../../shared/agent/commands'
import { sameContextUsage, type AgentEvent, type ContextUsage, type QueueSnapshot, type SessionState } from '../../shared/agent/events'
import type { QuestionPick } from '../../shared/agent/questions'
import {
  DEFAULT_SETTINGS,
  isSelectableModel,
  sameSettings,
  withSelectableModel,
  type ModelOption,
  type SessionSettings,
  type SettingsChange,
} from '../../shared/agent/settings'
import type { AgentProcess, RefusalDetails, SessionHandle, SessionPart, SessionStart } from '../vendors/session'
import { shownAttachments } from './attachments'
import { PermissionGate } from './permissions'
import { MessageQueue, type QueueEntry } from './queue'
import { mergeSettings } from './session/models'
import { EXIT_WAIT_MS, exitOf, HALT_TURN_MS, hasExited, KILL_EXIT_MS, stopWaiting, waitForExit, within } from './session/process'
import { pushSettings, STDERR_KEEP, type Run } from './session/run'
import type { EventSink, SessionControls, SessionInfo } from './session/types'
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
  /** The model of the last `init`: the model list's fallback. */
  private initModel: string | null = null
  /** The background tasks of the agent's current process (ADR-0029); a new process starts empty. */
  private taskFold: TaskFold = emptyTaskFold()
  /** Processes started for this Session without a Vendor session to resume. */
  private processes = 0
  /** Processes of this Session's agent that have not exited yet (ADR-0064). */
  private readonly alive = new Set<AgentProcess>()
  /** Starts of the agent whose driver has not answered yet: a process may still come of them. */
  private readonly pendingStarts = new Set<Promise<unknown>>()
  /** Set while start(after) holds the process back: what is sent waits in the queue. */
  private heldBack = false
  /** Settles once the Session has started its process, or closed before it could (start()). */
  private launched: Promise<void> = Promise.resolve()
  private liveTaskList: BackgroundTask[] = []
  /** The context usage last sent; null: none, or the last ask failed. */
  private contextValue: ContextUsage | null = null
  private readonly queue = new MessageQueue((snapshot) => this.emit({ type: 'queue', ...snapshot }))
  /** The Session's permission requests and the subjects "Always allow" covers, across its processes. */
  private readonly permissions = new PermissionGate(
    (event) => this.emit(event),
    (pending) => this.permissionsChanged(pending),
  )
  /** The handle of the agent's latest process, kept after it died: the slash menu still lists what it said. */
  private lastHandle: SessionHandle | null = null

  constructor(
    readonly cwd: string,
    /** The session part of the Vendor's driver: what starts the agent's processes. */
    private readonly sessions: SessionPart,
    private readonly sink: EventSink,
    private readonly onRenamed: (from: string, to: string) => void,
    resume: string | undefined,
    settings: SessionSettings = DEFAULT_SETTINGS,
    private readonly launch: SessionLaunch = ATTENDED,
  ) {
    // A new Session's id is the Vendor session id it asks the driver for (begin()).
    this.current = resume === undefined ? randomUUID() : `pending-${randomUUID()}`
    this.sdkSessionId = resume ?? null
    // A haiku saved before ticket 07 goes back to the default model; the start's `settings` event
    // lets the Orchestrator save the corrected picks.
    this.settingsValue = withSelectableModel(launchSettings(settings, launch))
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

  /**
   * Shows `text` in the Session's view as a notice of worfy's own (kind `notification`), outside any
   * turn; Claude Code does not see it. A start of Autopilot promised after the Orchestrator's turn
   * says so when it is refused then (src/main/autopilot/chat-start.ts, worfy-flight-recorder ticket 21).
   */
  notice(text: string): void {
    this.emit({ type: 'notice', kind: 'notification', text })
  }

  get id(): string {
    return this.current
  }

  get state(): SessionState {
    return this.stateValue
  }

  /** The Vendor session (Claude: the SDK session) this one runs or will resume, once known. */
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
   * The live background tasks of the Session's agent process, ambient ones left out
   * (src/shared/agent/background-tasks.ts). Empty while no process runs.
   */
  backgroundTasks(): BackgroundTask[] {
    return this.liveTaskList.map((task) => ({ ...task }))
  }

  controls(): SessionControls {
    return { settings: this.settings, queue: this.queue.snapshot() }
  }

  /**
   * Starts the agent; the Session is `starting` until its `account` event. With `after`, the
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

  /** Settles once the Session has started its agent's process, or was closed before it did. */
  started(): Promise<void> {
    return this.launched
  }

  /**
   * Settles once every process of this Session's agent has exited — for a closed Session, the
   * moment its Vendor session may be resumed by another process (ADR-0064). A process still held back
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
    const handle = this.run?.handle
    if ((this.stateValue !== 'busy' && this.stateValue !== 'needs_permission') || !handle) return false
    this.interrupted = true
    this.queue.pause()
    this.permissions.cancelAll()
    await handle.interrupt()
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
    const handle = this.run?.handle
    if (!inTurn(this.stateValue) || !handle) return false
    this.interrupted = true
    const ended = new Promise<void>((done) => this.turnEndWaiters.push(done))
    // Not awaited: an interrupt that never answers must not hold the stop past its limit.
    handle.interrupt().catch((error: unknown) => console.warn(`[agent] interrupting ${this.current} failed`, error))
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

  /**
   * The user's answer to an open permission request: the id of one of its options. False when it is
   * no longer open; throws for an option the request does not offer.
   */
  answerPermission(requestId: string, optionId: string): boolean {
    this.assertOpen()
    return this.permissions.answer(requestId, optionId)
  }

  /** The user's picks for an open question request (null: "Decline"); false when it is no longer open. */
  answerQuestion(requestId: string, picks: readonly QuestionPick[] | null): boolean {
    this.assertOpen()
    return this.permissions.answerQuestion(requestId, picks)
  }

  /**
   * Changes the model, effort or permission mode: on the live process through the handle, and for
   * every process started later. Resolves to the settings now in force; a change the handle refuses
   * rejects and leaves the settings as they were.
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
      // Without a live process the settings go to the next one (begin() or the process being started).
      if (run?.handle) await pushSettings(run, run.handle, wanted)
      this.settingsValue = wanted
      if (!sameSettings(before, wanted)) this.emit({ type: 'settings', settings: this.settings })
      return this.settings
    })
    this.configuring = task.catch(() => undefined)
    return task
  }

  /** The model picker's rows: those of the live process, or else the model of the last `init`. */
  async models(): Promise<ModelOption[]> {
    const handle = this.run?.handle
    if (handle) {
      const listed = await handle.models()
      if (listed.length > 0) return listed
    }
    const model = this.initModel ?? this.settingsValue.model
    return model === null || !isSelectableModel(model) ? [] : [{ value: model, displayName: model, efforts: [] }]
  }

  /** The slash menu's rows: those of the live process, or what the latest one said of them. */
  commands(): Promise<SlashCommand[]> {
    const handle = this.run?.handle ?? this.lastHandle
    return handle === null ? Promise.resolve([]) : handle.commands()
  }

  close(): void {
    if (this.closing) return
    this.closing = true
    this.permissions.cancelAll()
    const run = this.run
    this.run = null
    try {
      // A process still being started is closed once its driver answers (consume()).
      run?.handle?.close()
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

  /** Gives the agent one user message and starts its turn. */
  private deliver(text: string, attachments: readonly Attachment[]): void {
    if (this.stateValue === 'error' || this.run === null) this.begin()
    // The row shows the text as typed and the attachments by name (worfy-ui ticket 28).
    this.emit({ type: 'prompt', text: text.trim() === '' ? '' : text, attachments: shownAttachments(attachments) })
    const run = this.run
    const message = { text, attachments }
    if (run?.handle) void run.handle.send(message)
    else run?.waiting.push(message)
    this.setState('busy')
  }

  /** Sends the next queued message, unless the queue is held or empty, or the Session is halted. */
  private next(): void {
    if (this.halted) return
    const item = this.queue.take()
    if (item !== undefined) this.deliver(item.text, item.attachments)
  }

  private begin(): void {
    // A new process starts with an empty set of background tasks: a new Session has none yet, and
    // fail() emptied it when the process before this one died. The new process reports its own
    // only when they change.
    const settings = this.settings
    const run: Run = { handle: null, waiting: [], stderr: [], applied: settings }
    this.run = run
    this.interrupted = false
    const resume = this.sdkSessionId ?? undefined
    const opts: SessionStart = {
      cwd: this.cwd,
      settings,
      unattended: this.launch.unattended,
      orchestrator: this.launch.orchestrator === true,
      permissions: this.permissions,
      refused: (subject, message, details) => this.refuseDialog('permission_request', subject, message, details),
      stderr: (data) => {
        run.stderr.push(data)
        if (run.stderr.length > STDERR_KEEP) run.stderr.shift()
      },
      spawned: (child) => this.watch(child),
      previous: this.lastHandle ?? undefined,
    }
    const starting = resume === undefined ? this.sessions.start({ ...opts, sessionId: this.newSessionId() }) : this.sessions.resume(resume, opts)
    void this.consume(run, starting)
  }

  /** Keeps a started process until it exits, for exited(). */
  private watch(child: AgentProcess): void {
    if (child.pid === undefined || hasExited(child)) return
    this.alive.add(child)
    void exitOf(child).then(() => this.alive.delete(child))
  }

  /**
   * The id a process with no Vendor session to resume is asked for: the Session's own id for its
   * first process. A process started after one that died before its first turn gets a new id, and
   * the Session is renamed to it: the Vendor may have kept the first one.
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

  /** Settings changed while the process was being started: the process gets them now. */
  private catchUp(run: Run, handle: SessionHandle): void {
    this.configuring = this.configuring.then(async () => {
      if (this.run !== run || sameSettings(run.applied, this.settingsValue)) return
      try {
        await pushSettings(run, handle, this.settingsValue)
      } catch (error) {
        console.warn(`[agent] could not apply the settings of ${this.current}`, error)
      }
    })
  }

  private async consume(run: Run, starting: Promise<SessionHandle>): Promise<void> {
    const isCurrent = () => this.run === run && !this.closing
    try {
      this.pendingStarts.add(starting)
      const forget = (): boolean => this.pendingStarts.delete(starting)
      // Beside the await, not chained into it: the handle is taken as soon as before (an Interrupt
      // right after the send finds it).
      starting.then(forget, forget)
      const handle = await starting
      if (!isCurrent()) {
        handle.close()
        return
      }
      run.handle = handle
      this.lastHandle = handle
      for (const message of run.waiting.splice(0)) void handle.send(message)
      this.catchUp(run, handle)
      for await (const event of handle.events) {
        if (!isCurrent()) return
        this.onEvent(event)
      }
      if (isCurrent()) this.fail(run, 'The agent exited')
    } catch (error) {
      if (isCurrent()) this.fail(run, messageOf(error))
    }
  }

  private fail(run: Run, reason: string): void {
    const details = run.stderr.join('').trim()
    const error = details ? `${reason}\n${details}` : reason
    run.waiting.length = 0
    this.run = null
    this.interrupted = false
    // The process is gone, and its background tasks with it.
    this.resetTasks()
    // What waits in the queue goes when the user asks ("Send queued"), not into a new process by itself.
    this.queue.pause()
    this.setState('error', error)
    // The agent is gone: nobody waits for these answers any more.
    this.permissions.cancelAll()
  }

  /** `needs_permission` while a request is open during a turn, `busy` again once none is. */
  private permissionsChanged(pending: number): void {
    if (this.closing) return
    if (pending > 0 && this.stateValue === 'busy') this.setState('needs_permission')
    else if (pending === 0 && this.stateValue === 'needs_permission') this.setState('busy')
  }

  /** One event of the agent: the Session's state follows it, and its subscribers get it. */
  private onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'account':
        this.emit(event)
        // The agent answered its start check: the Session takes messages.
        if (this.stateValue === 'starting') {
          this.setState('idle')
          this.next()
        }
        return
      case 'context':
        // Sent only when it differs from the last one.
        if (sameContextUsage(event.usage, this.contextValue)) return
        this.contextValue = event.usage
        this.emit(event)
        return
      case 'init':
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
        return
      case 'result':
        // A failed turn after agent.interrupt counts as interrupted even when the Vendor gives no
        // abort reason; a turn that finished normally despite the request does not.
        this.emit({ ...event, interrupted: event.interrupted || (this.interrupted && event.isError) })
        this.interrupted = false
        // A turn that ended leaves no request to answer.
        this.permissions.cancelAll()
        this.setState('idle')
        this.next()
        return
      default:
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
