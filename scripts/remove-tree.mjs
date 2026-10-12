// Removing a folder in the scripts of this repository (worfy-windows ticket 23).
//
// fs.rmSync is not used for that. Under Node 24 on Windows its `recursive` goes through a junction
// (a link to a folder on NTFS) and empties the folder behind it, and it refuses a read-only file
// with EPERM; under Node 22 it does neither. fs.unlinkSync, under both, removes a read-only file,
// and removes a junction or a symlink as the link it is.
//
// The scripts cannot import from src/main, so this is a copy of removeTree of
// src/main/storage/remove.ts; test/unit/remove-tree.test.ts runs both over the same trees.

import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * Removes a file, a link, or a folder with everything in it; a path that is not there is not an
 * error. A link is removed as a link: what it leads to is neither entered nor touched.
 */
// <remove-tree>
export function removeTree(path) {
  let folder
  try {
    folder = lstatSync(path).isDirectory()
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
  if (folder) for (const name of readdirSync(path)) removeTree(join(path, name))
  for (let left = process.platform === 'win32' ? 5 : 0; ; left--) {
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
