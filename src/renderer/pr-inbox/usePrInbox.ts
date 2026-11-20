// The renderer's copy of each Project's PR inbox (worfy-pr-inbox ticket 03), read by main
// (src/main/github/inbox.ts, ticket 02). The view and the sidebar section read one Project alike, so
// the copy is shared: the first user asks main (`prInbox.get`); `prInbox.changed`, and a change of the
// Project's settings (the `prInbox` switch), make it ask again. Nothing here writes to GitHub: the one
// write is `prInbox.markSeen`, which main keeps in the Project's data folder (ADR-0105).
//
// Also the pure parts of the view: the groups in the spec's order, the texts of a row, which Ticket a
// PR belongs to, and the line about the next search.
import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { PR_INBOX_GROUPS, type PrApprovals, type PrInboxGroup, type PrInboxRow, type PrInboxSnapshot, type PrReviewer } from '../../shared/ipc/pr-inbox'
import type { PrSearchNotice, PrSearchResult, SavedSearch } from '../../shared/ipc/pr-search'
import type { PrSearchScope } from '../../shared/pr-search/query'
import { prFollowReasons } from '../../shared/actions/pr-follow'
import type { PrFollowAction } from '../../shared/projects/action-templates'
import { sameLogin, sameRepo, ticketOfRow } from '../../shared/pr-inbox/rows'
import { invoke, readableReason, subscribe } from '../ipc'

// Moved to src/shared, where main reads them too (worfy-pr-follow ticket 01); the view and its tests still take them from here.
export { sameRepo, ticketOfRow }

export interface PrInboxEntry {
  /** Undefined until main has answered `prInbox.get`. */
  snapshot: PrInboxSnapshot | undefined
  /** Why `prInbox.get` failed. */
  error: string | undefined
}

const EMPTY: PrInboxEntry = { snapshot: undefined, error: undefined }

const usePrInboxStore = create<{
  byProject: Readonly<Record<string, PrInboxEntry>>
  /** The Projects whose read on opening the view is under way (worfy-polish 125), by the number of its request. */
  reading: Readonly<Record<string, number>>
}>(() => ({ byProject: {}, reading: {} }))

function setEntry(projectId: string, entry: PrInboxEntry): void {
  usePrInboxStore.setState(({ byProject }) => ({ byProject: { ...byProject, [projectId]: entry } }))
}

const users = new Map<string, number>()
/**
 * The number of the request whose answer the Project's entry holds: an answer to an earlier one is older and dropped.
 * An earlier answer that comes first is kept until a later one comes: the read on opening the view (worfy-polish 125)
 * answers after GitHub did, and the snapshot asked just before it shows meanwhile.
 */
const applied = new Map<string, number>()
let requests = 0
let subscribed = false

/** Whether the answer to `request` is the newest of the Project so far; it is then the one the entry holds. */
function newest(projectId: string, request: number): boolean {
  if (!users.has(projectId) || (applied.get(projectId) ?? 0) > request) return false
  applied.set(projectId, request)
  return true
}

/** Asks main for the Project's inbox; `opened` — the view was just shown, and main reads GitHub first (worfy-polish 125). */
function load(projectId: string, opened = false): void {
  const request = ++requests
  if (opened) usePrInboxStore.setState(({ reading }) => ({ reading: { ...reading, [projectId]: request } }))
  void invoke('prInbox.get', opened ? { projectId, opened } : { projectId }).then((result) => {
    // The reading line ends with its own answer, even when a later request's answer is the one kept.
    if (opened && usePrInboxStore.getState().reading[projectId] === request) {
      usePrInboxStore.setState(({ reading }) => {
        const rest = { ...reading }
        delete rest[projectId]
        return { reading: rest }
      })
    }
    if (!newest(projectId, request)) return
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
  applied.delete(projectId)
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
 * The Pull requests view of the Project was just shown (worfy-polish 125): main reads GitHub now, out of turn of its
 * timer, within its limits — at most once per 30 seconds, never during a rate-limit pause (src/main/github/inbox.ts,
 * readOnOpen) — and answers the new snapshot. For a Project the window holds (usePrInbox); nothing otherwise.
 */
export function readPrInboxOnOpen(projectId: string): void {
  if (users.has(projectId)) load(projectId, true)
}

/** Whether the read on opening the view is under way for the Project: the view says it is reading. */
export function usePrInboxReading(projectId: string): boolean {
  return usePrInboxStore((store) => store.reading[projectId] !== undefined)
}

/**
 * The user has seen the PR now (`prInbox.markSeen`): its "N new since you looked" starts again from zero.
 * Answers why main refused, or undefined.
 */
export async function markPullSeen(projectId: string, repo: string, number: number): Promise<string | undefined> {
  const request = ++requests
  const result = await invoke('prInbox.markSeen', { projectId, repo, number })
  if (!result.ok) return result.error
  if (newest(projectId, request)) setEntry(projectId, { snapshot: result.value, error: undefined })
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

/** "now", "5m", "3h", "2d": how long ago `iso` was. */
export function ageText(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * The age a row shows: of the PR for a review request (the oldest waits longest), else of its last activity — a row of
 * the search results the inbox lacks (`null`) too.
 */
export const ageOf = (group: PrInboxGroup | null, row: Pick<PrInboxRow, 'createdAt' | 'lastActivityAt'>): string => (group === 'needs-review' ? row.createdAt : row.lastActivityAt)

/** "Next search in 4 min" — or "Next search now" once the time has come. */
export function nextSearchText(nextSearchAt: string, now: number): string {
  const minutes = Math.ceil((Date.parse(nextSearchAt) - now) / 60_000)
  return minutes <= 0 ? 'Next search now' : `Next search in ${minutes} min`
}

/** "Last read 3m ago", "Last read just now": the time of the last read while the next one runs (worfy-polish 125). */
export function lastReadText(readAt: string, now: number): string {
  const age = ageText(readAt, now)
  return age === 'now' ? 'Last read just now' : `Last read ${age} ago`
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

// ── the approvals chip (worfy-pr-review ticket 03) ───────────────────────────

/**
 * The colour of the chip: `ready` — GitHub says approved; `blocked` — changes requested; `unknown` — the rule is not
 * visible to the account; `waiting` — the count is reached and code owners hold it; `neutral` — short of the count.
 */
export type ApprovalsTone = 'ready' | 'blocked' | 'unknown' | 'waiting' | 'neutral'

export interface ApprovalsChipText {
  tone: ApprovalsTone
  /** `1/2`, `✓ 2/2`, `✓ 2`, `✕ 1/2`, `1/?`; `review required` when the rule asks for no approvals and GitHub still wants a review. */
  text: string
  /** The accessible name: the chip in words. */
  label: string
  /** Where the number comes from, who approved, what holds it. */
  tooltip: string
  /** Code owners hold a reached count: the chip draws a clock. */
  owners: boolean
  /** The text is a count: «approvals» may follow it. */
  count: boolean
}

const countOf = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** «@a», «@a and @b», «@a, @b and @c». */
function namesText(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/** A reviewer as the tooltip names them: `@login`, `@org/team`; a team the account cannot see under worfy's name for it. */
const handleOf = (name: string): string => (/\s/u.test(name) ? name : `@${name}`)

/**
 * The chip of a PR's approvals (the spec's implementation decision 3; the prototype of ticket 01, state `chips`); null
 * when nothing asks for reviews or main has not read approvals. GitHub's decision wins over the count: green only by
 * APPROVED, red on CHANGES_REQUESTED, and a count reached that GitHub still holds is never called approved.
 */
export function approvalsChip(approvals: PrApprovals | undefined): ApprovalsChipText | null {
  if (approvals === undefined || approvals.source === 'none' || approvals.decision === null) return null
  const { have, need, decision } = approvals
  const reviewers = approvals.reviewers ?? []
  const counted = need === null || need === 0
  const of = counted ? countOf(have, 'approval') : `${have} of ${need} required approval${need === 1 ? '' : 's'}`
  const ratio = need === null ? `${have}/?` : need === 0 ? `${have}` : `${have}/${need}`
  const approvers = reviewers.filter((each) => each.state === 'approved' && each.counts).map((each) => handleOf(each.login))
  const by = approvers.length === 0 ? [] : [`approved by ${namesText(approvers)}`]
  // Approved by GitHub over a rule the account cannot see: `✓ 2`, no «?» (Q6 (a)).
  if (decision === 'approved') return { tone: 'ready', text: `✓ ${counted ? have : ratio}`, label: `${of}, approved`, tooltip: [of, ...by, 'GitHub says: approved'].join(' · '), owners: false, count: true }
  if (decision === 'changes-requested') {
    const asked = reviewers.filter((each) => each.state === 'changes-requested').map((each) => handleOf(each.login))
    const changes = asked.length === 0 ? 'changes requested' : `changes requested by ${namesText(asked)}`
    return { tone: 'blocked', text: `✕ ${ratio}`, label: `${of}, changes requested`, tooltip: [of, changes, ...by].join(' · '), owners: false, count: true }
  }
  if (need === null) {
    const hidden = "GitHub does not show this branch's review rule to your account. GitHub says: review required"
    return { tone: 'unknown', text: ratio, label: `${of}, rule not visible`, tooltip: [of, ...by, hidden].join(' · '), owners: false, count: true }
  }
  if (need === 0) return { tone: 'neutral', text: 'review required', label: `${of}, GitHub says review required`, tooltip: [of, ...by, 'GitHub says: review required'].join(' · '), owners: false, count: false }
  const reached = have >= need
  // Code owners a rule wants; else, on a count GitHub holds though it is reached, code owners asked that may be what it
  // waits for — a rule the account cannot see, or a team the token cannot see.
  const askedOwners = reached ? reviewers.filter((each) => each.codeOwner && each.state === 'requested').map((each) => each.login) : []
  const pendingOwners = approvals.codeOwnersPending.length > 0 ? approvals.codeOwnersPending : askedOwners
  const owners = pendingOwners.length === 0 ? [] : [`waiting for code owners: ${namesText(pendingOwners.map(handleOf))}`]
  const stale = approvals.stale === 0 ? [] : [`${countOf(approvals.stale, 'stale approval')}, before the last push`]
  const lastPush = approvals.lastPushNeedsOther ? ['the last push needs another approver'] : []
  // A count reached that nothing above explains: GitHub holds it by a rule worfy does not count, or one it cannot see.
  // The rules worfy does not count are named only here: nearly every repository has one, so on a short count they are noise.
  const unexplained = reached && owners.length === 0 && lastPush.length === 0 ? [approvals.moreRules ? 'more rules apply — GitHub decides' : 'GitHub says: review required'] : []
  const waiting = reached && approvals.codeOwnersPending.length > 0
  return {
    tone: waiting ? 'waiting' : 'neutral',
    text: ratio,
    label: waiting ? `${of}, waiting for code owners` : of,
    tooltip: [of, ...by, ...owners, ...stale, ...lastPush, ...unexplained].join(' · '),
    owners: waiting,
    count: true,
  }
}

/** The PR still waits for approvals: a chip is shown and GitHub has not approved (the Pipeline board and the Ticket card, Q5 (a)). */
export const approvalsShort = (approvals: PrApprovals | undefined): boolean => approvalsChip(approvals) !== null && approvals?.decision !== 'approved'

/** What the Approvals cell says of a reviewer: their state, and why it does not count where it does not. */
export function reviewerText(reviewer: PrReviewer): { state: string; tone: 'ready' | 'blocked' | 'neutral' | 'muted'; why: string | null } {
  switch (reviewer.state) {
    case 'approved':
      return reviewer.counts ? { state: 'Approved', tone: 'ready', why: null } : { state: 'Approved · does not count', tone: 'muted', why: 'no write access to the repository' }
    case 'stale':
      return { state: 'Approved · stale', tone: 'muted', why: 'before the last push; the rule drops it' }
    case 'changes-requested':
      return { state: 'Changes requested', tone: 'blocked', why: null }
    case 'commented':
      return { state: 'Commented', tone: 'neutral', why: null }
    case 'dismissed':
      return { state: 'Dismissed', tone: 'muted', why: null }
    case 'requested':
      return { state: 'Requested', tone: 'neutral', why: reviewer.kind === 'hidden' ? 'a team your account cannot see' : null }
  }
}

/** The line of the Approvals cell beside the chip, or the whole cell when nothing asks for reviews. */
export function approvalsNote(approvals: PrApprovals): string {
  const chip = approvalsChip(approvals)
  if (chip === null) return `No review rule · ${countOf(approvals.have, 'approval')}`
  if (approvals.need === null) return 'rule not visible to your account'
  if (approvals.decision === 'approved') return 'GitHub says: approved'
  if (approvals.decision === 'changes-requested') return 'changes requested'
  if (approvals.need === 0) return `${countOf(approvals.have, 'approval')} · GitHub decides`
  if (chip.owners) return 'waiting for code owners'
  return `of ${approvals.need} required`
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
 * A button of the "what to do next" strip: a page of the PR on GitHub to open, Send all of its draft replies (the
 * dialog with every text first), Draft replies, or one of "Resolve conflicts", "Fix checks" and "Address comments"
 * (`pr-follow`, worfy-pr-follow ticket 04: the PR handed to a Session of skill pr-fix, `actions.prFollow`).
 */
export type NextAction =
  | { kind: 'link'; label: string; url: string }
  | { kind: 'send-all'; count: number }
  | { kind: 'draft-replies' }
  | { kind: 'pr-follow'; action: PrFollowAction }

/** The "what to do next" strip of the pane: a title, a line, its main button when one helps, and the buttons beside it. */
export interface NextStep {
  tone: NextTone
  title: string
  text: string
  action: NextAction | null
  /** After the main button, in this order: the PR's other reasons for pr-fix, then a link (Open checks). */
  more: readonly NextAction[]
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** The line of the strip of a PR to fix: what its main button does. */
const FOLLOW_TEXT: Readonly<Record<PrFollowAction, string>> = {
  resolveConflicts: 'Resolve conflicts hands the conflict with the base branch to a Session; it asks before it pushes.',
  fixChecks: 'Fix checks hands the failing checks to a Session; it asks before it pushes.',
  addressComments: 'Address comments hands the requested changes to a Session: it edits the code, drafts the replies and asks before it pushes.',
}

const follow = (action: PrFollowAction): NextAction => ({ kind: 'pr-follow', action })

/** "Merge conflict and CI failing": what is wrong with a PR to fix, in the order of its reasons. */
function fixTitle(row: PrInboxRow): string {
  const parts = [row.mergeStateStatus === 'DIRTY' ? 'merge conflict' : null, row.ci === 'failing' ? 'CI failing' : null, row.reviewDecision === 'CHANGES_REQUESTED' ? 'changes requested' : null].filter(
    (part): part is string => part !== null,
  )
  if (parts.length === 0) return 'Needs a fix'
  const title = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`
  return title.charAt(0).toUpperCase() + title.slice(1)
}

/**
 * What the user does next with a PR, from its group, CI, review and drafts: `drafts` counts the replies that wait to be
 * sent, `canDraft` says whether Draft replies is there (not in a window of a Linked machine), `viewer` is the login the
 * inbox reads as. A PR to fix gets its reasons for skill pr-fix (prFollowReasons, worfy-pr-follow ticket 01) as buttons,
 * the first one the main button, and Open checks after them as a link; the user's own PR that waits for an answer gets
 * them beside Draft replies. Whether each button can run is not decided here: usePrFollowState says it on the button.
 */
export function nextStep(group: PrInboxGroup, row: PrInboxRow, now: number, drafts: number, canDraft: boolean, viewer: string | null): NextStep {
  const open = row.unresolvedThreads
  switch (group) {
    case 'needs-review':
      return {
        tone: 'review',
        title: 'Your review is asked',
        text: `${row.author ?? 'ghost'} opened it ${ageText(row.createdAt, now)} ago${row.viaTeam ? ', asked through your team' : ''}.${open > 0 ? ` ${plural(open, 'open thread', 'open threads')} from others.` : ''}`,
        action: { kind: 'link', label: 'Start review', url: `${row.url}/files` },
        more: [],
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
        // Only the user's own PR: a colleague's is not the user's to push to, and the verdict would refuse it anyway.
        more: viewer !== null && sameLogin(row.author, viewer) ? prFollowReasons(row, viewer).map(follow) : [],
      }
    case 'needs-fix': {
      const checks: NextAction = { kind: 'link', label: 'Open checks', url: `${row.url}/checks` }
      const [first, ...rest] = prFollowReasons(row, viewer)
      const title = fixTitle(row)
      if (first === undefined) return { tone: 'fix', title, text: 'Look at the PR on GitHub.', action: checks, more: [] }
      return { tone: 'fix', title, text: FOLLOW_TEXT[first], action: follow(first), more: [...rest.map(follow), checks] }
    }
    case 'ready':
      return { tone: 'ready', title: 'Ready to merge', text: 'Approved, CI passing, no conflict.', action: { kind: 'link', label: 'Open to merge', url: row.url }, more: [] }
    case 'waiting':
      return { tone: 'waiting', title: row.isDraft ? 'Draft PR: no review asked yet' : 'Waiting for reviewers', text: `Last activity ${ageText(row.lastActivityAt, now)} ago.`, action: null, more: [] }
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

// ── the search (worfy-pr-review ticket 05) ───────────────────────────────────

/**
 * The "what to do next" strip of a search result the inbox lacks: a colleague's PR — «Review this pull request», who
 * the author asked and how many approvals are left, and Start review, which opens the Files page on GitHub until
 * ticket 09 gives it Review mode; the user's own PR — its last activity, nothing to start.
 */
export function searchStep(row: PrInboxRow, now: number, viewer: string | null): NextStep {
  if (viewer !== null && sameLogin(row.author, viewer)) return { tone: 'waiting', title: 'Your pull request', text: `Last activity ${ageText(row.lastActivityAt, now)} ago.`, action: null, more: [] }
  const approvals = row.approvals
  const asked = (approvals?.reviewers ?? [])
    .filter((each) => each.state === 'requested')
    .map((each) => (viewer !== null && each.kind === 'user' && sameLogin(each.login, viewer) ? 'you' : each.login))
  const left =
    approvals === undefined || approvals.source === 'none'
      ? `opened ${ageText(row.createdAt, now)} ago`
      : approvals.need === null
        ? `${countOf(approvals.have, 'approval')}, the rule is not visible`
        : approvals.need === 0
          ? 'no approvals required'
          : `${approvals.have} of ${approvals.need} required approval${approvals.need === 1 ? '' : 's'}`
  return {
    tone: 'review',
    title: 'Review this pull request',
    text: `${row.author ?? 'ghost'} asked ${asked.length === 0 ? 'nobody' : namesText(asked)}; ${left}.`,
    action: { kind: 'link', label: 'Start review', url: `${row.url}/files` },
    more: [],
  }
}

/** "Searched just now", "Searched 3 min ago", "Searched 2 h ago": the age of the results, which no timer refreshes. */
export function searchedText(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'Searched just now'
  if (minutes < 60) return `Searched ${minutes} min ago`
  return `Searched ${Math.floor(minutes / 60)} h ago`
}

/** The search whose results the view shows: the text sent and its scope. */
export interface ShownSearch {
  text: string
  scope: PrSearchScope
}

export interface PrSearchState {
  /** The field, as typed. */
  text: string
  scope: PrSearchScope
  /** The search whose results show in place of the groups; null — the inbox. */
  shown: ShownSearch | null
  /** Its answer, the pages of Load more added; null while the first page is on its way. */
  result: PrSearchResult | null
  /** A page is on its way. */
  running: boolean
  /** Why the call failed (not GitHub: main, or the link to the Project machine); null when it did not. */
  failure: string | null
  /** The Project's saved searches, the built-in ones first. */
  saved: readonly SavedSearch[]
}

export interface PrSearch extends PrSearchState {
  setText: (text: string) => void
  /** Runs `text` in `scope` (the field's by default); a blank text goes back to the inbox. */
  run: (text?: string, scope?: PrSearchScope) => void
  /** Sets the scope; a search shown, or a field that holds text, runs in it at once. */
  setScope: (scope: PrSearchScope) => void
  loadMore: () => void
  refresh: () => void
  /** Empties the field and gives the groups back. */
  clear: () => void
  /** Saves the field under `name` with the scope; answers main's refusal, or null. */
  save: (name: string) => Promise<string | null>
  forget: (id: string) => Promise<string | null>
}

/** The shortest wait for the end of a rate-limit pause: a pause already over does not search in a loop. */
const PAUSE_MIN_MS = 1000

/** Kinds of notice that say main gave no page at all. */
const REFUSALS: ReadonlySet<PrSearchNotice['kind']> = new Set(['rate-limit', 'failed', 'sign-in', 'sso', 'not-visible'])

/** A page main refused: no rows, no next page, and a pause or a refusal that says why (not just the end of the results). */
const refused = (page: PrSearchResult): boolean => page.rows.length === 0 && page.cursor === null && (page.pausedUntil !== null || page.notices.some((each) => REFUSALS.has(each.kind)))

/** The notices of the pages shown and of a new one, each once; a new rate-limit notice replaces an old one. */
function joined(before: readonly PrSearchNotice[], added: readonly PrSearchNotice[]): PrSearchNotice[] {
  const pause = added.some((each) => each.kind === 'rate-limit')
  const kept = before.filter((each) => !(pause && each.kind === 'rate-limit'))
  const seen = new Set(kept.map((each) => `${each.kind}:${each.text}`))
  return [...kept, ...added.filter((each) => !seen.has(`${each.kind}:${each.text}`))]
}

/**
 * The search of the Pull requests view of one Project: the field is the one source of truth; Enter, a chip, a scope or a
 * saved search sends it to main (`prSearch.run`), and the answer is a snapshot that no timer searches again (spec,
 * implementation decisions 9). An answer to an earlier search is dropped.
 */
export function usePrSearch(projectId: string): PrSearch {
  const [state, setState] = useState<PrSearchState>({ text: '', scope: 'project', shown: null, result: null, running: false, failure: null, saved: [] })
  const asked = useRef(0)
  const current = useRef(state)
  useEffect(() => {
    current.current = state
  })

  useEffect(() => {
    let live = true
    void invoke('prSearch.saved', { projectId }).then((answer) => {
      // A main that does not know the channel answers something else: no saved searches then.
      if (live && answer.ok && Array.isArray(answer.value.searches)) setState((before) => ({ ...before, saved: answer.value.searches }))
    })
    return () => {
      live = false
    }
  }, [projectId])

  /** The search that waits for the end of a rate-limit pause, and `send` as of the last render, which it calls. */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const again = useRef<(shown: ShownSearch, cursor: string | null) => void>(() => undefined)
  const wake = useCallback(() => {
    if (pending.current === null) return
    clearTimeout(pending.current)
    pending.current = null
  }, [])
  useEffect(() => wake, [wake])

  const send = useCallback(
    (shown: ShownSearch, cursor: string | null) => {
      wake()
      const request = ++asked.current
      current.current = { ...current.current, scope: shown.scope }
      setState((before) => ({ ...before, scope: shown.scope, shown, running: true, failure: null, result: cursor === null ? null : before.result }))
      void invoke('prSearch.run', { projectId, text: shown.text, scope: shown.scope, cursor }).then((answer) => {
        if (asked.current !== request) return
        if (!answer.ok) {
          setState((before) => ({ ...before, running: false, failure: `The search failed: ${readableReason(answer.error)}` }))
          return
        }
        // A search refused for the rate limit runs again by itself when the pause ends, unless another search or
        // Clear came first (spec, section 10: Enter during the pause schedules the search for its end).
        const until = answer.value.pausedUntil === null ? Number.NaN : Date.parse(answer.value.pausedUntil)
        if (Number.isFinite(until)) {
          wake()
          pending.current = setTimeout(() => {
            pending.current = null
            if (asked.current === request) again.current(shown, cursor)
          }, Math.max(PAUSE_MIN_MS, until - Date.now()))
        }
        setState((before) => {
          if (cursor === null || before.result === null) return { ...before, running: false, result: answer.value }
          // A page main refused (the pause, a failure) brings no rows and no cursor: the pages shown keep their count,
          // their cursor and their notices, and its own notices join them.
          if (refused(answer.value)) return { ...before, running: false, result: { ...before.result, pausedUntil: answer.value.pausedUntil, notices: joined(before.result.notices, answer.value.notices) } }
          const seen = new Set(before.result.rows.map(rowKey))
          const rows = [...before.result.rows, ...answer.value.rows.filter((each) => !seen.has(rowKey(each)))]
          return { ...before, running: false, result: { ...answer.value, rows, searchedAt: before.result.searchedAt } }
        })
      })
    },
    [projectId, wake],
  )
  useEffect(() => {
    again.current = send
  })

  const run = useCallback(
    (text?: string, scope?: PrSearchScope) => {
      const typed = (text ?? current.current.text).trim()
      const where = scope ?? current.current.scope
      if (typed === '') {
        wake()
        asked.current += 1
        setState((before) => ({ ...before, scope: where, shown: null, result: null, running: false, failure: null }))
        return
      }
      send({ text: typed, scope: where }, null)
    },
    [send, wake],
  )

  const setScope = useCallback(
    (scope: PrSearchScope) => {
      const { shown, text } = current.current
      current.current = { ...current.current, scope }
      setState((before) => ({ ...before, scope }))
      if (shown !== null || text.trim() !== '') run(text, scope)
    },
    [run],
  )

  const saved = useCallback((answer: Awaited<ReturnType<typeof invoke<'prSearch.save'>>>): string | null => {
    if (!answer.ok) return readableReason(answer.error)
    setState((before) => ({ ...before, saved: answer.value.searches }))
    return null
  }, [])

  const setText = useCallback((text: string) => {
    current.current = { ...current.current, text }
    setState((before) => ({ ...before, text }))
  }, [])
  const clear = useCallback(() => {
    wake()
    asked.current += 1
    current.current = { ...current.current, text: '' }
    setState((before) => ({ ...before, text: '', shown: null, result: null, running: false, failure: null }))
  }, [wake])
  const loadMore = useCallback(() => {
    const { shown, result, running } = current.current
    if (shown !== null && result !== null && result.cursor !== null && !running) send(shown, result.cursor)
  }, [send])
  const refresh = useCallback(() => {
    const { shown } = current.current
    if (shown !== null) send(shown, null)
  }, [send])
  const save = useCallback(
    async (name: string) => {
      const { text, scope } = current.current
      return saved(await invoke('prSearch.save', { projectId, name, query: text.trim(), scope }))
    },
    [projectId, saved],
  )
  const forget = useCallback(async (id: string) => saved(await invoke('prSearch.forget', { projectId, id })), [projectId, saved])

  return { ...state, setText, run, setScope, loadMore, refresh, clear, save, forget }
}
