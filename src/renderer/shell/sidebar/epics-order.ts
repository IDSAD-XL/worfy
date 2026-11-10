// The order of the sidebar's Epics section and its «Older» group (worfy-polish ticket 98, the owner's decisions of
// 2026-11-10). Pure: the section gives the model, the clock and the threshold.
//
// - An Epic's last work is the newest status change among its Tickets (`statusAt`: claim, block, done…). An Epic none
//   of whose Tickets has changed status yet takes the time its spec was written (`specAt`, the mtime of spec.md read
//   in src/main/workflow/reader.ts). Neither — no time is known.
// - Epics with a Ticket in work come first, then the rest by last work, newest first; Epics with no known time last.
//   Equal times keep the name order, so the list does not shuffle between two reads.
// - An Epic with no Ticket in work whose last work is older than the threshold goes into «Older». One whose time is
//   not known stays in the list: nothing says it is old. `never` keeps every Epic in the list.
import type { Epic, Ticket } from '../../../shared/workflow/types'
import type { EpicsOlderAfter } from '../../../shared/settings/app-settings'
import { PROJECT_ID_HASH_SUFFIX } from '../../../shared/projects/project-id'

const DAY = 24 * 60 * 60_000

/** The threshold of each setting in ms; null — the group is off. */
export const EPICS_OLDER_AFTER_MS: Readonly<Record<EpicsOlderAfter, number | null>> = Object.freeze({ never: null, '3d': 3 * DAY, '7d': 7 * DAY, '30d': 30 * DAY })

/**
 * The time of a `Status:` line or of a spec in ms: `2026-10-17T09:41Z`, an ISO time, or a date alone (a migrated
 * Ticket), read as its midnight UTC; null when absent or unreadable.
 */
export function timeOf(text: string | null | undefined): number | null {
  if (text == null || text === '') return null
  const value = Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(text) ? `${text}T00:00Z` : text)
  return Number.isNaN(value) ? null : value
}

export interface EpicRow {
  epic: Epic
  tickets: Ticket[]
  /** The Epic's last work in ms; null when no time is known. */
  lastWork: number | null
  /** Whether a Ticket of the Epic is in work (claimed, in progress). */
  working: boolean
}

/** The last work of an Epic: the newest `statusAt` of its Tickets, else the time of its spec. */
export function lastWorkOf(epic: Pick<Epic, 'specAt'>, tickets: readonly Pick<Ticket, 'statusAt'>[]): number | null {
  let newest: number | null = null
  for (const ticket of tickets) {
    const at = timeOf(ticket.statusAt)
    if (at !== null && (newest === null || at > newest)) newest = at
  }
  return newest ?? timeOf(epic.specAt)
}

const byLastWork = (a: EpicRow, b: EpicRow): number => {
  if (a.working !== b.working) return a.working ? -1 : 1
  if (a.lastWork !== b.lastWork) {
    if (a.lastWork === null) return 1
    if (b.lastWork === null) return -1
    return b.lastWork - a.lastWork
  }
  return a.epic.epic < b.epic.epic ? -1 : a.epic.epic > b.epic.epic ? 1 : 0
}

/** The Epics of the section in order: `recent` in the list, `older` in the folded group under it. */
export function arrangeEpics(
  epics: readonly Epic[],
  tickets: readonly Ticket[],
  now: number,
  after: EpicsOlderAfter,
): { recent: EpicRow[]; older: EpicRow[] } {
  const byEpic = new Map<string, Ticket[]>()
  for (const ticket of tickets) {
    const list = byEpic.get(ticket.epic)
    if (list === undefined) byEpic.set(ticket.epic, [ticket])
    else list.push(ticket)
  }
  const rows = epics.map((epic): EpicRow => {
    const own = byEpic.get(epic.epic) ?? []
    return { epic, tickets: own, lastWork: lastWorkOf(epic, own), working: own.some((ticket) => ticket.state === 'work') }
  })
  rows.sort(byLastWork)
  const threshold = EPICS_OLDER_AFTER_MS[after]
  const isOlder = (row: EpicRow): boolean => threshold !== null && !row.working && row.lastWork !== null && now - row.lastWork > threshold
  return { recent: rows.filter((row) => !isOlder(row)), older: rows.filter(isOlder) }
}

/**
 * The key of the «Older» group's fold in `sidebar.collapsed` of the app settings, one per Project: the path hash
 * that ends its id (`<folder>-<8 hex>`), which keeps the key a section id whatever the folder is called. An id of
 * another form keeps its letters, digits, `_` and `-`.
 */
export function olderFoldKey(projectId: string): string {
  const hash = PROJECT_ID_HASH_SUFFIX.exec(projectId)?.[1]
  return `EpicsOlder-${hash ?? projectId.replace(/[^\w-]/gu, '_').slice(-80)}`
}
