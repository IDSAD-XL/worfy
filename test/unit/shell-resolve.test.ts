// resolveProjectFile of src/main/ipc/shell.ts by the path rules of each platform, with realpath
// replaced: what is decided by the text of a path alone (worfy-windows ticket 08, review round 2).
// A link to \\host\share made main call realpath on it before the inside check, and Windows
// contacted that host with the user's NTLM credentials. The real-repository cases are in
// test/contract/shell.test.ts.
import { posix, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), openExternal: vi.fn() } }))

const load = async () => (await import('../../src/main/ipc/shell')).resolveProjectFile

describe('resolveProjectFile by the text of a path', () => {
  it('refuses a UNC or device path outside the Project before any file system call on it (Windows rules)', async () => {
    const resolveProjectFile = await load()
    const real = vi.fn(async (path: string): Promise<string | null> => path)
    const options = { real, paths: win32 }
    for (const path of ['\\\\attacker\\share\\f.md', '//attacker/share/f.md', '\\\\?\\C:\\elsewhere\\f.md', '\\\\.\\pipe\\x', 'D:\\other\\f.md', '..\\outside\\f.md']) {
      real.mockClear()
      await expect(resolveProjectFile('C:\\p\\repo', path, ['C:\\p\\wt'], options), path).rejects.toThrow(/outside the Project/)
      // Only the Project's own folders reached realpath.
      expect(real.mock.calls.map(([called]) => called)).toEqual(['C:\\p\\repo', 'C:\\p\\wt'])
    }
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

  it('takes a path inside the real folder of a Project opened through a link, and refuses a missing file, as before', async () => {
    const resolveProjectFile = await load()
    const real = async (path: string): Promise<string | null> => (path.endsWith('missing.md') ? null : path.replace('/link/', '/real/'))
    expect(await resolveProjectFile('/link/repo', '/real/repo/a.md', [], { real, paths: posix })).toBe('/real/repo/a.md')
    await expect(resolveProjectFile('/link/repo', '/real/other/a.md', [], { real, paths: posix })).rejects.toThrow(/outside the Project/)
    await expect(resolveProjectFile('/link/repo', 'missing.md', [], { real, paths: posix })).rejects.toThrow(/does not exist/)
  })
})
