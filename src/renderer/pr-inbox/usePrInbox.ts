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
import { PR_INBOX_GROUPS, type PrApprovals, type PrInboxGroup, type PrInboxRow, type PrInboxSnapshot, type PrReviewer } from '../../shared/ipc/pr-inbox'
import { prFollowReasons } from '../../shared/actions/pr-follow'
import type { PrFollowAction } from '../../shared/projects/action-templates'
import { sameLogin, sameRepo, ticketOfRow } from '../../shared/pr-inbox/rows'
import { invoke, subscribe } from '../ipc'

// Moved to src/shared, where main reads them too (worfy-pr-follow ticket 01); the view and its tests still take them from here.
export { sameRepo, ticketOfRow }

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
