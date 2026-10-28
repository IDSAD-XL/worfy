// The budget of the Limits for an Autopilot run (worfy-throughput ticket 41): Autopilot does not
// spend the week to its end before the owner gets to work by hand. Everything here is pure;
// src/main/autopilot/run.ts asks it before each Wave, never inside one.
//
// - The share of a day = (1 − reserve − used) / days until the 7-day window resets, the days counted
//   from the start of the local day, today included. `used` is the window's share at the start of
//   the day: the first number of today the journals hold (`limits` of wave-started and
//   wave-finished, ticket 40) for the same window, else the number now. So the share stays the same
//   all day, and a reset of the window in the middle of the day starts it anew from the new window.
// - Used today = the share now − the share at the start of the day. What is left of the day =
//   the share of the day − used today.
// - The next Wave does not start when nothing is left of the day, or less than the estimate of the
//   Wave (limits-estimate.ts: the median per Ticket × the Tickets ready). The run then waits until
//   the start of the next local day, or the 7-day reset when that comes first.
// - With the day's share left but the 5-hour window full (share at 1 or `rejected`), the Wave does
//   not start either: the run waits until the 5-hour reset or the start of the next day, whichever
//   is first, so it goes on at night by itself.
// - Nothing known of the 7-day window, no reset time, or a number older than BUDGET_FRESH_MS: no
//   stop. The refusal of the Limits inside a Wave (resume-at.ts) stays the hard limit.
//
// shortcut: the day starts with the first number of today the journals hold, so what the owner used
// by hand before the first Wave of the day is not counted as today's; redo when the usage is
// sampled at midnight on its own.
import { SAME_WINDOW_RESET_GAP_S, type LimitsState, type LimitWindowState } from '../agent/limits'
import type { BUDGET_CAUSES, JournalEvent } from './journal'
import type { WaveEstimate } from './limits-estimate'
import { RESUME_MARGIN_MS, toMs } from './resume-at'

/** A 7-day or 5-hour number older than this does not decide anything. */
export const BUDGET_FRESH_MS = 30 * 60_000

/** A 5-hour window at this share or above is full. */
export const FIVE_HOUR_FULL = 1

const DAY_MS = 24 * 60 * 60_000

/** The budget settings in force (Settings → Autopilot): on or off, and the reserve of the week, 0..1. */
export interface AutopilotBudget {
  enabled: boolean
  reserve: number
}

/** The start of the local day of `ms`. */
export function localDayStart(ms: number): number {
  const day = new Date(ms)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** The start of the local day after the one of `ms`. */
export function nextLocalDayStart(ms: number): number {
  const day = new Date(ms)
  day.setHours(24, 0, 0, 0)
  return day.getTime()
}

/** The days with a share from the local day of `from` until `resetsAt`, the day of `from` included; at least 1. */
export function daysToReset(from: number, resetsAt: number): number {
  return Math.max(1, Math.ceil((resetsAt - localDayStart(from)) / DAY_MS))
}

/** The share of one day: the week left after the reserve and `used`, over `days` (at least 1); never below 0. */
export function dailyShare({ reserve, used, days }: { reserve: number; used: number; days: number }): number {
  return Math.max(0, (1 - reserve - used) / Math.max(1, days))
}

/** A number of the 7-day window: when it was got, the share, the reset (ms, null when unknown). */
export interface BudgetReading {
  at: number
  utilization: number
  resetsAt: number | null
}

/** The 7-day numbers of the Wave lines of the runs, in no particular order. */
export function weekReadings(runs: readonly (readonly JournalEvent[])[]): BudgetReading[] {
  const out: BudgetReading[] = []
  for (const events of runs) {
    for (const event of events) {
      if (event.kind !== 'wave-started' && event.kind !== 'wave-finished') continue
      const week = event.limits?.seven_day
      if (week === null || week === undefined || week.utilization === null) continue
      out.push({ at: Date.parse(week.receivedAt), utilization: week.utilization, resetsAt: week.resetsAt === null ? null : Date.parse(week.resetsAt) })
    }
  }
  return out
}

export interface BudgetDay {
  /** The share of today, 0..1. */
  share: number
  /** Used since the start of the day, 0..1. */
  used: number
  /** share − used; below 0 when today used more. */
  remaining: number
  /** The time of the number the day is counted from. */
  since: number
}

const sameWindow = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) <= SAME_WINDOW_RESET_GAP_S * 1000

/** Today's share and use, from the 7-day number now (`week`, its reset known) and the journals' numbers. */
export function budgetDay({ reserve, now, week, readings }: { reserve: number; now: number; week: BudgetReading & { resetsAt: number }; readings: readonly BudgetReading[] }): BudgetDay {
  const dayStart = localDayStart(now)
  const today = readings.filter((reading) => reading.at >= dayStart && reading.at <= now && sameWindow(reading.resetsAt, week.resetsAt)).sort((a, b) => a.at - b.at)
  // No number of today yet: the day starts now, from the number now (got a little earlier, perhaps before midnight).
  const start = today[0] ?? { ...week, at: now }
  const share = dailyShare({ reserve, used: start.utilization, days: daysToReset(start.at, week.resetsAt) })
  const used = Math.max(0, week.utilization - start.utilization)
  return { share, used, remaining: share - used, since: start.at }
}

/**
 * When a run stopped by the budget goes on: the start of the next local day, the 7-day reset plus
 * RESUME_MARGIN_MS, and — while the day's share is left (`dayLeft`) — the 5-hour reset plus the
 * margin; the earliest still ahead of `now`.
 */
export function budgetResumeAt({ now, dayLeft, fiveHourResetsAt, sevenDayResetsAt }: { now: number; dayLeft: boolean; fiveHourResetsAt: number | null; sevenDayResetsAt: number | null }): number {
  const times = [nextLocalDayStart(now)]
  if (sevenDayResetsAt !== null && sevenDayResetsAt > now) times.push(sevenDayResetsAt + RESUME_MARGIN_MS)
  if (dayLeft && fiveHourResetsAt !== null && fiveHourResetsAt > now) times.push(fiveHourResetsAt + RESUME_MARGIN_MS)
  return Math.min(...times)
}

/** What stopped a run before a Wave: today's share, or the full 5-hour window with today's share left. */
export type BudgetCause = (typeof BUDGET_CAUSES)[number]

export type BudgetDecision =
  | { kind: 'go' }
  /** The Wave does not start; the run goes on at `until` (ms). share, used: as in BudgetDay; need: the estimate of the Wave, 0 without one. */
  | { kind: 'stop'; cause: BudgetCause; share: number; used: number; need: number; until: number }

export interface BudgetInput {
  budget: AutopilotBudget
  now: number
  /** The Limits now (LimitsTracker.snapshot), just asked anew when old (run.ts, freshLimits). */
  limits: LimitsState
  /** The events of the Project's recent runs, the current one included (readRecentRuns). */
  runs: readonly (readonly JournalEvent[])[]
  estimate: WaveEstimate | null
  /** The Tickets of the Wave about to go. */
  tickets: number
}

/** A window's number when it is fresh at `now`. */
const fresh = (window: LimitWindowState | undefined, now: number): LimitWindowState | null =>
  window === undefined || now - window.receivedAt > BUDGET_FRESH_MS ? null : window

/** Whether the next Wave starts, and if not, why and until when. */
export function budgetDecision({ budget, now, limits, runs, estimate, tickets }: BudgetInput): BudgetDecision {
  if (!budget.enabled) return { kind: 'go' }
  const week = fresh(limits.windows.seven_day, now)
  if (week === null || week.utilization === null || week.resetsAt === null || toMs(week.resetsAt) <= now) return { kind: 'go' }
  const sevenDayResetsAt = toMs(week.resetsAt)
  const day = budgetDay({ reserve: budget.reserve, now, week: { at: week.receivedAt, utilization: week.utilization, resetsAt: sevenDayResetsAt }, readings: weekReadings(runs) })
  const need = estimate === null ? 0 : estimate.perTicket * Math.max(1, tickets)
  const five = fresh(limits.windows.five_hour, now)
  const fiveHourResetsAt = five === null || five.resetsAt === null ? null : toMs(five.resetsAt)
  const stop = (cause: BudgetCause, until: number): BudgetDecision => ({ kind: 'stop', cause, share: day.share, used: day.used, need, until })
  if (day.remaining <= 0 || day.remaining < need) return stop('daily-share', budgetResumeAt({ now, dayLeft: false, fiveHourResetsAt, sevenDayResetsAt }))
  const fiveFull = five !== null && fiveHourResetsAt !== null && fiveHourResetsAt > now && ((five.utilization !== null && five.utilization >= FIVE_HOUR_FULL) || five.status === 'rejected')
  if (fiveFull) return stop('five-hour', budgetResumeAt({ now, dayLeft: true, fiveHourResetsAt, sevenDayResetsAt }))
  return { kind: 'go' }
}

export interface BudgetTextOptions {
  /** IANA time zone of the time shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

/** The reason of a budget stop in words, for the Autopilot status and the journal. */
export function budgetStopText(cause: BudgetCause, until: number, options: BudgetTextOptions = {}): string {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: options.timeZone }).format(until)
  return cause === 'daily-share'
    ? `Today's share of the Limits is used: Autopilot continues at ${time}`
    : `The 5-hour Limits are used, today's share is not: Autopilot continues at ${time}`
}
