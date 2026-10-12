// resolveProjectFile of src/main/ipc/shell.ts by the path rules of each platform, with realpath
// replaced: what is decided by the text of a path alone (worfy-windows ticket 08, review round 2).
// A link to \\host\share made main call realpath on it before the inside check, and Windows
// contacted that host with the user's NTLM credentials. The real-repository cases are in
// test/contract/shell.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), openExternal: vi.fn() } }))

/** What Node was asked through node:fs/promises: lstat reads a link, it does not follow it. */
const fsAsked = vi.hoisted(() => ({ lstat: [] as string[] }))

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: (...args: unknown[]): unknown => {
      fsAsked.lstat.push(String(args[0]))
      return (actual.lstat as (...all: unknown[]) => unknown)(...args)
    },
  }
})

const load = async () => (await import('../../src/main/ipc/shell')).resolveProjectFile

/**
 * A file system with no link in it. The cases whose Project lies on a made-up share pass it: since
 * worfy-windows ticket 18 the links on the way are read with lstat, and Node's own lstat of
 * `\\nas\…` would go looking for that host on Windows.
 */
const NO_LINKS = { isLink: async (): Promise<boolean | null> => false, readlink: async (): Promise<string> => '' }

describe('resolveProjectFile by the text of a path', () => {
  it('refuses a UNC or device path outside the Project before any file system call on it (Windows rules)', async () => {
    const resolveProjectFile = await load()
    const real = vi.fn(async (path: string): Promise<string | null> => path)
    const options = { real, paths: win32 }
    for (const path of ['\\\\attacker\\share\\f.md', '//attacker/share/f.md', '/\\attacker\\share\\f.md', '\\\\?\\C:\\elsewhere\\f.md', '\\\\.\\pipe\\x', '\\\\?\\UNC\\attacker\\share\\f.md', '\\\\C:\\p\\repo\\f.md', '//c:/p/wt/f.md']) {
      real.mockClear()
      await expect(resolveProjectFile('C:\\p\\repo', path, ['C:\\p\\wt'], options), path).rejects.toThrow(/outside the Project/)
      // Only the Project's own folders reached realpath.
      expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo', 'C:\\p\\wt'])
    }
  })

  // Review round 3 of PR #200: only a UNC or device path is decided by its text. Any other path is
  // resolved first and checked against the real folders, as on f95b7e7.
  it('resolves any other path before the inside check, and still refuses one outside (Windows rules)', async () => {
    const resolveProjectFile = await load()
    const real = vi.fn(async (path: string): Promise<string | null> => path)
    for (const path of ['D:\\other\\f.md', '..\\outside\\f.md']) {
      real.mockClear()
      await expect(resolveProjectFile('C:\\p\\repo', path, [], { real, paths: win32 }), path).rejects.toThrow(/outside the Project/)
      expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo', win32.resolve('C:\\p\\repo', path)])
    }
  })

  it('opens a file of the Project named through another alias of its root, or in another letter case (macOS rules)', async () => {
    const resolveProjectFile = await load()
    // /alias is a symlink to /real; the volume ignores case, so /real/repo/STUFF is /real/repo/Stuff.
    const real = async (path: string): Promise<string | null> => path.replace(/^\/alias\//, '/real/').replace(/\/stuff\//i, '/Stuff/')
    expect(await resolveProjectFile('/real/repo', '/alias/repo/a.md', [], { real, paths: posix })).toBe('/real/repo/a.md')
    expect(await resolveProjectFile('/alias/repo', '/real/repo/a.md', [], { real, paths: posix })).toBe('/real/repo/a.md')
    expect(await resolveProjectFile('/real/repo/Stuff', '/real/repo/stuff/a.md', [], { real, paths: posix })).toBe('/real/repo/Stuff/a.md')
    await expect(resolveProjectFile('/real/repo', '/alias/other/a.md', [], { real, paths: posix })).rejects.toThrow(/outside the Project/)
  })

  it('opens a path inside the root or a worktree, in any case of the letters, on Windows', async () => {
    const resolveProjectFile = await load()
    const options = { real: async (path: string): Promise<string | null> => path, paths: win32 }
    expect(await resolveProjectFile('C:\\p\\repo', 'docs\\a.md', [], options)).toBe('C:\\p\\repo\\docs\\a.md')
    expect(await resolveProjectFile('c:\\P\\Repo', 'C:\\p\\repo\\a.md', [], options)).toBe('C:\\p\\repo\\a.md')
    expect(await resolveProjectFile('C:\\p\\repo', 'C:/p/wt/b.md', ['C:/p/wt'], options)).toBe('C:\\p\\wt\\b.md')
  })

  it('opens the files of a Project that is itself on a share there, and nothing on another share', async () => {
    const resolveProjectFile = await load()
    const options = { real: async (path: string): Promise<string | null> => path, paths: win32, links: NO_LINKS }
    expect(await resolveProjectFile('\\\\nas\\team\\repo', 'a.md', [], options)).toBe('\\\\nas\\team\\repo\\a.md')
    await expect(resolveProjectFile('\\\\nas\\team\\repo', '\\\\nas\\other\\a.md', [], options)).rejects.toThrow(/outside the Project/)
  })

  // Review round 4 of PR #200.
  it('refuses a share folder whose name only starts with the name of the Project folder, before any file system call', async () => {
    const resolveProjectFile = await load()
    const real = vi.fn(async (path: string): Promise<string | null> => path)
    await expect(resolveProjectFile('\\\\nas\\team\\repo', '\\\\nas\\team\\repo-evil\\a.md', [], { real, paths: win32 })).rejects.toThrow(/outside the Project/)
    expect(real.mock.calls.map(([called]) => called)).toEqual(['\\\\nas\\team\\repo'])
  })

  it('opens a UNC path inside the real folder of a Project opened through a mapped drive', async () => {
    const resolveProjectFile = await load()
    // Z: is \\nas\team mapped to a drive letter.
    const real = vi.fn(async (path: string): Promise<string | null> => path.replace(/^Z:\\/, '\\\\nas\\team\\'))
    expect(await resolveProjectFile('Z:\\repo', '\\\\nas\\team\\repo\\a.md', [], { real, paths: win32, links: NO_LINKS })).toBe('\\\\nas\\team\\repo\\a.md')
    real.mockClear()
    await expect(resolveProjectFile('Z:\\repo', '\\\\nas\\team\\other\\a.md', [], { real, paths: win32 })).rejects.toThrow(/outside the Project/)
    expect(real.mock.calls.map(([called]) => called)).toEqual(['Z:\\repo'])
  })

  it('on a case-sensitive volume refuses a path in another letter case (POSIX rules)', async () => {
    const resolveProjectFile = await load()
    // realpath answers with the path as written: /real/REPO is another folder than /real/repo.
    const real = async (path: string): Promise<string | null> => path
    await expect(resolveProjectFile('/real/repo', '/real/REPO/a.md', [], { real, paths: posix })).rejects.toThrow(/outside the Project/)
    expect(await resolveProjectFile('/real/repo', '/real/repo/a.md', [], { real, paths: posix })).toBe('/real/repo/a.md')
  })

  it('takes a path inside the real folder of a Project opened through a link, and refuses a missing file, as before', async () => {
    const resolveProjectFile = await load()
    const real = async (path: string): Promise<string | null> => (path.endsWith('missing.md') ? null : path.replace('/link/', '/real/'))
    expect(await resolveProjectFile('/link/repo', '/real/repo/a.md', [], { real, paths: posix })).toBe('/real/repo/a.md')
    await expect(resolveProjectFile('/link/repo', '/real/other/a.md', [], { real, paths: posix })).rejects.toThrow(/outside the Project/)
    await expect(resolveProjectFile('/link/repo', 'missing.md', [], { real, paths: posix })).rejects.toThrow(/does not exist/)
  })
})

// worfy-windows ticket 18: a local path inside the Project passes the text check, but a link on its
// way may lead to \\host\share, and realpath would follow it there. The links are read first
// (src/main/remote-links.ts); here lstat and readlink are replaced along with realpath.
describe('resolveProjectFile and a link that leads to a share (Windows rules)', () => {
  /** `links` maps a link to its target as written; every other path is a plain file or folder. */
  function fakeLinks(links: Record<string, string>) {
    const calls: string[] = []
    const table = new Map(Object.entries(links).map(([path, target]) => [path.toLowerCase(), target]))
    return {
      calls,
      links: {
        isLink: async (path: string): Promise<boolean | null> => {
          calls.push(`lstat ${path}`)
          return table.has(path.toLowerCase())
        },
        readlink: async (path: string): Promise<string> => {
          calls.push(`readlink ${path}`)
          return table.get(path.toLowerCase())!
        },
      },
    }
  }
  /** A realpath that follows the links of `fs` one level, and records what it was asked. */
  const identity = () => vi.fn(async (path: string): Promise<string | null> => path)

  it.each([
    ['a folder on the way', 'docs\\a.md', { 'C:\\p\\repo\\docs': '\\\\evil\\share\\docs' }],
    ['the file itself', 'docs\\a.md', { 'C:\\p\\repo\\docs\\a.md': '\\\\evil\\share\\a.md' }],
    ['a local link whose target is a link to a share', 'docs\\a.md', { 'C:\\p\\repo\\docs': 'C:\\p\\repo\\hop', 'C:\\p\\repo\\hop': '//evil/share/docs' }],
  ])('refuses a file when %s is a link to a share, and realpath is never asked about it', async (_case, path, links) => {
    const resolveProjectFile = await load()
    const real = identity()
    const fs = fakeLinks(links)
    await expect(resolveProjectFile('C:\\p\\repo', path, [], { real, paths: win32, links: fs.links })).rejects.toThrow(/outside the Project and its worktrees/)
    // Only the Project's own folder reached realpath; the share reached nothing.
    expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo'])
    expect(fs.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('says that a path could not be checked, not that it is outside, when a link cannot be read or the links do not end', async () => {
    const resolveProjectFile = await load()
    const real = identity()
    const loop = fakeLinks({ 'C:\\p\\repo\\a': 'C:\\p\\repo\\b', 'C:\\p\\repo\\b': 'C:\\p\\repo\\a' })
    const looped = resolveProjectFile('C:\\p\\repo', 'a\\x.md', [], { real, paths: win32, links: loop.links })
    await expect(looped).rejects.toThrow('a\\x.md cannot be checked: a link on the way to it cannot be read, or the links do not end')
    await expect(looped).rejects.toThrow(/^a\\x\.md cannot be checked/)
    await expect(looped).rejects.not.toThrow(/outside/)
    const denied = {
      isLink: async (): Promise<boolean | null> => {
        throw Object.assign(new Error('EACCES: permission denied, lstat'), { code: 'EACCES' })
      },
      readlink: async (): Promise<string> => '',
    }
    await expect(resolveProjectFile('C:\\p\\repo', 'docs\\a.md', [], { real, paths: win32, links: denied })).rejects.toThrow(/^docs\\a\.md cannot be checked/)
    // realpath was asked about the Project's own folder alone, both times.
    expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo', 'C:\\p\\repo'])
  })

  it('refuses a file of a worktree behind such a link', async () => {
    const resolveProjectFile = await load()
    const real = identity()
    const fs = fakeLinks({ 'C:\\p\\wt\\docs': '\\\\evil\\share\\docs' })
    await expect(resolveProjectFile('C:\\p\\repo', 'C:\\p\\wt\\docs\\a.md', ['C:\\p\\wt'], { real, paths: win32, links: fs.links })).rejects.toThrow(/outside the Project/)
    expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo', 'C:\\p\\wt'])
  })

  it('refuses a local path outside the Project that goes through a link to a share', async () => {
    const resolveProjectFile = await load()
    const real = identity()
    const fs = fakeLinks({ 'D:\\other\\link': '\\\\evil\\share' })
    await expect(resolveProjectFile('C:\\p\\repo', 'D:\\other\\link\\a.md', [], { real, paths: win32, links: fs.links })).rejects.toThrow(/outside the Project/)
    expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo'])
  })

  it('opens a file behind a link that stays inside the Project', async () => {
    const resolveProjectFile = await load()
    const fs = fakeLinks({ 'C:\\p\\repo\\docs': 'C:\\p\\repo\\real-docs' })
    const real = vi.fn(async (path: string): Promise<string | null> => path.replace('\\docs\\', '\\real-docs\\'))
    expect(await resolveProjectFile('C:\\p\\repo', 'docs\\a.md', [], { real, paths: win32, links: fs.links })).toBe('C:\\p\\repo\\real-docs\\a.md')
  })

  it('a Project on a share opens a file behind a link into the same Project there, and not one into another folder of the share', async () => {
    const resolveProjectFile = await load()
    const fs = fakeLinks({ '\\\\nas\\team\\repo\\link': '\\\\nas\\team\\repo\\other', '\\\\nas\\team\\repo\\out': '\\\\nas\\team\\elsewhere' })
    const real = vi.fn(async (path: string): Promise<string | null> => path.replace('\\link\\', '\\other\\'))
    expect(await resolveProjectFile('\\\\nas\\team\\repo', 'link\\a.md', [], { real, paths: win32, links: fs.links })).toBe('\\\\nas\\team\\repo\\other\\a.md')
    real.mockClear()
    await expect(resolveProjectFile('\\\\nas\\team\\repo', 'out\\a.md', [], { real, paths: win32, links: fs.links })).rejects.toThrow(/outside the Project/)
    expect(real.mock.calls.map(([called]) => called)).toEqual(['\\\\nas\\team\\repo'])
  })

  it('opens the files of a Project whose folder is reached through a link to its own share', async () => {
    const resolveProjectFile = await load()
    // C:\link is a link to \\nas\team, and the Project was added as C:\link\repo.
    const fs = fakeLinks({ 'C:\\link': '\\\\nas\\team' })
    const real = vi.fn(async (path: string): Promise<string | null> => path.replace(/^C:\\link\\/i, '\\\\nas\\team\\'))
    expect(await resolveProjectFile('C:\\link\\repo', 'docs\\a.md', [], { real, paths: win32, links: fs.links })).toBe('\\\\nas\\team\\repo\\docs\\a.md')
    // The walk started at the Project folder as written: the link above it is the user's own.
    expect(fs.calls).toEqual(['lstat C:\\link\\repo', 'lstat C:\\link\\repo\\docs', 'lstat C:\\link\\repo\\docs\\a.md'])
  })

  it('given no links to read with, reads them with lstat of Node', async () => {
    const resolveProjectFile = await load()
    fsAsked.lstat.length = 0
    // A folder that is on no machine: the walk ends at its first segment, which is not there.
    const root = 'C:\\worfy-no-such-folder-18\\repo'
    expect(await resolveProjectFile(root, 'docs\\a.md', [], { real: async (path) => path, paths: win32 })).toBe(`${root}\\docs\\a.md`)
    expect(fsAsked.lstat).toEqual([root])
  })

  it('under POSIX rules reads no link: a symlink is resolved by realpath and checked after it, as before', async () => {
    const resolveProjectFile = await load()
    const fs = fakeLinks({ '/p/repo/docs': '//evil/share/docs' })
    const real = async (path: string): Promise<string | null> => path
    expect(await resolveProjectFile('/p/repo', 'docs/a.md', [], { real, paths: posix, links: fs.links })).toBe('/p/repo/docs/a.md')
    expect(fs.calls).toEqual([])
  })
})

// The same on the real file system of the machine: a symlink to the Project root, and the letter
// case of a case-insensitive volume (APFS by default, NTFS).
describe('resolveProjectFile on this file system', () => {
  let scratch: string
  let repo: string

  beforeEach(() => {
    // As the disk spells it: on a machine whose temp folder has an 8.3 short name
    // (C:\Users\RUNNER~1\… on a GitHub runner) realpathSync keeps the short name, and
    // resolveProjectFile answers with the long one.
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-resolve-')))
    repo = join(scratch, 'Stuff', 'repo')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'a.md'), '# a\n')
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it.skipIf(process.platform === 'win32')('opens a file named through a symlink alias of the Project root', async () => {
    const resolveProjectFile = await load()
    const alias = join(scratch, 'alias')
    symlinkSync(repo, alias)
    expect(await resolveProjectFile(repo, join(alias, 'a.md'), [])).toBe(join(repo, 'a.md'))
    expect(await resolveProjectFile(alias, join(repo, 'a.md'), [])).toBe(join(repo, 'a.md'))
  })

  it('opens a file named in another letter case on a case-insensitive volume', async (context) => {
    const resolveProjectFile = await load()
    const other = join(scratch, 'stuff', 'repo', 'a.md')
    if (!existsSync(other)) context.skip()
    expect(await resolveProjectFile(repo, other, [])).toBe(realpathSync.native(other))
  })

  // worfy-windows ticket 18, with a real link: lstat and readlink are Node's own, and only realpath
  // is wrapped to see what it was asked. The host does not exist; nothing here follows the link.
  it.runIf(process.platform === 'win32')('refuses a file that is a real symlink to a share, and realpath is not asked about it', async (context) => {
    const resolveProjectFile = await load()
    try {
      symlinkSync('\\\\worfy-no-such-host\\share\\a.md', join(repo, 'link.md'), 'file')
      symlinkSync('\\\\worfy-no-such-host\\share\\docs', join(repo, 'docs'), 'dir')
      // The network redirector by its device name: readlink hands it back as \??\GLOBALROOT\….
      symlinkSync('\\\\?\\GLOBALROOT\\Device\\Mup\\worfy-no-such-host\\share\\a.md', join(repo, 'nt.md'), 'file')
      symlinkSync(join(repo, 'a.md'), join(repo, 'inside.md'), 'file')
    } catch (error) {
      // Without Developer Mode a user may not create symlinks (SeCreateSymbolicLinkPrivilege).
      context.skip(`this user cannot create a symlink: ${error instanceof Error ? error.message : String(error)}`)
    }
    const asked: string[] = []
    const real = async (path: string): Promise<string | null> => {
      asked.push(path)
      return realpathSync.native(path)
    }
    await expect(resolveProjectFile(repo, 'link.md', [], { real })).rejects.toThrow(/outside the Project/)
    await expect(resolveProjectFile(repo, 'docs\\deep\\a.md', [], { real })).rejects.toThrow(/outside the Project/)
    expect(readlinkSync(join(repo, 'nt.md'))).toBe('\\??\\GLOBALROOT\\Device\\Mup\\worfy-no-such-host\\share\\a.md')
    await expect(resolveProjectFile(repo, 'nt.md', [], { real })).rejects.toThrow(/outside the Project/)
    expect(asked).toEqual([repo, repo, repo])
    // A link that stays inside the Project opens its target.
    expect(await resolveProjectFile(repo, 'inside.md', [], { real })).toBe(join(repo, 'a.md'))
  })
})
