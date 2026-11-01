// What share of the week's Limits a Wave takes, from the journals of a Project's past runs
// (worfy-throughput ticket 40). A Wave's sample is the growth of `seven_day` between its
// wave-started and its wave-finished (their `limits` field, journal.ts), divided by its Tickets.
// The estimate is the median of the last ESTIMATE_WAVES samples; a Wave whose number at either end
// is older than ESTIMATE_FRESH_MS, or whose window reset inside it, gives no sample. Fewer than
// ESTIMATE_MIN_WAVES samples give no estimate. The Autopilot button's hint says it with the share
// used now (waveEstimateLine). No prices. Everything here is pure.
import { SAME_WINDOW_RESET_GAP_S, type LimitsState } from '../agent/limits'
import type { JournalEvent, JournalLimits } from './journal'
import { waveDurationP90, type WaveDuration } from './wave-duration'

/** How many of the last Waves the median takes. */
export const ESTIMATE_WAVES = 10
/** Fewer counted Waves than this give no estimate. */
export const ESTIMATE_MIN_WAVES = 3
/** A number older than this at either end of a Wave, against the line's `at`, leaves the Wave out. */
export const ESTIMATE_FRESH_MS = 30 * 60 * 1000

export interface WaveEstimate {
  /** The median growth of the 7-day share per Ticket of a Wave, 0..1. */
  perTicket: number
  /** How many Waves it is the median of. */
  waves: number
}

type Window = NonNullable<JournalLimits['seven_day']>
/** A wave-started or wave-finished line of a run's journal. */
export type WaveLine = Extract<JournalEvent, { kind: 'wave-started' | 'wave-finished' }>

/** The 7-day window of a line, when its number is fresh at the line's time. */
function freshWeek(line: WaveLine): (Window & { utilization: number }) | null {
  const week = line.limits?.seven_day
  if (week === null || week === undefined || week.utilization === null) return null
  if (Date.parse(line.at) - Date.parse(week.receivedAt) > ESTIMATE_FRESH_MS) return null
  return { ...week, utilization: week.utilization }
}

/**
 * The growth of the 7-day share over one Wave (its sample times its Tickets), or null when the
 * Wave gives no sample: an old number at either end, no Tickets, or a reset inside the Wave — the
 * reset times of the two ends further apart than one window's rounding (SAME_WINDOW_RESET_GAP_S),
 * the start's reset time at or before the end, or a share that fell.
 */
export function waveGrowth(started: WaveLine, finished: WaveLine): number | null {
  const from = freshWeek(started)
  const to = freshWeek(finished)
  if (from === null || to === null || started.tickets.length === 0) return null
  if (to.utilization < from.utilization) return null
  if (from.resetsAt !== null) {
    const resets = Date.parse(from.resetsAt)
    if (resets <= Date.parse(finished.at)) return null
    if (to.resetsAt !== null && Math.abs(Date.parse(to.resetsAt) - resets) > SAME_WINDOW_RESET_GAP_S * 1000) return null
  }
  return to.utilization - from.utilization
}

/** The growth per Ticket of one Wave, or null when it gives no sample (waveGrowth). */
function sample(started: WaveLine, finished: WaveLine): number | null {
  const growth = waveGrowth(started, finished)
  return growth === null ? null : growth / started.tickets.length
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * The per-Ticket samples of the last ESTIMATE_WAVES Waves that give one, oldest first, from the
 * events of each past run (one list per journal file). The Epic forecast draws from them
 * (forecast.ts, worfy-resource-planner ticket 01).
 */
export function waveSamples(runs: readonly (readonly JournalEvent[])[]): number[] {
  const samples: { at: number; perTicket: number }[] = []
  for (const events of runs) {
    const started = new Map<number, WaveLine>()
    for (const event of events) {
      if (event.kind === 'wave-started') started.set(event.wave, event)
      else if (event.kind === 'wave-finished') {
        const start = started.get(event.wave)
        started.delete(event.wave)
        const perTicket = start === undefined ? null : sample(start, event)
        if (perTicket !== null) samples.push({ at: Date.parse(event.at), perTicket })
      }
    }
  }
  return samples
    .sort((a, b) => a.at - b.at)
    .slice(-ESTIMATE_WAVES)
    .map((each) => each.perTicket)
}

/** The estimate from the events of each past run (one list per journal file), or null when too few Waves count. */
export function waveEstimate(runs: readonly (readonly JournalEvent[])[]): WaveEstimate | null {
  const last = waveSamples(runs)
  if (last.length < ESTIMATE_MIN_WAVES) return null
  return { perTicket: median(last), waves: last.length }
}

/** The 7-day window as the hint needs it: the share 0..1 and the reset in Unix seconds, each null when unknown. */
export interface WeekNow {
  utilization: number | null
  resetsAt: number | null
}

/** The 7-day window of `autopilot.estimate`: WeekNow and when its number came (ms), which the forecast's freshness needs. */
export interface WeekAnswer extends WeekNow {
  receivedAt: number
}

/** What `autopilot.estimate` answers. */
export interface EstimateAnswer {
  estimate: WaveEstimate | null
  sevenDay: WeekAnswer | null
  /** The per-Ticket samples the Epic forecast draws from (waveSamples), oldest first. */
  samples: number[]
  /** The p90 of the Wave duration and its number of samples (waveDurationP90). */
  durations: WaveDuration
}

/**
 * What `autopilot.estimate` answers (src/shared/ipc/autopilot.ts): the estimate from the events of
 * the Project's past runs, the 7-day window of the Limits now (null when nothing is known of it), and
 * for the Epic forecast of the Autopilot button (worfy-resource-planner ticket 06) the per-Ticket
 * samples and the Wave duration of the same runs.
 */
export function estimateAnswer(runs: readonly (readonly JournalEvent[])[], limits: LimitsState): EstimateAnswer {
  const week = limits.windows.seven_day
  return {
    estimate: waveEstimate(runs),
    sevenDay: week === undefined ? null : { utilization: week.utilization, resetsAt: week.resetsAt, receivedAt: week.receivedAt },
    samples: waveSamples(runs),
    durations: waveDurationP90(runs),
  }
}

export interface EstimateLineInput {
  estimate: WaveEstimate | null
  /** How many Tickets the Wave about to go has. */
  tickets: number
  /** The 7-day window now; null when nothing is known of it. */
  sevenDay: WeekNow | null
  now: number
}

/** `2 d 5 h` from a day on, `3 h 10 min` under it, `25 min` under an hour. */
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes % 60} min`
  return `${minutes} min`
}

/**
 * The hint line: "A Wave like this usually takes about 6% of the week. Used now: 41%, resets in 2 d 5 h";
 * without an estimate it says there is none and why.
 */
export function waveEstimateLine({ estimate, tickets, sevenDay, now }: EstimateLineInput): string {
  let head: string
  if (estimate === null) head = `No estimate for a Wave yet: fewer than ${ESTIMATE_MIN_WAVES} past Waves with fresh Limits`
  else {
    const percent = Math.round(estimate.perTicket * Math.max(tickets, 1) * 100)
    head = `A Wave like this usually takes ${percent < 1 ? 'less than 1%' : `about ${percent}%`} of the week`
  }
  return `${head}. ${usedNowText(sevenDay, now)}`
}

/**
 * The tail of the hint lines: "Used now: 41%, resets in 2 d 5 h", "Used now: 40%" without a reset
 * time, "Used now: unknown" without a number. The Epic forecast line ends with it too (forecast-lines.ts).
 */
export function usedNowText(sevenDay: WeekNow | null, now: number): string {
  if (sevenDay === null || sevenDay.utilization === null) return 'Used now: unknown'
  const used = `Used now: ${Math.round(sevenDay.utilization * 100)}%`
  if (sevenDay.resetsAt === null) return used
  const left = sevenDay.resetsAt * 1000 - now
  return `${used}, ${left <= 0 ? 'resets now' : `resets in ${duration(left)}`}`
}
