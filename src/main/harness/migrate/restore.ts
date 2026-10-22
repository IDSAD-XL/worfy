// The one-command undo of a Harness move (worfy-harness ticket 14, item 6): restore.mjs in the
// backup folder. It needs neither worfy nor the plugin, only node (and git when ~/.claude is a git
// repository):
//
//   node ~/.claude/worfy-harness/backup-<date>/restore.mjs
//
// It disables the plugin `worfy` first (`claude plugin disable … --scope user`; with no `claude` in
// PATH it prints that command), so the old hooks it brings back do not run next to the plugin's.
// Then it reverts the move's commits, puts every file the move took or changed back from the backup,
// takes what the move created in the Harness home away, and puts the qmd record back into
// .claude.json at its old place.
//
// What changed after the move is kept (ADR-0047, ADR-0019): a path whose content is no longer what
// the move left there — a lesson /retro wrote into a moved Profile, a rules.md edit, a lock a live
// Session made, settings.json changed by Claude Code — is copied into <backup>/after/ (after-2/, …
// for a later run, so no run overwrites what an earlier one kept) before the backup's version takes
// its place; so is the .git a move created in the Harness home. A finished restore marks the
// manifest (restoredAt), and a second run changes nothing.
// Every path of the manifest is checked first: inside the Claude home or the Harness home of the
// manifest, or the restore stops before it changes anything.
//
// A failed move undoes itself through the same file (apply.ts imports it and calls `restore` with
// `disablePlugin: false`: before the move the plugin was enabled, and that is the state it returns to).
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const RESTORE_SCRIPT = 'restore.mjs'
export const MANIFEST = 'manifest.json'
/** The folder of the backup that holds the files taken from the Claude home, by their relative path. */
export const BACKUP_CLAUDE_DIR = 'claude'
/** The folder of the backup a restore moves what changed after the move into. */
export const BACKUP_AFTER_DIR = 'after'
/** afterMove of a path the move was changing when it stopped. */
export const PENDING = 'pending'

/** What a move did, as restore.mjs reads it. */
export interface Manifest {
  version: 1
  createdAt: string
  claudeHome: string
  harnessHome: string
  claudeJson: string
  /** The plugin restore.mjs disables. */
  plugin: string
  /** Paths under the Claude home copied to <backup>/claude/ before any write; put back by a restore. */
  claude: string[]
  /**
   * treeHash() of each path of `claude` as the move left it (null: removed). PENDING while the move
   * is changing it (a crash there leaves it unknown); no entry: the move never touched it, and a
   * restore leaves it as it is.
   */
  afterMove: Record<string, string | null>
  /** Files the move creates under the Harness home; a restore takes them away. */
  created: string[]
  /** treeHash() of each file of `created` as the move wrote it; a file without one was not written by the move. */
  createdHashes: Record<string, string>
  /** Folders the move creates under the Harness home, deepest first; a restore takes them away. */
  createdDirs: string[]
  /** The record the move takes out of `mcpServers` in .claude.json, and its place among the servers. */
  claudeJsonRecord: { key: string; index: number; value: unknown } | null
  /** The move's commits: in the Claude home, and in the Harness home. */
  commits: { claudeHome: string | null; harnessHome: string | null }
  /** Whether the move ran `git init` in the Harness home (a restore then moves its .git into after/). */
  harnessGitInit: boolean
  /** Set by a restore that finished: the next run of restore.mjs changes nothing. */
  restoredAt?: string
}

/**
 * A fingerprint of a file, link or folder: equal fingerprints mean equal content and modes. null
 * when nothing is there. restore.mjs computes the same in plain JavaScript (the contract test keeps
 * the two in step).
 */
export function treeHash(path: string): string | null {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return null
  }
  if (stat.isSymbolicLink()) return `link:${readlinkSync(path)}`
  if (stat.isDirectory()) {
    const hash = createHash('sha256')
    for (const name of readdirSync(path).sort()) hash.update(`${name}\u0000${treeHash(join(path, name)) ?? ''}\n`)
    return `dir:${hash.digest('hex')}`
  }
  return `file:${(stat.mode & 0o777).toString(8)}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

// Plain JavaScript, no dependencies: it has to run with any node, without worfy. No backquotes in it,
// since it lives in a template literal.
const SOURCE = String.raw`#!/usr/bin/env node
// Undoes the move of the old Harness out of ~/.claude that worfy made (worfy-harness ticket 14).
//
//   node <this folder>/restore.mjs              disables the plugin worfy, then restores
//   node <this folder>/restore.mjs --keep-plugin restores and leaves the plugin as it is
//
// What the move took or changed is in this folder (claude/, manifest.json). What changed after the
// move is not lost: it goes to after/ in this folder (after-2/, … for a later run) before the old
// version takes its place. Once restored, a second run changes nothing. Exit code 0: restored.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Removes a file, a link, or a folder with everything in it; a path that is not there is not an
// error. A link is removed as a link: what it leads to is not entered. On Windows fs.rmSync is not
// used: under the Node of Electron 44 its "recursive" goes through a junction and empties the
// folder behind it, and it refuses a read-only file. A junction whose target is written with the
// GUID of a volume is a folder to lstat (worfy-windows ticket 35): a folder is first asked to go
// with one rmdir and is listed only when the answer is "not empty" and, when the volume of the
// folder it lies in is known, it is on that volume; an entry a listing names and lstat does not see
// (such a junction whose volume is gone) is asked to go with one rmdir (worfy-windows ticket 45),
// and so is a path given that lstat does not see;
// a folder that is busy itself keeps what it holds. Off Windows fs.rmSync is
// used, and it goes into a folder a volume is mounted on (worfy-windows ticket 44; measured on
// macOS: the files of the volume were removed). So a folder is looked through first, and with a
// folder on another volume than the folder it lies in the removal ends with the code EXDEV and
// nothing removed. A copy of removeTree of src/main/storage/remove.ts, since this script imports
// nothing of worfy; test/unit/remove-tree-copies.test.ts runs both over the same trees.
// <remove-tree>
function removeTree(given) {
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

// Removes one file, or one link as a link; a path that is not there is not an error, a folder is.
// A copy of removeFile of src/main/storage/remove.ts; the same test compares the two.
// <remove-file>
function removeFile(given) {
  if (process.platform !== 'win32') return rmSync(given, { force: true })
  const cut = given.replace(/[\\/]+$/, '')
  const path = cut === '' || cut.endsWith(':') ? given : cut
  let folder
  try {
    folder = lstatSync(path).isDirectory()
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return
    throw error
  }
  if (folder) throw Object.assign(new Error(path + ' is a folder: removeFile removes a file or a link'), { code: 'EISDIR' })
  for (let left = 5; ; left--) {
    try {
      unlinkSync(path)
      return
    } catch (error) {
      const code = error && error.code
      if (code === 'ENOENT') return
      if (left === 0 || !['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(code)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
}
// </remove-file>

function within(root, rel) {
  if (typeof rel !== 'string' || rel === '') throw new Error('refusing an empty path under ' + root)
  const path = resolve(root, rel)
  const inside = relative(resolve(root), path)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw new Error('refusing a path outside ' + root + ': ' + rel)
  return path
}

export function treeHash(path) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return null
  }
  if (stat.isSymbolicLink()) return 'link:' + readlinkSync(path)
  if (stat.isDirectory()) {
    const hash = createHash('sha256')
    for (const name of readdirSync(path).sort()) hash.update(name + '\u0000' + (treeHash(join(path, name)) ?? '') + '\n')
    return 'dir:' + hash.digest('hex')
  }
  return 'file:' + (stat.mode & 0o777).toString(8) + ':' + createHash('sha256').update(readFileSync(path)).digest('hex')
}

function git(dir, args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

function revert(dir, sha, log) {
  if (!sha) return
  const run = git(dir, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'revert', '--no-edit', sha])
  if (run.status === 0) {
    log('Reverted the move commit ' + sha.slice(0, 8) + ' in ' + dir)
    return
  }
  git(dir, ['revert', '--abort'])
  log('Could not revert ' + sha.slice(0, 8) + ' in ' + dir + ' (' + String(run.stderr || '').trim().split('\n')[0] + '); the files are restored from the backup anyway.')
}

// Copies a path into <afterDir>/<area>/<rel>; with move, moves it there. Never deletes it.
function keepAside(afterDir, area, rel, path, log, move) {
  const target = join(afterDir, area, rel)
  mkdirSync(dirname(target), { recursive: true })
  let moved = false
  if (move) {
    try {
      renameSync(path, target)
      moved = true
    } catch {
      moved = false
    }
  }
  if (!moved) {
    cpSync(path, target, { recursive: true, verbatimSymlinks: true })
    if (move) removeTree(path)
  }
  log('Changed after the move, kept in ' + target)
}

// JSON written the way the file was: its indent, its line ends (LF or CRLF) and its final newline.
export function stringifyLike(original, value) {
  const indent = /^[{[]\r?\n([ \t]+)/.exec(original)
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const text = original.includes('\n') ? JSON.stringify(value, null, indent ? indent[1] : 2).replace(/\n/g, eol) : JSON.stringify(value)
  return original.endsWith('\n') ? text + eol : text
}

function writeAtomically(path, text) {
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600
  const temp = path + '.worfy-restore-' + process.pid
  writeFileSync(temp, text, { mode })
  chmodSync(temp, mode)
  renameSync(temp, path)
}

export function restore(backupDir, options = {}) {
  const disablePlugin = options.disablePlugin !== false
  const log = options.log || ((line) => process.stdout.write(line + '\n'))
  const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'))
  const { claudeHome, harnessHome } = manifest
  // Restored once already: a second run would take the restored files for changes and save them over
  // what the first run kept, so it stops here.
  if (manifest.restoredAt) {
    log('Already restored at ' + manifest.restoredAt + ' from this backup: nothing to do.')
    return
  }
  // Each run saves into its own folder (after/, then after-2/, …): one that stopped before it was
  // marked restored never has what it kept overwritten by the next.
  let afterDir = join(backupDir, 'after')
  for (let n = 2; existsSync(afterDir); n += 1) afterDir = join(backupDir, 'after-' + n)
  const afterMove = manifest.afterMove || {}
  const createdHashes = manifest.createdHashes || {}

  // Every path first: one outside the two homes stops the restore before anything changes.
  const claude = manifest.claude.map((rel) => ({ rel, target: within(claudeHome, rel), source: within(join(backupDir, 'claude'), rel) }))
  for (const entry of claude) if (!existsSync(entry.source)) throw new Error('the backup has no ' + entry.source)
  const created = manifest.created.map((rel) => ({ rel, path: within(harnessHome, rel) }))
  const createdDirs = manifest.createdDirs.map((rel) => ({ rel, path: within(harnessHome, rel) }))
  const harnessGit = within(harnessHome, '.git')

  if (disablePlugin) {
    const args = ['plugin', 'disable', manifest.plugin, '--scope', 'user']
    const run = spawnSync('claude', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    if (run.error) log('No claude in PATH. Disable the plugin yourself, or its hooks run next to the old ones:\n  claude ' + args.join(' '))
    else if (run.status !== 0) log('claude ' + args.join(' ') + ' exited with ' + run.status + '. Run it yourself, or the plugin hooks run next to the old ones.')
    else log('Disabled the plugin ' + manifest.plugin + '.')
  }

  // What changed after the move is copied aside first, before git or the backup touch it.
  const touched = claude.filter(({ rel }) => rel in afterMove)
  for (const { rel, target, source } of touched) {
    const expected = afterMove[rel] === 'pending' ? treeHash(source) : afterMove[rel]
    const current = treeHash(target)
    if (current !== null && current !== expected) keepAside(afterDir, 'claude', rel, target, log, false)
  }
  for (const { rel, path } of created) {
    const current = treeHash(path)
    if (current !== null && current !== createdHashes[rel]) keepAside(afterDir, 'harness', rel, path, log, false)
  }

  revert(claudeHome, manifest.commits.claudeHome, log)
  if (!manifest.harnessGitInit) revert(harnessHome, manifest.commits.harnessHome, log)

  // A path the move never touched (it stopped before) stays as it is.
  for (const { target, source } of touched) {
    removeTree(target)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, verbatimSymlinks: true })
  }
  for (const { path } of created) removeFile(path)
  if (manifest.harnessGitInit && existsSync(harnessGit)) keepAside(afterDir, 'harness-git', '.git', harnessGit, log, true)
  for (const { rel, path } of createdDirs) {
    if (!existsSync(path)) continue
    for (const name of readdirSync(path)) keepAside(afterDir, 'harness', join(rel, name), join(path, name), log, true)
    rmdirSync(path)
  }

  const record = manifest.claudeJsonRecord
  if (record) {
    const path = manifest.claudeJson
    const original = readFileSync(path, 'utf8')
    const json = JSON.parse(original)
    const servers = json.mcpServers && typeof json.mcpServers === 'object' ? json.mcpServers : {}
    if (!(record.key in servers)) {
      const entries = Object.entries(servers)
      entries.splice(Math.min(record.index, entries.length), 0, [record.key, record.value])
      json.mcpServers = Object.fromEntries(entries)
      writeAtomically(path, stringifyLike(original, json))
    }
    log('Put mcpServers.' + record.key + ' back into ' + path + '.')
  }
  manifest.restoredAt = new Date().toISOString()
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  log('Restored the old Harness in ' + claudeHome + ' from ' + backupDir + '.')
}

const self = fileURLToPath(import.meta.url)
let invoked = null
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : null
} catch {
  invoked = null
}
if (invoked !== null && invoked === realpathSync(self)) {
  try {
    restore(dirname(self), { disablePlugin: !process.argv.includes('--keep-plugin') })
  } catch (error) {
    process.stderr.write('restore failed: ' + (error && error.message ? error.message : String(error)) + '\n')
    process.exit(1)
  }
}
`

/** The text of restore.mjs. */
export function restoreScriptSource(): string {
  return SOURCE
}

/** Writes restore.mjs and the manifest into the backup folder; restore.mjs may be run directly. */
export function writeRestoreFiles(backupDir: string, manifest: Manifest): void {
  writeManifest(backupDir, manifest)
  const script = join(backupDir, RESTORE_SCRIPT)
  writeFileSync(script, SOURCE)
  chmodSync(script, 0o755)
}

export function writeManifest(backupDir: string, manifest: Manifest): void {
  writeFileSync(join(backupDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * The command the form shows after a move, quoted for the shell of the system: sh takes single
 * quotes with `'\''` for a quote inside. cmd.exe takes no single quotes at all, and `'\''` is not
 * PowerShell's escape, so on Windows the path goes in double quotes, which both shells take.
 */
export function restoreCommand(backupDir: string, platform: NodeJS.Platform = process.platform): string {
  const path = join(backupDir, RESTORE_SCRIPT)
  if (/^[\w./+@-]+$/.test(path)) return `node ${path}`
  // shortcut: inside double quotes PowerShell still expands `$` and a backtick, cmd.exe `%NAME%`; redo when a backup path with one of them is reported.
  if (platform === 'win32') return `node "${path}"`
  return `node '${path.replace(/'/g, `'\\''`)}'`
}
