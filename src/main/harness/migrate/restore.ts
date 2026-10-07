// The one-command undo of a Harness move (worfy-harness ticket 14, item 6): restore.mjs in the
// backup folder. It needs neither worfy nor the plugin, only node (and git when ~/.claude is a git
// repository):
//
//   node ~/.claude/worfy-harness/backup-<date>/restore.mjs
//
// It disables the plugin `worfy` first (`claude plugin disable … --scope user`; with no `claude` in
// PATH it prints that command), so the old hooks it brings back do not run next to the plugin's.
// Then it reverts the move's commits, puts every file the move took or changed back from the backup,
// removes what the move created in the Harness home, and puts the qmd record back into .claude.json
// at its old place. Every path it writes is checked to be inside the Claude home or the Harness
// home of the manifest.
//
// A failed move undoes itself through the same file (apply.ts imports it and calls `restore` with
// `disablePlugin: false`: before the move the plugin was enabled, and that is the state it returns to).
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const RESTORE_SCRIPT = 'restore.mjs'
export const MANIFEST = 'manifest.json'
/** The folder of the backup that holds the files taken from the Claude home, by their relative path. */
export const BACKUP_CLAUDE_DIR = 'claude'

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
  /** Files the move creates under the Harness home; removed by a restore. */
  created: string[]
  /** Folders the move creates under the Harness home, deepest first; removed by a restore when empty. */
  createdDirs: string[]
  /** The record the move takes out of `mcpServers` in .claude.json, and its place among the servers. */
  claudeJsonRecord: { key: string; index: number; value: unknown } | null
  /** The move's commits: in the Claude home, and in the Harness home. */
  commits: { claudeHome: string | null; harnessHome: string | null }
  /** Whether the move ran `git init` in the Harness home (a restore then removes its .git). */
  harnessGitInit: boolean
}

// Plain JavaScript, no dependencies: it has to run with any node, without worfy. No backquotes in it,
// since it lives in a template literal.
const SOURCE = String.raw`#!/usr/bin/env node
// Undoes the move of the old Harness out of ~/.claude that worfy made (worfy-harness ticket 14).
//
//   node <this folder>/restore.mjs              disables the plugin worfy, then restores
//   node <this folder>/restore.mjs --keep-plugin restores and leaves the plugin as it is
//
// What the move took or changed is in this folder (claude/, manifest.json). Exit code 0: restored.
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function within(root, rel) {
  const path = resolve(root, rel)
  const inside = relative(resolve(root), path)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw new Error('refusing a path outside ' + root + ': ' + rel)
  return path
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

  if (disablePlugin) {
    const args = ['plugin', 'disable', manifest.plugin, '--scope', 'user']
    const run = spawnSync('claude', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    if (run.error) log('No claude in PATH. Disable the plugin yourself, or its hooks run next to the old ones:\n  claude ' + args.join(' '))
    else if (run.status !== 0) log('claude ' + args.join(' ') + ' exited with ' + run.status + '. Run it yourself, or the plugin hooks run next to the old ones.')
    else log('Disabled the plugin ' + manifest.plugin + '.')
  }

  revert(claudeHome, manifest.commits.claudeHome, log)
  if (!manifest.harnessGitInit) revert(harnessHome, manifest.commits.harnessHome, log)

  for (const rel of manifest.claude) {
    const target = within(claudeHome, rel)
    const source = join(backupDir, 'claude', rel)
    if (!existsSync(source)) throw new Error('the backup has no ' + source)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, verbatimSymlinks: true })
  }
  for (const rel of manifest.created) rmSync(within(harnessHome, rel), { recursive: true, force: true })
  if (manifest.harnessGitInit) rmSync(within(harnessHome, '.git'), { recursive: true, force: true })
  for (const rel of manifest.createdDirs) {
    const dir = within(harnessHome, rel)
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
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
