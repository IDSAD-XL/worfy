// src/main/storage/remove.ts (worfy-windows ticket 23): removing a file, a link or a folder without
// ever going through a link. On Windows that is a walk of the module's own; on every other system
// it is fs.rmSync, as before the module, after a look through the tree for a mounted volume
// (worfy-windows ticket 44). The tests are in three files (split by worfy-windows ticket 45):
//   - test/unit/remove-tree.test.ts — real folders: on Windows with junctions, a `dir`
//     and a `file` symlink and a read-only file, elsewhere with symlinks; this is where the
//     fs.rmSync of Electron's Node loses the folder behind a junction;
//   - test/unit/remove-tree-walk.test.ts, this file — a model of the file system: the order of the
//     calls of the walk, its tries when a file is busy, and the calls every other system makes;
//   - test/unit/remove-tree-copies.test.ts — the copies that cannot import the module (the
//     text of restore.mjs, scripts/remove-tree.mjs and scripts/install-stable.mjs) run over the
//     same model and must make the same calls.
// The model, its trees and the copies are in test/unit/remove-tree-model.ts; the tests of a volume
// mounted in the tree off Windows are in test/unit/remove-tree-mounted.test.ts.
import { describe, expect, it } from 'vitest'
import { REMOVE_RETRIES, REMOVE_RETRY_MS, removeFile, removeTree } from '../../src/main/storage/remove'
import {
  BEHIND_A_LINK_TO_ANOTHER_VOLUME,
  model,
  TRASH_CARD_HOLDS_A_MOUNT,
  TRASH_CARD_IS_A_MOUNT,
  viaModule,
  VOLUME,
  WITH_A_DETACHED_MOUNT,
  WITH_A_LINK,
  WITH_A_MOUNT,
  WITH_A_MOUNT_ON_ITS_VOLUME,
  type Entry,
  type Model,
} from './remove-tree-model'

describe('removeTree over a model of the file system', () => {
  it('never reads the folder a link leads to: the link is unlinked, and what is behind it stays', () => {
    const m = model(WITH_A_LINK)
    const calls = (path: string): string[] => m.calls.filter((call) => call.endsWith(` ${path}`))
    expect(viaModule(m, '/data/card', 'win32')).toBeNull()
    expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
    expect(calls('/data/card/linked')).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked'])
    expect(m.calls.some((call) => call.includes('/home'))).toBe(false)
    // A folder is emptied before it is removed, and removed last.
    expect(m.calls.at(-1)).toBe('rmdir /data/card')
  })

  // worfy-windows ticket 35. Measured on the PC: the walk of main listed a junction that leads to a
  // volume by its GUID — lstat calls it a folder — and removed every file of that volume.
  describe('a folder that lstat does not see as the link it is (worfy-windows ticket 35)', () => {
    const through = (m: Model, path: string): string[] => m.calls.filter((call) => call.endsWith(` ${path}`) || call.includes(`${path}/`))

    it('inside the folder that is removed: it is on another volume, so it is never listed — one rmdir takes it, and the volume keeps its files', () => {
      const m = model(WITH_A_MOUNT)
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', ...VOLUME])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
    })

    it('as the path itself: the volume of its parent folder is asked, and it goes by one rmdir', () => {
      const m = model(WITH_A_MOUNT)
      expect(viaModule(m, '/data/card/linked', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/card/linked', 'lstat /data/card', 'rmdir /data/card/linked'])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/index.html', ...VOLUME])
    })

    it('on the volume of its folder, where the volume says nothing: the first thing asked of any folder is to go as it is, and it does — nothing is listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME)
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
    })

    it('on the volume of its folder and busy at first: it is waited for and asked to go again, and still never listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME, { 'rmdir /data/card/linked': ['EBUSY', 'EACCES'] })
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked', 'rmdir /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([REMOVE_RETRY_MS, REMOVE_RETRY_MS])
    })

    it('on another volume, a "not empty" answer does not lead to a listing either: the volume alone decides', () => {
      const m = model(WITH_A_MOUNT, { 'rmdir /data/card/linked': ['ENOTEMPTY'] })
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', ...VOLUME])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([REMOVE_RETRY_MS])
    })

    // Review round 1 of PR #287: in the test of the path itself above, rmdir never answers "not
    // empty", so the first rmdir hid the rule of the volume. Here it is the volume that decides.
    it('as the path itself, on another volume: a "not empty" answer does not lead to a listing — the volume of its parent folder decides', () => {
      const m = model(WITH_A_MOUNT, { 'rmdir /data/card/linked': ['ENOTEMPTY'] })
      expect(viaModule(m, '/data/card/linked', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/card/linked', 'lstat /data/card', 'rmdir /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([REMOVE_RETRY_MS])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/index.html', ...VOLUME])
    })

    // Review round 1 of PR #287: what the first rmdir answers besides "not empty" had no expected
    // value. Whatever it is, nothing is listed: "busy" is waited for and then thrown, anything
    // else is thrown at once.
    it('on the volume of its folder and busy for good: the removal ends with that answer after its waits, and nothing is listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME, { 'rmdir /data/card/linked': Array.from({ length: 10 }, () => 'EPERM') })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EPERM')
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', ...Array.from({ length: 1 + REMOVE_RETRIES }, () => 'rmdir /data/card/linked')])
      expect(m.waits).toHaveLength(REMOVE_RETRIES)
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/linked', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    it('on the volume of its folder, and rmdir answers an error that is not "busy": thrown at once, no wait, nothing listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME, { 'rmdir /data/card/linked': ['EIO'] })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EIO')
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/linked', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    it('on another volume, and rmdir answers an error that is not "busy": the removal ends with it, and the volume keeps its files', () => {
      const m = model(WITH_A_MOUNT, { 'rmdir /data/card/linked': ['EIO'] })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EIO')
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/linked', ...VOLUME])
    })

    it('a plain folder whose first rmdir answers an error that is not "busy": thrown at once, the folder is not listed and keeps its files', () => {
      const m = model(WITH_A_LINK, { 'rmdir /data/card/assets': ['EIO'] })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EIO')
      expect(m.calls).not.toContain('readdir /data/card/assets')
      expect(m.calls.filter((call) => call === 'rmdir /data/card/assets')).toHaveLength(1)
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    // Review round 1 of PR #287, measured on the PC: lstat of an ordinary junction or a symlink
    // answers with the volume the link lies on. As the parent of the path given it said "another
    // volume" about a plain folder behind it, and that folder was not removed.
    it('a plain folder whose parent is an ordinary link to another volume is removed as on main: such a parent tells no volume', () => {
      const m = model(BEHIND_A_LINK_TO_ANOTHER_VOLUME)
      expect(viaModule(m, '/data/away/sub', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/away/sub', 'lstat /data/away', 'rmdir /data/away/sub', 'readdir /data/away/sub', 'lstat /data/away/sub/f.txt', 'unlink /data/away/sub/f.txt', 'rmdir /data/away/sub'])
      expect(m.waits).toEqual([])
      expect(viaModule(m, '/data/away/empty', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', '/data/away', '/home', '/home/notes', '/home/notes/keep.txt', '/vol', '/vol/r', '/vol/r/m'])
    })

    // worfy-windows ticket 45, from the review of PR #287: the path is a junction by GUID and its
    // parent an ordinary link, so the volume of the parent is unknown, and the first rmdir decides.
    it('a junction by GUID whose parent is an ordinary link to another volume: the parent tells no volume, and the first rmdir takes the junction — what is behind it stays', () => {
      const m = model(BEHIND_A_LINK_TO_ANOTHER_VOLUME)
      expect(viaModule(m, '/data/away/m', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/away/m', 'lstat /data/away', 'rmdir /data/away/m'])
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/away', '/home', '/home/notes', '/home/notes/keep.txt', '/vol', '/vol/r', '/vol/r/empty', '/vol/r/sub', '/vol/r/sub/f.txt'])
    })

    it('when the parent folder cannot be asked for its volume, the first rmdir still decides', () => {
      const m = model(WITH_A_MOUNT, { 'lstat /data/card': ['EACCES'] })
      expect(viaModule(m, '/data/card/linked', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/card/linked', 'lstat /data/card', 'rmdir /data/card/linked'])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/index.html', ...VOLUME])
    })

    // worfy-windows ticket 45, from the review of PR #287: an entry of the walk takes the volume of
    // the folder it lies in from the walk, and asks for no parent of its own. Here the parent of the
    // path given is not there to be asked, so an entry given no volume, or the volume of the path's
    // parent, would ask one more lstat.
    it('an entry of the walk is given the volume of its folder: no lstat of a parent for it, also when the parent of the path given is not there to be asked', () => {
      const m = model(WITH_A_MOUNT, { 'lstat /data': ['ENOENT'] })
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.calls).toEqual([
        'lstat /data/card',
        'lstat /data',
        'rmdir /data/card',
        'readdir /data/card',
        'lstat /data/card/index.html',
        'unlink /data/card/index.html',
        'lstat /data/card/linked',
        'rmdir /data/card/linked',
        'rmdir /data/card',
      ])
      expect(m.names()).toEqual(['/data', ...VOLUME])
    })

    // worfy-windows ticket 45, from the review of PR #287: what the first rmdir answers besides "not
    // empty" and "busy". ENOENT is "gone": the folder is not listed. ENOTDIR is no "gone" there: it
    // ends the removal of that folder, which keeps its files.
    it('a plain folder whose first rmdir answers ENOENT is taken as gone and not listed; ENOTDIR there is an error, thrown at the end', () => {
      const gone = model(WITH_A_LINK, { 'rmdir /data/card/assets': ['ENOENT'] })
      // The model still holds the folder, so the Card stays "not empty" to the end of the waits.
      expect(viaModule(gone, '/data/card', 'win32')).toBe('ENOTEMPTY')
      expect(gone.calls).not.toContain('readdir /data/card/assets')
      expect(gone.calls.filter((call) => call.includes('/data/card/assets'))).toEqual(['lstat /data/card/assets', 'rmdir /data/card/assets'])
      expect(gone.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
      const notADir = model(WITH_A_LINK, { 'rmdir /data/card/assets': ['ENOTDIR'] })
      expect(viaModule(notADir, '/data/card', 'win32')).toBe('ENOTDIR')
      expect(notADir.calls.filter((call) => call.includes('/data/card/assets'))).toEqual(['lstat /data/card/assets', 'rmdir /data/card/assets'])
      expect(notADir.waits).toEqual([])
      expect(notADir.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    // worfy-windows ticket 45, measurement 6 of the review of PR #287: a junction by GUID whose
    // volume is detached — or whose target folder is gone — answers ENOENT to lstat, while the
    // listing of its folder names it; that folder answered "not empty" at every removal. Measured on
    // the PC, under both Nodes: one rmdir removes the junction.
    it('an entry the listing names and lstat does not see — a junction by GUID whose volume is gone — is asked to go with one rmdir, and its folder goes', () => {
      const m = model(WITH_A_DETACHED_MOUNT)
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data'])
      // As the path given it is a path that is not there: nothing is asked of it but lstat.
      const itself = model(WITH_A_DETACHED_MOUNT)
      expect(viaModule(itself, '/data/card/linked', 'win32')).toBeNull()
      expect(itself.calls).toEqual(['lstat /data/card/linked'])
      expect(itself.names()).toContain('/data/card/linked')
      // Whatever that rmdir answers, nothing more is asked of the entry; its folder says what stays.
      const refusing = model(WITH_A_DETACHED_MOUNT, { 'rmdir /data/card/linked': ['EPERM'] })
      expect(viaModule(refusing, '/data/card', 'win32')).toBe('ENOTEMPTY')
      expect(through(refusing, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(refusing.names()).toEqual(['/data', '/data/card', '/data/card/linked'])
    })

    it('an entry of the trash whose Card folder is such a link: the entry goes, the volume keeps its files', () => {
      const m = model(TRASH_CARD_IS_A_MOUNT)
      expect(viaModule(m, '/trash/entry', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/trash', ...VOLUME])
      expect(through(m, '/trash/entry/card')).toEqual(['lstat /trash/entry/card', 'rmdir /trash/entry/card'])
    })

    it('an entry of the trash whose Card folder holds such a link: the entry goes, the volume keeps its files', () => {
      const m = model(TRASH_CARD_HOLDS_A_MOUNT)
      expect(viaModule(m, '/trash/entry', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/trash', ...VOLUME])
      expect(through(m, '/trash/entry/card/linked')).toEqual(['lstat /trash/entry/card/linked', 'rmdir /trash/entry/card/linked'])
    })

    // The price of the rule, written down: a folder is listed only after it has answered "not empty".
    it('a plain folder that refuses to go for another reason than "not empty" is not listed: what it holds stays, and the removal ends with that reason', () => {
      const m = model(WITH_A_LINK, { 'rmdir /data/card/assets': Array.from({ length: 10 }, () => 'EBUSY') })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EBUSY')
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(m.calls).not.toContain('readdir /data/card/assets')
      expect(m.waits).toHaveLength(REMOVE_RETRIES)
    })

    // worfy-windows ticket 44. Until then this was one call of rmSync, which goes into a folder on
    // another volume. test/unit/remove-tree-mounted.test.ts has the mount point of macOS.
    it('off Windows the walk does not run: the tree is looked through, and a folder on another volume than its folder ends the removal before rmSync is called', () => {
      for (const platform of ['darwin', 'linux'] as const) {
        const m = model(WITH_A_MOUNT)
        expect(viaModule(m, '/data/card', platform), platform).toBe('EXDEV')
        expect(m.calls, platform).toEqual(['lstat /data/card', 'lstat /data/card/..', 'readdir /data/card', 'lstat /data/card/index.html', 'lstat /data/card/linked'])
        expect(m.names(), platform).toEqual(['/data', '/data/card', '/data/card/index.html', '/data/card/linked', ...VOLUME])
        expect(m.waits, platform).toEqual([])
      }
    })
  })

  // Rewritten by worfy-windows ticket 44: on main this was the call of rmSync and nothing else.
  it('on every other system the tree is looked through — every entry once, a link never followed — and then removed by one call of rmSync with "recursive" and "force"', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const m = model(WITH_A_LINK)
      expect(viaModule(m, '/data/card', platform), platform).toBeNull()
      expect(m.calls, platform).toEqual([
        'lstat /data/card',
        'lstat /data/card/..',
        'readdir /data/card',
        'lstat /data/card/index.html',
        'lstat /data/card/assets',
        'readdir /data/card/assets',
        'lstat /data/card/assets/app.js',
        'lstat /data/card/linked',
        'rmSync /data/card recursive force',
      ])
      expect(m.names(), platform).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(m.waits, platform).toEqual([])
    }
    // What rmSync throws is what the caller gets.
    const failing = model(WITH_A_LINK, { 'rmSync /data/card recursive force': ['ENOTEMPTY'] })
    expect(viaModule(failing, '/data/card', 'darwin')).toBe('ENOTEMPTY')
  })

  it('goes on past an entry that cannot be removed: the others go, the first error is thrown at the end, and the folder stays for what is left in it', () => {
    const tree: Record<string, Entry> = {
      '/d': { kind: 'folder' },
      '/d/a.txt': { kind: 'file' },
      '/d/held.txt': { kind: 'file' },
      '/d/sub': { kind: 'folder' },
      '/d/sub/also-held.txt': { kind: 'file' },
      '/d/sub/x.txt': { kind: 'file' },
      '/d/z.txt': { kind: 'file' },
    }
    const m = model(tree, { 'unlink /d/held.txt': ['EIO'], 'unlink /d/sub/also-held.txt': ['EROFS'] })
    // The first error, not the last.
    expect(viaModule(m, '/d', 'win32')).toBe('EIO')
    expect(m.names()).toEqual(['/d', '/d/held.txt', '/d/sub', '/d/sub/also-held.txt'])
    // Each folder was asked to go once, before it was listed (worfy-windows ticket 35), and
    // answered "not empty". Neither is asked again while it still holds something.
    expect(m.calls.filter((call) => call.startsWith('rmdir '))).toEqual(['rmdir /d', 'rmdir /d/sub'])
    expect(m.waits).toEqual([])
  })

  it('takes "nothing is there" in every form it comes in: a name on the way that is no folder, a folder gone between the look and the listing', () => {
    const below = model({ '/f': { kind: 'file' } }, { 'lstat /f/x': ['ENOTDIR'] })
    expect(viaModule(below, '/f/x', 'win32')).toBeNull()
    expect(below.calls).toEqual(['lstat /f/x'])
    const gone = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'readdir /d': ['ENOENT'] })
    expect(viaModule(gone, '/d', 'win32')).toBeNull()
    // The look, the volume of the parent folder, the first rmdir — "not empty" — and the listing.
    expect(gone.calls).toEqual(['lstat /d', 'lstat /', 'rmdir /d', 'readdir /d'])
    const unreadable = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'readdir /d': ['EACCES'] })
    expect(viaModule(unreadable, '/d', 'win32')).toBe('EACCES')
  })

  it('reads a path with a separator at its end as the path without it: a link named that way goes as a link', () => {
    for (const written of ['/data/card/linked/', '/data/card/linked//', '/data/card/linked\\', '/data/card/linked\\/', '/data/card/linked/\\']) {
      const m = model(WITH_A_LINK)
      expect(viaModule(m, written, 'win32'), written).toBeNull()
      expect(m.calls, written).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked'])
      expect(m.names(), written).toContain('/home/notes/keep.txt')
    }
    // The root of a disk keeps its separator: without it the path would name another folder. So
    // does a path that is separators and nothing else: without them it would be no path at all.
    for (const [written, asked] of [['C:\\', 'C:/'], ['C:/', 'C:/'], ['/', '/'], ['\\', '/']] as const) {
      const root = model({})
      viaModule(root, written, 'win32')
      expect(root.calls, written).toEqual([`lstat ${asked}`])
    }
  })

  it('on Windows tries a busy step again after 100 ms, up to five times, then gives the error', () => {
    const busyTwice = () => model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    const twice = busyTwice()
    expect(viaModule(twice, '/f', 'win32')).toBeNull()
    expect(twice.calls).toEqual(['lstat /f', 'unlink /f', 'unlink /f', 'unlink /f'])
    expect(twice.waits).toEqual([REMOVE_RETRY_MS, REMOVE_RETRY_MS])
    expect(twice.names()).toEqual([])
    expect([REMOVE_RETRIES, REMOVE_RETRY_MS]).toEqual([5, 100])

    const always = model({ '/f': { kind: 'file' } }, { 'unlink /f': Array.from({ length: 10 }, () => 'EBUSY') })
    expect(viaModule(always, '/f', 'win32')).toBe('EBUSY')
    expect(always.calls.filter((call) => call === 'unlink /f')).toHaveLength(1 + REMOVE_RETRIES)
    expect(always.waits).toHaveLength(REMOVE_RETRIES)
  })

  // Review round 2 of PR #257. The walk goes on past an entry it cannot remove; were the tries
  // counted for each entry, a folder of files that a program holds would block the main process
  // for half a second a file.
  it('counts the waits for the whole removal, not for each entry: a folder of files that stay busy waits five times in all', () => {
    const files = Array.from({ length: 20 }, (_, index) => `/d/held-${String(index).padStart(2, '0')}.txt`)
    const tree = (): Record<string, Entry> => {
      const entries: Record<string, Entry> = { '/d': { kind: 'folder' } }
      for (const file of files) entries[file] = { kind: 'file' }
      return entries
    }
    const failing = (those: string[], codes: string[]): Record<string, string[]> => Object.fromEntries(those.map((file): [string, string[]] => [`unlink ${file}`, codes]))
    const forever = (code: string): string[] => Array.from({ length: 50 }, () => code)

    const held = model(tree(), failing(files, forever('EPERM')))
    expect(viaModule(held, '/d', 'win32')).toBe('EPERM')
    expect(held.waits).toEqual(Array.from({ length: REMOVE_RETRIES }, () => REMOVE_RETRY_MS))
    // The first file has its tries; every later one is asked once.
    const tries = (m: Model, file: string): number => m.calls.filter((call) => call === `unlink ${file}`).length
    expect(files.map((file) => tries(held, file))).toEqual([1 + REMOVE_RETRIES, ...files.slice(1).map(() => 1)])
    expect(held.names()).toEqual(['/d', ...files])

    // Files that are busy for a moment each: the waits last for five of them, the sixth fails at
    // its first try, and what is not busy goes all the same.
    const busyOnce = files.slice(0, 7)
    const passing = model(tree(), failing(busyOnce, ['EBUSY']))
    expect(viaModule(passing, '/d', 'win32')).toBe('EBUSY')
    expect(passing.waits).toHaveLength(REMOVE_RETRIES)
    expect(passing.names()).toEqual(['/d', ...busyOnce.slice(REMOVE_RETRIES)])

    // The folder at the end takes of the same waits: none is left for it here. (Its first "not
    // empty" is the answer to the rmdir before the listing, which is no wait.)
    const folder = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'unlink /d/a.txt': forever('EBUSY').slice(0, REMOVE_RETRIES), 'rmdir /d': ['ENOTEMPTY', 'ENOTEMPTY'] })
    expect(viaModule(folder, '/d', 'win32')).toBe('ENOTEMPTY')
    expect(folder.waits).toHaveLength(REMOVE_RETRIES)
    expect(folder.names()).toEqual(['/d'])

    // A second removal starts with all its waits.
    const again = model({ '/f': { kind: 'file' } }, { 'unlink /f': forever('EBUSY').slice(0, REMOVE_RETRIES) })
    expect(viaModule(again, '/f', 'win32')).toBeNull()
    expect(again.waits).toHaveLength(REMOVE_RETRIES)
  })

  it('tries again for a folder that is not empty yet, and never for an error that is not "busy"', () => {
    // The first "not empty" answers the rmdir before the listing; the two after it are waited for.
    const folder = model({ '/d': { kind: 'folder' } }, { 'rmdir /d': ['ENOTEMPTY', 'ENOTEMPTY', 'EACCES'] })
    expect(viaModule(folder, '/d', 'win32')).toBeNull()
    expect(folder.waits).toHaveLength(2)
    expect(folder.calls).toEqual(['lstat /d', 'lstat /', 'rmdir /d', 'readdir /d', 'rmdir /d', 'rmdir /d', 'rmdir /d'])
    const other = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EIO'] })
    expect(viaModule(other, '/f', 'win32')).toBe('EIO')
    expect(other.waits).toEqual([])
    const stat = model({ '/f': { kind: 'file' } }, { 'lstat /f': ['EACCES'] })
    expect(viaModule(stat, '/f', 'win32')).toBe('EACCES')
    expect(stat.calls).toEqual(['lstat /f'])
  })

  it('a path that goes away while it is being removed is removed: no error', () => {
    const m = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['ENOENT'] })
    expect(viaModule(m, '/f', 'win32')).toBeNull()
    expect(m.waits).toEqual([])
  })

  // worfy-windows ticket 28, from the review of PR #257.
  it('an error that is not "busy" spends no wait: all five are there for the entry after it', () => {
    const busy = Array.from({ length: REMOVE_RETRIES }, () => 'EBUSY')
    const m = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' }, '/d/b.txt': { kind: 'file' } }, { 'unlink /d/a.txt': ['EIO'], 'unlink /d/b.txt': busy })
    // The folder keeps the file that could not be removed, and says why.
    expect(viaModule(m, '/d', 'win32')).toBe('EIO')
    expect(m.calls.filter((call) => call === 'unlink /d/a.txt')).toHaveLength(1)
    expect(m.waits).toHaveLength(REMOVE_RETRIES)
    expect(m.names()).toEqual(['/d', '/d/a.txt'])
  })

  it('waits for real when no wait is given: two busy tries take two times 100 ms', () => {
    const m = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    const started = performance.now()
    removeTree('/f', { fs: m.fs, platform: 'win32' })
    const took = performance.now() - started
    expect(m.names()).toEqual([])
    // Two waits of REMOVE_RETRY_MS; a timer of the system may come a few ms early.
    expect(took).toBeGreaterThanOrEqual(2 * REMOVE_RETRY_MS - 20)
    expect(took).toBeLessThan(2000)
  })

  it('a removal that would wait without end is stopped by the model: its test fails at once', () => {
    const m = model({ '/f': { kind: 'file' } })
    for (let asked = 0; asked < 100; asked++) m.wait(REMOVE_RETRY_MS)
    expect(() => m.wait(REMOVE_RETRY_MS)).toThrow('the removal waits without end')
  })
})

describe('removeFile over a model of the file system', () => {
  const single = (m: Model, path: string, platform: NodeJS.Platform): unknown => {
    try {
      removeFile(path, { fs: m.fs, platform, wait: m.wait })
      return null
    } catch (error) {
      return (error as NodeJS.ErrnoException).code
    }
  }

  it('on Windows unlinks a file and a link, never reads a folder, and refuses a folder without touching it', () => {
    const m = model(WITH_A_LINK)
    expect(single(m, '/data/card/linked', 'win32')).toBeNull()
    expect(single(m, '/data/card/index.html', 'win32')).toBeNull()
    expect(single(m, '/data/never-was', 'win32')).toBeNull()
    expect(single(m, '/data/card/assets', 'win32')).toBe('EISDIR')
    expect(m.calls).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked', 'lstat /data/card/index.html', 'unlink /data/card/index.html', 'lstat /data/never-was', 'lstat /data/card/assets'])
    expect(m.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
  })

  it('on Windows tries a busy file again, as the walk does, and reads a separator at the end of the path away', () => {
    const windows = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    expect(single(windows, '/f/', 'win32')).toBeNull()
    expect(windows.calls).toEqual(['lstat /f', 'unlink /f', 'unlink /f', 'unlink /f'])
    expect(windows.waits).toEqual([REMOVE_RETRY_MS, REMOVE_RETRY_MS])
    expect(windows.names()).toEqual([])
  })

  // worfy-windows ticket 28, from the review of PR #257.
  it('on Windows tries a file that stays busy five times more, and no further', () => {
    const busy = (times: number): string[] => Array.from({ length: times }, () => 'EBUSY')
    const fifth = model({ '/f': { kind: 'file' } }, { 'unlink /f': busy(REMOVE_RETRIES) })
    expect(single(fifth, '/f', 'win32')).toBeNull()
    expect(fifth.waits).toHaveLength(REMOVE_RETRIES)
    expect(fifth.names()).toEqual([])

    const sixth = model({ '/f': { kind: 'file' } }, { 'unlink /f': busy(REMOVE_RETRIES + 1) })
    expect(single(sixth, '/f', 'win32')).toBe('EBUSY')
    expect(sixth.calls.filter((call) => call === 'unlink /f')).toHaveLength(1 + REMOVE_RETRIES)
    expect(sixth.waits).toHaveLength(REMOVE_RETRIES)
    expect(sixth.names()).toEqual(['/f'])
    // An error that is not "busy" ends it at the first try.
    const other = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EIO'] })
    expect(single(other, '/f', 'win32')).toBe('EIO')
    expect(other.waits).toEqual([])
  })

  it('on every other system is one call of rmSync with "force" and without "recursive": a folder is refused by it, as on main', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const m = model(WITH_A_LINK)
      expect(single(m, '/data/card/linked', platform), platform).toBeNull()
      expect(single(m, '/data/never-was', platform), platform).toBeNull()
      expect(single(m, '/data/card/assets', platform), platform).toBe('ERR_FS_EISDIR')
      expect(m.calls, platform).toEqual(['rmSync /data/card/linked force', 'rmSync /data/never-was force', 'rmSync /data/card/assets force'])
      expect(m.names(), platform).toContain('/data/card/assets/app.js')
      expect(m.names(), platform).toContain('/home/notes/keep.txt')
    }
  })
})
