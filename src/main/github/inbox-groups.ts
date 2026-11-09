// The PRs of the PR inbox as main keeps them, and their groups (worfy-pr-inbox ticket 02): pure functions over a
// snapshot, by the rules of the spec — Needs my review, Needs my answer, Needs a fix, Ready, Waiting on others. The
// reader that fills the snapshot with gh is src/main/github/inbox.ts.
import type { CiState } from '../../shared/ipc/checks'
import { PR_INBOX_GROUPS, type PrInboxGroup } from '../../shared/ipc/pr-inbox'

export interface InboxComment {
  id: string
  /** The number GitHub's REST API knows the comment by (GraphQL `databaseId`); null when GitHub gives none. */
  databaseId: number | null
  author: string | null
  body: string
  createdAt: string
  url: string
}

export interface InboxThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string | null
  line: number | null
  viewerCanReply: boolean
  comments: InboxComment[]
}

export interface InboxPull {
  /** `owner/name` as GitHub spells it. */
  repo: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  author: string | null
  headRefName: string
  headRefOid: string | null
  createdAt: string
  updatedAt: string
  /** GitHub's own; null when no branch protection rule asks for reviews (decisionOf reads the reviews then). */
  reviewDecision: string | null
  mergeable: string | null
  mergeStateStatus: string | null
  ci: CiState | null
  /** Who is asked to review: a user's login, or a team's slug. */
  reviewRequests: { login: string | null; team: string | null }[]
  /** The latest review of each reviewer that approved or asked for changes. */
  reviews: { author: string | null; state: string; submittedAt: string | null }[]
  threads: InboxThread[]
  comments: InboxComment[]
}

export const same = (login: string | null, viewer: string): boolean => login !== null && login.toLowerCase() === viewer.toLowerCase()
export const timeOf = (iso: string | null | undefined): number => (iso == null ? Number.NaN : Date.parse(iso))

/** Every comment the snapshot has of a PR: the conversation's and the threads'. */
export const commentsOf = (pull: InboxPull): InboxComment[] => [...pull.comments, ...pull.threads.flatMap((thread) => thread.comments)]

/**
 * The review decision of a PR: GitHub's `reviewDecision`, or, when GitHub leaves it null (no branch protection rule
 * asks for reviews), the latest opinionated reviews — changes requested by anyone, else an approval.
 */
export function decisionOf(pull: InboxPull): string | null {
  if (pull.reviewDecision !== null) return pull.reviewDecision
  if (pull.reviews.some((review) => review.state === 'CHANGES_REQUESTED')) return 'CHANGES_REQUESTED'
  if (pull.reviews.some((review) => review.state === 'APPROVED')) return 'APPROVED'
  return null
}

/** The time of the last comment or review of a PR, else its `updatedAt`. */
export function lastActivityOf(pull: InboxPull): string {
  const times = [...commentsOf(pull).map((comment) => comment.createdAt), ...pull.reviews.flatMap((review) => (review.submittedAt === null ? [] : [review.submittedAt]))].filter((time) => !Number.isNaN(timeOf(time)))
  return times.reduce<string | null>((last, time) => (last === null || timeOf(time) > timeOf(last) ? time : last), null) ?? pull.updatedAt
}

/** `@viewer` as a whole login, not the start of a longer one. */
function mentions(body: string, viewer: string): boolean {
  const login = viewer.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|[^\\w-])@${login}(?![\\w-])`, 'iu').test(body)
}

/**
 * Whether the user owes an answer: on the user's own PR, an unresolved thread whose last comment is someone else's;
 * on any PR, an unresolved thread the user wrote in whose last comment is someone else's, or a mention of the user
 * newer than the user's last comment there.
 */
function owesAnswer(pull: InboxPull, viewer: string, mine: boolean): boolean {
  for (const thread of pull.threads) {
    const last = thread.comments.at(-1)
    if (thread.isResolved || last === undefined || same(last.author, viewer)) continue
    if (mine || thread.comments.some((comment) => same(comment.author, viewer))) return true
  }
  const all = commentsOf(pull)
  const lastOwn = Math.max(-Infinity, ...all.filter((comment) => same(comment.author, viewer)).map((comment) => timeOf(comment.createdAt)))
  return all.some((comment) => !same(comment.author, viewer) && timeOf(comment.createdAt) > lastOwn && mentions(comment.body, viewer))
}

export interface GroupPlace {
  group: PrInboxGroup
  /** In Needs my review only: the review is asked of the user through a team, not in person. */
  viaTeam: boolean
}

/**
 * The group of an open PR for the user `viewer`, by the spec's rules, the first that fits; null when the PR is closed,
 * or someone else's without a move of the user's. `reviewRequested`: the `review-requested:@me` search found it, which
 * takes requests to the user in person and through a team, and a request made again after the user's review.
 */
export function groupOf(pull: InboxPull, viewer: string, reviewRequested: boolean): GroupPlace | null {
  if (pull.state !== 'OPEN') return null
  const mine = same(pull.author, viewer)
  if (!mine && reviewRequested) return { group: 'needs-review', viaTeam: !pull.reviewRequests.some((request) => same(request.login, viewer)) }
  if (owesAnswer(pull, viewer, mine)) return { group: 'needs-answer', viaTeam: false }
  if (!mine) return null
  const decision = decisionOf(pull)
  if (pull.ci === 'failing' || decision === 'CHANGES_REQUESTED' || pull.mergeStateStatus === 'DIRTY') return { group: 'needs-fix', viaTeam: false }
  // A repository without CI counts as green.
  if (decision === 'APPROVED' && pull.ci !== 'running' && !pull.isDraft) return { group: 'ready', viaTeam: false }
  return { group: 'waiting', viaTeam: false }
}

export interface InboxMember {
  pull: InboxPull
  reviewRequested: boolean
}

/** Every group, in the view's order, each PR with its place: review requests the oldest PR first, the rest the oldest activity first. */
export function groupPulls(members: readonly InboxMember[], viewer: string): Map<PrInboxGroup, { pull: InboxPull; viaTeam: boolean }[]> {
  const groups = new Map<PrInboxGroup, { pull: InboxPull; viaTeam: boolean }[]>(PR_INBOX_GROUPS.map((group) => [group, []]))
  for (const { pull, reviewRequested } of members) {
    const place = groupOf(pull, viewer, reviewRequested)
    if (place !== null) groups.get(place.group)!.push({ pull, viaTeam: place.viaTeam })
  }
  for (const [group, rows] of groups) {
    const at = (pull: InboxPull): number => timeOf(group === 'needs-review' ? pull.createdAt : pull.updatedAt)
    rows.sort((a, b) => at(a.pull) - at(b.pull) || a.pull.number - b.pull.number)
  }
  return groups
}
