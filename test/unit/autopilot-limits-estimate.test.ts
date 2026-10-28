// The estimate of what share of the week's Limits a Wave takes, from the journals of past runs
// (worfy-throughput ticket 40): the median of the last Waves' `seven_day` growth per Ticket, Waves
// without a fresh number or with a reset inside left out, no estimate from fewer than three Waves.
import { describe, expect, it } from 'vitest'
import type { JournalEvent, JournalLimits } from '../../src/shared/autopilot/journal'
import { ESTIMATE_FRESH_MS, ESTIMATE_MIN_WAVES, ESTIMATE_WAVES, estimateAnswer, waveEstimate, waveEstimateLine } from '../../src/shared/autopilot/limits-estimate'
import { autopilotEstimateAnswerSchema } from '../../src/shared/ipc/autopilot'

const RUN = '2026-10-06T01-02-03-004Z-a1b2c3'
const T0 = Date.parse('2026-10-06T01:00:00.000Z')
const HOUR = 3_600_000
/** The 7-day window's reset in every sample unless a test moves it. */
const RESETS = '2026-10-09T09:00:00.000Z'
const iso = (ms: number): string => new Date(ms).toISOString()

const common = (at: number) => ({ at: iso(at), run: RUN, project: 'demo-00000001', epic: 'demo' })

function limits(utilization: number | null, receivedAt: number, resetsAt: string | null = RESETS): JournalLimits {
  return { five_hour: null, seven_day: { utilization, receivedAt: iso(receivedAt), resetsAt } }
}

interface WaveSpec {
  /** Start of the Wave, ms. */
  at: number
  tickets?: string[]
  from: number | null
  to: number | null
  /** How old the number at each end is, ms. */
  ageStart?: number
  ageEnd?: number
  resetsEnd?: string | null
  noLimits?: boolean
}

/** One Wave as its two lines; it lasts an hour. */
function wave(num: number, spec: WaveSpec): JournalEvent[] {
  const tickets = spec.tickets ?? ['01']
  const end = spec.at + HOUR
  const started: JournalEvent = { ...common(spec.at), kind: 'wave-started', wave: num, tickets, ...(spec.noLimits ? {} : { limits: limits(spec.from, spec.at - (spec.ageStart ?? 0)) }) }
  const finished: JournalEvent = {
    ...common(end),
    kind: 'wave-finished',
    wave: num,
    tickets,
    ...(spec.noLimits ? {} : { limits: limits(spec.to, end - (spec.ageEnd ?? 0), spec.resetsEnd === undefined ? RESETS : spec.resetsEnd) }),
  }
  return [started, finished]
}

const run = (...waves: JournalEvent[][]): JournalEvent[] => [{ ...common(T0 - 1000), kind: 'run-started' }, ...waves.flat()]

describe('waveEstimate', () => {
  it('three Waves with their shares give the median growth of the week per Ticket', () => {
    const estimate = waveEstimate([
      run(
        wave(1, { at: T0, from: 0.1, to: 0.13 }), // 3 % for one Ticket
        wave(2, { at: T0 + 2 * HOUR, tickets: ['02', '03'], from: 0.13, to: 0.23 }), // 10 % for two: 5 % each
      ),
      run(wave(1, { at: T0 + 5 * HOUR, from: 0.3, to: 0.34 })), // 4 %
    ])
    expect(estimate).not.toBeNull()
    expect(estimate!.waves).toBe(3)
    expect(estimate!.perTicket).toBeCloseTo(0.04, 10)
  })

  it('leaves out a Wave with a reset of the window inside and a Wave whose number is not fresh', () => {
    const counted = [wave(1, { at: T0, from: 0.1, to: 0.12 }), wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.14 }), wave(3, { at: T0 + 4 * HOUR, from: 0.14, to: 0.16 })]
    const estimate = waveEstimate([
      run(
        ...counted,
        // The window reset during the Wave: a later reset time at the end, the share starts again.
        wave(4, { at: T0 + 6 * HOUR, from: 0.9, to: 0.02, resetsEnd: '2026-10-16T09:00:00.000Z' }),
        // The same reset without a reset time at the end: the share fell.
        wave(5, { at: T0 + 8 * HOUR, from: 0.5, to: 0.01, resetsEnd: null }),
        // The number at the start is older than 30 minutes.
        wave(6, { at: T0 + 10 * HOUR, from: 0.2, to: 0.6, ageStart: ESTIMATE_FRESH_MS + 1 }),
        // The number at the end is older than 30 minutes.
        wave(7, { at: T0 + 12 * HOUR, from: 0.2, to: 0.6, ageEnd: ESTIMATE_FRESH_MS + 1 }),
        // No share at one end.
        wave(8, { at: T0 + 14 * HOUR, from: null, to: 0.6 }),
        // Lines written before the field.
        wave(9, { at: T0 + 16 * HOUR, from: 0, to: 0, noLimits: true }),
      ),
    ])
    expect(estimate).toEqual({ perTicket: expect.closeTo(0.02, 10) as unknown as number, waves: 3 })
  })

  it('a number exactly 30 minutes old still counts', () => {
    const estimate = waveEstimate([
      run(wave(1, { at: T0, from: 0.1, to: 0.12, ageStart: ESTIMATE_FRESH_MS }), wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.14 }), wave(3, { at: T0 + 4 * HOUR, from: 0.14, to: 0.16, ageEnd: ESTIMATE_FRESH_MS })),
    ])
    expect(estimate?.waves).toBe(3)
  })

  it('fewer than three Waves give no estimate', () => {
    expect(ESTIMATE_MIN_WAVES).toBe(3)
    expect(waveEstimate([])).toBeNull()
    expect(waveEstimate([run(wave(1, { at: T0, from: 0.1, to: 0.12 }), wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.14 }))])).toBeNull()
    // Three Waves, one of them without a fresh number: two count.
    expect(waveEstimate([run(wave(1, { at: T0, from: 0.1, to: 0.12 }), wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.14 }), wave(3, { at: T0 + 4 * HOUR, from: 0.14, to: 0.2, ageEnd: ESTIMATE_FRESH_MS + 1 }))])).toBeNull()
  })

  it('takes the last ten Waves by their end, across runs', () => {
    expect(ESTIMATE_WAVES).toBe(10)
    // Ten Waves of 1 % in a later run, three of 9 % in an earlier one given last: the old ones fall out.
    const late = Array.from({ length: 10 }, (_, i) => wave(i + 1, { at: T0 + (20 + 2 * i) * HOUR, from: 0.1 + i * 0.01, to: 0.11 + i * 0.01 }))
    const early = [wave(1, { at: T0, from: 0, to: 0.09 }), wave(2, { at: T0 + 2 * HOUR, from: 0.09, to: 0.18 }), wave(3, { at: T0 + 4 * HOUR, from: 0.18, to: 0.27 })]
    const estimate = waveEstimate([run(...late), run(...early)])
    expect(estimate?.waves).toBe(10)
    expect(estimate?.perTicket).toBeCloseTo(0.01, 10)
  })

  it('pairs a wave-finished with the wave-started of its own run only', () => {
    const [started] = wave(1, { at: T0, from: 0.1, to: 0.12 })
    const [, finished] = wave(1, { at: T0, from: 0.1, to: 0.12 })
    const others = [wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.14 }), wave(3, { at: T0 + 4 * HOUR, from: 0.14, to: 0.16 })]
    // The start in one run, the end in another: not a Wave.
    expect(waveEstimate([run([started!], ...others), run([finished!])])).toBeNull()
  })
})

describe('waveEstimateLine', () => {
  const now = Date.parse('2026-10-07T07:00:00.000Z')
  const sevenDay = { utilization: 0.41, resetsAt: Date.parse('2026-10-09T12:30:00.000Z') / 1000 }

  it('says the estimate for the Wave about to go, the share used now and when the week resets', () => {
    expect(waveEstimateLine({ estimate: { perTicket: 0.02, waves: 5 }, tickets: 3, sevenDay, now })).toBe('A Wave like this usually takes about 6% of the week. Used now: 41%, resets in 2 d 5 h')
  })

  it('says so when there is no estimate, and when the share or the reset is not known', () => {
    expect(waveEstimateLine({ estimate: null, tickets: 3, sevenDay, now })).toBe('No estimate for a Wave yet: fewer than 3 past Waves with fresh Limits. Used now: 41%, resets in 2 d 5 h')
    expect(waveEstimateLine({ estimate: null, tickets: 2, sevenDay: null, now })).toBe('No estimate for a Wave yet: fewer than 3 past Waves with fresh Limits. Used now: unknown')
    expect(waveEstimateLine({ estimate: { perTicket: 0.001, waves: 3 }, tickets: 1, sevenDay: { utilization: 0.4, resetsAt: null }, now })).toBe('A Wave like this usually takes less than 1% of the week. Used now: 40%')
  })

  it('counts the reset in hours and minutes under a day, and says "now" once it is past', () => {
    expect(waveEstimateLine({ estimate: null, tickets: 1, sevenDay: { utilization: 0.9, resetsAt: (now + 3 * HOUR + 10 * 60_000) / 1000 }, now })).toMatch(/Used now: 90%, resets in 3 h 10 min$/)
    expect(waveEstimateLine({ estimate: null, tickets: 1, sevenDay: { utilization: 0.9, resetsAt: (now - 1000) / 1000 }, now })).toMatch(/Used now: 90%, resets now$/)
  })
})

describe('estimateAnswer', () => {
  it('answers the estimate with the 7-day window now, in the shape of autopilot.estimate', () => {
    const runs = [run(wave(1, { at: T0, from: 0.1, to: 0.12 }), wave(2, { at: T0 + 2 * HOUR, from: 0.12, to: 0.14 }), wave(3, { at: T0 + 4 * HOUR, from: 0.14, to: 0.16 }))]
    const week = { utilization: 0.41, resetsAt: 1791795600, status: null, receivedAt: T0, source: 'usage' as const }
    const answer = estimateAnswer(runs, { windows: { seven_day: week, five_hour: { ...week, utilization: 0.9 } } })
    expect(answer).toEqual({ estimate: { perTicket: expect.closeTo(0.02, 10) as unknown as number, waves: 3 }, sevenDay: { utilization: 0.41, resetsAt: 1791795600 } })
    expect(autopilotEstimateAnswerSchema.safeParse(answer).success).toBe(true)
    expect(estimateAnswer([], { windows: {} })).toEqual({ estimate: null, sevenDay: null })
    expect(autopilotEstimateAnswerSchema.safeParse(estimateAnswer([], { windows: {} })).success).toBe(true)
  })
})
