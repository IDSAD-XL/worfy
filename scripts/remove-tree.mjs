// Removing a folder in the scripts of this repository (worfy-windows ticket 23).
//
// On Windows fs.rmSync is not used for that. Under the Node of Electron 44 — the tests run the
// scripts under it — its `recursive` goes through a junction (a link to a folder on NTFS) and
// empties the folder behind it, and it refuses a read-only file with EPERM. A Node from nodejs.org,
// 22.13.0 or 24.21.0, does neither. fs.unlinkSync, under all three, removes a read-only file, and
// removes a junction or a symlink as the link it is. On every other system fs.rmSync is called, as
// before: it never went through a link there.
//
// It does go into a folder a volume is mounted on (worfy-windows ticket 44; measured on macOS: the
// files of the volume were removed, then the call threw). lstat calls such a folder a plain one;
// only its `dev` differs from that of the folder it lies in. So off Windows the tree is looked
// through before rmSync is called, and with a folder on another volume in it the removal ends
// with the code EXDEV and nothing removed. A part of the tree that cannot be looked at ends it
// the same way, with the error of the look. A mount point with the `dev` of its folder (a bind
// mount on Linux) is not seen.
//
// One junction is a folder to lstat: the one whose target is written with the GUID of a volume
// (worfy-windows ticket 35; the walk as it was listed it and removed the files of that volume).
// So a folder is first asked to go with one rmdir, which removes such a junction as a link, and is
// listed only when the answer is "not empty" and, when the volume of the folder it lies in is
// known, it is on that volume. An entry a listing names and lstat does not see (such a junction
// whose volume is gone) is asked to go with one rmdir (worfy-windows ticket 45), and so is a path
// given that lstat does not see.
// The price: a folder that is busy itself is waited for before its entries, and keeps them when
// it stays busy.
//
// The scripts cannot import from src/main, so this is a copy of removeTree of
// src/main/storage/remove.ts; test/unit/remove-tree-copies.test.ts runs both over the same trees.

import { lstatSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * Removes a file, a link, or a folder with everything in it; a path that is not there is not an
 * error. A link is removed as a link: what it leads to is neither entered nor touched. Off Windows,
 * a folder with a volume mounted in it is not removed: the error has the code EXDEV and the mount
 * point as its `path`.
 */
// <remove-tree>
export function removeTree(given) {
  // The waits are those of the whole removal, five in all: a folder of entries that stay busy
  // does not wait for each of them. They are made here and never taken from the caller: given
  // to forEach, this function gets the number of the entry as its second argument.
  return removeWalk(given, { waits: 5 })
}

// Off Windows, before anything is removed: the first folder, at the path or below it, that is on
// another volume than the folder it lies in, or null. A volume is mounted on such a folder; lstat
// calls it a plain folder, and rmSync would remove every file of that volume (measured on macOS,
// worfy-windows ticket 44). Reads and removes nothing; a link is not followed. What cannot be
// looked at is thrown: it may hold a mount point. "outer" is the volume of the folder the path
// lies in; for the path the caller gave it is asked as "path/..", which the system resolves.
// "folder" is the folder whose listing named the path; the path the caller gave has none.
function removeMounted(path, outer, folder) {
  const gone = (error) => Boolean(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  let seen
  try {
    seen = lstatSync(path)
  } catch (error) {
    if (!gone(error)) throw error
    // An entry its folder has just listed, not there to lstat: gone meanwhile, or a name the
    // system does not read back (a name that is not UTF-8, on Linux, worfy-windows ticket 47).
    // The folder is listed once more; while it still names the entry, what that holds cannot be
    // seen.
    let listed
    try {
      listed = folder !== undefined && readdirSync(folder).includes(path.slice(folder.length + 1))
    } catch (again) {
      if (!gone(again)) throw again
      listed = false
    }
    if (listed) throw Object.assign(new Error(error.message + ': the folder it lies in still lists it, so what it holds cannot be looked at'), { code: error.code, path })
    return null
  }
  if (!seen.isDirectory()) return null
  let names
  try {
    if (seen.dev !== (outer === undefined ? lstatSync(path + '/..').dev : outer)) return path
    names = readdirSync(path)
  } catch (error) {
    // Gone meanwhile: nothing is there to be removed, or to be kept from it.
    if (gone(error)) return null
    throw error
  }
  for (const name of names) {
    // Under the text of the path given, as the folder itself, its ".." and rmSync are asked: join
    // would cut a ".." in that text, which the system resolves through a link.
    const found = removeMounted(path + '/' + name, seen.dev, path)
    if (found !== null) return found
  }
  return null
}

// "outer" is the volume of the folder the path lies in; the path the caller gave has none yet.
function removeWalk(given, patience, outer) {
  // Off Windows rmSync never went through a link. It does go into a volume mounted in the tree,
  // so the tree is looked through first, and with a mounted volume in it nothing is removed. The
  // walk is for Windows alone, and holds for a tree nobody else changes meanwhile.
  if (process.platform !== 'win32') {
    let mounted
    try {
      mounted = removeMounted(given)
    } catch (error) {
      // What the look could not see ends the removal before rmSync: its error, with its code and
      // its path, and words that name the path given and say so.
      throw Object.assign(new Error(error.message + '. Nothing of ' + given + ' was removed'), { code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, cause: error })
    }
    if (mounted !== null) throw Object.assign(new Error('EXDEV: ' + mounted + ' is on another volume than the folder it lies in: a volume is mounted there. Nothing of ' + given + ' was removed'), { code: 'EXDEV', path: mounted })
    return rmSync(given, { recursive: true, force: true })
  }
  // Separators at the end go, but for the root of a disk: lstat follows a link written with one.
  const cut = given.replace(/[\\/]+$/, '')
  const path = cut === '' || cut.endsWith(':') ? given : cut
  const gone = (error) => Boolean(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  let seen
  try {
    seen = lstatSync(path)
  } catch (error) {
    if (!gone(error)) throw error
    // An entry its folder lists, not there to lstat: a junction by GUID whose volume is gone
    // answers so (worfy-windows ticket 45), the path given too. One rmdir, which lists nothing,
    // whatever it answers: the rmdir of its folder tells what stays.
    try {
      rmdirSync(path)
    } catch {
      // Nothing is there, or it stays and its folder fails as "not empty".
    }
    return
  }
  const folder = seen.isDirectory()
  // Removes the entry itself and asks again while the answer is "busy"; the waits that are left
  // are those of the whole removal (removeTree). With "first", a folder that answers "not empty"
  // is not waited for: false says that it holds entries.
  const goes = (first) => {
    for (;;) {
      try {
        if (folder) rmdirSync(path)
        else unlinkSync(path)
        return true
      } catch (error) {
        const code = error && error.code
        if (code === 'ENOENT') return true
        if (first && code === 'ENOTEMPTY') return false
        if (patience.waits === 0 || !['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(code)) throw error
        patience.waits -= 1
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  }
  if (!folder) {
    goes(false)
    return
  }
  // A junction that leads to a volume by its GUID is a folder to lstat, and a listing of it reads
  // that volume (worfy-windows ticket 35). So a folder is listed only when it has answered "not
  // empty" to one rmdir and, when the volume of the folder it lies in is known, it is on that
  // volume. For the path the caller gave that volume is unknown when its parent is a link to lstat
  // or cannot be asked: then the first rmdir alone decides.
  let volume = outer
  if (volume === undefined) {
    try {
      // A parent that is a link to lstat (an ordinary junction, a symlink) answers with the
      // volume the link lies on, not the one this path is on: unknown then.
      const parent = lstatSync(join(path, '..'))
      if (parent.isDirectory()) volume = parent.dev
    } catch {
      // The parent cannot be asked: the first rmdir below still decides.
    }
  }
  if (volume !== undefined && seen.dev !== volume) {
    goes(false)
    return
  }
  if (goes(true)) return
  let names
  try {
    names = readdirSync(path)
  } catch (error) {
    if (gone(error)) return
    throw error
  }
  // An entry that cannot be removed does not end the walk: the first error is thrown at the end.
  let failed = null
  for (const name of names) {
    try {
      removeWalk(join(path, name), patience, seen.dev)
    } catch (error) {
      if (failed === null) failed = { error }
    }
  }
  if (failed !== null) throw failed.error
  goes(false)
}
// </remove-tree>
