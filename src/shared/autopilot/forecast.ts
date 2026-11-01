// The Epic forecast (worfy-resource-planner ticket 01, ADR-0093): what share of the week's Limits
// the Waves left of an Epic take on this Machine. The samples are the per-Ticket growths of the
// 7-day share of past Waves (waveSamples, limits-estimate.ts); the Waves left come from the Wave
// numbers of the Epic's Tickets (waveNumbers, waves.ts). The range is a bootstrap: FORECAST_DRAWS
// draws, each giving every Ticket left a sample picked at random with replacement, the sums kept at
// each Wave boundary; p10 and p90 of the total by the nearest rank. The random numbers come from a
// fixed seed, so the same input gives the same range. Fewer than FORECAST_MIN_SAMPLES samples give
// no range («мало данных»). Everything here is pure: no Node, no DOM.
import type { Ticket } from '../workflow/types'
import { doneOnlyInBranch, waveNumbers } from '../workflow/waves'

/** Fewer samples than this give no range. */
export const FORECAST_MIN_SAMPLES = 5
/** How many bootstrap draws the range is taken from. */
export const FORECAST_DRAWS = 1000
/** The seed of the bootstrap's random numbers unless a caller names another. */
export const FORECAST_SEED = 0x5eed

/**
 * The value at percent `p` (0..100) of `values` by the nearest rank: the smallest value with at
 * least p % of the list at or below it; p 0 gives the smallest. An empty list is a RangeError.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentile of an empty list')
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile outside 0..100: ${p}`)
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p * sorted.length) / 100))
  return sorted[rank - 1]!
}

type ForecastTicket = Parameters<typeof waveNumbers>[0][number] & Pick<Ticket, 'epic' | 'num'>

/** What is left of an Epic. */
export interface RemainingWaves {
  /** The number of Tickets of each Wave left, Wave 1 first. */
  waves: number[]
  /** Tickets not done in the checkout that have no Wave number, in number order. */
  uncounted: number[]
}

/** Done in the checkout. */
const closed = (ticket: ForecastTicket): boolean => ticket.state === 'done' && !doneOnlyInBranch(ticket)

/**
 * The Waves left of `epic` by waveNumbers, and its Tickets that are not closed and get no Wave
 * number: in work, done only in a worktree branch, blocked, or waiting on such a Ticket. In a run
 * over named Tickets only the named ones count; an open Ticket the run does not name is never
 * taken, so a named Ticket that waits on it gets no Wave either.
 */
export function remainingWaves(tickets: readonly ForecastTicket[], epic: string, named?: readonly number[]): RemainingWaves {
  const counts = (ticket: ForecastTicket): boolean => named === undefined || named.includes(ticket.num)
  const ofEpic = tickets.filter((ticket) => ticket.epic === epic)
  const model = named === undefined ? ofEpic : ofEpic.map((ticket) => (!counts(ticket) && ticket.state === 'open' ? { ...ticket, state: 'blocked' as const } : ticket))
  const numbers = waveNumbers(model, epic)
  const waves: number[] = []
  const uncounted: number[] = []
  for (const ticket of ofEpic) {
    if (!counts(ticket)) continue
    const wave = numbers.get(ticket.num)
    if (wave !== undefined) waves[wave - 1] = (waves[wave - 1] ?? 0) + 1
    else if (!closed(ticket)) uncounted.push(ticket.num)
  }
  return { waves: Array.from(waves, (count) => count ?? 0), uncounted: uncounted.sort((a, b) => a - b) }
}

export interface EpicForecastInput {
  /** The per-Ticket samples, waveSamples. */
  samples: readonly number[]
  waves: RemainingWaves
  /** FORECAST_DRAWS unless named. */
  draws?: number
  /** FORECAST_SEED unless named. */
  seed?: number
}

export interface EpicForecast {
  /** How many Waves are left (W). */
  waves: number
  /** How many Tickets those Waves hold. */
  tickets: number
  /** How many Tickets are left out: not closed and without a Wave number. */
  uncounted: number
  /** How many samples the range is drawn from. */
  samples: number
  /** p10 and p90 of the share of the week all W Waves take, 0..1; null with too few samples or no Waves left. */
  range: { low: number; high: number } | null
  /**
   * `cumulativeHigh[k]` is p90 of the share the first k Waves take, k = 0..W (index 0 is 0, index W
   * is `range.high`); null whenever `range` is.
   */
  cumulativeHigh: number[] | null
}

/** mulberry32: a small seeded generator of numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The Epic forecast: the bootstrap range of the share of the week the Waves left take. */
export function epicForecast({ samples, waves, draws = FORECAST_DRAWS, seed = FORECAST_SEED }: EpicForecastInput): EpicForecast {
  const tickets = waves.waves.reduce((sum, count) => sum + count, 0)
  const answer = { waves: waves.waves.length, tickets, uncounted: waves.uncounted.length, samples: samples.length }
  if (samples.length < FORECAST_MIN_SAMPLES || waves.waves.length === 0) return { ...answer, range: null, cumulativeHigh: null }

  const next = random(seed)
  // sums[k][d]: what the first k + 1 Waves took in draw d.
  const sums = waves.waves.map(() => new Array<number>(draws))
  for (let draw = 0; draw < draws; draw += 1) {
    let total = 0
    waves.waves.forEach((count, wave) => {
      for (let each = 0; each < count; each += 1) total += samples[Math.floor(next() * samples.length)]!
      sums[wave]![draw] = total
    })
  }
  const all = sums.at(-1)!
  return {
    ...answer,
    range: { low: percentile(all, 10), high: percentile(all, 90) },
    cumulativeHigh: [0, ...sums.map((each) => percentile(each, 90))],
  }
}
