// The diff of a pull request on the Changes screen (worfy-pr-review ticket 06; ADR-0110 and its Amendment): the
// `changes.*` handlers with the subject `pr`, called as main calls them, with the channel's schemas on both sides.
//
// - Locally, when the PR's repository is the Project's (its `origin`) and both commits are in it: the same reading git
//   as a Ticket's diff, the whole file too. git never fetches, and the index of the repository is not touched.
// - Else from GitHub, over the gh stand-in (test/fixtures/gh/gh-stub.mjs, rest.json): `pulls/{n}/files` page by page,
//   at most 30 pages of 100 (GitHub lists the first 3,000 files), a file without `patch`, the commits of the PR, a
//   commit, Since my review (`compare/{a}...{b}`). The answer is kept in memory by head: a second read asks gh nothing.
//   Every gh call is `gh api <path>` — a GET: no `--method`, no field.
//
// The repositories, the logins and the texts are made up. HOME of every git call is the temporary folder.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GITHUB_FILES_MAX } from '../../src/main/changes/github'
import { changesGitRunner, type ChangesGit } from '../../src/main/changes/git'
import { changesHandlers } from '../../src/main/ipc/changes'
import type { InvokeHandler } from '../../src/main/ipc/index'
import { fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { changesCommits, changesFile, changesList, changesScopes } from '../../src/shared/ipc/changes'
import type { InvokeChannel } from '../../src/shared/ipc/channels'
import { NO_GIT_MAINTENANCE } from '../git-env'
import { removeTestTree } from '../remove'
import { ghWorld, type GhWorld } from './gh-world'

let root: string

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    env: { ...process.env, ...NO_GIT_MAINTENANCE, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function commit(dir: string, message: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  gitIn(dir, 'add', '-A')
  gitIn(dir, 'commit', '-q', '-m', message)
  return gitIn(dir, 'rev-parse', 'HEAD')
}

/** A handler of `handlers` by its channel; called with the channel's schemas on both sides, as main's wrapper does. */
function caller(handlers: readonly InvokeHandler[]) {
  return async <C extends InvokeChannel>(channel: C, input: unknown): Promise<ReturnType<C['output']['parse']>> => {
    const handler = handlers.find((each) => each.channel.name === channel.name)!
    const output = await handler.handle(channel.input.parse(input) as never, {} as never)
    return channel.output.parse(output) as ReturnType<C['output']['parse']>
  }
}

const LINES = (count: number, word = 'line'): string => Array.from({ length: count }, (_, i) => `${word} ${i + 1}`).join('\n') + '\n'
const oid = (char: string): string => char.repeat(40)

/** A file of `GET …/pulls/{n}/files` as GitHub gives it. */
const ghFile = (repo: string, filename: string, fields: Record<string, unknown> = {}) => ({
  sha: oid('e'),
  filename,
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  blob_url: `https://github.com/${repo}/blob/${oid('b')}/${filename}`,
  patch: '@@ -1,2 +1,2 @@\n keep\n-old\n+new',
  ...fields,
})

const API = 'acme/api'
const WEB = 'acme/web'
const BIG = 'acme/big'
const ghPr = { kind: 'pr', repo: API, number: 7, headOid: oid('b'), baseOid: oid('c') } as const
const REVIEWED = oid('a')
const COMMIT = oid('d')

/** What the stand-in answers: the PR of acme/api, a PR of 3,000 files and more, a commit, Since my review. */
function restAnswers(): Record<string, unknown> {
  const files = (repo: string, number: number, page: number) => `repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`
  const answers: Record<string, unknown> = {
    [files(API, 7, 1)]: [ghFile(API, 'src/net/retry.ts'), ghFile(API, 'data/big.json', { patch: undefined, additions: 30_000, deletions: 0, changes: 30_000 }), ghFile(API, 'img/logo.png', { status: 'added', patch: undefined, additions: 0, deletions: 0, changes: 0 })],
    [`repos/${API}/pulls/7/commits?per_page=100&page=1`]: [
      { sha: oid('1'), commit: { message: 'First step\n\nbody', author: { name: 'Ana', date: '2026-11-19T10:00:00Z' } } },
      { sha: oid('2'), commit: { message: 'Second step', author: { name: 'Bob', date: '2026-11-19T11:00:00Z' } } },
    ],
    [`repos/${API}/commits/${COMMIT}?per_page=100&page=1`]: { sha: COMMIT, files: [ghFile(API, 'src/only-in-commit.ts')] },
    [`repos/${API}/compare/${REVIEWED}...${oid('b')}`]: { merge_base_commit: { sha: REVIEWED }, files: [ghFile(API, 'src/since-review.ts')] },
    [files(WEB, 6, 1)]: [ghFile(WEB, 'not-fetched.ts')],
  }
  for (let page = 1; page <= 31; page++) answers[files(BIG, 9, page)] = Array.from({ length: 100 }, (_, i) => ghFile(BIG, `f/${page}-${i}.ts`))
  return answers
}

/** The bytes and mtime of the index and every ref file: what a write into the repository would change. */
function indexState(repo: string): string {
  const index = join(repo, '.git', 'index')
  return `${createHash('sha256').update(readFileSync(index)).digest('hex')} ${statSync(index).mtimeMs}`
}

describe('the diff of a pull request', () => {
  let repo: string
  let world: GhWorld
  let call: ReturnType<typeof caller>
  let base: string
  let first: string
  let head: string
  let later: string
  const gitCalls: string[][] = []
  let indexBefore: string

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-changes-pr-')))
    for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME']) vi.stubEnv(name, root)
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
    repo = join(root, 'web')
    mkdirSync(repo)
    gitIn(repo, 'init', '-q')
    gitIn(repo, 'remote', 'add', 'origin', `https://github.com/${WEB}.git`)
    base = commit(repo, 'start', { 'a.txt': LINES(40), 'keep.txt': 'keep\n' })
    // The PR's head, as `git fetch origin pull/5/head` would have left it before; worfy itself never fetches.
    gitIn(repo, 'checkout', '-q', '-b', 'feature')
    first = commit(repo, 'first', { 'a.txt': LINES(40).replace('line 20\n', 'line twenty\n') })
    head = commit(repo, 'second', { 'b.txt': 'new\n' })
    gitIn(repo, 'checkout', '-q', 'main')
    // main moves on after the PR was opened: its commit is not the PR's.
    later = commit(repo, 'main moves on', { 'main-only.txt': 'main\n' })

    world = ghWorld(join(root, 'gh'), { accounts: [] })
    writeFileSync(join(world.dir, 'rest.json'), JSON.stringify(restAnswers()))
    const reading = changesGitRunner()
    const git: ChangesGit = (cwd, args, options) => {
      gitCalls.push([...args])
      return reading(cwd, args, options)
    }
    const layout: ProjectLayout = { ...fullLayout(repo), repos: [{ name: 'web', path: repo }], finish: 'pr-green-ci', mainBranch: 'origin/main' }
    call = caller(changesHandlers({ project: async () => ({ root: repo, layout }), git, gh: () => (path) => world.run(['api', path], repo) }))
    indexBefore = indexState(repo)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    removeTestTree(root)
  })

  const localPr = () => ({ kind: 'pr', repo: WEB, number: 5, headOid: head, baseOid: later })

  describe('locally, when the repository is the Project’s and both commits are in it', () => {
    it('names the PR with its base, the merge-base and the scopes of a PR; read from git', async () => {
      const { repos } = await call(changesScopes, { projectId: 'p', subject: localPr() })
      expect(repos).toEqual([
        expect.objectContaining({ repo: WEB, kind: 'pr', headSha: head, base: { ref: later, from: 'pr', mergeBase: base }, scopes: ['all', 'commit', 'compare'], branches: [], error: null, source: 'git' }),
      ])
    })

    it('All changes: the PR’s commits against the merge-base, each file with the blob id of its new side; the whole file too', async () => {
      const [changes] = (await call(changesList, { projectId: 'p', subject: localPr(), scope: { kind: 'all' } })).repos
      expect(changes!.error).toBeNull()
      expect(changes!.files.map((file) => [file.path, file.status])).toEqual([
        ['a.txt', 'M'],
        ['b.txt', 'A'],
      ])
      expect(changes!.files.every((file) => /^[0-9a-f]{40}$/u.test(file.newBlob ?? ''))).toBe(true)
      const whole = (await call(changesFile, { projectId: 'p', subject: localPr(), repo: WEB, scope: { kind: 'all' }, path: 'a.txt', whole: true })).file
      expect(whole.kind === 'hunks' && whole.whole).toBe(true)
      expect(whole.kind === 'hunks' ? whole.hunks[0]!.lines.length : 0).toBe(41)
    })

    it('Commit and Since my review: one commit, and the head against the commit the review was on', async () => {
      const { commits } = await call(changesCommits, { projectId: 'p', subject: localPr(), repo: WEB })
      expect(commits.map((each) => each.sha)).toEqual([head, first])
      const [committed] = (await call(changesList, { projectId: 'p', subject: localPr(), scope: { kind: 'commit', repo: WEB, sha: first } })).repos
      expect(committed!.files.map((file) => file.path)).toEqual(['a.txt'])
      const [since] = (await call(changesList, { projectId: 'p', subject: localPr(), scope: { kind: 'compare', repo: WEB, ref: first } })).repos
      expect(since!.files.map((file) => file.path)).toEqual(['b.txt'])
    })

    it('asks gh nothing, never fetches, and leaves the index as it was', async () => {
      expect(world.calls()).toEqual([])
      expect(gitCalls.length).toBeGreaterThan(0)
      expect(gitCalls.filter((args) => args.includes('fetch'))).toEqual([])
      expect(indexState(repo)).toBe(indexBefore)
    })

    it('a head that is not in the repository is read from GitHub, never fetched', async () => {
      const subject = { kind: 'pr', repo: WEB, number: 6, headOid: oid('f'), baseOid: later }
      const [changes] = (await call(changesList, { projectId: 'p', subject, scope: { kind: 'all' } })).repos
      expect(changes!.files.map((file) => file.path)).toEqual(['not-fetched.ts'])
      expect(world.calls()).toEqual([['api', `repos/${WEB}/pulls/6/files?per_page=100&page=1`]])
      expect(gitCalls.filter((args) => args.includes('fetch'))).toEqual([])
      expect(indexState(repo)).toBe(indexBefore)
    })
  })

  describe('from GitHub', () => {
    const start = () => world.calls().length

    it('names the PR with its base commit, read from GitHub; asks gh nothing for that', async () => {
      const before = start()
      const { repos } = await call(changesScopes, { projectId: 'p', subject: ghPr })
      expect(repos).toEqual([expect.objectContaining({ repo: API, kind: 'pr', headSha: oid('b'), base: { ref: oid('c'), from: 'pr', mergeBase: '' }, scopes: ['all', 'commit', 'compare'], branches: [], error: null, source: 'github' })])
      expect(world.calls().length).toBe(before)
    })

    it('All changes: the files of `pulls/{n}/files`, then each file from the same answer — the second read asks gh nothing', async () => {
      const before = start()
      const [changes] = (await call(changesList, { projectId: 'p', subject: ghPr, scope: { kind: 'all' } })).repos
      expect(changes!).toMatchObject({ repo: API, kind: 'pr', error: null, truncatedAt: null })
      expect(changes!.files.map((file) => [file.path, file.status, file.binary, file.newBlob, file.url])).toEqual([
        ['data/big.json', 'M', false, oid('e'), `https://github.com/${API}/blob/${oid('b')}/data/big.json`],
        ['img/logo.png', 'A', true, oid('e'), `https://github.com/${API}/blob/${oid('b')}/img/logo.png`],
        ['src/net/retry.ts', 'M', false, oid('e'), `https://github.com/${API}/blob/${oid('b')}/src/net/retry.ts`],
      ])
      expect(world.calls().slice(before)).toEqual([['api', `repos/${API}/pulls/7/files?per_page=100&page=1`]])

      const file = async (path: string, extra: Record<string, unknown> = {}) => (await call(changesFile, { projectId: 'p', subject: ghPr, repo: API, scope: { kind: 'all' }, path, ...extra })).file
      const retry = await file('src/net/retry.ts', { whole: true })
      expect(retry).toMatchObject({ kind: 'hunks', path: 'src/net/retry.ts', whole: false })
      expect(retry.kind === 'hunks' ? retry.hunks[0]!.lines.map((line) => [line.kind, line.text]) : []).toEqual([
        ['context', 'keep'],
        ['del', 'old'],
        ['add', 'new'],
      ])
      expect(await file('data/big.json')).toEqual({ kind: 'no-patch', path: 'data/big.json', url: `https://github.com/${API}/blob/${oid('b')}/data/big.json` })
      expect(await file('img/logo.png')).toMatchObject({ kind: 'no-patch' })
      await expect(file('src/absent.ts')).rejects.toThrow(/has no changes/u)
      await call(changesList, { projectId: 'p', subject: ghPr, scope: { kind: 'all' } })
      expect(world.calls().length).toBe(before + 1)
    })

    it('a new head is read again', async () => {
      const before = start()
      const [changes] = (await call(changesList, { projectId: 'p', subject: { ...ghPr, headOid: oid('9') }, scope: { kind: 'all' } })).repos
      expect(changes!.files).toHaveLength(3)
      expect(world.calls().length).toBe(before + 1)
    })

    it('the commits of the PR, newest first; a commit; Since my review through compare', async () => {
      const before = start()
      const { commits, base } = await call(changesCommits, { projectId: 'p', subject: ghPr, repo: API })
      expect(base).toEqual({ ref: oid('c'), from: 'pr', mergeBase: '' })
      expect(commits).toEqual([
        { sha: oid('2'), short: '2222222', author: 'Bob', date: '2026-11-19T11:00:00Z', subject: 'Second step' },
        { sha: oid('1'), short: '1111111', author: 'Ana', date: '2026-11-19T10:00:00Z', subject: 'First step' },
      ])
      const [committed] = (await call(changesList, { projectId: 'p', subject: ghPr, scope: { kind: 'commit', repo: API, sha: COMMIT } })).repos
      expect(committed!.files.map((file) => file.path)).toEqual(['src/only-in-commit.ts'])
      const [since] = (await call(changesList, { projectId: 'p', subject: ghPr, scope: { kind: 'compare', repo: API, ref: REVIEWED } })).repos
      expect(since!.files.map((file) => file.path)).toEqual(['src/since-review.ts'])
      expect((await call(changesFile, { projectId: 'p', subject: ghPr, repo: API, scope: { kind: 'compare', repo: API, ref: REVIEWED }, path: 'src/since-review.ts' })).file.kind).toBe('hunks')
      expect(world.calls().slice(before)).toEqual([
        ['api', `repos/${API}/pulls/7/commits?per_page=100&page=1`],
        ['api', `repos/${API}/commits/${COMMIT}?per_page=100&page=1`],
        ['api', `repos/${API}/compare/${REVIEWED}...${oid('b')}`],
      ])
      // Since my review takes a commit, never a branch name.
      const [named] = (await call(changesList, { projectId: 'p', subject: ghPr, scope: { kind: 'compare', repo: API, ref: 'main' } })).repos
      expect(named!.error).toMatch(/commit/u)
    })

    it('a PR of more than 3,000 files: the first 3,000 — 30 pages of 100 — and the answer says so', async () => {
      const before = start()
      const subject = { kind: 'pr', repo: BIG, number: 9, headOid: oid('b'), baseOid: oid('c') }
      const [changes] = (await call(changesList, { projectId: 'p', subject, scope: { kind: 'all' } })).repos
      expect(changes!.files).toHaveLength(GITHUB_FILES_MAX)
      expect(changes!.truncatedAt).toBe(3_000)
      const asked = world.calls().slice(before)
      expect(asked).toHaveLength(30)
      expect(asked.at(-1)).toEqual(['api', `repos/${BIG}/pulls/9/files?per_page=100&page=30`])
    })

    it('a PR GitHub does not know: the reason of gh in the answer, no files', async () => {
      const [changes] = (await call(changesList, { projectId: 'p', subject: { ...ghPr, number: 404 }, scope: { kind: 'all' } })).repos
      expect(changes!.files).toEqual([])
      expect(changes!.error).toMatch(/HTTP 404/u)
    })

    it('every gh call of the screen is `gh api <path>`: a GET, no --method, no field', () => {
      const calls = world.calls()
      expect(calls.length).toBeGreaterThan(30)
      for (const args of calls) {
        expect(args).toHaveLength(2)
        expect(args[0]).toBe('api')
        expect(args.some((arg) => /^(?:--method|-X|-f|-F|--field|--raw-field|--input)/u.test(arg))).toBe(false)
      }
      expect(indexState(repo)).toBe(indexBefore)
    })
  })
})
