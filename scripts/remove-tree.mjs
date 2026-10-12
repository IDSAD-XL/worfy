// Removing a folder in the scripts of this repository (worfy-windows ticket 23).
//
// On Windows fs.rmSync is not used for that. Under Node 24 its `recursive` goes through a junction
// (a link to a folder on NTFS) and empties the folder behind it, and it refuses a read-only file
// with EPERM; under Node 22 it does neither. fs.unlinkSync, under both, removes a read-only file,
// and removes a junction or a symlink as the link it is. On every other system fs.rmSync is called,
// as before: it never went through a link there.
//
// The scripts cannot import from src/main, so this is a copy of removeTree of
// src/main/storage/remove.ts; test/unit/remove-tree.test.ts runs both over the same trees.

import { lstatSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * Removes a file, a link, or a folder with everything in it; a path that is not there is not an
 * error. A link is removed as a link: what it leads to is neither entered nor touched.
 */
// <remove-tree>
export function removeTree(path) {
  // Off Windows rmSync never went through a link, and nothing changes there. The walk is for
  // Windows alone, and holds for a tree nobody else changes meanwhile.
  if (process.platform !== 'win32') return rmSync(path, { recursive: true, force: true })
  const gone = (error) => Boolean(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  let folder
  try {
    folder = lstatSync(path).isDirectory()
  } catch (error) {
    if (gone(error)) return
    throw error
  }
  if (folder) {
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
        removeTree(join(path, name))
      } catch (error) {
        if (failed === null) failed = { error }
      }
    }
    if (failed !== null) throw failed.error
  }
  for (let left = 5; ; left--) {
    try {
      if (folder) rmdirSync(path)
      else unlinkSync(path)
      return
    } catch (error) {
      const code = error && error.code
      if (code === 'ENOENT') return
      if (left === 0 || !['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(code)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
}
// </remove-tree>
