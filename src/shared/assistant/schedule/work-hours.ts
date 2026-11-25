// Work hours of the Assistant's checks (worfy-assistant ticket 04): the days of the week, one or several
// windows of local time and a time zone. Outside them, a check the person marked to sleep does not go
// (src/main/assistant/schedule/scheduler.ts). It is the Start window of Autopilot (src/shared/autopilot/run-mode.ts)
// made general: days and several windows, minutes instead of whole hours, and a zone of its own instead of
// the zone of the process.
//
// A window is two minutes of the day, `from` and `to`, never the same; one whose `to` is before its `from`
// goes across midnight and belongs to the day it starts on (Friday 22:00–02:00 holds Saturday 01:30). Every
// rule reads the wall clock of the zone: the night the clocks go forward, a start in the hour they skip
// begins at the jump (03:30 → 04:00); the night they go back, a start in the hour that comes twice begins
// the first time it comes. The zone is IANA's (`Europe/Kyiv`); without one, the zone of the machine.
import { z } from 'zod'

/** The days of the week, Monday first, as the settings write them. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const weekdaySchema = z.enum(WEEKDAYS)
export type Weekday = z.output<typeof weekdaySchema>

export const MINUTES_PER_DAY = 24 * 60
const MINUTE_MS = 60_000
const DAY_MS = MINUTES_PER_DAY * MINUTE_MS

/** The most windows a day of work hours holds. */
export const WORK_WINDOWS_MAX = 4

/** A minute of the day: 0 is 00:00, 1439 is 23:59. */
export const minuteOfDaySchema = z
  .number()
  .int()
  .min(0)
  .max(MINUTES_PER_DAY - 1)

/** A window of local time; `to` before `from` goes across midnight. */
export const workWindowSchema = z.object({ from: minuteOfDaySchema, to: minuteOfDaySchema }).refine((window) => window.from !== window.to, 'a window of work hours cannot start and end at the same minute')
export type WorkWindow = z.output<typeof workWindowSchema>

/** Whether `name` is a time zone this machine's Intl knows. */
export function knownTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

export const timeZoneSchema = z.string().min(1).max(100).refine(knownTimeZone, 'not a time zone this machine knows')

export const workHoursSchema = z.object({
  days: z
    .array(weekdaySchema)
    .min(1)
    .max(WEEKDAYS.length)
    .refine((days) => new Set(days).size === days.length, 'a day of work hours is named once'),
  windows: z.array(workWindowSchema).min(1).max(WORK_WINDOWS_MAX),
  /** An IANA zone; absent: the zone of the machine. */
  timeZone: timeZoneSchema.optional(),
})
export type WorkHours = z.output<typeof workHoursSchema>

/** The work hours of a person who chose none: Monday to Friday, 09:00–18:00, the zone of the machine. */
export const DEFAULT_WORK_HOURS: Readonly<WorkHours> = Object.freeze<WorkHours>({
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  windows: [{ from: 9 * 60, to: 18 * 60 }],
})

/** The zone of the machine as Intl reads it now (it follows a change of TZ). */
export function machineTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

const formats = new Map<string, Intl.DateTimeFormat>()

function formatOf(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    formats.set(zone, format)
  }
  return format
}

/**
 * The wall clock of `zone` at `moment`, written as if it were UTC: its year, month, day, hour, minute and
 * second as Date.UTC would take them, and the milliseconds of `moment`.
 */
function wallOf(moment: number, zone: string): number {
  const parts: Record<string, number> = {}
  for (const part of formatOf(zone).formatToParts(moment)) if (part.type !== 'literal') parts[part.type] = Number(part.value)
  const ms = ((moment % 1000) + 1000) % 1000
  return Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0) + ms
}

/** The day of the week of a wall time written as UTC. */
function weekdayOfWall(wall: number): Weekday {
  return WEEKDAYS[(new Date(wall).getUTCDay() + 6) % 7] as Weekday
}

/** The previous day of the week. */
function dayBefore(day: Weekday): Weekday {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + WEEKDAYS.length - 1) % WEEKDAYS.length] as Weekday
}

function zoneOf(hours: Pick<WorkHours, 'timeZone'>): string {
  return hours.timeZone ?? machineTimeZone()
}

/** Whether `moment` is inside work hours: from the start of a window, included, to its end, not included. */
export function inWorkHours(moment: number, hours: WorkHours): boolean {
  const wall = wallOf(moment, zoneOf(hours))
  const minute = Math.floor((((wall % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS)
  const today = weekdayOfWall(wall)
  const yesterday = dayBefore(today)
  return hours.windows.some((window) => {
    if (window.from < window.to) return hours.days.includes(today) && window.from <= minute && minute < window.to
    return (hours.days.includes(today) && minute >= window.from) || (hours.days.includes(yesterday) && minute < window.to)
  })
}

/**
 * The first moment whose wall clock in `zone` reads `wall` (a wall time written as UTC). A wall time that
 * comes twice gives its first moment; one the clocks skip gives the moment of the jump, the first one
 * whose wall clock is past it.
 */
function momentOfWall(wall: number, zone: string): number {
  const offsets = new Set([wallOf(wall - DAY_MS, zone) - (wall - DAY_MS), wallOf(wall, zone) - wall, wallOf(wall + DAY_MS, zone) - (wall + DAY_MS)])
  const exact = [...offsets].map((offset) => wall - offset).filter((moment) => wallOf(moment, zone) === wall)
  if (exact.length > 0) return Math.min(...exact)
  // Skipped: the jump lies between the moments the two offsets give; find it to the minute.
  const candidates = [...offsets].map((offset) => wall - offset)
  let low = Math.min(...candidates)
  let high = Math.max(...candidates)
  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS
    if (wallOf(middle, zone) >= wall) high = middle
    else low = middle
  }
  return high
}

/** The start of the work hours `moment` is in, `moment` itself; else the next start after it. */
export function nextWorkHoursStart(moment: number, hours: WorkHours): number {
  if (inWorkHours(moment, hours)) return moment
  const zone = zoneOf(hours)
  const wall = wallOf(moment, zone)
  const midnight = wall - (((wall % DAY_MS) + DAY_MS) % DAY_MS)
  let best = Number.POSITIVE_INFINITY
  // A week and a day ahead covers every chosen day once, today's later windows included.
  for (let offset = 0; offset <= WEEKDAYS.length; offset++) {
    const day = midnight + offset * DAY_MS
    if (!hours.days.includes(weekdayOfWall(day))) continue
    for (const window of hours.windows) {
      const start = momentOfWall(day + window.from * MINUTE_MS, zone)
      if (start > moment && start < best) best = start
    }
  }
  return best
}
