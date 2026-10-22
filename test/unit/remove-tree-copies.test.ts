// src/main/storage/remove.ts (worfy-windows ticket 23): removing a file, a link or a folder without
// ever going through a link. On Windows that is a walk of the module's own; on every other system
// it is fs.rmSync, as before the module, after a look through the tree for a mounted volume
// (worfy-windows ticket 44). The tests are in three files (split by worfy-windows ticket 45):
//   - test/unit/remove-tree.test.ts — real folders: on Windows with junctions, a `dir`
//     and a `file` symlink and a read-only file, elsewhere with symlinks; this is where the
//     fs.rmSync of Electron's Node loses the folder behind a junction;
//   - test/unit/remove-tree-walk.test.ts — a model of the file system: the order of the
//     calls of the walk, its tries when a file is busy, and the calls every other system makes;
//   - test/unit/remove-tree-copies.test.ts, this file — the copies that cannot import the module (the
//     text of restore.mjs, scripts/remove-tree.mjs and scripts/install-stable.mjs) run over the
//     same model and must make the same calls.
// The model, its trees and the copies are in test/unit/remove-tree-model.ts; the tests of a volume
// mounted in the tree off Windows are in test/unit/remove-tree-mounted.test.ts.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { restoreScriptSource } from '../../src/main/harness/migrate/restore'
import { REMOVE_RETRIES, REMOVE_RETRY_MS, removeFile } from '../../src/main/storage/remove'
import {
  BEHIND_A_LINK_TO_ANOTHER_VOLUME,
  builtCopy,
  CARD_HOLDS_A_VOLUME,
  COPIES,
  copyOf,
  model,
  TRASH_CARD_HOLDS_A_MOUNT,
  TRASH_CARD_IS_A_MOUNT,
  viaCopy,
  viaModule,
  WITH_A_DETACHED_MOUNT,
  WITH_A_LINK,
  WITH_A_MOUNT,
  WITH_A_MOUNT_ON_ITS_VOLUME,
  type Entry,
} from './remove-tree-model'

/** The loop of scripts/install-stable.mjs that runs a removal again on Windows; importing the script runs nothing. */
const { removeInRounds } = (await import(pathToFileURL(join(import.meta.dirname, '..', '..', 'scripts', 'install-stable.mjs')).href)) as {
  removeInRounds: (path: string, remove: (path: string) => unknown, wait?: (ms: number) => void) => unknown
}

describe('the copies of the walk that cannot import the module', () => {
  /** What is removed, from which tree, with which calls made to fail. */
  const CASES: [string, Record<string, Entry>, string, Record<string, string[]>][] = [
    ['a folder with a link in it', WITH_A_LINK, '/data/card', {}],
    ['a link as the path itself', WITH_A_LINK, '/data/card/linked', {}],
    ['a file', WITH_A_LINK, '/data/card/index.html', {}],
    ['a path that is not there', WITH_A_LINK, '/data/never-was', {}],
    ['a busy file', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['EBUSY', 'EPERM'] }],
    ['a file that stays busy', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': Array.from({ length: 10 }, () => 'EBUSY') }],
    ['a folder that is not empty at first', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['ENOTEMPTY'] }],
    ['an error that is not "busy"', WITH_A_LINK, '/data/card', { 'unlink /data/card/assets/app.js': ['EIO'] }],
    ['a file gone meanwhile', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['ENOENT'] }],
    ['a folder that cannot be read', WITH_A_LINK, '/data/card', { 'lstat /data/card/assets': ['EACCES'] }],
    ['a file that is "access denied" at first', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['EACCES'] }],
    ['an entry that cannot be removed, among others', WITH_A_LINK, '/data/card', { 'unlink /data/card/assets/app.js': ['EIO'], 'unlink /data/card/index.html': ['EROFS'] }],
    ['a name on the way that is no folder', WITH_A_LINK, '/data/card/index.html/x', { 'lstat /data/card/index.html/x': ['ENOTDIR'] }],
    ['a folder gone between the look and the listing', WITH_A_LINK, '/data/card', { 'readdir /data/card/assets': ['ENOENT'] }],
    ['a listing that fails', WITH_A_LINK, '/data/card', { 'readdir /data/card/assets': ['EACCES'] }],
    ['rmSync that fails', WITH_A_LINK, '/data/card', { 'rmSync /data/card recursive force': ['ENOTEMPTY'] }],
    ['a link written with a separator at its end', WITH_A_LINK, '/data/card/linked/', {}],
    ['a link written with a backslash at its end', WITH_A_LINK, '/data/card/linked\\', {}],
    ['a folder written with separators at its end', WITH_A_LINK, '/data/card//', {}],
    ['separators and nothing else', WITH_A_LINK, '/', { 'lstat /': ['EIO'] }],
    ['the root of a disk', WITH_A_LINK, 'C:\\', {}],
    ['two files that stay busy: the waits are those of the whole removal', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': Array.from({ length: 10 }, () => 'EBUSY'), 'unlink /data/card/assets/app.js': Array.from({ length: 10 }, () => 'EPERM') }],
    ['a busy file, then a folder that is not empty at first: the same waits', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY'], 'rmdir /data/card': ['ENOTEMPTY', 'ENOTEMPTY'] }],
    // worfy-windows ticket 35: a folder that lstat does not see as the link it is.
    ['a mount to another volume inside the folder', WITH_A_MOUNT, '/data/card', {}],
    ['a mount to another volume as the path itself', WITH_A_MOUNT, '/data/card/linked', {}],
    ['a mount written with a separator at its end', WITH_A_MOUNT, '/data/card/linked/', {}],
    ['a mount on the volume of its folder', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', {}],
    ['a mount on the volume of its folder as the path itself', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card/linked', {}],
    ['a mount on the volume of its folder that is busy at first', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', { 'rmdir /data/card/linked': ['EBUSY', 'EACCES'] }],
    ['a mount on the volume of its folder that stays busy', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', { 'rmdir /data/card/linked': Array.from({ length: 10 }, () => 'EPERM') }],
    ['a mount to another volume that answers "not empty" once', WITH_A_MOUNT, '/data/card', { 'rmdir /data/card/linked': ['ENOTEMPTY'] }],
    ['a mount to another volume that refuses to go', WITH_A_MOUNT, '/data/card', { 'rmdir /data/card/linked': ['EIO'] }],
    ['a mount whose parent folder cannot be asked', WITH_A_MOUNT, '/data/card/linked', { 'lstat /data/card': ['EACCES'] }],
    ['a mount to another volume as the path itself that answers "not empty" once', WITH_A_MOUNT, '/data/card/linked', { 'rmdir /data/card/linked': ['ENOTEMPTY'] }],
    ['a mount on the volume of its folder that refuses to go', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', { 'rmdir /data/card/linked': ['EIO'] }],
    ['a folder behind an ordinary link to another volume', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away/sub', {}],
    ['an empty folder behind an ordinary link to another volume', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away/empty', {}],
    ['the link to another volume itself', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away', {}],
    ['a folder whose parent folder is not there to be asked', WITH_A_MOUNT, '/data/card', { 'lstat /data': ['ENOENT'] }],
    ['an entry of the trash whose Card folder is a mount', TRASH_CARD_IS_A_MOUNT, '/trash/entry', {}],
    ['an entry of the trash whose Card folder holds a mount', TRASH_CARD_HOLDS_A_MOUNT, '/trash/entry', {}],
    ['a plain folder that is busy itself', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': Array.from({ length: 10 }, () => 'EBUSY') }],
    ['a plain folder that is busy at first and then "not empty"', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['EBUSY', 'ENOTEMPTY'] }],
    ['a plain folder that refuses to go with an error that is not "busy"', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['EIO'] }],
    ['a folder gone between the look and the first rmdir', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['ENOENT'] }],
    // worfy-windows ticket 45: the leftovers of the review of PR #287, and measurement 6.
    ['a plain folder whose first rmdir answers ENOTDIR', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['ENOTDIR'] }],
    ['a mount behind an ordinary link to another volume, as the path itself', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away/m', {}],
    ['a mount whose volume is gone, inside the folder', WITH_A_DETACHED_MOUNT, '/data/card', {}],
    ['a mount whose volume is gone, as the path itself', WITH_A_DETACHED_MOUNT, '/data/card/linked', {}],
    ['a mount whose volume is gone that refuses to go', WITH_A_DETACHED_MOUNT, '/data/card', { 'rmdir /data/card/linked': ['EPERM'] }],
    // worfy-windows ticket 44: a folder a volume is mounted on, and the look that comes before rmSync off Windows.
    ['a mount point of macOS inside the folder', CARD_HOLDS_A_VOLUME, '/data/card', {}],
    ['a mount point of macOS as the path itself', CARD_HOLDS_A_VOLUME, '/data/card/vol', {}],
    ['a mount point of macOS two folders down', CARD_HOLDS_A_VOLUME, '/data', {}],
    // worfy-windows ticket 47: an entry lstat does not see is asked about once more, by a second listing of its folder.
    ['a mount point of macOS after an entry that lstat does not see and its folder still lists', CARD_HOLDS_A_VOLUME, '/data/card', { 'lstat /data/card/index.html': ['ENOENT'] }],
    ['the folder the path lies in cannot be asked', WITH_A_LINK, '/data/card', { 'lstat /data/card/..': ['EACCES'], 'lstat /data': ['EACCES'] }],
    ['the folder the path lies in is gone meanwhile', WITH_A_LINK, '/data/card', { 'lstat /data/card/..': ['ENOENT'], 'lstat /data': ['ENOENT'] }],
    ['a path too long to look at', WITH_A_LINK, '/data/card', { 'lstat /data/card/assets/app.js': ['ENAMETOOLONG'] }],
  ]

  it.each(Object.keys(COPIES))('%s makes the same calls as the module, in the same order, with the same tries and the same end', (name) => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const [what, tree, path, failing] of CASES) {
        const [ours, theirs] = [model(tree, failing), model(tree, failing)]
        const [ourEnd, theirEnd] = [viaModule(ours, path, platform), viaCopy(COPIES[name]!, theirs, path, platform)]
        const where = `${what} on ${platform}`
        expect(theirs.calls, where).toEqual(ours.calls)
        expect(theirEnd, where).toBe(ourEnd)
        expect(theirs.waits, where).toEqual(ours.waits)
        expect(theirs.names(), where).toEqual(ours.names())
      }
    }
  })

  // worfy-windows ticket 28, from the review of PR #257: the waits were the second parameter of
  // the function the callers use, and forEach gives a callback the number of the entry there.
  it.each(Object.keys(COPIES))('%s takes the path alone: given to forEach it removes each path, and a busy one ends with its own error', (name) => {
    const m = model({ '/a': { kind: 'file' }, '/b': { kind: 'file' }, '/c': { kind: 'file' } }, { 'unlink /b': Array.from({ length: 10 }, () => 'EBUSY') })
    const removeTreeOfTheCopy = builtCopy(COPIES[name]!, m, 'win32')
    // No check of Function.length (worfy-windows ticket 43): a parameter with a default value is not
    // counted there, so it would not tell this signature from the earlier one. forEach below does.
    ;['/a'].forEach(removeTreeOfTheCopy)
    expect(m.names()).toEqual(['/b', '/c'])
    let code: unknown = null
    try {
      ;['/c', '/b'].forEach(removeTreeOfTheCopy)
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code
    }
    // Not a TypeError of a number taken for the waits.
    expect(code).toBe('EBUSY')
    expect(m.waits).toHaveLength(REMOVE_RETRIES)
    expect(m.names()).toEqual(['/b'])
  })

  it.each(Object.keys(COPIES))('%s starts every removal with five waits, and an error that is not "busy" spends none', (name) => {
    const busy = Array.from({ length: REMOVE_RETRIES }, () => 'EBUSY')
    const m = model(
      { '/first': { kind: 'file' }, '/second': { kind: 'file' }, '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' }, '/d/b.txt': { kind: 'file' } },
      { 'unlink /first': busy, 'unlink /second': busy, 'unlink /d/a.txt': ['EIO'], 'unlink /d/b.txt': busy },
    )
    const removeTreeOfTheCopy = builtCopy(COPIES[name]!, m, 'win32')
    removeTreeOfTheCopy('/first')
    removeTreeOfTheCopy('/second')
    expect(m.waits).toHaveLength(2 * REMOVE_RETRIES)
    expect(() => removeTreeOfTheCopy('/d')).toThrow('EIO')
    expect(m.waits).toHaveLength(3 * REMOVE_RETRIES)
    expect(m.names()).toEqual(['/d', '/d/a.txt'])
  })

  it('a copy waits for real with Atomics: two busy tries take two times 100 ms', () => {
    const m = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    const removeTreeOfTheCopy = builtCopy(Object.values(COPIES)[0]!, m, 'win32', 'removeTree', Atomics)
    const started = performance.now()
    removeTreeOfTheCopy('/f')
    const took = performance.now() - started
    expect(m.names()).toEqual([])
    // The lower bound alone (worfy-windows ticket 43): a worker that stalls is no error of the code,
    // and the number of waits is counted by the tests above.
    expect(took).toBeGreaterThanOrEqual(2 * REMOVE_RETRY_MS - 20)
  })

  // worfy-windows ticket 43, from the review of PR #283: the loop of install-stable.mjs that runs a
  // removal again on Windows, over the copy of the walk taken from the text of that script.
  it('install-stable.mjs runs its copy of the walk again: a file busy longer than one run goes on the next, and one busy for good ends after five runs', () => {
    const tree: Record<string, Entry> = { '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }
    const oneRun = 1 + REMOVE_RETRIES
    // Busy for the first try and the five tries after it: the whole of one run of the walk.
    const m = model(tree, { 'unlink /d/a.txt': Array.from({ length: oneRun }, () => 'EBUSY') })
    const pauses: number[] = []
    removeInRounds('/d', builtCopy(COPIES['scripts/install-stable.mjs']!, m, 'win32'), (ms: number) => pauses.push(ms))
    expect(m.names()).toEqual([])
    expect(m.calls.filter((call) => call === 'unlink /d/a.txt')).toHaveLength(oneRun + 1)
    // The five waits of the first run; the second run removes at its first try. One pause between them.
    expect(m.waits).toEqual(Array.from({ length: REMOVE_RETRIES }, () => REMOVE_RETRY_MS))
    expect(pauses).toEqual([REMOVE_RETRY_MS])

    const held = model(tree, { 'unlink /d/a.txt': Array.from({ length: 99 }, () => 'EPERM') })
    const heldPauses: number[] = []
    expect(() => removeInRounds('/d', builtCopy(COPIES['scripts/install-stable.mjs']!, held, 'win32'), (ms: number) => heldPauses.push(ms))).toThrow('EPERM')
    expect(held.calls.filter((call) => call === 'unlink /d/a.txt')).toHaveLength(5 * oneRun)
    expect(held.waits).toHaveLength(5 * REMOVE_RETRIES)
    expect(heldPauses).toEqual([100, 100, 100, 100])
    expect(held.names()).toEqual(['/d', '/d/a.txt'])
  })

  it('the copies are the same text, and that text has no backquote in it: one of them lives in a template string', () => {
    const [restore, ...others] = Object.values(COPIES)
    for (const other of others) expect(other).toBe(restore)
    expect(restore).not.toContain('`')
  })

  it('removeFile of restore.mjs makes the same calls as removeFile of the module, with the same tries and the same end', () => {
    const copy = copyOf(restoreScriptSource(), 'restore.mjs', 'remove-file')
    expect(copy).not.toContain('`')
    const cases: [string, string, Record<string, string[]>][] = [
      ['a file', '/data/card/index.html', {}],
      ['a link', '/data/card/linked', {}],
      ['a path that is not there', '/data/never-was', {}],
      ['a folder', '/data/card/assets', {}],
      ['a busy file', '/data/card/index.html', { 'unlink /data/card/index.html': ['EBUSY', 'EACCES'] }],
      ['a file that stays busy', '/data/card/index.html', { 'unlink /data/card/index.html': Array.from({ length: 10 }, () => 'EPERM') }],
      ['a file that is busy five times', '/data/card/index.html', { 'unlink /data/card/index.html': Array.from({ length: 5 }, () => 'EBUSY') }],
      ['a file that is busy six times', '/data/card/index.html', { 'unlink /data/card/index.html': Array.from({ length: 6 }, () => 'EBUSY') }],
      ['an error that is not "busy"', '/data/card/index.html', { 'unlink /data/card/index.html': ['EIO'] }],
      ['a file gone meanwhile', '/data/card/index.html', { 'unlink /data/card/index.html': ['ENOENT'] }],
      ['a name on the way that is no folder', '/data/card/index.html/x', { 'lstat /data/card/index.html/x': ['ENOTDIR'] }],
      ['a look that fails', '/data/card/index.html', { 'lstat /data/card/index.html': ['EACCES'] }],
      ['rmSync that fails', '/data/card/index.html', { 'rmSync /data/card/index.html force': ['EPERM'] }],
      ['a link written with a separator at its end', '/data/card/linked/', {}],
      ['a file written with a backslash at its end', '/data/card/index.html\\', {}],
      ['a folder written with a separator at its end', '/data/card/assets/', {}],
      // worfy-windows ticket 28: more than one separator, the two kinds mixed, and the paths that keep theirs.
      ['a link written with two separators at its end', '/data/card/linked//', {}],
      ['a link written with a backslash and a slash at its end', '/data/card/linked\\/', {}],
      ['a link written with a slash and a backslash at its end', '/data/card/linked/\\', {}],
      ['a folder written with three separators at its end', '/data/card/assets/\\/', {}],
      ['separators and nothing else', '/', { 'lstat /': ['EIO'] }],
      ['a backslash and nothing else', '\\', { 'lstat /': ['EIO'] }],
      ['two separators and nothing else', '//', { 'lstat //': ['EIO'] }],
      ['the root of a disk', 'C:\\', { 'lstat C:/': ['EIO'] }],
      ['the root of a disk written with a slash', 'C:/', { 'lstat C:/': ['EIO'] }],
      ['the root of a disk written with two separators', 'C:\\\\', { 'lstat C://': ['EIO'] }],
    ]
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const [what, path, failing] of cases) {
        const [ours, theirs] = [model(WITH_A_LINK, failing), model(WITH_A_LINK, failing)]
        let ourEnd: unknown = null
        try {
          removeFile(path, { fs: ours.fs, platform, wait: ours.wait })
        } catch (error) {
          ourEnd = (error as NodeJS.ErrnoException).code
        }
        const theirEnd = viaCopy(copy, theirs, path, platform, 'removeFile')
        const where = `${what} on ${platform}`
        expect(theirs.calls, where).toEqual(ours.calls)
        expect(theirEnd, where).toBe(ourEnd)
        expect(theirs.waits, where).toEqual(ours.waits)
        expect(theirs.names(), where).toEqual(ours.names())
      }
    }
  })
})
