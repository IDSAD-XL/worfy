// The git branch of a Terminal's folder for a Terminal AI request (src/main/terminal-ai/git-branch.ts),
// on real repositories in a temporary folder: the branch is read from the repository's files, with no
// git process, and gives what a real `git branch --show-current` prints. A git stand-in on the PATH
// records that it was started and then sleeps: on a loaded machine git did not answer within the
// limit, and the request went without a branch (worfy-terminal-ai ticket 17).
//
// HOME of every real git call is the temporary folder: the tester's ~/.gitconfig is never read.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitBranch, gitDirFromFile, readHead } from '../../src/main/terminal-ai/git-branch'
import { removeTestTree } from '../remove'
import { shellStub } from '../shell-stub'
import { ms } from '../time-scale'

const WINDOWS = process.platform === 'win32'
/** Longer than the 1000 ms limit of the git process, so a stand-in that is waited for gives null. */
const STUB_SLEEP_S = 3

let root: string
let stubBin: string
let started: string

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-git-branch-')))
  stubBin = join(root, 'stub-bin')
  mkdirSync(stubBin)
  started = join(root, 'git-started')
})

afterEach(() => {
  vi.unstubAllEnvs()
  removeTestTree(root)
})

/** The real git, with the tester's own configuration out of the way. */
function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env, HOME: root, USERPROFILE: root, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
  return execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'protocol.file.allow=always', ...args],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

/** What the real `git branch --show-current` prints in `cwd`; null for an empty answer or an error. */
function showCurrent(cwd: string): string | null {
  try {
    const branch = git(cwd, 'branch', '--show-current')
    return branch === '' ? null : branch
  } catch {
    return null
  }
}

function repo(name: string, branch = 'main'): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

/**
 * Puts a git stand-in first on the PATH of this process, so gitBranch's git process is the
 * stand-in. `lines` run after the stand-in has recorded that it was started. Real git calls of the
 * test come before this (the stand-in would answer them too). The rest of the PATH stays after it:
 * the stand-in's `sleep` is found there. On Windows, which does not start a /bin/sh script as a
 * program, the stand-in is alone on the PATH instead, so no git process can answer at all: a branch
 * that comes back was read from the files.
 */
function stubGit(lines: string[]): void {
  shellStub(join(stubBin, 'git'), [`: >'${started}'`, ...lines])
  vi.stubEnv('PATH', WINDOWS ? stubBin : `${stubBin}${delimiter}${process.env.PATH ?? ''}`)
}

describe('gitBranch', () => {
  it('reads the branch from the files of the repository and never starts git', { timeout: ms(10_000) }, async () => {
    const dir = repo('plain', 'feature/deep/name')
    stubGit([`exec sleep ${STUB_SLEEP_S}`])

    expect(await gitBranch(dir)).toBe('feature/deep/name')
    expect(existsSync(started)).toBe(false)
  })

  it('answers as `git branch --show-current` does, without a git process', { timeout: ms(30_000) }, async () => {
    const main = repo('main')
    const nested = join(main, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    const worktree = join(root, 'wt')
    git(main, 'worktree', 'add', '-q', '-b', 'wt/x', worktree)
    const inWorktree = join(worktree, 'c')
    mkdirSync(inWorktree)
    const detached = repo('detached')
    git(detached, 'checkout', '-q', '--detach')
    git(main, 'submodule', 'add', '-q', repo('library'), 'sub-detached')
    const subDetached = join(main, 'sub-detached')
    git(subDetached, 'checkout', '-q', '--detach')
    git(main, 'submodule', 'add', '-q', repo('library-2'), 'sub-on-branch')
    const subOnBranch = join(main, 'sub-on-branch')
    git(subOnBranch, 'checkout', '-q', '-b', 'sub/branch')
    const inSubmodule = join(subOnBranch, 'd')
    mkdirSync(inSubmodule)
    const outside = join(root, 'outside')
    mkdirSync(outside)

    const cases: [string, string, string | null][] = [
      ['a plain repository', main, 'main'],
      ['a folder nested in a repository', nested, 'main'],
      ['a worktree', worktree, 'wt/x'],
      ['a folder nested in a worktree', inWorktree, 'wt/x'],
      ['a detached HEAD', detached, null],
      ['a submodule with a detached HEAD', subDetached, null],
      ['a submodule on a branch', subOnBranch, 'sub/branch'],
      ['a folder nested in a submodule', inSubmodule, 'sub/branch'],
    ]
    for (const [name, cwd, branch] of cases) expect(showCurrent(cwd), `real git, ${name}`).toBe(branch)
    expect(showCurrent(outside), 'real git, a folder outside any repository').toBeNull()

    stubGit([`exec sleep ${STUB_SLEEP_S}`])
    for (const [name, cwd, branch] of cases) expect(await gitBranch(cwd), name).toBe(branch)
    expect(existsSync(started)).toBe(false)
    // No `.git` up to the root of the disk: the git process answers (below), here past its limit.
    expect(await gitBranch(outside), 'a folder outside any repository').toBeNull()
  })

  // The stand-in is a /bin/sh script, which Windows does not start as a program: these run where it does.
  describe.skipIf(WINDOWS)('a folder the files do not answer for goes to the git process', () => {
    // GIT_DIR and the like can still name a repository for it: git decides, not the files.
    it('a folder outside any repository', { timeout: ms(10_000) }, async () => {
      const outside = join(root, 'outside')
      mkdirSync(outside)
      stubGit(['echo from-git-process'])

      expect(await gitBranch(outside)).toBe('from-git-process')
      expect(existsSync(started)).toBe(true)
    })

    it.each([
      ['an empty HEAD', ''],
      ['a HEAD with garbage', 'not a ref\n'],
      ['a HEAD of a reftable repository', 'ref: refs/heads/.invalid\n'],
      ['a HEAD outside refs/heads', 'ref: refs/remotes/origin/main\n'],
    ])('%s', { timeout: ms(10_000) }, async (_name, head) => {
      const dir = repo('broken')
      writeFileSync(join(dir, '.git', 'HEAD'), head)
      stubGit(['echo from-git-process'])

      expect(await gitBranch(dir)).toBe('from-git-process')
      expect(existsSync(started)).toBe(true)
    })

    it('gives null when that git process does not answer within its limit', { timeout: ms(10_000) }, async () => {
      const dir = repo('broken')
      writeFileSync(join(dir, '.git', 'HEAD'), '')
      stubGit([`exec sleep ${STUB_SLEEP_S}`])

      expect(await gitBranch(dir)).toBeNull()
      expect(existsSync(started)).toBe(true)
    })
  })
})

describe('readHead', () => {
  it.each([
    ['ref: refs/heads/main\n', { branch: 'main' }],
    ['ref: refs/heads/feature/x\r\n', { branch: 'feature/x' }],
    ['ref:refs/heads/tight', { branch: 'tight' }],
    [`${'a'.repeat(40)}\n`, { detached: true }],
    [`${'0123456789abcdef'.repeat(4)}\n`, { detached: true }],
    ['', null],
    ['garbage', null],
    ['ref: refs/heads/.invalid\n', null],
    ['ref: refs/heads/\n', null],
    ['ref: refs/heads/a..b\n', null],
    ['ref: refs/heads/a.lock\n', null],
    ['ref: refs/tags/v1\n', null],
  ])('%j', (content, head) => {
    expect(readHead(content)).toEqual(head)
  })
})

describe('gitDirFromFile', () => {
  it('follows an absolute and a relative gitdir, with Windows paths too', () => {
    // The path module is given on every line: Windows' own path reads `/repo` as a folder of the current drive.
    expect(gitDirFromFile('gitdir: /repo/.git/worktrees/x\n', '/wt', posix)).toBe('/repo/.git/worktrees/x')
    expect(gitDirFromFile('gitdir: ../.git/modules/sub\n', '/repo/sub', posix)).toBe('/repo/.git/modules/sub')
    expect(gitDirFromFile('gitdir: C:/repo/.git/worktrees/x\r\n', 'D:\\wt', win32)).toBe('C:\\repo\\.git\\worktrees\\x')
    expect(gitDirFromFile('gitdir: C:\\repo\\.git\\worktrees\\x\n', 'D:\\wt', win32)).toBe('C:\\repo\\.git\\worktrees\\x')
    expect(gitDirFromFile('gitdir: ../.git/modules/sub\n', 'C:\\repo\\sub', win32)).toBe('C:\\repo\\.git\\modules\\sub')
    expect(gitDirFromFile('gitdir: ..\\.git\\modules\\sub\n', 'C:\\repo\\sub', win32)).toBe('C:\\repo\\.git\\modules\\sub')
    // A path from the root without a drive is on the drive of the folder that holds `.git`, as git reads it there.
    expect(gitDirFromFile('gitdir: /repo/.git/worktrees/x\n', 'E:\\wt', win32)).toBe('E:\\repo\\.git\\worktrees\\x')
  })

  it('gives null for a .git file in another form', () => {
    expect(gitDirFromFile('', '/repo')).toBeNull()
    expect(gitDirFromFile('gitdir:\n', '/repo')).toBeNull()
    expect(gitDirFromFile('something else\n', '/repo')).toBeNull()
  })
})
