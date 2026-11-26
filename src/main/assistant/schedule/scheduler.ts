// The one scheduler of the Assistant's checks of sources (worfy-assistant ticket 04; the spec's section on
// the schedule of checks). A check registers by its kind (CHECK_KINDS); the settings say whether the kind is on, its
// interval and whether it sleeps outside work hours (src/shared/assistant/schedule/settings.ts). Other
// periodic work of main keeps its own timers; this one is for the checks of sources only.
//
// When a check goes: its last start plus its interval, spread by ±SCHEDULE_JITTER of the interval, drawn
// anew after every run, so checks of several kinds do not keep landing together. The first run of a kind
// that never ran goes at once. A check that sleeps outside work hours and falls due outside them goes at
// the next start of work hours (nextWorkHoursStart), plus up to SCHEDULE_JITTER of its interval by its draw,
// so the sleeping checks do not all go at the first millisecond. A due time that has passed — the Mac slept,
// worfy was closed — gives one run at once, not one per missed interval; the run is told `since`, the start
// of the last run that succeeded (or how far it covered, when it says so: CheckRunResult), so it covers the whole
// gap. A last start in the future (the clock was
// moved back) counts as now.
//
// One run of a kind at a time: a check still running is not started again, by any plan or by runNow; when
// it ends, its next time is planned from its start, and a time already passed makes it go at once. A run
// that throws, or does not end within CHECK_RUN_TIMEOUT_MS, is written to the console and tried again after
// its interval; `since` stays at the last success.
//
// Failures in a row (worfy-assistant ticket 22): a check of an outside source (BACKOFF_KINDS) that failed
// BACKOFF_AFTER_FAILURES times in a row waits BACKOFF_FACTOR times longer with each further failure, up to
// BACKOFF_CEILING_MS — a broken connector is not asked, and paid for, every few minutes without end. The
// first success brings the usual interval back, and so does the person turning the check on again or changing its
// interval (reschedule): they ask for the check, so it is no longer held back. The count is kept in the marks, so it
// outlives a restart.
//
// The Assistant turned off (worfy-assistant ticket 15; the option `active`): no kind goes while it is off, so
// turning it off in Settings stops every check of a source, whatever each check's own switch says.
//
// The Mac's sleep: suspend() clears the timer and refuses every start until resume(), which plans again —
// so no check goes while the Mac sleeps, and the missed one goes on waking. worfy closed: the starts and
// successes are kept by a CheckMarksStore (a file in worfy's data folder, src/main/assistant/schedule/app.ts),
// so the scheduler of the next start knows when each kind last ran.
//
// Time is the clock given (`now`); the timer waits at most MAX_TIMER_MS at once and plans again on waking,
// so a change of the system clock or of the time zone is caught within that time.
import { z } from 'zod'
import { CHECK_INTERVAL_BOUNDS, checkKindSchema, checkSettingsOf, SOURCE_CHECK_KINDS, workHoursOf, type AssistantScheduleSettings, type CheckKind } from '../../../shared/assistant/schedule/settings'
import { inWorkHours, nextWorkHoursStart, workWindowStartOf } from '../../../shared/assistant/schedule/work-hours'
import type { CheckNowRefusal } from '../../../shared/assistant/settings-view'

/** The spread of a check's interval, as a share of it: ±10 %. */
export const SCHEDULE_JITTER = 0.1

/** The longest a timer of the scheduler waits before it plans again: an hour. */
export const MAX_TIMER_MS = 60 * 60_000

/**
 * The longest one run of a check may take: 10 minutes. A run still going then counts as failed — the kind
 * plans again and `since` stays at the last success — and its late answer is ignored. The run itself is
 * not stopped (the scheduler cannot cancel it); one that never ends keeps its resources.
 */
export const CHECK_RUN_TIMEOUT_MS = 10 * 60_000

const MINUTE_MS = 60_000

/** How many failures in a row a check of BACKOFF_KINDS takes at its usual interval: the next one makes it wait longer. Decided without the owner (ticket 22). */
export const BACKOFF_AFTER_FAILURES = 3

/** How many times longer a backed-off check waits with each further failure in a row. Decided without the owner (ticket 22). */
export const BACKOFF_FACTOR = 2

/** The longest a backed-off check waits: the upper bound of a check's interval in the settings, a day. */
export const BACKOFF_CEILING_MS = CHECK_INTERVAL_BOUNDS.max * MINUTE_MS

/**
 * The kinds that back off: the checks of outside sources, whose every call is paid and whose window `since…now` grows
 * with each failure. The CI of the main branch (`main-ci`, ticket 21) keeps its interval: its read costs nothing, and
 * a red main branch must be seen soon after the network comes back. Decided without the owner (ticket 22).
 */
export const BACKOFF_KINDS: readonly CheckKind[] = SOURCE_CHECK_KINDS

/** The interval of a check of `kind` after `failures` failures in a row, in ms: the usual one until the backoff. */
export function backedOffInterval(kind: CheckKind, interval: number, failures: number): number {
  if (!BACKOFF_KINDS.includes(kind) || failures < BACKOFF_AFTER_FAILURES) return interval
  // The exponent is bounded so a long count cannot overflow to Infinity: the ceiling is reached long before.
  const steps = Math.min(failures - BACKOFF_AFTER_FAILURES + 1, 32)
  return Math.max(interval, Math.min(BACKOFF_CEILING_MS, interval * BACKOFF_FACTOR ** steps))
}

/** What a run of a check is told. */
export interface CheckRunContext {
  kind: CheckKind
  /** The start of the last run of this kind that succeeded, or how far it covered (CheckRunResult); null when none has. */
  since: number | null
  /** The start of this run, by the scheduler's clock. */
  now: number
}

/**
 * What a run that succeeded may say: it covered its source only up to `coveredUntil` (ms since the epoch), not up to
 * its start — an answer at its cap (worfy-assistant ticket 11). The next run is then told that as `since`.
 */
export interface CheckRunResult {
  coveredUntil?: number
}

export type CheckRun = (context: CheckRunContext) => Promise<void | CheckRunResult>

/**
 * When a kind last started a run, when the last run that succeeded started, and how many runs failed in a row since
 * (ticket 22; absent — none). A count the schema refuses (a file edited by hand) reads as none, so the file is not set
 * aside for it. A build before ticket 22 reads a mark with `failures` and drops the field: its object schema is not
 * strict, so it does not set the file aside either.
 */
export const checkMarkSchema = z.object({ startedAt: z.number().optional(), succeededAt: z.number().optional(), failures: z.number().int().min(1).optional().catch(undefined) })
export type CheckMark = z.output<typeof checkMarkSchema>

export const checkMarksSchema = z.partialRecord(checkKindSchema, checkMarkSchema)
export type CheckMarks = z.output<typeof checkMarksSchema>

/** Where the marks outlive a restart of worfy. */
export interface CheckMarksStore {
  read(): CheckMarks
  write(marks: CheckMarks): void
}

/** Marks kept in memory only: for tests, and for a run whose file cannot be written. */
export function memoryCheckMarks(initial: CheckMarks = {}): CheckMarksStore {
  let marks: CheckMarks = structuredClone(initial)
  return {
    read: () => structuredClone(marks),
    write: (next) => {
      marks = structuredClone(next)
    },
  }
}

export interface CheckSchedulerOptions {
  /** The clock, in ms. */
  now: () => number
  /** The app settings of this Machine, read at each plan. */
  settings: () => AssistantScheduleSettings
  marks: CheckMarksStore
  /**
   * Whether the Assistant runs (worfy-assistant ticket 15): while it is off, no kind goes, by its time or by runNow.
   * Read at each plan; a change comes through reschedule(). Absent: always on.
   */
  active?: () => boolean
  /** A number in [0, 1]; picks where in the spread the next run lands. */
  random?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

interface Entry {
  run: CheckRun
  running: boolean
  /** The spread of the next run, as a share of the interval; drawn after each run. */
  spread: number
  /** Whether the kind was on, and its interval, at the last reschedule: a change of either clears its failures in a row. */
  seen: { enabled: boolean; intervalMinutes: number }
}

export class CheckScheduler {
  private readonly entries = new Map<CheckKind, Entry>()
  private marks: CheckMarks | undefined
  private timer: unknown
  private started = false
  private asleep = false

  constructor(private readonly options: CheckSchedulerOptions) {}

  /** Registers the check of `kind`; answers a function that removes it. One check per kind. */
  register(kind: CheckKind, run: CheckRun): () => void {
    if (this.entries.has(kind)) throw new Error(`a check of kind ${kind} is registered already`)
    const { enabled, intervalMinutes } = checkSettingsOf(this.options.settings(), kind)
    const entry: Entry = { run, running: false, spread: this.draw(), seen: { enabled, intervalMinutes } }
    this.entries.set(kind, entry)
    this.plan()
    return () => {
      if (this.entries.get(kind) !== entry) return
      this.entries.delete(kind)
      this.plan()
    }
  }

  /** Starts planning: a check overdue since the last start of worfy goes at once. */
  start(): void {
    this.started = true
    this.plan()
  }

  /** Stops: no timer, no new run. A run in progress ends on its own. */
  stop(): void {
    this.started = false
    this.clear()
  }

  /** The Mac goes to sleep: no check goes until resume(). */
  suspend(): void {
    this.asleep = true
    this.clear()
  }

  /** The Mac woke: what fell due meanwhile goes at once, once. */
  resume(): void {
    this.asleep = false
    this.plan()
  }

  /**
   * The settings changed: plans again by them. A kind turned on again, or given another interval, loses its failures
   * in a row: the person asked for the check, so its next run is its plain interval (ticket 22).
   */
  reschedule(): void {
    const settings = this.options.settings()
    for (const [kind, entry] of this.entries) {
      const { enabled, intervalMinutes } = checkSettingsOf(settings, kind)
      const turnedOn = enabled && !entry.seen.enabled
      const newInterval = intervalMinutes !== entry.seen.intervalMinutes
      entry.seen = { enabled, intervalMinutes }
      const failures = this.readMarks()[kind]?.failures
      if ((turnedOn || newInterval) && failures !== undefined) {
        this.mark(kind, { failures: undefined })
        if (failures >= BACKOFF_AFTER_FAILURES) console.info(`[assistant] the ${kind} check was ${turnedOn ? 'turned on again' : 'given another interval'}: back to its usual interval`)
      }
    }
    this.plan()
  }

  /** Whether a run of `kind` is in progress. */
  running(kind: CheckKind): boolean {
    return this.entries.get(kind)?.running === true
  }

  /**
   * Why runNow(kind) would start nothing now; null when it would start a run. The person's Check now shows it (ticket 15).
   */
  whyNotNow(kind: CheckKind): CheckNowRefusal | null {
    const entry = this.entries.get(kind)
    if (entry === undefined) return 'not-registered'
    if (!this.started) return 'stopped'
    if (this.asleep) return 'asleep'
    if (!this.active()) return 'assistant-off'
    if (!checkSettingsOf(this.options.settings(), kind).enabled) return 'check-off'
    if (entry.running) return 'running'
    return null
  }

  /**
   * Starts a run of `kind` now, whatever its time; answers false and starts nothing when it is not
   * registered, already running, the scheduler is stopped or asleep, the Assistant is off, or the person turned the
   * check off (whyNotNow says which).
   */
  runNow(kind: CheckKind): boolean {
    const entry = this.entries.get(kind)
    if (entry === undefined || this.whyNotNow(kind) !== null) return false
    this.launch(kind, entry)
    return true
  }

  /** How many runs of `kind` failed in a row, as the marks keep it (ticket 22); 0 when none did. Settings show it (ticket 15). */
  failures(kind: CheckKind): number {
    return this.readMarks()[kind]?.failures ?? 0
  }

  private active(): boolean {
    return this.options.active?.() ?? true
  }

  /** When `kind` goes next by the settings in force; null when it is off or not registered. */
  nextRun(kind: CheckKind): number | null {
    const entry = this.entries.get(kind)
    if (entry === undefined) return null
    return this.dueOf(kind, entry, this.options.now())
  }

  private draw(): number {
    const random = Math.min(1, Math.max(0, (this.options.random ?? Math.random)()))
    return (random * 2 - 1) * SCHEDULE_JITTER
  }

  private readMarks(): CheckMarks {
    this.marks ??= this.options.marks.read()
    return this.marks
  }

  private mark(kind: CheckKind, change: CheckMark): void {
    const marks = this.readMarks()
    marks[kind] = { ...marks[kind], ...change }
    try {
      this.options.marks.write(marks)
    } catch (error) {
      console.warn(`[assistant] the marks of the checks could not be written: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The moment `kind` goes next, not before `now`; null when it is off. */
  private dueOf(kind: CheckKind, entry: Entry, now: number): number | null {
    const settings = this.options.settings()
    const check = checkSettingsOf(settings, kind)
    if (!check.enabled || !this.active()) return null
    const mark = this.readMarks()[kind]
    const startedAt = mark?.startedAt
    const interval = check.intervalMinutes * MINUTE_MS
    const wait = backedOffInterval(kind, interval, mark?.failures ?? 0)
    // A start in the future (the clock was moved back) plan() has already brought to now.
    const due = startedAt === undefined ? null : startedAt + Math.round(wait * (1 + entry.spread))
    const moment = Math.max(due ?? now, now)
    if (!check.sleepOutsideWorkHours) return moment
    // A check that had to wait for work hours — it fell due outside them, or never ran — goes after their
    // start by its share of the spread, so the sleeping checks do not all go at the first millisecond. The
    // window's start, not `now`, anchors it: a plan made early in the window does not cut the spread short.
    const hours = workHoursOf(settings)
    const spread = (start: number): number => {
      const later = start + Math.round(interval * ((entry.spread + SCHEDULE_JITTER) / 2))
      return inWorkHours(later, hours) ? later : start
    }
    const windowStart = workWindowStartOf(moment, hours)
    if (windowStart === null) return spread(nextWorkHoursStart(moment, hours))
    return due === null || windowStart > due ? Math.max(moment, spread(windowStart)) : moment
  }

  private launch(kind: CheckKind, entry: Entry): void {
    const now = this.options.now()
    const since = this.readMarks()[kind]?.succeededAt ?? null
    entry.running = true
    this.mark(kind, { startedAt: now })
    // The run ends once: by its answer or by the time limit, whichever comes first; the other is ignored.
    let ended = false
    const end = (succeeded: boolean, coveredUntil?: number): void => {
      if (ended) return
      ended = true
      this.clearTimer(limit)
      const failures = this.readMarks()[kind]?.failures ?? 0
      // A run that covered only part of its time moves `since` that far, never past its own start.
      if (succeeded) this.mark(kind, { succeededAt: coveredUntil === undefined ? now : Math.min(now, coveredUntil), failures: undefined })
      else if (BACKOFF_KINDS.includes(kind)) this.mark(kind, { failures: failures + 1 })
      entry.running = false
      entry.spread = this.draw()
      this.noteBackoff(kind, entry, succeeded ? 0 : failures + 1, failures)
      this.plan()
    }
    const limit = this.setTimer(() => {
      console.warn(`[assistant] the ${kind} check did not end in ${CHECK_RUN_TIMEOUT_MS / MINUTE_MS} minutes: counted as failed`)
      end(false)
    }, CHECK_RUN_TIMEOUT_MS)
    let result: Promise<void | CheckRunResult>
    try {
      result = Promise.resolve(entry.run({ kind, since, now }))
    } catch (error) {
      result = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    void result.then(
      (answer) => end(true, answer?.coveredUntil),
      (error: unknown) => {
        if (!ended) console.warn(`[assistant] the ${kind} check failed: ${error instanceof Error ? error.message : String(error)}`)
        end(false)
      },
    )
  }

  /** One line when the backoff of `kind` begins and one when a success lifts it; nothing for the failures between. */
  private noteBackoff(kind: CheckKind, entry: Entry, failures: number, before: number): void {
    if (!BACKOFF_KINDS.includes(kind)) return
    if (failures === BACKOFF_AFTER_FAILURES) {
      const next = this.dueOf(kind, entry, this.options.now())
      const when = next === null ? 'none while it is off' : `the next run at ${new Date(next).toISOString()}`
      console.warn(`[assistant] the ${kind} check failed ${failures} times in a row: it backs off, ${when}`)
    } else if (failures === 0 && before >= BACKOFF_AFTER_FAILURES) {
      console.info(`[assistant] the ${kind} check succeeded after ${before} failures in a row: back to its usual interval`)
    }
  }

  private setTimer(callback: () => void, ms: number): unknown {
    return (this.options.setTimer ?? ((run, wait) => setTimeout(run, wait)))(callback, ms)
  }

  private clearTimer(timer: unknown): void {
    ;(this.options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(timer)
  }

  private clear(): void {
    if (this.timer === undefined) return
    this.clearTimer(this.timer)
    this.timer = undefined
  }

  /** Starts every check whose time has come and sets the timer for the next one. */
  private plan(): void {
    this.clear()
    if (!this.started || this.asleep) return
    const now = this.options.now()
    let next = Number.POSITIVE_INFINITY
    for (const [kind, entry] of this.entries) {
      if (entry.running) continue
      // The clock was moved back past the last start: from now on that start is now, so the due time
      // stops sliding with the clock.
      const startedAt = this.readMarks()[kind]?.startedAt
      if (startedAt !== undefined && startedAt > now) this.mark(kind, { startedAt: now })
      const due = this.dueOf(kind, entry, now)
      if (due === null) continue
      if (due <= now) this.launch(kind, entry)
      else next = Math.min(next, due)
    }
    if (next === Number.POSITIVE_INFINITY) return
    const wait = Math.min(next - now, MAX_TIMER_MS)
    this.timer = this.setTimer(() => {
      this.timer = undefined
      this.plan()
    }, wait)
  }
}

/** The system's sleep and wake, as Electron's powerMonitor gives them. */
export interface PowerEvents {
  on(event: 'suspend' | 'resume', listener: () => void): unknown
  removeListener?(event: 'suspend' | 'resume', listener: () => void): unknown
}

/** Passes the system's `suspend` and `resume` to `scheduler`; answers a function that stops it. */
export function followPower(scheduler: CheckScheduler, power: PowerEvents): () => void {
  const suspend = (): void => scheduler.suspend()
  const resume = (): void => scheduler.resume()
  power.on('suspend', suspend)
  power.on('resume', resume)
  return () => {
    // A stand-in without removeListener (a test's mock of powerMonitor) keeps the two listeners; they do
    // nothing once the scheduler is stopped, and the stop must not throw inside a will-quit listener.
    power.removeListener?.('suspend', suspend)
    power.removeListener?.('resume', resume)
  }
}
