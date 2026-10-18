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
// that another process swaps for a link during the removal would be entered. Two such windows of
// the rules below (worfy-windows ticket 45; read, not measured): a folder swapped for a junction by
// GUID between its first rmdir, which answered ENOTEMPTY, and its listing is listed — the window
// ran from lstat to the listing before those rules, and is shorter now; a folder swapped for a file
// between lstat and its first rmdir is taken as gone, since libuv answers ENOENT to rmdir of a path
// that is no folder — the file stays, and its folder then fails as "not empty". The walk before
// came to the same through ENOTDIR of the listing.
//
// One link lstat does not see (worfy-windows ticket 35): a junction whose target is written with
// the GUID of a volume (`mklink /J link \\?\Volume{…}\`, or a folder of such a volume). Measured
// on the PC, Windows 11 26200, under both Nodes 24.21.0: lstat calls it a folder and gives the
// `dev` of the volume it leads to, readlink answers EINVAL, a listing reads the volume — and the
// walk as it was removed every file there. unlink refuses it with EPERM; one rmdir removes it as
// the link it is, also while it is busy, and leaves the volume alone. A folder that holds entries
// answers ENOTEMPTY to rmdir in every state measured (read-only, a file held open in it, a path
// of 359 characters), but for the working folder of a running process, which answers EBUSY.
// Hence, before a folder is listed:
//   - it is first asked to go with one rmdir, and is listed only when the answer is ENOTEMPTY.
//     This rule is enough alone: it also covers a junction by GUID that leads to a folder of its
//     own volume, where the volume says nothing;
//   - a second guard for the junction to another volume: a folder on another volume than the
//     folder it lies in is never listed, whatever rmdir answers. It is asked to go with rmdir, and
//     nothing more. The folder a path lies in is asked for its volume only when lstat calls it a
//     folder: an ordinary junction or a symlink there answers with the volume the link lies on,
//     not the one the path is on (measured). Nor is it known when that folder cannot be asked:
//     for a path written with \\?\ that lies in the root of a disk it is `\\?\C:`, and lstat of
//     that answers EISDIR (measured under both Nodes, worfy-windows ticket 45; no caller gives such
//     a path, read). For the path given the first rmdir alone decides then.
// An entry its folder lists and lstat says is not there (ENOENT, ENOTDIR) is asked to go with one
// rmdir, whatever it answers. A junction by GUID whose volume is detached, or whose target folder
// is gone, answers ENOENT to lstat, and kept its folder from going at every removal; rmdir removes
// it as the link it is (measured, worfy-windows ticket 45). That rmdir lists nothing. The path given
// to removeTree gets the same rmdir when lstat does not see it: such a junction given directly
// stayed, and restoring a folder over it then failed with EEXIST. So a path that is not there costs
// one more rmdir, which answers ENOENT.
// The price: a folder that is busy itself is waited for before its entries — the walk before came
// to it last — and keeps what it holds while it stays busy. Once the waits of the removal are
// spent, half a second, it fails; the walk before removed the entries first, and succeeded when
// the folder was let go meanwhile. In the trash (src/main/layout/trash.ts) that is the folder of an
// entry, which the rollback of put and restore remove: busy itself, it keeps entry.json, and list
// shows an entry whose Card is back in place. Only a process with its working folder there makes
// it busy so; the application starts none (read).
//
// On every other system fs.rmSync removes the tree, as before this module: there it never went
// through a link, it is safe against such a swap, it goes on past an entry it cannot remove, and
// it has no limit on the length of a path (measured on macOS for worfy-windows ticket 44: a tree
// with a path of 1693 bytes goes, where lstat by that path answers ENAMETOOLONG).
//
// One folder it does go into (worfy-windows ticket 44): a folder a volume is mounted on. Measured
// on macOS 26.6.1 under the system Node 24.19.0 and the Node of Electron 44.5.1: lstat calls a
// mount point a folder — only its `dev` differs from that of the folder it lies in — rmdir answers
// EBUSY, also for an empty volume, and fs.rmSync with `recursive` removed every file of the volume
// before it threw: ENOTEMPTY for the folder the mount point lies in, "Resource busy" with no code
// for the mount point itself. So off Windows the tree is looked through before anything is
// removed — lstat of every entry, a listing of every folder, no link followed — and a folder on
// another volume than the folder it lies in ends the removal with the code EXDEV and nothing
// removed. The folder the given path lies in is asked as `path/..`, which the system resolves: a
// link on the way to it is followed (`/tmp` is one on macOS). An entry of a folder is asked as
// `path/name` for the same reason: every call of the look, and rmSync after it, gets the text of
// the path given, so a `..` in it is resolved by the system for all of them alike.
// What the look costs, and what it does not cover:
//   - the folder the given path lies in is asked through the path, so a given folder that can be
//     listed but not searched — an empty folder of mode 0444 — ends the removal with EACCES,
//     where rmSync alone removed it (measured on that Mac under both Nodes);
//   - a part of the tree that cannot be looked at — a folder that cannot be listed, a path longer
//     than one call takes — ends the removal with that error and nothing removed, where rmSync
//     alone removed the rest of the tree, or all of it. rmSync reaches where a look by the full
//     path cannot (the tree of 1693 bytes above), so what is not seen is not removed;
//   - a mount point with the `dev` of the folder it lies in is not seen. Measured on the same Mac:
//     /System/Volumes/Data, the data volume the system mounts itself, answers with the `dev` of
//     /System/Volumes, a folder of the system volume. A disk image attached on a folder did not
//     (16777245 against 16777233). Expected, and not measured, for a bind mount of a folder of the
//     same file system on Linux. Only the answer of rmdir would tell, and rmSync does not ask
//     before it removes;
//   - a volume mounted between the look and the removal is not seen;
//   - one more pass over the tree: 12 to 20 ms for 4000 files on that Mac, where their removal
//     takes about 200 ms.
// The walk of Windows was not taken for the other systems. It goes by full paths: measured on
// macOS, it leaves the tree of 1693 bytes with ENAMETOOLONG. Over the model of the tests it
// removes what lies beside a mount point before it fails. And it waits half a second on EACCES
// and EPERM (BUSY below), which off Windows do not pass in a moment.
//
// The text of scripts that cannot import anything keeps a copy of both functions: the restore
// script of src/main/harness/migrate/restore.ts, scripts/remove-tree.mjs and
// scripts/install-stable.mjs. test/unit/remove-tree-copies.test.ts compares the copies.
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
  lstatSync: (path: string) => Pick<Stats, 'isDirectory' | 'dev'>
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

/** What lstat says of a path — whether it is a folder, and the volume it is on — or null when nothing is there. */
function seenAt(path: string, fs: RemoveFs): { folder: boolean; volume: number } | null {
  try {
    const seen = fs.lstatSync(path)
    return { folder: seen.isDirectory(), volume: seen.dev }
  } catch (error) {
    if (GONE.includes(codeOf(error) ?? '')) return null
    throw error
  }
}

/**
 * Asks a folder to go as it is, before anything in it is listed. True when it went, or was gone;
 * false when it answered "not empty": it holds entries, and only then may it be listed. While the
 * answer is "busy" it is asked again, as any step is; any other answer is thrown.
 */
function goesUnlisted(path: string, fs: RemoveFs, options: RemoveOptions, patience: Patience): boolean {
  for (;;) {
    try {
      fs.rmdirSync(path)
      return true
    } catch (error) {
      const code = codeOf(error)
      if (code === 'ENOENT') return true
      if (code === 'ENOTEMPTY') return false
      if (patience.waits === 0 || !BUSY.includes(code ?? '')) throw error
      patience.waits -= 1
      ;(options.wait ?? sleep)(REMOVE_RETRY_MS)
    }
  }
}

/**
 * The walk of Windows. An entry that cannot be removed does not end it: the others go, and the
 * first error is thrown at the end, with the folder left for what stayed in it.
 *
 * `outer` is the volume of the folder the path lies in; the path the caller gave has none yet, and
 * its parent folder is asked. A folder is listed only when it has answered "not empty" to one rmdir
 * and, when the volume of the folder it lies in is known, it is on that volume (the two rules of
 * the header). For the path the caller gave that volume is unknown when its parent is a link to
 * lstat or cannot be asked: then the first rmdir alone decides.
 */
function walk(path: string, fs: RemoveFs, options: RemoveOptions, patience: Patience, outer?: number): void {
  const seen = seenAt(path, fs)
  if (seen === null) {
    // An entry its folder lists, not there to lstat: a junction by GUID whose volume is gone
    // answers so (the header), the path given too. One rmdir, whatever it answers: its folder's own
    // rmdir tells what stays.
    try {
      fs.rmdirSync(path)
    } catch {
      // Nothing is there, or it stays and its folder fails as "not empty".
    }
    return
  }
  if (!seen.folder) {
    patiently(() => fs.unlinkSync(path), options, patience)
    return
  }
  let volume = outer
  if (volume === undefined) {
    try {
      // A parent that is a link to lstat — an ordinary junction, a symlink — answers with the
      // volume the link lies on, not the one this path is on (measured): unknown then.
      const parent = fs.lstatSync(join(path, '..'))
      if (parent.isDirectory()) volume = parent.dev
    } catch {
      // The parent cannot be asked: the first rmdir below still decides.
    }
  }
  if (volume !== undefined && seen.volume !== volume) {
    // On another volume than the folder it lies in: the way into that volume, not a folder of this
    // tree. It goes as the link it is, or the removal ends with what rmdir answers.
    patiently(() => fs.rmdirSync(path), options, patience)
    return
  }
  if (goesUnlisted(path, fs, options, patience)) return
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
      walk(join(path, name), fs, options, patience, seen.volume)
    } catch (error) {
      failed ??= { error }
    }
  }
  if (failed !== null) throw failed.error
  patiently(() => fs.rmdirSync(path), options, patience)
}

/** The code of the error removeTree ends with off Windows when a volume is mounted in the tree. */
export const MOUNTED_VOLUME = 'EXDEV'

/**
 * The look that comes before fs.rmSync off Windows: the first folder, at the path or anywhere
 * below it, that is on another volume than the folder it lies in — a volume is mounted on it — or
 * null. Reads and removes nothing; a link is not followed, and what is not there is no folder.
 * Throws what lstat or a listing throws for any other reason: what cannot be looked at may hold a
 * mount point. `outer` is the volume of the folder the path lies in; the path the caller gave has
 * none yet, and `path/..` is asked — the folder the system reaches the path in, also through a link.
 */
function mountedIn(path: string, fs: RemoveFs, outer?: number): string | null {
  let volume: number
  let names: string[]
  try {
    const seen = fs.lstatSync(path)
    if (!seen.isDirectory()) return null
    volume = seen.dev
    if (volume !== (outer ?? fs.lstatSync(`${path}/..`).dev)) return path
    names = fs.readdirSync(path)
  } catch (error) {
    // Gone meanwhile: nothing is there to be removed, or to be kept from it.
    if (GONE.includes(codeOf(error) ?? '')) return null
    throw error
  }
  for (const name of names) {
    // Under the text of the path given, as the folder itself, its `..` and rmSync are asked: join
    // would cut a `..` in that text, which the system resolves through a link.
    const found = mountedIn(`${path}/${name}`, fs, volume)
    if (found !== null) return found
  }
  return null
}

/**
 * Removes what is at `path`: a file, a link, or a folder with everything in it. A path that is not
 * there is not an error. A link — a symlink or a junction, at the path itself or anywhere below —
 * is removed as a link: what it leads to is neither entered nor touched, as long as nobody else
 * changes the tree meanwhile. Takes the place of `rmSync(path, { recursive: true, force: true })`.
 *
 * Off Windows it is that call, after a look through the tree: when a folder in it is on another
 * volume than the folder it lies in — a volume is mounted there, and rmSync would remove its
 * files — nothing is removed, and the error has the code MOUNTED_VOLUME and that folder as `path`.
 */
export function removeTree(path: string, options: RemoveOptions = {}): void {
  const fs = options.fs ?? nodeFs
  if (!onWindows(options)) {
    const mounted = mountedIn(path, fs)
    if (mounted !== null) {
      throw Object.assign(new Error(`${MOUNTED_VOLUME}: ${mounted} is on another volume than the folder it lies in: a volume is mounted there. Nothing of ${path} was removed`), { code: MOUNTED_VOLUME, path: mounted })
    }
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
