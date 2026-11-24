// The approvals of a PR in the PR inbox (worfy-pr-review ticket 02): main reads the review rules of the base branch
// with the details of the PR — rulesets of the repository and of the organization, classic protection an admin sees
// and the null GitHub gives anyone else — and each row of the snapshot carries `approvals`. Against the gh stand-in
// (test/fixtures/gh/gh-stub.mjs, WORFY_GH); owners, repositories, teams and logins are made up, and nothing reaches
// GitHub.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrInbox, type PrInboxProject } from '../../src/main/github/inbox'
import { prInboxSetting } from '../../src/main/projects/pr-inbox-state'
import { prApprovalsSchema, prInboxSnapshotSchema, type PrInboxRow, type PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import { removeTestTree } from '../remove'
import { ghWorld, type GhWorld } from './gh-world'

beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})

const temps: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-approvals-')))
  temps.push(dir)
  return dir
}

const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'
const API = 'demo-org/api'
const HEAD = 'sha-head'

const pullRule = (count: number, extra: Record<string, unknown> = {}) => ({
  type: 'PULL_REQUEST',
  parameters: { requiredApprovingReviewCount: count, dismissStaleReviewsOnPush: false, requireCodeOwnerReview: false, requireLastPushApproval: false, requireExtraApprovalForUnattributedChanges: false, requiredReviewers: [], ...extra },
})
/** A rule that asks for no review: GitHub gives its parameters a type the query does not spread, so they come empty. */
const checksRule = { type: 'REQUIRED_STATUS_CHECKS', parameters: {} }
const review = (author: string, state: string, canPush: boolean, oid = HEAD) => ({ author: { login: author }, state, submittedAt: '2026-11-10T07:00:00Z', authorCanPushToRepository: canPush, commit: { oid } })

/** A PR of mine on `main`, its last commit mine, without threads; `pull` adds the GraphQL fields of the case. */
function stubPull(number: number, pull: Record<string, unknown>) {
  return {
    repo: API,
    number,
    updatedAt: '2026-11-10T08:00:00Z',
    headRefOid: HEAD,
    involves: true,
    reviewRequested: false,
    pull: {
      title: `Change ${number}`,
      url: `https://github.com/${API}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: '2026-11-09T08:00:00Z',
      author: { login: ME },
      baseRefName: 'main',
      headRefName: `feature/${number}`,
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { author: { user: { login: ME } }, statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: [] },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: { nodes: [] },
      comments: { nodes: [] },
      ...pull,
    },
  }
}

function setUp(pulls: ReturnType<typeof stubPull>[]): { gh: GhWorld; inbox: PrInbox } {
  const gh = ghWorld(join(tempDir(), 'gh'), { accounts: [{ login: ME, token: 'tok-me' }] })
  writeFileSync(join(gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls }))
  const base = tempDir()
  const project: PrInboxProject = { id: 'p1', root: join(base, 'root'), dataDir: join(base, 'data') }
  mkdirSync(project.root, { recursive: true })
  mkdirSync(project.dataDir, { recursive: true })
  const inbox = new PrInbox({
    run: gh.run,
    projects: () => [project],
    enabled: (each) => prInboxSetting(each.dataDir),
    account: async () => ME,
    repos: async () => [API],
    now: () => Date.parse('2026-11-10T09:00:00Z'),
    retryWaitMs: 0,
  })
  return { gh, inbox }
}

async function snapshotOf(pulls: ReturnType<typeof stubPull>[]): Promise<{ gh: GhWorld; snapshot: PrInboxSnapshot }> {
  const { gh, inbox } = setUp(pulls)
  await inbox.tick()
  // What main sends the view parses with the channel's schema, `approvals` and all.
  return { gh, snapshot: prInboxSnapshotSchema.parse(inbox.snapshot('p1')) }
}

const rowOf = (snapshot: PrInboxSnapshot, number: number): PrInboxRow & { group: string } => {
  for (const { group, rows } of snapshot.groups) {
    const row = rows.find((each) => each.number === number)
    if (row) return { ...row, group }
  }
  throw new Error(`no row #${number}`)
}

const queryOf = (args: readonly string[]): string => args[args.indexOf('-f') + 1] ?? ''
const detailsQueries = (gh: GhWorld): string[] =>
  gh
    .calls()
    .filter((args) => args[0] === 'api' && args[1] === 'graphql')
    .map(queryOf)
    .filter((query) => query.includes('pullRequest(number: $k0)'))

describe('the approvals of a row of the PR inbox', () => {
  it('the details query reads the rules of the base branch and the push access of each reviewer, and nothing is written', async () => {
    const { gh } = await snapshotOf([stubPull(1, {})])
    const [query] = detailsQueries(gh)
    expect(query).toContain('baseRefName')
    expect(query).toMatch(/baseRef \{ rules\(first: 50\) \{ nodes \{ type parameters \{ \.\.\. on PullRequestParameters \{ requiredApprovingReviewCount dismissStaleReviewsOnPush requireCodeOwnerReview requireLastPushApproval /u)
    expect(query).toContain('branchProtectionRule { requiresApprovingReviews requiredApprovingReviewCount requiresCodeOwnerReviews dismissesStaleReviews requireLastPushApproval }')
    expect(query).toContain('latestOpinionatedReviews(first: 50) { nodes { author { login } state submittedAt authorCanPushToRepository commit { oid } } }')
    expect(query).toContain('asCodeOwner')
    // Read-only: no call names another method, and no query is a mutation.
    expect(gh.calls().flat().some((arg) => /^(?:--method|-X)/u.test(arg))).toBe(false)
    expect(gh.calls().map(queryOf).some((text) => /\bmutation\b/u.test(text))).toBe(false)
  })

  it('rulesets of the repository and of the organization: the largest PULL_REQUEST rule, the other rules ignored', async () => {
    const { snapshot } = await snapshotOf([
      stubPull(1, {
        reviewDecision: 'REVIEW_REQUIRED',
        baseRef: { rules: { nodes: [checksRule, pullRule(1), pullRule(2, { dismissStaleReviewsOnPush: true })] }, branchProtectionRule: null },
        latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', true), review(BO, 'APPROVED', true, 'sha-old')] },
      }),
    ])
    expect(rowOf(snapshot, 1).approvals).toEqual({
      have: 1,
      need: 2,
      source: 'ruleset',
      codeOwnersPending: [],
      stale: 1,
      lastPushNeedsOther: false,
      moreRules: false,
      decision: 'review-required',
      decidedBy: 'github',
      reviewers: [
        { login: ANA, kind: 'user', state: 'approved', counts: true, codeOwner: false },
        { login: BO, kind: 'user', state: 'stale', counts: false, codeOwner: false },
      ],
    })
  })

  it('classic protection an admin sees gives the number; its code owners still asked hold the count', async () => {
    const { snapshot } = await snapshotOf([
      stubPull(2, {
        reviewDecision: 'REVIEW_REQUIRED',
        baseRef: {
          rules: { nodes: [] },
          branchProtectionRule: { requiresApprovingReviews: true, requiredApprovingReviewCount: 1, requiresCodeOwnerReviews: true, dismissesStaleReviews: false, requireLastPushApproval: false },
        },
        reviewRequests: {
          nodes: [
            { asCodeOwner: true, requestedReviewer: { __typename: 'Team', slug: 'payments', combinedSlug: 'demo-org/payments' } },
            { asCodeOwner: false, requestedReviewer: { __typename: 'User', login: BO } },
          ],
        },
        latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', true)] },
      }),
    ])
    expect(rowOf(snapshot, 2).approvals).toMatchObject({ have: 1, need: 1, source: 'protection', codeOwnersPending: ['demo-org/payments'], decision: 'review-required' })
    // The Approvals cell lists the review and both open requests (worfy-pr-review ticket 03).
    expect(rowOf(snapshot, 2).approvals?.reviewers).toEqual([
      { login: ANA, kind: 'user', state: 'approved', counts: true, codeOwner: false },
      { login: 'demo-org/payments', kind: 'team', state: 'requested', counts: false, codeOwner: true },
      { login: BO, kind: 'user', state: 'requested', counts: false, codeOwner: false },
    ])
  })

  it('a code-owner request whose team the token cannot see (no reviewer) is listed as a hidden team and holds the count', async () => {
    const { snapshot } = await snapshotOf([
      stubPull(8, {
        reviewDecision: 'REVIEW_REQUIRED',
        baseRef: { rules: { nodes: [pullRule(1, { requireCodeOwnerReview: true })] }, branchProtectionRule: null },
        reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: null }] },
        latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', true)] },
      }),
    ])
    expect(rowOf(snapshot, 8).approvals).toMatchObject({
      have: 1,
      need: 1,
      codeOwnersPending: ['code owners (hidden team)'],
      reviewers: [
        { login: ANA, kind: 'user', state: 'approved', counts: true, codeOwner: false },
        { login: 'code owners (hidden team)', kind: 'hidden', state: 'requested', counts: false, codeOwner: true },
      ],
    })
  })

  it('classic protection GitHub hides (null) while it gives a decision: need unknown; APPROVED from GitHub wins', async () => {
    const { snapshot } = await snapshotOf([
      stubPull(3, { reviewDecision: 'REVIEW_REQUIRED', baseRef: { rules: { nodes: [] }, branchProtectionRule: null }, latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', true)] } }),
      stubPull(4, { reviewDecision: 'APPROVED', baseRef: { rules: { nodes: [] }, branchProtectionRule: null }, latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', true), review(BO, 'APPROVED', true)] } }),
    ])
    expect(rowOf(snapshot, 3).approvals).toMatchObject({ have: 1, need: null, source: 'hidden', decision: 'review-required' })
    expect(rowOf(snapshot, 4).approvals).toMatchObject({ have: 2, need: null, source: 'hidden', decision: 'approved' })
    expect(rowOf(snapshot, 4).group).toBe('ready')
  })

  it("no rule: an approval without push access does not count, and the group of the PR stays as it was (Ready by the reviews' decision)", async () => {
    const { snapshot } = await snapshotOf([stubPull(5, { baseRef: { rules: { nodes: [] }, branchProtectionRule: null }, latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', false)] } })])
    const row = rowOf(snapshot, 5)
    expect(row.approvals).toEqual({
      have: 0,
      need: 0,
      source: 'none',
      codeOwnersPending: [],
      stale: 0,
      lastPushNeedsOther: false,
      moreRules: false,
      decision: null,
      decidedBy: 'worfy',
      reviewers: [{ login: ANA, kind: 'user', state: 'approved', counts: false, codeOwner: false }],
    })
    expect(row.reviewDecision).toBe('APPROVED')
    expect(row.group).toBe('ready')
  })

  it('a base branch GitHub cannot resolve, and a rule worfy does not count', async () => {
    const { snapshot } = await snapshotOf([
      stubPull(6, { baseRef: null }),
      stubPull(7, { baseRef: { rules: { nodes: [pullRule(1, { requiredReviewers: [{ minimumApprovals: 1 }] })] }, branchProtectionRule: null }, latestOpinionatedReviews: { nodes: [review(ANA, 'APPROVED', true)] } }),
    ])
    expect(rowOf(snapshot, 6).approvals).toMatchObject({ need: 0, source: 'none' })
    expect(rowOf(snapshot, 7).approvals).toMatchObject({ have: 1, need: 1, moreRules: true, decision: 'review-required' })
  })

  it('a snapshot of a Project machine that does not read approvals yet still parses', () => {
    const old = rowFields()
    const parsed = prInboxSnapshotSchema.parse({ projectId: 'p1', enabled: true, viewer: ME, groups: [{ group: 'waiting', rows: [old] }], readAt: null, nextSearchAt: null, error: null, notice: null })
    expect(parsed.groups[0]!.rows[0]!.approvals).toBeUndefined()
  })

  // `reviewers` came with worfy-pr-review ticket 03: a Project machine on ticket 02 sends approvals without it, and a
  // Linked machine on ticket 02 gets approvals with it.
  const approvals02 = { have: 1, need: 2, source: 'ruleset', codeOwnersPending: [], stale: 0, lastPushNeedsOther: false, moreRules: false, decision: 'review-required' } as const

  it('approvals of a Project machine that does not list reviewers yet still parse, without reviewers', () => {
    const parsed = prInboxSnapshotSchema.parse({ projectId: 'p1', enabled: true, viewer: ME, groups: [{ group: 'waiting', rows: [{ ...rowFields(), approvals: approvals02 }] }], readAt: null, nextSearchAt: null, error: null, notice: null })
    expect(parsed.groups[0]!.rows[0]!.approvals).toEqual(approvals02)
    expect(parsed.groups[0]!.rows[0]!.approvals?.reviewers).toBeUndefined()
  })

  it('approvals of this version pass the schema of ticket 02, which knows no reviewers', () => {
    const schema02 = prApprovalsSchema.omit({ reviewers: true })
    const approvals = { ...approvals02, reviewers: [{ login: ANA, kind: 'user', state: 'approved', counts: true, codeOwner: false }] }
    expect(prApprovalsSchema.parse(approvals)).toEqual(approvals)
    expect(schema02.parse(approvals)).toEqual(approvals02)
  })
})

function rowFields(): Omit<PrInboxRow, 'approvals'> {
  return {
    repo: API,
    number: 9,
    title: 'Change 9',
    url: `https://github.com/${API}/pull/9`,
    isDraft: false,
    author: ME,
    headRefName: 'feature/9',
    headRefOid: HEAD,
    createdAt: '2026-11-09T08:00:00Z',
    updatedAt: '2026-11-10T08:00:00Z',
    ci: 'passing',
    reviewDecision: null,
    mergeStateStatus: 'CLEAN',
    additions: null,
    deletions: null,
    viaTeam: false,
    unresolvedThreads: 0,
    newSinceSeen: 0,
    lastActivityAt: '2026-11-10T08:00:00Z',
    threads: [],
    comments: [],
  }
}
