// Work hours of the Assistant's checks (src/shared/assistant/schedule/work-hours.ts, worfy-assistant ticket 04):
// days of the week, one or several windows of local time, a time zone. The moments are built in UTC with
// the zone's offset written out, so each case reads the wall clock of the zone it names, the nights the
// clocks change included (Europe/Kyiv: 2026-03-29 03:00 → 04:00, 2026-10-25 04:00 → 03:00).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORK_HOURS, inWorkHours, nextWorkHoursStart, workHoursSchema, type WorkHours } from '../../src/shared/assistant/schedule/work-hours'

const KYIV = 'Europe/Kyiv'

/** A UTC moment: year, month 1–12, day, hour, minute. */
const utc = (year: number, month: number, day: number, hour: number, minute = 0): number => Date.UTC(year, month - 1, day, hour, minute)

/** Minutes of the day of `hh:mm`. */
const at = (hour: number, minute = 0): number => hour * 60 + minute

const OFFICE: WorkHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: at(9), to: at(18) }], timeZone: KYIV }
const EVERY_DAY: WorkHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], windows: [{ from: at(9), to: at(18) }], timeZone: KYIV }

describe('inWorkHours', () => {
  it('the default is Monday to Friday, 09:00–18:00 of the machine zone', () => {
    expect(DEFAULT_WORK_HOURS).toEqual({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: at(9), to: at(18) }] })
  })

  it('a window holds from its start, included, to its end, not included, on the chosen days only', () => {
    // Wednesday 2026-11-25, Kyiv in winter time (UTC+2).
    expect(inWorkHours(utc(2026, 11, 25, 7, 0), OFFICE)).toBe(true) // 09:00
    expect(inWorkHours(utc(2026, 11, 25, 6, 59), OFFICE)).toBe(false) // 08:59
    expect(inWorkHours(utc(2026, 11, 25, 15, 59), OFFICE)).toBe(true) // 17:59
    expect(inWorkHours(utc(2026, 11, 25, 16, 0), OFFICE)).toBe(false) // 18:00
    // Saturday 2026-11-28 at noon.
    expect(inWorkHours(utc(2026, 11, 28, 10, 0), OFFICE)).toBe(false)
  })

  it('several windows: the gap between them is outside', () => {
    const split: WorkHours = { ...OFFICE, windows: [{ from: at(9), to: at(12) }, { from: at(13), to: at(18) }] }
    expect(inWorkHours(utc(2026, 11, 25, 9, 30), split)).toBe(true) // 11:30
    expect(inWorkHours(utc(2026, 11, 25, 10, 30), split)).toBe(false) // 12:30
    expect(inWorkHours(utc(2026, 11, 25, 11, 0), split)).toBe(true) // 13:00
  })

  it('a window whose end is before its start goes across midnight and belongs to the day it starts', () => {
    const night: WorkHours = { days: ['fri'], windows: [{ from: at(22), to: at(2) }], timeZone: KYIV }
    expect(inWorkHours(utc(2026, 11, 27, 19, 59), night)).toBe(false) // Friday 21:59
    expect(inWorkHours(utc(2026, 11, 27, 20, 0), night)).toBe(true) // Friday 22:00
    expect(inWorkHours(utc(2026, 11, 27, 22, 0), night)).toBe(true) // Saturday 00:00
    expect(inWorkHours(utc(2026, 11, 27, 23, 30), night)).toBe(true) // Saturday 01:30
    expect(inWorkHours(utc(2026, 11, 28, 0, 0), night)).toBe(false) // Saturday 02:00
    // Friday 01:00 is the tail of Thursday's window, and Thursday is not chosen.
    expect(inWorkHours(utc(2026, 11, 26, 23, 0), night)).toBe(false)
  })

  it('the time zone decides: one moment is inside in Kyiv and outside in New York', () => {
    const moment = utc(2026, 11, 25, 8, 0) // Kyiv 10:00, New York 03:00
    expect(inWorkHours(moment, OFFICE)).toBe(true)
    expect(inWorkHours(moment, { ...OFFICE, timeZone: 'America/New_York' })).toBe(false)
  })

  describe('without a time zone, the zone of the machine', () => {
    let zone: string | undefined
    beforeEach(() => {
      zone = process.env.TZ
      process.env.TZ = 'Asia/Tokyo'
    })
    afterEach(() => {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    })

    it('reads the wall clock of the process zone', () => {
      const machine: WorkHours = { days: OFFICE.days, windows: OFFICE.windows }
      expect(inWorkHours(utc(2026, 11, 25, 1, 0), machine)).toBe(true) // Tokyo 10:00
      expect(inWorkHours(utc(2026, 11, 25, 10, 0), machine)).toBe(false) // Tokyo 19:00
    })
  })

  it('the night the clocks go forward, the wall clock still decides', () => {
    // 2026-03-29, Kyiv: 03:00 EET becomes 04:00 EEST at 01:00 UTC.
    const early: WorkHours = { ...EVERY_DAY, windows: [{ from: at(3, 30), to: at(5) }] }
    expect(inWorkHours(utc(2026, 3, 29, 0, 59), early)).toBe(false) // 02:59
    expect(inWorkHours(utc(2026, 3, 29, 1, 0), early)).toBe(true) // 04:00, the 03:30 start was skipped
    expect(inWorkHours(utc(2026, 3, 29, 2, 0), early)).toBe(false) // 05:00
  })
})

describe('nextWorkHoursStart', () => {
  it('is now while inside work hours', () => {
    const inside = utc(2026, 11, 25, 8, 15)
    expect(nextWorkHoursStart(inside, OFFICE)).toBe(inside)
  })

  it('across midnight: from Thursday late evening to Friday 09:00', () => {
    expect(nextWorkHoursStart(utc(2026, 11, 26, 21, 59), OFFICE)).toBe(utc(2026, 11, 27, 7, 0))
  })

  it('across the weekend: from Friday 18:30 to Monday 09:00', () => {
    expect(nextWorkHoursStart(utc(2026, 11, 27, 16, 30), OFFICE)).toBe(utc(2026, 11, 30, 7, 0))
  })

  it('the next window of the same day comes first', () => {
    const split: WorkHours = { ...OFFICE, windows: [{ from: at(13), to: at(18) }, { from: at(9), to: at(12) }] }
    expect(nextWorkHoursStart(utc(2026, 11, 25, 10, 30), split)).toBe(utc(2026, 11, 25, 11, 0))
  })

  it('the clocks go forward: 09:00 of that Sunday is 06:00 UTC, not 07:00', () => {
    expect(nextWorkHoursStart(utc(2026, 3, 28, 18, 0), EVERY_DAY)).toBe(utc(2026, 3, 29, 6, 0))
  })

  it('a start in the hour the clocks skip moves to the jump: 04:00 local', () => {
    const early: WorkHours = { ...EVERY_DAY, windows: [{ from: at(3, 30), to: at(5) }] }
    expect(nextWorkHoursStart(utc(2026, 3, 28, 18, 0), early)).toBe(utc(2026, 3, 29, 1, 0))
  })

  it('the clocks go back: 09:00 of that Sunday is 07:00 UTC, and a start in the hour that comes twice is its first time', () => {
    expect(nextWorkHoursStart(utc(2026, 10, 24, 17, 0), EVERY_DAY)).toBe(utc(2026, 10, 25, 7, 0))
    const early: WorkHours = { ...EVERY_DAY, windows: [{ from: at(3, 30), to: at(5) }] }
    // 03:30 comes at 00:30 UTC (summer time) and again at 01:30 UTC (winter time).
    expect(nextWorkHoursStart(utc(2026, 10, 24, 17, 0), early)).toBe(utc(2026, 10, 25, 0, 30))
  })
})

describe('workHoursSchema', () => {
  it('takes days, windows of whole minutes and a known time zone', () => {
    expect(workHoursSchema.safeParse(OFFICE).success).toBe(true)
    expect(workHoursSchema.safeParse({ days: ['sat'], windows: [{ from: at(22), to: at(2) }] }).success).toBe(true)
  })

  it('refuses a window that starts and ends at the same minute, a minute off the day, no day, no window, a day twice and an unknown zone', () => {
    for (const bad of [
      { ...OFFICE, windows: [{ from: at(9), to: at(9) }] },
      { ...OFFICE, windows: [{ from: at(9), to: 1440 }] },
      { ...OFFICE, windows: [{ from: -1, to: at(9) }] },
      { ...OFFICE, windows: [{ from: 9.5, to: at(10) }] },
      { ...OFFICE, days: [] },
      { ...OFFICE, days: ['mon', 'mon'] },
      { ...OFFICE, days: ['monday'] },
      { ...OFFICE, windows: [] },
      { ...OFFICE, timeZone: 'Mars/Olympus' },
    ]) {
      expect(workHoursSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})
