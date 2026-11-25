// The one scheduler of the Assistant's checks of sources (worfy-assistant ticket 04; the spec's section on
// the schedule of checks). A check registers by its kind (CHECK_KINDS); the settings say whether the kind is on, its
// interval and whether it sleeps outside work hours (src/shared/assistant/schedule/settings.ts). Other
// periodic work of main keeps its own timers; this one is for the checks of sources only.
//
// When a check goes: its last start plus its interval, spread by ±SCHEDULE_JITTER of the interval, drawn
// anew after every run, so checks of several kinds do not keep landing together. The first run of a kind
// that never ran goes at once. A check that sleeps outside work hours and falls due outside them goes at
// the next start of work hours (nextWorkHoursStart). A due time that has passed — the Mac slept, worfy was
// closed — gives one run at once, not one per missed interval; the run is told `since`, the start of the
// last run that succeeded, so it covers the whole gap.
//
// One run of a kind at a time: a check still running is not started again, by its timer or by runNow; when
// it ends, its next time is planned from its start, and a time already passed makes it go at once. A run
// that throws is written to the console and tried again after its interval; `since` stays at the last
// success.
//
// The Mac's sleep: suspend() clears the timer and refuses every start until resume(), which plans again —
// so no check goes while the Mac sleeps, and the missed one goes on waking. worfy closed: the starts and
// successes are kept by a CheckMarksStore (a file in worfy's data folder, src/main/assistant/schedule/app.ts),
// so the scheduler of the next start knows when each kind last ran.
//
// Time is the clock given (`now`); the timer waits at most MAX_TIMER_MS at once and plans again on waking,
// so a change of the system clock or of the time zone is caught within that time.
import { z } from 'zod'
import { checkKindSchema, checkSettingsOf, workHoursOf, type AssistantScheduleSettings, type CheckKind } from '../../../shared/assistant/schedule/settings'
import { inWorkHours, nextWorkHoursStart } from '../../../shared/assistant/schedule/work-hours'

/** The spread of a check's interval, as a share of it: ±10 %. */
export const SCHEDULE_JITTER = 0.1

/** The longest a timer of the scheduler waits before it plans again: an hour. */
export const MAX_TIMER_MS = 60 * 60_000

const MINUTE_MS = 60_000

/** What a run of a check is told. */
export interface CheckRunContext {
  kind: CheckKind
  /** The start of the last run of this kind that succeeded; null when none has. */
  since: number | null
  /** The start of this run, by the scheduler's clock. */
  now: number
}

export type CheckRun = (context: CheckRunContext) => Promise<void>

/** When a kind last started a run, and when the last run that succeeded started. */
export const checkMarkSchema = z.object({ startedAt: z.number().optional(), succeededAt: z.number().optional() })
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
    const entry: Entry = { run, running: false, spread: this.draw() }
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

  /** The settings changed: plans again by them. */
  reschedule(): void {
    this.plan()
  }

  /** Whether a run of `kind` is in progress. */
  running(kind: CheckKind): boolean {
    return this.entries.get(kind)?.running === true
  }

  /**
   * Starts a run of `kind` now, whatever its time; answers false and starts nothing when it is not
   * registered, already running, or the scheduler is stopped or asleep.
   */
  runNow(kind: CheckKind): boolean {
    const entry = this.entries.get(kind)
    if (entry === undefined || entry.running || !this.started || this.asleep) return false
    this.launch(kind, entry)
    return true
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
    if (!check.enabled) return null
    const startedAt = this.readMarks()[kind]?.startedAt
    const due = startedAt === undefined ? now : startedAt + Math.round(check.intervalMinutes * MINUTE_MS * (1 + entry.spread))
    const moment = Math.max(due, now)
    if (!check.sleepOutsideWorkHours) return moment
    const hours = workHoursOf(settings)
    return inWorkHours(moment, hours) ? moment : nextWorkHoursStart(moment, hours)
  }

  private launch(kind: CheckKind, entry: Entry): void {
    const now = this.options.now()
    const since = this.readMarks()[kind]?.succeededAt ?? null
    entry.running = true
    this.mark(kind, { startedAt: now })
    let result: Promise<void>
    try {
      result = Promise.resolve(entry.run({ kind, since, now }))
    } catch (error) {
      result = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    void result
      .then(
        () => this.mark(kind, { succeededAt: now }),
        (error: unknown) => console.warn(`[assistant] the ${kind} check failed: ${error instanceof Error ? error.message : String(error)}`),
      )
      .finally(() => {
        entry.running = false
        entry.spread = this.draw()
        this.plan()
      })
  }

  private clear(): void {
    if (this.timer === undefined) return
    ;(this.options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(this.timer)
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
      const due = this.dueOf(kind, entry, now)
      if (due === null) continue
      if (due <= now) this.launch(kind, entry)
      else next = Math.min(next, due)
    }
    if (next === Number.POSITIVE_INFINITY) return
    const wait = Math.min(next - now, MAX_TIMER_MS)
    this.timer = (this.options.setTimer ?? ((callback, ms) => setTimeout(callback, ms)))(() => {
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
