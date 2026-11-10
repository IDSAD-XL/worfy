// The PR inbox reader (worfy-pr-inbox ticket 02, src/main/github/inbox.ts) against the gh stand-in
// (test/fixtures/gh/gh-stub.mjs): two GraphQL searches per Project every 5 minutes, details only of the PRs whose
// `updatedAt` moved, pages halved on a 504, the interval doubled on failures, one cache per account, the switch in
// the Project's settings.json, and `pr-inbox.json` with ids, a sha and a time only. Nothing reaches GitHub: owners,
// repositories and logins below are made up. The reader never writes to GitHub, and the stand-in's log shows it.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INBOX_MAX_INTERVAL_MS, INBOX_SEARCH_INTERVAL_MS, PrInbox, remoteRepos, type PrInboxOptions, type PrInboxProject } from '../../src/main/github/inbox'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { prInboxHandlers } from '../../src/main/ipc/pr-inbox'
import { PR_INBOX_FILE, prInboxSetting } from '../../src/main/projects/pr-inbox-state'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { prInboxSnapshotSchema, type PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import { APP_URL, INDEX_HTML } from '../app-url'
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
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-inbox-')))
  temps.push(dir)
  return dir
}

const ME = 'dev-me'
const ANA = 'dev-ana'
const API = 'demo-org/api'
const WEB = 'demo-org/web'
const OTHER = 'demo-org/other'
const START = Date.parse('2026-11-10T09:00:00Z')
const MINUTE = 60_000
/** Words of a colleague: they may live in memory, never in a file. */
const COLLEAGUE_WORDS = 'please rename this helper before merge'

interface StubPull {
  repo: string
  number: number
  updatedAt: string
  headRefOid: string
  reviewRequested?: boolean
  involves?: boolean
  /** Found by the search, but GitHub cannot resolve its details. */
  missing?: boolean
  pull?: Record<string, unknown>
}

const comment = (id: string, author: string, createdAt: string, body: string) => ({ id, databaseId: Number(id.replace(/\D/gu, '')) || 1, author: { login: author }, body, createdAt, url: `https://github.com/x/y/pull/1#${id}` })

/** A PR of the stand-in; mine unless `author` says otherwise, with one unresolved thread whose last word is Ana's. */
function stubPull(repo: string, number: number, extra: Partial<StubPull> & { author?: string; requested?: string[] } = {}): StubPull {
  const author = extra.author ?? ME
  return {
    repo,
    number,
    updatedAt: '2026-11-10T08:00:00Z',
    headRefOid: `sha-${number}`,
    involves: true,
    reviewRequested: (extra.requested ?? []).includes(ME),
    ...extra,
    pull: {
      title: `Change ${number}`,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: '2026-11-09T08:00:00Z',
      author: { login: author },
      headRefName: `feature/${number}`,
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: (extra.requested ?? []).map((login) => ({ requestedReviewer: { __typename: 'User', login } })) },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: {
        nodes: [
          {
            id: `T${number}`,
            isResolved: false,
            isOutdated: false,
            path: 'src/a.ts',
            line: 3,
            viewerCanReply: true,
            comments: { nodes: [comment(`C${number}1`, ANA, '2026-11-10T07:00:00Z', COLLEAGUE_WORDS), comment(`C${number}2`, ANA, '2026-11-10T07:30:00Z', `${COLLEAGUE_WORDS} too`)] },
          },
        ],
      },
      comments: { nodes: [] },
      ...extra.pull,
    },
  }
}

interface InboxWorld extends GhWorld {
  set(pulls: StubPull[], extra?: Record<string, unknown>): void
}

function world(pulls: StubPull[], extra: Record<string, unknown> = {}): InboxWorld {
  const gh = ghWorld(join(tempDir(), 'gh'), { accounts: [{ login: ME, token: 'tok-me' }] })
  const set = (next: StubPull[], more: Record<string, unknown> = extra) => writeFileSync(join(gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: next, ...more }))
  set(pulls)
  return { ...gh, set }
}

interface TestProject extends PrInboxProject {
  repos: string[]
}

function project(id: string, repos: string[], settings?: Record<string, unknown>): TestProject {
  const base = tempDir()
  const dataDir = join(base, 'data')
  mkdirSync(dataDir, { recursive: true })
  // gh runs in the root: a folder that is not there would not start it.
  mkdirSync(join(base, 'root'))
  if (settings !== undefined) writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(settings))
  return { id, root: join(base, 'root'), dataDir, repos }
}

let clock = START

function reader(gh: GhWorld, projects: TestProject[], over: Partial<PrInboxOptions> = {}): PrInbox {
  return new PrInbox({
    run: gh.run,
    projects: () => projects,
    enabled: (each) => prInboxSetting(each.dataDir),
    account: async () => ME,
    repos: async (root) => projects.find((each) => each.root === root)?.repos ?? [],
    now: () => clock,
    retryWaitMs: 0,
    ...over,
  })
}

beforeEach(() => {
  clock = START
})

const graphqlCalls = (gh: GhWorld): string[][] => gh.calls().filter((args) => args[0] === 'api' && args[1] === 'graphql')

function varsOf(args: readonly string[]): Record<string, string> {
  const vars: Record<string, string> = {}
  for (let i = 2; i < args.length - 1; i++) {
    if (args[i] !== '-f' && args[i] !== '-F') continue
    const pair = args[i + 1]!
    vars[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1)
  }
  return vars
}

const isSearch = (args: readonly string[]): boolean => (varsOf(args).query ?? '').includes('search(')
const searches = (gh: GhWorld): string[][] => graphqlCalls(gh).filter(isSearch)

/** The PRs each details call asked for, as `owner/name#N`, call by call. */
function detailsAsked(gh: GhWorld): string[][] {
  return graphqlCalls(gh)
    .filter((args) => !isSearch(args))
    .map((args) => {
      const vars = varsOf(args)
      return Object.keys(vars)
        .filter((name) => /^k\d+$/u.test(name))
        .map((name) => `${vars[`o${name.slice(1)}`]}/${vars[`n${name.slice(1)}`]}#${vars[name]}`)
    })
}

/** A PR of mine without a thread: its group follows CI, the review decision and mergeability only. */
const quietPull = (repo: string, number: number, pull: Record<string, unknown> = {}): StubPull => stubPull(repo, number, { pull: { reviewThreads: { nodes: [] }, ...pull } })
const rollup = (state: string) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] } })

const rowsOf = (snapshot: PrInboxSnapshot): string[] => snapshot.groups.flatMap((group) => group.rows.map((row) => `${row.repo}#${row.number}`)).sort()

describe('the search of a Project', () => {
  it('names every repository of the Project, asks details only of the PRs whose updatedAt moved, and never another repository', async () => {
    const gh = world([stubPull(API, 1), stubPull(WEB, 2, { author: ANA, requested: [ME] }), stubPull(OTHER, 3)])
    const p = project('p1', [API, WEB])
    const inbox = reader(gh, [p])

    await inbox.tick()
    const [first] = searches(gh)
    expect(searches(gh)).toHaveLength(1)
    const terms = Object.entries(varsOf(first!))
      .filter(([name]) => name !== 'query')
      .map(([, text]) => text)
    // Two searches in the one call: review requests and every PR that involves the user.
    expect(terms).toHaveLength(2)
    expect(terms.some((text) => text.includes('review-requested:@me'))).toBe(true)
    expect(terms.some((text) => text.includes('involves:@me'))).toBe(true)
    for (const text of terms) {
      expect(text).toContain(`repo:${API}`)
      expect(text).toContain(`repo:${WEB}`)
      expect(text).toContain('is:pr is:open archived:false')
    }
    expect(detailsAsked(gh)).toEqual([[`${API}#1`, `${WEB}#2`]])
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([`${API}#1`, `${WEB}#2`])

    // Five minutes later only #2 moved: only its details are read again.
    gh.set([stubPull(API, 1), stubPull(WEB, 2, { author: ANA, requested: [ME], updatedAt: '2026-11-10T09:03:00Z' }), stubPull(OTHER, 3)])
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(searches(gh)).toHaveLength(2)
    expect(detailsAsked(gh)).toEqual([[`${API}#1`, `${WEB}#2`], [`${WEB}#2`]])
    // The other repository of the same account is never named in any call.
    expect(gh.calls().flat().join(' ')).not.toContain(OTHER)
  })

  it('searches once per 5 minutes, focused or not, and never asks GET /notifications', async () => {
    const gh = world([stubPull(API, 1)])
    const inbox = reader(gh, [project('p1', [API])])
    const at = async (minutes: number) => {
      clock = START + minutes * MINUTE
      await inbox.tick()
      return searches(gh).length
    }
    expect(await at(0)).toBe(1)
    expect(await at(1)).toBe(1)
    expect(await at(4.9)).toBe(1)
    expect(await at(5)).toBe(2)
    expect(await at(9)).toBe(2)
    expect(await at(10)).toBe(3)
    expect(inbox.snapshot('p1').nextSearchAt).toBe(new Date(START + 15 * MINUTE).toISOString())
    expect(gh.calls().flat().some((arg) => arg.includes('notifications'))).toBe(false)
  })

  it('refresh(repo, number) reads the details of that PR at once, outside the search queue', async () => {
    const gh = world([stubPull(API, 1)])
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    gh.set([stubPull(API, 1), stubPull(API, 4, { author: ANA, requested: [ME], updatedAt: '2026-11-10T09:01:00Z' })])
    clock += MINUTE

    await inbox.refresh(API, 4)
    expect(searches(gh)).toHaveLength(1)
    expect(detailsAsked(gh).at(-1)).toEqual([`${API}#4`])
    const needsReview = inbox.snapshot('p1').groups.find((group) => group.group === 'needs-review')!
    expect(needsReview.rows.map((row) => row.number)).toEqual([4])
    // A PR of a repository no Project reads is not read.
    await inbox.refresh(OTHER, 3)
    expect(detailsAsked(gh)).toHaveLength(2)
  })
  it('11 PRs: their details in pages of 10 and 1', async () => {
    const gh = world(Array.from({ length: 11 }, (_, index) => stubPull(API, index + 1)))
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    expect(detailsAsked(gh).map((page) => page.length)).toEqual([10, 1])
    expect(rowsOf(inbox.snapshot('p1'))).toHaveLength(11)
  })

  it('re-reads a cached PR whose CI runs or whose mergeability is unknown, though its updatedAt stays', async () => {
    const settled = quietPull(API, 3, { reviewDecision: 'APPROVED' })
    const gh = world([quietPull(API, 1, { reviewDecision: 'APPROVED', ...rollup('PENDING') }), quietPull(API, 2, { reviewDecision: 'APPROVED', mergeStateStatus: 'UNKNOWN' }), settled])
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    const rowOf = (number: number) => inbox.snapshot('p1').groups.flatMap((group) => group.rows.map((row) => ({ ...row, group: group.group }))).find((row) => row.number === number)
    expect(rowOf(1)?.group).toBe('waiting')

    // CI finished and GitHub worked out the mergeability: updatedAt did not move.
    gh.set([quietPull(API, 1, { reviewDecision: 'APPROVED' }), quietPull(API, 2, { reviewDecision: 'APPROVED' }), settled])
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(detailsAsked(gh).at(-1)).toEqual([`${API}#1`, `${API}#2`])
    expect(rowOf(1)?.group).toBe('ready')
    expect(rowOf(2)?.mergeStateStatus).toBe('CLEAN')

    // Settled now: the next search reads no details.
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(detailsAsked(gh)).toHaveLength(2)
  })

  it('re-reads at most one page of unsettled PRs per search', async () => {
    const gh = world(Array.from({ length: 12 }, (_, index) => quietPull(API, index + 1, rollup('PENDING'))))
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(detailsAsked(gh).map((page) => page.length)).toEqual([10, 2, 10])
  })

  it('a PR no search finds any more leaves the cache: found again, its details are read again', async () => {
    const gh = world([stubPull(API, 1), stubPull(API, 2)])
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    gh.set([stubPull(API, 1)])
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([`${API}#1`])
    gh.set([stubPull(API, 1), stubPull(API, 2)])
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(detailsAsked(gh)).toEqual([[`${API}#1`, `${API}#2`], [`${API}#2`]])
  })

  it('a PR GitHub cannot resolve: the page is read one PR at a time, the others are in the inbox', async () => {
    const gh = world([stubPull(API, 1), stubPull(API, 2, { missing: true }), stubPull(API, 3)])
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    expect(detailsAsked(gh)).toEqual([[`${API}#1`, `${API}#2`, `${API}#3`], [`${API}#1`], [`${API}#2`], [`${API}#3`]])
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([`${API}#1`, `${API}#3`])
    expect(inbox.snapshot('p1').error).toBeNull()

    // Asked alone, it is not an error either, and it stays out.
    await expect(inbox.refresh(API, 2)).resolves.toBeUndefined()
    expect(detailsAsked(gh).at(-1)).toEqual([`${API}#2`])
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([`${API}#1`, `${API}#3`])
    expect(inbox.snapshot('p1').error).toBeNull()
  })

  it('refresh on a Project never read makes no call', async () => {
    const gh = world([stubPull(API, 1)])
    const inbox = reader(gh, [project('p1', [API])])
    await expect(inbox.refresh(API, 1)).resolves.toBeUndefined()
    expect(gh.calls()).toEqual([])
  })

  it('a row: the decision of the latest reviews when GitHub gives none, and the time of the last comment or review', async () => {
    const reviews = { latestOpinionatedReviews: { nodes: [{ author: { login: ANA }, state: 'APPROVED', submittedAt: '2026-11-10T07:45:00Z' }] } }
    const gh = world([stubPull(API, 1, { pull: reviews }), stubPull(API, 2)])
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    const rows = inbox.snapshot('p1').groups.flatMap((group) => group.rows)
    expect(rows.find((row) => row.number === 1)).toMatchObject({ reviewDecision: 'APPROVED', lastActivityAt: '2026-11-10T07:45:00Z' })
    // Ana's last thread comment, not the PR's updatedAt (08:00).
    expect(rows.find((row) => row.number === 2)).toMatchObject({ reviewDecision: null, lastActivityAt: '2026-11-10T07:30:00Z' })
  })
})

describe('the list of Projects', () => {
  it('a Project dropped from the list between two ticks: no search for it, and its PRs leave the cache', async () => {
    const gh = world([stubPull(API, 1), stubPull(WEB, 2)])
    const listed = [project('api', [API]), project('web', [WEB])]
    const projects = [...listed]
    const inbox = reader(gh, projects)
    await inbox.tick()
    expect(searches(gh)).toHaveLength(2)

    projects.splice(1, 1)
    clock += INBOX_SEARCH_INTERVAL_MS
    await inbox.tick()
    expect(searches(gh)).toHaveLength(3)
    expect(searches(gh).at(-1)!.join(' ')).not.toContain(WEB)

    // Back in the list it is a new Project: its PR is not in the cache any more, so its details are read again.
    projects.push(listed[1]!)
    await inbox.tick()
    expect(detailsAsked(gh)).toEqual([[`${API}#1`], [`${WEB}#2`], [`${WEB}#2`]])
  })
})

describe('the timer', () => {
  it('start(ms) ticks every ms; its stop halts it', async () => {
    vi.useFakeTimers()
    try {
      const inbox = reader(world([]), [])
      const tick = vi.spyOn(inbox, 'tick').mockResolvedValue()
      const stop = inbox.start(1000)
      expect(tick).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(3000)
      expect(tick).toHaveBeenCalledTimes(3)
      stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(tick).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('failures and the pace', () => {
  it('a 504 on details asks the same PRs again with half a page; failures in a row double the interval up to 30 minutes', async () => {
    const pulls = Array.from({ length: 10 }, (_, index) => stubPull(API, index + 1))
    const gh = world(pulls, { detailsMax: 4 })
    const inbox = reader(gh, [project('p1', [API])])

    await inbox.tick()
    expect(detailsAsked(gh).map((page) => page.length)).toEqual([10, 5, 3, 2, 5, 3, 2])
    expect(rowsOf(inbox.snapshot('p1'))).toHaveLength(10)
    expect(inbox.snapshot('p1').error).toBeNull()

    writeFileSync(join(gh.dir, 'fail'), 'gh: Bad credentials (HTTP 401)')
    const tries: number[] = []
    for (let minute = 5; minute <= 130; minute += 5) {
      clock = START + minute * MINUTE
      if (minute === 95) rmSync(join(gh.dir, 'fail'))
      // A failing gh fails on `auth token` already: every call counts as a try.
      const before = gh.calls().length
      await inbox.tick()
      if (gh.calls().length > before) tries.push(minute)
    }
    // Fails at 5 (next in 10), 15 (next in 20), 35 (next in 40, kept to 30), 65, 95 — the last one green: back to 5.
    expect(tries).toEqual([5, 15, 35, 65, 95, 100, 105, 110, 115, 120, 125, 130])
    expect(INBOX_MAX_INTERVAL_MS).toBe(30 * MINUTE)
    expect(inbox.snapshot('p1').error).toBeNull()
  })

  it('a 503 asks the same call again', async () => {
    const gh = world([stubPull(API, 1)])
    writeFileSync(join(gh.dir, 'graphql-503'), '1')
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    expect(searches(gh)).toHaveLength(2)
    expect(inbox.snapshot('p1').error).toBeNull()
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([`${API}#1`])
  })

  it('below 10 % of the rate limit no call goes out until resetAt', async () => {
    const reset = new Date(START + 22 * MINUTE).toISOString()
    const gh = world([stubPull(API, 1)], { rateLimit: { limit: 5000, remaining: 400, resetAt: reset } })
    const inbox = reader(gh, [project('p1', [API])])
    await inbox.tick()
    const calls = graphqlCalls(gh).length
    expect(inbox.snapshot('p1').error).toContain(reset)

    clock = START + 5 * MINUTE
    await inbox.tick()
    clock = START + 21 * MINUTE
    await inbox.tick()
    await inbox.refresh(API, 1)
    expect(graphqlCalls(gh)).toHaveLength(calls)

    clock = START + 22 * MINUTE
    await inbox.tick()
    expect(searches(gh)).toHaveLength(2)
  })
})

describe('one read at a time', () => {
  it('the first prInbox.get of several Projects and a tick read them one after another, never two gh calls at once', async () => {
    const gh = world([stubPull(API, 1), stubPull(WEB, 2)])
    let running = 0
    let most = 0
    const run: PrInboxOptions['run'] = async (args, cwd) => {
      running += 1
      most = Math.max(most, running)
      try {
        // A gh that takes a while: two reads side by side would overlap here.
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await gh.run(args, cwd)
      } finally {
        running -= 1
      }
    }
    const projects = [project('a', [API]), project('b', [WEB]), project('c', [API, WEB])]
    const inbox = reader(gh, projects, { run })
    await Promise.all([inbox.ensureRead('a'), inbox.ensureRead('b'), inbox.tick(), inbox.ensureRead('c')])
    expect(most).toBe(1)
    // Each Project was searched once: the tick found b and c read, or read them itself, never both.
    expect(searches(gh)).toHaveLength(3)
    for (const id of ['a', 'b', 'c']) expect(inbox.snapshot(id).readAt).not.toBeNull()
  })

  it('a Project whose switch is off answers at once, without waiting behind the read of another', async () => {
    const gh = world([stubPull(API, 1)])
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const run: PrInboxOptions['run'] = async (args, cwd) => {
      await held
      return gh.run(args, cwd)
    }
    const inbox = reader(gh, [project('a', [API]), project('off', [API], { actionTemplates: {}, prInbox: false })], { run })
    await inbox.ensureRead('off')
    const reading = inbox.ensureRead('a')
    const answer = await Promise.race([inbox.ensureRead('off').then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 50))])
    expect(answer).toBe('answered')
    release()
    await reading
    expect(inbox.snapshot('a').readAt).not.toBeNull()
  })

  it('a failed read does not stop the queue: the next one runs', async () => {
    const gh = world([stubPull(API, 1)])
    let first = true
    const run: PrInboxOptions['run'] = async (args, cwd) => {
      if (first) {
        first = false
        throw new Error('gh: not logged in to github.com')
      }
      return gh.run(args, cwd)
    }
    const inbox = reader(gh, [project('a', [API]), project('b', [API])], { run, account: async () => null })
    await expect(inbox.ensureRead('a')).resolves.toBeUndefined()
    expect(inbox.snapshot('a').error).toContain('not logged in')
    await inbox.ensureRead('b')
    expect(inbox.snapshot('b').readAt).not.toBeNull()
  })
})

describe('one cache per account', () => {
  it('two Projects of one account ask the details of a PR once', async () => {
    const gh = world([stubPull(API, 1), stubPull(API, 2, { author: ANA, requested: [ME] }), stubPull(WEB, 5)])
    const both = project('both', [API, WEB])
    const apiOnly = project('api', [API])
    const inbox = reader(gh, [both, apiOnly])
    await inbox.tick()

    const asked = detailsAsked(gh).flat()
    expect(asked.filter((pr) => pr === `${API}#1`)).toHaveLength(1)
    expect(asked.filter((pr) => pr === `${API}#2`)).toHaveLength(1)
    expect(asked.sort()).toEqual([`${API}#1`, `${API}#2`, `${WEB}#5`])
    expect(searches(gh)).toHaveLength(2)
    expect(rowsOf(inbox.snapshot('api'))).toEqual([`${API}#1`, `${API}#2`])
    expect(rowsOf(inbox.snapshot('both'))).toEqual([`${API}#1`, `${API}#2`, `${WEB}#5`])
  })
})

describe('the switch in settings.json', () => {
  it('prInbox: false — not one gh call for the Project; without the field the Project is read', async () => {
    const gh = world([stubPull(API, 1)])
    const off = project('off', [API], { actionTemplates: {}, prInbox: false })
    const inbox = reader(gh, [off])
    for (let minute = 0; minute <= 30; minute += 5) {
      clock = START + minute * MINUTE
      await inbox.tick()
    }
    await inbox.refresh(API, 1)
    expect(gh.calls()).toEqual([])
    expect(inbox.snapshot('off')).toMatchObject({ enabled: false, nextSearchAt: null })

    const on = project('on', [API], { actionTemplates: {} })
    await reader(gh, [on]).tick()
    expect(searches(gh)).toHaveLength(1)
  })

  it('prInbox: false written after a read: no new gh call on tick or refresh', async () => {
    const gh = world([stubPull(API, 1)])
    const p = project('p1', [API], { actionTemplates: {} })
    const inbox = reader(gh, [p])
    await inbox.tick()
    const calls = gh.calls().length
    expect(calls).toBeGreaterThan(0)

    writeFileSync(join(p.dataDir, 'settings.json'), JSON.stringify({ actionTemplates: {}, prInbox: false }))
    for (let minute = 5; minute <= 30; minute += 5) {
      clock = START + minute * MINUTE
      await inbox.tick()
      await inbox.refresh(API, 1)
    }
    expect(gh.calls()).toHaveLength(calls)
    expect(inbox.snapshot('p1')).toMatchObject({ enabled: false, nextSearchAt: null })
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([])
  })

  it('switched on again: the next prInbox.get reads the Project at once, without waiting for a tick (worfy-pr-inbox ticket 03)', async () => {
    const gh = world([stubPull(API, 1)])
    const p = project('p1', [API], { actionTemplates: {}, prInbox: false })
    const inbox = reader(gh, [p])
    await inbox.ensureRead('p1')
    await inbox.tick()
    expect(gh.calls()).toEqual([])
    expect(inbox.snapshot('p1').enabled).toBe(false)

    writeFileSync(join(p.dataDir, 'settings.json'), JSON.stringify({ actionTemplates: {} }))
    await inbox.ensureRead('p1')
    expect(searches(gh)).toHaveLength(1)
    expect(inbox.snapshot('p1')).toMatchObject({ enabled: true })
    expect(rowsOf(inbox.snapshot('p1'))).toHaveLength(1)
    // Read and on: the next get waits for the search time as before.
    await inbox.ensureRead('p1')
    expect(searches(gh)).toHaveLength(1)
  })

  it('a Project off for want of a repository on GitHub is not looked at again by prInbox.get before its time', async () => {
    const gh = world([stubPull(API, 1)])
    let looks = 0
    const local = project('local', [])
    const inbox = reader(gh, [local], { repos: async () => (looks++, []) })
    await inbox.ensureRead('local')
    await inbox.ensureRead('local')
    expect(looks).toBe(1)
    clock = START + INBOX_SEARCH_INTERVAL_MS
    await inbox.ensureRead('local')
    expect(looks).toBe(2)
    expect(gh.calls()).toEqual([])
  })

  it('a Project without a repository on GitHub is off', async () => {
    const gh = world([stubPull(API, 1)])
    const inbox = reader(gh, [project('local', [])])
    await inbox.tick()
    expect(gh.calls()).toEqual([])
    expect(inbox.snapshot('local').enabled).toBe(false)
  })
})

describe('only reads', () => {
  it('over many reads, refreshes and marks the stand-in logs no write: no --method but GET, no mutation', async () => {
    const gh = world([stubPull(API, 1), stubPull(WEB, 2, { author: ANA, requested: [ME] })])
    const p = project('p1', [API, WEB])
    const inbox = reader(gh, [p])
    for (let cycle = 0; cycle < 6; cycle++) {
      gh.set([stubPull(API, 1, { updatedAt: new Date(START + cycle * MINUTE).toISOString() }), stubPull(WEB, 2, { author: ANA, requested: [ME] })])
      clock = START + cycle * INBOX_SEARCH_INTERVAL_MS
      await inbox.tick()
      await inbox.refresh(WEB, 2)
      inbox.markSeen('p1', API, 1)
    }
    const calls = gh.calls()
    expect(searches(gh)).toHaveLength(6)
    for (const args of calls) {
      const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET'
      expect(method?.toUpperCase(), args.join(' ')).toBe('GET')
      expect(args.some((arg) => /\bmutation\b/u.test(arg)), args.join(' ')).toBe(false)
      // Only the token of the account and GraphQL reads.
      expect(args[0] === 'api' ? args[1] : `${args[0]} ${args[1]}`).toMatch(/^(graphql|auth token)$/u)
    }
  })
})

describe('pr-inbox.json', () => {
  it('after a read and a mark holds only ids, a sha and a time — not one body', async () => {
    const gh = world([stubPull(API, 1)])
    const p = project('p1', [API])
    const inbox = reader(gh, [p])
    await inbox.tick()
    const row = () => inbox.snapshot('p1').groups.flatMap((group) => group.rows)[0]!
    expect(row().newSinceSeen).toBe(2)
    // Reading writes nothing: the file appears with the first mark.
    expect(existsSync(join(p.dataDir, PR_INBOX_FILE))).toBe(false)

    clock += MINUTE
    const after = inbox.markSeen('p1', API, 1)
    expect(after.groups.flatMap((group) => group.rows)[0]!.newSinceSeen).toBe(0)
    const text = readFileSync(join(p.dataDir, PR_INBOX_FILE), 'utf8')
    expect(text).not.toContain('body')
    expect(text).not.toContain(COLLEAGUE_WORDS)
    expect(JSON.parse(text)).toEqual({ pulls: { [`${API}#1`]: { seenAt: new Date(START + MINUTE).toISOString(), seenHeadOid: 'sha-1', lastSeenCommentId: 'C12' } } })
    expect(() => inbox.markSeen('p1', API, 99)).toThrow(/not in the PR inbox/u)
  })
})

/** Every file under `dir` with a hash of its content. */
function treeOf(dir: string): Record<string, string> {
  const tree: Record<string, string> = {}
  const walk = (folder: string, prefix: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`)
      else tree[`${prefix}${name}`] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  walk(dir, '')
  return tree
}

describe('ADR-0005', () => {
  it('writes nothing into the repositories of the Project or the Claude home; only pr-inbox.json in its data folder', async () => {
    const base = tempDir()
    const claudeHome = join(base, 'home', '.claude')
    mkdirSync(claudeHome, { recursive: true })
    writeFileSync(join(claudeHome, 'settings.json'), '{}')
    vi.stubEnv('HOME', join(base, 'home'))
    const repos = [join(base, 'project', 'api'), join(base, 'project', 'web')]
    for (const [index, repo] of repos.entries()) {
      mkdirSync(repo, { recursive: true })
      execFileSync('git', ['init', '-q'], { cwd: repo })
      execFileSync('git', ['remote', 'add', 'origin', index === 0 ? `https://github.com/${API}.git` : `git@github.com:${WEB}.git`], { cwd: repo })
    }
    // A folder whose remote is not on GitHub is left out.
    const local = join(base, 'project', 'local')
    mkdirSync(local)
    execFileSync('git', ['init', '-q'], { cwd: local })
    expect(await remoteRepos([...repos, local])).toEqual([API, WEB])

    const gh = world([stubPull(API, 1), stubPull(WEB, 2, { author: ANA, requested: [ME] })])
    const dataDir = join(base, 'data')
    mkdirSync(dataDir)
    const p: PrInboxProject = { id: 'p1', root: join(base, 'project'), dataDir }
    const before = { project: treeOf(join(base, 'project')), home: treeOf(claudeHome) }
    const inbox = new PrInbox({ run: gh.run, projects: () => [p], enabled: (each) => prInboxSetting(each.dataDir), account: async () => ME, repos: () => remoteRepos(repos), now: () => clock, retryWaitMs: 0 })
    for (let cycle = 0; cycle < 3; cycle++) {
      clock = START + cycle * INBOX_SEARCH_INTERVAL_MS
      await inbox.tick()
      inbox.markSeen('p1', WEB, 2)
    }
    expect(rowsOf(inbox.snapshot('p1'))).toEqual([`${API}#1`, `${WEB}#2`])
    expect({ project: treeOf(join(base, 'project')), home: treeOf(claudeHome) }).toEqual(before)
    expect(readdirSync(dataDir)).toEqual([PR_INBOX_FILE])
  })
})

describe('the prInbox IPC handlers', () => {
  it('prInbox.get answers the snapshot in the contract and reads a Project never read; markSeen answers the new one', async () => {
    const gh = world([stubPull(API, 1)])
    const p = project('p1', [API])
    const changed: string[] = []
    const inbox = reader(gh, [p], { onChange: (id) => void changed.push(id) })
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    await registerIpc(ipc, { modules: { './pr-inbox.ts': async () => prInboxHandlers(() => inbox) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    const call = async (channel: string, input: unknown) => (await handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<PrInboxSnapshot>

    const got = await call('prInbox.get', { projectId: 'p1' })
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(prInboxSnapshotSchema.parse(got.value)).toMatchObject({ projectId: 'p1', enabled: true, viewer: ME, notice: null })
    expect(got.value.groups.map((group) => group.group)).toEqual(['needs-review', 'needs-answer', 'needs-fix', 'ready', 'waiting'])
    expect(searches(gh)).toHaveLength(1)
    // A second get answers the snapshot without a new read.
    await call('prInbox.get', { projectId: 'p1' })
    expect(searches(gh)).toHaveLength(1)
    expect(changed).toEqual(['p1'])

    const seen = await call('prInbox.markSeen', { projectId: 'p1', repo: API, number: 1 })
    expect(seen.ok && seen.value.groups.flatMap((group) => group.rows)[0]!.newSinceSeen).toBe(0)
    expect(changed).toEqual(['p1', 'p1'])
    const unknown = await call('prInbox.markSeen', { projectId: 'p1', repo: API, number: 7 })
    expect(unknown.ok).toBe(false)
  })
})
