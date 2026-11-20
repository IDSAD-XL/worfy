// The approvals of a PR by the rules of its base branch (worfy-pr-review ticket 02, src/shared/github/approvals.ts): a
// pure function over what main read — rulesets, classic protection, the reviews and the open code-owner requests.
// Logins, teams and commits are made up.
import { describe, expect, it } from 'vitest'
import { approvalsOf, type ApprovalReview, type ApprovalsInput, type PullRequestRule } from '../../src/shared/github/approvals'

const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'
const CY = 'dev-cy'
const HEAD = 'sha-head'
const OLD = 'sha-old'

const rule = (count: number, extra: Partial<PullRequestRule> = {}): PullRequestRule => ({
  requiredApprovingReviewCount: count,
  dismissStaleReviewsOnPush: false,
  requireCodeOwnerReview: false,
  requireLastPushApproval: false,
  moreRules: false,
  ...extra,
})
const protection = (count: number, extra: Partial<NonNullable<ApprovalsInput['protection']>> = {}): NonNullable<ApprovalsInput['protection']> => ({
  requiresApprovingReviews: true,
  requiredApprovingReviewCount: count,
  requiresCodeOwnerReviews: false,
  dismissesStaleReviews: false,
  requireLastPushApproval: false,
  ...extra,
})
const approved = (author: string, extra: Partial<ApprovalReview> = {}): ApprovalReview => ({ author, state: 'APPROVED', authorCanPush: true, commit: HEAD, ...extra })

/** A PR of mine whose last push is mine, without rules, decision, reviews or code-owner requests. */
const input = (extra: Partial<ApprovalsInput> = {}): ApprovalsInput => ({
  author: ME,
  headRefOid: HEAD,
  lastPusher: ME,
  reviewDecision: null,
  rules: [],
  protection: null,
  reviews: [],
  codeOwnerRequests: [],
  ...extra,
})

describe('how many approvals the base branch asks for', () => {
  it('a ruleset: its PULL_REQUEST rule gives the number', () => {
    expect(approvalsOf(input({ rules: [rule(2)], reviewDecision: 'REVIEW_REQUIRED', reviews: [approved(ANA)] }))).toMatchObject({ have: 1, need: 2, source: 'ruleset', decision: 'review-required' })
  })

  it('classic protection an admin sees gives the number', () => {
    expect(approvalsOf(input({ protection: protection(1), reviewDecision: 'REVIEW_REQUIRED' }))).toMatchObject({ have: 0, need: 1, source: 'protection' })
  })

  it('classic protection that asks for reviews without a number asks for one, as GitHub does', () => {
    expect(approvalsOf(input({ protection: protection(0, { requiredApprovingReviewCount: null }), reviewDecision: 'REVIEW_REQUIRED' }))).toMatchObject({ need: 1, source: 'protection' })
  })

  it('classic protection that does not ask for reviews is no review rule', () => {
    expect(approvalsOf(input({ protection: protection(2, { requiresApprovingReviews: false }) }))).toMatchObject({ need: 0, source: 'none', decision: null })
  })

  it('several rules: the largest number wins, a ruleset of the organization and one of the repository alike', () => {
    expect(approvalsOf(input({ rules: [rule(1), rule(0)] }))).toMatchObject({ need: 1, source: 'ruleset' })
    expect(approvalsOf(input({ rules: [rule(1)], protection: protection(3) }))).toMatchObject({ need: 3, source: 'protection' })
    expect(approvalsOf(input({ rules: [rule(2)], protection: protection(1) }))).toMatchObject({ need: 2, source: 'ruleset' })
  })

  it('no rule read while GitHub gives a decision: a rule the account cannot see, need unknown', () => {
    expect(approvalsOf(input({ reviewDecision: 'REVIEW_REQUIRED', reviews: [approved(ANA)] }))).toMatchObject({ have: 1, need: null, source: 'hidden', decision: 'review-required' })
  })

  it('no rule and no decision: nothing asks for reviews, need 0, the approvals still counted', () => {
    expect(approvalsOf(input({ reviews: [approved(ANA)] }))).toEqual({ have: 1, need: 0, source: 'none', codeOwnersPending: [], stale: 0, lastPushNeedsOther: false, moreRules: false, decision: null })
  })
})

describe('how many approvals count', () => {
  it('GitHub APPROVED wins over a count that falls short: the account does not see every rule', () => {
    expect(approvalsOf(input({ rules: [rule(2)], reviewDecision: 'APPROVED', reviews: [approved(ANA)] }))).toMatchObject({ have: 1, need: 2, decision: 'approved' })
    expect(approvalsOf(input({ reviewDecision: 'APPROVED', reviews: [approved(ANA), approved(BO)] }))).toMatchObject({ have: 2, need: null, source: 'hidden', decision: 'approved' })
  })

  it('CHANGES_REQUESTED keeps the number of approvals', () => {
    expect(approvalsOf(input({ rules: [rule(2)], reviewDecision: 'CHANGES_REQUESTED', reviews: [approved(ANA), { author: BO, state: 'CHANGES_REQUESTED', authorCanPush: true, commit: HEAD }] }))).toMatchObject({
      have: 1,
      need: 2,
      decision: 'changes-requested',
    })
  })

  it('without a decision from GitHub the count decides', () => {
    expect(approvalsOf(input({ rules: [rule(2)], reviews: [approved(ANA), approved(BO)] }))).toMatchObject({ have: 2, need: 2, decision: 'approved' })
    expect(approvalsOf(input({ rules: [rule(2)], reviews: [approved(ANA)] }))).toMatchObject({ have: 1, need: 2, decision: 'review-required' })
  })

  it('an approval of a reviewer without push access does not count, nor one whose access GitHub does not tell', () => {
    const reviews = [approved(ANA), approved(BO, { authorCanPush: false }), approved(CY, { authorCanPush: null })]
    expect(approvalsOf(input({ rules: [rule(2)], reviews }))).toMatchObject({ have: 1, decision: 'review-required' })
  })

  it("the author's own approval never counts", () => {
    expect(approvalsOf(input({ rules: [rule(1)], reviews: [approved(ME)] }))).toMatchObject({ have: 0 })
  })

  it('with dismiss stale reviews, an approval of an older commit is stale and does not count', () => {
    const reviews = [approved(ANA), approved(BO, { commit: OLD }), { author: CY, state: 'DISMISSED', authorCanPush: true, commit: OLD }]
    expect(approvalsOf(input({ rules: [rule(2, { dismissStaleReviewsOnPush: true })], reviews }))).toMatchObject({ have: 1, stale: 2, decision: 'review-required' })
    expect(approvalsOf(input({ protection: protection(2, { dismissesStaleReviews: true }), reviews }))).toMatchObject({ have: 1, stale: 2 })
    // Without the rule an approval of an older commit still counts.
    expect(approvalsOf(input({ rules: [rule(2)], reviews }))).toMatchObject({ have: 2, stale: 0, decision: 'approved' })
  })

  it('code owners asked and not yet answered keep the count from green while a rule wants them', () => {
    const asked = { codeOwnerRequests: ['demo-org/payments', CY] }
    expect(approvalsOf(input({ rules: [rule(1, { requireCodeOwnerReview: true })], reviews: [approved(ANA)], ...asked }))).toMatchObject({
      have: 1,
      codeOwnersPending: ['demo-org/payments', CY],
      decision: 'review-required',
    })
    expect(approvalsOf(input({ protection: protection(1, { requiresCodeOwnerReviews: true }), ...asked }))).toMatchObject({ codeOwnersPending: ['demo-org/payments', CY] })
    // No rule wants code owners: their open request does not hold the count.
    expect(approvalsOf(input({ rules: [rule(1)], reviews: [approved(ANA)], ...asked }))).toMatchObject({ codeOwnersPending: [], decision: 'approved' })
  })

  it('last push approval: the approval of whoever pushed last needs another approver', () => {
    const lastPush = { rules: [rule(1, { requireLastPushApproval: true })], lastPusher: ANA }
    expect(approvalsOf(input({ ...lastPush, reviews: [approved(ANA)] }))).toMatchObject({ have: 1, lastPushNeedsOther: true, decision: 'review-required' })
    expect(approvalsOf(input({ ...lastPush, reviews: [approved(ANA), approved(BO)] }))).toMatchObject({ have: 2, lastPushNeedsOther: false, decision: 'approved' })
    // Another's approval of an older commit does not approve the last push.
    expect(approvalsOf(input({ ...lastPush, reviews: [approved(ANA), approved(BO, { commit: OLD })] }))).toMatchObject({ lastPushNeedsOther: true })
    // Without approvals there is nothing to say about the last push yet.
    expect(approvalsOf(input({ ...lastPush }))).toMatchObject({ lastPushNeedsOther: false })
  })

  it('a rule worfy does not count: green only by GitHub', () => {
    const more = { rules: [rule(1, { moreRules: true })], reviews: [approved(ANA)] }
    expect(approvalsOf(input(more))).toMatchObject({ have: 1, moreRules: true, decision: 'review-required' })
    expect(approvalsOf(input({ ...more, reviewDecision: 'APPROVED' }))).toMatchObject({ decision: 'approved' })
  })
})
