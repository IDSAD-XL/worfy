// What the Assistant's section shows of a time and of an item's kind (worfy-assistant ticket 14): plain functions, apart
// from the components, so Fast Refresh keeps working on those.
import type { IconName } from './icons'

const DAY_MS = 24 * 60 * 60_000
/** The local days from `at` to `now`, by the calendar: a change of summer time between them is rounded away. */
const daysBetween = (at: Date, now: Date): number => Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / DAY_MS)

/**
 * A time of today as its hours and minutes; one of the six days before as its day of the week; an older one as its date
 * (`Nov 20`), so the age of what stays in Waits is plain (worfy-polish 172).
 */
export function shortTime(at: number, now: number = Date.now()): string {
  const day = new Date(at)
  const today = new Date(now)
  if (day.toDateString() === today.toDateString()) return day.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (daysBetween(day, today) > 6) return day.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return day.toLocaleDateString([], { weekday: 'short' })
}

/** The glyph of an item, by its source and kind. */
export function itemIcon(source: string, kind: string, subject: string): IconName {
  if (source === 'slack') return 'slack'
  if (source === 'jira') return 'jira'
  if (source === 'ci') return 'ci'
  if (source === 'health') return 'heart'
  if (source === 'limits') return 'gauge'
  if (subject === 'run' || kind === 'run-stopped') return 'run'
  if (subject === 'pr') return 'pr'
  if (kind === 'question' || kind === 'permission') return 'ask'
  if (subject === 'session') return 'term'
  return 'list'
}
