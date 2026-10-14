import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GateReader, type Worktree } from '../../src/main/gate/state'
import { accountAuth, ciOf, ghRunner, narrowOf, narrowRoundsOf, parsePrList, PrTracker, verdictOf, type GhRunner } from '../../src/main/github/prs'
import { appPrTracker, checksHandlers, type ChecksScope } from '../../src/main/ipc/checks'
import { fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { pullOfTicket, worktreeOfTicket, type ChecksSnapshot } from '../../src/shared/ipc/checks'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { APP_URL, INDEX_HTML } from '../app-url'

// Pull requests and CI from `gh` (ticket 17), against test/fixtures/gh/gh: a stub that records
// its arguments and answers from a prs.json. Nothing here reaches GitHub.

const GH_STUB = join(import.meta.dirname, '..', 'fixtures', 'gh', 'gh')

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-gh-')))
  temps.push(dir)
  return dir
}

/**
 * The Projects of the tests that are not about which roots `checks.get` takes: every temporary
 * folder, its `project` folder (accountWorld) and `/r`, each a Full-mode Project of one repository.
 */
const anyProject = (): { path: string }[] => [...temps, ...temps.map((dir) => join(dir, 'project')), '/r'].map((path) => ({ path }))
const fullScope: ChecksScope = { layout: async (root) => fullLayout(root), model: async () => null }

interface GhPull {
  number: number
  headRefName: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  url: string
  statusCheckRollup: unknown[]
  comments: { body: string; createdAt?: string; author?: { login: string } }[]
}

const pull = (number: number, headRefName: string, extra: Partial<GhPull> = {}): GhPull => ({
  number,
  headRefName,
  state: 'OPEN',
  url: `https://github.com/o/r/pull/${number}`,
  statusCheckRollup: [],
  comments: [],
  ...extra,
})

/** A stub gh over these PRs; `calls()` are the argument lists it was run with. */
async function stubGh(pulls: GhPull[], env: Record<string, string> = {}) {
  const dir = await tempDir()
  const log = join(dir, 'calls.jsonl')
  await writeFile(join(dir, 'prs.json'), JSON.stringify(pulls))
  const run = ghRunner({ command: GH_STUB, env: async () => ({ ...process.env, GH_STUB_DIR: dir, GH_STUB_LOG: log, ...env }) })
  const calls = async (): Promise<string[][]> =>
    (await readFile(log, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
  return { dir, run, calls }
}

const snapshotOf = (pulls: ChecksSnapshot['pulls']): ChecksSnapshot => ({ root: '/r', worktrees: [], pulls, gh: { available: true, error: null, intervalMs: 60_000 } })

describe('ciOf', () => {
  it.each([
    [[], null],
    [null, null],
    [[{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }], 'passing'],
    [[{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }], 'running'],
    [[{ __typename: 'CheckRun', status: 'QUEUED', conclusion: null }], 'running'],
    [[{ __typename: 'CheckRun', status: 'IN_PROGRESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }], 'failing'],
    [[{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' }], 'failing'],
    [[{ __typename: 'StatusContext', state: 'PENDING' }], 'running'],
    [[{ __typename: 'StatusContext', state: 'ERROR' }], 'failing'],
    [[{ __typename: 'StatusContext', state: 'SUCCESS' }], 'passing'],
  ])('%j → %s', (rollup, expected) => {
    expect(ciOf(rollup as Parameters<typeof ciOf>[0])).toBe(expected)
  })
})

describe('verdictOf', () => {
  it('is the last comment whose first line starts with VERIFIED or REJECTED', () => {
    expect(verdictOf([{ body: 'REJECTED\n- a\n- b' }, { body: 'VERIFIED' }])).toBe('VERIFIED')
    expect(verdictOf([{ body: 'VERIFIED' }, { body: 'REJECTED: 2 findings' }, { body: 'thanks' }])).toBe('REJECTED')
    expect(verdictOf([{ body: '  VERIFIED — all three lenses\nnothing found' }])).toBe('VERIFIED')
    // The English reviewer of the Harness as a plugin (ticket worfy-harness/10): the word, then its round and head.
    expect(verdictOf([{ body: 'VERIFIED (round 1, head abc1234)\nAll three lenses clean.' }])).toBe('VERIFIED')
    expect(verdictOf([{ body: 'REJECTED (round 1, head abc1234)\n- src/a.ts:1 — x' }, { body: 'VERIFIED (round 2, head def5678)' }])).toBe('VERIFIED')
  })

  it('reads the narrow round’s verdicts (worfy-harness ticket 20): NARROW: VERIFIED and NARROW: REJECTED count, NARROW: <findings> does not', () => {
    expect(verdictOf([{ body: 'REJECTED: 2 findings' }, { body: 'REJECTED: 1 finding' }, { body: 'NARROW: VERIFIED' }])).toBe('VERIFIED')
    expect(verdictOf([{ body: 'REJECTED: 1 finding' }, { body: 'NARROW: [med] src/a.ts:1 — x' }, { body: 'NARROW: REJECTED: src/a.ts:1 still open' }])).toBe('REJECTED')
    expect(verdictOf([{ body: 'VERIFIED' }, { body: 'NARROW: [med] src/a.ts:1 — x' }])).toBe('VERIFIED')
    expect(verdictOf([{ body: 'NARROW: VERIFIEDX' }])).toBeNull()
    expect(verdictOf([{ body: 'see NARROW: VERIFIED' }])).toBeNull()
  })

  it('does not take the word anywhere but at the start of the first line', () => {
    expect(verdictOf([{ body: 'Looks fine\nVERIFIED' }])).toBeNull()
    expect(verdictOf([{ body: 'not VERIFIED yet' }])).toBeNull()
    expect(verdictOf([{ body: 'VERIFIEDX' }])).toBeNull()
    expect(verdictOf([])).toBeNull()
    expect(verdictOf(null)).toBeNull()
  })
})

describe('narrowOf (worfy-harness ticket 20)', () => {
  it('is the last state of the narrow round: NARROW: <findings> started, then NARROW: VERIFIED or NARROW: REJECTED', () => {
    const started = { body: 'NARROW: [med] src/a.ts:1 — x; [low] src/b.ts:2 — y\nsceptics: 2 of 3 stood' }
    expect(narrowOf([{ body: 'REJECTED: 3 findings' }, started])).toEqual({ outcome: 'started', text: 'NARROW: [med] src/a.ts:1 — x; [low] src/b.ts:2 — y', at: null })
    expect(narrowOf([started, { body: 'NARROW: VERIFIED' }])).toEqual({ outcome: 'verified', text: 'NARROW: VERIFIED', at: null })
    expect(narrowOf([started, { body: '  NARROW: REJECTED: src/a.ts:1 still open\n- details' }, { body: 'thanks' }])).toEqual({ outcome: 'rejected', text: 'NARROW: REJECTED: src/a.ts:1 still open', at: null })
  })

  it('is null without a NARROW: comment, and takes the prefix only at the start of the first line', () => {
    expect(narrowOf([{ body: 'REJECTED: 1 finding' }, { body: 'VERIFIED' }])).toBeNull()
    expect(narrowOf([{ body: 'see NARROW: VERIFIED' }, { body: 'notes\nNARROW: REJECTED' }, { body: 'NARROWED: x' }])).toBeNull()
    expect(narrowOf([])).toBeNull()
    expect(narrowOf(null)).toBeNull()
  })

  it('keeps the first line as the journal keeps the last answer: at most 1000 characters', () => {
    expect(narrowOf([{ body: `NARROW: ${'x'.repeat(2000)}` }])?.text).toHaveLength(1000)
  })

  it('narrowRoundsOf: every state of the narrow rounds, oldest first; parsePrList keeps them on the PR only when there are any', () => {
    const comments = [
      { body: 'REJECTED: 1', createdAt: '2026-10-08T01:00:00Z' },
      { body: 'NARROW: [med] x', createdAt: '2026-10-08T02:00:00Z' },
      { body: 'NARROW: REJECTED: x', createdAt: '2026-10-08T03:00:00Z' },
    ]
    // Each state carries the comment's createdAt: the run tells its own round from an earlier one by it.
    expect(narrowRoundsOf(comments)).toEqual([
      { outcome: 'started', text: 'NARROW: [med] x', at: '2026-10-08T02:00:00Z' },
      { outcome: 'rejected', text: 'NARROW: REJECTED: x', at: '2026-10-08T03:00:00Z' },
    ])
    const [withNarrow, without] = parsePrList(JSON.stringify([pull(7, 'demo/07', { comments }), pull(8, 'demo/08', { comments: [{ body: 'VERIFIED' }] })]))
    expect(withNarrow).toMatchObject({ number: 7, verdict: 'REJECTED', narrow: narrowRoundsOf(comments) })
    expect(without).not.toHaveProperty('narrow')
  })
})

describe('parsePrList', () => {
  it('keeps only the fields of the contract and drops entries that are not PRs', () => {
    const parsed = parsePrList(JSON.stringify([pull(3, 'demo/03', { extra: 'x' } as Partial<GhPull>), { number: 'four' }, null, pull(5, 'demo/05', { state: 'MERGED' })]))
    expect(parsed).toEqual([
      { number: 3, url: 'https://github.com/o/r/pull/3', state: 'OPEN', branch: 'demo/03', ci: null, verdict: null },
      { number: 5, url: 'https://github.com/o/r/pull/5', state: 'MERGED', branch: 'demo/05', ci: null, verdict: null },
    ])
  })

  it('refuses an answer that is not a JSON list', () => {
    expect(() => parsePrList('{"number":1}')).toThrow()
    expect(() => parsePrList('not json')).toThrow()
  })
})

describe('pullOfTicket', () => {
  const pr = (number: number, branch: string, state: 'OPEN' | 'CLOSED' | 'MERGED') => ({ number, url: `u/${number}`, state, branch, ci: null, verdict: null })

  it('takes an open PR of the Ticket’s branches first, then a merged one, newer before older', () => {
    const pulls = [pr(20, 'demo/07', 'MERGED'), pr(30, 'demo/07', 'CLOSED'), pr(22, 'demo/07-retry', 'MERGED'), pr(25, 'demo/07', 'OPEN'), pr(40, 'demo/08', 'OPEN')]
    expect(pullOfTicket(snapshotOf(pulls), { epic: 'demo', num: 7 })?.number).toBe(25)
    expect(pullOfTicket(snapshotOf(pulls.filter((each) => each.number !== 25)), { epic: 'demo', num: 7 })?.number).toBe(22)
    expect(pullOfTicket(snapshotOf([pr(30, 'demo/07', 'CLOSED'), pr(31, 'other/07', 'OPEN')]), { epic: 'demo', num: 7 })?.number).toBe(30)
  })
})

describe('PrTracker over the gh stub', () => {
  it('a PR on worfy-mvp/08 with CI running and a VERIFIED comment gives «PR #N», `running` and VERIFIED on Ticket 08', async () => {
    const gh = await stubGh([
      pull(31, 'worfy-mvp/08', {
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' },
        ],
        comments: [
          { body: 'REJECTED\n- correctness: x', author: { login: 'r' } },
          { body: 'VERIFIED\nall lenses clean', author: { login: 'r' } },
        ],
      }),
      pull(30, 'worfy-mvp/07', { state: 'MERGED' }),
    ])
    const read = await new PrTracker({ run: gh.run }).read(gh.dir, [])
    expect(read.gh).toEqual({ available: true, error: null, intervalMs: 60_000 })
    expect(pullOfTicket(snapshotOf(read.pulls), { epic: 'worfy-mvp', num: 8 })).toEqual({
      number: 31,
      url: 'https://github.com/o/r/pull/31',
      state: 'OPEN',
      branch: 'worfy-mvp/08',
      ci: 'running',
      verdict: 'VERIFIED',
    })
    expect(await gh.calls()).toEqual([['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,headRefName,state,url,statusCheckRollup,comments']])
  })

  it('with 150 PRs, finds the PR of a branch outside the first 100 with --head <branch>, once per 5 minutes', async () => {
    const pulls = Array.from({ length: 150 }, (_, index) => pull(150 - index, `other/${150 - index}`))
    // A newer PR on a branch that only starts like worfy-mvp/08: GitHub's `head:` search matches
    // it by prefix, and with `--limit 1` it would hide the PR of worfy-mvp/08 itself.
    pulls[110] = pull(40, 'worfy-mvp/08-fix')
    pulls[120] = pull(30, 'worfy-mvp/08', { comments: [{ body: 'VERIFIED' }] })
    const gh = await stubGh(pulls)
    let now = 0
    const tracker = new PrTracker({ run: gh.run, now: () => now })

    const first = await tracker.read(gh.dir, ['worfy-mvp/08', 'worfy-mvp/09'])
    expect(first.pulls).toHaveLength(101)
    expect(pullOfTicket(snapshotOf(first.pulls), { epic: 'worfy-mvp', num: 8 })).toMatchObject({ number: 30, verdict: 'VERIFIED' })
    const search = (branch: string) => ['pr', 'list', '--state', 'all', '--head', branch, '--limit', '1', '--json', 'number,headRefName,state,url,statusCheckRollup,comments']
    expect((await gh.calls()).slice(1)).toEqual([search('worfy-mvp/08'), search('worfy-mvp/09')])

    now = 60_000
    await tracker.read(gh.dir, ['worfy-mvp/08', 'worfy-mvp/09'])
    expect(await gh.calls()).toHaveLength(4) // the list again; no search before 5 minutes

    now = 5 * 60_000
    const later = await tracker.read(gh.dir, ['worfy-mvp/08', 'worfy-mvp/09'])
    expect((await gh.calls()).slice(4)).toEqual([(await gh.calls())[0], search('worfy-mvp/08'), search('worfy-mvp/09')])
    expect(pullOfTicket(snapshotOf(later.pulls), { epic: 'worfy-mvp', num: 8 })?.number).toBe(30)

    // A branch the renderer no longer asks about is not shown from an old search.
    const dropped = await tracker.read(gh.dir, [])
    expect(pullOfTicket(snapshotOf(dropped.pulls), { epic: 'worfy-mvp', num: 8 })).toBeNull()
  })

  it('starts at most 10 branch lookups in one read; the rest wait for the next read', async () => {
    const gh = await stubGh([pull(1, 'demo/01')])
    const tracker = new PrTracker({ run: gh.run, now: () => 0 })
    const branches = Array.from({ length: 12 }, (_, index) => `demo/${String(index + 10)}`)
    await tracker.read(gh.dir, branches)
    const lookups = async () => (await gh.calls()).filter((args) => args.includes('--head')).map((args) => args[args.indexOf('--head') + 1])
    expect(await lookups()).toEqual(branches.slice(0, 10))
    await tracker.read(gh.dir, branches)
    expect(await lookups()).toEqual(branches)
  })

  it('a failing branch lookup after a good list is «gh unavailable» and doubles the interval', async () => {
    const gh = await stubGh([pull(1, 'demo/01')])
    let now = 0
    let count = 0
    const run: GhRunner = (args, cwd) => {
      count += 1
      return args.includes('--head') ? Promise.reject(new Error('API rate limit exceeded')) : gh.run(args, cwd)
    }
    const tracker = new PrTracker({ run, now: () => now })
    const first = await tracker.read(gh.dir, ['demo/02', 'demo/03'])
    expect(first).toEqual({ pulls: [], gh: { available: false, error: 'API rate limit exceeded', intervalMs: 120_000 } })
    expect(count).toBe(2) // the list, then one lookup; the second is not tried after a failure

    now = 119_999
    expect((await tracker.read(gh.dir, ['demo/02', 'demo/03'])).gh.available).toBe(false)
    expect(count).toBe(2)
  })

  it('a branch lookup failing between two lists starts the doubled interval at the failure, not at the last list', async () => {
    const gh = await stubGh([pull(1, 'demo/01')])
    let now = 0
    let lists = 0
    const run: GhRunner = (args, cwd) => {
      if (args.includes('--head')) return Promise.reject(new Error('API rate limit exceeded'))
      lists += 1
      return gh.run(args, cwd)
    }
    const tracker = new PrTracker({ run, now: () => now })
    await tracker.read(gh.dir, [])
    expect(lists).toBe(1)

    now = 30_000 // within the list interval: no list, the lookup runs and fails
    expect((await tracker.read(gh.dir, ['demo/02'])).gh).toEqual({ available: false, error: 'API rate limit exceeded', intervalMs: 120_000 })

    now = 30_000 + 119_999 // 120 s after the last list, but not after the failure
    await tracker.read(gh.dir, ['demo/02'])
    expect(lists).toBe(1)
    now = 30_000 + 120_000
    await tracker.read(gh.dir, [])
    expect(lists).toBe(2)
  })

  it('runs gh at most once per interval, however often it is asked, and one read at a time', async () => {
    const gh = await stubGh([pull(1, 'demo/01')])
    let now = 0
    const tracker = new PrTracker({ run: gh.run, now: () => now })
    await Promise.all([tracker.read(gh.dir, []), tracker.read(gh.dir, [])])
    now = 59_999
    await tracker.read(gh.dir, [])
    expect(await gh.calls()).toHaveLength(1)
    now = 60_000
    await tracker.read(gh.dir, [])
    expect(await gh.calls()).toHaveLength(2)
  })

  it('gh missing → «gh unavailable», no PRs, the interval doubles and gh is not run in between', async () => {
    const root = await tempDir()
    let count = 0
    const missing = ghRunner({ command: '/nonexistent/worfy/gh' })
    const run: GhRunner = (args, cwd) => {
      count += 1
      return missing(args, cwd)
    }
    let now = 0
    const tracker = new PrTracker({ run, now: () => now })

    const first = await tracker.read(root, ['demo/01'])
    expect(first).toEqual({ pulls: [], gh: { available: false, error: 'gh not found (/nonexistent/worfy/gh)', intervalMs: 120_000 } })
    expect(count).toBe(1) // no branch search while gh fails

    now = 60_000
    expect((await tracker.read(root, ['demo/01'])).gh.intervalMs).toBe(120_000)
    expect(count).toBe(1)

    now = 120_000
    expect((await tracker.read(root, ['demo/01'])).gh.intervalMs).toBe(240_000)
    expect(count).toBe(2)

    now = 360_000
    expect((await tracker.read(root, [])).gh.intervalMs).toBe(480_000)
    expect(count).toBe(3)
  })

  it('a failing gh (not logged in) is one short error, and the first success brings the interval back', async () => {
    const failing = await stubGh([pull(1, 'demo/01')], { GH_STUB_FAIL: 'To get started with GitHub CLI, please run:  gh auth login\nmore text' })
    let now = 0
    let run = failing.run
    const tracker = new PrTracker({ run: (args, cwd) => run(args, cwd), now: () => now })
    expect((await tracker.read(failing.dir, [])).gh).toEqual({ available: false, error: 'To get started with GitHub CLI, please run:  gh auth login', intervalMs: 120_000 })

    run = (await stubGh([pull(1, 'demo/01')])).run
    now = 120_000
    const back = await tracker.read(failing.dir, [])
    expect(back.gh).toEqual({ available: true, error: null, intervalMs: 60_000 })
    expect(back.pulls.map((each) => each.number)).toEqual([1])
  })

  it('caps the interval', async () => {
    let now = 0
    const tracker = new PrTracker({ run: () => Promise.reject(new Error('no network')), now: () => now, maxIntervalMs: 200_000 })
    for (let index = 0; index < 5; index += 1) {
      await tracker.read('/r', [])
      now += 10 * 60_000
    }
    expect((await tracker.read('/r', [])).gh.intervalMs).toBe(200_000)
  })

  it('runs no gh command but `pr list`', async () => {
    const gh = await stubGh([pull(1, 'demo/01')])
    let now = 0
    const tracker = new PrTracker({ run: gh.run, now: () => now })
    for (let index = 0; index < 3; index += 1) {
      await tracker.read(gh.dir, ['demo/02', 'demo/03'])
      now += 6 * 60_000
    }
    const calls = await gh.calls()
    expect(calls.length).toBeGreaterThan(3)
    for (const args of calls) expect(args.slice(0, 2)).toEqual(['pr', 'list'])
  })
})

// ── the IPC boundary ─────────────────────────────────────────────────────────

async function ipcOver(run: GhRunner, home: string, worktrees: (root: string) => Worktree[] = (root) => [{ path: root, branch: 'main' }]) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const module = checksHandlers({ gate: new GateReader({ home }), prs: new PrTracker({ run }), worktrees: async (root) => worktrees(root) }, anyProject, fullScope)
  await registerIpc(ipc, { modules: { './checks.ts': async () => module }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  return async (input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!
    return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

describe('checks.get', () => {
  // The schema refuses all but one; `main` has the shape of a branch, and the handler refuses it.
  const INVALID = /checks\.get: invalid input/
  it.each([
    [undefined, INVALID],
    [{ root: 'relative', branches: [] }, INVALID],
    [{ root: '/r' }, INVALID],
    [{ root: '/r', branches: 'demo/01' }, INVALID],
    [{ root: '/r', branches: ['main'] }, /main is not the branch of a Ticket of this Project/],
    [{ root: '/r', branches: ['--repo=evil/x'] }, INVALID],
    [{ root: '/r', branches: ['demo/01 --web'] }, INVALID],
    [{ root: '/r', branches: [42] }, INVALID],
  ])('refuses %j without running gh', async (input, reason) => {
    let count = 0
    const call = await ipcOver(() => {
      count += 1
      return Promise.resolve('[]')
    }, await tempDir())
    const result = await call(input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(reason)
    expect(count).toBe(0)
  })

  it('answers the parsed snapshot: extra keys of the input and of gh’s answer do not get through', async () => {
    const home = await tempDir()
    const root = await tempDir()
    await mkdir(join(home, 'gate', 'state'), { recursive: true })
    const seen: string[][] = []
    const call = await ipcOver((args) => {
      seen.push([...args])
      return Promise.resolve(JSON.stringify([{ ...pull(7, 'demo/07'), secret: 'token', author: { login: 'x' } }]))
    }, home)
    const result = await call({ root, branches: ['demo/07'], extra: 'dropped' })
    expect(result).toEqual({
      ok: true,
      value: {
        root,
        worktrees: [{ path: root, branch: 'main', gate: { outcome: 'none', source: 'none', at: null } }],
        pulls: [{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', branch: 'demo/07', ci: null, verdict: null }],
        gh: { available: true, error: null, intervalMs: 60_000 },
      },
    })
    expect(seen).toHaveLength(1)
  })

  it('looks up the PR of a worktree’s Ticket branch itself, though the renderer did not ask for it', async () => {
    const home = await tempDir()
    const root = await tempDir()
    const worktree07 = join(root, '.claude', 'worktrees', '07')
    const seen: string[][] = []
    const call = await ipcOver(
      (args) => {
        seen.push([...args])
        // demo/07 is not among the listed PRs; only a lookup of that branch finds it.
        return Promise.resolve(JSON.stringify(args.includes('--head') && args[args.indexOf('--head') + 1] === 'demo/07' ? [pull(7, 'demo/07')] : [pull(1, 'other/01')]))
      },
      home,
      (each) => [
        { path: each, branch: 'main' },
        { path: worktree07, branch: 'demo/07' },
        { path: join(each, '.claude', 'worktrees', 'scratch'), branch: 'feature-x' },
      ],
    )
    const result = (await call({ root, branches: [] })) as IpcResult<ChecksSnapshot>
    expect(seen.map((args) => (args.includes('--head') ? args[args.indexOf('--head') + 1] : 'list'))).toEqual(['list', 'demo/07'])
    expect(result.ok && pullOfTicket(result.value, { epic: 'demo', num: 7 })?.number).toBe(7)
  })

  it('drops keys a handler adds beyond the contract', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    const leaky = checksHandlers({
      gate: { read: async (_root: string, worktrees: { path: string; branch: string | null }[]) => worktrees.map((each) => ({ ...each, gate: { outcome: 'green', source: 'marker', at: null, file: '/secret' } })) } as unknown as GateReader,
      prs: { read: async () => ({ pulls: [], gh: { available: true, error: null, intervalMs: 60_000, token: 't' } }) } as unknown as PrTracker,
      worktrees: async (root) => [{ path: root, branch: 'main', head: 'abc' } as { path: string; branch: string }],
    }, anyProject, fullScope)
    await registerIpc(ipc, { modules: { './checks.ts': async () => leaky }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    const result = (await handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, { root: '/r', branches: [] })) as IpcResult<ChecksSnapshot>
    expect(result).toEqual({
      ok: true,
      value: { root: '/r', worktrees: [{ path: '/r', branch: 'main', gate: { outcome: 'green', source: 'marker', at: null } }], pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } },
    })
  })
})

// ── the Project's GitHub account (worfy-week ticket 01, ADR-0020) ────────────
//
// gh runs with GH_TOKEN of the account the Project's Profile names (`github.account`), taken with
// `gh auth token -u <account>`; the global gh account is never switched. Here `bin/profile` and
// `gh` are shell stubs in a temporary folder: the gh stub records GH_TOKEN and its arguments, and
// knows one logged-in account.

const ACCOUNT = 'IDSAD-XL'
const TOKEN = 'gho_TestToken0123456789abcdef'
const LIST = ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,headRefName,state,url,statusCheckRollup,comments']
const lookup = (branch: string) => ['pr', 'list', '--state', 'all', '--head', branch, '--limit', '1', '--json', 'number,headRefName,state,url,statusCheckRollup,comments']

/** A gh that logs `<GH_TOKEN or <unset>>\t<arg>\t<arg>…` and is logged in only as GH_STUB_ACCOUNT, when GH_STUB_TOKEN is set. */
const GH_ACCOUNT_STUB = `#!/bin/sh
{ printf '%s' "\${GH_TOKEN-<unset>}"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$GH_STUB_LOG"
if [ "$1" = auth ] && [ "$2" = token ]; then
  if [ "$3" = -u ] && [ "$4" = "$GH_STUB_ACCOUNT" ] && [ -n "$GH_STUB_TOKEN" ]; then printf '%s\\n' "$GH_STUB_TOKEN"; exit 0; fi
  printf 'no oauth token found for github.com account %s\\n' "$4" >&2
  exit 1
fi
if [ "$1" = pr ] && [ "$2" = list ]; then
  if [ -n "$GH_STUB_LIST_EXIT" ]; then printf '%s' "$GH_STUB_LIST_STDERR" >&2; exit "$GH_STUB_LIST_EXIT"; fi
  cat "$GH_STUB_DIR/prs.json"
  exit 0
fi
printf 'gh stub: unsupported command: %s\\n' "$*" >&2
exit 2
`

interface GhCall {
  /** GH_TOKEN as gh saw it; null when it was not set. */
  token: string | null
  args: string[]
}

type ProfileAnswer = { code: number; stdout?: string; stderr?: string } | 'no script'

/** A Project, a Claude home whose bin/profile gives `profile`, and the gh stub; `gh.shellToken` is a GH_TOKEN of the login shell itself. */
async function accountWorld(profile: ProfileAnswer, gh: { token?: string; shellToken?: string } = {}) {
  const dir = await tempDir()
  const root = join(dir, 'project')
  const home = join(dir, 'claude-home')
  await mkdir(root)
  await mkdir(join(home, 'bin'), { recursive: true })
  const profileLog = join(dir, 'profile-calls.txt')
  if (profile !== 'no script') {
    const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> '${profileLog}'\nprintf '%s' '${profile.stdout ?? ''}'\nprintf '%s' '${profile.stderr ?? ''}' >&2\nexit ${profile.code}\n`
    await writeFile(join(home, 'bin', 'profile'), script, { mode: 0o755 })
  }
  const command = join(dir, 'gh')
  await writeFile(command, GH_ACCOUNT_STUB, { mode: 0o755 })
  await writeFile(join(dir, 'prs.json'), JSON.stringify([pull(1, 'demo/01')]))
  const ghLog = join(dir, 'gh-calls.txt')
  const env: Record<string, string> = { PATH: '/usr/bin:/bin', HOME: dir, GH_STUB_LOG: ghLog, GH_STUB_DIR: dir, GH_STUB_ACCOUNT: ACCOUNT }
  if (gh.token !== undefined) env.GH_STUB_TOKEN = gh.token
  if (gh.shellToken !== undefined) env.GH_TOKEN = gh.shellToken
  const logged: string[] = []
  const calls = async (): Promise<GhCall[]> =>
    (await readFile(ghLog, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [token = '', ...args] = line.split('\t')
        return { token: token === '<unset>' ? null : token, args }
      })
  const profileCalls = async (): Promise<string[]> => (await readFile(profileLog, 'utf8').catch(() => '')).split('\n').filter(Boolean)
  const tracker = (now: () => number = () => 0) =>
    appPrTracker({ claudeHome: home, command, env: () => Promise.resolve({ ...env }), log: (message) => void logged.push(message), now })
  return { dir, root, home, command, env, logged, calls, profileCalls, tracker }
}

describe("gh with the Project's GitHub account", () => {
  it('every gh pr list of a Project whose Profile names an account goes with GH_TOKEN from `gh auth token -u <account>`', async () => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` }, { token: TOKEN })
    const read = await world.tracker().read(world.root, ['demo/02'])
    expect(read.gh).toEqual({ available: true, error: null, intervalMs: 60_000 })
    expect(read.pulls.map((each) => each.number)).toEqual([1])

    const calls = await world.calls()
    const lists = calls.filter((call) => call.args[0] === 'pr')
    expect(lists.map((call) => call.args)).toEqual([LIST, lookup('demo/02')])
    for (const call of lists) expect(call.token).toBe(TOKEN)
    // The token is asked of gh for the Profile's account, before any pr list, with no token of worfy's own.
    expect(calls[0]).toEqual({ token: null, args: ['auth', 'token', '-u', ACCOUNT] })
    expect(await world.profileCalls()).toEqual([`-C ${world.root} --field github.account`])
    expect(world.logged).toEqual([])
  })

  it('gh sees from worfy only `auth token -u <account>` and `pr list`, read after read', async () => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` }, { token: TOKEN })
    let now = 0
    const tracker = world.tracker(() => now)
    for (let index = 0; index < 3; index += 1) {
      await tracker.read(world.root, ['demo/02', 'demo/03'])
      now += 6 * 60_000
    }
    const calls = await world.calls()
    expect(calls.filter((call) => call.args[0] === 'pr')).toHaveLength(9)
    for (const call of calls) {
      if (call.args[0] === 'pr') {
        expect(call.args.slice(0, 2)).toEqual(['pr', 'list'])
        expect(call.token).toBe(TOKEN)
      } else {
        expect(call.args).toEqual(['auth', 'token', '-u', ACCOUNT])
      }
    }
    // One token per read that runs gh, not one per gh call.
    expect(calls.filter((call) => call.args[0] === 'auth')).toHaveLength(3)
  })

  it.each<[string, ProfileAnswer, RegExp]>([
    ['exit code 3 (no registered project)', { code: 3, stderr: 'profile: not in a registered project' }, /no registered project.*exit code 3/],
    ['exit code 4 (no such field)', { code: 4, stderr: 'profile: field "github.account" is absent' }, /no github\.account field \(profile exit code 4\)/],
    ['a field that is null', { code: 0, stdout: 'null\n' }, /github\.account is null/],
    ['no script', 'no script', /no profile script at /],
    ['a failing script', { code: 1, stderr: 'registry is broken' }, /failed with exit code 1: registry is broken/],
  ])('no account (%s): gh runs as before, without a GH_TOKEN of worfy, and the reason is one log line', async (_case, profile, reason) => {
    const world = await accountWorld(profile, { token: TOKEN })
    let now = 0
    const tracker = world.tracker(() => now)
    const read = await tracker.read(world.root, ['demo/02'])
    expect(read.gh.available).toBe(true)
    expect(await world.calls()).toEqual([
      { token: null, args: LIST },
      { token: null, args: lookup('demo/02') },
    ])
    expect(world.logged).toHaveLength(1)
    expect(world.logged[0]).toMatch(new RegExp(`^\\[profile\\] GitHub account for ${world.root}: none, gh runs with the login shell's own account, because `))
    expect(world.logged[0]).toMatch(reason)

    // The next read logs the same reason again only if it changed.
    now = 60_000
    await tracker.read(world.root, [])
    expect(world.logged).toHaveLength(1)
  })

  it("no account: the login shell's own GH_TOKEN reaches gh untouched", async () => {
    const world = await accountWorld({ code: 4 }, { token: TOKEN, shellToken: 'shell-token' })
    await world.tracker().read(world.root, [])
    expect(await world.calls()).toEqual([{ token: 'shell-token', args: LIST }])
  })

  it("an account replaces the login shell's own GH_TOKEN for pr list", async () => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` }, { token: TOKEN, shellToken: 'shell-token' })
    await world.tracker().read(world.root, [])
    expect((await world.calls()).filter((call) => call.args[0] === 'pr')).toEqual([{ token: TOKEN, args: LIST }])
  })

  it('an account gh has no login for: «gh unavailable» naming the account and gh auth login, and no pr list from the global account', async () => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` })
    let now = 0
    const tracker = world.tracker(() => now)
    const read = await tracker.read(world.root, ['demo/02'])
    expect(read.pulls).toEqual([])
    expect(read.gh.available).toBe(false)
    expect(read.gh.intervalMs).toBe(120_000)
    expect(read.gh.error).toContain(ACCOUNT)
    expect(read.gh.error).toContain('gh auth login')
    expect(await world.calls()).toEqual([{ token: null, args: ['auth', 'token', '-u', ACCOUNT] }])

    // The doubled interval holds for the token too: nothing runs before it passes.
    now = 119_999
    await tracker.read(world.root, ['demo/02'])
    expect(await world.calls()).toHaveLength(1)
    now = 120_000
    await tracker.read(world.root, ['demo/02'])
    expect((await world.calls()).map((call) => call.args[0])).toEqual(['auth', 'auth'])
  })

  it.each([
    ['nothing', ''],
    ['two words', `${TOKEN} more`],
  ])('`gh auth token -u` that prints %s: no token, and the output is not quoted in the reason', async (_case, printed) => {
    const asked: string[][] = []
    const auth = accountAuth({ account: () => Promise.resolve(ACCOUNT), run: (args) => (asked.push([...args]), Promise.resolve(`${printed}\n`)) })
    const refusal = await auth('/r').then(
      () => null,
      (error: unknown) => (error as Error).message,
    )
    expect(asked).toEqual([['auth', 'token', '-u', ACCOUNT]])
    expect(refusal).toBe(`gh auth token -u ${ACCOUNT} printed no token; run \`gh auth login\` and sign in as ${ACCOUNT}`)
  })

  it('no account: no gh call for a token and no environment added', async () => {
    let count = 0
    const auth = accountAuth({ account: () => Promise.resolve(null), run: () => ((count += 1), Promise.resolve(TOKEN)) })
    expect(await auth('/r')).toEqual({})
    expect(count).toBe(0)
  })

  it('an account name that is not a GitHub login is not passed to gh', async () => {
    const world = await accountWorld({ code: 0, stdout: '--hostname\n' }, { token: TOKEN })
    const read = await world.tracker().read(world.root, [])
    expect(read.gh.available).toBe(true)
    expect(await world.calls()).toEqual([{ token: null, args: LIST }])
    expect(world.logged[0]).toMatch(/github\.account is not a GitHub login: "--hostname"/)
  })

  it('the token is in neither the checks snapshot nor the log, also when pr list fails', async () => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` }, { token: TOKEN })
    const home = await tempDir()
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    const module = checksHandlers({ gate: new GateReader({ home }), prs: world.tracker(), worktrees: async (root) => [{ path: root, branch: 'demo/01' }] }, anyProject, fullScope)
    await registerIpc(ipc, { modules: { './checks.ts': async () => module }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    const call = (input: unknown) => handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)
    const good = (await call({ root: world.root, branches: ['demo/02'] })) as IpcResult<ChecksSnapshot>
    expect(good.ok && good.value.pulls.map((each) => each.number)).toEqual([1])
    expect(JSON.stringify(good)).not.toContain(TOKEN)

    // pr list fails: its error is in the snapshot, the token is not.
    await writeFile(join(world.dir, 'prs.json'), 'not json')
    const failing = appPrTracker({ claudeHome: world.home, command: world.command, env: () => Promise.resolve({ ...world.env }), log: (message) => void world.logged.push(message) })
    const read = await failing.read(world.root, [])
    expect(read.gh.available).toBe(false)
    expect(JSON.stringify(read)).not.toContain(TOKEN)
    expect(world.logged.join('\n')).not.toContain(TOKEN)
  })

  it.each([
    ['with a reason in stderr', 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n', /^HTTP 401: Bad credentials \(https:\/\/api\.github\.com\/graphql\)$/],
    ['with an empty stderr', '', /^Command failed: /],
  ])('gh pr list refused by gh %s: the checks snapshot has gh’s reason, not the token', async (_case, stderr, reason) => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` }, { token: TOKEN })
    world.env.GH_STUB_LIST_EXIT = '1'
    world.env.GH_STUB_LIST_STDERR = stderr
    const home = await tempDir()
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    const module = checksHandlers({ gate: new GateReader({ home }), prs: world.tracker(), worktrees: async (root) => [{ path: root, branch: 'demo/01' }] }, anyProject, fullScope)
    await registerIpc(ipc, { modules: { './checks.ts': async () => module }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    const result = (await handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, { root: world.root, branches: [] })) as IpcResult<ChecksSnapshot>
    expect(result.ok).toBe(true)
    const gh = result.ok ? result.value.gh : null
    expect(gh?.available).toBe(false)
    expect(gh?.error).toMatch(reason)
    // The refusal came from pr list itself, run with the account's token.
    expect((await world.calls()).filter((call) => call.args[0] === 'pr')).toEqual([{ token: TOKEN, args: LIST }])
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(world.logged.join('\n')).not.toContain(TOKEN)
  })

  it("the app's own checks handler reads the account with <WORFY_CLAUDE_HOME>/bin/profile and runs WORFY_GH with its token; nothing reaches the console", async () => {
    const world = await accountWorld({ code: 0, stdout: `${ACCOUNT}\n` }, { token: TOKEN })
    for (const [name, value] of Object.entries(world.env)) if (name !== 'PATH' && name !== 'HOME') vi.stubEnv(name, value)
    vi.stubEnv('WORFY_GH', world.command)
    vi.stubEnv('WORFY_CLAUDE_HOME', world.home)
    // The app's handler takes only a Project root or one of its repositories: world.root is the one Project.
    const data = await tempDir()
    await writeFile(join(data, 'projects.json'), JSON.stringify({ projects: [{ id: 'project-00000001', name: 'project', path: world.root }], activeId: null }))
    vi.stubEnv('WORFY_DATA_DIR', data)
    const printed: string[] = []
    const spies = (['log', 'warn', 'error', 'info'] as const).map((method) => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(' '))))
    try {
      vi.resetModules()
      const app = (await import('../../src/main/ipc/checks')).default
      const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
      const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
      await registerIpc(ipc, { modules: { './checks.ts': async () => app }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
      const result = (await handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, { root: world.root, branches: [] })) as IpcResult<ChecksSnapshot>
      expect(result.ok && result.value.gh).toEqual({ available: true, error: null, intervalMs: 60_000 })
      expect(JSON.stringify(result)).not.toContain(TOKEN)
    } finally {
      for (const spy of spies) spy.mockRestore()
      vi.unstubAllEnvs()
    }
    expect((await world.calls()).filter((call) => call.args[0] === 'pr')).toEqual([{ token: TOKEN, args: LIST }])
    expect(printed.join('\n')).not.toContain(TOKEN)
  })
})

// ── a Project over several repositories, Silent mode (worfy-harness ticket 23) ──
//
// Project `atakama` is a folder above repositories `api` and `web` (ADR-0045). Its Tickets name
// their branch (`Branch:`, not `<epic>/<NN>`) and their repository (`Repo:`). gh answers by the
// folder it runs in: each repository has its own PRs.

const silentTicket = (num: number, branch: string | null, repo: string | null): Ticket => ({
  epic: 'atakama',
  num,
  slug: `t${num}`,
  title: `Ticket ${num}`,
  statusRaw: 'claimed',
  state: 'work',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  branch,
  repo,
})

async function severalRepos() {
  const workspace = await tempDir()
  const api = join(workspace, 'api')
  const web = join(workspace, 'web')
  const elsewhere = await tempDir()
  await mkdir(api)
  await mkdir(web)
  const tickets = [silentTicket(5, 'fix/x', 'api'), silentTicket(6, 'fix/y', 'web'), silentTicket(7, null, null)]
  const model: WorkflowModel = { root: workspace, epics: [{ epic: 'atakama', hasSpec: true, hasMap: false, title: 'Atakama' }], tickets, error: null, branchErrors: [] }
  const layout: ProjectLayout = {
    root: workspace,
    mode: 'silent',
    workflowFolder: workspace,
    ticketsRoot: join(workspace, '.scratch'),
    repos: [
      { name: 'api', path: api },
      { name: 'web', path: web },
    ],
    workspace,
    reason: null,
  }
  const modelsAsked: string[] = []
  const scope: ChecksScope = {
    layout: async (root) => (root === workspace ? layout : fullLayout(root)),
    model: async (root) => {
      modelsAsked.push(root)
      return root === workspace ? model : null
    },
  }
  const prsOf: Record<string, GhPull[]> = { [api]: [pull(11, 'fix/x'), pull(12, 'atakama/07')], [web]: [pull(21, 'fix/y'), pull(22, 'atakama/05')] }
  const ghCwds: string[] = []
  const run: GhRunner = (args, cwd) => {
    ghCwds.push(cwd)
    const prs = prsOf[cwd] ?? []
    const head = args.includes('--head') ? args[args.indexOf('--head') + 1] : null
    return Promise.resolve(JSON.stringify(head === null ? prs : prs.filter((each) => each.headRefName === head)))
  }
  const home = await tempDir()
  const worktreeX = join(home, 'worfy-harness', 'worktrees', 'atakama', '05')
  const module = checksHandlers(
    {
      gate: new GateReader({ home }),
      prs: new PrTracker({ run }),
      worktrees: async (root) => (root === api ? [{ path: api, branch: 'main' }, { path: worktreeX, branch: 'fix/x' }] : [{ path: root, branch: 'main' }]),
    },
    () => [{ path: workspace }],
    scope,
  )
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  await registerIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, { modules: { './checks.ts': async () => module }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async (channel: string, input: unknown): Promise<IpcResult<unknown>> =>
    (await handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  return { workspace, api, web, elsewhere, tickets, worktreeX, ghCwds, modelsAsked, call }
}

describe('checks in a Project over several repositories and in Silent mode (worfy-harness ticket 23)', () => {
  it('a Ticket with branch fix/x finds its PR, CI and worktree by that branch', () => {
    const ticket = { epic: 'atakama', num: 5, branch: 'fix/x' }
    const snapshot: ChecksSnapshot = {
      root: '/r',
      worktrees: [
        { path: '/r', branch: 'main', gate: { outcome: 'none', source: 'none', at: null } },
        { path: '/h/worktrees/atakama/09', branch: 'fix/x', gate: { outcome: 'green', source: 'marker', at: null } },
      ],
      pulls: [{ number: 3, url: 'https://github.com/o/r/pull/3', state: 'OPEN', branch: 'fix/x', ci: 'passing', verdict: null }],
      gh: { available: true, error: null, intervalMs: 60_000 },
    }
    expect(pullOfTicket(snapshot, ticket)?.number).toBe(3)
    expect(pullOfTicket(snapshot, { epic: 'atakama', num: 5 })).toBeNull()
    expect(worktreeOfTicket(snapshot, ticket, [ticket])?.path).toBe('/h/worktrees/atakama/09')
    // Ticket 09 by the folder number: the folder's branch is Ticket 05's, so it is not 09's tree.
    const nine = { epic: 'atakama', num: 9, branch: null }
    expect(worktreeOfTicket(snapshot, nine, [ticket, nine])).toBeNull()
    // The tree outside the repository is found by its folder when its branch names no Ticket.
    const unnamed: ChecksSnapshot = { ...snapshot, worktrees: [{ path: '/h/worktrees/atakama/09', branch: 'wip', gate: { outcome: 'red', source: 'marker', at: null } }] }
    expect(worktreeOfTicket(unnamed, nine, [ticket, nine])?.gate.outcome).toBe('red')
  })

  it('each repository is asked on its own: Tickets of different repositories do not take each other\'s PRs', async () => {
    const world = await severalRepos()
    const [t5, t6] = world.tickets
    const api = (await world.call('checks.get', { root: world.api, branches: ['fix/x'] })) as IpcResult<ChecksSnapshot>
    const web = (await world.call('checks.get', { root: world.web, branches: ['fix/y'] })) as IpcResult<ChecksSnapshot>
    if (!api.ok || !web.ok) throw new Error(`refused: ${JSON.stringify([api, web])}`)
    expect(pullOfTicket(api.value, t5!)?.number).toBe(11)
    expect(pullOfTicket(web.value, t6!)?.number).toBe(21)
    // Ticket 06 is web's: api's snapshot has nothing of it. Ticket 05 is api's: its PR is #11 there,
    // though web has a PR on atakama/05 (#22) — the renderer never looks for Ticket 05 in web's snapshot.
    expect(pullOfTicket(api.value, t6!)).toBeNull()
    expect(api.value.pulls.map((each) => each.number)).not.toContain(22)
    expect(worktreeOfTicket(api.value, t5!, world.tickets)?.path).toBe(world.worktreeX)
    expect(new Set(world.ghCwds)).toEqual(new Set([world.api, world.web]))
    expect(world.modelsAsked.every((root) => root === world.workspace)).toBe(true)
  })

  it('looks up the PR of a worktree on a branch the model names, though the renderer did not ask for it', async () => {
    const world = await severalRepos()
    const result = (await world.call('checks.get', { root: world.api, branches: [] })) as IpcResult<ChecksSnapshot>
    expect(result.ok && result.value.pulls.map((each) => each.branch).sort()).toEqual(['atakama/07', 'fix/x'])
  })

  it('refuses a root that is neither the Project root nor one of its repositories, without running gh or git', async () => {
    const world = await severalRepos()
    for (const root of [world.elsewhere, join(world.api, 'src'), '/']) {
      const result = await world.call('checks.get', { root, branches: [] })
      expect(result.ok, root).toBe(false)
      expect(!result.ok && result.error).toMatch(/neither the root of a Project nor one of its repositories/)
    }
    expect(world.ghCwds).toEqual([])
    expect((await world.call('checks.get', { root: world.workspace, branches: [] })).ok).toBe(true)
  })

  it('refuses a branch the model does not name as a Ticket branch of that repository; <epic>/<NN> passes as before', async () => {
    const world = await severalRepos()
    for (const [root, branch] of [
      [world.api, 'fix/z'],
      [world.api, 'fix/y'],
      [world.web, 'fix/x'],
      [world.api, 'main'],
    ] as const) {
      const result = await world.call('checks.get', { root, branches: [branch] })
      expect(result.ok, `${root} ${branch}`).toBe(false)
      expect(!result.ok && result.error).toMatch(/is not the branch of a Ticket of this Project/)
    }
    expect(world.ghCwds).toEqual([])
    expect((await world.call('checks.get', { root: world.web, branches: ['fix/y', 'atakama/05'] })).ok).toBe(true)
    // Still refused by the schema: a dash first, whitespace, more than 200 characters.
    for (const branch of ['-x', 'fix/x --web', 'a'.repeat(201)]) expect((await world.call('checks.get', { root: world.api, branches: [branch] })).ok, branch).toBe(false)
  })

  it('checks.repos names the mode and the repositories of a Project root, and refuses anything else', async () => {
    const world = await severalRepos()
    expect(await world.call('checks.repos', { root: world.workspace, extra: 1 })).toEqual({
      ok: true,
      value: {
        mode: 'silent',
        repos: [
          { name: 'api', path: world.api },
          { name: 'web', path: world.web },
        ],
      },
    })
    for (const root of [world.api, world.elsewhere]) expect((await world.call('checks.repos', { root })).ok, root).toBe(false)
    expect((await world.call('checks.repos', { root: 'relative' })).ok).toBe(false)
  })
})
