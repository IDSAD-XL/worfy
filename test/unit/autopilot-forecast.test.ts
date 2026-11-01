// The Epic forecast core (worfy-resource-planner ticket 01): the per-Ticket samples of past Waves,
// the Waves and Tickets left of an Epic, and the bootstrap range of the share of the week they take.
import { describe, expect, it } from 'vitest'
import { epicForecast, FORECAST_DRAWS, FORECAST_MIN_SAMPLES, percentile, remainingWaves } from '../../src/shared/autopilot/forecast'
import type { JournalEvent, JournalLimits } from '../../src/shared/autopilot/journal'
import { ESTIMATE_FRESH_MS, ESTIMATE_WAVES, waveGrowth, waveSamples } from '../../src/shared/autopilot/limits-estimate'
import type { Ticket } from '../../src/shared/workflow/types'
import { waveNumbers } from '../../src/shared/workflow/waves'

const RUN = '2026-10-06T01-02-03-004Z-a1b2c3'
const T0 = Date.parse('2026-10-06T01:00:00.000Z')
const HOUR = 3_600_000
const RESETS = '2026-10-20T09:00:00.000Z'
const iso = (ms: number): string => new Date(ms).toISOString()
const common = (at: number) => ({ at: iso(at), run: RUN, project: 'demo-00000001', epic: 'demo' })

function limits(utilization: number, receivedAt: number, resetsAt: string = RESETS): JournalLimits {
  return { five_hour: null, seven_day: { utilization, receivedAt: iso(receivedAt), resetsAt } }
}

interface WaveSpec {
  at: number
  tickets?: string[]
  from: number
  to: number
  ageStart?: number
  resetsEnd?: string
  /** How long the Wave lasts, ms; an hour unless named. */
  lasts?: number
}

type WaveLine = Extract<JournalEvent, { kind: 'wave-started' | 'wave-finished' }>

/** One Wave as its two lines; it lasts an hour unless `lasts` says otherwise. */
function wave(num: number, spec: WaveSpec): [WaveLine, WaveLine] {
  const tickets = spec.tickets ?? ['01']
  const end = spec.at + (spec.lasts ?? HOUR)
  return [
    { ...common(spec.at), kind: 'wave-started', wave: num, tickets, limits: limits(spec.from, spec.at - (spec.ageStart ?? 0)) },
    { ...common(end), kind: 'wave-finished', wave: num, tickets, limits: limits(spec.to, end, spec.resetsEnd ?? RESETS) },
  ]
}

const run = (...waves: JournalEvent[][]): JournalEvent[] => [{ ...common(T0 - 1000), kind: 'run-started' }, ...waves.flat()]

/** A Ticket of epic `e` with the given number, state, blockers and files. */
function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'e',
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [`src/t${num}.ts`],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

const blocked = (...nums: number[]): Partial<Ticket> => ({ blockedNums: nums, blockedRaw: nums.join(', ') })

describe('waveSamples', () => {
  it('gives the per-Ticket samples in time order, whatever the order of the runs', () => {
    const samples = waveSamples([
      run(wave(1, { at: T0 + 10 * HOUR, from: 0.3, to: 0.34 })), // 4 %, the latest
      run(
        wave(1, { at: T0, from: 0.1, to: 0.13 }), // 3 %
        wave(2, { at: T0 + 2 * HOUR, tickets: ['02', '03'], from: 0.13, to: 0.23 }), // 5 % each
      ),
    ])
    expect(samples).toHaveLength(3)
    expect(samples[0]).toBeCloseTo(0.03, 10)
    expect(samples[1]).toBeCloseTo(0.05, 10)
    expect(samples[2]).toBeCloseTo(0.04, 10)
  })

  it('orders the samples by the end of their Wave, not by its start', () => {
    const samples = waveSamples([
      run(wave(1, { at: T0, from: 0.1, to: 0.17, lasts: 10 * HOUR })), // starts first, ends last: 7 %
      run(wave(1, { at: T0 + HOUR, from: 0.2, to: 0.22 })), // starts later, ends first: 2 %
    ])
    expect(samples).toHaveLength(2)
    expect(samples[0]).toBeCloseTo(0.02, 10)
    expect(samples[1]).toBeCloseTo(0.07, 10)
  })

  it('keeps only the last ESTIMATE_WAVES samples', () => {
    const waves = Array.from({ length: ESTIMATE_WAVES + 3 }, (_, index) => wave(index + 1, { at: T0 + index * 2 * HOUR, from: 0.1, to: 0.1 + (index + 1) / 1000 }))
    const samples = waveSamples([run(...waves)])
    expect(samples).toHaveLength(ESTIMATE_WAVES)
    expect(samples[0]).toBeCloseTo(4 / 1000, 10)
    expect(samples.at(-1)).toBeCloseTo((ESTIMATE_WAVES + 3) / 1000, 10)
  })

  it('gives no sample for a Wave with an old number or a reset inside it', () => {
    const samples = waveSamples([
      run(
        wave(1, { at: T0, from: 0.1, to: 0.12, ageStart: ESTIMATE_FRESH_MS + 1 }), // an old number at the start
        wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.15, resetsEnd: '2026-10-27T09:00:00.000Z' }), // the window reset inside
        wave(3, { at: T0 + 4 * HOUR, from: 0.15, to: 0.17 }),
      ),
    ])
    expect(samples).toHaveLength(1)
    expect(samples[0]).toBeCloseTo(0.02, 10)
  })
})

describe('waveGrowth', () => {
  it('is the growth of the share over the whole Wave, the sample times its Tickets', () => {
    const [started, finished] = wave(1, { at: T0, tickets: ['01', '02', '03'], from: 0.2, to: 0.29 })
    expect(waveGrowth(started, finished)).toBeCloseTo(0.09, 10)
  })

  it('is null when the Wave gives no sample', () => {
    const [started, finished] = wave(1, { at: T0, from: 0.2, to: 0.29, resetsEnd: '2026-10-27T09:00:00.000Z' })
    expect(waveGrowth(started, finished)).toBeNull()
  })

  it('is null for a Wave without Tickets', () => {
    const [started, finished] = wave(1, { at: T0, tickets: [], from: 0.2, to: 0.29 })
    expect(waveGrowth(started, finished)).toBeNull()
  })
})

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const values = [5, 1, 4, 2, 3, 6, 8, 7, 10, 9]
    expect(percentile(values, 10)).toBe(1)
    expect(percentile(values, 50)).toBe(5)
    expect(percentile(values, 90)).toBe(9)
    expect(percentile(values, 91)).toBe(10)
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 100)).toBe(10)
  })

  it('refuses an empty list', () => {
    expect(() => percentile([], 50)).toThrow(RangeError)
  })

  it('refuses a percent outside 0..100', () => {
    expect(() => percentile([1], 101)).toThrow(RangeError)
    expect(() => percentile([1], -1)).toThrow(RangeError)
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError)
  })
})

describe('remainingWaves', () => {
  it('leaves out a Ticket in work, one done only in its branch and one behind a blocked blocker; the rest keep the numbers of waveNumbers', () => {
    const tickets = [
      ticket(1, { state: 'done', statusRaw: 'done' }),
      ticket(2, { state: 'work', statusRaw: 'claimed' }), // in work
      ticket(3, { state: 'done', statusRaw: 'done', fromBranch: 'e/03' }), // done only in its branch
      ticket(4, { state: 'blocked', statusRaw: 'blocked' }),
      ticket(5, blocked(4)), // behind a blocked blocker
      ticket(6, blocked(1)),
      ticket(7),
      ticket(8, blocked(2)),
      ticket(9, blocked(6, 8)),
      ticket(1, { epic: 'other' }),
    ].reverse() // out of number order: the uncounted come back sorted all the same
    const numbers = waveNumbers(tickets, 'e')
    expect([...numbers.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [6, 1],
      [7, 1],
      [8, 2],
      [9, 3],
    ])
    expect(remainingWaves(tickets, 'e')).toEqual({ waves: [2, 1, 1], uncounted: [2, 3, 4, 5] })
  })

  it('in a run over named Tickets counts only the named ones', () => {
    const tickets = [ticket(1), ticket(2, blocked(1)), ticket(3, blocked(2)), ticket(4), ticket(5, blocked(4))]
    // 3 waits for 2, which the run does not take: it never gets a Wave.
    expect(remainingWaves(tickets, 'e', [1, 3, 4, 5])).toEqual({ waves: [2, 1], uncounted: [3] })
    expect(remainingWaves(tickets, 'e')).toEqual({ waves: [2, 2, 1], uncounted: [] })
  })

  it('in a run over named Tickets a named Ticket that waits for a closed unnamed one is in Wave 1, for an unnamed one in work in Wave 2', () => {
    const tickets = [
      ticket(1, { state: 'done', statusRaw: 'done' }),
      ticket(2, { state: 'work', statusRaw: 'claimed' }),
      ticket(3, blocked(1)),
      ticket(4, blocked(2)),
    ]
    expect(remainingWaves(tickets, 'e', [3, 4])).toEqual({ waves: [1, 1], uncounted: [] })
  })

  it('a closed Epic has no Waves and nothing uncounted', () => {
    expect(remainingWaves([ticket(1, { state: 'done', statusRaw: 'done' })], 'e')).toEqual({ waves: [], uncounted: [] })
  })
})

describe('epicForecast', () => {
  it('five equal samples s on N Tickets give low = high = N·s', () => {
    const forecast = epicForecast({ samples: [0.02, 0.02, 0.02, 0.02, 0.02], waves: { waves: [3, 2], uncounted: [7] } })
    expect(forecast.waves).toBe(2)
    expect(forecast.tickets).toBe(5)
    expect(forecast.uncounted).toBe(1)
    expect(forecast.samples).toBe(5)
    expect(forecast.range?.low).toBeCloseTo(0.1, 10)
    expect(forecast.range?.high).toBeCloseTo(0.1, 10)
    expect(forecast.cumulativeHigh).toHaveLength(3)
    expect(forecast.cumulativeHigh?.[0]).toBe(0)
    expect(forecast.cumulativeHigh?.[1]).toBeCloseTo(0.06, 10)
    expect(forecast.cumulativeHigh?.[2]).toBeCloseTo(0.1, 10)
  })

  it('fewer than FORECAST_MIN_SAMPLES samples give no range but still count the Waves and Tickets', () => {
    expect(FORECAST_MIN_SAMPLES).toBe(5)
    const forecast = epicForecast({ samples: [0.01, 0.02, 0.03, 0.04], waves: { waves: [2, 1], uncounted: [] } })
    expect(forecast).toEqual({ waves: 2, tickets: 3, uncounted: 0, samples: 4, range: null, cumulativeHigh: null })
  })

  it('a known set of samples with the fixed seed gives a fixed range', () => {
    const samples = [0.01, 0.02, 0.03, 0.05, 0.08, 0.13]
    const forecast = epicForecast({ samples, waves: { waves: [2, 3, 1], uncounted: [] } })
    expect(FORECAST_DRAWS).toBe(1000)
    expect(forecast.range?.low).toBeCloseTo(0.19, 10)
    expect(forecast.range?.high).toBeCloseTo(0.45, 10)
    const cumulative = forecast.cumulativeHigh!
    expect(cumulative).toHaveLength(4)
    const expected = [0, 0.18, 0.38, 0.45]
    for (let k = 0; k < expected.length; k += 1) expect(cumulative[k]).toBeCloseTo(expected[k]!, 10)
  })

  it('without replacement every draw of five distinct samples on five Tickets would be the same sum; with it the range is wide', () => {
    const forecast = epicForecast({ samples: [0.01, 0.02, 0.03, 0.04, 0.05], waves: { waves: [5], uncounted: [] } })
    expect(forecast.range).not.toBeNull()
    expect(forecast.range!.low).toBeLessThan(0.15 - 0.01)
    expect(forecast.range!.high).toBeGreaterThan(0.15 + 0.01)
  })

  it('low is not above high and the cumulative p90 does not fall, across seeds', () => {
    const samples = [0.004, 0.011, 0.002, 0.03, 0.017, 0.009, 0.022]
    for (const seed of [1, 2, 3, 42, 2026]) {
      const forecast = epicForecast({ samples, waves: { waves: [1, 4, 2, 3], uncounted: [] }, seed })
      expect(forecast.range!.low).toBeLessThanOrEqual(forecast.range!.high)
      const cumulative = forecast.cumulativeHigh!
      for (let k = 1; k < cumulative.length; k += 1) expect(cumulative[k]!).toBeGreaterThanOrEqual(cumulative[k - 1]!)
      expect(cumulative.at(-1)).toBe(forecast.range!.high)
    }
  })

  it('another seed gives another draw', () => {
    const input = { samples: [0.004, 0.011, 0.002, 0.03, 0.017, 0.009, 0.022], waves: { waves: [1, 4, 2, 3], uncounted: [] } }
    expect(epicForecast({ ...input, seed: 1 })).not.toEqual(epicForecast({ ...input, seed: 2 }))
  })

  it('takes as many draws as it is told: one draw gives low = high', () => {
    const forecast = epicForecast({ samples: [0.01, 0.02, 0.03, 0.05, 0.08, 0.13], waves: { waves: [2, 3, 1], uncounted: [] }, draws: 1 })
    expect(forecast.range!.low).toBe(forecast.range!.high)
  })

  it('refuses a number of draws that is not a whole number from 1 up', () => {
    const input = { samples: [0.01, 0.02, 0.03, 0.04, 0.05], waves: { waves: [2], uncounted: [] } }
    expect(() => epicForecast({ ...input, draws: 0 })).toThrow(/draws/)
    expect(() => epicForecast({ ...input, draws: 1.5 })).toThrow(/draws/)
    expect(() => epicForecast({ ...input, draws: -3 })).toThrow(/draws/)
  })

  it('the same input twice gives the same answer', () => {
    const input = { samples: [0.004, 0.011, 0.002, 0.03, 0.017], waves: { waves: [2, 2], uncounted: [9] } }
    expect(epicForecast(input)).toEqual(epicForecast(input))
  })

  it('with no Waves left: zero Waves, no range, no error', () => {
    const forecast = epicForecast({ samples: [0.01, 0.02, 0.03, 0.04, 0.05], waves: { waves: [], uncounted: [3] } })
    expect(forecast).toEqual({ waves: 0, tickets: 0, uncounted: 1, samples: 5, range: null, cumulativeHigh: null })
  })
})
