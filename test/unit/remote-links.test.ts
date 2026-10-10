// leadsToRemote of src/main/remote-links.ts (worfy-windows ticket 18): a link on the way to a file
// that leads to `\\host\share\…` is found with lstat and readlink, which do not follow it, so the
// caller can refuse the path before realpath makes Windows contact that host. The file system is
// replaced and the path rules are path.win32, so every case runs on any machine.
import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInside, leadsToRemote, MAX_LINK_HOPS } from '../../src/main/remote-links'

/** A file system of links alone: `links` maps a link to its target as written; `missing` cannot be read. */
function fakeLinks(links: Record<string, string>, missing: readonly string[] = []) {
  const calls: string[] = []
  const key = (path: string): string => path.toLowerCase()
  const table = new Map(Object.entries(links).map(([path, target]) => [key(path), target]))
  return {
    calls,
    links: {
      isLink: async (path: string): Promise<boolean | null> => {
        calls.push(`lstat ${path}`)
        if (missing.some((each) => key(each) === key(path))) return null
        return table.has(key(path))
      },
      readlink: async (path: string): Promise<string> => {
        calls.push(`readlink ${path}`)
        const target = table.get(key(path))
        if (target === undefined) throw new Error(`EINVAL: not a link, readlink '${path}'`)
        return target
      },
    },
  }
}

const REPO = 'C:\\p\\repo'
const ask = (candidate: string, fs: ReturnType<typeof fakeLinks>, allowed: readonly string[] = [REPO]) => leadsToRemote(candidate, allowed, { paths: win32, links: fs.links })

describe('leadsToRemote', () => {
  it.each([
    ['\\\\evil\\share\\x', '\\\\host\\share\\x'],
    ['//evil/share/x', '//host/share/x'],
    ['\\\\?\\UNC\\evil\\share\\x', '\\\\?\\UNC\\host\\share\\x'],
    ['\\\\.\\pipe\\x', 'a device'],
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
    const fs = fakeLinks({ 'C:\\p\\repo\\docs': '\\\\evil\\share', 'C:\\p\\repo\\dev': '\\\\.\\pipe' })
    expect(await ask('C:\\p\\repo\\docs', fs)).toBe(true)
    expect(await ask('C:\\p\\repo\\dev', fs)).toBe(true)
    expect(fs.calls.at(-1)).toBe('readlink C:\\p\\repo\\dev')
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
    for (const path of ['\\\\evil\\share\\a.md', '//evil/share/a.md', '\\\\?\\UNC\\evil\\share\\a.md', '\\\\.\\pipe\\x']) expect(await ask(path, fs), path).toBe(true)
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
    expect(await ask('C:\\p\\repo\\l0', fakeLinks(chain(MAX_LINK_HOPS)))).toBe(false)
    expect(await ask('C:\\p\\repo\\l0', fakeLinks(chain(MAX_LINK_HOPS + 1)))).toBe(true)
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

  it('off Windows the answer is no, and the file system is not touched', async () => {
    const fs = fakeLinks({ '/p/repo/a.md': '//evil/share/x' })
    expect(await leadsToRemote('/p/repo/a.md', ['/p/repo'], { paths: posix, links: fs.links })).toBe(false)
    expect(await leadsToRemote('//evil/share/x', ['/p/repo'], { paths: posix, links: fs.links })).toBe(false)
    expect(fs.calls).toEqual([])
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
    expect(isInside('/p/repo', '/p/repo/a.md', posix)).toBe(true)
    expect(isInside('/p/repo', '/p/Repo/a.md', posix)).toBe(false)
  })
})
