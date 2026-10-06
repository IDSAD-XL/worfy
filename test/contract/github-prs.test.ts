import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { GateReader, type Worktree } from '../../src/main/gate/state'
import { ciOf, ghRunner, parsePrList, PrTracker, verdictOf, type GhRunner } from '../../src/main/github/prs'
import { checksHandlers } from '../../src/main/ipc/checks'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { pullOfTicket, type ChecksSnapshot } from '../../src/shared/ipc/checks'

// Pull requests and CI from `gh` (ticket 17), against test/fixtures/gh/gh: a stub that records
// its arguments and answers from a prs.json. Nothing here reaches GitHub.

const GH_STUB = join(import.meta.dirname, '..', 'fixtures', 'gh', 'gh')
const INDEX_HTML = '/app/out/renderer/index.html'

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-gh-')))
  temps.push(dir)
  return dir
}

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
  })

  it('does not take the word anywhere but at the start of the first line', () => {
    expect(verdictOf([{ body: 'Looks fine\nVERIFIED' }])).toBeNull()
    expect(verdictOf([{ body: 'not VERIFIED yet' }])).toBeNull()
    expect(verdictOf([{ body: 'VERIFIEDX' }])).toBeNull()
    expect(verdictOf([])).toBeNull()
    expect(verdictOf(null)).toBeNull()
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
  const module = checksHandlers({ gate: new GateReader({ home }), prs: new PrTracker({ run }), worktrees: async (root) => worktrees(root) })
  await registerIpc(ipc, { modules: { './checks.ts': async () => module }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  return async (input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!
    return (await listener({ senderFrame: { url: `file://${INDEX_HTML}` } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

describe('checks.get', () => {
  it.each([
    [undefined],
    [{ root: 'relative', branches: [] }],
    [{ root: '/r' }],
    [{ root: '/r', branches: 'demo/01' }],
    [{ root: '/r', branches: ['main'] }],
    [{ root: '/r', branches: ['--repo=evil/x'] }],
    [{ root: '/r', branches: ['demo/01 --web'] }],
    [{ root: '/r', branches: [42] }],
  ])('refuses %j without running gh', async (input) => {
    let count = 0
    const call = await ipcOver(() => {
      count += 1
      return Promise.resolve('[]')
    }, await tempDir())
    const result = await call(input)
    expect(result.ok).toBe(false)
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
    })
    await registerIpc(ipc, { modules: { './checks.ts': async () => leaky }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    const result = (await handlers.get(`${IPC_CHANNEL_PREFIX}checks.get`)!({ senderFrame: { url: `file://${INDEX_HTML}` } } as unknown as IpcMainInvokeEvent, { root: '/r', branches: [] })) as IpcResult<ChecksSnapshot>
    expect(result).toEqual({
      ok: true,
      value: { root: '/r', worktrees: [{ path: '/r', branch: 'main', gate: { outcome: 'green', source: 'marker', at: null } }], pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } },
    })
  })
})
