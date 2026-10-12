// Removing files and folders in the main process (worfy-windows ticket 23). Every removal of a
// tree in src/main goes through this module; fs.rmSync is called nowhere else there
// (test/unit/no-rmsync.test.ts).
//
// Why not fs.rmSync on Windows. Under the Node that Electron 44 carries (24.21.0 in Electron
// 44.5.1) — the one the main process and the tests run under — measured on the owner's PC:
//   - with `recursive` it goes through a junction (a link to a folder on NTFS) and empties the
//     folder behind it, whether the junction is the path itself or lies inside the folder removed;
//   - it refuses a read-only file with EPERM, and a junction without `recursive` with
//     ERR_FS_EISDIR.
// A Node from nodejs.org does none of this, neither 22.13.0 nor 24.21.0: the difference is in
// the Node Electron builds, not in the version. fs.unlinkSync, under all three, removes a
// read-only file, and removes a junction or a symlink as the link it is, leaving what it leads to.
//
// So on Windows a tree is removed by a walk of its own: lstat says what a path is and never follows
// a link; what is not a folder is unlinked; a folder is emptied and then removed. The walk reaches
// every entry by its full path, so it holds only for a tree nobody else changes meanwhile: a folder
// that another process swaps for a link during the removal would be entered.
//
// On every other system fs.rmSync is called, as before this module: there it never went through a
// link, it is safe against such a swap, it has no limit on the length of a path, and it goes on
// past an entry it cannot remove. Nothing changes off Windows.
//
// The text of scripts that cannot import anything keeps a copy of both functions: the restore
// script of src/main/harness/migrate/restore.ts, scripts/remove-tree.mjs and
// scripts/install-stable.mjs. test/unit/remove-tree.test.ts compares the copies.
import { lstatSync, readdirSync, rmdirSync, rmSync, unlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'

/**
 * How often and how long a removal waits on Windows when a file is busy. The waits are counted for
 * the removal as a whole, not for each entry: the walk goes on past an entry that stays busy, and
 * a folder of such entries must not block the main process for a wait each. So one call of
 * removeTree sleeps for half a second at most, whatever the tree; once the waits are spent, a busy
 * entry fails at its first try.
 */
export const REMOVE_RETRIES = 5
export const REMOVE_RETRY_MS = 100
/** What Windows answers while another process — an antivirus, the indexer — holds a file for a moment. */
const BUSY = ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']
/** What the system answers when nothing is at a path: no such name, or a name on the way is not a folder. */
const GONE = ['ENOENT', 'ENOTDIR']

/** The calls of node:fs the removal makes; tests replace them. */
export interface RemoveFs {
  lstatSync: (path: string) => Pick<Stats, 'isDirectory'>
  readdirSync: (path: string) => string[]
  unlinkSync: (path: string) => void
  rmdirSync: (path: string) => void
  /** The removal of every system but Windows. */
  rmSync: (path: string, options: { recursive?: boolean; force: boolean }) => void
}

export interface RemoveOptions {
  /** The system worfy runs on; that of this process by default. Only Windows walks the tree itself. */
  platform?: NodeJS.Platform
  fs?: RemoveFs
  /** Waits between two tries; by default the thread sleeps. */
  wait?: (ms: number) => void
}

const nodeFs: RemoveFs = { lstatSync, readdirSync: (path) => readdirSync(path), unlinkSync, rmdirSync, rmSync }
const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code
const onWindows = (options: RemoveOptions): boolean => (options.platform ?? process.platform) === 'win32'

/**
 * The path without separators at its end: `link\` names the folder behind a link, and lstat would
 * follow it. The root of a disk keeps its separator.
 */
const trimmed = (path: string): string => {
  const cut = path.replace(/[\\/]+$/, '')
  return cut === '' || cut.endsWith(':') ? path : cut
}

/** The waits one removal has left. */
interface Patience {
  waits: number
}

/** Runs a step; when the answer is "busy", tries again after a moment, while the removal has waits left. */
function patiently(step: () => void, options: RemoveOptions, patience: Patience): void {
  for (;;) {
    try {
      step()
      return
    } catch (error) {
      // Gone meanwhile: that is what was asked for.
      if (codeOf(error) === 'ENOENT') return
      if (patience.waits === 0 || !BUSY.includes(codeOf(error) ?? '')) throw error
      patience.waits -= 1
      ;(options.wait ?? sleep)(REMOVE_RETRY_MS)
    }
  }
}

/** What a path is, by lstat: a link is never followed. Null when nothing is there. */
function kindOf(path: string, fs: RemoveFs): 'folder' | 'other' | null {
  try {
    return fs.lstatSync(path).isDirectory() ? 'folder' : 'other'
  } catch (error) {
    if (GONE.includes(codeOf(error) ?? '')) return null
    throw error
  }
}

/**
 * The walk of Windows. An entry that cannot be removed does not end it: the others go, and the
 * first error is thrown at the end, with the folder left for what stayed in it.
 */
function walk(path: string, fs: RemoveFs, options: RemoveOptions, patience: Patience): void {
  const kind = kindOf(path, fs)
  if (kind === null) return
  if (kind === 'other') {
    patiently(() => fs.unlinkSync(path), options, patience)
    return
  }
  let names: string[]
  try {
    names = fs.readdirSync(path)
  } catch (error) {
    // Gone between the look and the listing.
    if (GONE.includes(codeOf(error) ?? '')) return
    throw error
  }
  let failed: { error: unknown } | null = null
  for (const name of names) {
    try {
      walk(join(path, name), fs, options, patience)
    } catch (error) {
      failed ??= { error }
    }
  }
  if (failed !== null) throw failed.error
  patiently(() => fs.rmdirSync(path), options, patience)
}

/**
 * Removes what is at `path`: a file, a link, or a folder with everything in it. A path that is not
 * there is not an error. A link — a symlink or a junction, at the path itself or anywhere below —
 * is removed as a link: what it leads to is neither entered nor touched, as long as nobody else
 * changes the tree meanwhile. Takes the place of `rmSync(path, { recursive: true, force: true })`,
 * and off Windows is that call.
 */
export function removeTree(path: string, options: RemoveOptions = {}): void {
  const fs = options.fs ?? nodeFs
  if (!onWindows(options)) {
    fs.rmSync(path, { recursive: true, force: true })
    return
  }
  walk(trimmed(path), fs, options, { waits: REMOVE_RETRIES })
}

/**
 * Removes one file, or one link as a link. A path that is not there is not an error; a folder is
 * one. Takes the place of `rmSync(path, { force: true })`, and off Windows is that call. On Windows
 * a folder is refused with the code EISDIR.
 */
export function removeFile(path: string, options: RemoveOptions = {}): void {
  const fs = options.fs ?? nodeFs
  if (!onWindows(options)) {
    fs.rmSync(path, { force: true })
    return
  }
  const file = trimmed(path)
  const kind = kindOf(file, fs)
  if (kind === null) return
  if (kind === 'folder') throw Object.assign(new Error(`${file} is a folder: removeFile removes a file or a link`), { code: 'EISDIR' })
  patiently(() => fs.unlinkSync(file), options, { waits: REMOVE_RETRIES })
}
