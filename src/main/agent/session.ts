// Sessions in main: each one is a single long-running SDK query() whose input is an async queue.
// User messages are pushed into it one by one; the query is not recreated between turns.
//
// A Session turns every SDK message into worfy's events (src/shared/agent/events.ts) and keeps
// its state: `busy` from a send until the turn's `result`, which comes once per turn even when
// the user's Stop hook continues the turn (ticket 06, question 2). A `system/init` while idle is
// the start of a queued turn and makes the Session busy again. When Claude Code dies, the Session
// goes to `error`; the next send starts a new query that resumes the same SDK session.
//
// A message sent while a turn runs waits in the Session's queue (queue.ts) and goes after the
// turn's `result`, one per turn (ticket 19); Interrupt and a crash hold the queue until "Send
// queued". The model, effort and permission mode (src/shared/agent/settings.ts) are applied to
// the live query through its control calls and passed to every query started later.
import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { sdkMessageToEvents, type AgentEvent, type QueueSnapshot, type SessionState } from '../../shared/agent/events'
import {
  DEFAULT_SETTINGS,
  EFFORT_LEVELS,
  sameSettings,
  type EffortChoice,
  type ModelOption,
  type PermissionModeChoice,
  type SessionSettings,
  type SettingsChange,
} from '../../shared/agent/settings'
import { MessageQueue } from './queue'

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
}

export interface QueryRequest {
  prompt: AsyncIterable<SDKUserMessage>
  cwd: string
  /** SDK session id to continue. */
  resume: string | undefined
  /** Claude Code's stderr, kept to explain a crash. */
  stderr: (data: string) => void
  /** The model, effort and permission mode the query starts with. */
  settings: SessionSettings
}

/** Starts Claude Code for a Session: the real SDK, or the fake agent in tests. */
export type QueryFactory = (request: QueryRequest) => Promise<QueryHandle>

/** Receives every event of every Session, with the Session's current id. */
export type EventSink = (sessionId: string, event: AgentEvent) => void

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

/** supportedModels() rows as the model picker lists them. */
export function modelOptions(models: readonly ModelInfoLike[]): ModelOption[] {
  return models.map((model) => ({
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** One live query and what belongs to it; replaced when a crashed Session is resumed. */
interface Run {
  query: QueryHandle | null
  input: InputQueue<SDKUserMessage>
  stderr: string[]
  /** The settings this query runs with: those it started with, then each control call that succeeded. */
  applied: SessionSettings
}

/** Brings a live query to `to`, one control call per changed setting. */
async function pushSettings(run: Run, query: QueryHandle, to: SessionSettings): Promise<void> {
  if (run.applied.model !== to.model) {
    await query.setModel(to.model ?? undefined)
    run.applied = { ...run.applied, model: to.model }
  }
  if (run.applied.permissionMode !== to.permissionMode) {
    await query.setPermissionMode(to.permissionMode)
    run.applied = { ...run.applied, permissionMode: to.permissionMode }
  }
  if (run.applied.effort !== to.effort) {
    await query.applyFlagSettings({ effortLevel: to.effort })
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
  private settingsValue: SessionSettings
  /** Settings changes run one after another, in the order they were asked for. */
  private configuring: Promise<unknown> = Promise.resolve()
  /** The model of the last system/init: the model list's fallback. */
  private initModel: string | null = null
  private readonly queue = new MessageQueue((snapshot) => this.emit({ type: 'queue', ...snapshot }))

  constructor(
    readonly cwd: string,
    private readonly factory: QueryFactory,
    private readonly sink: EventSink,
    private readonly onRenamed: (from: string, to: string) => void,
    resume: string | undefined,
    settings: SessionSettings = DEFAULT_SETTINGS,
  ) {
    this.current = `pending-${randomUUID()}`
    this.sdkSessionId = resume ?? null
    this.settingsValue = { ...settings }
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

  controls(): SessionControls {
    return { settings: this.settings, queue: this.queue.snapshot() }
  }

  /** Starts Claude Code; the Session is `starting` until accountInfo() answers. */
  start(): void {
    this.emit({ type: 'state', state: 'starting', error: null })
    this.emit({ type: 'settings', settings: this.settings })
    this.begin()
  }

  /**
   * Sends one user message: at once, or into the queue while a turn runs. A Session in `error` is
   * started again with `resume` first.
   */
  send(text: string): 'sent' | 'queued' {
    this.assertOpen()
    if (this.stateValue === 'busy' || this.stateValue === 'needs_permission') {
      this.queue.add(text)
      return 'queued'
    }
    this.deliver(text)
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

  /** "Send queued": lets a held queue go again; a Session with no turn running sends the next message now. */
  sendQueued(): void {
    this.assertOpen()
    this.queue.resume()
    if (this.stateValue === 'idle' || this.stateValue === 'error') this.next()
  }

  /** Stops the current turn and holds the queue; the turn ends with a `result` marked as interrupted. */
  async interrupt(): Promise<boolean> {
    const query = this.run?.query
    if (this.stateValue !== 'busy' || !query) return false
    this.interrupted = true
    this.queue.pause()
    await query.interrupt()
    return true
  }

  /**
   * Changes the model, effort or permission mode: on the live query through its control calls, and
   * for every query started later. Resolves to the settings now in force; a control call that
   * fails rejects and leaves the settings as they were.
   */
  configure(change: SettingsChange): Promise<SessionSettings> {
    this.assertOpen()
    const task = this.configuring.then(async () => {
      const before = this.settingsValue
      const wanted = mergeSettings(before, change)
      const run = this.run
      // Without a live query the settings go to the next one (begin() or the query being started).
      if (run?.query) await pushSettings(run, run.query, wanted)
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
    return model === null ? [] : [{ value: model, displayName: model, efforts: [] }]
  }

  close(): void {
    if (this.closing) return
    this.closing = true
    const run = this.run
    this.run = null
    run?.input.end()
    try {
      run?.query?.close()
    } catch (error) {
      console.warn(`[agent] closing ${this.current} failed`, error)
    }
    this.setState('closed')
  }

  private assertOpen(): void {
    if (this.closing) throw new Error(`Session ${this.current} is closed`)
  }

  /** Gives Claude Code one user message and starts its turn. */
  private deliver(text: string): void {
    if (this.stateValue === 'error' || this.run === null) this.begin()
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    }
    this.emit({ type: 'prompt', text })
    this.run?.input.push(message)
    this.setState('busy')
  }

  /** Sends the next queued message, unless the queue is held or empty. */
  private next(): void {
    const item = this.queue.take()
    if (item !== undefined) this.deliver(item.text)
  }

  private begin(): void {
    const settings = this.settings
    const run: Run = { query: null, input: new InputQueue<SDKUserMessage>(), stderr: [], applied: settings }
    this.run = run
    this.interrupted = false
    const request: QueryRequest = {
      prompt: run.input,
      cwd: this.cwd,
      resume: this.sdkSessionId ?? undefined,
      stderr: (data) => {
        run.stderr.push(data)
        if (run.stderr.length > STDERR_KEEP) run.stderr.shift()
      },
      settings,
    }
    void this.consume(run, request)
  }

  /** Settings changed while the query was being started: the query gets them now. */
  private catchUp(run: Run, query: QueryHandle): void {
    this.configuring = this.configuring.then(async () => {
      if (this.run !== run || sameSettings(run.applied, this.settingsValue)) return
      try {
        await pushSettings(run, query, this.settingsValue)
      } catch (error) {
        console.warn(`[agent] could not apply the settings of ${this.current}`, error)
      }
    })
  }

  private async consume(run: Run, request: QueryRequest): Promise<void> {
    const isCurrent = () => this.run === run && !this.closing
    try {
      const query = await this.factory(request)
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
    // What waits in the queue goes when the user asks ("Send queued"), not into a new process by itself.
    this.queue.pause()
    this.setState('error', error)
  }

  private handle(message: unknown): void {
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
        this.setState('idle')
        this.next()
        continue
      }
      this.emit(event)
    }
  }

  private setState(state: SessionState, error: string | null = null): void {
    if (this.stateValue === state && error === null) return
    this.stateValue = state
    this.emit({ type: 'state', state, error })
  }

  private emit(event: AgentEvent): void {
    this.sink(this.current, event)
  }
}

/** Every live Session of the app, by id; a Session is also found by its temporary id. */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly factory: QueryFactory) {}

  /**
   * Starts a Session whose events go to `sink` (the window that asked for it). Resuming an SDK
   * session that a live Session already runs is refused: two Claude Code processes would write
   * one transcript, and both Sessions would send events under one id.
   */
  start(cwd: string, resume: string | undefined, sink: EventSink, settings?: SessionSettings): Session {
    if (resume !== undefined && this.live().some((live) => live.id === resume || live.sdkId === resume)) {
      throw new Error(`Session ${resume} is already live`)
    }
    const session = new Session(
      cwd,
      this.factory,
      (sessionId, event) => {
        try {
          sink(sessionId, event)
        } finally {
          // A sink that throws (a window already gone) must not keep a closed Session listed.
          if (event.type === 'state' && event.state === 'closed') this.forget(session)
        }
      },
      (_from, to) => this.sessions.set(to, session),
      resume,
      settings,
    )
    this.sessions.set(session.id, session)
    session.start()
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
