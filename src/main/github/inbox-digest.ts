// The morning digest of the PR inbox (worfy-pr-inbox ticket 07): at the first focus of a worfy window in a calendar
// day, one action toast sums up the inboxes of this Machine's Projects — "3 reviews wait for you (oldest 2 days) · 2
// PRs have new comments · 1 ready to merge" — with a button Open. The window asks main with `prInbox.digest`
// (src/main/ipc/pr-inbox.ts) when it gets the focus; main answers from the reader's snapshots (inbox.ts), so the
// digest runs no gh and no model.
//
// - The day is the local calendar day of main's clock. It is taken by the first answer of the day that is not
//   `pending`: an empty inbox shows nothing and takes the day too, so a review request that comes later that day
//   waits for the next morning (the notifications of notify.ts tell of it at once).
// - `pending`: a Project whose reader is on has not been read yet since worfy started; the window asks again when an
//   inbox changes. A Project whose read failed does not hold the digest back. A Project whose next search is due
//   (its `nextSearchAt` has passed: the computer slept, or the read runs now) is `pending` too, so the digest counts the
//   fresh read and not yesterday's snapshot. When that read fails (no network yet after a wake), the reader keeps the
//   old rows and `readAt` and moves the next search ahead: a Project whose last read failed and whose last good read is
//   older than one search interval is `pending` as well. It holds the digest at most INBOX_MAX_INTERVAL_MS after the
//   first ask of the day; then the digest is decided without that Project's old rows.
// - `prInboxDigest` off in the app settings: nothing, and the day is not taken.
// - shortcut: the day lives in main's memory, so a restart of worfy shows the digest again that day; keep it in a
//   file of WORFY_DATA_DIR (an entry of ADR-0005's inventory) if people restart often enough to mind.
import type { PrInboxDigestAnswer, PrInboxSnapshot } from '../../shared/ipc/pr-inbox'
import { INBOX_MAX_INTERVAL_MS, INBOX_SEARCH_INTERVAL_MS } from './inbox'

export interface PrInboxDigestCounts {
  /** PRs in Needs my review. */
  reviews: number
  /** The age of the oldest of them by its `createdAt`, in ms; null without one. */
  oldestReviewMs: number | null
  /** PRs with comments of others newer than the user's last look at them (`newSinceSeen`). */
  commented: number
  /** PRs in Ready. */
  ready: number
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** The counts of the digest over `snapshots` at `now`; a PR two Projects both read counts once. */
export function digestCounts(snapshots: readonly PrInboxSnapshot[], now: number): PrInboxDigestCounts {
  const reviews = new Map<string, number>()
  const commented = new Set<string>()
  const ready = new Set<string>()
  for (const snapshot of snapshots) {
    if (!snapshot.enabled) continue
    for (const { group, rows } of snapshot.groups) {
      for (const row of rows) {
        const key = `${row.repo.toLowerCase()}#${row.number}`
        if (group === 'needs-review') reviews.set(key, Date.parse(row.createdAt))
        if (group === 'ready') ready.add(key)
        if (row.newSinceSeen > 0) commented.add(key)
      }
    }
  }
  const created = [...reviews.values()].filter((at) => !Number.isNaN(at))
  return { reviews: reviews.size, oldestReviewMs: created.length === 0 ? null : Math.max(0, now - Math.min(...created)), commented: commented.size, ready: ready.size }
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** An age in whole days, else whole hours; null under an hour. */
function ageOf(ms: number | null): string | null {
  if (ms === null || ms < HOUR_MS) return null
  return ms >= DAY_MS ? plural(Math.floor(ms / DAY_MS), 'day') : plural(Math.floor(ms / HOUR_MS), 'hour')
}

/** The digest's line; null when there is nothing to tell. */
export function digestText(counts: PrInboxDigestCounts): string | null {
  const parts: string[] = []
  if (counts.reviews > 0) {
    const age = ageOf(counts.oldestReviewMs)
    const waits = counts.reviews === 1 ? '1 review waits for you' : `${counts.reviews} reviews wait for you`
    parts.push(age === null ? waits : `${waits} (${counts.reviews === 1 ? age : `oldest ${age}`})`)
  }
  if (counts.commented > 0) parts.push(counts.commented === 1 ? '1 PR has new comments' : `${counts.commented} PRs have new comments`)
  if (counts.ready > 0) parts.push(`${counts.ready} ready to merge`)
  return parts.length === 0 ? null : parts.join(' · ')
}

/** The local calendar day of `at`, as YYYY-MM-DD. */
function localDay(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The Project's next search is due and has not ended yet: what the snapshot holds may be from before a sleep. */
function due(snapshot: PrInboxSnapshot, now: number): boolean {
  return snapshot.nextSearchAt !== null && Date.parse(snapshot.nextSearchAt) <= now
}

/** The Project's last read failed and its last good read is older than a search interval: its rows may be from before a sleep. */
function stale(snapshot: PrInboxSnapshot, now: number): boolean {
  return snapshot.error !== null && snapshot.readAt !== null && Date.parse(snapshot.readAt) <= now - INBOX_SEARCH_INTERVAL_MS
}

export interface PrInboxDigestOptions {
  /** The snapshot of each Project of this Machine, in the order of the list. */
  snapshots: () => readonly PrInboxSnapshot[]
  /** `prInboxDigest` of the app settings; on by default. */
  enabled: () => boolean
  now?: () => number
}

/** The digest of this Machine: shown at most once a day (see the head of the file). */
export class PrInboxDigest {
  /** The day the digest was last decided on; null since worfy started. */
  private day: string | null = null
  /** The time of the first ask of `day` that was not decided yet: a stale Project holds the digest for a while after it. */
  private firstAsk: { day: string; at: number } | null = null

  constructor(private readonly options: PrInboxDigestOptions) {}

  /** A window got the focus: the digest, if this is the first time today and the inboxes have been read. */
  ask(): PrInboxDigestAnswer {
    if (!this.options.enabled()) return { state: 'none' }
    const now = this.options.now?.() ?? Date.now()
    const day = localDay(now)
    if (this.day === day) return { state: 'none' }
    if (this.firstAsk?.day !== day) this.firstAsk = { day, at: now }
    const enabled = this.options.snapshots().filter((snapshot) => snapshot.enabled)
    if (enabled.some((snapshot) => (snapshot.readAt === null && snapshot.error === null) || due(snapshot, now))) return { state: 'pending' }
    const waited = now - this.firstAsk.at
    if (enabled.some((snapshot) => stale(snapshot, now)) && waited < INBOX_MAX_INTERVAL_MS) return { state: 'pending' }
    const snapshots = enabled.filter((snapshot) => !stale(snapshot, now))
    this.day = day
    const text = digestText(digestCounts(snapshots, now))
    if (text === null) return { state: 'none' }
    const projectIds = snapshots.filter((snapshot) => digestText(digestCounts([snapshot], now)) !== null).map((snapshot) => snapshot.projectId)
    return { state: 'show', text, projectIds }
  }
}
