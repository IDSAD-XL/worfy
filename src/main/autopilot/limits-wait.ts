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
// A refusal is told by the Session's Limits status (`rate_limit` events, observeSessionLimits) when
// it came during the turn that ended, and otherwise by the error text of the turn's `result`.
// Claude Code reports the status only when it changes, so a `rejected` left from an earlier turn
// (a window that does not block, such as one with a model fallback or overage) does not turn a later
// error of another kind into a refusal. The timer goes by the
// wall clock, not by a single setTimeout: a Mac that slept anyway would otherwise continue late by
// the time it slept.
//
// A run on a Vendor other than Claude (Codex, worfy-multi-vendor ticket 38): a refusal without a
// window that resets (`limit_reached` with `reason: 'quota'`) is a hit with `quota`, and the run
// stops with `vendor-quota` rather than wait (resume-at.ts). When a wait for a window is over, the
// run reads the Vendor's windows again (stillRefused, with run.ts's AutopilotDeps.usage) before it sends the
// Orchestrator on; so does Auto-continue of a manual turn (src/main/agent/orchestrator-continue.ts, spec Q7 (a)).
//
// With Auto-continue on for the Project (worfy-retry ticket 05, spec Q8 (c)) a reset more than
// MAX_WAIT_MS away is waited for (plan with `farReset`), and the Mac may sleep meanwhile: `keepAwake`
// is false while the continuation is more than MAX_WAIT_MS away, and wait() calls its `awake` then,
// for run.ts to take keep-awake again. A Mac that sleeps through the reset continues at its first
// wake after it (the wall-clock timer).
import type { LimitsState, LimitWindow } from '../../shared/agent/limits'
import { listsWindows } from '../../shared/autopilot/budget-window'
import { isLimitsMessage, MAX_WAIT_MS, resumeAt, stillUsedUp, type LimitsHit, type ResumePlan } from '../../shared/autopilot/resume-at'
import type { SessionLimitsStatus } from '../agent/limits'

/** What the Orchestrator gets when the Limits have reset; continueText() adds the times of the pause. */
export const CONTINUE_TEXT =
  'Continue from where you stopped. Before you continue, add an entry to HANDOFF about the pause for the Limits: from what time until what time.'

/** The message the Orchestrator gets after a pause from `from` until `until` (milliseconds). */
export function continueText(from: number, until: number): string {
  return `${CONTINUE_TEXT}\nPause for the Limits: from ${new Date(from).toISOString()} until ${new Date(until).toISOString()}.`
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

/** Reads the Limits anew: the app's LimitsRefresher.refreshIfOlder (refreshAppUsage). */
export interface VendorUsage {
  refresh(olderThanMs: number, vendor?: string): Promise<void>
}

export interface LimitsWaitDeps {
  /** The Limits state of limits.json (LimitsTracker.snapshot). */
  state(): LimitsState
  /**
   * The windows of a Vendor other than Claude as last read (LimitsTracker.windowsOf); null when
   * unknown. Absent: a run on such a Vendor reads no windows, and its budget and lines have none.
   */
  windows?(vendor: string): readonly LimitWindow[] | null
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
  /** Whether `status` came during the current turn (since the last turnStarted). */
  private fresh = false
  /** The id of the last wait (wait()); a timer of an earlier one resumes nothing. */
  private id = 0
  /** When the current wait began: the first refusal not followed by a turn that went through. */
  private since: number | null = null
  private cancelTimer: (() => void) | null = null
  private untilValue: number | null = null
  private windowValue: string | null = null
  private farValue = false
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

  /**
   * The window of the last plan (`at`); null for a plan with no reset time known, the run then tries
   * again every RECHECK_MS (worfy-retry ticket 05). Meaningful while `until` is set.
   */
  get window(): string | null {
    return this.windowValue
  }

  /**
   * Whether the current wait goes past MAX_WAIT_MS only because Auto-continue is on (the plan's `far`):
   * the switch turned off ends it, and so does a Stop (run.ts). Meaningful while `until` is set.
   */
  get far(): boolean {
    return this.farValue
  }

  /**
   * Whether the run holds keep-awake: always, but during a wait whose continuation is more than
   * MAX_WAIT_MS away (Auto-continue on, a far reset; spec Q8 (c)).
   */
  get keepAwake(): boolean {
    return this.untilValue === null || this.untilValue - this.now() <= MAX_WAIT_MS
  }

  /** Follows the Limits status of the run's Session; answers the unsubscribe. */
  watch(isSession: (sessionId: string) => boolean): () => void {
    return this.deps.observeSession(isSession, (status) => {
      this.status = status
      this.fresh = true
    })
  }

  /** A turn of the Session began (its `prompt` event): a Limits status from before it is no longer news. */
  turnStarted(): void {
    this.fresh = false
  }

  /**
   * The refusal a turn's end means, or null. A turn that ended with an error (not interrupted) is
   * refused when the Session was told `rejected` during the turn, or when its error text is about
   * the Limits; in the second case a `rejected` known from before still gives the window and time.
   * A refusal by a quota (status `quota`) says so in the hit.
   */
  hitOf(end: TurnEnd): LimitsHit | null {
    if (!end.isError || end.interrupted) return null
    const status = this.status
    const rejected = status?.status === 'rejected' ? { window: status.window, resetsAt: status.resetsAt, ...(status.quota === true ? { quota: true as const } : {}) } : null
    if (rejected !== null && this.fresh) return rejected
    if (isLimitsMessage(end.message)) return rejected ?? { window: null, resetsAt: null }
    return null
  }

  /**
   * When the run continues after `hit`; the first refusal of a wait starts its clock. `farReset`:
   * Auto-continue is on for the Project — a known reset more than MAX_WAIT_MS away is waited for.
   */
  plan(hit: LimitsHit, farReset = false): ResumePlan {
    const now = this.now()
    this.since ??= now
    const plan = resumeAt({ hit, limits: this.deps.state(), now, since: this.since, ...(farReset ? { farReset: 'wait' as const } : {}) })
    this.windowValue = plan.kind === 'at' ? plan.window : null
    this.farValue = plan.kind === 'at' && plan.far === true
    return plan
  }

  /**
   * Waits until `at`, then calls `fire` once; answers the wait's id (isCurrent). With `at` more than
   * MAX_WAIT_MS away, calls `awake` once MAX_WAIT_MS before it (keepAwake turns true then).
   */
  wait(at: number, fire: () => void, awake?: () => void): number {
    this.cancel()
    this.id += 1
    this.untilValue = at
    const cancels = [this.schedule(at, fire)]
    if (awake !== undefined && !this.keepAwake) cancels.push(this.schedule(at - MAX_WAIT_MS, awake))
    this.cancelTimer = () => {
      for (const cancel of cancels) cancel()
    }
    return this.id
  }

  /**
   * Whether the wait `id` still goes on: not cancelled, resumed or replaced by a later one. A timer
   * that fired before its wait was cancelled has its step queued in the run's order; the step asks
   * this, so it never resumes a wait that is not its own.
   */
  isCurrent(id: number): boolean {
    return this.untilValue !== null && this.id === id
  }

  /**
   * The wait is over: answers the message for the Orchestrator, with the pause from its first refusal
   * until now. After a far wait the next refusal starts a new wait: the MAX_WAIT_MS of its tries
   * without a reset time count from it, not from a refusal days ago.
   */
  resume(): string {
    const now = this.now()
    const text = continueText(this.since ?? now, now)
    if (this.farValue) this.since = null
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

  /** The windows of `vendor` as last read; [] when unknown or without the dep (LimitsWaitDeps.windows). */
  windowsOf(vendor: string): readonly LimitWindow[] {
    return this.deps.windows?.(vendor) ?? []
  }

  /** The clock of the wait, in milliseconds. */
  clock(): number {
    return this.now()
  }

  /**
   * After a wait on a Vendor other than Claude: its windows read anew (`usage.refresh` with the Vendor and
   * age 0, a poll whatever is known — free, no model tokens), then judged as known. A window still used up
   * with its reset ahead is the hit to wait for once more; null goes on — no window used up, or a read
   * that failed and left windows whose resets have passed (the turn then shows whether it is refused).
   * Claude reads nothing here: null. Without `usage` the windows known decide. `cutShort` ends the wait
   * for the read at once (a run's Force stop or the quit).
   */
  async stillRefused(vendor: string, usage: VendorUsage | undefined, cutShort?: Promise<unknown>): Promise<LimitsHit | null> {
    if (!listsWindows(vendor)) return null
    if (usage !== undefined) {
      try {
        await (cutShort === undefined ? usage.refresh(0, vendor) : Promise.race([usage.refresh(0, vendor), cutShort]))
      } catch (error) {
        console.warn(`[limits] could not read the Limits of ${vendor} after the wait; the windows known decide`, error)
      }
    }
    return stillUsedUp(this.windowsOf(vendor), this.clock())
  }

  /** Sends the message to the Session. */
  send(sessionId: string, text: string): void {
    this.deps.send(sessionId, text)
  }
}
