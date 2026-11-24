// How many approvals the base branch of a PR asks for and how many it has (worfy-pr-review ticket 02, the spec's
// implementation decision 3): a pure function over what main read with the PR's details (src/main/github/inbox.ts).
//
// - Need: the largest `requiredApprovingReviewCount` of the branch's rulesets' PULL_REQUEST rules (a reader sees them,
//   the organization's too) and of its classic branch protection (GitHub shows that one to an admin only). Neither
//   read while GitHub still gives a `reviewDecision`: a rule the account cannot see, `need` null. Neither read and no
//   `reviewDecision`: nothing asks for reviews, `need` 0.
// - Have: the latest APPROVED review of each reviewer who can push to the repository, not the PR's author. With
//   "dismiss stale reviews on push", an approval of an older commit is stale and does not count.
// - GitHub's `reviewDecision` wins over the count: it sees rules the account does not.
// - Reviewers (worfy-pr-review ticket 03): each reviewer once for the Approvals cell — the reviews, then the review
//   requests still open. A request whose reviewer GitHub does not name is a team the account cannot see: it is listed
//   under a name worfy gives it, and as a code owner it holds the count like a named one.
import type { PrApprovals, PrReviewer } from '../ipc/pr-inbox'

/** The name of a code-owner team the account cannot see, in the reviewers and in `codeOwnersPending`. */
export const HIDDEN_CODE_OWNERS = 'code owners (hidden team)'
/** The name of any other team the account cannot see. */
export const HIDDEN_TEAM = 'a team (hidden)'

/** An open review request: a user's login or a team's `org/slug`, null when GitHub does not name the reviewer. */
export interface ApprovalRequest {
  name: string | null
  team: boolean
  codeOwner: boolean
}

/** A PULL_REQUEST rule of a ruleset of the base branch, as GraphQL `Ref.rules` gives its PullRequestParameters. */
export interface PullRequestRule {
  requiredApprovingReviewCount: number
  dismissStaleReviewsOnPush: boolean
  requireCodeOwnerReview: boolean
  requireLastPushApproval: boolean
  /** Reviewers required by file path, or an extra approval for unattributed changes: GitHub counts them, worfy does not. */
  moreRules: boolean
}

/** The classic branch protection of the base branch, as GraphQL `Ref.branchProtectionRule` gives it to an admin. */
export interface ProtectionRule {
  requiresApprovingReviews: boolean
  requiredApprovingReviewCount: number | null
  requiresCodeOwnerReviews: boolean
  dismissesStaleReviews: boolean
  requireLastPushApproval: boolean
}

export interface ApprovalReview {
  author: string | null
  /** APPROVED, CHANGES_REQUESTED, DISMISSED, COMMENTED, PENDING. */
  state: string
  /** GitHub's `authorCanPushToRepository`: only such a reviewer's approval counts. Unknown — does not count. */
  authorCanPush: boolean | null
  /** The commit the review was given on; null when GitHub gives none. */
  commit: string | null
}

export interface ApprovalsInput {
  /** The PR's author: an approval of one's own PR never counts. */
  author: string | null
  headRefOid: string | null
  /** The author of the head commit: as near as GitHub's GraphQL tells who made the last push. */
  lastPusher: string | null
  reviewDecision: string | null
  /** The PULL_REQUEST rules of the base branch's rulesets. */
  rules: readonly PullRequestRule[]
  /** Null when GitHub gives none: no classic protection, or one the account may not see. */
  protection: ProtectionRule | null
  reviews: readonly ApprovalReview[]
  /** The review requests made of code owners that are still open: a user's login or a team's `org/slug`. */
  codeOwnerRequests: readonly string[]
  /** Every open review request, named or not (worfy-pr-review ticket 03). Absent — none. */
  requests?: readonly ApprovalRequest[]
}

const same = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase()

/** The approvals of a PR by the rules of its base branch. */
export function approvalsOf(input: ApprovalsInput): PrApprovals {
  const protection = input.protection?.requiresApprovingReviews === true ? input.protection : null
  // GitHub's own default for a protection that asks for reviews without a number is 1.
  const protectionNeed = protection === null ? null : (protection.requiredApprovingReviewCount ?? 1)
  const rulesetNeed = input.rules.length === 0 ? null : Math.max(...input.rules.map((rule) => rule.requiredApprovingReviewCount))
  const source: PrApprovals['source'] =
    rulesetNeed === null && protectionNeed === null ? (input.reviewDecision === null ? 'none' : 'hidden') : (protectionNeed ?? -1) > (rulesetNeed ?? -1) ? 'protection' : 'ruleset'
  const need = source === 'hidden' ? null : source === 'none' ? 0 : Math.max(rulesetNeed ?? 0, protectionNeed ?? 0)

  const dismissStale = input.rules.some((rule) => rule.dismissStaleReviewsOnPush) || protection?.dismissesStaleReviews === true
  const codeOwners = input.rules.some((rule) => rule.requireCodeOwnerReview) || protection?.requiresCodeOwnerReviews === true
  const lastPush = input.rules.some((rule) => rule.requireLastPushApproval) || protection?.requireLastPushApproval === true
  const moreRules = input.rules.some((rule) => rule.moreRules)

  const writers = input.reviews.filter((review) => review.authorCanPush === true && !same(review.author, input.author))
  const isStale = (review: ApprovalReview): boolean =>
    dismissStale && (review.state === 'DISMISSED' || (review.state === 'APPROVED' && review.commit !== null && input.headRefOid !== null && review.commit !== input.headRefOid))
  const counted = writers.filter((review) => review.state === 'APPROVED' && !isStale(review))
  const have = counted.length
  const stale = writers.filter(isStale).length
  const requests = input.requests ?? []
  const hiddenOwners = requests.some((request) => request.name === null && request.codeOwner)
  const codeOwnersPending = codeOwners ? [...input.codeOwnerRequests, ...(hiddenOwners ? [HIDDEN_CODE_OWNERS] : [])] : []
  // The last push must be approved by someone other than who pushed it: an approval of the head commit by another.
  const lastPushNeedsOther =
    lastPush && have > 0 && !counted.some((review) => !same(review.author, input.lastPusher) && (input.headRefOid === null || review.commit === null || review.commit === input.headRefOid))

  const { decision, decidedBy } = decisionOf(input.reviewDecision, have, need, codeOwnersPending, lastPushNeedsOther, moreRules)
  return { have, need, source, codeOwnersPending, stale, lastPushNeedsOther, moreRules, decision, decidedBy, reviewers: reviewersOf(input, (review) => counted.includes(review), isStale, requests) }
}

const REVIEW_STATE: Readonly<Record<string, PrReviewer['state']>> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', COMMENTED: 'commented', DISMISSED: 'dismissed' }

/** Each reviewer once: their latest review (not the author's, not a pending one), then the requests still open. */
function reviewersOf(input: ApprovalsInput, counts: (review: ApprovalReview) => boolean, isStale: (review: ApprovalReview) => boolean, requests: readonly ApprovalRequest[]): PrReviewer[] {
  const reviewers: PrReviewer[] = []
  for (const review of input.reviews) {
    const state = REVIEW_STATE[review.state]
    if (state === undefined || same(review.author, input.author)) continue
    reviewers.push({ login: review.author ?? 'ghost', kind: 'user', state: isStale(review) ? 'stale' : state, counts: counts(review), codeOwner: false })
  }
  for (const request of requests) {
    const login = request.name ?? (request.codeOwner ? HIDDEN_CODE_OWNERS : HIDDEN_TEAM)
    // A reviewer asked again keeps the review they gave: the list says what they did, and that they own the code.
    const known = reviewers.find((each) => same(each.login, login))
    if (known !== undefined) known.codeOwner ||= request.codeOwner
    else reviewers.push({ login, kind: request.name === null ? 'hidden' : request.team ? 'team' : 'user', state: 'requested', counts: false, codeOwner: request.codeOwner })
  }
  return reviewers
}

const GITHUB_DECISIONS: Readonly<Record<string, NonNullable<PrApprovals['decision']>>> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', REVIEW_REQUIRED: 'review-required' }

function decisionOf(reviewDecision: string | null, have: number, need: number | null, codeOwnersPending: readonly string[], lastPushNeedsOther: boolean, moreRules: boolean): Pick<PrApprovals, 'decision' | 'decidedBy'> {
  const github = reviewDecision === null ? undefined : GITHUB_DECISIONS[reviewDecision]
  if (github !== undefined) return { decision: github, decidedBy: 'github' }
  // GitHub gives no decision: worfy's count decides, and green only when nothing it cannot count applies.
  if (need === null || need === 0) return { decision: null, decidedBy: 'worfy' }
  return { decision: have >= need && codeOwnersPending.length === 0 && !lastPushNeedsOther && !moreRules ? 'approved' : 'review-required', decidedBy: 'worfy' }
}
