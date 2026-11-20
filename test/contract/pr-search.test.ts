// The PR search in main (worfy-pr-review ticket 04; spec, implementation decisions 1, 2 and 10): the search strings
// gh gets for each scope, "Load more" by the cursor, GitHub's 1,000, the 60 s memory, the rate-limit pause shared
// with the PR inbox, single sign-on, an answer GitHub cut short, 422, 401 and 404; a PR of the inbox taken from the
// inbox and never read twice; the saved searches and what a Linked machine with read-only access may do with them.
// Against the gh stand-in (test/fixtures/gh/gh-stub.mjs), which fails the test on any `--method` and any `mutation`:
// nothing reaches GitHub. Owners, repositories and logins are made up.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrInbox, type PrInboxProject } from '../../src/main/github/inbox'
import { BUILT_IN_SEARCHES, PR_SEARCHES_MAX, PrSearch, prSearchesPath, saveSearch } from '../../src/main/github/pr-search'
import { prSearchHandlers } from '../../src/main/ipc/pr-search'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { prInboxStatePath, prInboxSetting } from '../../src/main/projects/pr-inbox-state'
import { buildSearch } from '../../src/shared/pr-search/query'
import type { PrInboxRow } from '../../src/shared/ipc/pr-inbox'
import { prSearchForget, prSearchPull, prSearchResultSchema, prSearchRun, prSearchSave, prSearchSaved, type PrSearchResult } from '../../src/shared/ipc/pr-search'
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
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-search-')))
  temps.push(dir)
  return dir
}

const ME = 'dev-me'
const API = 'demo-org/api'
const WEB = 'demo-org/web'
const START = Date.parse('2026-11-20T09:00:00Z')
const BASE = 'is:pr archived:false sort:updated-desc'
const PROJECT_Q = `retry ${BASE} repo:${API} repo:${WEB}`

/** A PR as graphql.json holds it: in the inbox's search when `involves`, with the GraphQL fields of its details. */
function stubPull(repo: string, number: number, extra: Record<string, unknown> = {}) {
  return {
    repo,
    number,
    updatedAt: '2026-11-20T08:00:00Z',
    headRefOid: `sha-${number}`,
    involves: false,
    reviewRequested: false,
    pull: {
      title: `Change ${number}`,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: '2026-11-19T08:00:00Z',
      author: { login: 'dev-ana' },
      baseRefName: 'main',
      headRefName: `feature/${number}`,
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { author: { user: { login: 'dev-ana' } }, statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: [] },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: { nodes: [] },
      comments: { nodes: [] },
    },
    ...extra,
  }
}

/** A PR of mine that the inbox's `involves:@me` finds and keeps: a PR of someone else that asks nothing of me it leaves out. */
function minePull(repo: string, number: number) {
  const pull = stubPull(repo, number, { involves: true })
  return { ...pull, pull: { ...pull.pull, author: { login: ME }, commits: { nodes: [{ commit: { author: { user: { login: ME } }, statusCheckRollup: { state: 'SUCCESS' } } }] } } }
}

const node = (repo: string, number: number, updatedAt = '2026-11-20T08:00:00Z') => ({ repo, number, updatedAt })

interface Answer {
  q: string
  after?: string | null
  status?: number
  headers?: Record<string, string>
  message?: string
  errors?: unknown[]
  issueCount?: number
  nodes?: ReturnType<typeof node>[]
  endCursor?: string
  hasNextPage?: boolean
}

interface Bench {
  gh: GhWorld
  inbox: PrInbox
  search: PrSearch
  project: PrInboxProject
  clock: { now: number }
  answers: (answers: Answer[], rateLimit?: { limit: number; remaining: number; resetAt: string }) => void
  searchCalls: () => string[][]
  detailsCalls: () => string[][]
}

function setUp(pulls: ReturnType<typeof stubPull>[] = [], options: { pullsMax?: number } = {}): Bench {
  const gh = ghWorld(join(tempDir(), 'gh'), { accounts: [{ login: ME, token: 'tok-me' }] })
  writeFileSync(join(gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls }))
  const base = tempDir()
  const project: PrInboxProject = { id: 'p1', root: join(base, 'root'), dataDir: join(base, 'data') }
  mkdirSync(project.root, { recursive: true })
  mkdirSync(project.dataDir, { recursive: true })
  const clock = { now: START }
  const inbox = new PrInbox({ run: gh.run, projects: () => [project], enabled: (each) => prInboxSetting(each.dataDir), account: async () => ME, repos: async () => [API, WEB], now: () => clock.now, retryWaitMs: 0 })
  const inboxRow = (projectId: string, repo: string, number: number): PrInboxRow | null =>
    inbox
      .snapshot(projectId)
      .groups.flatMap((group) => group.rows)
      .find((row) => row.repo === repo && row.number === number) ?? null
  const search = new PrSearch({ run: gh.run, account: async () => ME, repos: async () => [API, WEB], inboxRow, rates: inbox, now: () => clock.now, pullsMax: options.pullsMax })
  const queryOf = (args: readonly string[]): string => args.find((arg) => arg.startsWith('query=')) ?? ''
  return {
    gh,
    inbox,
    search,
    project,
    clock,
    answers: (answers, rateLimit) => writeFileSync(join(gh.dir, 'search.json'), JSON.stringify({ answers, ...(rateLimit ? { rateLimit } : {}) })),
    searchCalls: () => gh.calls().filter((args) => queryOf(args).includes('search(type: ISSUE, query: $q')),
    detailsCalls: () => gh.calls().filter((args) => queryOf(args).includes('pullRequest(number: $k0)')),
  }
}

const varOf = (args: readonly string[], name: string): string | undefined => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)

async function run(bench: Bench, text: string, scope: 'project' | 'owners' | 'github' = 'project', cursor: string | null = null): Promise<PrSearchResult> {
  // What main sends the view parses with the channel's schema.
  return prSearchResultSchema.parse(await bench.search.run(bench.project, { text, scope, cursor }))
}

/** No call named another method than GET, none sent a mutation, and none was a REST call with fields: nothing written. */
function expectNoWrite(gh: GhWorld): void {
  const calls = gh.calls()
  expect(calls.flat().some((arg) => /^(?:--method|-X)/u.test(arg))).toBe(false)
  expect(calls.flat().some((arg) => /\bmutation\b/u.test(arg))).toBe(false)
  for (const args of calls) expect([args[0], args[1]], args.join(' ')).toEqual(args[0] === 'auth' ? ['auth', 'token'] : ['api', 'graphql'])
}

describe('prSearch.run: the search strings', () => {
  it('each scope: This Project names repo: of its repositories, the owners org:, All of GitHub neither; one read-only GraphQL search each', async () => {
    const bench = setUp()
    bench.answers([])
    await run(bench, 'retry', 'project')
    await run(bench, 'retry', 'owners')
    await run(bench, 'retry', 'github')
    const calls = bench.searchCalls()
    expect(calls.map((args) => varOf(args, 'q'))).toEqual([PROJECT_Q, `retry ${BASE} org:demo-org`, `retry ${BASE}`])
    for (const args of calls) {
      expect(args.slice(0, 3)).toEqual(['api', 'graphql', '-i'])
      expect(varOf(args, 'query')).toContain('search(type: ISSUE, query: $q, first: 30, after: $cursor) { issueCount pageInfo { hasNextPage endCursor }')
      expect(varOf(args, 'cursor')).toBeUndefined()
    }
    expectNoWrite(bench.gh)
  })

  it('is:issue of the text is left out with a notice; a repo: of the text is the scope', async () => {
    const bench = setUp()
    bench.answers([])
    const dropped = await run(bench, 'retry is:issue')
    expect(dropped.notices.map((each) => each.kind)).toEqual(['issue-dropped'])
    const own = await run(bench, 'repo:other-org/lib retry')
    expect(own.queries).toEqual([`repo:other-org/lib retry ${BASE}`])
    expect(own.notices.map((each) => each.kind)).toEqual(['own-scope'])
    expect(bench.searchCalls().map((args) => varOf(args, 'q'))).toEqual([PROJECT_Q, `repo:other-org/lib retry ${BASE}`])
  })
})

describe('prSearch.run: the rows', () => {
  it('a PR of the inbox takes the inbox row and is not read again; the rest is read once with the details query; nothing is marked seen', async () => {
    const bench = setUp([minePull(API, 1), stubPull(WEB, 5)])
    await bench.inbox.tick()
    const inboxRow = bench.inbox.snapshot('p1').groups.flatMap((group) => group.rows)[0]!
    expect(inboxRow.number).toBe(1)
    const detailsBefore = bench.detailsCalls().length
    bench.answers([{ q: PROJECT_Q, issueCount: 2, nodes: [node(WEB, 5), node(API, 1)] }])
    const result = await run(bench, 'retry')
    expect(result.rows.map((row) => [row.repo, row.number, row.inInbox])).toEqual([
      [WEB, 5, false],
      [API, 1, true],
    ])
    expect(result.rows[1]).toEqual({ ...inboxRow, inInbox: true })
    expect(result.rows[0]).toMatchObject({ title: 'Change 5', author: 'dev-ana', ci: 'passing', approvals: expect.objectContaining({ source: 'none' }) })
    expect(result).toMatchObject({ issueCount: 2, cursor: null, viewer: ME, fromMemory: false, notices: [] })
    const details = bench.detailsCalls().slice(detailsBefore)
    expect(details).toHaveLength(1)
    expect([varOf(details[0]!, 'o0'), varOf(details[0]!, 'n0'), varOf(details[0]!, 'k0'), varOf(details[0]!, 'k1')]).toEqual(['demo-org', 'web', '5', undefined])
    // After the memory of the search: the same updatedAt reads nothing of the PR again.
    bench.clock.now += 61_000
    await run(bench, 'retry')
    expect(bench.detailsCalls().slice(detailsBefore)).toHaveLength(1)
    expect(existsSync(prInboxStatePath(bench.project.dataDir))).toBe(false)
    expectNoWrite(bench.gh)
  })

  it('a PR GitHub gave a new updatedAt is read again', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5)] }])
    await run(bench, 'retry')
    bench.clock.now += 61_000
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5, '2026-11-20T08:30:00Z')] }])
    await run(bench, 'retry')
    expect(bench.detailsCalls()).toHaveLength(2)
  })

  it('the same search within 60 s answers from memory without a call; after 60 s it asks GitHub again', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5)] }])
    const first = await run(bench, 'retry')
    bench.clock.now += 59_000
    const again = await run(bench, 'retry')
    expect(again).toEqual({ ...first, fromMemory: true })
    expect(bench.searchCalls()).toHaveLength(1)
    bench.clock.now += 1_000
    expect((await run(bench, 'retry')).fromMemory).toBe(false)
    expect(bench.searchCalls()).toHaveLength(2)
  })
})

describe('prSearch.run: a search split into several', () => {
  it('the results of the searches come newest first across them, by updatedAt (review round 1)', async () => {
    const repos = Array.from({ length: 30 }, (_, n) => `demo-org/service-number-${String(n).padStart(2, '0')}`)
    const [early, late] = [repos[0]!, repos[29]!]
    const bench = setUp([stubPull(early, 1), stubPull(early, 3), stubPull(late, 2), stubPull(late, 4)])
    const queries = buildSearch({ text: 'retry', scope: 'project', repos }).queries
    expect(queries.length).toBeGreaterThan(1)
    bench.answers([
      { q: queries[0]!, nodes: [node(early, 1, '2026-11-20T08:00:00Z'), node(early, 3, '2026-11-20T06:00:00Z')] },
      { q: queries.at(-1)!, nodes: [node(late, 4, '2026-11-20T09:00:00Z'), node(late, 2, '2026-11-20T07:00:00Z')] },
    ])
    const search = new PrSearch({ run: bench.gh.run, account: async () => ME, repos: async () => repos, inboxRow: () => null, rates: bench.inbox, now: () => bench.clock.now })
    const result = await search.run(bench.project, { text: 'retry', scope: 'project' })
    expect(result.queries).toEqual(queries)
    expect(result.rows.map((row) => row.number)).toEqual([4, 1, 2, 3])
  })
})

describe('prSearch.run: Load more and the 1,000', () => {
  it('the cursor of a page asks the next one; the last page has none', async () => {
    const bench = setUp([stubPull(WEB, 5), stubPull(WEB, 6)])
    bench.answers([
      { q: PROJECT_Q, after: null, issueCount: 31, nodes: [node(WEB, 5)], hasNextPage: true, endCursor: 'Y3Vyc29yOjMw' },
      { q: PROJECT_Q, after: 'Y3Vyc29yOjMw', issueCount: 31, nodes: [node(WEB, 6)], hasNextPage: false },
    ])
    const first = await run(bench, 'retry')
    expect(first.rows.map((row) => row.number)).toEqual([5])
    expect(first.cursor).not.toBeNull()
    const more = await run(bench, 'retry', 'project', first.cursor)
    expect(more.rows.map((row) => row.number)).toEqual([6])
    expect(more.cursor).toBeNull()
    expect(bench.searchCalls().map((args) => varOf(args, 'cursor'))).toEqual([undefined, 'Y3Vyc29yOjMw'])
  })

  it('a cursor of another search is refused without a call: a broken one, and the page-1 cursor of a search with other words', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5)], hasNextPage: true, endCursor: 'Y3Vyc29yOjMw' }])
    await expect(bench.search.run(bench.project, { text: 'retry', scope: 'project', cursor: 'not-a-cursor' })).rejects.toThrow(/cursor is not of this search/u)
    expect(bench.searchCalls()).toEqual([])
    const first = await run(bench, 'retry')
    expect(first.cursor).not.toBeNull()
    await expect(bench.search.run(bench.project, { text: 'other', scope: 'project', cursor: first.cursor })).rejects.toThrow(/cursor is not of this search/u)
    expect(bench.searchCalls()).toHaveLength(1)
  })

  it('more than 1,000 results: GitHub gives the first 1,000 only, and the notice says so', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: `${BASE}`, issueCount: 4321, nodes: [node(WEB, 5)], hasNextPage: true, endCursor: 'c1' }])
    const result = await run(bench, '', 'github')
    expect(result.issueCount).toBe(4321)
    expect(result.notices).toEqual([{ kind: 'first-1000', text: 'Showing the first 1,000 — narrow the search', url: null }])
  })
})

describe('prSearch.run: the rate limit, shared with the PR inbox', () => {
  it('an answer with less than 10 % left pauses the account: the next search and the inbox make no call until resetAt', async () => {
    const bench = setUp([minePull(API, 1)])
    const resetAt = '2026-11-20T09:40:00Z'
    bench.answers([{ q: PROJECT_Q }], { limit: 5000, remaining: 120, resetAt })
    const first = await run(bench, 'retry')
    expect(first.rate).toEqual({ limit: 5000, remaining: 120, resetAt })
    const calls = bench.gh.calls().length
    const paused = await run(bench, 'other words')
    expect(paused.pausedUntil).toBe(new Date(resetAt).toISOString())
    expect(paused.notices.map((each) => each.kind)).toEqual(['rate-limit'])
    expect(paused.notices[0]!.text).toMatch(/^Search paused until \d\d:\d\d \(GitHub rate limit\)$/u)
    await bench.inbox.tick()
    expect(bench.gh.calls()).toHaveLength(calls)
    expect(bench.inbox.snapshot('p1').error).toMatch(/rate limit/u)
  })

  it('the PR inbox paused by its own read: the search waits too', async () => {
    const bench = setUp([minePull(API, 1)])
    writeFileSync(join(bench.gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, rateLimit: { limit: 5000, remaining: 10, resetAt: '2026-11-20T09:30:00Z' }, pulls: [minePull(API, 1)] }))
    await bench.inbox.tick()
    bench.answers([{ q: PROJECT_Q }])
    const result = await run(bench, 'retry')
    expect(result.notices.map((each) => each.kind)).toEqual(['rate-limit'])
    expect(bench.searchCalls()).toEqual([])
  })

  it('403 of the secondary rate limit with Retry-After: paused that long, the inbox too', async () => {
    const bench = setUp()
    bench.answers([{ q: PROJECT_Q, status: 403, message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.', headers: { 'Retry-After': '120' } }])
    const result = await run(bench, 'retry')
    expect(result.pausedUntil).toBe(new Date(START + 120_000).toISOString())
    expect(result.rows).toEqual([])
    expect(bench.inbox.accountPause(ME)?.until).toBe(START + 120_000)
  })
})

describe('prSearch.run: what GitHub refuses', () => {
  it('403 with X-GitHub-SSO: the notice to authorize the token, with GitHub\'s link; no results', async () => {
    const bench = setUp()
    const url = 'https://github.com/orgs/demo-sso/sso?authorization_request=A1b2C3'
    bench.answers([{ q: PROJECT_Q, status: 403, message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.', headers: { 'X-GitHub-SSO': `required; url=${url}` } }])
    const result = await run(bench, 'retry')
    expect(result.rows).toEqual([])
    expect(result.notices).toEqual([{ kind: 'sso', text: 'Authorize your token for demo-sso single sign-on', url }])
    expect(bench.inbox.accountPause(ME)).toBeNull()
  })

  it('403 with X-GitHub-SSO while the rate limit is low: still the SSO notice, and no pause (review round 1)', async () => {
    const bench = setUp()
    const url = 'https://github.com/orgs/demo-sso/sso?authorization_request=A1b2C3'
    bench.answers([{ q: PROJECT_Q, status: 403, message: 'Resource protected by organization SAML enforcement.', headers: { 'X-GitHub-SSO': `required; url=${url}` } }], { limit: 5000, remaining: 10, resetAt: '2026-11-20T09:40:00Z' })
    const result = await run(bench, 'retry')
    expect(result.notices).toEqual([{ kind: 'sso', text: 'Authorize your token for demo-sso single sign-on', url }])
    expect(result.pausedUntil).toBeNull()
  })

  it('X-GitHub-SSO: partial-results: the results that came, and a notice that some are hidden', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5)], headers: { 'X-GitHub-SSO': 'partial-results; organizations=21955855,20582480' } }])
    const result = await run(bench, 'retry')
    expect(result.rows.map((row) => row.number)).toEqual([5])
    expect(result.notices).toEqual([{ kind: 'sso-partial', text: 'Results from 2 organizations are hidden: authorize your token for their single sign-on', url: null }])
  })

  it('an answer GitHub cut short: what it found, and a notice', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5)], errors: [{ message: 'Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.' }] }])
    const result = await run(bench, 'retry')
    expect(result.rows.map((row) => row.number)).toEqual([5])
    expect(result.notices).toEqual([{ kind: 'incomplete', text: 'GitHub returned part of the results — search again or narrow it', url: null }])
  })

  it('422: GitHub\'s own words', async () => {
    const bench = setUp()
    bench.answers([{ q: PROJECT_Q, status: 422, message: 'Validation Failed' }])
    const result = await run(bench, 'retry')
    expect(result.notices).toEqual([{ kind: 'invalid', text: 'Validation Failed', url: null }])
  })

  it('401: GitHub refused the sign-in', async () => {
    const bench = setUp()
    bench.answers([{ q: PROJECT_Q, status: 401, message: 'Bad credentials' }])
    const result = await run(bench, 'retry')
    expect(result.notices).toEqual([{ kind: 'sign-in', text: 'GitHub refused the sign-in: Bad credentials', url: null }])
  })

  it('no gh login for the Project\'s account: no search runs', async () => {
    const bench = setUp()
    const search = new PrSearch({ run: bench.gh.run, account: async () => 'dev-nobody', repos: async () => [API], inboxRow: () => null, rates: bench.inbox, now: () => bench.clock.now })
    const result = await search.run(bench.project, { text: 'retry', scope: 'project' })
    expect(result.notices.map((each) => each.kind)).toEqual(['sign-in'])
    expect(result.notices[0]!.text).toContain('no gh login for dev-nobody')
    expect(bench.searchCalls()).toEqual([])
  })

  it('a Project without a repository on GitHub searches nothing in its scopes', async () => {
    const bench = setUp()
    const search = new PrSearch({ run: bench.gh.run, account: async () => ME, repos: async () => [], inboxRow: () => null, rates: bench.inbox, now: () => bench.clock.now })
    const result = await search.run(bench.project, { text: 'retry', scope: 'project' })
    expect(result.notices.map((each) => each.kind)).toEqual(['failed'])
    expect(bench.gh.calls()).toEqual([])
  })
})

describe('prSearch.pull: one PR of the results', () => {
  it('outside the inbox: read once, kept by its updatedAt, read again on refresh; nothing is marked seen', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    const first = await bench.search.pull(bench.project, { repo: WEB, number: 5 })
    expect(first.row).toMatchObject({ repo: WEB, number: 5, title: 'Change 5', inInbox: false })
    expect(first.readAt).toBe(new Date(START).toISOString())
    bench.clock.now += 120_000
    const kept = await bench.search.pull(bench.project, { repo: WEB, number: 5, updatedAt: '2026-11-20T08:00:00Z' })
    expect(kept.row).toEqual(first.row)
    expect(bench.detailsCalls()).toHaveLength(1)
    await bench.search.pull(bench.project, { repo: WEB, number: 5, updatedAt: '2026-11-20T08:00:00Z', refresh: true })
    expect(bench.detailsCalls()).toHaveLength(2)
    // Without updatedAt, the memory answers for 60 s.
    bench.clock.now += 30_000
    await bench.search.pull(bench.project, { repo: WEB, number: 5 })
    expect(bench.detailsCalls()).toHaveLength(2)
    expect(existsSync(prInboxStatePath(bench.project.dataDir))).toBe(false)
    expectNoWrite(bench.gh)
  })

  it('a PR of the inbox: the inbox row, no call', async () => {
    const bench = setUp([minePull(API, 1)])
    await bench.inbox.tick()
    const calls = bench.gh.calls().length
    const pull = await bench.search.pull(bench.project, { repo: API, number: 1 })
    expect(pull).toMatchObject({ row: { repo: API, number: 1, inInbox: true }, readAt: null, notices: [] })
    expect(bench.gh.calls()).toHaveLength(calls)
  })

  it('memory keeps at most pullsMax PRs: the oldest is read again', async () => {
    const bench = setUp([5, 6, 7, 8].map((number) => stubPull(WEB, number)), { pullsMax: 3 })
    for (const number of [5, 6, 7, 8]) await bench.search.pull(bench.project, { repo: WEB, number })
    expect(bench.detailsCalls()).toHaveLength(4)
    await bench.search.pull(bench.project, { repo: WEB, number: 8, updatedAt: '2026-11-20T08:00:00Z' })
    expect(bench.detailsCalls()).toHaveLength(4)
    await bench.search.pull(bench.project, { repo: WEB, number: 5, updatedAt: '2026-11-20T08:00:00Z' })
    expect(bench.detailsCalls()).toHaveLength(5)
  })

  it('two Projects of two accounts: the PR in memory of one is read again as the other account, with no row of the first (review round 1)', async () => {
    const bench = setUp([stubPull(WEB, 5)])
    writeFileSync(join(bench.gh.dir, 'tokens.json'), JSON.stringify({ [ME]: 'tok-me', 'dev-other': 'tok-other' }))
    const other = { id: 'p2', root: join(bench.project.root, '..', 'root-2') }
    mkdirSync(other.root, { recursive: true })
    const search = new PrSearch({ run: bench.gh.run, account: async (root) => (root === other.root ? 'dev-other' : ME), repos: async () => [WEB], inboxRow: () => null, rates: bench.inbox, now: () => bench.clock.now })
    const mine = await search.pull(bench.project, { repo: WEB, number: 5, updatedAt: '2026-11-20T08:00:00Z' })
    expect(mine.row).toMatchObject({ number: 5 })
    const theirs = await search.pull(other, { repo: WEB, number: 5, updatedAt: '2026-11-20T08:00:00Z' })
    expect(theirs.row).toMatchObject({ number: 5 })
    expect(bench.detailsCalls()).toHaveLength(2)
    expect(bench.gh.calls().filter((args) => args[0] === 'auth').map((args) => args[3])).toEqual([ME, 'dev-other'])
  })

  it('404: a repository the account cannot see', async () => {
    const bench = setUp([stubPull('demo-hidden/secret', 3, { hidden: true })])
    const pull = await bench.search.pull(bench.project, { repo: 'demo-hidden/secret', number: 3 })
    expect(pull).toEqual({ row: null, readAt: null, notices: [{ kind: 'not-visible', text: 'demo-hidden/secret is not visible to dev-me', url: null }] })
  })

  it('a PR GitHub cannot resolve in a repository it sees', async () => {
    const bench = setUp([stubPull(WEB, 9, { missing: true })])
    const pull = await bench.search.pull(bench.project, { repo: WEB, number: 9 })
    expect(pull.notices).toEqual([{ kind: 'not-visible', text: 'demo-org/web#9 is not visible to dev-me', url: null }])
  })
})

describe('saved searches', () => {
  it('the two built-in ones first, the user\'s after; a name saved again replaces its search; at most 20', () => {
    const dataDir = tempDir()
    expect(BUILT_IN_SEARCHES.map((each) => [each.name, each.scope])).toEqual([
      ['Review requested from me · All of GitHub', 'github'],
      ['Reviewed by me · open', 'project'],
    ])
    let n = 0
    const id = () => `id-${++n}`
    saveSearch(dataDir, { name: 'Retry work', query: 'retry', scope: 'project' }, id)
    const replaced = saveSearch(dataDir, { name: 'retry WORK', query: 'retry is:open', scope: 'owners' }, id)
    expect(replaced.slice(2)).toEqual([{ id: 'id-1', name: 'retry WORK', query: 'retry is:open', scope: 'owners', builtIn: false }])
    for (let k = 2; k <= PR_SEARCHES_MAX; k++) saveSearch(dataDir, { name: `Search ${k}`, query: `q${k}`, scope: 'github' }, id)
    expect(() => saveSearch(dataDir, { name: 'One too many', query: 'x', scope: 'github' }, id)).toThrow(`at most ${PR_SEARCHES_MAX} saved searches`)
    expect(() => saveSearch(dataDir, { name: 'Reviewed by me · open', query: 'x', scope: 'github' }, id)).toThrow(/built-in/u)
    const file = JSON.parse(readFileSync(prSearchesPath(dataDir), 'utf8')) as { searches: unknown[] }
    expect(file.searches).toHaveLength(PR_SEARCHES_MAX)
    // Only names, texts and scopes: no result of a search is stored.
    expect(Object.keys(file.searches[0] as object).sort()).toEqual(['id', 'name', 'query', 'scope'])
  })
})

describe('the channels and a Linked machine', () => {
  const LINKED = '77777777-7777-4777-8777-777777777777'

  it('run, pull and saved are `read`; save and forget are `write`', () => {
    expect([prSearchRun, prSearchPull, prSearchSaved, prSearchSave, prSearchForget].map((channel) => [channel.name, channel.access, channel.use])).toEqual([
      ['prSearch.run', 'project', 'read'],
      ['prSearch.pull', 'project', 'read'],
      ['prSearch.saved', 'project', 'read'],
      ['prSearch.save', 'project', 'write'],
      ['prSearch.forget', 'project', 'write'],
    ])
  })

  async function linked(level: 'read' | 'all') {
    const bench = setUp([stubPull(WEB, 5)])
    bench.answers([{ q: PROJECT_Q, nodes: [node(WEB, 5)] }])
    const project = { project: () => ({ id: 'p1', root: bench.project.root, dataDir: bench.project.dataDir }) }
    const adapter = await createLinkIpc({ modules: { './pr-search.ts': async () => prSearchHandlers(() => bench.search, project) }, isLinked: (id) => id === LINKED })
    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess(level)
    return { bench, call: (channel: string, input: unknown) => adapter.call(peer, channel, input, 'Beta') }
  }

  it('read-only access: run and saved answer; save and forget are refused before the handler, and pr-searches.json is not written', async () => {
    const { bench, call } = await linked('read')
    const searched = await call('prSearch.run', { projectId: 'p1', text: 'retry', scope: 'project' })
    expect(searched).toMatchObject({ ok: true, value: { rows: [{ repo: WEB, number: 5 }] } })
    expect(await call('prSearch.pull', { projectId: 'p1', repo: WEB, number: 5 })).toMatchObject({ ok: true, value: { row: { number: 5 } } })
    expect(await call('prSearch.saved', { projectId: 'p1' })).toMatchObject({ ok: true, value: { searches: BUILT_IN_SEARCHES } })
    expect(await call('prSearch.save', { projectId: 'p1', name: 'Mine', query: 'retry', scope: 'project' })).toEqual({ ok: false, error: readOnlyRefusal('Beta') })
    expect(await call('prSearch.forget', { projectId: 'p1', id: 'built-in:review-requested' })).toEqual({ ok: false, error: readOnlyRefusal('Beta') })
    expect(existsSync(prSearchesPath(bench.project.dataDir))).toBe(false)
  })

  it('full access: save writes the Project machine\'s file; a built-in search is not forgotten; a user\'s is', async () => {
    const { bench, call } = await linked('all')
    const saved = await call('prSearch.save', { projectId: 'p1', name: 'Mine', query: 'retry', scope: 'project' })
    expect(saved).toMatchObject({ ok: true })
    const mine = (saved as { value: { searches: { id: string; name: string }[] } }).value.searches.find((each) => each.name === 'Mine')!
    expect(existsSync(prSearchesPath(bench.project.dataDir))).toBe(true)
    const builtIn = await call('prSearch.forget', { projectId: 'p1', id: 'built-in:reviewed-by-me' })
    expect(builtIn).toMatchObject({ ok: false, error: expect.stringContaining('a built-in search cannot be forgotten') })
    expect(await call('prSearch.forget', { projectId: 'p1', id: mine.id })).toEqual({ ok: true, value: { searches: [...BUILT_IN_SEARCHES] } })
  })
})
