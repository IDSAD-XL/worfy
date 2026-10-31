// "Nothing works" for "Restart when idle" (worfy-update ticket 04, spec R6, ADR-0089 point 5): no
// Session in a turn (`busy` or `needs_permission`), no Session with a background task, and no
// Autopilot run (Autopilot.anyRunning(), which counts a stopped run that still waits for the
// background tasks of its Orchestrator). Terminals do not count: worfy closes their processes on
// quit anyway.
//
// The watch looks again on each `state` and `background_tasks` event of a Session (the registry's
// observe). Autopilot tells no subscriber of its own, so it is looked at every 2 s
// (IDLE_POLL_MS); the look is a few reads in memory.
import type { AgentEvent, SessionState } from '../../shared/agent/events'

/** How often the watch looks at Autopilot, which sends no event it could follow. */
export const IDLE_POLL_MS = 2000

/** What the rule needs of a live Session. */
export interface IdleSession {
  state: SessionState
  /** The number of its live background tasks (Session.backgroundTasks()). */
  backgroundTasks: number
}

export interface IdleSources {
  sessions: () => readonly IdleSession[]
  autopilotRunning: () => boolean
}

const inTurn = (state: SessionState): boolean => state === 'busy' || state === 'needs_permission'

/** Nothing works: spec R6. */
export function idle({ sessions, autopilotRunning }: IdleSources): boolean {
  if (sessions().some((session) => inTurn(session.state) || session.backgroundTasks > 0)) return false
  return !autopilotRunning()
}

/** Something that says whether nothing works now, and tells its subscribers when that changes. */
export interface IdleSignal {
  readonly idle: boolean
  /** Answers the unsubscribe. */
  subscribe(listener: (idle: boolean) => void): () => void
}

export interface IdleWatchOptions {
  sources: IdleSources
  /** Every event of every Session (SessionRegistry.observe); answers the unsubscribe. */
  observe: (listener: (sessionId: string, event: AgentEvent) => void) => () => void
}

/** Follows `idle` while started; each listener hears each change once. */
export class IdleWatch implements IdleSignal {
  private value = false
  private readonly listeners = new Set<(idle: boolean) => void>()

  constructor(private readonly options: IdleWatchOptions) {}

  get idle(): boolean {
    return this.value
  }

  subscribe(listener: (idle: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Looks now, then on each Session event that may change the answer and every 2 s; the function returned stops it. */
  start(): () => void {
    this.value = this.look()
    const unobserve = this.options.observe((_sessionId, event) => {
      if (event.type === 'state' || event.type === 'background_tasks') this.update()
    })
    const timer = setInterval(() => this.update(), IDLE_POLL_MS)
    return () => {
      clearInterval(timer)
      unobserve()
    }
  }

  private look(): boolean {
    try {
      return idle(this.options.sources)
    } catch (error) {
      // A source that fails says nothing about quiet: taken as work, so no restart comes of it.
      console.warn('[update] whether anything works could not be read', error)
      return false
    }
  }

  private update(): void {
    const next = this.look()
    if (next === this.value) return
    this.value = next
    for (const listener of [...this.listeners]) {
      try {
        listener(next)
      } catch (error) {
        console.warn('[update] a listener of the idle watch failed', error)
      }
    }
  }
}
