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

/** Asks the view to show the Project's inbox at `pr` (that PR selected) or at `group`. */
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
 * Whether a repository as a Ticket's header names it — a `Repo:` name of the layout (`lib`, harness/bin/TICKETS.md) or
 * an `owner/name` — is the PR's `owner/name`. A layout name is compared with the name part: the renderer does not know
 * which folder's `origin` it is.
 */
// shortcut: a layout name is matched by the GitHub name of the repository; a layout name that differs from it is not found. Map the names through main's remotes (remoteRepos) when such a Project asks for its chips.
export function sameRepo(named: string, repo: string): boolean {
  const name = named.toLowerCase()
  const full = repo.toLowerCase()
  return name.includes('/') ? name === full : name === full.slice(full.indexOf('/') + 1)
}

/**
 * The Ticket a PR belongs to: the one whose `PR:` line names it, else the one whose branch is the PR's, by its
 * `Branch:` line or `<epic>/<NN>`. A `PR:` line with a repository (`PR: lib#41`) names that repository's PR; a bare
 * `PR: #N` names PR N of the Ticket's `Repo:` repositories, or of any repository when it has none (a Project of one
 * repository).
 */
export function ticketOfRow(row: Pick<PrInboxRow, 'repo' | 'number' | 'headRefName'>, tickets: readonly Ticket[]): Ticket | undefined {
  const byPr = tickets.find((ticket) => {
    const facts = repoFactsOf(ticket)
    return facts.prs.some((pr) => {
      if (pr.number !== row.number) return false
      const scope = pr.repo !== null ? [pr.repo] : facts.repos
      return scope.length === 0 || scope.some((named) => sameRepo(named, row.repo))
    })
  })
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

// ── the two panes ────────────────────────────────────────────────────────────

/** The groups that hold a PR, in the spec's order: the list of the view shows only these. */
export const listedGroups = (snapshot: PrInboxSnapshot): { group: PrInboxGroup; rows: PrInboxRow[] }[] => orderedGroups(snapshot).filter(({ rows }) => rows.length > 0)

/** Every row in the order the list shows them, with its group: the order ↑ and ↓ move along. */
export const listOrder = (snapshot: PrInboxSnapshot): { group: PrInboxGroup; row: PrInboxRow }[] => listedGroups(snapshot).flatMap(({ group, rows }) => rows.map((row) => ({ group, row })))

/**
 * The PR the view selects by itself while the user has chosen none: the first that waits for the user's answer, where
 * the drafts of replies are, else the first of the list; null for an empty inbox.
 */
export function defaultSelection(snapshot: PrInboxSnapshot): string | null {
  const order = listOrder(snapshot)
  const first = order.find(({ group }) => group === 'needs-answer') ?? order[0]
  return first === undefined ? null : rowKey(first.row)
}

/** The PR the pane shows: the user's choice (`rowKey`) while the snapshot holds it, else the view's own. */
export function shownKey(snapshot: PrInboxSnapshot, selected: string | null): string | null {
  if (selected !== null && listOrder(snapshot).some(({ row }) => rowKey(row) === selected)) return selected
  return defaultSelection(snapshot)
}

/** How long a PR has waited for whoever moves next: 0 under 12 hours, 1 under 3 days, 2 under 14 days, 3 after. */
export function ageHeat(iso: string, now: number): 0 | 1 | 2 | 3 {
  const hours = (now - Date.parse(iso)) / 3_600_000
  if (!Number.isFinite(hours) || hours < 12) return 0
  if (hours < 72) return 1
  return hours < 14 * 24 ? 2 : 3
}

/** The tone of a fact of the pane: the colours of a status chip, or `open` for a bordered grey one, `problem` for a red one. */
export type FactTone = 'ready' | 'blocked' | 'open' | 'problem'

/** GitHub's mergeStateStatus as the pane says it; null when GitHub gives none or does not know yet. */
export function mergeText(status: string | null): { label: string; tone: FactTone } | null {
  switch (status) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { label: 'Mergeable', tone: 'ready' }
    case 'BEHIND':
      return { label: 'Behind the base', tone: 'blocked' }
    case 'BLOCKED':
      return { label: 'Blocked', tone: 'open' }
    case 'UNSTABLE':
      return { label: 'Checks failing', tone: 'blocked' }
    case 'DIRTY':
      return { label: 'Conflicts', tone: 'problem' }
    case 'DRAFT':
      return { label: 'Draft', tone: 'open' }
    default:
      return null
  }
}

/** The size of a PR: the lines it adds and removes and the share of the added ones in percent, at least 8 of each side that has any; null when GitHub gave none. */
export function sizeOf(row: Pick<PrInboxRow, 'additions' | 'deletions'>): { additions: number; deletions: number; addedShare: number } | null {
  if (row.additions === null || row.deletions === null) return null
  const total = row.additions + row.deletions
  if (total === 0) return { additions: 0, deletions: 0, addedShare: 50 }
  const share = Math.round((row.additions / total) * 100)
  return { additions: row.additions, deletions: row.deletions, addedShare: row.deletions === 0 ? 100 : row.additions === 0 ? 0 : Math.min(92, Math.max(8, share)) }
}

/** The tone of the "what to do next" strip: one per group. */
export type NextTone = 'review' | 'answer' | 'fix' | 'ready' | 'waiting'

/**
 * The main button of the "what to do next" strip: a page of the PR on GitHub to open, Send all of its draft replies (the
 * dialog with every text first), or Draft replies; null when the strip has none.
 */
export type NextAction = { kind: 'link'; label: string; url: string } | { kind: 'send-all'; count: number } | { kind: 'draft-replies' }

/** The "what to do next" strip of the pane: a title, a line, and its main button, when one helps. */
export interface NextStep {
  tone: NextTone
  title: string
  text: string
  action: NextAction | null
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/**
 * What the user does next with a PR, from its group, CI, review and drafts: `drafts` counts the replies that wait to be
 * sent, `canDraft` says whether Draft replies is there (not in a window of a Linked machine).
 */
export function nextStep(group: PrInboxGroup, row: PrInboxRow, now: number, drafts: number, canDraft: boolean): NextStep {
  const open = row.unresolvedThreads
  switch (group) {
    case 'needs-review':
      return {
        tone: 'review',
        title: 'Your review is asked',
        text: `${row.author ?? 'ghost'} opened it ${ageText(row.createdAt, now)} ago${row.viaTeam ? ', asked through your team' : ''}.${open > 0 ? ` ${plural(open, 'open thread', 'open threads')} from others.` : ''}`,
        action: { kind: 'link', label: 'Start review', url: `${row.url}/files` },
      }
    case 'needs-answer':
      return {
        tone: 'answer',
        title: open > 0 ? `Answer ${plural(open, 'open thread', 'open threads')}` : 'Your answer is awaited',
        // One draft: its Send stays under its thread, beside the text it posts; the strip points there.
        text:
          drafts > 1
            ? `${drafts} draft replies are ready below: read, edit, then send each or all.`
            : drafts === 1
              ? '1 draft reply is ready below: read, edit, then Send under its thread.'
              : canDraft
                ? 'No drafts yet: Draft replies starts a Session that writes them.'
                : 'Drafts of replies stay on the machine of the Project.',
        action: drafts > 1 ? { kind: 'send-all', count: drafts } : drafts === 0 && canDraft ? { kind: 'draft-replies' } : null,
      }
    case 'needs-fix': {
      const failing = row.ci === 'failing'
      const changes = row.reviewDecision === 'CHANGES_REQUESTED'
      const conflict = row.mergeStateStatus === 'DIRTY'
      return {
        tone: 'fix',
        title: failing && changes ? 'CI failing and changes requested' : failing ? 'CI failing' : changes ? 'Changes requested' : conflict ? 'Merge conflict' : 'Needs a fix',
        text: failing ? 'Open the failing checks on GitHub.' : changes ? 'Read the requested changes in the threads below.' : conflict ? 'Resolve the conflict with the base branch.' : 'Look at the PR on GitHub.',
        action: { kind: 'link', label: 'Open checks', url: `${row.url}/checks` },
      }
    }
    case 'ready':
      return { tone: 'ready', title: 'Ready to merge', text: 'Approved, CI passing, no conflict.', action: { kind: 'link', label: 'Open to merge', url: row.url } }
    case 'waiting':
      return { tone: 'waiting', title: row.isDraft ? 'Draft PR: no review asked yet' : 'Waiting for reviewers', text: `Last activity ${ageText(row.lastActivityAt, now)} ago.`, action: null }
  }
}

/** Two letters of a login for its avatar: the first letters of its first two parts (`dev-ana` → DA), else its first two. */
export function initialsOf(login: string | null): string {
  const name = login ?? 'ghost'
  const [first = '', second = ''] = name.split(/[-_.]/u).filter(Boolean)
  const letters = second !== '' ? `${first.slice(0, 1)}${second.slice(0, 1)}` : name.slice(0, 2)
  return letters.toUpperCase()
}

/** Which of the avatar colours a login gets: the same login always the same one. */
export function avatarTone(login: string | null, tones: number): number {
  let hash = 0
  for (const char of login ?? 'ghost') hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % tones
}
