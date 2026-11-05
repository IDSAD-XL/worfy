// Where a target of an approval request lies (worfy-auto-approve ticket 03): roots, hard areas,
// symbolic links, globs and the Windows path forms. Links and globs are checked on a fixture folder on
// disk (made under the system's temporary folder, removed after); the rest on made-up paths under
// /tmp/demo, /home/demo and C:\work with a file system where nothing exists.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copiedTree, nodeFileSystem, normalizePath, recordRoots, repositoryTop, resolveTarget, rootsOf as rootsOfRecorded, type FileSystem, type Roots, type RootsInput } from '../../src/main/agent/auto-approve/roots'
import { newTempFolderName } from '../../src/main/agent/auto-approve/shell'
import { removeTestTree } from '../remove'

const nothing: FileSystem = { lstat: () => null, realpath: () => null, readdir: () => null, readFile: () => null }

/** rootsOf with the real paths of the roots recorded now, as the Run records them when it starts; a root that does not resolve as itself. */
function rootsOf(input: Omit<RootsInput, 'recorded'> & { recorded?: RootsInput['recorded'] }): Roots {
  const paths = [...input.worktrees, input.scratch, input.runTemp, input.scratchpad].filter((path): path is string => path !== null)
  return rootsOfRecorded({ ...input, recorded: input.recorded ?? { ...Object.fromEntries(paths.map((path) => [path, path])), ...recordRoots(paths, input.platform, input.fs) } })
}

const base: Omit<RootsInput, 'recorded'> = {
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

  it('cannot tell where a .. after a folder that does not exist leads; a hard area still wins', () => {
    // Nothing exists in this file system: the system would stop at the first missing folder.
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/../secret')).toBe('not-judged')
    expect(kind('/tmp/demo/repo/.claude/worktrees/03/./src/../a.ts')).toBe('not-judged')
    expect(kind('/tmp/demo/pad/x/../y')).toBe('not-judged')
    expect(kind('/tmp/demo/pad/../../../home/demo/.ssh/id')).toBe('hard:ssh')
    // .. at the top stays at the top, as the system does.
    expect(kind('/../../tmp/demo/pad/x')).toBe('inside:scratchpad')
    expect(kind('/tmp/demo/pad/./x')).toBe('inside:scratchpad')
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
    readFile: () => null,
  })
  it('a component that cannot be told is outside', () => {
    expect(kind('/tmp/demo/pad/x/y', 'write', rootsOf({ ...base, fs: failing('/tmp/demo/pad/x') }))).toBe('outside')
  })
  it('a link whose target cannot be resolved is outside, a configured one too', () => {
    const dangling = (at: string): FileSystem => ({ lstat: (path) => (path === at ? 'link' : 'dir'), realpath: () => null, readdir: () => [], readFile: () => null })
    expect(kind('/tmp/demo/pad/x', 'write', rootsOf({ ...base, fs: dangling('/tmp') }))).toBe('outside')
    expect(kind('/tmp/demo/pad/x', 'write', rootsOf({ ...base, fs: dangling('/tmp/demo/pad') }))).toBe('outside')
  })
  it('no top of a repository on an error or for a relative folder', () => {
    expect(repositoryTop('/tmp/demo/pad/x/y', rootsOf({ ...base, fs: failing('/tmp/demo/pad/x') }))).toBeNull()
    const gitError: FileSystem = { lstat: (path) => (path.endsWith('.git') ? 'error' : 'dir'), realpath: () => null, readdir: () => [], readFile: () => null }
    expect(repositoryTop('/tmp/demo/pad', rootsOf({ ...base, fs: gitError }))).toBeNull()
    expect(repositoryTop('relative', roots)).toBeNull()
  })
  it('a folder too big to look through is outside', () => {
    const big = (count: number): FileSystem => ({ lstat: (path) => (path.endsWith('.txt') ? 'file' : 'dir'), realpath: () => null, readdir: () => Array.from({ length: count }, (_, n) => `${n}.txt`), readFile: () => null })
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
  it('reads a file, and nothing for one that is not there or a folder', () => {
    expect(nodeFileSystem.readFile(join(top, 'f'))).toBe('f')
    expect(nodeFileSystem.readFile(join(top, 'missing'))).toBeNull()
    expect(nodeFileSystem.readFile(join(top, 'd'))).toBeNull()
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
    mkdirSync(join(top, 'realhome'), { recursive: true })
    link(join(top, 'realhome'), join(top, 'homelink'))
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
    // Deleting the home names the first hard area under it, whether it exists (.ssh) or not (.claude).
    expect(kind(at('wt', 'h'), 'delete', disk)).toBe('hard:claude-home')
  })

  it('a hard area that does not exist yet stays hard when the home is behind a link', () => {
    const linked = rootsOf({ ...base, platform: process.platform, worktrees: [at('wt')], scratch: null, runTemp: null, scratchpad: null, home: at('homelink'), dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [], fs: undefined })
    expect(kind(at('realhome', '.npmrc'), 'write', linked)).toBe('hard:npmrc')
    expect(kind(at('realhome', '.config', 'gh', 'hosts.yml'), 'write', linked)).toBe('hard:gh-config')
    expect(kind(at('realhome', 'notes.txt'), 'write', linked)).toBe('outside')
  })

  it('finds the top of the repository of a folder', () => {
    const found = repositoryTop(at('wt', 'plain', 'sub'), disk)
    expect(found).not.toBeNull()
    expect(kind(found ?? '', 'write', disk)).toBe('is-root:worktree')
    expect(repositoryTop(at('outside'), disk)).toBeNull()
  })
})

describe('the system spelling of a path', () => {
  // A folder the system spells otherwise (a Windows short name such as RUNNER~1): /home/SHORT~1 is a plain
  // folder that the system resolves to /home/real. The home is /home/link, a link to /home/real.
  const spelled: FileSystem = {
    lstat: (path) => (path === '/home/link' ? 'link' : path === '/home' || path === '/home/real' || path === '/home/SHORT~1' ? 'dir' : null),
    realpath: (path) => (path === '/home/link' || path === '/home/SHORT~1' || path === '/home/real' ? '/home/real' : path === '/home' || path === '/' ? path : null),
    readdir: () => null,
    readFile: () => null,
  }
  const spelledRoots = rootsOf({ ...base, platform: 'linux', worktrees: ['/work/wt'], scratch: null, runTemp: null, scratchpad: null, home: '/home/link', dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [], fs: spelled })

  it('a target in the other spelling reaches a hard area that does not exist yet', () => {
    expect(kind('/home/SHORT~1/.npmrc', 'write', spelledRoots)).toBe('hard:npmrc')
    expect(kind('/home/real/.ssh/id', 'read', spelledRoots)).toBe('hard:ssh')
    expect(kind('/home/SHORT~1/notes.txt', 'write', spelledRoots)).toBe('outside')
  })
})

/** A file system of `tree` (path → 'dir', 'file' or '-> target'); every folder above a key exists; it counts its calls. */
function treeFs(tree: Record<string, string>): FileSystem & { calls: number } {
  const nodes = new Map<string, string>()
  for (const [path, value] of Object.entries(tree)) {
    nodes.set(path, value)
    for (let up = path.slice(0, path.lastIndexOf('/')); up !== ''; up = up.slice(0, up.lastIndexOf('/'))) if (!nodes.has(up)) nodes.set(up, 'dir')
  }
  nodes.set('/', 'dir')
  const resolve = (path: string, depth = 0): string | null => {
    if (depth > 8) return null
    let current = ''
    for (const part of path.split('/').filter((each) => each !== '')) {
      const next = `${current}/${part}`
      const value = nodes.get(next)
      if (value === undefined) return null
      if (value.startsWith('-> ')) {
        const target = resolve(value.slice(3), depth + 1)
        if (target === null) return null
        current = target
      } else current = next
    }
    return current === '' ? '/' : current
  }
  const fs = {
    calls: 0,
    lstat: (path: string) => {
      fs.calls++
      const value = nodes.get(path)
      return value === undefined ? null : value.startsWith('-> ') ? 'link' as const : value === 'dir' ? 'dir' as const : 'file' as const
    },
    realpath: (path: string) => {
      fs.calls++
      return resolve(path)
    },
    readdir: (path: string) => {
      fs.calls++
      if (nodes.get(path) !== 'dir') return null
      return [...nodes.keys()].filter((each) => each !== path && each.slice(0, each.lastIndexOf('/') || 1) === path).map((each) => each.slice(each.lastIndexOf('/') + 1))
    },
    readFile: () => null,
  }
  return fs
}

describe('roots recorded when the Run started', () => {
  const at = { ...base, worktrees: ['/w/wt'], scratch: '/w/scratch', runTemp: '/var/run-temp', scratchpad: null, otherSessions: [], otherWorktrees: [] }
  it('a root replaced by a link since is no root: what lies under it is symlink-on-path, a hard area under it hard', () => {
    const recorded = { '/w/wt': '/w/wt', '/w/scratch': '/w/scratch', '/var/run-temp': '/private/var/run-temp' }
    const fsys = treeFs({ '/w/wt/a': 'file', '/w/scratch': '-> /home/demo', '/home/demo/Documents/x': 'file', '/home/demo/.ssh/id': 'file', '/var': '-> /private/var', '/private/var/run-temp/x': 'file' })
    const moved = rootsOfRecorded({ ...at, recorded, fs: fsys })
    expect(kind('/w/scratch/Documents/x', 'write', moved)).toBe('symlink-on-path')
    expect(kind('/w/scratch/Documents', 'delete', moved)).toBe('symlink-on-path')
    expect(kind('/w/scratch/.ssh/id', 'read', moved)).toBe('hard:ssh')
    // A root whose configured path was a link when the Run started (macOS /var) stays a root.
    expect(kind('/var/run-temp/x', 'write', moved)).toBe('inside:run-temp')
    expect(kind('/w/wt/a', 'write', moved)).toBe('inside:worktree')
  })
  it('targets are inside a root only by its recorded real path', () => {
    // The worktree was a link to /w/real when the Run started, and still is.
    const kept = rootsOfRecorded({ ...at, scratch: null, runTemp: null, recorded: { '/w/wt': '/w/real' }, fs: treeFs({ '/w/wt': '-> /w/real', '/w/real/a': 'file', '/w/other/a': 'file' }) })
    expect(kind('/w/wt/a', 'write', kept)).toBe('inside:worktree')
    expect(kind('/w/real/a', 'write', kept)).toBe('inside:worktree')
    expect(kind('/w/other/a', 'write', kept)).toBe('outside')
    // Now it leads elsewhere: the root is no root, by either path.
    const moved = rootsOfRecorded({ ...at, scratch: null, runTemp: null, recorded: { '/w/wt': '/w/real' }, fs: treeFs({ '/w/wt': '-> /w/other', '/w/real/a': 'file', '/w/other/a': 'file' }) })
    expect(kind('/w/wt/a', 'write', moved)).toBe('symlink-on-path')
    expect(kind('/w/real/a', 'write', moved)).toBe('outside')
    expect(kind('/w/other/a', 'write', moved)).toBe('outside')
  })
  it('records the real path of a root that does not exist yet from the folder above it', () => {
    const fsys = treeFs({ '/var': '-> /private/var', '/private/var/x': 'dir' })
    expect(recordRoots(['/var/x/new', null, 'relative'], 'linux', fsys)).toEqual({ '/var/x/new': '/private/var/x/new' })
  })
})

describe('the review\'s edges of links and globs', () => {
  it('a hard area that is itself a link is hard by its real path too', () => {
    const fsys = treeFs({ '/home/demo/.ssh': '-> /dot/ssh', '/dot/ssh/id': 'file' })
    const roots = rootsOf({ ...base, fs: fsys })
    expect(kind('/dot/ssh/id', 'read', roots)).toBe('hard:ssh')
  })
  it('a link inside a hard area into a root is hard by its written form', () => {
    const fsys = treeFs({ '/home/demo/.ssh/l': '-> /tmp/demo/pad', '/tmp/demo/pad/x': 'file' })
    const roots = rootsOf({ ...base, fs: fsys })
    expect(kind('/home/demo/.ssh/l/x', 'write', roots)).toBe('hard:ssh')
  })
  it('an existing folder named like a new mktemp folder is looked through', () => {
    const folder = `/tmp/demo/data/autopilot-tmp/demo-run/${newTempFolderName(1)}`
    const fsys = treeFs({ [`${folder}/l`]: '-> /home/demo', [`${folder}/a`]: 'file', '/home/demo/.claude/x': 'file' })
    expect(kind(`${folder}/*`, 'delete', rootsOf({ ...base, fs: fsys }))).toBe('hard:claude-home')
  })
  it('a glob costs one lstat per entry, not a walk from the top', () => {
    const tree: Record<string, string> = {}
    for (let n = 0; n < 500; n++) tree[`/tmp/demo/pad/many/deep/folder/${n}.log`] = 'file'
    const fsys = treeFs(tree)
    const roots = rootsOf({ ...base, fs: fsys })
    fsys.calls = 0
    expect(kind('/tmp/demo/pad/many/deep/folder/*.log', 'delete', roots)).toBe('inside:scratchpad')
    expect(fsys.calls).toBeLessThan(500 + 40)
  })
})

describe('Windows names the system rewrites', () => {
  const win = rootsOf({ ...base, platform: 'win32', worktrees: ['C:\\w\\wt'], scratch: null, runTemp: null, scratchpad: null, home: 'C:\\Users\\demo', dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [] })
  it('a trailing dot or space, a stream, a short name that does not resolve: not judged', () => {
    for (const name of ['.git.', '.git ', '.git::$INDEX_ALLOCATION', 'a:b', 'GIT~1']) expect(kind(`C:\\w\\wt\\${name}\\config`, 'write', win), name).toBe('not-judged')
  })
  it('a hard area wins over a rewritten name', () => {
    expect(kind('C:\\Users\\demo\\.ssh\\x.\\y', 'write', win)).toBe('hard:ssh')
  })
  it('on Linux and macOS such a name is a name', () => {
    expect(kind('/tmp/demo/pad/.git./x', 'write')).toBe('inside:scratchpad')
    expect(kind('/tmp/demo/pad/GIT~1', 'write')).toBe('inside:scratchpad')
  })
})

describe('more edges mutation testing found', () => {
  const at = { ...base, worktrees: ['/w/wt'], scratch: null, scratchpad: null, otherSessions: [], otherWorktrees: [] }
  it('a moved root inside a hard area does not shield it', () => {
    const fsys = treeFs({ '/tmp/demo/data/autopilot-tmp/demo-run': '-> /elsewhere', '/elsewhere/x': 'file', '/tmp/demo/data/x': 'file', '/w/wt/a': 'file' })
    const roots = rootsOfRecorded({ ...at, recorded: { '/w/wt': '/w/wt', '/tmp/demo/data/autopilot-tmp/demo-run': '/tmp/demo/data/autopilot-tmp/demo-run' }, fs: fsys })
    expect(kind('/tmp/demo/data/autopilot-tmp/demo-run/x', 'write', roots)).toBe('hard:worfy-data')
  })
  it('a delete of a folder that holds a root by its real path only', () => {
    const fsys = treeFs({ '/var': '-> /private/var', '/private/var/run-temp/x': 'file', '/w/wt/a': 'file' })
    const roots = rootsOfRecorded({ ...at, runTemp: '/var/run-temp', dataDir: null, recorded: { '/w/wt': '/w/wt', '/var/run-temp': '/private/var/run-temp' }, fs: fsys })
    expect(kind('/private/var', 'delete', roots)).toBe('is-root:run-temp')
  })
  it('Windows: a . component is no rewritten name; an existing rewritten name that stays one is not judged', () => {
    const win = rootsOf({ ...base, platform: 'win32', worktrees: ['C:\\w\\wt'], scratch: null, runTemp: null, scratchpad: null, home: 'C:\\Users\\demo', dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [] })
    expect(kind('C:\\w\\wt\\.\\a', 'write', win)).toBe('inside:worktree')
    const odd: FileSystem = { lstat: (path) => (/^c:\\w(\\wt(\\x\.)?)?$/i.test(path) || /^c:\\$/i.test(path) ? 'dir' : null), realpath: (path) => path, readdir: () => null, readFile: () => null }
    const stays = rootsOf({ ...base, platform: 'win32', worktrees: ['C:\\w\\wt'], scratch: null, runTemp: null, scratchpad: null, home: 'C:\\Users\\demo', dataDir: null, harnessHome: null, otherSessions: [], otherWorktrees: [], fs: odd })
    expect(kind('C:\\w\\wt\\x.\\a', 'write', stays)).toBe('not-judged')
  })
})

describe('what a copy brings along (copiedTree)', () => {
  const roots = (fsys: FileSystem): Roots => rootsOf({ ...base, fs: fsys })
  it('is clean, git-files, or unclear for an error, an unreadable folder or too many entries', () => {
    expect(copiedTree('/tmp/demo/pad/kit', roots(treeFs({ '/tmp/demo/pad/kit/a/b.txt': 'file' })))).toBe('clean')
    expect(copiedTree('/tmp/demo/pad/kit', roots(treeFs({ '/tmp/demo/pad/kit/a/.GITMODULES': 'file' })))).toBe('git-files')
    expect(copiedTree('/tmp/demo/pad/kit/*', roots(treeFs({ '/tmp/demo/pad/kit/a/.git': 'file' })))).toBe('git-files')
    const failing = (bad: string): FileSystem => ({ ...treeFs({ '/tmp/demo/pad/kit/a/b.txt': 'file' }), lstat: (path) => (path === bad ? 'error' : path.endsWith('.txt') ? 'file' : 'dir') })
    expect(copiedTree('/tmp/demo/pad/kit', roots(failing('/tmp/demo/pad')))).toBe('unclear')
    expect(copiedTree('/tmp/demo/pad/kit', roots(failing('/tmp/demo/pad/kit/a')))).toBe('unclear')
    const unreadable: FileSystem = { ...treeFs({ '/tmp/demo/pad/kit/a': 'dir' }), readdir: () => null }
    expect(copiedTree('/tmp/demo/pad/kit', roots(unreadable))).toBe('unclear')
    expect(copiedTree('/tmp/demo/pad/kit/*', roots(unreadable))).toBe('unclear')
  })
  it('more entries than a glob may have is unclear, in a glob\'s folder or below', () => {
    const many: Record<string, string> = {}
    for (let n = 0; n <= 10_000; n++) many[`/tmp/demo/pad/kit/d/${n}`] = 'file'
    expect(copiedTree('/tmp/demo/pad/kit', roots(treeFs(many)))).toBe('unclear')
    expect(copiedTree('/tmp/demo/pad/kit/d/*', roots(treeFs(many)))).toBe('unclear')
    delete many['/tmp/demo/pad/kit/d/0']
    expect(copiedTree('/tmp/demo/pad/kit/d/*', roots(treeFs(many)))).toBe('clean')
    // kit holds d, d holds 9,999: 10,000 entries in all, still looked through.
    delete many['/tmp/demo/pad/kit/d/1']
    expect(copiedTree('/tmp/demo/pad/kit', roots(treeFs(many)))).toBe('clean')
  })
})
