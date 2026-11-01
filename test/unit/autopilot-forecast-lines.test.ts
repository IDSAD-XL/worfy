// The recommendation, the Fastest warning and the forecast lines (worfy-resource-planner ticket 03).
import { describe, expect, it } from 'vitest'
import type { LimitsState, LimitWindowState } from '../../src/shared/agent/limits'
import { BUDGET_FRESH_MS } from '../../src/shared/autopilot/budget'
import type { EpicForecast } from '../../src/shared/autopilot/forecast'
import { dialogLines, fitBeforeReset, forecastLine, modeLine, recommendationLine, warningLine, windowLine } from '../../src/shared/autopilot/forecast-lines'
import { duration, usedNowText, waveEstimateLine } from '../../src/shared/autopilot/limits-estimate'
import { DEFAULT_START_WINDOW } from '../../src/shared/autopilot/run-mode'
import type { WaveDuration } from '../../src/shared/autopilot/wave-duration'

const NOW = Date.parse('2026-10-06T01:00:00.000Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const RESETS = (NOW + 2 * DAY + 5 * HOUR) / 1000

/** Four Waves left whose p90 up to Wave k is 0.1, 0.25, 0.4, 0.5; the range 18–31 %. */
const FOUR: EpicForecast = { waves: 4, tickets: 11, uncounted: 0, samples: 10, range: { low: 0.18, high: 0.31 }, cumulativeHigh: [0, 0.1, 0.25, 0.4, 0.5] }
const FEW: EpicForecast = { waves: 4, tickets: 11, uncounted: 0, samples: 4, range: null, cumulativeHigh: null }
const NONE: EpicForecast = { waves: 0, tickets: 0, uncounted: 0, samples: 10, range: null, cumulativeHigh: null }

const window = (utilization: number | null, extra: Partial<LimitWindowState> = {}): LimitWindowState => ({
  utilization,
  resetsAt: RESETS,
  status: 'allowed',
  receivedAt: NOW,
  source: 'sdk',
  ...extra,
})

/** Limits with a 7-day number `used`, received `age` ms before NOW, resetting in 2 d 5 h unless named. */
function limits(used: number, { age = 0, resetsAt = RESETS, fiveHour }: { age?: number; resetsAt?: number | null; fiveHour?: LimitWindowState } = {}): LimitsState {
  const seven_day = window(used, { resetsAt, receivedAt: NOW - age })
  return { windows: fiveHour === undefined ? { seven_day } : { seven_day, five_hour: fiveHour } }
}

const fit = (forecast: EpicForecast, state: LimitsState, reserve: number | null): number | null => fitBeforeReset({ forecast, limits: state, now: NOW, reserve })

describe('fitBeforeReset', () => {
  it('takes the largest k whose p90 of the first k Waves is at most the share free before the reset', () => {
    // free 0.30: 0.25 fits, 0.4 does not.
    expect(fit(FOUR, limits(0.7), null)).toBe(2)
  })

  it('subtracts the reserve when the budget acts, and only then', () => {
    // 1 − 0.15 − 0.41 = 0.44 holds three Waves (0.4); 1 − 0.41 = 0.59 holds all four (0.5).
    expect(fit(FOUR, limits(0.41), 0.15)).toBe(3)
    expect(fit(FOUR, limits(0.41), null)).toBe(4)
  })

  it('lets in a Wave whose p90 equals the share free', () => {
    // 1 − 0.75 = 0.25 exactly, the p90 of the first two Waves.
    expect(fit(FOUR, limits(0.75), null)).toBe(2)
  })

  it('lets it in when the share free misses it only by the floating-point error', () => {
    // 1 − 0.15 − 0.45 is 0.39999999999999997, the p90 of the first three Waves is 0.4.
    expect(1 - 0.15 - 0.45).toBeLessThan(0.4)
    expect(fit(FOUR, limits(0.45), 0.15)).toBe(3)
  })

  it('reads the p90 edge, not the low edge of the range', () => {
    // free 0.2: above the low edge of all four (0.18), below the p90 of the first two (0.25).
    expect(fit(FOUR, limits(0.8), null)).toBe(1)
  })

  it('answers 0 when not even the first Wave fits', () => {
    expect(fit(FOUR, limits(0.95), null)).toBe(0)
    expect(fit(FOUR, limits(0.9), 0.15)).toBe(0)
  })

  it('has no K without a fresh 7-day number with a reset time ahead', () => {
    expect(fit(FOUR, limits(0.41, { age: BUDGET_FRESH_MS }), null)).toBe(4)
    expect(fit(FOUR, limits(0.41, { age: BUDGET_FRESH_MS + 1 }), null)).toBeNull()
    expect(fit(FOUR, limits(0.41, { resetsAt: null }), null)).toBeNull()
    expect(fit(FOUR, limits(0.41, { resetsAt: (NOW - 1000) / 1000 }), null)).toBeNull()
    expect(fit(FOUR, limits(0.41, { resetsAt: NOW / 1000 }), null)).toBeNull()
    expect(fit(FOUR, limits(0.41, { resetsAt: (NOW + 1000) / 1000 }), null)).toBe(4)
    expect(fit(FOUR, { windows: {} }, null)).toBeNull()
    expect(fit(FOUR, { windows: { seven_day: window(null) } }, null)).toBeNull()
  })

  it('reads a reset time in milliseconds as well as in seconds', () => {
    expect(fit(FOUR, limits(0.7, { resetsAt: RESETS * 1000 }), null)).toBe(2)
  })

  it('has no K without a range or with no Wave left', () => {
    expect(fit(FEW, limits(0.41), null)).toBeNull()
    expect(fit(NONE, limits(0.41), null)).toBeNull()
  })

  it('gives the same K with a full 5-hour window and with no 5-hour window', () => {
    const full = window(1, { status: 'rejected', resetsAt: (NOW + HOUR) / 1000 })
    expect(fit(FOUR, limits(0.7, { fiveHour: full }), 0.15)).toBe(fit(FOUR, limits(0.7), 0.15))
    expect(fit(FOUR, limits(0.7, { fiveHour: full }), null)).toBe(2)
  })

  it('does not read a 5-hour window that is merely high', () => {
    const high = window(0.9, { status: 'allowed', resetsAt: (NOW + HOUR) / 1000 })
    expect(fit(FOUR, limits(0.41, { fiveHour: high }), 0.15)).toBe(3)
    expect(fit(FOUR, limits(0.41, { fiveHour: high }), null)).toBe(4)
  })
})

describe('forecastLine', () => {
  const line = (forecast: EpicForecast, state: LimitsState = limits(0.41)): string => forecastLine({ forecast, limits: state, now: NOW })

  it('says the Waves and Tickets left, the range and the share used now', () => {
    expect(line(FOUR)).toBe('This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h')
  })

  it('says one number when both edges round to it, and less than 1% when both are under 1 %', () => {
    expect(line({ ...FOUR, range: { low: 0.176, high: 0.184 } })).toBe('This Epic: 4 Waves, 11 Tickets left, usually about 18% of the week. Used now: 41%, resets in 2 d 5 h')
    expect(line({ ...FOUR, range: { low: 0.002, high: 0.008 } })).toBe('This Epic: 4 Waves, 11 Tickets left, usually less than 1% of the week. Used now: 41%, resets in 2 d 5 h')
    expect(line({ ...FOUR, range: { low: 0.004, high: 0.012 } })).toBe('This Epic: 4 Waves, 11 Tickets left, usually 0–1% of the week. Used now: 41%, resets in 2 d 5 h')
  })

  it('rounds each edge to the nearest whole percent', () => {
    const share = (low: number, high: number): string => line({ ...FOUR, range: { low, high } }).split(', usually ')[1]!.split(' of the week')[0]!
    expect(share(0.176, 0.316)).toBe('18–32%')
    expect(share(0.184, 0.324)).toBe('18–32%')
  })

  it('says less than 1% only below 1 %', () => {
    const share = (low: number, high: number): string => line({ ...FOUR, range: { low, high } }).split(', usually ')[1]!.split(' of the week')[0]!
    expect(share(0.004, 0.01)).toBe('0–1%')
    expect(share(0.006, 0.01)).toBe('about 1%')
    expect(share(0.004, 0.0099)).toBe('less than 1%')
  })

  it('says there is not enough data under the minimum of samples', () => {
    expect(line(FEW)).toBe('This Epic: 4 Waves, 11 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 41%, resets in 2 d 5 h')
  })

  it('counts the Tickets without a Wave in a sentence of their own, in one and many', () => {
    expect(line({ ...FOUR, uncounted: 1 })).toBe('This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. 1 Ticket without a Wave is not counted. Used now: 41%, resets in 2 d 5 h')
    expect(line({ ...FOUR, uncounted: 2 })).toBe('This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. 2 Tickets without a Wave are not counted. Used now: 41%, resets in 2 d 5 h')
    expect(line({ ...FEW, uncounted: 2 })).toBe(
      'This Epic: 4 Waves, 11 Tickets left. 2 Tickets without a Wave are not counted. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 41%, resets in 2 d 5 h',
    )
  })

  it('says one Wave and one Ticket in the singular', () => {
    expect(line({ ...FOUR, waves: 1, tickets: 1 })).toMatch(/^This Epic: 1 Wave, 1 Ticket left, usually/)
  })

  it('says only that no Wave is left when none is', () => {
    expect(line(NONE)).toBe('This Epic: no Wave left to forecast')
    expect(line({ ...NONE, uncounted: 2 })).toBe('This Epic: no Wave left to forecast. 2 Tickets without a Wave are not counted')
  })

  it('ends like the Wave line of ticket 40: unknown, without a reset time, resets now', () => {
    const head = 'This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week'
    expect(line(FOUR, { windows: {} })).toBe(`${head}. Used now: unknown`)
    expect(line(FOUR, limits(0.41, { age: BUDGET_FRESH_MS + 1 }))).toBe(`${head}. Used now: unknown`)
    expect(line(FOUR, limits(0.4, { resetsAt: null }))).toBe(`${head}. Used now: 40%`)
    expect(line(FOUR, limits(0.9, { resetsAt: (NOW - 1000) / 1000 }))).toBe(`${head}. Used now: 90%, resets now`)
  })

  it('says nothing of the 5-hour window', () => {
    const full = window(1, { status: 'rejected', resetsAt: (NOW + HOUR) / 1000 })
    expect(line(FOUR, limits(0.41, { fiveHour: full }))).toBe(line(FOUR))
  })
})

describe('waveEstimateLine keeps its tail', () => {
  it('still ends with the share used now', () => {
    expect(waveEstimateLine({ estimate: { perTicket: 0.02, waves: 5 }, tickets: 3, sevenDay: { utilization: 0.41, resetsAt: RESETS }, now: NOW })).toBe(
      'A Wave like this usually takes about 6% of the week. Used now: 41%, resets in 2 d 5 h',
    )
  })

  it('rounds the share used now to the nearest percent and says resets now at the reset itself', () => {
    expect(usedNowText({ utilization: 0.416, resetsAt: RESETS }, NOW)).toBe('Used now: 42%, resets in 2 d 5 h')
    expect(usedNowText({ utilization: 0.9, resetsAt: NOW / 1000 }, NOW)).toBe('Used now: 90%, resets now')
    expect(usedNowText({ utilization: 0.9, resetsAt: (NOW + MIN) / 1000 }, NOW)).toBe('Used now: 90%, resets in 1 min')
  })

  it('exports duration', () => {
    expect([duration(2 * DAY + 5 * HOUR), duration(3 * HOUR + 10 * MIN), duration(25 * MIN)]).toEqual(['2 d 5 h', '3 h 10 min', '25 min'])
  })
})

describe('recommendationLine', () => {
  it('says the spec texts', () => {
    expect(recommendationLine(2, 4)).toBe('Recommended: 2 Waves now, the other 2 after the reset')
    expect(recommendationLine(4, 4)).toBe('All 4 Waves fit before the reset without the reserve')
    expect(recommendationLine(0, 4)).toBe('Recommended: no Wave now, all 4 after the reset')
  })

  it('says one Wave in the singular', () => {
    expect(recommendationLine(1, 4)).toBe('Recommended: 1 Wave now, the other 3 after the reset')
    expect(recommendationLine(1, 1)).toBe('1 Wave fits before the reset without the reserve')
    expect(recommendationLine(0, 1)).toBe('Recommended: no Wave now, 1 after the reset')
  })

  it('says nothing without a K', () => {
    expect(recommendationLine(null, 4)).toBeNull()
  })
})

describe('warningLine', () => {
  it('says the spec text when not all Waves fit', () => {
    expect(warningLine(2, 4)).toBe('Only 2 of 4 Waves fit before the reset: then the run waits for the Limits')
    expect(warningLine(1, 4)).toBe('Only 1 of 4 Waves fits before the reset: then the run waits for the Limits')
    expect(warningLine(0, 4)).toBe('No Wave fits before the reset: then the run waits for the Limits')
    expect(warningLine(0, 1)).toBe('No Wave fits before the reset: then the run waits for the Limits')
  })

  it('says nothing when all fit or without a K', () => {
    expect(warningLine(4, 4)).toBeNull()
    expect(warningLine(null, 4)).toBeNull()
  })
})

describe('windowLine and modeLine', () => {
  it('says how long a Wave usually takes, or that it is not known', () => {
    expect(windowLine(DEFAULT_START_WINDOW, { p90: HOUR + 40 * MIN, samples: 7 })).toBe('Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min')
    expect(windowLine({ from: 9, to: 18 }, { p90: null, samples: 4 })).toBe('Start window 09:00–18:00. Not enough data on Wave duration: every Wave may start inside the window')
  })

  it('names the mode and where it is set', () => {
    expect(modeLine('budget-aware')).toBe('Mode: Budget-aware (Settings → Autopilot)')
    expect(modeLine('fastest')).toBe('Mode: Fastest (Settings → Autopilot)')
    expect(modeLine('start-window')).toBe('Mode: Start window (Settings → Autopilot)')
  })
})

describe('dialogLines', () => {
  const WAVE: WaveDuration = { p90: HOUR + 40 * MIN, samples: 7 }
  const lines = (forecast: EpicForecast, state: LimitsState, reserve = 0.15, wave: WaveDuration = WAVE): string[] =>
    dialogLines({ forecast, wave, limits: state, now: NOW, reserve, window: DEFAULT_START_WINDOW })

  it('says the forecast, the recommendation, the Fastest warning and the window', () => {
    // Used 0.7: 1 − 0.15 − 0.7 = 0.15 with the reserve holds one Wave (0.1); 0.30 without it holds two (0.25).
    expect(lines(FOUR, limits(0.7), 0.15)).toEqual([
      'Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 70%, resets in 2 d 5 h.',
      'Budget-aware: Recommended: 1 Wave now, the other 3 after the reset.',
      'Fastest: Only 2 of 4 Waves fit before the reset: then the run waits for the Limits.',
      'Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.',
    ])
  })

  it('says only the forecast and the window with too few samples', () => {
    expect(lines(FEW, limits(0.7))).toEqual([
      'Forecast: This Epic: 4 Waves, 11 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 70%, resets in 2 d 5 h.',
      'Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.',
    ])
  })

  it('has no Budget-aware and no Fastest line without a 7-day number', () => {
    expect(lines(FOUR, { windows: {} })).toEqual([
      'Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: unknown.',
      'Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.',
    ])
  })

  it('has no Fastest line when all Waves fit without the reserve', () => {
    expect(lines(FOUR, limits(0.41))).toEqual([
      'Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h.',
      'Budget-aware: Recommended: 3 Waves now, the other 1 after the reset.',
      'Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.',
    ])
  })

  it('says the window without data on the duration', () => {
    expect(lines(FEW, limits(0.7), 0.15, { p90: null, samples: 2 }).at(-1)).toBe('Start window 23:00–07:00. Not enough data on Wave duration: every Wave may start inside the window.')
  })
})
