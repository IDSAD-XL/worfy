// resolveProjectFile of src/main/ipc/shell.ts by the path rules of each platform, with realpath
// replaced: what is decided by the text of a path alone (worfy-windows ticket 08, review round 2).
// A link to \\host\share made main call realpath on it before the inside check, and Windows
// contacted that host with the user's NTLM credentials. The real-repository cases are in
// test/contract/shell.test.ts.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), openExternal: vi.fn() } }))

const load = async () => (await import('../../src/main/ipc/shell')).resolveProjectFile

describe('resolveProjectFile by the text of a path', () => {
  it('refuses a UNC or device path outside the Project before any file system call on it (Windows rules)', async () => {
    const resolveProjectFile = await load()
    const real = vi.fn(async (path: string): Promise<string | null> => path)
    const options = { real, paths: win32 }
    for (const path of ['\\\\attacker\\share\\f.md', '//attacker/share/f.md', '/\\attacker\\share\\f.md', '\\\\?\\C:\\elsewhere\\f.md', '\\\\.\\pipe\\x', '\\\\?\\UNC\\attacker\\share\\f.md']) {
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
    const options = { real: async (path: string): Promise<string | null> => path, paths: win32 }
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
    expect(await resolveProjectFile('Z:\\repo', '\\\\nas\\team\\repo\\a.md', [], { real, paths: win32 })).toBe('\\\\nas\\team\\repo\\a.md')
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

// The same on the real file system of the machine: a symlink to the Project root, and the letter
// case of a case-insensitive volume (APFS by default, NTFS).
describe('resolveProjectFile on this file system', () => {
  let scratch: string
  let repo: string

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-resolve-')))
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
})
