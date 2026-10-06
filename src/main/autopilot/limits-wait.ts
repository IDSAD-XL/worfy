// The wait of an Autopilot run for the Limits (worfy-daily ticket 05): what happens when the run's
// Orchestrator Session is refused by the Limits.
//
// 1. The turn that ended with the refusal does not end the Wave: the run goes `waiting`, and keeps
//    keep-awake (run.ts holds it until the run stops).
// 2. A timer is set to the time the run continues (src/shared/autopilot/resume-at.ts): the reset of
//    the refused window plus a margin, or a fixed interval when no reset time is known.
// 3. When it fires, the Orchestrator gets CONTINUE_TEXT with the times of the pause, once. The
//    Orchestrator writes the pause into HANDOFF itself: worfy writes nothing into the Project's
//    repository (ADR-0005).
//
// A refusal is told by the Session's Limits status (`rate_limit` events, observeSessionLimits) and,
// when that event did not parse, by the error text of the turn's `result`. The timer goes by the
// wall clock, not by a single setTimeout: a Mac that slept anyway would otherwise continue late by
// the time it slept.
import type { LimitsState } from '../../shared/agent/limits'
import { isLimitsMessage, resumeAt, type LimitsHit, type ResumePlan } from '../../shared/autopilot/resume-at'
import type { SessionLimitsStatus } from '../agent/limits'

/** What the Orchestrator gets when the Limits have reset; continueText() adds the times of the pause. */
export const CONTINUE_TEXT =
  'Продолжай с того места, где остановился. Перед продолжением добавь в HANDOFF запись о паузе по Limits: с какого и до какого времени.'

/** The message the Orchestrator gets after a pause from `from` until `until` (milliseconds). */
export function continueText(from: number, until: number): string {
  return `${CONTINUE_TEXT}\nПауза по Limits: с ${new Date(from).toISOString()} до ${new Date(until).toISOString()}.`
}

/** The wall-clock timer checks the time at least this often. */
export const WALL_TICK_MS = 60_000

/** Calls `fire` once, as soon as the wall clock `now` reaches `at`; answers the cancel. */
export function wallTimer(now: () => number = Date.now): (at: number, fire: () => void) => () => void {
  return (at, fire) => {
    let handle: ReturnType<typeof setTimeout> | null = null
    const check = (): void => {
      const left = at - now()
      if (left <= 0) {
        handle = null
        fire()
        return
      }
      handle = setTimeout(check, Math.min(left, WALL_TICK_MS))
    }
    handle = setTimeout(check, 0)
    return () => {
      if (handle !== null) clearTimeout(handle)
      handle = null
    }
  }
}

export interface LimitsWaitDeps {
  /** The Limits state of limits.json (LimitsTracker.snapshot). */
  state(): LimitsState
  /** Reports each change of the Limits status of the Session `isSession` accepts (observeSessionLimits); answers the unsubscribe. */
  observeSession(isSession: (sessionId: string) => boolean, listener: (status: SessionLimitsStatus) => void): () => void
  /** Sends a message to the Session (Session.send); throws when the Session is gone. */
  send(sessionId: string, text: string): void
  /** The clock, in milliseconds; tests pass a fixed one. */
  now?(): number
  /** Calls `fire` once at the wall time `at`; answers the cancel (default wallTimer). */
  schedule?(at: number, fire: () => void): () => void
}

/** The end of a turn, as far as the wait needs it. */
export interface TurnEnd {
  isError: boolean
  interrupted: boolean
  /** The turn's error text, or null. */
  message: string | null
}

/** The Limits wait of one run. */
export class LimitsWait {
  private status: SessionLimitsStatus | null = null
  /** When the current wait began: the first refusal not followed by a turn that went through. */
  private since: number | null = null
  private cancelTimer: (() => void) | null = null
  private untilValue: number | null = null
  private readonly now: () => number
  private readonly schedule: (at: number, fire: () => void) => () => void

  constructor(private readonly deps: LimitsWaitDeps) {
    this.now = deps.now ?? Date.now
    this.schedule = deps.schedule ?? wallTimer(this.now)
  }

  /** While the run waits: when it continues (milliseconds); otherwise null. */
  get until(): number | null {
    return this.untilValue
  }

  /** Follows the Limits status of the run's Session; answers the unsubscribe. */
  watch(isSession: (sessionId: string) => boolean): () => void {
    return this.deps.observeSession(isSession, (status) => {
      this.status = status
    })
  }

  /**
   * The refusal a turn's end means, or null: a turn that ended with an error (not interrupted)
   * while the Session's last Limits status is `rejected`, or whose error text is about the Limits.
   */
  hitOf(end: TurnEnd): LimitsHit | null {
    if (!end.isError || end.interrupted) return null
    if (this.status?.status === 'rejected') return { window: this.status.window, resetsAt: this.status.resetsAt }
    if (isLimitsMessage(end.message)) return { window: null, resetsAt: null }
    return null
  }

  /** When the run continues after `hit`; the first refusal of a wait starts its clock. */
  plan(hit: LimitsHit): ResumePlan {
    const now = this.now()
    this.since ??= now
    return resumeAt({ hit, limits: this.deps.state(), now, since: this.since })
  }

  /** Waits until `at`, then calls `fire` once. */
  wait(at: number, fire: () => void): void {
    this.cancel()
    this.untilValue = at
    this.cancelTimer = this.schedule(at, fire)
  }

  /** The wait is over: answers the message for the Orchestrator, with the pause from its first refusal until now. */
  resume(): string {
    const now = this.now()
    const text = continueText(this.since ?? now, now)
    this.cancel()
    return text
  }

  /** A turn of the Wave ended without a refusal: no wait goes on, and the next refusal starts a new one. */
  passed(): void {
    this.since = null
    this.cancel()
  }

  /** Cancels the timer; no message goes out. */
  cancel(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    this.untilValue = null
  }

  /** Sends the message to the Session. */
  send(sessionId: string, text: string): void {
    this.deps.send(sessionId, text)
  }
}
