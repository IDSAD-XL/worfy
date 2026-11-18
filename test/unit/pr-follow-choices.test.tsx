// Which pull request actions a Ticket offers (prFollowChoices, src/renderer/canvas/actions/pr-follow-choices.ts,
// worfy-pr-follow ticket 05): the PRs of the Ticket in the PR inbox snapshot, each with its reasons in the order of the
// button. The Ticket Node and the Command palette list these. Every login, repository and hash is invented.
import { describe, expect, it } from 'vitest'
import { prFollowChoices, prFollowTitle } from '../../src/renderer/canvas/actions/pr-follow-choices'
import type { PrInboxGroup, PrInboxRow, PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import type { Ticket } from '../../src/shared/workflow/types'

const ticket = (num: number, over: Partial<Ticket> = {}): Ticket => ({
  epic: 'demo',
  num,
  slug: `ticket-${num}`,
  title: `Ticket ${num}`,
  statusRaw: 'work',
  state: 'work',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  ...over,
})

const pull = (over: Partial<PrInboxRow> = {}): PrInboxRow => ({
  repo: 'example-org/demo',
  number: 31,
  title: 'Export the report',
  url: 'https://github.com/example-org/demo/pull/31',
  isDraft: false,
  isCrossRepository: false,
  author: 'dev-me',
  headRefName: 'demo/08',
  headRefOid: '3f2a9c1d4e5b6a7980123456789abcdef0123456',
  createdAt: '2026-11-17T10:00:00Z',
  updatedAt: '2026-11-18T10:00:00Z',
  ci: 'passing',
  reviewDecision: null,
  mergeStateStatus: 'CLEAN',
  additions: null,
  deletions: null,
  viaTeam: false,
  unresolvedThreads: 0,
  newSinceSeen: 0,
  lastActivityAt: '2026-11-18T10:00:00Z',
  threads: [],
  comments: [],
  ...over,
})

const inbox = (groups: Partial<Record<PrInboxGroup, PrInboxRow[]>>, enabled = true): PrInboxSnapshot => ({
  projectId: 'demo-00000005',
  enabled,
  viewer: 'dev-me',
  groups: Object.entries(groups).map(([group, rows]) => ({ group: group as PrInboxGroup, rows })),
  readAt: null,
  nextSearchAt: null,
  error: null,
  notice: null,
})

const TICKETS = [ticket(8), ticket(9)]
const choices = (snapshot: PrInboxSnapshot | undefined, num = 8) =>
  prFollowChoices(snapshot, { epic: 'demo', num }, TICKETS).map((choice) => [choice.row.repo, choice.row.number, choice.action])

describe('prFollowChoices', () => {
  it('the Ticket\'s PR by its branch, its reasons in the order Resolve conflicts, Fix checks, Address comments', () => {
    const snapshot = inbox({ 'needs-fix': [pull({ mergeStateStatus: 'DIRTY', ci: 'failing', reviewDecision: 'CHANGES_REQUESTED' })] })
    expect(choices(snapshot)).toEqual([
      ['example-org/demo', 31, 'resolveConflicts'],
      ['example-org/demo', 31, 'fixChecks'],
      ['example-org/demo', 31, 'addressComments'],
    ])
    // Another Ticket's PR is not this one's.
    expect(choices(snapshot, 9)).toEqual([])
  })

  it('nothing without a snapshot, with the inbox off, or for a PR with nothing to fix', () => {
    expect(choices(undefined)).toEqual([])
    expect(choices(inbox({ 'needs-fix': [pull({ ci: 'failing' })] }, false))).toEqual([])
    expect(choices(inbox({ waiting: [pull()] }))).toEqual([])
  })

  it('a Ticket with PRs in two repositories (ADR-0104): each PR with its own reasons, in the order of the inbox\'s groups', () => {
    // Both on the branch demo/08; the snapshot lists Needs a fix after Needs my answer whatever order it has.
    const snapshot = inbox({
      'needs-fix': [pull({ ci: 'failing', mergeStateStatus: 'DIRTY' })],
      'needs-answer': [pull({ repo: 'example-org/api', number: 7, reviewDecision: 'CHANGES_REQUESTED' })],
    })
    expect(prFollowChoices(snapshot, { epic: 'demo', num: 8 }, TICKETS).map((choice) => prFollowTitle(choice))).toEqual([
      'Address comments example-org/api#7',
      'Resolve conflicts example-org/demo#31',
      'Fix checks example-org/demo#31',
    ])
  })

  it('names the action and its PR', () => {
    expect(prFollowTitle({ row: pull(), action: 'fixChecks' })).toBe('Fix checks example-org/demo#31')
  })
})
