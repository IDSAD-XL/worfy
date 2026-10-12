// leadsToRemote of src/main/remote-links.ts (worfy-windows ticket 18): a link on the way to a file
// that leads to `\\host\share\…` is found with lstat and readlink, which do not follow it, so the
// caller can refuse the path before realpath makes Windows contact that host. The file system is
// replaced and the path rules are path.win32, so every case runs on any machine.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** What Node was asked through node:fs/promises: lstat reads a link, stat would follow it. */
const asked = vi.hoisted(() => ({ lstat: [] as string[], stat: [] as string[], realpath: [] as string[] }))

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  const watched =
    <Name extends 'lstat' | 'stat' | 'realpath'>(name: Name) =>
    (...args: unknown[]): unknown => {
      asked[name].push(String(args[0]))
      // A path with this marker cannot be looked at: lstat is refused with the code the marker names.
      const refused = /worfy-lstat-(E[A-Z]+)/.exec(String(args[0]))
      if (name === 'lstat' && refused !== null) return Promise.reject(Object.assign(new Error(refused[1] + ': lstat'), { code: refused[1] }))
      return (actual[name] as (...all: unknown[]) => unknown)(...args)
    }
  return { ...actual, lstat: watched('lstat'), stat: watched('stat'), realpath: watched('realpath') }
})

const { isInside, leadsToRemote, MAX_LINK_HOPS, nodeLinks, UNCHECKED, walkLinks } = await import('../../src/main/remote-links')

afterEach(() => {
  asked.lstat.length = 0
  asked.stat.length = 0
  asked.realpath.length = 0
})

/** An error of the file system with its code, as Node rejects with. */
const failure = (code: string, path: string): Error => Object.assign(new Error(`${code}: ${path}`), { code })

/**
 * A file system of links alone: `links` maps a link to its target as written; `missing` is not
 * there; `denied` cannot be looked at (lstat rejects with EACCES); `unreadable` is a link whose
 * target cannot be read (readlink rejects).
 */
function fakeLinks(links: Record<string, string>, missing: readonly string[] = [], broken: { denied?: readonly string[]; unreadable?: readonly string[] } = {}) {
  const calls: string[] = []
  const key = (path: string): string => path.toLowerCase()
  const table = new Map(Object.entries(links).map(([path, target]) => [key(path), target]))
  const among = (list: readonly string[] | undefined, path: string): boolean => (list ?? []).some((each) => key(each) === key(path))
  return {
    calls,
    links: {
      isLink: async (path: string): Promise<boolean | null> => {
        calls.push(`lstat ${path}`)
        if (among(broken.denied, path)) throw failure('EACCES', path)
        if (among(missing, path)) return null
        return table.has(key(path)) || among(broken.unreadable, path)
      },
      readlink: async (path: string): Promise<string> => {
        calls.push(`readlink ${path}`)
        const target = table.get(key(path))
        if (target === undefined) throw failure('EINVAL', path)
        return target
      },
    },
  }
}

const REPO = 'C:\\p\\repo'
const ask = (candidate: string, fs: ReturnType<typeof fakeLinks>, allowed: readonly string[] = [REPO]) => leadsToRemote(candidate, allowed, { paths: win32, links: fs.links })

describe('leadsToRemote', () => {
  // The targets as Node's readlink hands them back on Windows (checked on the PC, review round 1
  // of PR #228) — a share comes without its device prefix, and the NT namespace comes as stored —
  // and the spellings a link can be written with before Node rewrites them.
  it.each([
    ['\\\\evil\\share\\x'],
    ['//evil/share/x'],
    ['\\\\?\\UNC\\evil\\share\\x'],
    ['\\??\\UNC\\evil\\share\\x'],
    // \\?\GLOBALROOT\Device\Mup\… and \\.\GLOBALROOT\… are stored and read back like this: the
    // network redirector by its device name. path.win32.resolve would make C:\??\… of it.
    ['\\??\\GLOBALROOT\\Device\\Mup\\evil\\share\\x'],
    ['\\??\\Global\\UNC\\evil\\share\\x'],
    ['\\\\?\\GLOBALROOT\\Device\\Mup\\evil\\share\\x'],
    ['\\\\.\\GLOBALROOT\\Device\\Mup\\evil\\share\\x'],
    ['\\?\\evil\\share\\x'],
    ['\\.\\evil\\share\\x'],
    // The same prefixes with forward slashes, in whole or in part.
    ['/??/GLOBALROOT/Device/Mup/evil/share/x'],
    ['\\??/GLOBALROOT/Device/Mup/evil/share/x'],
    ['/?/evil/share/x'],
    // A server with no share: path.win32.resolve reads a folder \evil of the current disk.
    ['\\\\evil'],
    ['\\\\evil\\'],
    ['//evil'],
  ])('a file that is a link to %s leads to a remote path, and nothing is asked after its readlink', async (target) => {
    const fs = fakeLinks({ 'C:\\p\\repo\\docs\\a.md': target })
    expect(await ask('C:\\p\\repo\\docs\\a.md', fs)).toBe(true)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\docs', 'lstat C:\\p\\repo\\docs\\a.md', 'readlink C:\\p\\repo\\docs\\a.md'])
  })

  it('a folder on the way that is a link to a share: the segments behind it are never read', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\docs': '\\\\evil\\share\\docs' })
    expect(await ask('C:\\p\\repo\\docs\\deep\\a.md', fs)).toBe(true)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\docs', 'readlink C:\\p\\repo\\docs'])
    expect(fs.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('a link to the root of a share, as the last segment, is refused like any other', async () => {
    // \??\pipe\ is what Node's readlink answers for a link written to \\.\pipe.
    const fs = fakeLinks({ 'C:\\p\\repo\\docs': '\\\\evil\\share', 'C:\\p\\repo\\dev': '\\??\\pipe\\' })
    expect(await ask('C:\\p\\repo\\docs', fs)).toBe(true)
    expect(await ask('C:\\p\\repo\\dev', fs)).toBe(true)
    expect(fs.calls.at(-1)).toBe('readlink C:\\p\\repo\\dev')
  })

  it('a target in the NT namespace that names a local disk is that local path', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\a.md': '\\??\\C:\\p\\repo\\real.md', 'C:\\p\\repo\\b.md': '\\??\\C:\\p\\repo\\far\\x', 'C:\\p\\repo\\far': '\\??\\UNC\\evil\\share', 'C:\\p\\repo\\c.md': '\\??\\c:\\p\\repo\\lower.md' })
    expect(await ask('C:\\p\\repo\\a.md', fs)).toBe(false)
    expect(fs.calls).toContain('lstat C:\\p\\repo\\real.md')
    // The letter of the disk in either case.
    expect(await ask('C:\\p\\repo\\c.md', fs)).toBe(false)
    expect(fs.calls).toContain('lstat C:\\p\\repo\\lower.md')
    expect(await ask('C:\\p\\repo\\b.md', fs)).toBe(true)
  })

  it('refuses when a segment cannot be looked at, or a link cannot be read: realpath must not be the next step', async () => {
    const denied = fakeLinks({}, [], { denied: ['C:\\p\\repo\\docs'] })
    expect(await ask('C:\\p\\repo\\docs\\a.md', denied)).toBe(true)
    expect(denied.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\docs'])
    const unreadable = fakeLinks({}, [], { unreadable: ['C:\\p\\repo\\docs'] })
    expect(await ask('C:\\p\\repo\\docs\\a.md', unreadable)).toBe(true)
    expect(unreadable.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\docs', 'readlink C:\\p\\repo\\docs'])
  })

  it('a relative target is resolved from the folder of the link, also when the link is the folder the walk starts at', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo': '..\\real-repo' })
    expect(await ask('C:\\p\\repo\\a.md', fs)).toBe(false)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'readlink C:\\p\\repo', 'lstat C:\\real-repo', 'lstat C:\\real-repo\\a.md'])
  })

  it('with allowed folders one inside another, the walk starts at the outer one, in whatever order they are given', async () => {
    const worktree = 'C:\\p\\repo\\.claude\\worktrees\\07'
    for (const allowed of [
      [REPO, worktree],
      [worktree, REPO],
    ]) {
      const fs = fakeLinks({ 'C:\\p\\repo\\.claude': '\\\\evil\\share' })
      expect(await ask(`${worktree}\\a.md`, fs, allowed)).toBe(true)
      expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\.claude', 'readlink C:\\p\\repo\\.claude'])
    }
  })

  it('a chain of local links that ends on a share is refused, and the share is not read', async () => {
    const fs = fakeLinks({
      'C:\\p\\repo\\a.md': 'C:\\p\\repo\\hop\\b.md',
      // Relative, from the folder of the link.
      'C:\\p\\repo\\hop\\b.md': '..\\far\\c.md',
      'C:\\p\\repo\\far': '\\\\evil\\share\\far',
    })
    expect(await ask('C:\\p\\repo\\a.md', fs)).toBe(true)
    expect(fs.calls.at(-1)).toBe('readlink C:\\p\\repo\\far')
    expect(fs.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('a link that leaves the folder for another local place is walked from the root of its disk', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\out': 'D:\\elsewhere\\x', 'D:\\elsewhere': '\\\\evil\\share' })
    expect(await ask('C:\\p\\repo\\out\\a.md', fs)).toBe(true)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\out', 'readlink C:\\p\\repo\\out', 'lstat D:\\elsewhere', 'readlink D:\\elsewhere'])
  })

  it('links that stay on the machine lead nowhere remote', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\docs': 'C:\\p\\repo\\real-docs', 'C:\\p\\repo\\out': 'D:\\elsewhere' })
    expect(await ask('C:\\p\\repo\\docs\\a.md', fs)).toBe(false)
    // The walk went on through the target: the file behind the link was looked at.
    expect(fs.calls).toContain('lstat C:\\p\\repo\\real-docs\\a.md')
    expect(await ask('C:\\p\\repo\\out\\a.md', fs)).toBe(false)
    expect(await ask('C:\\p\\repo\\plain\\a.md', fs)).toBe(false)
  })

  it('a share among the allowed folders is not remote: its files and links into it are walked', async () => {
    const share = '\\\\nas\\team\\repo'
    const fs = fakeLinks({ '\\\\nas\\team\\repo\\link': '\\\\nas\\team\\repo\\other', 'C:\\p\\repo\\mounted': '\\\\nas\\team\\repo\\docs' })
    expect(await ask('\\\\nas\\team\\repo\\link\\a.md', fs, [share])).toBe(false)
    expect(fs.calls).toEqual(['lstat \\\\nas\\team\\repo', 'lstat \\\\nas\\team\\repo\\link', 'readlink \\\\nas\\team\\repo\\link', 'lstat \\\\nas\\team\\repo\\other', 'lstat \\\\nas\\team\\repo\\other\\a.md'])
    expect(await ask('C:\\p\\repo\\mounted\\a.md', fs, [REPO, share])).toBe(false)
    // Another folder of the same share is not the caller's.
    const out = fakeLinks({ '\\\\nas\\team\\repo\\link': '\\\\nas\\team\\other-repo' })
    expect(await ask('\\\\nas\\team\\repo\\link\\a.md', out, [share])).toBe(true)
    // Nor is a folder whose name only starts with the allowed one.
    const sibling = fakeLinks({ '\\\\nas\\team\\repo\\link': '\\\\nas\\team\\repo-evil' })
    expect(await ask('\\\\nas\\team\\repo\\link\\a.md', sibling, [share])).toBe(true)
  })

  it('a remote path outside the allowed folders is a yes by its text, and is never read', async () => {
    const fs = fakeLinks({})
    for (const path of [
      '\\\\evil\\share\\a.md',
      '//evil/share/a.md',
      '\\\\?\\UNC\\evil\\share\\a.md',
      '\\\\.\\pipe\\x',
      // The root of a share, with nothing after it, and a server with no share.
      '\\\\evil\\share',
      '\\\\evil\\share\\',
      '\\\\evil',
      '//evil/',
      '\\??\\GLOBALROOT\\Device\\Mup\\evil\\share\\a.md',
    ])
      expect(await ask(path, fs), path).toBe(true)
    expect(fs.calls).toEqual([])
  })

  it('a device path to a local disk is that local path: in a target and in the path asked about', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\a.md': '\\\\?\\C:\\p\\repo\\real.md', 'C:\\p\\repo\\b.md': '\\\\?\\C:\\p\\repo\\far\\x', 'C:\\p\\repo\\far': '\\\\evil\\share' })
    expect(await ask('C:\\p\\repo\\a.md', fs)).toBe(false)
    expect(fs.calls).toContain('lstat C:\\p\\repo\\real.md')
    expect(await ask('C:\\p\\repo\\b.md', fs)).toBe(true)
    expect(await ask('\\\\?\\C:\\p\\repo\\far\\x', fs)).toBe(true)
    expect(await ask('\\\\?\\C:\\p\\repo\\plain.md', fs)).toBe(false)
  })

  it('a share written with its device prefix is the same share: as a target and as an allowed folder', async () => {
    const share = '\\\\nas\\team\\repo'
    const fs = fakeLinks({ '\\\\nas\\team\\repo\\link': '\\\\?\\UNC\\nas\\team\\repo\\other', 'C:\\p\\repo\\mounted': '\\\\?\\UNC\\nas\\team\\repo\\docs' })
    expect(await ask('\\\\nas\\team\\repo\\link\\a.md', fs, [share])).toBe(false)
    expect(fs.calls).toContain('lstat \\\\nas\\team\\repo\\other\\a.md')
    expect(await ask('C:\\p\\repo\\mounted\\a.md', fs, [REPO, '\\\\?\\UNC\\nas\\team\\repo'])).toBe(false)
    expect(await ask('\\\\?\\UNC\\nas\\team\\repo\\plain.md', fs, [share])).toBe(false)
  })

  it(`follows ${MAX_LINK_HOPS} links and refuses one more, a loop included`, async () => {
    const chain = (length: number): Record<string, string> => Object.fromEntries(Array.from({ length }, (_, index) => [`C:\\p\\repo\\l${index}`, `C:\\p\\repo\\l${index + 1}`]))
    expect(MAX_LINK_HOPS).toBe(40)
    expect(await ask('C:\\p\\repo\\l0', fakeLinks(chain(40)))).toBe(false)
    expect(await ask('C:\\p\\repo\\l0', fakeLinks(chain(41)))).toBe(true)
    const loop = fakeLinks({ 'C:\\p\\repo\\a': 'C:\\p\\repo\\b', 'C:\\p\\repo\\b': 'C:\\p\\repo\\a' })
    expect(await ask('C:\\p\\repo\\a\\x.md', loop)).toBe(true)
    expect(loop.calls.filter((call) => call.startsWith('readlink'))).toHaveLength(MAX_LINK_HOPS)
  })

  it('a segment that cannot be read ends the walk with no: there is nothing behind it to follow', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\gone\\link': '\\\\evil\\share' }, ['C:\\p\\repo\\gone'])
    expect(await ask('C:\\p\\repo\\gone\\link\\a.md', fs)).toBe(false)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\gone'])
  })

  it('the folder the walk starts at is looked at too; a local path outside the allowed folders starts at the root of its disk', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo': '\\\\evil\\share\\repo', 'C:\\other\\link': '\\\\evil\\share' })
    expect(await ask('C:\\p\\repo\\a.md', fs)).toBe(true)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'readlink C:\\p\\repo'])
    fs.calls.length = 0
    expect(await ask('C:\\other\\link\\a.md', fs)).toBe(true)
    expect(fs.calls).toEqual(['lstat C:\\other', 'lstat C:\\other\\link', 'readlink C:\\other\\link'])
    // A root that is a link to its own share, named among the allowed folders, is the caller's.
    const own = fakeLinks({ 'C:\\p\\repo': '\\\\nas\\team\\repo' })
    expect(await ask('C:\\p\\repo\\a.md', own, [REPO, '\\\\nas\\team\\repo'])).toBe(false)
    expect(own.calls).toEqual(['lstat C:\\p\\repo', 'readlink C:\\p\\repo', 'lstat \\\\nas\\team\\repo\\a.md'])
  })

  it('an allowed folder that names neither a folder of a disk nor one of a share allows nothing, and breaks nothing', async () => {
    const plain = fakeLinks({ 'C:\\p\\repo\\docs': 'C:\\p\\repo\\real' })
    expect(await ask('C:\\p\\repo\\docs\\a.md', plain)).toBe(false)
    const odd = fakeLinks({ 'C:\\p\\repo\\docs': 'C:\\p\\repo\\real' })
    expect(await ask('C:\\p\\repo\\docs\\a.md', odd, ['\\??\\GLOBALROOT\\Device\\Mup\\evil\\share', '\\\\evil', REPO, '//evil/'])).toBe(false)
    expect(odd.calls).toEqual(plain.calls)
    // Neither form makes that server the caller's own.
    odd.calls.length = 0
    expect(await ask('\\\\evil\\share\\a.md', odd, ['\\\\evil', '\\??\\UNC\\evil\\share', '\\??\\GLOBALROOT\\Device\\Mup\\evil\\share'])).toBe(true)
    expect(odd.calls).toEqual([])
  })

  it('an allowed folder written in the NT namespace of a disk is that folder: the walk starts at it', async () => {
    const fs = fakeLinks({})
    expect(await ask('C:\\p\\repo\\docs\\a.md', fs, ['\\??\\C:\\p\\repo'])).toBe(false)
    // Not from the root of the disk: the folder is known as C:\p\repo.
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\docs', 'lstat C:\\p\\repo\\docs\\a.md'])
  })

  it('a UNC path whose server is spelled like the disk of an allowed folder is remote, not inside that folder', async () => {
    const fs = fakeLinks({ 'C:\\p\\repo\\link': '\\\\C:\\p\\repo\\x' })
    expect(await ask('\\\\C:\\p\\repo\\x', fs)).toBe(true)
    expect(await ask('//c:/p/repo/x', fs)).toBe(true)
    expect(fs.calls).toEqual([])
    expect(await ask('C:\\p\\repo\\link', fs)).toBe(true)
    expect(fs.calls).toEqual(['lstat C:\\p\\repo', 'lstat C:\\p\\repo\\link', 'readlink C:\\p\\repo\\link'])
  })

  it('off Windows the answer is no, and the file system is not touched', async () => {
    const fs = fakeLinks({ '/p/repo/a.md': '//evil/share/x' })
    expect(await leadsToRemote('/p/repo/a.md', ['/p/repo'], { paths: posix, links: fs.links })).toBe(false)
    expect(await leadsToRemote('//evil/share/x', ['/p/repo'], { paths: posix, links: fs.links })).toBe(false)
    expect(fs.calls).toEqual([])
  })
})

// The same walk with its reason: a caller that refuses with a message says which of the two it was.
describe('walkLinks', () => {
  it('tells a path that leads off the machine from one that could not be checked', async () => {
    const chain = (length: number): Record<string, string> => Object.fromEntries(Array.from({ length }, (_, index) => ['C:\\p\\repo\\l' + index, 'C:\\p\\repo\\l' + (index + 1)]))
    const links = { 'C:\\p\\repo\\out.md': '\\\\evil\\share\\x', 'C:\\p\\repo\\in.md': 'C:\\p\\repo\\real.md', 'C:\\p\\repo\\a': 'C:\\p\\repo\\b', 'C:\\p\\repo\\b': 'C:\\p\\repo\\a' }
    const fs = fakeLinks(links, [], { denied: ['C:\\p\\repo\\locked'], unreadable: ['C:\\p\\repo\\odd.md'] })
    const verdict = (candidate: string, system = fs) => walkLinks(candidate, [REPO], { paths: win32, links: system.links })
    expect(await verdict('C:\\p\\repo\\plain.md')).toBe('local')
    expect(await verdict('C:\\p\\repo\\in.md')).toBe('local')
    expect(await verdict('C:\\p\\repo\\l0', fakeLinks(chain(40)))).toBe('local')
    // Off the machine: by the text of the path, or by the target of a link.
    expect(await verdict('C:\\p\\repo\\out.md')).toBe('remote')
    expect(await verdict('\\\\evil\\share\\x')).toBe('remote')
    expect(await verdict('\\??\\GLOBALROOT\\Device\\Mup\\evil\\share\\x')).toBe('remote')
    // Not checked: a segment that cannot be looked at, a link that cannot be read, links that do not end.
    expect(await verdict('C:\\p\\repo\\locked\\a.md')).toBe('unchecked')
    expect(await verdict('C:\\p\\repo\\odd.md')).toBe('unchecked')
    expect(await verdict('C:\\p\\repo\\a\\x.md')).toBe('unchecked')
    expect(await verdict('C:\\p\\repo\\l0', fakeLinks(chain(41)))).toBe('unchecked')
    expect(await walkLinks('//evil/share/x', ['/p/repo'], { paths: posix, links: fs.links })).toBe('local')
  })

  it('gives the callers one wording for a path that could not be checked', () => {
    expect(UNCHECKED).toBe('cannot be checked: a link on the way to it cannot be read, or the links do not end')
  })
})

// The links of Node itself: what leadsToRemote uses when it is given none.
describe('nodeLinks', () => {
  let scratch: string | undefined

  afterEach(() => {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    scratch = undefined
  })

  it('reads a link with lstat and never follows it: a link to nothing is a link, and stat is not called', async (context) => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-links-')))
    writeFileSync(join(scratch, 'plain.md'), '# plain\n')
    mkdirSync(join(scratch, 'folder'))
    try {
      symlinkSync(join(scratch, 'nothing-here.md'), join(scratch, 'dangling.md'), 'file')
    } catch (error) {
      // On Windows a user without Developer Mode may not create symlinks.
      context.skip(`this user cannot create a symlink: ${error instanceof Error ? error.message : String(error)}`)
    }
    asked.lstat.length = 0
    expect(await nodeLinks.isLink(join(scratch, 'dangling.md'))).toBe(true)
    expect(await nodeLinks.isLink(join(scratch, 'plain.md'))).toBe(false)
    expect(await nodeLinks.isLink(join(scratch, 'folder'))).toBe(false)
    expect(await nodeLinks.isLink(join(scratch, 'missing.md'))).toBeNull()
    expect(await nodeLinks.readlink(join(scratch, 'dangling.md'))).toBe(join(scratch, 'nothing-here.md'))
    expect(asked.lstat).toHaveLength(4)
    expect(asked.stat).toEqual([])
    expect(asked.realpath).toEqual([])
  })

  it('rejects when a path cannot be looked at for another reason than being absent', async () => {
    // A NUL in a path is refused by Node before the system is asked: ERR_INVALID_ARG_VALUE, not ENOENT.
    await expect(nodeLinks.isLink('bad\0path')).rejects.toThrow()
  })

  it.each(['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'])('a path the system refuses with %s is not an absent one: isLink rejects, and the walk refuses', async (code) => {
    const marker = 'C:\\worfy-lstat-' + code
    await expect(nodeLinks.isLink(marker)).rejects.toMatchObject({ code })
    expect(await leadsToRemote(marker + '\\docs\\a.md', [], { paths: win32 })).toBe(true)
    expect(await walkLinks(marker + '\\docs\\a.md', [], { paths: win32 })).toBe('unchecked')
    expect(asked.lstat).toEqual([marker, marker, marker])
    expect(asked.stat).toEqual([])
    expect(asked.realpath).toEqual([])
  })

  it('is what leadsToRemote asks when it is given no links: lstat of each segment, stat and realpath of none', async () => {
    // A folder that is on no machine: under Windows rules the walk starts at the root of its disk.
    expect(await leadsToRemote('C:\\worfy-no-such-folder-18\\docs\\a.md', [], { paths: win32 })).toBe(false)
    expect(asked.lstat).toEqual(['C:\\worfy-no-such-folder-18'])
    expect(asked.stat).toEqual([])
    expect(asked.realpath).toEqual([])
  })
})

describe('isInside', () => {
  it('a path is inside its base, and a sibling whose name starts with the base is not', () => {
    expect(isInside('C:\\p\\repo', 'C:\\p\\repo', win32)).toBe(true)
    expect(isInside('C:\\p\\repo', 'c:\\P\\Repo\\a.md', win32)).toBe(true)
    expect(isInside('C:\\p\\repo', 'C:\\p\\repo\\..drafts\\a.md', win32)).toBe(true)
    expect(isInside('C:\\p\\repo', 'C:\\p\\repo-evil\\a.md', win32)).toBe(false)
    expect(isInside('C:\\p\\repo', 'C:\\p', win32)).toBe(false)
    expect(isInside('C:\\p\\repo', 'D:\\p\\repo\\a.md', win32)).toBe(false)
    expect(isInside('\\\\nas\\team\\repo', '\\\\NAS\\team\\repo\\a.md', win32)).toBe(true)
    expect(isInside('\\\\nas\\team\\repo', '\\\\nas\\other\\repo\\a.md', win32)).toBe(false)
    expect(isInside('/p/repo', '/p/repo/a.md', posix)).toBe(true)
    expect(isInside('/p/repo', '/p/Repo/a.md', posix)).toBe(false)
  })

  // path.win32.relative drops the leading separators of a UNC path, and reads \\C:\p\repo\x —
  // server "C:", share "p" — as C:\p\repo\x.
  it('under Windows rules a UNC path is never inside a folder of a disk, nor the other way round', () => {
    expect(isInside('C:\\p\\repo', '\\\\C:\\p\\repo\\x', win32)).toBe(false)
    expect(isInside('C:\\p\\repo', '//c:/p/repo/x', win32)).toBe(false)
    expect(isInside('C:\\p\\repo', '\\\\C:\\p\\repo', win32)).toBe(false)
    expect(isInside('\\\\C:\\p\\repo', 'C:\\p\\repo\\x', win32)).toBe(false)
    // POSIX rules know no share: a doubled leading slash is a plain root there, as before.
    expect(isInside('/p/repo', '//p/repo/a.md', posix)).toBe(true)
  })
})
