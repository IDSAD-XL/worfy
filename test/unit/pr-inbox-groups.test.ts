// The groups of the PR inbox (worfy-pr-inbox ticket 02, src/main/github/inbox-groups.ts): a pure function over a snapshot of
// PRs, by the rules of the spec — Needs my review, Needs my answer, Needs a fix, Ready, Waiting on others. Logins and
// repositories are made up.
import { describe, expect, it } from 'vitest'
import { groupOf, groupPulls, lastActivityOf, type InboxComment, type InboxPull } from '../../src/main/github/inbox-groups'

const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'

let ids = 0
const comment = (author: string, createdAt: string, body = 'a word'): InboxComment => ({ id: `C${++ids}`, databaseId: ids, author, body, createdAt, url: `https://github.com/demo-org/api/pull/1#c${ids}` })
const thread = (comments: InboxComment[], isResolved = false) => ({ id: `T${++ids}`, isResolved, isOutdated: false, path: 'src/a.ts', line: 1, viewerCanReply: true, comments })

function pull(over: Partial<InboxPull> = {}): InboxPull {
  return {
    repo: 'demo-org/api',
    number: 1,
    title: 'A change',
    url: 'https://github.com/demo-org/api/pull/1',
    state: 'OPEN',
    isDraft: false,
    author: ME,
    headRefName: 'feature/a',
    headRefOid: 'sha-1',
    createdAt: '2026-11-09T08:00:00Z',
    updatedAt: '2026-11-10T08:00:00Z',
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    ci: 'passing',
    reviewRequests: [],
    reviews: [],
    threads: [],
    comments: [],
    ...over,
  }
}

describe('Needs my review', () => {
  it('a review asked of me in person', () => {
    expect(groupOf(pull({ author: ANA, reviewRequests: [{ login: ME, team: null }] }), ME, true)).toEqual({ group: 'needs-review', viaTeam: false })
  })

  it('a review asked only through a team is marked via team', () => {
    expect(groupOf(pull({ author: ANA, reviewRequests: [{ login: null, team: 'core' }] }), ME, true)).toEqual({ group: 'needs-review', viaTeam: true })
  })

  it('asked again after my review', () => {
    const reviewed = pull({ author: ANA, reviews: [{ author: ME, state: 'CHANGES_REQUESTED', submittedAt: '2026-11-09T10:00:00Z' }], reviewRequests: [{ login: ME, team: null }] })
    expect(groupOf(reviewed, ME, true)).toEqual({ group: 'needs-review', viaTeam: false })
    // Reviewed and not asked again: not my move.
    expect(groupOf({ ...reviewed, reviewRequests: [] }, ME, false)).toBeNull()
  })

  it('the oldest request first', () => {
    const newer = pull({ number: 2, author: ANA, createdAt: '2026-11-10T08:00:00Z' })
    const older = pull({ number: 3, author: BO, createdAt: '2026-11-01T08:00:00Z' })
    const grouped = groupPulls(
      [
        { pull: newer, reviewRequested: true },
        { pull: older, reviewRequested: true },
      ],
      ME,
    )
    expect(grouped.get('needs-review')!.map(({ pull }) => pull.number)).toEqual([3, 2])
  })
})

describe('Needs my answer', () => {
  it('my PR with an unresolved thread whose last comment is not mine', () => {
    expect(groupOf(pull({ threads: [thread([comment(ME, '2026-11-10T06:00:00Z'), comment(ANA, '2026-11-10T07:00:00Z')])] }), ME, false)?.group).toBe('needs-answer')
  })

  it('not when the thread is resolved or my comment is the last', () => {
    expect(groupOf(pull({ threads: [thread([comment(ANA, '2026-11-10T07:00:00Z')], true)] }), ME, false)?.group).toBe('waiting')
    expect(groupOf(pull({ threads: [thread([comment(ANA, '2026-11-10T07:00:00Z'), comment(ME, '2026-11-10T08:00:00Z')])] }), ME, false)?.group).toBe('waiting')
  })

  it('a mention of me newer than my last comment, on any PR', () => {
    const mentioned = pull({ author: ANA, comments: [comment(ME, '2026-11-10T05:00:00Z'), comment(ANA, '2026-11-10T07:00:00Z', `@${ME} could you look at the retry?`)] })
    expect(groupOf(mentioned, ME, false)?.group).toBe('needs-answer')
    // Answered after the mention: not any more.
    expect(groupOf({ ...mentioned, comments: [...mentioned.comments, comment(ME, '2026-11-10T08:00:00Z')] }, ME, false)).toBeNull()
    // Another login that starts the same is no mention.
    expect(groupOf(pull({ author: ANA, comments: [comment(ANA, '2026-11-10T07:00:00Z', `@${ME}x hi`)] }), ME, false)).toBeNull()
  })

  it("an answer to my thread on someone else's PR", () => {
    expect(groupOf(pull({ author: ANA, threads: [thread([comment(ME, '2026-11-10T06:00:00Z'), comment(ANA, '2026-11-10T07:00:00Z')])] }), ME, false)?.group).toBe('needs-answer')
  })

  it('comes before Needs a fix', () => {
    expect(groupOf(pull({ ci: 'failing', threads: [thread([comment(ANA, '2026-11-10T07:00:00Z')])] }), ME, false)?.group).toBe('needs-answer')
  })
})

describe('Needs a fix', () => {
  it('my PR: red CI, changes requested, or a conflict', () => {
    expect(groupOf(pull({ ci: 'failing' }), ME, false)?.group).toBe('needs-fix')
    expect(groupOf(pull({ reviewDecision: 'CHANGES_REQUESTED' }), ME, false)?.group).toBe('needs-fix')
    expect(groupOf(pull({ mergeStateStatus: 'DIRTY' }), ME, false)?.group).toBe('needs-fix')
  })

  it('changes requested in a review when no branch protection rule gives a review decision', () => {
    const reviews = [
      { author: ANA, state: 'APPROVED', submittedAt: '2026-11-10T09:00:00Z' },
      { author: BO, state: 'CHANGES_REQUESTED', submittedAt: '2026-11-10T10:00:00Z' },
    ]
    expect(groupOf(pull({ reviewDecision: null, mergeStateStatus: 'CLEAN', reviews }), ME, false)?.group).toBe('needs-fix')
  })
})

describe('Ready', () => {
  it('approved, green, without a conflict', () => {
    expect(groupOf(pull({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }), ME, false)?.group).toBe('ready')
    // A repository without CI counts as green.
    expect(groupOf(pull({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', ci: null }), ME, false)?.group).toBe('ready')
  })

  it('an approving review when no branch protection rule gives a review decision', () => {
    const reviews = [{ author: ANA, state: 'APPROVED', submittedAt: '2026-11-10T09:00:00Z' }]
    expect(groupOf(pull({ reviewDecision: null, mergeStateStatus: 'CLEAN', reviews }), ME, false)?.group).toBe('ready')
    expect(groupOf(pull({ reviewDecision: null, mergeStateStatus: 'CLEAN' }), ME, false)?.group).toBe('waiting')
  })

  it('not while CI runs or the PR is a draft', () => {
    expect(groupOf(pull({ reviewDecision: 'APPROVED', ci: 'running' }), ME, false)?.group).toBe('waiting')
    expect(groupOf(pull({ reviewDecision: 'APPROVED', isDraft: true }), ME, false)?.group).toBe('waiting')
  })
})

describe('Waiting on others', () => {
  it('my PR without a move of mine', () => {
    expect(groupOf(pull(), ME, false)).toEqual({ group: 'waiting', viaTeam: false })
  })

  it("someone else's PR without a move of mine is not in the inbox", () => {
    expect(groupOf(pull({ author: ANA }), ME, false)).toBeNull()
  })
})

it('a closed PR is in no group', () => {
  expect(groupOf(pull({ state: 'MERGED', ci: 'failing' }), ME, false)).toBeNull()
  expect(groupOf(pull({ author: ANA, state: 'CLOSED' }), ME, true)).toBeNull()
})

describe('last activity', () => {
  it('the newest comment or review, else updatedAt', () => {
    expect(lastActivityOf(pull())).toBe('2026-11-10T08:00:00Z')
    const reviews = [{ author: ANA, state: 'APPROVED', submittedAt: '2026-11-09T12:00:00Z' }]
    expect(lastActivityOf(pull({ reviews }))).toBe('2026-11-09T12:00:00Z')
    const threads = [thread([comment(ANA, '2026-11-09T10:00:00Z'), comment(BO, '2026-11-09T14:00:00Z')])]
    expect(lastActivityOf(pull({ reviews, threads, comments: [comment(ANA, '2026-11-09T11:00:00Z')] }))).toBe('2026-11-09T14:00:00Z')
  })
})
