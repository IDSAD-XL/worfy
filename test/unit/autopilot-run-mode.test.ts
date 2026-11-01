// The Run mode and the Start window (src/shared/autopilot/run-mode.ts, worfy-resource-planner ticket
// 04): the three modes and the window of whole local hours — inside or outside, its end, the next
// start. Local time is the process's time zone: each case fixes it in TZ and builds its moments from
// local dates, so the checks read the wall clock, the day of a change of the clocks included.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_START_WINDOW, hourText, inWindow, nextWindowStart, RUN_MODE_LABELS, RUN_MODES, windowEnd, type StartWindow } from '../../src/shared/autopilot/run-mode'
import { autopilotRunOf } from '../../src/shared/settings/app-settings'

let zone: string | undefined

/** Runs the cases of a block in time zone `name`, and puts the process's zone back after each. */
function inZone(name: string): void {
  beforeEach(() => {
    zone = process.env.TZ
    process.env.TZ = name
  })
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })
}

/** A local moment of the zone in force: year, month 1–12, day, hour, minute. */
const at = (year: number, month: number, day: number, hour: number, minute = 0): number => new Date(year, month - 1, day, hour, minute).getTime()

const NIGHT: StartWindow = { from: 23, to: 7 }
const DAY: StartWindow = { from: 9, to: 17 }

describe('the Run modes', () => {
  it('are Fastest, Budget-aware and Start window, in that order', () => {
    expect(RUN_MODES).toEqual(['fastest', 'budget-aware', 'start-window'])
    expect(RUN_MODES.map((mode) => RUN_MODE_LABELS[mode])).toEqual(['Fastest', 'Budget-aware', 'Start window'])
  })

  it('the Start window of a Machine that chose none is 23:00–07:00; hours read as HH:00', () => {
    expect(DEFAULT_START_WINDOW).toEqual({ from: 23, to: 7 })
    expect([0, 7, 23].map(hourText)).toEqual(['00:00', '07:00', '23:00'])
  })
})

describe('a Start window across midnight, 23:00–07:00', () => {
  inZone('UTC')

  it('starts at 23:00 and ends at 07:00: 22:59 outside, 23:00 inside, 06:59 inside, 07:00 outside', () => {
    expect(inWindow(at(2026, 11, 1, 6, 59), NIGHT)).toBe(true)
    expect(inWindow(at(2026, 11, 1, 22, 59), NIGHT)).toBe(false)
    expect(inWindow(at(2026, 11, 1, 23, 0), NIGHT)).toBe(true)
    expect(inWindow(at(2026, 11, 2, 0, 0), NIGHT)).toBe(true)
    expect(inWindow(at(2026, 11, 2, 7, 0), NIGHT)).toBe(false)
    expect(inWindow(at(2026, 11, 2, 12, 0), NIGHT)).toBe(false)
  })

  it('the end of the window at 01:00 is 07:00 of that morning; at 23:30 — 07:00 of the next morning', () => {
    expect(windowEnd(at(2026, 11, 2, 1, 0), NIGHT)).toBe(at(2026, 11, 2, 7, 0))
    expect(windowEnd(at(2026, 11, 1, 23, 30), NIGHT)).toBe(at(2026, 11, 2, 7, 0))
    expect(windowEnd(at(2026, 11, 1, 23, 0), NIGHT)).toBe(at(2026, 11, 2, 7, 0))
  })

  it('the next start at 08:00 is 23:00 of the same day; at 23:30 and at 23:00 itself — 23:00 of the next day', () => {
    expect(nextWindowStart(at(2026, 11, 2, 8, 0), NIGHT)).toBe(at(2026, 11, 2, 23, 0))
    expect(nextWindowStart(at(2026, 11, 1, 23, 30), NIGHT)).toBe(at(2026, 11, 2, 23, 0))
    expect(nextWindowStart(at(2026, 11, 1, 23, 0), NIGHT)).toBe(at(2026, 11, 2, 23, 0))
    expect(nextWindowStart(at(2026, 11, 2, 1, 0), NIGHT)).toBe(at(2026, 11, 2, 23, 0))
  })
})

describe('a Start window within one day, 09:00–17:00', () => {
  inZone('UTC')

  it('is inside from 09:00 to 16:59 and outside before and after, midnight included', () => {
    expect(inWindow(at(2026, 11, 2, 8, 59), DAY)).toBe(false)
    expect(inWindow(at(2026, 11, 2, 9, 0), DAY)).toBe(true)
    expect(inWindow(at(2026, 11, 2, 16, 59), DAY)).toBe(true)
    expect(inWindow(at(2026, 11, 2, 17, 0), DAY)).toBe(false)
    expect(inWindow(at(2026, 11, 2, 0, 0), DAY)).toBe(false)
    expect(inWindow(at(2026, 11, 2, 23, 30), DAY)).toBe(false)
  })

  it('ends at 17:00 of the same day; the next start is 09:00 of the same day before it and of the next day after it', () => {
    expect(windowEnd(at(2026, 11, 2, 10, 0), DAY)).toBe(at(2026, 11, 2, 17, 0))
    expect(nextWindowStart(at(2026, 11, 2, 7, 0), DAY)).toBe(at(2026, 11, 2, 9, 0))
    expect(nextWindowStart(at(2026, 11, 2, 18, 0), DAY)).toBe(at(2026, 11, 3, 9, 0))
    expect(nextWindowStart(at(2026, 11, 2, 10, 0), DAY)).toBe(at(2026, 11, 3, 9, 0))
  })
})

describe('the Start window on the days the clocks change (Europe/Kyiv)', () => {
  inZone('Europe/Kyiv')
  const HOUR = 60 * 60 * 1000

  it('the night the clocks go forward (29 March 2026, 03:00 → 04:00): 23:00 to 07:00 by the wall clock, 7 hours', () => {
    const start = nextWindowStart(at(2026, 3, 28, 12, 0), NIGHT)
    // 23:00 EET (UTC+2) and 07:00 EEST (UTC+3).
    expect(start).toBe(Date.UTC(2026, 2, 28, 21, 0))
    const end = windowEnd(start + HOUR, NIGHT)
    expect(end).toBe(Date.UTC(2026, 2, 29, 4, 0))
    expect(new Date(end).getHours()).toBe(7)
    expect((end - start) / HOUR).toBe(7)
    expect(inWindow(Date.UTC(2026, 2, 29, 3, 59), NIGHT)).toBe(true)
    expect(inWindow(end, NIGHT)).toBe(false)
    // The next start after the end is 23:00 EEST of the same day.
    expect(nextWindowStart(end, NIGHT)).toBe(Date.UTC(2026, 2, 29, 20, 0))
  })

  it('the night the clocks go back (25 October 2026, 04:00 → 03:00): 23:00 to 07:00 by the wall clock, 9 hours', () => {
    const start = nextWindowStart(at(2026, 10, 24, 12, 0), NIGHT)
    // 23:00 EEST (UTC+3) and 07:00 EET (UTC+2).
    expect(start).toBe(Date.UTC(2026, 9, 24, 20, 0))
    const end = windowEnd(start + HOUR, NIGHT)
    expect(end).toBe(Date.UTC(2026, 9, 25, 5, 0))
    expect(new Date(end).getHours()).toBe(7)
    expect((end - start) / HOUR).toBe(9)
    expect(inWindow(Date.UTC(2026, 9, 25, 4, 59), NIGHT)).toBe(true)
    expect(inWindow(end, NIGHT)).toBe(false)
    expect(nextWindowStart(end, NIGHT)).toBe(Date.UTC(2026, 9, 25, 21, 0))
  })

  it('a day window keeps its wall-clock hours on the day of 25 hours too', () => {
    expect(windowEnd(at(2026, 10, 25, 10, 0), DAY)).toBe(Date.UTC(2026, 9, 25, 15, 0))
    expect(nextWindowStart(at(2026, 10, 25, 1, 0), DAY)).toBe(Date.UTC(2026, 9, 25, 7, 0))
  })
})

describe('autopilotRunOf', () => {
  it('a Machine that chose nothing, with the budget off: Fastest, 23:00–07:00', () => {
    expect(autopilotRunOf({})).toEqual({ mode: 'fastest', window: { from: 23, to: 7 } })
    expect(autopilotRunOf({ autopilotBudget: { enabled: false, reservePercent: 20 } })).toEqual({ mode: 'fastest', window: { from: 23, to: 7 } })
  })

  it('with the budget on and no mode chosen: Budget-aware; the window stays the default', () => {
    expect(autopilotRunOf({ autopilotBudget: { enabled: true } })).toEqual({ mode: 'budget-aware', window: { from: 23, to: 7 } })
  })

  it('a chosen mode and window stay chosen whatever the budget says; one edge chosen keeps the other at its default', () => {
    const chosen = { autopilotRun: { mode: 'start-window', windowFrom: 22, windowTo: 6 } } as const
    expect(autopilotRunOf({ ...chosen, autopilotBudget: { enabled: true } })).toEqual({ mode: 'start-window', window: { from: 22, to: 6 } })
    expect(autopilotRunOf({ ...chosen, autopilotBudget: { enabled: false } })).toEqual({ mode: 'start-window', window: { from: 22, to: 6 } })
    expect(autopilotRunOf({ autopilotRun: { mode: 'fastest' }, autopilotBudget: { enabled: true } }).mode).toBe('fastest')
    expect(autopilotRunOf({ autopilotRun: { mode: 'budget-aware' }, autopilotBudget: { enabled: false } }).mode).toBe('budget-aware')
    expect(autopilotRunOf({ autopilotRun: { windowTo: 5 } }).window).toEqual({ from: 23, to: 5 })
  })
})
