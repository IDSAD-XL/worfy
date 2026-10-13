// removeTree off Windows and a volume mounted in the tree it removes (worfy-windows ticket 44).
// A folder a volume is mounted on is a plain folder to lstat; only its `dev` differs from that of
// the folder it lies in. fs.rmSync with `recursive` goes into it: measured on a Mac, it removed
// every file of the volume and then threw. So off Windows the tree is looked through before
// anything is removed, and a folder on another volume than the folder it lies in ends the removal
// with nothing removed.
//
// Everything here runs over the model of test/unit/remove-tree-model.ts, with `platform` darwin
// and linux: no test mounts a volume. The model's mount point answers as the real one did.
import { describe, expect, it } from 'vitest'
import { REMOVE_RETRIES } from '../../src/main/storage/remove'
import { BEHIND_A_LINK_TO_ANOTHER_VOLUME, CARD_HOLDS_A_VOLUME, COPIES, endViaCopy, endViaModule, model, rmSyncOver, WITH_A_LINK, type Entry, type Model } from './remove-tree-model'

/**
 * A folder with a mount point in it, and a link beside which that folder does not lie: the path
 * `/t/to-private/../Volumes` is `/Volumes` to the system, and `/t/Volumes` — which is not there —
 * to whoever cuts the `..` by the text.
 */
const UP_FROM_A_LINK: Record<string, Entry> = {
  '/t': { kind: 'folder' },
  '/t/to-private': { kind: 'link', to: '/private' },
  '/private': { kind: 'folder' },
  '/Volumes': { kind: 'folder' },
  '/Volumes/notes.txt': { kind: 'file' },
  '/Volumes/disk': { kind: 'volume' },
  '/Volumes/disk/keep.txt': { kind: 'file' },
}
const UNTOUCHED = Object.keys(CARD_HOLDS_A_VOLUME).sort()
const BEHIND_THE_MOUNT_POINT = ['/data/card/vol/deep', '/data/card/vol/deep/more.txt', '/data/card/vol/keep.txt']
/** The calls that name a path or anything below it. */
const through = (m: Model, path: string): string[] => m.calls.filter((call) => call.endsWith(` ${path}`) || call.includes(`${path}/`))
const removals = (m: Model): string[] => m.calls.filter((call) => !call.startsWith('lstat ') && !call.startsWith('readdir '))
const refusal = (mounted: string, given: string) => ({
  code: 'EXDEV',
  path: mounted,
  message: `EXDEV: ${mounted} is on another volume than the folder it lies in: a volume is mounted there. Nothing of ${given} was removed`,
})

describe('the mount point of the model answers as the one measured on macOS', () => {
  it('the removal of main — one call with "recursive" — of the folder it lies in removes every file of the volume, leaves the mount point with the way to it, and throws "not empty"', () => {
    const m = model(CARD_HOLDS_A_VOLUME)
    expect(() => rmSyncOver(m, '/data/card')).toThrow('ENOTEMPTY')
    expect(m.names()).toEqual(['/data', '/data/card', '/data/card/vol'])
  })

  it('the removal of main of the mount point itself removes every file of the volume and throws "Resource busy" with no code', () => {
    const m = model(CARD_HOLDS_A_VOLUME)
    let thrown: NodeJS.ErrnoException | null = null
    try {
      rmSyncOver(m, '/data/card/vol')
    } catch (error) {
      thrown = error as NodeJS.ErrnoException
    }
    expect(thrown?.message).toContain('Resource busy')
    expect(thrown?.code).toBeUndefined()
    expect(m.names()).toEqual(UNTOUCHED.filter((name) => !BEHIND_THE_MOUNT_POINT.includes(name)))
  })

  it('lstat calls it a folder on another volume than its folder; rmdir answers "busy", also for an empty volume; unlink refuses it', () => {
    const m = model({ ...CARD_HOLDS_A_VOLUME, '/data/card/empty-vol': { kind: 'volume' } })
    const [mounted, folder, behind] = [m.fs.lstatSync('/data/card/vol'), m.fs.lstatSync('/data/card'), m.fs.lstatSync('/data/card/vol/deep')]
    expect(mounted.isDirectory()).toBe(true)
    expect(mounted.dev).not.toBe(folder.dev)
    expect(behind.dev).toBe(mounted.dev)
    // The way up from a mount point leads to the folder it is mounted in.
    expect(m.fs.lstatSync('/data/card/vol/..').dev).toBe(folder.dev)
    expect(m.fs.readdirSync('/data/card/vol').sort()).toEqual(['deep', 'keep.txt'])
    expect(() => m.fs.rmdirSync('/data/card/vol')).toThrow('EBUSY')
    expect(() => m.fs.rmdirSync('/data/card/empty-vol')).toThrow('EBUSY')
    expect(() => m.fs.unlinkSync('/data/card/vol')).toThrow('EPERM')
    expect(m.names()).toEqual([...UNTOUCHED, '/data/card/empty-vol'].sort())
  })
})

describe.each(['darwin', 'linux'] as const)('removeTree on %s and a volume mounted in the tree (worfy-windows ticket 44)', (platform) => {
  it('inside the folder that is removed: the mount point is never listed, nothing at all is removed, and the error names it', () => {
    const m = model(CARD_HOLDS_A_VOLUME)
    expect(endViaModule(m, '/data/card', platform)).toEqual(refusal('/data/card/vol', '/data/card'))
    expect(m.names()).toEqual(UNTOUCHED)
    // One look at the mount point, and no call behind it.
    expect(through(m, '/data/card/vol')).toEqual(['lstat /data/card/vol'])
    expect(removals(m)).toEqual([])
    // The look ends at the mount point: what is listed after it is not asked about.
    expect(m.calls).toEqual(['lstat /data/card', 'lstat /data/card/..', 'readdir /data/card', 'lstat /data/card/assets', 'readdir /data/card/assets', 'lstat /data/card/assets/app.js', 'lstat /data/card/index.html', 'lstat /data/card/vol'])
    expect(m.waits).toEqual([])
  })

  it('as the path itself: the folder it lies in is asked for its volume, and nothing is listed or removed', () => {
    const m = model(CARD_HOLDS_A_VOLUME)
    expect(endViaModule(m, '/data/card/vol', platform)).toEqual(refusal('/data/card/vol', '/data/card/vol'))
    expect(m.calls).toEqual(['lstat /data/card/vol', 'lstat /data/card/vol/..'])
    expect(m.names()).toEqual(UNTOUCHED)
  })

  it('folders below the folder that is removed: found at any depth, before anything is removed', () => {
    const tree: Record<string, Entry> = {
      '/t': { kind: 'folder' },
      '/t/first.txt': { kind: 'file' },
      '/t/a': { kind: 'folder' },
      '/t/a/b': { kind: 'folder' },
      '/t/a/b/vol': { kind: 'volume' },
      '/t/a/b/vol/keep.txt': { kind: 'file' },
      '/t/last.txt': { kind: 'file' },
    }
    const m = model(tree)
    expect(endViaModule(m, '/t', platform)).toEqual(refusal('/t/a/b/vol', '/t'))
    expect(m.names()).toEqual(Object.keys(tree).sort())
    expect(removals(m)).toEqual([])
    expect(through(m, '/t/a/b/vol')).toEqual(['lstat /t/a/b/vol'])
  })

  it('an empty volume is refused as well: the mount point itself cannot be removed while the volume is mounted', () => {
    const m = model({ '/t': { kind: 'folder' }, '/t/vol': { kind: 'volume' } })
    expect(endViaModule(m, '/t', platform)).toEqual(refusal('/t/vol', '/t'))
    expect(m.names()).toEqual(['/t', '/t/vol'])
  })

  it('of two mount points the first one listed is named, and neither is entered', () => {
    const m = model({ '/t': { kind: 'folder' }, '/t/one': { kind: 'volume' }, '/t/one/a.txt': { kind: 'file' }, '/t/two': { kind: 'volume' }, '/t/two/b.txt': { kind: 'file' } })
    expect(endViaModule(m, '/t', platform)).toEqual(refusal('/t/one', '/t'))
    expect(m.names()).toEqual(['/t', '/t/one', '/t/one/a.txt', '/t/two', '/t/two/b.txt'])
    expect(removals(m)).toEqual([])
  })

  // The folder a path lies in is asked as `path/..`, which the system resolves: a link on the way
  // is followed. Asked by the text of the path — `/tmp` is a link on macOS — the link would answer
  // with its own volume, or be taken for no folder at all.
  it('a mount point reached through a link to its folder is refused: the folder it lies in is the one the system reaches', () => {
    const tree: Record<string, Entry> = {
      '/tmp': { kind: 'link', to: '/private/tmp' },
      '/private': { kind: 'folder' },
      '/private/tmp': { kind: 'folder' },
      '/private/tmp/x': { kind: 'volume' },
      '/private/tmp/x/keep.txt': { kind: 'file' },
    }
    const m = model(tree)
    expect(endViaModule(m, '/tmp/x', platform)).toEqual(refusal('/tmp/x', '/tmp/x'))
    expect(m.calls).toEqual(['lstat /tmp/x', 'lstat /tmp/x/..'])
    expect(m.names()).toEqual(Object.keys(tree).sort())
  })

  // Review round 1 of PR #293. The look asked about an entry at join(path, name), and join cuts a
  // `..` by the text; the folder itself, its `..` and rmSync got the text given, which the system
  // resolves through the link. So the look asked about /t/Volumes/disk, which is not there, took
  // it for gone meanwhile, and rmSync went into the volume.
  it('a path given with ".." after a link: its entries are asked about under the text given, as the system reads it, and the mount point among them is refused', () => {
    const m = model(UP_FROM_A_LINK)
    const given = '/t/to-private/../Volumes'
    expect(endViaModule(m, given, platform)).toEqual(refusal(`${given}/disk`, given))
    expect(m.calls).toEqual([`lstat ${given}`, `lstat ${given}/..`, `readdir ${given}`, `lstat ${given}/notes.txt`, `lstat ${given}/disk`])
    expect(m.names()).toEqual(Object.keys(UP_FROM_A_LINK).sort())
  })

  it('a plain folder reached through a link to another volume is removed: it is on the volume of the folder it lies in', () => {
    const m = model(BEHIND_A_LINK_TO_ANOTHER_VOLUME)
    expect(endViaModule(m, '/data/away/sub', platform)).toBeNull()
    expect(m.calls).toEqual(['lstat /data/away/sub', 'lstat /data/away/sub/..', 'readdir /data/away/sub', 'lstat /data/away/sub/f.txt', 'rmSync /data/away/sub recursive force'])
    expect(m.names()).toEqual(['/data', '/data/away', '/vol', '/vol/r', '/vol/r/empty'])
  })

  it('a link to a folder of another volume is no mount point: it is not followed by the look, and goes as the link it is', () => {
    const tree: Record<string, Entry> = {
      '/data': { kind: 'folder' },
      '/data/card': { kind: 'folder' },
      '/data/card/linked': { kind: 'link', to: '/vol/notes' },
      '/vol': { kind: 'folder' },
      '/vol/notes': { kind: 'folder' },
      '/vol/notes/keep.txt': { kind: 'file' },
    }
    const inside = model(tree)
    expect(endViaModule(inside, '/data/card', platform)).toBeNull()
    expect(inside.calls).toEqual(['lstat /data/card', 'lstat /data/card/..', 'readdir /data/card', 'lstat /data/card/linked', 'rmSync /data/card recursive force'])
    expect(inside.names()).toEqual(['/data', '/vol', '/vol/notes', '/vol/notes/keep.txt'])
    const itself = model(tree)
    expect(endViaModule(itself, '/data/card/linked', platform)).toBeNull()
    expect(itself.calls).toEqual(['lstat /data/card/linked', 'rmSync /data/card/linked recursive force'])
    expect(itself.names()).toEqual(['/data', '/data/card', '/vol', '/vol/notes', '/vol/notes/keep.txt'])
  })

  // (A tree with no mount point and no link out of its volume: test/unit/remove-tree.test.ts, "on
  // every other system the tree is looked through".)
  it('a file, and a path that is not there: one look, then rmSync as before', () => {
    const m = model(WITH_A_LINK)
    expect(endViaModule(m, '/data/card/index.html', platform)).toBeNull()
    expect(endViaModule(m, '/data/never-was', platform)).toBeNull()
    expect(m.calls).toEqual(['lstat /data/card/index.html', 'rmSync /data/card/index.html recursive force', 'lstat /data/never-was', 'rmSync /data/never-was recursive force'])
    expect(m.names()).not.toContain('/data/card/index.html')
  })

  // Fail closed: a part of the tree that cannot be looked at may hold a mount point, and rmSync —
  // which goes by open folders, not by full paths — may reach where a look by the path cannot.
  it.each([
    ['the look at an entry is refused', 'lstat /data/card/assets', 'EACCES'],
    ['a folder cannot be listed', 'readdir /data/card/assets', 'EACCES'],
    ['a path is longer than the system takes in one call', 'lstat /data/card/assets/app.js', 'ENAMETOOLONG'],
    ['the folder the path lies in cannot be asked', 'lstat /data/card/..', 'EACCES'],
    ['the look at the path itself fails', 'lstat /data/card', 'EIO'],
    // Review round 1 of PR #293: codes the look names nowhere. Whatever is not "nothing is there" ends it.
    ['a listing is not permitted', 'readdir /data/card/assets', 'EPERM'],
    ['the process has no file left to open for a look', 'lstat /data/card/index.html', 'EMFILE'],
    ['a look answers a code nobody has heard of', 'lstat /data/card/assets/app.js', 'EWHATEVER'],
  ])('when %s, the removal ends with that error and removes nothing', (_what, call, code) => {
    const m = model(CARD_HOLDS_A_VOLUME, { [call]: [code] })
    expect(endViaModule(m, '/data/card', platform)).toMatchObject({ code })
    expect(m.calls.at(-1)).toBe(call)
    expect(removals(m)).toEqual([])
    expect(m.names()).toEqual(UNTOUCHED)
  })

  it.each([
    ['an entry gone between the listing and the look', 'lstat /data/card/index.html', 'ENOENT'],
    ['a folder gone between the look and the listing', 'readdir /data/card/assets', 'ENOENT'],
    ['a name on the way that is no folder any more', 'lstat /data/card/assets/app.js', 'ENOTDIR'],
  ])('%s is nothing to refuse: the look goes on, and rmSync removes the tree', (_what, call, code) => {
    const m = model(WITH_A_LINK, { [call]: [code] })
    expect(endViaModule(m, '/data/card', platform)).toBeNull()
    expect(m.calls).toContain('lstat /data/card/linked')
    expect(m.calls.at(-1)).toBe('rmSync /data/card recursive force')
    expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
  })

  it('an entry gone meanwhile does not hide a mount point listed after it', () => {
    const m = model(CARD_HOLDS_A_VOLUME, { 'lstat /data/card/index.html': ['ENOENT'], 'readdir /data/card/assets': ['ENOENT'] })
    expect(endViaModule(m, '/data/card', platform)).toEqual(refusal('/data/card/vol', '/data/card'))
    expect(m.names()).toEqual(UNTOUCHED)
  })

  // The limit of the rule, written down. A mount point with the `dev` of the folder it lies in
  // tells nothing to the look, and rmSync goes into it: /System/Volumes/Data on a Mac (measured:
  // one `dev` with /System/Volumes), a bind mount of a folder of the same file system on Linux
  // (not measured). Only the answer of rmdir would tell, and rmSync does not ask before it removes.
  it('the limit, written down: a mount point with the `dev` of its folder is not seen, and rmSync goes into it', () => {
    const m = model({ '/t': { kind: 'folder' }, '/t/bound': { kind: 'volume', sameDev: true }, '/t/bound/lost.txt': { kind: 'file' } })
    expect(endViaModule(m, '/t', platform)).toMatchObject({ code: 'ENOTEMPTY' })
    expect(m.calls.at(-1)).toBe('rmSync /t recursive force')
    expect(m.names()).toEqual(['/t', '/t/bound'])
  })

  it.each(Object.keys(COPIES))('%s refuses with the same error as the module — its code, its words, the path it names — after the same calls', (name) => {
    const cases: [Record<string, Entry>, string][] = [
      [CARD_HOLDS_A_VOLUME, '/data/card'],
      [CARD_HOLDS_A_VOLUME, '/data/card/vol'],
      [CARD_HOLDS_A_VOLUME, '/data'],
      [WITH_A_LINK, '/data/card'],
      [UP_FROM_A_LINK, '/t/to-private/../Volumes'],
    ]
    for (const [tree, path] of cases) {
      const [ours, theirs] = [model(tree), model(tree)]
      const [ourEnd, theirEnd] = [endViaModule(ours, path, platform), endViaCopy(COPIES[name]!, theirs, path, platform)]
      expect(theirEnd, path).toEqual(ourEnd)
      expect(theirs.calls, path).toEqual(ours.calls)
      expect(theirs.names(), path).toEqual(ours.names())
    }
    // And the refusal is one: not the error rmSync would have ended with.
    expect(endViaCopy(COPIES[name]!, model(CARD_HOLDS_A_VOLUME), '/data/card', platform)).toEqual(refusal('/data/card/vol', '/data/card'))
  })
})

describe('removeTree on Windows and the mount point of the model', () => {
  // The walk of Windows is not changed by worfy-windows ticket 44. Its two rules keep it out of such
  // a folder as well: it is on another volume, so it is asked to go with rmdir and never listed.
  // It is also what the walk would do on the other systems, and one reason it was not taken for
  // them: what lies beside the mount point is removed before the removal fails, and the waits of
  // the removal — half a second — are spent on a folder that stays busy for as long as the volume
  // is mounted.
  it('is not listed by the walk either: rmdir is asked, answers "busy" to the end of the waits, and the volume keeps its files — what lies beside it is removed', () => {
    const m = model(CARD_HOLDS_A_VOLUME)
    expect(endViaModule(m, '/data/card', 'win32')).toMatchObject({ code: 'EBUSY' })
    expect(through(m, '/data/card/vol')).toEqual(['lstat /data/card/vol', ...Array.from({ length: 1 + REMOVE_RETRIES }, () => 'rmdir /data/card/vol')])
    expect(m.calls.some((call) => call.startsWith('rmSync '))).toBe(false)
    expect(m.waits).toHaveLength(REMOVE_RETRIES)
    expect(m.names()).toEqual(['/data', '/data/card', '/data/card/vol', ...BEHIND_THE_MOUNT_POINT])
  })
})
