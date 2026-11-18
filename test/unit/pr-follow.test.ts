// Which of Resolve conflicts, Fix checks and Address comments a pull request has a reason for, in which order, and
// why one cannot run (src/shared/actions/pr-follow.ts, worfy-pr-follow ticket 01). Every login, repository and hash is
// invented.
import { describe, expect, it } from 'vitest'
import { prFollowBlock, prFollowReasons, prFollowRefusal, type PrFollowRow } from '../../src/shared/actions/pr-follow'
import type { PrInboxThread } from '../../src/shared/ipc/pr-inbox'

const ME = 'dev-me'
const PEER = 'dev-peer'
const SHA = '3f2a9c1d4e5b6a7980123456789abcdef0123456'
const REF = { repo: 'owner/web', pr: 118 }

let id = 0
const thread = (authors: string[], isResolved = false): PrInboxThread => ({
  id: `T${++id}`,
  isResolved,
  isOutdated: false,
  path: 'src/a.ts',
  line: 3,
  viewerCanReply: true,
  comments: authors.map((author) => ({ id: `C${++id}`, databaseId: id, author, body: 'why?', createdAt: '2026-11-18T10:00:00Z', url: 'https://github.com/x' })),
})

const row = (over: Partial<PrFollowRow> = {}): PrFollowRow => ({ author: ME, headRefOid: SHA, ci: 'passing', reviewDecision: null, mergeStateStatus: 'CLEAN', threads: [], isCrossRepository: false, ...over })

describe('prFollowReasons', () => {
  it('has none for a PR that is clean, green and has nothing to answer', () => {
    expect(prFollowReasons(row(), ME)).toEqual([])
  })

  it('takes DIRTY first, then failing CI, then the comments: a PR in conflict runs no CI', () => {
    const all = row({ mergeStateStatus: 'DIRTY', ci: 'failing', reviewDecision: 'CHANGES_REQUESTED' })
    expect(prFollowReasons(all, ME)).toEqual(['resolveConflicts', 'fixChecks', 'addressComments'])
    expect(prFollowReasons(row({ ci: 'failing', reviewDecision: 'CHANGES_REQUESTED' }), ME)).toEqual(['fixChecks', 'addressComments'])
    expect(prFollowReasons(row({ mergeStateStatus: 'DIRTY', reviewDecision: 'CHANGES_REQUESTED' }), ME)).toEqual(['resolveConflicts', 'addressComments'])
  })

  it('reads a merge state other than DIRTY and CI other than failing as no reason', () => {
    for (const mergeStateStatus of ['BEHIND', 'BLOCKED', 'UNSTABLE', 'UNKNOWN', null]) expect(prFollowReasons(row({ mergeStateStatus }), ME)).toEqual([])
    for (const ci of ['running', 'passing', null] as const) expect(prFollowReasons(row({ ci }), ME)).toEqual([])
  })

  it('has Address comments for changes requested, and for threads that wait for the user\'s answer only', () => {
    expect(prFollowReasons(row({ reviewDecision: 'CHANGES_REQUESTED' }), ME)).toEqual(['addressComments'])
    expect(prFollowReasons(row({ reviewDecision: 'APPROVED' }), ME)).toEqual([])
    expect(prFollowReasons(row({ threads: [thread([PEER])] }), ME)).toEqual(['addressComments'])
    // Resolved, or the user had the last word: nothing waits.
    expect(prFollowReasons(row({ threads: [thread([PEER], true), thread([PEER, ME])] }), ME)).toEqual([])
    // No viewer yet: no thread can wait for the user.
    expect(prFollowReasons(row({ threads: [thread([PEER])] }), null)).toEqual([])
  })
})

describe('prFollowRefusal', () => {
  it('lets the user\'s own PR of the repository itself be followed, the login in any case', () => {
    expect(prFollowRefusal(REF, row(), ME)).toBeNull()
    expect(prFollowRefusal(REF, row({ author: 'Dev-Me' }), ME)).toBeNull()
    // A snapshot of a Project machine that does not read isCrossRepository yet: not a fork.
    const older = row()
    delete older.isCrossRepository
    expect(prFollowRefusal(REF, older, ME)).toBeNull()
  })

  it('refuses a PR that is not the user\'s, from a fork, or closed, with the reason', () => {
    expect(prFollowRefusal(REF, row({ author: PEER }), ME)).toBe('owner/web#118 is not your pull request')
    expect(prFollowRefusal(REF, row({ author: null }), ME)).toBe('owner/web#118 is not your pull request')
    expect(prFollowRefusal(REF, row({ isCrossRepository: true }), ME)).toBe('owner/web#118 comes from a fork: a Session cannot push to it')
    // main's snapshot holds open PRs only: a closed or merged one has no row.
    expect(prFollowRefusal(REF, undefined, ME)).toBe('owner/web#118 is closed or no longer in the PR inbox')
    expect(prFollowRefusal(REF, row(), null)).toBe('The PR inbox has not read your GitHub login yet')
  })
})

describe('prFollowBlock', () => {
  it('lets an action run while its reason holds', () => {
    expect(prFollowBlock('fixChecks', REF, row({ ci: 'failing' }), ME)).toBeNull()
    expect(prFollowBlock('resolveConflicts', REF, row({ mergeStateStatus: 'DIRTY' }), ME)).toBeNull()
    expect(prFollowBlock('addressComments', REF, row({ reviewDecision: 'CHANGES_REQUESTED' }), ME)).toBeNull()
  })

  it('says the reason is gone, naming the short head', () => {
    expect(prFollowBlock('fixChecks', REF, row(), ME)).toBe('CI is no longer failing on 3f2a9c1')
    expect(prFollowBlock('resolveConflicts', REF, row(), ME)).toBe('The pull request no longer has a merge conflict on 3f2a9c1')
    expect(prFollowBlock('addressComments', REF, row(), ME)).toBe('Nothing waits for your answer on 3f2a9c1 any more')
    expect(prFollowBlock('fixChecks', REF, row({ headRefOid: null }), ME)).toBe('CI is no longer failing on its head')
  })

  it('puts the refusals of the PR before its reasons', () => {
    expect(prFollowBlock('fixChecks', REF, row({ ci: 'failing', isCrossRepository: true }), ME)).toBe('owner/web#118 comes from a fork: a Session cannot push to it')
    expect(prFollowBlock('fixChecks', REF, row({ ci: 'failing', author: PEER }), ME)).toBe('owner/web#118 is not your pull request')
    expect(prFollowBlock('fixChecks', REF, undefined, ME)).toBe('owner/web#118 is closed or no longer in the PR inbox')
  })
})
