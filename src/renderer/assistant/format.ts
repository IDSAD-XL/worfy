// What the Assistant's section shows of a time and of an item's kind (worfy-assistant ticket 14): plain functions, apart
// from the components, so Fast Refresh keeps working on those.
import type { IconName } from './icons'

/** A time of today as its hours and minutes; an older one as its day of the week. */
export function shortTime(at: number, now: number = Date.now()): string {
  const day = new Date(at)
  const today = new Date(now)
  if (day.toDateString() === today.toDateString()) return day.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
