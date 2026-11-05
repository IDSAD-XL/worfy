// Where a target of an approval request lies (worfy-auto-approve ticket 03): roots, hard areas,
// symbolic links, globs and the Windows path forms. Links and globs are checked on a fixture folder on
// disk (made under the system's temporary folder, removed after); the rest on made-up paths under
// /tmp/demo, /home/demo and C:\work with a file system where nothing exists.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizePath, repositoryTop, resolveTarget, rootsOf, type FileSystem, type Roots, type RootsInput } from '../../src/main/agent/auto-approve/roots'
import { newTempFolderName } from '../../src/main/agent/auto-approve/shell'
import { removeTestTree } from '../remove'

const nothing: FileSystem = { lstat: () => null, realpath: () => null, readdir: () => null }

const base: RootsInput = {
  platform: 'linux',
  worktrees: ['/tmp/demo/repo/.claude/worktrees/03'],
  scratch: '/tmp/demo/repo/.scratch',
  runTemp: '/tmp/demo/data/autopilot-tmp/demo-run',
  scratchpad: '/tmp/demo/pad',
  home: '/home/demo',
  dataDir: '/tmp/demo/data',
  harnessHome: '/tmp/demo/harness',
  otherSessions: ['/tmp/demo/other'],
  otherWorktrees: ['/tmp/demo/repo/.claude/worktrees/07'],
  fs: nothing,
}
const roots = rootsOf(base)
const kind = (path: string, use: 'read' | 'write' | 'delete' = 'write', where: Roots = roots): string => {
  const placement = resolveTarget(path, where, use)
  return placement.kind === 'hard' ? `hard:${placement.category}` : placement.kind === 'inside' || placement.kind === 'is-root' ? `${placement.kind}:${placement.root.kind}` : placement.kind
}

describe('roots and hard areas on made-up paths', () => {
  it('places a path inside each root, and the root itself', () => {
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/src/a.ts')).toBe('inside:worktree')
    expect(kind('/tmp/demo/repo/.scratch/x/notes.md')).toBe('inside:scratch')
    expect(kind('/tmp/demo/data/autopilot-tmp/demo-run/x')).toBe('inside:run-temp')
    expect(kind('/tmp/demo/pad/s.sh')).toBe('inside:scratchpad')
    expect(kind('/tmp/demo/repo/.claude/worktrees/03')).toBe('is-root:worktree')
    expect(kind('/tmp/demo/repo/.scratch/')).toBe('is-root:scratch')
  })

  it('is outside elsewhere, beside a root and for a path that is not absolute', () => {
    expect(kind('/tmp/demo/repo/src/a.ts')).toBe('outside')
    expect(kind('/tmp/demo/repo/.claude/worktrees/031/a')).toBe('outside')
    expect(kind('relative/a')).toBe('outside')
    expect(kind('<unknown>')).toBe('outside')
  })

  it('folds . and .. before placing', () => {
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/../secret')).toBe('outside')
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/./src/../a.ts')).toBe('inside:worktree')
    expect(kind('/tmp/demo/repo/.scratch/x/../..')).toBe('outside')
    expect(kind('/tmp/demo/pad/../../../home/demo/.ssh/id')).toBe('hard:ssh')
    expect(kind('/../../tmp/demo/pad/x')).toBe('inside:scratchpad')
    expect(kind('/tmp/demo/pad/x/../y')).toBe('inside:scratchpad')
  })

  it('places a missing file inside a root (a revision such as HEAD~3 too)', () => {
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/HEAD~3', 'read')).toBe('inside:worktree')
  })

  it('hard-denies the secrets and settings of the home folder, for reads too', () => {
    for (const [path, category] of [
      ['/home/demo/.claude/settings.json', 'claude-home'],
      ['/home/demo/.codex', 'codex-home'],
      ['/home/demo/.ssh/id_demo', 'ssh'],
      ['/home/demo/.gnupg/x', 'gnupg'],
      ['/home/demo/.config/gh/hosts.yml', 'gh-config'],
      ['/home/demo/.gitconfig', 'git-config'],
      ['/home/demo/.config/git/config', 'git-config'],
      ['/home/demo/.git-credentials', 'git-config'],
      ['/home/demo/.npmrc', 'npmrc'],
      ['/home/demo/.zshrc', 'shell-rc'],
      ['/home/demo/.zshenv', 'shell-rc'],
      ['/home/demo/.bashrc', 'shell-rc'],
      ['/home/demo/.profile', 'shell-rc'],
      ...['.zprofile', '.zlogin', '.zlogout', '.bash_profile', '.bash_login', '.bash_logout', '.inputrc'].map((name) => [`/home/demo/${name}`, 'shell-rc'] as const),
      ['/home/demo/Library/Keychains/x', 'library'],
      ['/tmp/demo/data/app-settings.json', 'worfy-data'],
    ] as const) {
      expect(kind(path), path).toBe(`hard:${category}`)
      expect(kind(path, 'read'), path).toBe(`hard:${category}`)
    }
  })

  it('hard-denies changing another Session\'s or worktree\'s files and the Harness, but not reading them', () => {
    expect(kind('/tmp/demo/other/a.ts')).toBe('hard:other-session')
    expect(kind('/tmp/demo/repo/.claude/worktrees/07/a.ts', 'delete')).toBe('hard:other-worktree')
    expect(kind('/tmp/demo/harness/bin/x')).toBe('hard:harness-home')
    expect(kind('/tmp/demo/other/a.ts', 'read')).toBe('outside')
    expect(kind('/tmp/demo/harness/bin/x', 'read')).toBe('outside')
  })

  it('hard-denies a delete of a folder that holds a hard area, while a write there is only outside', () => {
    expect(kind('/home/demo', 'delete')).toBe('hard:claude-home')
    expect(kind('/home', 'delete')).toBe('hard:claude-home')
    expect(kind('/home/demo', 'write')).toBe('outside')
    expect(kind('/home/demo/notes.txt', 'delete')).toBe('outside')
    // A delete of a folder that holds a root takes the root with it.
    expect(kind('/tmp/demo/repo/.claude/worktrees', 'delete', rootsOf({ ...base, otherWorktrees: [] }))).toBe('is-root:worktree')
    expect(kind('/tmp/demo/repo/.claude/worktrees', 'write', rootsOf({ ...base, otherWorktrees: [] }))).toBe('outside')
  })

  it('judges a write when no use is given', () => {
    expect(resolveTarget('/tmp/demo/other/a.ts', roots).kind).toBe('hard')
  })

  it('the longest area wins: the Run\'s folder inside worfy\'s data is a root', () => {
    expect(kind('/tmp/demo/data/autopilot-tmp/demo-run/x', 'delete')).toBe('inside:run-temp')
    expect(kind('/tmp/demo/data/autopilot-tmp/other-run/x')).toBe('hard:worfy-data')
    // A hard area and a root of the same path: hard.
    const same = rootsOf({ ...base, otherSessions: ['/tmp/demo/pad'] })
    expect(kind('/tmp/demo/pad/x', 'write', same)).toBe('hard:other-session')
  })

  it('honours XDG_CONFIG_HOME and %APPDATA%', () => {
    const xdg = rootsOf({ ...base, xdgConfigHome: '/tmp/demo/xdg' })
    expect(kind('/tmp/demo/xdg/gh/hosts.yml', 'read', xdg)).toBe('hard:gh-config')
    expect(kind('/tmp/demo/xdg/git/config', 'read', xdg)).toBe('hard:git-config')
    expect(kind('/gh/x', 'read', rootsOf({ ...base, xdgConfigHome: '' }))).toBe('outside')
  })

  it('macOS: hard areas ignore case, roots do not', () => {
    const mac = rootsOf({ ...base, platform: 'darwin' })
    expect(kind('/home/demo/.SSH/id', 'read', mac)).toBe('hard:ssh')
    expect(kind('/tmp/demo/PAD/x', 'write', mac)).toBe('outside')
    expect(kind('/home/demo/.SSH/id', 'read')).toBe('outside')
    expect(kind('/home/DEMO', 'delete', mac)).toBe('hard:claude-home')
  })
})

describe('Windows', () => {
  const win = rootsOf({
    ...base,
    platform: 'win32',
    worktrees: ['C:\\work\\repo\\.claude\\worktrees\\03'],
    scratch: 'c:/work/repo/.scratch',
    runTemp: 'C:\\Users\\demo\\AppData\\Roaming\\worfy\\autopilot-tmp\\demo-run',
    scratchpad: null,
    home: 'C:\\Users\\demo',
    appData: 'C:\\Users\\demo\\AppData\\Roaming',
    dataDir: 'C:\\Users\\demo\\AppData\\Roaming\\worfy',
    harnessHome: null,
    otherSessions: [],
    otherWorktrees: ['C:\\work\\repo'],
  })
  it('takes \\ and / as one separator, /c/… as C:\\…, and ignores case', () => {
    expect(kind('C:\\work\\repo\\.claude\\worktrees\\03\\a', 'write', win)).toBe('inside:worktree')
    expect(kind('c:/WORK/repo/.claude/worktrees/03/a', 'write', win)).toBe('inside:worktree')
    expect(kind('/c/work/repo/.claude/worktrees/03/a', 'write', win)).toBe('inside:worktree')
    expect(kind('/C/Work/Repo/.Scratch', 'write', win)).toBe('is-root:scratch')
    expect(kind('C:\\work\\repo\\.claude\\worktrees\\03\\..\\..\\x', 'write', win)).toBe('hard:other-worktree')
  })
  it('hard-denies %APPDATA% and the secrets whatever the case, but not the Run\'s folder', () => {
    expect(kind('c:\\users\\DEMO\\.ssh\\id', 'read', win)).toBe('hard:ssh')
    expect(kind('/c/Users/demo/AppData/Roaming/Code/x', 'write', win)).toBe('hard:appdata')
    expect(kind('C:/Users/demo/AppData/Roaming/worfy/app-settings.json', 'write', win)).toBe('hard:worfy-data')
    expect(kind('C:/Users/demo/AppData/Roaming/worfy/autopilot-tmp/demo-run/x', 'delete', win)).toBe('inside:run-temp')
  })
  it('is outside for a UNC path and a path without a drive', () => {
    expect(kind('\\\\server\\share\\x', 'write', win)).toBe('outside')
    expect(kind('work\\x', 'write', win)).toBe('outside')
  })
  it('normalizes the drive letter and the separators', () => {
    expect(normalizePath('/c/x/./y/../z', true)).toBe('C:\\x\\z')
    expect(normalizePath('c:/', true)).toBe('C:\\')
    expect(normalizePath('/tmp//a/./b/', false)).toBe('/tmp/a/b')
  })
})

describe('a file system that answers with errors', () => {
  const failing = (bad: string): FileSystem => ({
    lstat: (path) => (path === bad ? 'error' : path.startsWith(`${bad}/`) ? null : 'dir'),
    realpath: () => null,
    readdir: () => [],
  })
  it('a component that cannot be told is outside', () => {
    expect(kind('/tmp/demo/pad/x/y', 'write', rootsOf({ ...base, fs: failing('/tmp/demo/pad/x') }))).toBe('outside')
  })
  it('a link whose target cannot be resolved is outside, a configured one too', () => {
    const dangling = (at: string): FileSystem => ({ lstat: (path) => (path === at ? 'link' : 'dir'), realpath: () => null, readdir: () => [] })
    expect(kind('/tmp/demo/pad/x', 'write', rootsOf({ ...base, fs: dangling('/tmp') }))).toBe('outside')
    expect(kind('/tmp/demo/pad/x', 'write', rootsOf({ ...base, fs: dangling('/tmp/demo/pad') }))).toBe('outside')
  })
  it('no top of a repository on an error or for a relative folder', () => {
    expect(repositoryTop('/tmp/demo/pad/x/y', rootsOf({ ...base, fs: failing('/tmp/demo/pad/x') }))).toBeNull()
    const gitError: FileSystem = { lstat: (path) => (path.endsWith('.git') ? 'error' : 'dir'), realpath: () => null, readdir: () => [] }
    expect(repositoryTop('/tmp/demo/pad', rootsOf({ ...base, fs: gitError }))).toBeNull()
    expect(repositoryTop('relative', roots)).toBeNull()
  })
  it('a folder too big to look through is outside', () => {
    const big = (count: number): FileSystem => ({ lstat: (path) => (path.endsWith('.txt') ? 'file' : 'dir'), realpath: () => null, readdir: () => Array.from({ length: count }, (_, n) => `${n}.txt`) })
    expect(kind('/tmp/demo/pad/x/*', 'delete', rootsOf({ ...base, fs: big(10_000) }))).toBe('inside:scratchpad')
    expect(kind('/tmp/demo/pad/x/*', 'delete', rootsOf({ ...base, fs: big(10_001) }))).toBe('outside')
  })
})

describe('the machine\'s file system', () => {
  let top = ''
  beforeAll(() => {
    top = mkdtempSync(join(tmpdir(), 'auto-approve-fs-'))
    writeFileSync(join(top, 'f'), 'f')
    mkdirSync(join(top, 'd'))
    symlinkSync(join(top, 'd'), join(top, 'l'), process.platform === 'win32' ? 'junction' : 'dir')
  })
  afterAll(() => {
    removeTestTree(top)
  })
  it('tells files, folders, links and nothing apart', () => {
    const fs = rootsOf({ ...base, fs: undefined }).fs
    expect(fs.lstat(join(top, 'f'))).toBe('file')
    expect(fs.lstat(join(top, 'd'))).toBe('dir')
    expect(fs.lstat(join(top, 'l'))).toBe('link')
    expect(fs.lstat(join(top, 'missing'))).toBeNull()
    // Below a file: ENOTDIR, not an error.
    expect(fs.lstat(join(top, 'f', 'x'))).toBeNull()
    expect(fs.realpath(join(top, 'missing'))).toBeNull()
    expect(fs.readdir(join(top, 'missing'))).toBeNull()
    expect(fs.readdir(join(top, 'f'))).toBeNull()
    expect(fs.readdir(top)?.sort()).toEqual(['d', 'f', 'l'])
  })
})

describe('the new folder of mktemp -d', () => {
  it('is inside the Run\'s folder and empty, so a glob in it is inside', () => {
    const folder = `/tmp/demo/data/autopilot-tmp/demo-run/${newTempFolderName(1)}`
    expect(kind(folder)).toBe('inside:run-temp')
    expect(kind(`${folder}/*`, 'delete')).toBe('inside:run-temp')
  })
  it('elsewhere a glob in a folder that cannot be read is outside', () => {
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/build/*', 'delete')).toBe('outside')
    expect(kind(`/tmp/demo/elsewhere/${newTempFolderName(1)}/*`, 'delete')).toBe('outside')
  })
})

describe('on disk: links and globs', () => {
  let top = ''
  let disk: Roots
  // Junctions on Windows: a folder link needs no rights there.
  const link = (target: string, path: string): void => symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
  beforeAll(() => {
    top = mkdtempSync(join(tmpdir(), 'auto-approve-roots-'))
    const root = join(top, 'wt')
    mkdirSync(join(root, 'fixture'), { recursive: true })
    mkdirSync(join(root, 'plain', 'sub'), { recursive: true })
    mkdirSync(join(root, 'nested', 'sub'), { recursive: true })
    mkdirSync(join(root, 'dotted'), { recursive: true })
    writeFileSync(join(root, 'dotted', 'a.txt'), 'a')
    mkdirSync(join(top, 'outside'), { recursive: true })
    mkdirSync(join(top, 'home', '.ssh'), { recursive: true })
    writeFileSync(join(root, '.git'), 'gitdir: x\n')
    writeFileSync(join(root, 'fixture', 'a.txt'), 'a')
    writeFileSync(join(root, 'plain', 'a.txt'), 'a')
    writeFileSync(join(root, 'plain', '.hidden'), 'h')
    writeFileSync(join(top, 'outside', 'secret'), 's')
    link(join(top, 'outside'), join(root, 'fixture', 'l'))
    link(join(root, 'plain'), join(root, 'inner'))
    link(join(top, 'home', '.ssh'), join(top, 'outside', 'k'))
    link(join(top, 'home'), join(root, 'h'))
    link(join(top, 'outside'), join(root, 'dotted', '.l'))
    // The roots are given as the system's temporary folder spells them (macOS: /var/… through a link).
    disk = rootsOf({ ...base, platform: process.platform, worktrees: [root], scratch: null, runTemp: null, scratchpad: null, home: join(top, 'home'), dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [], fs: undefined })
  })
  afterAll(() => {
    removeTestTree(top)
  })
  const at = (...parts: string[]): string => join(top, ...parts)
  // path.join folds `..`; the target must keep it, as shell.ts writes it.
  const raw = (...parts: string[]): string => [top, ...parts].join(sep)

  it('a link on the configured path of a root is the machine\'s own; the root is inside itself', () => {
    expect(kind(at('wt', 'plain', 'a.txt'), 'write', disk)).toBe('inside:worktree')
    expect(kind(at('wt'), 'write', disk)).toBe('is-root:worktree')
  })

  it('a glob over a folder that holds a.txt and l -> outside is a link on the path', () => {
    expect(kind(at('wt', 'fixture', '*'), 'delete', disk)).toBe('symlink-on-path')
    expect(kind(at('wt', 'fixture', '?'), 'read', disk)).toBe('symlink-on-path')
    // A pattern that cannot match the link: only a.txt.
    expect(kind(at('wt', 'fixture', 'a*'), 'delete', disk)).toBe('inside:worktree')
  })

  it('a glob matches dot files and any case too', () => {
    expect(kind(at('wt', 'plain', '*'), 'delete', disk)).toBe('inside:worktree')
    // A shell with dotglob (bash) or GLOB_DOTS (zsh) set matches .l with *.
    expect(kind(at('wt', 'dotted', '*'), 'delete', disk)).toBe('symlink-on-path')
    expect(kind(at('wt', 'fixture', 'L'), 'read', disk)).toBe(process.platform === 'linux' ? 'inside:worktree' : 'symlink-on-path')
    expect(kind(at('wt', 'fixture', 'L*'), 'read', disk)).toBe('symlink-on-path')
  })

  it('a glob directly in a root is the root', () => {
    expect(kind(at('wt', 'nested', '*'), 'delete', disk)).toBe('inside:worktree')
    const flat = rootsOf({ ...base, platform: process.platform, worktrees: [at('wt', 'nested')], scratch: null, runTemp: null, scratchpad: null, home: null, dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [], fs: undefined })
    expect(kind(at('wt', 'nested', '*'), 'delete', flat)).toBe('is-root:worktree')
  })

  it('a link component inside a root is not inside, wherever it leads', () => {
    expect(kind(at('wt', 'inner', 'a.txt'), 'write', disk)).toBe('symlink-on-path')
    expect(kind(at('wt', 'fixture', 'l', 'secret'), 'read', disk)).toBe('symlink-on-path')
    expect(kind(raw('wt', 'fixture', 'l', '..', 'outside', 'secret'), 'read', disk)).toBe('symlink-on-path')
  })

  it('.. after a link goes up from the link\'s target, not from the link', () => {
    // Lexically wt/fixture/l/../a.txt is wt/fixture/a.txt; the system reads outside/../a.txt.
    expect(kind(raw('wt', 'fixture', 'l', '..', 'a.txt'), 'read', disk)).toBe('symlink-on-path')
    expect(kind(raw('wt', 'fixture', '..', 'plain', 'a.txt'), 'read', disk)).toBe('inside:worktree')
  })

  it('a link that leads into a hard area is hard, from inside a root or from outside', () => {
    expect(kind(at('outside', 'k', 'id'), 'read', disk)).toBe('hard:ssh')
    expect(kind(at('wt', 'h', '*'), 'delete', disk)).toBe('hard:ssh')
    expect(kind(at('wt', 'h'), 'delete', disk)).toBe('hard:ssh')
  })

  it('finds the top of the repository of a folder', () => {
    const found = repositoryTop(at('wt', 'plain', 'sub'), disk)
    expect(found).not.toBeNull()
    expect(kind(found ?? '', 'write', disk)).toBe('is-root:worktree')
    expect(repositoryTop(at('outside'), disk)).toBeNull()
  })
})
