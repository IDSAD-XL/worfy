// The Changes screen reading the diff of a Ticket from git (src/main/ipc/changes.ts over src/main/changes/;
// worfy-changes-view ticket 02, ADR-0110), on real repositories in a temporary folder: the handlers of the
// `changes.*` channels are called as main calls them, with the channel's schemas on both sides.
//
// - A Ticket with a worktree: All changes against the merge-base with origin/main (a later commit of main is not
//   part of it), with the new files git does not track yet; Uncommitted; Commit; Compare against.
// - A Ticket in two repositories of one Project, on a branch checked out nowhere: one answer per repository.
// - Nothing is written: after every read the files of `.git` — the index, its bytes and mtime, the refs, the
//   objects, any lock file — are what they were. The worktree has a tracked file whose stat changed and whose text
//   did not, so a plain `git diff` there writes `.git/worktrees/<name>/index`; the test shows it does, so the check
//   would see such a write.
//
// HOME of every git call is the temporary folder (the tester's ~/.gitconfig is never read), and the auto
// maintenance of git is off in the test's own calls (NO_GIT_MAINTENANCE): git 2.56 starts it after a commit and its
// lock file comes and goes while the test compares the files. The same tests run on the Windows runner of CI.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { changesGitRunner, refusal } from '../../src/main/changes/git'
import { changesHandlers, type ChangesDeps } from '../../src/main/ipc/changes'
import type { InvokeHandler } from '../../src/main/ipc/index'
import { fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { changesCommits, changesFile, changesList, changesScopes } from '../../src/shared/ipc/changes'
import type { InvokeChannel } from '../../src/shared/ipc/channels'
import { NO_GIT_MAINTENANCE } from '../git-env'
import { removeTestTree } from '../remove'

let root: string

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    env: { ...process.env, ...NO_GIT_MAINTENANCE, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function write(dir: string, files: Record<string, string | Buffer>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
}

function commit(dir: string, message: string, files: Record<string, string | Buffer>): string {
  write(dir, files)
  gitIn(dir, 'add', '-A')
  gitIn(dir, 'commit', '-q', '-m', message)
  return gitIn(dir, 'rev-parse', 'HEAD')
}

/** Every file under `dir` with its size and mtime, and the bytes of each index: what a write would change. */
function snapshot(dir: string): { files: string[]; indexes: Record<string, string> } {
  const files: string[] = []
  const indexes: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const st = statSync(path)
        const rel = relative(dir, path).split('\\').join('/')
        files.push(`${rel} ${st.size} ${st.mtimeMs}`)
        if (entry.name === 'index') indexes[rel] = readFileSync(path).toString('base64')
      }
    }
  }
  walk(dir)
  return { files: files.sort(), indexes }
}

const git = changesGitRunner()

/**
 * The reader's git runs with main's environment: for the test, HOME is the temporary folder and the system
 * configuration is not read (the Windows runner's sets core.autocrlf), as for the test's own git calls.
 */
function ownGitHome(): void {
  for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME']) vi.stubEnv(name, root)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
}

/** A handler of `handlers` by its channel; called with the channel's schemas on both sides, as main's wrapper does. */
function caller(handlers: readonly InvokeHandler[]) {
  return async <C extends InvokeChannel>(channel: C, input: unknown): Promise<ReturnType<C['output']['parse']>> => {
    const handler = handlers.find((each) => each.channel.name === channel.name)!
    const output = await handler.handle(channel.input.parse(input) as never, {} as never)
    return channel.output.parse(output) as ReturnType<C['output']['parse']>
  }
}

const SPEC = (lines: number): string => Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const ticket = { epic: 'ep', num: 2 }

describe('a Ticket with a worktree', () => {
  let repo: string
  let tree: string
  let call: ReturnType<typeof caller>
  let deps: ChangesDeps
  let base: string
  let firstOnBranch: string
  let secondOnBranch: string
  let before: ReturnType<typeof snapshot>

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-changes-read-')))
    ownGitHome()
    repo = join(root, 'repo')
    mkdirSync(repo)
    gitIn(repo, 'init', '-q')
    base = commit(repo, 'start', {
      'a.txt': SPEC(30),
      'crlf.txt': 'one\r\ntwo\r\nthree\r\n',
      'move.txt': SPEC(20),
      'run.sh': 'echo hi\n',
      'logo.bin': Buffer.from([0, 1, 2, 3]),
      'keep.txt': 'unchanged\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      '.gitattributes': 'gen/** linguist-generated\n',
      '.gitignore': '*.log\n',
      'gen/api.ts': 'export const a = 1\n',
      '.scratch/ep/issues/02-x.md': '# 02\nStatus: open\n',
    })
    // origin/main as a fetch would leave it, without a remote to fetch from.
    gitIn(repo, 'update-ref', 'refs/remotes/origin/main', base)
    gitIn(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    tree = join(root, 'worktrees', '02')
    gitIn(repo, 'worktree', 'add', '-q', '-b', 'ep/02', tree, base)
    gitIn(repo, 'branch', 'other', base)
    // main moves on after the branch: its commit is not the Ticket's.
    const later = commit(repo, 'main moves on', { 'main-only.txt': 'main\n' })
    gitIn(repo, 'update-ref', 'refs/remotes/origin/main', later)

    // The mode in the index as well: on Windows git does not read it from the file (core.fileMode is false there).
    chmodSync(join(tree, 'run.sh'), 0o755)
    gitIn(tree, 'update-index', '--chmod=+x', 'run.sh')
    gitIn(tree, 'mv', 'move.txt', 'moved ü.txt')
    firstOnBranch = commit(tree, 'first', {
      'a.txt': SPEC(30).replace('line 5\n', 'line five\n'),
      'moved ü.txt': SPEC(21),
      'crlf.txt': 'one\r\nTWO\r\nthree\r\n',
      'logo.bin': Buffer.from([0, 1, 2, 3, 4, 5]),
      'pnpm-lock.yaml': 'lockfileVersion: 9\npackages: {}\n',
      'gen/api.ts': 'export const a = 2\n',
      '.scratch/ep/issues/02-x.md': '# 02\nStatus: claimed\n',
    })
    secondOnBranch = commit(tree, 'second', { 'b c.txt': 'two words\n', 'big.txt': SPEC(2_100) })
    // Not committed: an edit, two new files (a space, Cyrillic), an ignored one.
    write(tree, { 'a.txt': SPEC(30).replace('line 5\n', 'line five\n').replace('line 20\n', 'line twenty\n'), 'new ü file.txt': 'fresh\n', 'notes/с пробелом.md': 'note\nno newline', 'debug.log': 'ignored\n' })
    // A file whose stat changed and whose text did not: git diff would refresh the index and write it back.
    const later5 = new Date(Date.now() + 120_000)
    utimesSync(join(tree, 'keep.txt'), later5, later5)

    const layout: ProjectLayout = { ...fullLayout(repo), repos: [{ name: 'repo', path: repo }], finish: 'pr-green-ci', mainBranch: 'origin/main' }
    deps = { project: async () => ({ root: repo, layout }), git }
    call = caller(changesHandlers(deps))
    before = snapshot(join(repo, '.git'))
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    removeTestTree(root)
  })

  it('names its repository, the worktree, the base and merge-base, the four scopes and the branches to compare', async () => {
    const answer = await call(changesScopes, { projectId: 'p', ticket })
    expect(answer.repos).toHaveLength(1)
    const [entry] = answer.repos
    expect(entry).toMatchObject({ repo: 'repo', kind: 'worktree', branch: 'ep/02', headSha: secondOnBranch, base: { ref: 'origin/main', from: 'worktree.base', mergeBase: base }, scopes: ['all', 'uncommitted', 'commit', 'compare'], error: null })
    expect(entry!.branches).toEqual(expect.arrayContaining(['main', 'ep/02', 'other', 'origin/main']))
    expect(entry!.branches).not.toContain('origin/HEAD')
  })

  it('All changes: the branch and the work tree against the merge-base, with the new files, not main\'s later commit', async () => {
    const { repos } = await call(changesList, { projectId: 'p', ticket, scope: { kind: 'all' } })
    const [changes] = repos
    expect(changes!.error).toBeNull()
    expect(changes!.base).toEqual({ ref: 'origin/main', from: 'worktree.base', mergeBase: base })
    expect(changes!.workTree).toBe(true)
    const byPath = Object.fromEntries(changes!.files.map((file) => [file.path, file]))
    expect(Object.keys(byPath).sort()).toEqual(
      ['.scratch/ep/issues/02-x.md', 'a.txt', 'b c.txt', 'big.txt', 'crlf.txt', 'gen/api.ts', 'logo.bin', 'moved ü.txt', 'new ü file.txt', 'notes/с пробелом.md', 'pnpm-lock.yaml', 'run.sh'].sort(),
    )
    expect(byPath['a.txt']).toMatchObject({ status: 'M', additions: 2, deletions: 2, untracked: false, fold: null })
    expect(byPath['moved ü.txt']).toMatchObject({ status: 'R', oldPath: 'move.txt', additions: 1, deletions: 0 })
    expect(byPath['logo.bin']).toMatchObject({ binary: true, additions: null, deletions: null })
    expect(byPath['new ü file.txt']).toMatchObject({ status: 'A', untracked: true, additions: 1, deletions: 0 })
    expect(byPath['new ü file.txt']!.newBlob).toMatch(/^[0-9a-f]{40}$/u)
    expect(byPath['.scratch/ep/issues/02-x.md']).toMatchObject({ workflow: true })
    expect(byPath['a.txt']!.workflow).toBe(false)
    expect(byPath['pnpm-lock.yaml']!.fold).toBe('lock')
    expect(byPath['gen/api.ts']!.fold).toBe('generated')
    expect(byPath['big.txt']).toMatchObject({ fold: 'large', additions: 2_100 })
    expect(byPath['run.sh']).toMatchObject({ oldMode: '100644', newMode: '100755', additions: 0, deletions: 0 })
    expect(changes!.files.map((file) => file.path)).not.toContain('keep.txt')
  })

  it('a file of All changes: its hunks with the numbers of both sides; CRLF, a binary file, a folded one, a new file', async () => {
    const file = async (path: string, extra: Record<string, unknown> = {}) => (await call(changesFile, { projectId: 'p', ticket, repo: 'repo', scope: { kind: 'all' }, path, ...extra })).file
    const a = await file('a.txt')
    expect(a.kind).toBe('hunks')
    if (a.kind !== 'hunks') return
    const lines = a.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind !== 'context')
    expect(lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text])).toEqual([
      ['del', 5, null, 'line 5'],
      ['add', null, 5, 'line five'],
      ['del', 20, null, 'line 20'],
      ['add', null, 20, 'line twenty'],
    ])
    const whole = await file('a.txt', { whole: true })
    expect(whole.kind === 'hunks' && whole.whole && whole.hunks.flatMap((hunk) => hunk.lines).length).toBe(32)

    const crlf = await file('crlf.txt')
    expect(crlf.kind === 'hunks' && crlf.hunks[0]!.lines.map((line) => [line.kind, line.text, line.crlf])).toEqual([
      ['context', 'one', true],
      ['del', 'two', true],
      ['add', 'TWO', true],
      ['context', 'three', true],
    ])
    expect(await file('logo.bin')).toEqual({ kind: 'binary', path: 'logo.bin', oldSize: 4, newSize: 6 })
    expect(await file('big.txt')).toEqual({ kind: 'folded', path: 'big.txt', reason: 'large', lines: 2_100 })
    const shown = await file('big.txt', { expand: true })
    expect(shown.kind === 'hunks' && shown.hunks[0]!.lines.length).toBe(2_100)
    expect(await file('pnpm-lock.yaml')).toMatchObject({ kind: 'folded', reason: 'lock' })

    const renamed = await file('moved ü.txt', { oldPath: 'move.txt' })
    expect(renamed).toMatchObject({ kind: 'hunks', oldPath: 'move.txt' })
    const fresh = await file('notes/с пробелом.md', { untracked: true })
    expect(fresh.kind === 'hunks' && fresh.hunks[0]!.lines.map((line) => [line.kind, line.newLine, line.text, line.noNewline])).toEqual([
      ['add', 1, 'note', false],
      ['add', 2, 'no newline', true],
    ])
  })

  it('Uncommitted: only what is not committed, with the new files', async () => {
    const [changes] = (await call(changesList, { projectId: 'p', ticket, scope: { kind: 'uncommitted' } })).repos
    expect(changes!.base).toBeNull()
    expect(changes!.files.map((file) => [file.path, file.untracked])).toEqual([
      ['a.txt', false],
      ['new ü file.txt', true],
      ['notes/с пробелом.md', true],
    ])
    expect(changes!.files[0]).toMatchObject({ additions: 1, deletions: 1 })
  })

  it('Commit: the Ticket\'s commits newest first, and one commit\'s files', async () => {
    const { commits, base: logBase } = await call(changesCommits, { projectId: 'p', ticket, repo: 'repo' })
    expect(logBase.mergeBase).toBe(base)
    expect(commits.map((each) => [each.sha, each.subject])).toEqual([
      [secondOnBranch, 'second'],
      [firstOnBranch, 'first'],
    ])
    const [changes] = (await call(changesList, { projectId: 'p', ticket, scope: { kind: 'commit', repo: 'repo', sha: secondOnBranch } })).repos
    expect(changes!.files.map((file) => file.path)).toEqual(['b c.txt', 'big.txt'])
    const file = (await call(changesFile, { projectId: 'p', ticket, repo: 'repo', scope: { kind: 'commit', repo: 'repo', sha: secondOnBranch }, path: 'b c.txt' })).file
    expect(file.kind === 'hunks' && file.hunks[0]!.lines).toMatchObject([{ kind: 'add', newLine: 1, text: 'two words' }])
  })

  it('Compare against: another branch in place of the base', async () => {
    const [changes] = (await call(changesList, { projectId: 'p', ticket, scope: { kind: 'compare', repo: 'repo', ref: 'main' } })).repos
    expect(changes!.base).toMatchObject({ ref: 'main', from: 'compare', mergeBase: base })
    expect(changes!.files.map((file) => file.path)).toContain('b c.txt')
    const [none] = (await call(changesList, { projectId: 'p', ticket, scope: { kind: 'compare', repo: 'repo', ref: 'no-such-branch' } })).repos
    expect(none!.error).toMatch(/No branch no-such-branch/u)
  })

  it('wrote nothing into the repository: the index, its bytes and mtime, refs, objects and locks are as before', async () => {
    // Every read once more, with Hide whitespace too, then the comparison.
    for (const scope of [{ kind: 'all' }, { kind: 'uncommitted' }, { kind: 'commit', repo: 'repo', sha: firstOnBranch }, { kind: 'compare', repo: 'repo', ref: 'other' }]) {
      await call(changesList, { projectId: 'p', ticket, scope, hideWhitespace: true })
      await call(changesFile, { projectId: 'p', ticket, repo: 'repo', scope, path: 'a.txt', whole: true })
    }
    await call(changesScopes, { projectId: 'p', ticket })
    const after = snapshot(join(repo, '.git'))
    expect(after.indexes).toEqual(before.indexes)
    expect(after.files).toEqual(before.files)
    expect(Object.keys(before.indexes).sort()).toEqual(['index', 'worktrees/02/index'])

    // The check sees a write: a plain git diff in the worktree refreshes the stat data and writes its index.
    execFileSync('git', ['diff'], { cwd: tree, env: { ...process.env, ...NO_GIT_MAINTENANCE, GIT_OPTIONAL_LOCKS: '0', HOME: root, USERPROFILE: root, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'ignore' })
    expect(snapshot(join(repo, '.git')).indexes['worktrees/02/index']).not.toBe(before.indexes['worktrees/02/index'])
  })

  it('refuses a command that writes before git starts', async () => {
    expect(refusal(['add', '-A'])).toMatch(/not a reading command/u)
    expect(refusal(['fetch'])).not.toBeNull()
    expect(refusal(['stash'])).not.toBeNull()
    expect(refusal(['update-index', '--refresh'])).not.toBeNull()
    expect(refusal(['hash-object', '-w', 'a.txt'])).toMatch(/-w/u)
    expect(refusal(['diff', '--output=x.patch'])).toMatch(/--output/u)
    expect(refusal(['diff', 'HEAD', '--', '--output=x'])).toBeNull()
    const refused = await git(tree, ['stash'])
    expect(refused).toMatchObject({ code: null, stdout: '' })
  })
})

describe('a Ticket in two repositories of one Project, on a branch checked out nowhere', () => {
  let api: string
  let web: string
  let call: ReturnType<typeof caller>
  let before: { api: ReturnType<typeof snapshot>; web: ReturnType<typeof snapshot> }

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-changes-repos-')))
    ownGitHome()
    const repoWith = (name: string, file: string): string => {
      const dir = join(root, name)
      mkdirSync(dir)
      gitIn(dir, 'init', '-q')
      commit(dir, 'start', { [file]: 'one\n' })
      gitIn(dir, 'checkout', '-q', '-b', 'ep/03')
      commit(dir, 'ticket 03', { [file]: 'one\ntwo\n', [`${name}-new.txt`]: 'new\n' })
      gitIn(dir, 'checkout', '-q', 'main')
      return dir
    }
    api = repoWith('api', 'server.ts')
    web = repoWith('web', 'page.tsx')
    const docs = join(root, 'docs')
    mkdirSync(docs)
    gitIn(docs, 'init', '-q')
    commit(docs, 'start', { 'README.md': 'docs\n' })
    const workspace = root
    const layout: ProjectLayout = {
      ...fullLayout(workspace),
      mode: 'silent',
      workspace,
      repos: [
        { name: 'api', path: api },
        { name: 'web', path: web },
        { name: 'docs', path: docs },
      ],
      finish: 'local-green',
    }
    call = caller(changesHandlers({ project: async () => ({ root: workspace, layout }), git }))
    before = { api: snapshot(join(api, '.git')), web: snapshot(join(web, '.git')) }
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    removeTestTree(root)
  })

  it('answers per repository: the repository is the top level; one without the branch is left out', async () => {
    const t03 = { epic: 'ep', num: 3 }
    const scopes = await call(changesScopes, { projectId: 'p', ticket: t03 })
    expect(scopes.repos.map((entry) => [entry.repo, entry.kind, entry.branch, entry.base?.ref, entry.base?.from, entry.scopes])).toEqual([
      ['api', 'branch', 'ep/03', 'main', 'local', ['all', 'commit', 'compare']],
      ['web', 'branch', 'ep/03', 'main', 'local', ['all', 'commit', 'compare']],
    ])
    const { repos } = await call(changesList, { projectId: 'p', ticket: t03, scope: { kind: 'all' } })
    expect(repos.map((entry) => [entry.repo, entry.workTree, entry.files.map((file) => `${file.status} ${file.path} +${String(file.additions)} -${String(file.deletions)}`)])).toEqual([
      ['api', false, ['A api-new.txt +1 -0', 'M server.ts +1 -0']],
      ['web', false, ['M page.tsx +1 -0', 'A web-new.txt +1 -0']],
    ])
    expect(repos.every((entry) => entry.files.every((file) => !file.workflow))).toBe(true)
    const file = (await call(changesFile, { projectId: 'p', ticket: t03, repo: 'web', scope: { kind: 'all' }, path: 'page.tsx' })).file
    expect(file.kind === 'hunks' && file.hunks[0]!.lines.map((line) => [line.kind, line.text])).toEqual([
      ['context', 'one'],
      ['add', 'two'],
    ])
    const { commits } = await call(changesCommits, { projectId: 'p', ticket: t03, repo: 'api' })
    expect(commits.map((each) => each.subject)).toEqual(['ticket 03'])
    await expect(call(changesCommits, { projectId: 'p', ticket: t03, repo: 'docs' })).rejects.toThrow(/no worktree or branch in docs/u)

    expect(snapshot(join(api, '.git'))).toEqual(before.api)
    expect(snapshot(join(web, '.git'))).toEqual(before.web)
  })
})
