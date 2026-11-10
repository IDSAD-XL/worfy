// The renderer's copy of each Project's PR inbox (worfy-pr-inbox ticket 03), read by main
// (src/main/github/inbox.ts, ticket 02). The view and the sidebar section read one Project alike, so
// the copy is shared: the first user asks main (`prInbox.get`); `prInbox.changed`, and a change of the
// Project's settings (the `prInbox` switch), make it ask again. Nothing here writes to GitHub: the one
// write is `prInbox.markSeen`, which main keeps in the Project's data folder (ADR-0105).
//
// Also the pure parts of the view: the groups in the spec's order, the texts of a row, which Ticket a
// PR belongs to, and the line about the next search.
import { useEffect } from 'react'
import { create } from 'zustand'
import { PR_INBOX_GROUPS, type PrInboxGroup, type PrInboxRow, type PrInboxSnapshot } from '../../shared/ipc/pr-inbox'
import { repoFactsOf, type Ticket } from '../../shared/workflow/types'
import { invoke, subscribe } from '../ipc'

export interface PrInboxEntry {
  /** Undefined until main has answered `prInbox.get`. */
  snapshot: PrInboxSnapshot | undefined
  /** Why `prInbox.get` failed. */
  error: string | undefined
}

const EMPTY: PrInboxEntry = { snapshot: undefined, error: undefined }

const usePrInboxStore = create<{ byProject: Readonly<Record<string, PrInboxEntry>> }>(() => ({ byProject: {} }))

function setEntry(projectId: string, entry: PrInboxEntry): void {
  usePrInboxStore.setState(({ byProject }) => ({ byProject: { ...byProject, [projectId]: entry } }))
}

const users = new Map<string, number>()
/** The number of the last request sent for each Project: an answer to an earlier one is older and dropped. */
const asked = new Map<string, number>()
let requests = 0
let subscribed = false

function load(projectId: string): void {
  const request = ++requests
  asked.set(projectId, request)
  void invoke('prInbox.get', { projectId }).then((result) => {
    if (!users.has(projectId) || asked.get(projectId) !== request) return
    if (result.ok) setEntry(projectId, { snapshot: result.value, error: undefined })
    else setEntry(projectId, { snapshot: usePrInboxStore.getState().byProject[projectId]?.snapshot, error: result.error })
  })
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('prInbox.changed', ({ projectId }) => {
      if (users.has(projectId)) load(projectId)
    })
    // The switch of Project settings: main reads it on each look, and the view says at once that reading is off.
    subscribe('projects.settings.changed', ({ id }) => {
      if (users.has(id)) load(id)
    })
  } catch (error) {
    console.error('prInbox.changed: cannot subscribe', error)
  }
}

function acquire(projectId: string): void {
  ensureSubscribed()
  const count = users.get(projectId) ?? 0
  users.set(projectId, count + 1)
  if (count === 0) load(projectId)
}

function release(projectId: string): void {
  const count = users.get(projectId) ?? 0
  if (count > 1) {
    users.set(projectId, count - 1)
    return
  }
  users.delete(projectId)
  asked.delete(projectId)
  usePrInboxStore.setState(({ byProject }) => {
    const rest = { ...byProject }
    delete rest[projectId]
    return { byProject: rest }
  })
}

/** The PR inbox of the Project, kept current while the calling component is mounted. */
export function usePrInbox(projectId: string | undefined): PrInboxEntry {
  useEffect(() => {
    if (projectId === undefined) return
    acquire(projectId)
    return () => release(projectId)
  }, [projectId])
  return usePrInboxStore((store) => (projectId === undefined ? EMPTY : (store.byProject[projectId] ?? EMPTY)))
}

/**
 * The user has seen the PR now (`prInbox.markSeen`): its "N new since you looked" starts again from zero.
 * Answers why main refused, or undefined.
 */
export async function markPullSeen(projectId: string, repo: string, number: number): Promise<string | undefined> {
  const request = ++requests
  asked.set(projectId, request)
  const result = await invoke('prInbox.markSeen', { projectId, repo, number })
  if (!result.ok) return result.error
  if (users.has(projectId) && asked.get(projectId) === request) setEntry(projectId, { snapshot: result.value, error: undefined })
  return undefined
}

// ── where the view opens ─────────────────────────────────────────────────────

/** One PR, as the entries that open the view name it. */
export interface PullRef {
  /** `owner/name`. */
  repo: string
  number: number
}

/** What the view was last asked to show: one PR, one group, or the top. `seq` tells two equal asks apart. */
export interface PrInboxFocus {
  projectId: string
  pr: PullRef | null
  group: PrInboxGroup | null
  seq: number
}

export const usePrInboxFocus = create<{ focus: PrInboxFocus | null }>(() => ({ focus: null }))

let focusSeq = 0

/** Asks the view to show the Project's inbox at `pr` (that row expanded) or at `group`. */
export function focusPrInbox(projectId: string, pr: PullRef | null = null, group: PrInboxGroup | null = null): void {
  usePrInboxFocus.setState({ focus: { projectId, pr, group, seq: ++focusSeq } })
}

// ── the pure parts of the view ───────────────────────────────────────────────

export const rowKey = (row: PullRef): string => `${row.repo.toLowerCase()}#${row.number}`

/** The five groups in the spec's order, whatever order the snapshot has; a group it lacks is empty. */
export function orderedGroups(snapshot: PrInboxSnapshot): { group: PrInboxGroup; rows: PrInboxRow[] }[] {
  return PR_INBOX_GROUPS.map((group) => ({ group, rows: snapshot.groups.find((each) => each.group === group)?.rows ?? [] }))
}

/** How many PRs each group holds, in the spec's order; only the groups that hold any. */
export function groupCounts(snapshot: PrInboxSnapshot | undefined): { group: PrInboxGroup; count: number }[] {
  if (snapshot === undefined || !snapshot.enabled) return []
  return orderedGroups(snapshot)
    .map(({ group, rows }) => ({ group, count: rows.length }))
    .filter(({ count }) => count > 0)
}

/** The row of a PR and its group; null when the snapshot does not hold it. The repository is matched without case, as GitHub does. */
export function findRow(snapshot: PrInboxSnapshot, pr: PullRef): { group: PrInboxGroup; row: PrInboxRow } | null {
  const key = rowKey(pr)
  for (const { group, rows } of orderedGroups(snapshot)) {
    const row = rows.find((each) => rowKey(each) === key)
    if (row !== undefined) return { group, row }
  }
  return null
}

const nn = (num: number): string => String(num).padStart(2, '0')

/**
 * The Ticket a PR belongs to: the one whose `PR:` line names it (a line without a repository names a PR of the
 * Project's one repository), else the one whose branch is the PR's, by its `Branch:` line or `<epic>/<NN>`.
 */
export function ticketOfRow(row: Pick<PrInboxRow, 'repo' | 'number' | 'headRefName'>, tickets: readonly Ticket[]): Ticket | undefined {
  const repo = row.repo.toLowerCase()
  const byPr = tickets.find((ticket) => repoFactsOf(ticket).prs.some((pr) => pr.number === row.number && (pr.repo === null || pr.repo.toLowerCase() === repo)))
  if (byPr !== undefined) return byPr
  return tickets.find((ticket) => (ticket.branch ?? `${ticket.epic}/${nn(ticket.num)}`) === row.headRefName)
}

/** "now", "5m", "3h", "2d": how long ago `iso` was. */
export function ageText(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** The age a row shows: of the PR for a review request (the oldest waits longest), else of its last activity. */
export const ageOf = (group: PrInboxGroup, row: Pick<PrInboxRow, 'createdAt' | 'lastActivityAt'>): string => (group === 'needs-review' ? row.createdAt : row.lastActivityAt)

/** "Next search in 4 min" — or "Next search now" once the time has come. */
export function nextSearchText(nextSearchAt: string, now: number): string {
  const minutes = Math.ceil((Date.parse(nextSearchAt) - now) / 60_000)
  return minutes <= 0 ? 'Next search now' : `Next search in ${minutes} min`
}

/** The status line of the view: the next search, why the last read failed, and the snapshot's notice; each null when there is none. */
export function statusLines(snapshot: PrInboxSnapshot, now: number): { next: string | null; error: string | null; notice: string | null } {
  return {
    next: snapshot.nextSearchAt === null ? null : nextSearchText(snapshot.nextSearchAt, now),
    error: snapshot.error === null ? null : `The last read failed: ${snapshot.error}`,
    notice: snapshot.notice,
  }
}

/** "2 new since you looked"; null when nothing is new. */
export const newText = (count: number): string | null => (count > 0 ? `${count} new since you looked` : null)

/** "1 open thread", "3 open threads"; null when none is open. */
export const threadsText = (count: number): string | null => (count === 0 ? null : `${count} open thread${count === 1 ? '' : 's'}`)

/** The review decision as the row says it; null when GitHub gives none. */
export function reviewText(decision: string | null): { label: string; status: 'ready' | 'blocked' | null } | null {
  switch (decision) {
    case 'APPROVED':
      return { label: 'Approved', status: 'ready' }
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', status: 'blocked' }
    case 'REVIEW_REQUIRED':
      return { label: 'Review required', status: null }
    default:
      return null
  }
}
