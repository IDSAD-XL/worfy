// The approvals chip (worfy-pr-review ticket 03, src/renderer/pr-inbox/ApprovalsChip.tsx; its texts are approvalsChip of
// src/renderer/pr-inbox/usePrInbox.ts): how many approvals count and how many the base branch asks for, as the
// prototype of ticket 01 draws it — `0/2`, `1/2` neutral, `✓ 2/2` and `✓ 2` green when GitHub says APPROVED, red with
// the count on changes requested, `1/?` muted when the rule is not visible, a clock while code owners hold a count that
// is reached. The chip always carries text: the accessible name says it in words, the tooltip says where the number
// comes from and who approved. Logins and teams are invented.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PrApprovals, PrReviewer } from '../../src/shared/ipc/pr-inbox'
import { ApprovalsChip } from '../../src/renderer/pr-inbox/ApprovalsChip'
import { approvalsChip, approvalsNote, approvalsShort } from '../../src/renderer/pr-inbox/usePrInbox'

afterEach(cleanup)

const ANA = 'dev-ana'
const BO = 'dev-bo'

const approver = (login: string, extra: Partial<PrReviewer> = {}): PrReviewer => ({ login, kind: 'user', state: 'approved', counts: true, codeOwner: false, ...extra })

const approvals = (extra: Partial<PrApprovals> = {}): PrApprovals => ({
  have: 0,
  need: 2,
  source: 'ruleset',
  codeOwnersPending: [],
  stale: 0,
  lastPushNeedsOther: false,
  moreRules: false,
  decision: 'review-required',
  reviewers: [],
  ...extra,
})

describe('the texts of the chip', () => {
  it('0/2: nothing yet', () => {
    expect(approvalsChip(approvals())).toEqual({ tone: 'neutral', text: '0/2', label: '0 of 2 required approvals', tooltip: '0 of 2 required approvals', owners: false, count: true })
  })

  it('1/2: neutral until the count is reached, who approved in the tooltip', () => {
    expect(approvalsChip(approvals({ have: 1, reviewers: [approver(ANA), approver(BO, { state: 'commented', counts: false })] }))).toMatchObject({
      tone: 'neutral',
      text: '1/2',
      label: '1 of 2 required approvals',
      tooltip: '1 of 2 required approvals · approved by @dev-ana',
    })
  })

  it('✓ 2/2 when GitHub says APPROVED, ✓ 2 when the rule is not visible: GitHub decides over the count', () => {
    expect(approvalsChip(approvals({ have: 2, decision: 'approved', reviewers: [approver(ANA), approver(BO)] }))).toMatchObject({
      tone: 'ready',
      text: '✓ 2/2',
      label: '2 of 2 required approvals, approved',
      tooltip: '2 of 2 required approvals · approved by @dev-ana and @dev-bo · GitHub says: approved',
    })
    expect(approvalsChip(approvals({ have: 2, need: null, source: 'hidden', decision: 'approved' }))).toMatchObject({ tone: 'ready', text: '✓ 2', label: '2 approvals, approved' })
    // A count short of the rule GitHub still approves: green, the count as it is.
    expect(approvalsChip(approvals({ have: 1, decision: 'approved' }))).toMatchObject({ tone: 'ready', text: '✓ 1/2' })
  })

  // Debt sweep after worfy-pr-review: GitHub gave no decision and worfy's own count approved, so neither the tooltip
  // nor the Approvals cell may put the word in GitHub's mouth.
  it("approved by worfy's count, not GitHub: the tooltip and the Approvals cell say so", () => {
    const counted = approvals({ have: 2, decision: 'approved', decidedBy: 'worfy', reviewers: [approver(ANA), approver(BO)] })
    expect(approvalsChip(counted)).toMatchObject({
      tone: 'ready',
      text: '✓ 2/2',
      tooltip: "2 of 2 required approvals · approved by @dev-ana and @dev-bo · approved by worfy's count — GitHub gives no review decision",
    })
    expect(approvalsNote(counted)).toBe("approved by worfy's count")
    expect(approvalsNote(approvals({ have: 2, decision: 'approved', decidedBy: 'github' }))).toBe('GitHub says: approved')
    // A snapshot of an older Project machine names nobody: GitHub's word, as before.
    expect(approvalsNote(approvals({ have: 2, decision: 'approved' }))).toBe('GitHub says: approved')
  })

  it('1/?: the rule is not visible to the account, muted, GitHub’s word in the tooltip', () => {
    expect(approvalsChip(approvals({ have: 1, need: null, source: 'hidden', reviewers: [approver(ANA)] }))).toEqual({
      tone: 'unknown',
      text: '1/?',
      label: '1 approval, rule not visible',
      tooltip: "1 approval · approved by @dev-ana · GitHub does not show this branch's review rule to your account. GitHub says: review required",
      owners: false,
      count: true,
    })
  })

  it('changes requested: the blocked colour with the count, who asked for changes first', () => {
    const reviewers = [approver(ANA), approver(BO, { state: 'changes-requested', counts: false })]
    expect(approvalsChip(approvals({ have: 1, decision: 'changes-requested', reviewers }))).toMatchObject({
      tone: 'blocked',
      text: '✕ 1/2',
      label: '1 of 2 required approvals, changes requested',
      tooltip: '1 of 2 required approvals · changes requested by @dev-bo · approved by @dev-ana',
    })
    expect(approvalsChip(approvals({ have: 0, need: null, source: 'hidden', decision: 'changes-requested' }))).toMatchObject({ tone: 'blocked', text: '✕ 0/?' })
  })

  it('code owners: a reached count waits with a clock; a short one stays neutral; both name them', () => {
    expect(approvalsChip(approvals({ have: 2, codeOwnersPending: ['demo-org/payments'], reviewers: [approver(ANA), approver(BO)] }))).toEqual({
      tone: 'waiting',
      text: '2/2',
      label: '2 of 2 required approvals, waiting for code owners',
      tooltip: '2 of 2 required approvals · approved by @dev-ana and @dev-bo · waiting for code owners: @demo-org/payments',
      owners: true,
      count: true,
    })
    expect(approvalsChip(approvals({ have: 1, codeOwnersPending: ['demo-org/payments', 'dev-cy'] }))).toMatchObject({
      tone: 'neutral',
      owners: false,
      tooltip: '1 of 2 required approvals · waiting for code owners: @demo-org/payments and @dev-cy',
    })
    // A code-owner team the account cannot see has no @.
    expect(approvalsChip(approvals({ have: 2, codeOwnersPending: ['code owners (hidden team)'] }))?.tooltip).toBe('2 of 2 required approvals · waiting for code owners: code owners (hidden team)')
  })

  it('a code-owner request the rule does not name still explains why GitHub holds a reached count', () => {
    const reviewers = [approver(ANA), { login: 'code owners (hidden team)', kind: 'hidden', state: 'requested', counts: false, codeOwner: true } as const]
    expect(approvalsChip(approvals({ have: 1, need: 1, reviewers }))?.tooltip).toBe('1 of 1 required approval · approved by @dev-ana · waiting for code owners: code owners (hidden team)')
  })

  it('a reached count GitHub still holds is never called approved: GitHub’s word, or more rules when worfy knows of them', () => {
    expect(approvalsChip(approvals({ have: 2, reviewers: [approver(ANA), approver(BO)] }))?.tooltip).toBe('2 of 2 required approvals · approved by @dev-ana and @dev-bo · GitHub says: review required')
    expect(approvalsChip(approvals({ have: 2, moreRules: true }))?.tooltip).toBe('2 of 2 required approvals · more rules apply — GitHub decides')
    // Short of the count, the rules worfy does not count are not worth a word: nearly every repository has one.
    expect(approvalsChip(approvals({ have: 1, moreRules: true }))?.tooltip).toBe('1 of 2 required approvals')
  })

  it('stale approvals and the last push name themselves', () => {
    expect(approvalsChip(approvals({ have: 1, stale: 1 }))?.tooltip).toBe('1 of 2 required approvals · 1 stale approval, before the last push')
    expect(approvalsChip(approvals({ have: 2, stale: 2, lastPushNeedsOther: true }))?.tooltip).toBe('2 of 2 required approvals · 2 stale approvals, before the last push · the last push needs another approver')
  })

  it('a rule that asks for no approvals while GitHub requires a review: the decision, never 0/0', () => {
    const chip = approvalsChip(approvals({ have: 0, need: 0, decision: 'review-required' }))
    expect(chip).toMatchObject({ tone: 'neutral', text: 'review required', label: '0 approvals, GitHub says review required', count: false })
    expect(chip?.text).not.toContain('/')
    expect(approvalsChip(approvals({ have: 1, need: 0, decision: 'approved' }))).toMatchObject({ tone: 'ready', text: '✓ 1' })
  })

  it('no chip when nothing asks for reviews, and none before main reads approvals', () => {
    expect(approvalsChip(approvals({ need: 0, source: 'none', decision: null }))).toBeNull()
    expect(approvalsChip(approvals({ need: 0, decision: null }))).toBeNull()
    expect(approvalsChip(undefined)).toBeNull()
  })

  it('approvals of a Project machine that lists no reviewers: the count without names', () => {
    expect(approvalsChip(approvals({ have: 1, reviewers: undefined }))?.tooltip).toBe('1 of 2 required approvals')
  })

  it('short of approvals: a chip that is not green', () => {
    expect(approvalsShort(approvals({ have: 1 }))).toBe(true)
    expect(approvalsShort(approvals({ have: 1, need: null, source: 'hidden' }))).toBe(true)
    expect(approvalsShort(approvals({ have: 1, decision: 'changes-requested' }))).toBe(true)
    expect(approvalsShort(approvals({ have: 2, decision: 'approved' }))).toBe(false)
    expect(approvalsShort(approvals({ need: 0, source: 'none', decision: null }))).toBe(false)
    expect(approvalsShort(undefined)).toBe(false)
  })
})

describe('the chip as drawn', () => {
  const chip = () => screen.getByTestId('approvals-chip')

  it.each([
    ['0/2', approvals(), 'neutral'],
    ['✓ 2/2', approvals({ have: 2, decision: 'approved' }), 'ready'],
    ['✕ 1/2', approvals({ have: 1, decision: 'changes-requested' }), 'blocked'],
    ['1/?', approvals({ have: 1, need: null, source: 'hidden' }), 'unknown'],
    ['2/2', approvals({ have: 2, codeOwnersPending: ['demo-org/payments'] }), 'waiting'],
  ] as const)('%s: its text, its words for assistive technology, its tooltip and the class of its colour', (text, value, tone) => {
    render(<ApprovalsChip approvals={value} />)
    expect(chip().textContent).toBe(text)
    expect(chip().getAttribute('role')).toBe('img')
    expect(chip().getAttribute('aria-label')).toBe(approvalsChip(value)!.label)
    expect(chip().getAttribute('title')).toBe(approvalsChip(value)!.tooltip)
    expect(chip().className).toContain(`w-approvals-chip--${tone}`)
    expect(chip().dataset.tone).toBe(tone)
  })

  it('a clock while code owners hold a reached count; the word «approvals» after a count where asked for', () => {
    render(<ApprovalsChip approvals={approvals({ have: 2, codeOwnersPending: ['demo-org/payments'] })} word />)
    expect(chip().querySelector('svg')).not.toBeNull()
    expect(chip().textContent).toBe('2/2 approvals')
    cleanup()
    render(<ApprovalsChip approvals={approvals({ have: 0, need: 0, decision: 'review-required' })} word />)
    expect(chip().textContent).toBe('review required')
  })

  it('nothing when nothing asks for reviews', () => {
    const { container } = render(<ApprovalsChip approvals={approvals({ need: 0, source: 'none', decision: null })} />)
    expect(container.innerHTML).toBe('')
  })
})
