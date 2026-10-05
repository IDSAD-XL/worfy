// Sessions in main: each one is a single long-running SDK query() whose input is an async queue.
// User messages are pushed into it one by one; the query is not recreated between turns.
//
// A Session turns every SDK message into worfy's events (src/shared/agent/events.ts) and keeps
// its state: `busy` from a send until the turn's `result`, which comes once per turn even when
// the user's Stop hook continues the turn (ticket 06, question 2). A `system/init` while idle is
// the start of a queued turn and makes the Session busy again. When Claude Code dies, the Session
// goes to `error`; the next send starts a new query that resumes the same SDK session.
import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { sdkMessageToEvents, type AgentEvent, type SessionState } from '../../shared/agent/events'

/** What accountInfo() returns, as far as worfy reads it (ADR-0009). */
export interface AccountInfoLike {
  email?: string | undefined
  subscriptionType?: string | undefined
  tokenSource?: string | undefined
  apiProvider?: string | undefined
}

/** The part of the SDK's Query a Session uses; fake-query.ts implements it too. */
export interface QueryHandle extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>
  close(): void
  accountInfo(): Promise<AccountInfoLike>
}

export interface QueryRequest {
  prompt: AsyncIterable<SDKUserMessage>
  cwd: string
  /** SDK session id to continue. */
  resume: string | undefined
  /** Claude Code's stderr, kept to explain a crash. */
  stderr: (data: string) => void
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
}

export class Session {
  private current: string
  private sdkSessionId: string | null
  private stateValue: SessionState = 'starting'
  private run: Run | null = null
  private interrupted = false
  private closing = false

  constructor(
    readonly cwd: string,
    private readonly factory: QueryFactory,
    private readonly sink: EventSink,
    private readonly onRenamed: (from: string, to: string) => void,
    resume: string | undefined,
  ) {
    this.current = `pending-${randomUUID()}`
    this.sdkSessionId = resume ?? null
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

  info(): SessionInfo {
    return { sessionId: this.current, sdkSessionId: this.sdkSessionId, cwd: this.cwd, state: this.stateValue }
  }

  /** Starts Claude Code; the Session is `starting` until accountInfo() answers. */
  start(): void {
    this.emit({ type: 'state', state: 'starting', error: null })
    this.begin()
  }

  /** Sends one user message. A Session in `error` is started again with `resume` first. */
  send(text: string): void {
    if (this.closing) throw new Error(`Session ${this.current} is closed`)
    if (this.stateValue === 'error' || this.run === null) this.begin()
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    }
    this.run?.input.push(message)
    this.setState('busy')
  }

  /** Stops the current turn; the turn ends with a `result` marked as interrupted. */
  async interrupt(): Promise<boolean> {
    const query = this.run?.query
    if (this.stateValue !== 'busy' || !query) return false
    this.interrupted = true
    await query.interrupt()
    return true
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

  private begin(): void {
    const run: Run = { query: null, input: new InputQueue<SDKUserMessage>(), stderr: [] }
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
    }
    void this.consume(run, request)
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
      if (this.stateValue === 'starting') this.setState('idle')
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
    this.setState('error', error)
  }

  private handle(message: unknown): void {
    for (const event of sdkMessageToEvents(message)) {
      if (event.type === 'init') {
        this.sdkSessionId = event.sdkSessionId
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
  start(cwd: string, resume: string | undefined, sink: EventSink): Session {
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
