// The budget of the Limits for Autopilot (worfy-throughput ticket 41): the week left after the
// reserve, spread over the days until the 7-day window resets; the share of today against what
// today used by the journal; whether the next Wave may start, and when the run goes on if not.
// Times are built in the Machine's local time, as the day of the budget is.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LimitsState } from '../../src/shared/agent/limits'
import {
  BUDGET_FRESH_MS,
  budgetDay,
  budgetDecision,
  budgetFromSettings,
  budgetResumeAt,
  budgetStopText,
  dailyShare,
  daysToReset,
  localDayStart,
  nextLocalDayStart,
  weekReadings,
  type BudgetInput,
} from '../../src/shared/autopilot/budget'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'

/** A local time on October 2026. */
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()
const iso = (ms: number): string => new Date(ms).toISOString()
const S = (ms: number): number => ms / 1000

/** The 7-day window resets on 31 October at 09:00. */
const WEEK_RESET = at(31, 9)
const NOW = at(28, 10)
const RUN = '2026-10-28T01-00-00-000Z-a1b2c3'

function limits(week: { utilization: number | null; resetsAt?: number | null; receivedAt?: number } | null, five?: { utilization: number; resetsAt: number; status?: string; receivedAt?: number }): LimitsState {
  const windows: LimitsState['windows'] = {}
  if (week !== null) {
    const resetsAt = week.resetsAt === undefined ? WEEK_RESET : week.resetsAt
    windows.seven_day = { utilization: week.utilization, resetsAt: resetsAt === null ? null : S(resetsAt), status: null, receivedAt: week.receivedAt ?? NOW, source: 'usage' }
  }
  if (five !== undefined) windows.five_hour = { utilization: five.utilization, resetsAt: S(five.resetsAt), status: five.status ?? null, receivedAt: five.receivedAt ?? NOW, source: 'usage' }
  return { windows }
}

/** A Wave's two lines with the 7-day share at each end. */
function wave(num: number, start: { at: number; utilization: number; resetsAt?: number }, end: { at: number; utilization: number; resetsAt?: number }): JournalEvent[] {
  const line = (kind: 'wave-started' | 'wave-finished', point: { at: number; utilization: number; resetsAt?: number }): JournalEvent => ({
    at: iso(point.at),
    run: RUN,
    project: 'demo-00000001',
    epic: 'demo',
    kind,
    wave: num,
    tickets: ['01'],
    limits: { five_hour: null, seven_day: { utilization: point.utilization, receivedAt: iso(point.at), resetsAt: iso(point.resetsAt ?? WEEK_RESET) } },
  })
  return [line('wave-started', start), line('wave-finished', end)]
}

const ON = { enabled: true, reserve: 0.15 }

function input(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return { budget: ON, now: NOW, limits: limits({ utilization: 0.48 }), runs: [], estimate: null, tickets: 1, ...overrides }
}

describe('the share of a day', () => {
  it('is the week left after the reserve and the used share, over the days until the reset', () => {
    expect(dailyShare({ reserve: 0.15, used: 0.48, days: 4 })).toBeCloseTo(0.0925, 10)
    expect(dailyShare({ reserve: 0, used: 0, days: 7 })).toBeCloseTo(1 / 7, 10)
    // The reserve reached: nothing for today.
    expect(dailyShare({ reserve: 0.15, used: 0.9, days: 3 })).toBe(0)
    // Never over less than one day.
    expect(dailyShare({ reserve: 0.15, used: 0.5, days: 0 })).toBeCloseTo(0.35, 10)
  })

  it('counts the days until the reset from the start of the local day, today included', () => {
    expect(localDayStart(NOW)).toBe(at(28, 0))
    expect(nextLocalDayStart(NOW)).toBe(at(29, 0))
    // 28 Oct 00:00 → 31 Oct 09:00: three days and nine hours, four days with a share.
    expect(daysToReset(NOW, WEEK_RESET)).toBe(4)
    expect(daysToReset(at(28, 23, 59), WEEK_RESET)).toBe(4)
    expect(daysToReset(at(31, 8), WEEK_RESET)).toBe(1)
  })

  it('takes the first number of today in the journal as the start of the day: the share stays, today\'s use grows', () => {
    const runs = [[...wave(1, { at: at(28, 1), utilization: 0.4 }, { at: at(28, 3), utilization: 0.44 })], [...wave(1, { at: at(27, 20), utilization: 0.3 }, { at: at(27, 22), utilization: 0.36 })]]
    const day = budgetDay({ reserve: 0.15, now: NOW, week: { at: NOW, utilization: 0.48, resetsAt: WEEK_RESET }, readings: weekReadings(runs) })
    // From 0.40 at 01:00: (1 − 0.15 − 0.40) / 4 days.
    expect(day.share).toBeCloseTo(0.1125, 10)
    expect(day.used).toBeCloseTo(0.08, 10)
    expect(day.remaining).toBeCloseTo(0.0325, 10)
    expect(day.since).toBe(at(28, 1))
  })

  it('with no number of today yet the day starts now, with nothing used', () => {
    const runs = [wave(1, { at: at(27, 20), utilization: 0.3 }, { at: at(27, 22), utilization: 0.36 })]
    const day = budgetDay({ reserve: 0.15, now: NOW, week: { at: NOW, utilization: 0.48, resetsAt: WEEK_RESET }, readings: weekReadings(runs) })
    expect(day.share).toBeCloseTo(0.0925, 10)
    expect(day.used).toBe(0)
    expect(day.since).toBe(NOW)
  })

  it('a reset of the 7-day window in the middle of the day computes the share anew from the new window', () => {
    // The old window reset at 06:00 today; the numbers of the morning are of the old one.
    const oldReset = at(28, 6)
    const newReset = at(35, 6)
    const runs = [wave(1, { at: at(28, 1), utilization: 0.8, resetsAt: oldReset }, { at: at(28, 3), utilization: 0.83, resetsAt: oldReset })]
    const day = budgetDay({ reserve: 0.15, now: NOW, week: { at: NOW, utilization: 0.02, resetsAt: newReset }, readings: weekReadings(runs) })
    // 28 Oct 00:00 → 4 Nov 06:00: eight days with a share, from 0.02 now.
    expect(daysToReset(NOW, newReset)).toBe(8)
    expect(day.share).toBeCloseTo((1 - 0.15 - 0.02) / 8, 10)
    expect(day.used).toBe(0)
    expect(day.since).toBe(NOW)
  })
})

describe('when the run goes on', () => {
  it('with the share of the day left: the start of the next day or the reset of the 5-hour window, whichever is first', () => {
    expect(budgetResumeAt({ now: NOW, dayLeft: true, fiveHourResetsAt: at(28, 13), sevenDayResetsAt: WEEK_RESET })).toBe(at(28, 13) + RESUME_MARGIN_MS)
    expect(budgetResumeAt({ now: at(28, 22), dayLeft: true, fiveHourResetsAt: at(29, 2), sevenDayResetsAt: WEEK_RESET })).toBe(at(29, 0))
  })

  it('with the share of the day used: the start of the next day only, or the 7-day reset when it is first', () => {
    expect(budgetResumeAt({ now: NOW, dayLeft: false, fiveHourResetsAt: at(28, 13), sevenDayResetsAt: WEEK_RESET })).toBe(at(29, 0))
    expect(budgetResumeAt({ now: at(31, 7), dayLeft: false, fiveHourResetsAt: at(31, 8), sevenDayResetsAt: WEEK_RESET })).toBe(WEEK_RESET + RESUME_MARGIN_MS)
    // A reset time already passed does not count.
    expect(budgetResumeAt({ now: NOW, dayLeft: true, fiveHourResetsAt: at(28, 9), sevenDayResetsAt: at(28, 8) })).toBe(at(29, 0))
    expect(budgetResumeAt({ now: NOW, dayLeft: true, fiveHourResetsAt: null, sevenDayResetsAt: null })).toBe(at(29, 0))
  })
})

describe('whether the next Wave starts', () => {
  it('the budget off: no stop, whatever is used', () => {
    expect(budgetDecision(input({ budget: { enabled: false, reserve: 0.15 }, limits: limits({ utilization: 0.99 }, { utilization: 1, resetsAt: at(28, 12) }) }))).toEqual({ kind: 'go' })
  })

  it('the share of the day used: stops until the start of the next day', () => {
    const runs = [wave(1, { at: at(28, 1), utilization: 0.4 }, { at: at(28, 9), utilization: 0.52 })]
    const decision = budgetDecision(input({ runs, limits: limits({ utilization: 0.52 }) }))
    expect(decision).toEqual({ kind: 'stop', cause: 'daily-share', share: expect.closeTo(0.1125, 10), used: expect.closeTo(0.12, 10), need: 0, until: at(29, 0) })
  })

  it('what is left of the day is less than the estimate of the Wave: the Wave does not start', () => {
    const runs = [wave(1, { at: at(28, 1), utilization: 0.4 }, { at: at(28, 9), utilization: 0.45 })]
    // Left: 0.1125 − 0.05 = 0.0625; the Wave of three Tickets at 0.03 each needs 0.09.
    const stop = budgetDecision(input({ runs, limits: limits({ utilization: 0.45 }), estimate: { perTicket: 0.03, waves: 5 }, tickets: 3 }))
    expect(stop).toMatchObject({ kind: 'stop', cause: 'daily-share', need: expect.closeTo(0.09, 10), until: at(29, 0) })
    // Two Tickets need 0.06: it fits.
    expect(budgetDecision(input({ runs, limits: limits({ utilization: 0.45 }), estimate: { perTicket: 0.03, waves: 5 }, tickets: 2 }))).toEqual({ kind: 'go' })
    // Without an estimate only a used share stops it.
    expect(budgetDecision(input({ runs, limits: limits({ utilization: 0.45 }), tickets: 3 }))).toEqual({ kind: 'go' })
  })

  it('a Wave estimated above the whole share of the day goes as the first one of the day, and waits once something of the day is used', () => {
    // 28 Oct → 31 Oct 09:00: four days; (1 − 0.15 − 0.554) / 4 = 7.4 % a day, against 4 Tickets × 2 % = 8 %.
    const big = { estimate: { perTicket: 0.02, waves: 5 }, tickets: 4 }
    expect(budgetDay({ reserve: 0.15, now: NOW, week: { at: NOW, utilization: 0.554, resetsAt: WEEK_RESET }, readings: [] }).share).toBeCloseTo(0.074, 10)
    expect(budgetDecision(input({ ...big, limits: limits({ utilization: 0.554 }) }))).toEqual({ kind: 'go' })
    // At 01:00 the day began at 55.4 %; now 56 %: something is used, and 6.8 % left is less than 8 %.
    const runs = [wave(1, { at: at(28, 1), utilization: 0.554 }, { at: at(28, 3), utilization: 0.56 })]
    expect(budgetDecision(input({ ...big, runs, limits: limits({ utilization: 0.56 }) }))).toMatchObject({ kind: 'stop', cause: 'daily-share', need: expect.closeTo(0.08, 10), until: at(29, 0) })
  })

  it('the share of the day left but the 5-hour window full: stops until its reset, also at night', () => {
    const night = at(28, 23)
    const fiveReset = at(29, 1, 30)
    const stop = budgetDecision(input({ now: night, limits: limits({ utilization: 0.48, receivedAt: night }, { utilization: 1, resetsAt: fiveReset, receivedAt: night }) }))
    // Midnight comes first.
    expect(stop).toMatchObject({ kind: 'stop', cause: 'five-hour', until: at(29, 0) })
    const evening = budgetDecision(input({ limits: limits({ utilization: 0.48 }, { utilization: 1.02, resetsAt: at(28, 12) }) }))
    expect(evening).toMatchObject({ kind: 'stop', cause: 'five-hour', until: at(28, 12) + RESUME_MARGIN_MS })
    // `rejected` counts as full; a window not full does not stop.
    expect(budgetDecision(input({ limits: limits({ utilization: 0.48 }, { utilization: 0.4, resetsAt: at(28, 12), status: 'rejected' }) }))).toMatchObject({ kind: 'stop', cause: 'five-hour' })
    expect(budgetDecision(input({ limits: limits({ utilization: 0.48 }, { utilization: 0.97, resetsAt: at(28, 12) }) }))).toEqual({ kind: 'go' })
  })

  it('the reserve reached: stops until the next day, or the 7-day reset when it comes first', () => {
    expect(budgetDecision(input({ limits: limits({ utilization: 0.86 }) }))).toMatchObject({ kind: 'stop', cause: 'daily-share', share: 0, until: at(29, 0) })
    const lastDay = at(31, 7)
    expect(budgetDecision(input({ now: lastDay, limits: limits({ utilization: 0.86, receivedAt: lastDay }) }))).toMatchObject({ kind: 'stop', until: WEEK_RESET + RESUME_MARGIN_MS })
  })

  it('nothing known of the 7-day window, or only an old number: no stop', () => {
    expect(budgetDecision(input({ limits: limits(null) }))).toEqual({ kind: 'go' })
    expect(budgetDecision(input({ limits: limits({ utilization: null }) }))).toEqual({ kind: 'go' })
    expect(budgetDecision(input({ limits: limits({ utilization: 0.9, resetsAt: null }) }))).toEqual({ kind: 'go' })
    expect(budgetDecision(input({ limits: limits({ utilization: 0.9, resetsAt: at(28, 9) }) }))).toEqual({ kind: 'go' })
    expect(budgetDecision(input({ limits: limits({ utilization: 0.9, receivedAt: NOW - BUDGET_FRESH_MS - 1 }) }))).toEqual({ kind: 'go' })
    expect(budgetDecision(input({ limits: limits({ utilization: 0.9, receivedAt: NOW - BUDGET_FRESH_MS }) }))).toMatchObject({ kind: 'stop' })
  })
})

describe('the days until the reset across a change of the clocks (Europe/Kyiv)', () => {
  let zone: string | undefined
  beforeAll(() => {
    zone = process.env.TZ
    process.env.TZ = 'Europe/Kyiv'
  })
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })

  it('counts calendar dates: a day of 25 or 23 hours is one day, a reset at midnight adds no day', () => {
    const local = (month: number, day: number, hour: number, minute = 0): number => new Date(2026, month, day, hour, minute).getTime()
    // The zone is in force: summer time before 25 October, winter time after.
    expect([new Date(2026, 9, 24, 12).getTimezoneOffset(), new Date(2026, 9, 26, 12).getTimezoneOffset()]).toEqual([-180, -120])
    // The clocks go back on 25 October: 24 Oct → 31 Oct 00:00 is seven days, though 7 d 1 h long.
    expect(daysToReset(local(9, 24, 12), local(9, 31, 0))).toBe(7)
    // They go forward on 29 March: 28 Mar → 4 Apr 00:30 is eight days with a share, though 6 d 23.5 h from the first midnight.
    expect(daysToReset(local(2, 28, 12), local(3, 4, 0, 30))).toBe(8)
    expect(nextLocalDayStart(local(9, 25, 1))).toBe(local(9, 26, 0))
  })
})

describe('the budget from the app settings', () => {
  it('the reserve in percent becomes a share; nothing chosen is off with 15 %', () => {
    expect(budgetFromSettings({ autopilotBudget: { enabled: true, reservePercent: 40 } })).toEqual({ enabled: true, reserve: 0.4 })
    expect(budgetFromSettings({})).toEqual({ enabled: false, reserve: 0.15 })
  })
})

describe('the reason in words', () => {
  it('says what stopped the run and when it goes on, without prices', () => {
    expect(budgetStopText('daily-share', Date.UTC(2026, 9, 29, 0, 0), { timeZone: 'UTC' })).toBe("Today's share of the Limits is used: Autopilot continues at 00:00")
    expect(budgetStopText('five-hour', Date.UTC(2026, 9, 28, 13, 2), { timeZone: 'UTC' })).toBe('The 5-hour Limits are used, today\'s share is not: Autopilot continues at 13:02')
  })
})
