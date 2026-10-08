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
// Nothing written after the move is lost (ADR-0047, ADR-0019): a path whose content is no longer what
// the move left there — a lesson /retro wrote into a moved Profile, a rules.md edit, a lock a live
// Session made, settings.json changed by Claude Code — is moved into <backup>/after/ before the
// backup's version takes its place. The same goes for the .git a move created in the Harness home.
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
// move is not lost: it goes to after/ in this folder before the old version takes its place.
// Exit code 0: restored.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// Copies a path into after/<area>/<rel> of the backup; with move, moves it there. Never deletes it.
function keepAside(backupDir, area, rel, path, log, move) {
  const target = join(backupDir, 'after', area, rel)
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
    if (move) rmSync(path, { recursive: true, force: true })
  }
  log('Changed after the move, kept in ' + target)
}

// JSON written the way the file was: its indent and its final newline.
function stringifyLike(original, value) {
  const indent = /^[{[]\r?\n([ \t]+)/.exec(original)
  const text = original.includes('\n') ? JSON.stringify(value, null, indent ? indent[1] : 2) : JSON.stringify(value)
  return original.endsWith('\n') ? text + '\n' : text
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
    if (current !== null && current !== expected) keepAside(backupDir, 'claude', rel, target, log, false)
  }
  for (const { rel, path } of created) {
    const current = treeHash(path)
    if (current !== null && current !== createdHashes[rel]) keepAside(backupDir, 'harness', rel, path, log, false)
  }

  revert(claudeHome, manifest.commits.claudeHome, log)
  if (!manifest.harnessGitInit) revert(harnessHome, manifest.commits.harnessHome, log)

  // A path the move never touched (it stopped before) stays as it is.
  for (const { target, source } of touched) {
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, verbatimSymlinks: true })
  }
  for (const { path } of created) rmSync(path, { force: true })
  if (manifest.harnessGitInit && existsSync(harnessGit)) keepAside(backupDir, 'harness-git', '.git', harnessGit, log, true)
  for (const { rel, path } of createdDirs) {
    if (!existsSync(path)) continue
    for (const name of readdirSync(path)) keepAside(backupDir, 'harness', join(rel, name), join(path, name), log, true)
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

/** The command the form shows after a move. */
export function restoreCommand(backupDir: string): string {
  const path = join(backupDir, RESTORE_SCRIPT)
  return `node ${/^[\w./+@-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`}`
}
