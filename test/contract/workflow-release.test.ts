// The Stage `release` of a Ticket over several repositories (worfy-multi-repo-ticket 05, ADR-0104 items 5, 6): the
// release reader against real git with a local bare repository as the library's `origin` (no network) and the npm of
// test/fixtures/release-stub on the PATH; then the StageReader of main over two such repositories with a stub PR
// tracker. Nothing reaches GitHub or a registry; the Harness home is a temporary folder.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TrackedPull } from '../../src/main/github/prs'
import { markFilePath } from '../../src/main/workflow/marks'
import type { PipelineProfile } from '../../src/main/workflow/profile'
import { packageOf, ReleaseReader, type ReleaseCheck, type ReleasePlaces } from '../../src/main/workflow/release'
import { StageReader, type StageSources } from '../../src/main/workflow/stages'
import type { PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import { STAGE_KINDS, type PipelineStage } from '../../src/shared/workflow/pipeline'
import type { Ticket, TicketRelease, WorkflowModel } from '../../src/shared/workflow/types'
import { NODE } from '../harness-node'

const WINDOWS = process.platform === 'win32'
const STUBS = join(import.meta.dirname, '..', 'fixtures', 'release-stub')
const BRANCH = 'fix/lot-withdraw-flag'
const TAG = 'lib-v1.4.0'
const PACKAGE = '@acme/lots@1.4.0'
const REVIEWED_AT = '2026-10-17T11:00:00.000Z'

/** A Pipeline of a Project over several repositories: people review and merge, release between CI and their review. */
const MULTI: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'agent-review' },
  { kind: 'ci' },
  { kind: 'release' },
  { kind: 'human-review' },
  { kind: 'awaiting-merge' },
  { kind: 'done' },
]

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
}

/** Every file under `dir` with its size, mtime and content hash, `.git` included. */
function treeState(dir: string): Map<string, string> {
  const state = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const stats = statSync(path)
        state.set(path, `${stats.size}:${stats.mtimeMs}:${createHash('sha1').update(readFileSync(path)).digest('hex')}`)
      }
    }
  }
  walk(dir)
  return state
}

let dir: string
let bin: string
let calls: string
let stubVars: Record<string, string>

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-release-')))
  bin = join(dir, 'bin')
  mkdirSync(bin)
  calls = join(dir, 'npm-calls.log')
  writeFileSync(calls, '')
  stubVars = { RELEASE_STUB_PUBLISHED: '', RELEASE_STUB_CODE: '0' }
  // The stand-in npm first on the PATH, git from the PATH of the tests. On Windows a `npm.cmd`, as npm leaves one there.
  if (WINDOWS) writeFileSync(join(bin, 'npm.cmd'), `@"${NODE}" "${join(STUBS, 'npm.mjs')}" %*\r\n`)
  else symlinkSync(join(STUBS, 'npm'), join(bin, 'npm'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The login shell's environment the reader is handed: the stub's folder first on the PATH, and what the stub answers. */
const env = (): Promise<Record<string, string | undefined>> => {
  const pathKey = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
  const rest = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'))
  return Promise.resolve({ ...rest, [pathKey]: [bin, process.env[pathKey] ?? ''].join(delimiter), RELEASE_STUB_CALLS: calls, ...stubVars })
}
const npmCalls = (): string[] => readFileSync(calls, 'utf8').split('\n').filter((line) => line !== '')

/** A repository with one commit and the Ticket's branch at it; with `origin`, a bare repository it pushes to. */
function repoAt(path: string, origin?: string): string {
  mkdirSync(path, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main', path)
  writeFileSync(join(path, 'README.md'), 'readme\n')
  git(path, 'add', '-A')
  git(path, 'commit', '-qm', 'first')
  git(path, 'branch', BRANCH)
  if (origin !== undefined) {
    git(dir, 'init', '-q', '--bare', origin)
    git(path, 'remote', 'add', 'origin', origin)
    git(path, 'push', '-q', 'origin', 'main')
  }
  return path
}

const tagLine: TicketRelease = { repo: 'lib', kind: 'tag', ref: TAG }
const packageLine: TicketRelease = { repo: 'lib', kind: 'package', ref: PACKAGE }

describe('the release reader', () => {
  it('tag: not in the remote — waiting; pushed to the remote — released; the checkout is only read', async () => {
    const lib = repoAt(join(dir, 'lib'), join(dir, 'lib-origin.git'))
    const reader = new ReleaseReader({ env, intervalMs: 0 })
    const places: ReleasePlaces = { library: lib, consumer: null }
    // A local tag that is not in the remote is not a release.
    git(lib, 'tag', TAG)
    const before = treeState(lib)
    expect(await reader.check(tagLine, places)).toEqual({ state: 'waiting', reason: null })
    expect(treeState(lib)).toEqual(before)

    git(lib, 'push', '-q', 'origin', TAG)
    expect(await reader.check(tagLine, places)).toEqual({ state: 'released', reason: null })
    // A tag whose name only ends like the line's is not it.
    expect(await reader.check({ ...tagLine, ref: 'v1.4.0' }, places)).toEqual({ state: 'waiting', reason: null })
  })

  it('tag: an annotated tag counts; a remote that does not answer is not checked, never released', async () => {
    const lib = repoAt(join(dir, 'lib'), join(dir, 'lib-origin.git'))
    git(lib, '-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '-a', '-m', 'release', TAG)
    git(lib, 'push', '-q', 'origin', TAG)
    const reader = new ReleaseReader({ env, intervalMs: 0 })
    expect(await reader.check(tagLine, { library: lib, consumer: null })).toEqual({ state: 'released', reason: null })

    git(lib, 'remote', 'set-url', 'origin', join(dir, 'gone.git'))
    // A new reader: a release once seen is kept for good.
    const gone = await new ReleaseReader({ env, intervalMs: 0 }).check(tagLine, { library: lib, consumer: null })
    expect(gone.state).toBe('not checked')
    expect(gone.reason).toMatch(/^git ls-remote exited \d+/u)
  })

  it('tag: a library folder that is not the top level of its repository, or none, is not checked', async () => {
    const outer = repoAt(join(dir, 'outer'), join(dir, 'outer-origin.git'))
    git(outer, 'tag', TAG)
    git(outer, 'push', '-q', 'origin', TAG)
    const inner = join(outer, 'lib')
    mkdirSync(inner)
    const reader = new ReleaseReader({ env, intervalMs: 0 })
    // git would walk up to the outer repository and find its tag.
    expect(await reader.check(tagLine, { library: inner, consumer: null })).toEqual({ state: 'not checked', reason: `${inner} is not the top level of its repository` })
    expect((await reader.check(tagLine, { library: null, consumer: null })).state).toBe('not checked')
    expect((await reader.check({ ...tagLine, ref: '--upload-pack=x' }, { library: outer, consumer: null })).state).toBe('not checked')
  })

  it('package: npm view in the consumer\'s checkout — no version prints nothing and waits, the version printed is released', async () => {
    const app = repoAt(join(dir, 'app'))
    const reader = new ReleaseReader({ env, intervalMs: 0 })
    const places: ReleasePlaces = { library: null, consumer: app }
    expect(await reader.check(packageLine, places)).toEqual({ state: 'waiting', reason: null })
    stubVars.RELEASE_STUB_PUBLISHED = '@acme/lots@1.3.0 @acme/lots@1.4.0'
    expect(await reader.check(packageLine, places)).toEqual({ state: 'released', reason: null })
    // Exactly `npm view <name>@<version> version`, run in the consumer's checkout so its .npmrc applies.
    expect(npmCalls()).toEqual([`npm view ${PACKAGE} version cwd=${app}`, `npm view ${PACKAGE} version cwd=${app}`])
  })

  it('package: a registry that does not answer is not checked, with npm\'s reason', async () => {
    const app = repoAt(join(dir, 'app'))
    stubVars.RELEASE_STUB_PUBLISHED = PACKAGE
    stubVars.RELEASE_STUB_CODE = '1'
    const check = await new ReleaseReader({ env, intervalMs: 0 }).check(packageLine, { library: null, consumer: app })
    expect(check).toEqual({ state: 'not checked', reason: 'npm view exited 1: npm error network request to https://registry.example/ failed' })
  })

  it('package: a ref that is not <name>@<version>, an unknown kind, no consumer — not checked, and npm is not run', async () => {
    const app = repoAt(join(dir, 'app'))
    const reader = new ReleaseReader({ env, intervalMs: 0 })
    for (const ref of ['lots', '@acme/lots@1.4.0 & calc', 'Lots@1.4.0', '@acme/lots@']) {
      expect((await reader.check({ ...packageLine, ref }, { library: null, consumer: app })).state).toBe('not checked')
    }
    expect((await reader.check(packageLine, { library: null, consumer: null })).state).toBe('not checked')
    expect(await reader.check({ ...packageLine, kind: 'github-release' }, { library: null, consumer: app })).toEqual({ state: 'not checked', reason: 'worfy knows the kinds tag and package, not github-release' })
    expect(npmCalls()).toEqual([])
    expect(packageOf(PACKAGE)).toEqual({ name: '@acme/lots', version: '1.4.0' })
  })

  it('an answer other than released is asked again after the interval; released is kept', async () => {
    const app = repoAt(join(dir, 'app'))
    let now = 0
    const reader = new ReleaseReader({ env, intervalMs: 1000, now: () => now })
    const places: ReleasePlaces = { library: null, consumer: app }
    expect((await reader.check(packageLine, places)).state).toBe('waiting')
    stubVars.RELEASE_STUB_PUBLISHED = PACKAGE
    now = 999
    expect((await reader.check(packageLine, places)).state).toBe('waiting')
    now = 1000
    expect((await reader.check(packageLine, places)).state).toBe('released')
    stubVars.RELEASE_STUB_CODE = '1'
    now = 100_000
    expect((await reader.check(packageLine, places)).state).toBe('released')
    expect(npmCalls()).toHaveLength(2)
  })
})

describe('the Stage release in main (StageReader)', () => {
  /** A plain folder over lib (with a bare `origin`) and app; the Ticket's branch in both. */
  const workspace = () => {
    const root = join(dir, 'workspace')
    mkdirSync(root)
    const lib = repoAt(join(root, 'lib'), join(dir, 'lib-origin.git'))
    const app = repoAt(join(root, 'app'))
    const harnessHome = join(dir, 'harness-home')
    mkdirSync(join(harnessHome, 'runs', 'multi', 'marks'), { recursive: true })
    return { root, lib, app, harnessHome, head: (repo: string) => git(repo, 'rev-parse', BRANCH) }
  }
  type Workspace = ReturnType<typeof workspace>

  const profileOf = (ws: Workspace, pipeline = MULTI, repos = [{ name: 'lib', path: ws.lib }, { name: 'app', path: ws.app }]): PipelineProfile => ({
    name: 'multi',
    mode: 'silent',
    finish: null,
    pipeline,
    pipelineReason: null,
    e2eLock: null,
    repos,
  })

  /** Ticket 05: claimed, two Repo: lines (lib first), one Branch: line, the Release: lines given. */
  const claimed = (releases: TicketRelease[]): Ticket => ({
    epic: 'demo',
    num: 5,
    slug: 'withdraw',
    title: '05 — Withdraw',
    statusRaw: 'claimed 2026-10-17T09:00Z',
    state: 'work',
    statusAt: '2026-10-17T09:00Z',
    blockedRaw: '—',
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: false,
    fromBranch: null,
    branch: BRANCH,
    repo: 'app',
    repos: ['lib', 'app'],
    prs: [],
    releases,
  })

  /** Both heads reviewed (`success`) in the marks file of the Harness home. */
  const reviewBoth = (ws: Workspace) =>
    writeFileSync(
      markFilePath(ws.harnessHome, 'multi', 'demo', 5),
      JSON.stringify({ epic: 'demo', num: '05', marks: [ws.head(ws.lib), ws.head(ws.app)].map((sha) => ({ kind: 'review', verdict: 'success', sha, at: REVIEWED_AT })) }),
    )

  const tracked = (number: number, headSha: string, state: 'OPEN' | 'MERGED', checks: TrackedPull['checks'] = []): TrackedPull =>
    ({
      number,
      url: `https://github.com/o/r/pull/${number}`,
      state,
      branch: BRANCH,
      ci: null,
      verdict: null,
      headSha,
      reviewDecision: null,
      mergeCommit: state === 'MERGED' ? '9'.repeat(40) : null,
      mergedAt: state === 'MERGED' ? '2026-10-17T12:00:00Z' : null,
      checks,
      markStatuses: [],
    }) as unknown as TrackedPull
  const check = (state: 'success' | 'failure') => ({ name: 'test', state, startedAt: '2026-10-17T11:10:00Z', completedAt: '2026-10-17T11:20:00Z' })

  /** lib's PR merged, app's PR open on its head with one CI check of `ci`. */
  const libMergedAppOpen = (ws: Workspace, ci: 'success' | 'failure') =>
    new Map([
      [ws.lib, [tracked(41, ws.head(ws.lib), 'MERGED')]],
      [ws.app, [tracked(118, ws.head(ws.app), 'OPEN', [check(ci)])]],
    ])

  /** A reader over the real git of the workspace, a stub PR tracker and `release`; `asked` gets each PR read. */
  const readerOver = (ws: Workspace, pulls: Map<string, TrackedPull[]>, release: StageSources['release'], profile = profileOf(ws), asked: string[] = []) =>
    new StageReader({
      workflow: { open: () => Promise.reject(new Error('unused')), close: () => Promise.resolve(false), model: () => Promise.resolve(null) },
      prs: {
        read: (folder) => {
          asked.push(folder)
          return Promise.resolve({ gh: { available: true, error: null, intervalMs: 1 }, pulls: pulls.get(folder) ?? [] })
        },
      },
      profile: () => Promise.resolve({ ok: true, profile }),
      deployments: { environment: () => Promise.resolve([]), deployMarks: () => Promise.resolve([]) } as unknown as StageSources['deployments'],
      harnessHome: ws.harnessHome,
      ...(release === undefined ? {} : { release }),
    })
  const modelOf = (root: string, tickets: Ticket[]): WorkflowModel => ({ root, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets, error: null, branchErrors: [] })
  const read = (reader: StageReader, ws: Workspace, releases: TicketRelease[]): Promise<PipelineSnapshot> => reader.read(ws.root, modelOf(ws.root, [claimed(releases)]))
  const ticket = (snapshot: PipelineSnapshot): PipelineTicket => {
    const found = snapshot.tickets.find((each) => each.num === 5)
    if (!found) throw new Error(`no Ticket 5 in ${JSON.stringify(snapshot.tickets)}`)
    return found
  }

  it('Release: lib tag — no tag in the remote: the Ticket is on release, waiting for it; the tag appears: the Stage is passed', async () => {
    const ws = workspace()
    reviewBoth(ws)
    const reader = readerOver(ws, libMergedAppOpen(ws, 'success'), new ReleaseReader({ env, intervalMs: 0 }))
    const appBefore = treeState(ws.app)

    const waiting = await read(reader, ws, [tagLine])
    expect(ticket(waiting)).toMatchObject({ stage: 'release', waits: 'team', merged: { count: 1, of: 2 }, release: [{ ...tagLine, state: 'waiting' }] })
    expect(waiting.error).toBeNull()

    git(ws.lib, 'tag', TAG)
    git(ws.lib, 'push', '-q', 'origin', TAG)
    const after = ticket(await read(reader, ws, [tagLine]))
    expect(after).toMatchObject({ stage: 'human-review', release: [{ ...tagLine, state: 'released' }] })
    expect(after.passed).toContain('release')
    // The consumer's checkout is only read (ADR-0005).
    expect(treeState(ws.app)).toEqual(appBefore)
  })

  it('Release: lib package — npm view without the version holds the Stage, with it passes; a registry error is release not checked', async () => {
    const ws = workspace()
    reviewBoth(ws)
    const reader = readerOver(ws, libMergedAppOpen(ws, 'success'), new ReleaseReader({ env, intervalMs: 0 }))

    expect(ticket(await read(reader, ws, [packageLine]))).toMatchObject({ stage: 'release', release: [{ ...packageLine, state: 'waiting' }] })
    // npm ran in the consumer's checkout, app, not in the library's.
    expect(npmCalls()).toEqual([`npm view ${PACKAGE} version cwd=${ws.app}`])

    stubVars.RELEASE_STUB_PUBLISHED = PACKAGE
    expect(ticket(await read(reader, ws, [packageLine]))).toMatchObject({ stage: 'human-review', release: [{ ...packageLine, state: 'released' }] })

    const failing = readerOver(ws, libMergedAppOpen(ws, 'success'), new ReleaseReader({ env, intervalMs: 0 }))
    stubVars.RELEASE_STUB_CODE = '1'
    const unchecked = await read(failing, ws, [packageLine])
    expect(ticket(unchecked)).toMatchObject({ stage: 'release', release: [{ ...packageLine, state: 'not checked' }] })
    expect(unchecked.error).toContain(`the release ${PACKAGE} of lib was not checked: npm view exited 1`)
  })

  it('red CI of the consumer before the release does not paint the Ticket; after the release it does', async () => {
    const ws = workspace()
    reviewBoth(ws)
    const reader = readerOver(ws, libMergedAppOpen(ws, 'failure'), new ReleaseReader({ env, intervalMs: 0 }))
    expect(ticket(await read(reader, ws, [tagLine]))).toMatchObject({ stage: 'release', sub: null })

    git(ws.lib, 'tag', TAG)
    git(ws.lib, 'push', '-q', 'origin', TAG)
    expect(ticket(await read(reader, ws, [tagLine]))).toMatchObject({ stage: 'ci', sub: 'failing' })
  })

  it('a Ticket without Release: lines passes release at once; a Profile without release has no such Stage and asks nothing', async () => {
    const ws = workspace()
    reviewBoth(ws)
    const asks: string[] = []
    const counting = { check: (line: TicketRelease): Promise<ReleaseCheck> => (asks.push(line.ref), Promise.resolve({ state: 'waiting', reason: null })) }

    const none = ticket(await read(readerOver(ws, libMergedAppOpen(ws, 'success'), counting), ws, []))
    expect(none).toMatchObject({ stage: 'human-review' })
    expect(none.passed).toContain('release')
    expect(none.release).toBeUndefined()

    const without = MULTI.filter((stage) => stage.kind !== 'release')
    const snapshot = await read(readerOver(ws, libMergedAppOpen(ws, 'failure'), counting, profileOf(ws, without)), ws, [tagLine])
    expect(snapshot.pipeline.map((column) => column.id)).not.toContain('release')
    // Without the Stage the Release: line changes nothing: red CI is red, and nothing is asked about the release.
    expect(ticket(snapshot)).toMatchObject({ stage: 'ci', sub: 'failing' })
    expect(ticket(snapshot).release).toBeUndefined()
    expect(asks).toEqual([])
  })

  it('a repository folder that is not the top level of its repository: its PRs are not read, and the snapshot says why', async () => {
    const ws = workspace()
    // app's checkout named as a plain folder inside lib: gh there would give lib's PRs as app's.
    const inner = join(ws.lib, 'app')
    mkdirSync(inner)
    const asked: string[] = []
    const profile = profileOf(ws, MULTI, [{ name: 'lib', path: ws.lib }, { name: 'app', path: inner }])
    const snapshot = await read(readerOver(ws, new Map(), undefined, profile, asked), ws, [])
    expect(asked).toEqual([ws.lib])
    expect(snapshot.error).toContain(`${inner} is not the top level of its repository, its PRs are not read`)
  })

  it('without a release reader every line is not checked, and the Ticket stays on release', async () => {
    const ws = workspace()
    reviewBoth(ws)
    const snapshot = await read(readerOver(ws, libMergedAppOpen(ws, 'success'), undefined), ws, [tagLine])
    expect(ticket(snapshot)).toMatchObject({ stage: 'release', release: [{ ...tagLine, state: 'not checked' }] })
    expect(snapshot.error).toContain(`the release ${TAG} of lib was not checked: worfy has no release reader here`)
  })
})

describe('the catalogue of Stage kinds', () => {
  it('the draft schema of a Profile knows the same kinds, release among them', () => {
    const schema = readFileSync(join(import.meta.dirname, '..', '..', 'harness', 'profiles', 'draft.schema.json'), 'utf8')
    const kinds = /"kind": \{ "enum": (\[[^\]]*\]) \}/u.exec(schema)?.[1]
    expect(JSON.parse(kinds ?? '[]')).toEqual([...STAGE_KINDS])
    expect(STAGE_KINDS).toContain('release')
  })
})
