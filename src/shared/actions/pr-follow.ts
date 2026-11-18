// Which of "Resolve conflicts", "Fix checks" and "Address comments" (worfy-pr-follow ticket 01) a pull request has a
// reason for, in which order, and why one cannot run. Pure, so the button in Pull requests and on a Ticket Node, the
// row of the Command palette (tickets 04 and 05) and main before it starts anything (src/main/actions/launch.ts,
// prFollow) give the same verdict, as src/renderer/canvas/actions/gates.ts does for "Ship ticket".
//
// - Reasons, in this order (PR_FOLLOW_ACTIONS): `mergeStateStatus` DIRTY → Resolve conflicts, since a PR in conflict
//   runs no CI; `ci: 'failing'` → Fix checks; `CHANGES_REQUESTED`, or threads that wait for the user's answer
//   (waitingThreads) → Address comments.
// - Refusals of every action: a PR that is closed or no longer in the PR inbox (main's snapshot holds open PRs only),
//   a PR that is not the user's, a PR from a fork (the skill cannot push to someone else's fork).
import { PR_FOLLOW_ACTIONS, type PrFollowAction } from '../projects/action-templates'
import type { PrInboxRow } from '../ipc/pr-inbox'
import { sameLogin, waitingThreads } from '../pr-inbox/rows'

/** What the verdict reads of a row of the PR inbox. */
export type PrFollowRow = Pick<PrInboxRow, 'author' | 'headRefOid' | 'ci' | 'reviewDecision' | 'mergeStateStatus' | 'threads' | 'isCrossRepository'>

/** A pull request by its repository, `owner/name`, and number. */
export interface PrFollowRef {
  repo: string
  pr: number
}

const REASONS: Readonly<Record<PrFollowAction, (row: PrFollowRow, viewer: string | null) => boolean>> = {
  resolveConflicts: (row) => row.mergeStateStatus === 'DIRTY',
  fixChecks: (row) => row.ci === 'failing',
  addressComments: (row, viewer) => row.reviewDecision === 'CHANGES_REQUESTED' || waitingThreads(row, viewer) > 0,
}

/** The actions the PR has a reason for, in the order of PR_FOLLOW_ACTIONS; the first one goes on the button. */
export function prFollowReasons(row: PrFollowRow, viewer: string | null): PrFollowAction[] {
  return PR_FOLLOW_ACTIONS.filter((action) => REASONS[action](row, viewer))
}

/**
 * Why no action may follow the PR at all, or null when they may: `row` undefined — the PR is closed or not in the PR
 * inbox; a PR whose author is not `viewer` (also before the first search, when no viewer is known); a PR from a fork.
 */
export function prFollowRefusal(ref: PrFollowRef, row: PrFollowRow | undefined, viewer: string | null): string | null {
  const name = `${ref.repo}#${ref.pr}`
  if (row === undefined) return `${name} is closed or no longer in the PR inbox`
  if (viewer === null) return 'The PR inbox has not read your GitHub login yet'
  if (!sameLogin(row.author, viewer)) return `${name} is not your pull request`
  if (row.isCrossRepository === true) return `${name} comes from a fork: a Session cannot push to it`
  return null
}

/** The head as a refusal names it: its first seven characters, as git shortens a commit. */
const headOf = (row: PrFollowRow): string => (row.headRefOid === null ? 'its head' : row.headRefOid.slice(0, 7))

const GONE: Readonly<Record<PrFollowAction, (head: string) => string>> = {
  resolveConflicts: (head) => `The pull request no longer has a merge conflict on ${head}`,
  fixChecks: (head) => `CI is no longer failing on ${head}`,
  addressComments: (head) => `Nothing waits for your answer on ${head} any more`,
}

/** Why `action` cannot run on the PR now — a refusal of prFollowRefusal, or its reason is gone — or null when it can. */
export function prFollowBlock(action: PrFollowAction, ref: PrFollowRef, row: PrFollowRow | undefined, viewer: string | null): string | null {
  const refusal = prFollowRefusal(ref, row, viewer)
  if (refusal !== null || row === undefined) return refusal
  return REASONS[action](row, viewer) ? null : GONE[action](headOf(row))
}
