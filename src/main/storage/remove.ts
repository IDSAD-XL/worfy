// Removing files and folders in the main process (worfy-windows ticket 23). Every removal in
// src/main goes through this module; fs.rmSync is not called there (test/unit/no-rmsync.test.ts).
//
// Why not fs.rmSync. Under Node 24 — the Node of Electron 44 — on Windows, measured on the owner's PC:
//   - with `recursive` it goes through a junction (a link to a folder on NTFS) and empties the
//     folder behind it, whether the junction is the path itself or lies inside the folder removed;
//   - it refuses a read-only file with EPERM, and a junction without `recursive` with
//     ERR_FS_EISDIR.
// Under Node 22 it does none of this. fs.unlinkSync, under both, removes a read-only file, and
// removes a junction or a symlink as the link it is, leaving what it leads to.
//
// So a tree is removed by a walk of its own: lstat says what a path is and never follows a link;
// what is not a folder is unlinked; a folder is emptied and then removed. Nothing a link leads to
// is ever entered.
//
// The text of scripts that cannot import anything keeps a copy of removeTree: the restore script
// of src/main/harness/migrate/restore.ts. test/unit/remove-tree.test.ts compares the copies.
import { lstatSync, readdirSync, rmdirSync, unlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'

/** How often and how long a step is tried again on Windows when the file is busy. */
export const REMOVE_RETRIES = 5
export const REMOVE_RETRY_MS = 100
/** What Windows answers while another process — an antivirus, the indexer — holds a file for a moment. */
const BUSY = ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']

/** The calls of node:fs the removal makes; tests replace them. */
export interface RemoveFs {
  lstatSync: (path: string) => Pick<Stats, 'isDirectory'>
  readdirSync: (path: string) => string[]
  unlinkSync: (path: string) => void
  rmdirSync: (path: string) => void
}

export interface RemoveOptions {
  /** The system worfy runs on; that of this process by default. Only Windows tries a busy step again. */
  platform?: NodeJS.Platform
  fs?: RemoveFs
  /** Waits between two tries; by default the thread sleeps. */
  wait?: (ms: number) => void
}

const nodeFs: RemoveFs = { lstatSync, readdirSync: (path) => readdirSync(path), unlinkSync, rmdirSync }
const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code

/** Runs a step; on Windows, when the answer is "busy", tries again after a moment, a few times. */
function patiently(step: () => void, options: RemoveOptions): void {
  const tries = (options.platform ?? process.platform) === 'win32' ? REMOVE_RETRIES : 0
  for (let left = tries; ; left--) {
    try {
      step()
      return
    } catch (error) {
      // Gone meanwhile: that is what was asked for.
      if (codeOf(error) === 'ENOENT') return
      if (left === 0 || !BUSY.includes(codeOf(error) ?? '')) throw error
      ;(options.wait ?? sleep)(REMOVE_RETRY_MS)
    }
  }
}

/** What a path is, by lstat: a link is never followed. Null when nothing is there. */
function kindOf(path: string, fs: RemoveFs): 'folder' | 'other' | null {
  try {
    return fs.lstatSync(path).isDirectory() ? 'folder' : 'other'
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null
    throw error
  }
}

/**
 * Removes what is at `path`: a file, a link, or a folder with everything in it. A path that is not
 * there is not an error. A link — a symlink or a junction, at the path itself or anywhere below —
 * is removed as a link: what it leads to is neither entered nor touched. Takes the place of
 * `rmSync(path, { recursive: true, force: true })`.
 */
export function removeTree(path: string, options: RemoveOptions = {}): void {
  const fs = options.fs ?? nodeFs
  const kind = kindOf(path, fs)
  if (kind === null) return
  if (kind === 'other') {
    patiently(() => fs.unlinkSync(path), options)
    return
  }
  for (const name of fs.readdirSync(path)) removeTree(join(path, name), options)
  patiently(() => fs.rmdirSync(path), options)
}

/**
 * Removes one file, or one link as a link. A path that is not there is not an error; a folder is
 * one, as it was for `rmSync(path, { force: true })`, whose place this takes.
 */
export function removeFile(path: string, options: RemoveOptions = {}): void {
  const fs = options.fs ?? nodeFs
  const kind = kindOf(path, fs)
  if (kind === null) return
  if (kind === 'folder') throw Object.assign(new Error(`${path} is a folder: removeFile removes a file or a link`), { code: 'EISDIR' })
  patiently(() => fs.unlinkSync(path), options)
}
