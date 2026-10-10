#!/usr/bin/env node
// Installs the stable copy of worfy outside the repository: Autopilot over worfy itself runs on
// this copy, never on a build that agents are rewriting in their worktrees (README.md, "Stable copy").
//
//   node scripts/install-stable.mjs [<target>]     (pnpm install:stable [<target>])
//
// Builds the app (`pnpm package`), copies it to the target and replaces a previous copy there.
// Writes the commit and the build time next to the copy, in <target>.json: nothing is written
// inside the copy afterwards, since that would break the ad-hoc signature of a .app. Refuses with
// a non-zero exit code while the copy is running.
//
//   macOS    the target is a path ending in .app, by default ~/Applications/worfy-stable.app;
//            the build is dist/mac*/worfy.app, copied with ditto.
//   Windows  the target is a folder, by default %LOCALAPPDATA%\Programs\worfy-stable; the build is
//            dist\win-unpacked (worfy.exe and what lies next to it). The target cannot be the
//            folder the installer of worfy uses, %LOCALAPPDATA%\Programs\worfy.
//
// WORFY_STABLE_PREBUILT=<path to a built app> skips the build and copies that app instead; the e2e
// tests use it to install the app they have already packaged into a temporary folder.
//
// One file with no import of its own: a test copies it alone into another repository. The parts
// that decide by the system take it as a parameter (test/unit/install-stable.test.ts).

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, posix, win32 } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The name of the app as electron-builder writes it (productName). */
const APP = 'worfy'

const rulesOf = (platform) => (platform === 'win32' ? win32 : posix)

function fail(message) {
  throw new Error(message)
}

/** Where the installer of worfy puts it on Windows: per user, without admin rights. */
export function installerDir(env, home) {
  return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Programs', APP)
}

/** The target when none is given. */
export function defaultTarget(platform, env, home) {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Programs', `${APP}-stable`)
  return posix.join(home, 'Applications', `${APP}-stable.app`)
}

/**
 * The target as the script uses it, or an Error with the reason it is refused. On macOS it must
 * end in .app (a trailing slash, as shell completion writes it, is dropped first). On Windows it is
 * a folder, and neither the folder of the installer nor one inside or around it: the installer
 * would overwrite the copy, or the copy the installed worfy.
 */
export function checkTarget(platform, target, env, home) {
  const rules = rulesOf(platform)
  if (platform !== 'win32') {
    const trimmed = target.length > 1 ? target.replace(/\/+$/, '') : target
    if (!trimmed.endsWith('.app')) fail(`the target must be a path ending in .app, got: ${trimmed}`)
    return trimmed
  }
  const folder = rules.resolve(target)
  if (rules.parse(folder).root === folder) fail(`the target must be a folder of its own, not a whole disk: ${folder}`)
  const installed = installerDir(env, home)
  const inside = (base, path) => {
    const rel = rules.relative(base, path)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${rules.sep}`) && !rules.isAbsolute(rel))
  }
  if (inside(installed, folder) || inside(folder, installed)) {
    fail(`the target cannot be the folder the installer of ${APP} uses (${installed}), nor one inside or around it: ${folder}`)
  }
  return folder
}

/** The file next to the copy that says what it was built from. */
export function metadataPath(platform, target) {
  return platform === 'win32' ? `${target}.json` : `${target.replace(/\.app$/, '')}.json`
}

/**
 * The lines of a process list that show the copy running.
 *
 * macOS: `listing` is the output of `ps -axo pid=,command=`; a line counts when its command lies
 * inside one of `targets` (the path as written and its real path: a process started through a
 * symlinked folder shows the path it was started by).
 * Windows: `listing` is the JSON PowerShell prints for `Get-CimInstance Win32_Process` with
 * ProcessId and ExecutablePath; a process counts when its executable lies inside one of `targets`,
 * in any case of the letters.
 */
export function runningCopies(platform, targets, listing) {
  if (platform !== 'win32') {
    const needles = targets.map((target) => `${target}/Contents/`)
    return listing.split('\n').filter((line) => needles.some((needle) => line.includes(needle)))
  }
  const text = listing.trim()
  if (text === '') return []
  const parsed = JSON.parse(text)
  const prefixes = targets.map((target) => `${target.toLowerCase()}\\`)
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((each) => typeof each?.ExecutablePath === 'string' && prefixes.some((prefix) => each.ExecutablePath.toLowerCase().startsWith(prefix)))
    .map((each) => `${each.ProcessId} ${each.ExecutablePath}`)
}

/**
 * Why a folder that is already at a Windows target is not replaced, or null: only a folder that
 * holds worfy.exe, or an empty one, is taken for an earlier copy. `names` are the names in it.
 */
export function notACopy(names) {
  if (names.length === 0 || names.some((name) => name.toLowerCase() === `${APP}.exe`)) return null
  return `it holds no ${APP}.exe, so it is not an earlier stable copy. Remove it yourself, or give another folder.`
}

/** A time as the metadata file writes it: UTC, to the second. */
export function stamp(ms) {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) fail(`could not run ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${result.status}${result.stderr ? `:\n${result.stderr}` : ''}`)
  return result.stdout ?? ''
}

function processListing(platform) {
  if (platform !== 'win32') return run('ps', ['-axo', 'pid=,command='])
  // Windows PowerShell prints in the console code page unless told otherwise: a path with letters
  // outside it would not match.
  const script = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress'
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 64 * 1024 * 1024 })
}

/** Installs the copy; answers the line to print. Throws an Error with the reason otherwise. */
export function installStable(argv, { platform = process.platform, env = process.env, home = homedir(), repo = defaultRepo() } = {}) {
  const rules = rulesOf(platform)
  if (argv.length > 1) fail(`expected at most one argument, the target path; got ${argv.length}`)
  const target = checkTarget(platform, argv[0] ?? defaultTarget(platform, env, home), env, home)
  const parent = rules.dirname(rules.resolve(target))
  mkdirSync(parent, { recursive: true })
  // Both spellings of the target: a process started through a symlinked folder (/var -> /private/var
  // on macOS) shows the path it was started by.
  const logical = rules.join(rules.resolve(parent), rules.basename(target))
  const physical = rules.join(realpathSync(parent), rules.basename(target))
  const metadata = metadataPath(platform, logical)

  const refuseIfRunning = () => {
    const running = runningCopies(platform, [...new Set([logical, physical])], processListing(platform))
    if (running.length === 0) return
    process.stderr.write(`${running.join('\n')}\n`)
    fail(`the stable copy at ${logical} is running. Quit it (stop Autopilot first, or wait for the gap between waves), then run this again.`)
  }

  if (platform === 'win32' && existsSync(logical)) {
    const reason = statSync(logical).isDirectory() ? notACopy(readdirSync(logical)) : 'it is a file, not a folder.'
    if (reason !== null) fail(`${logical} is there already, and ${reason}`)
  }

  // Before the build, so a refusal costs nothing; again before the copy, since the copy may have
  // been started while the build ran.
  refuseIfRunning()

  let source
  if (env.WORFY_STABLE_PREBUILT) {
    source = env.WORFY_STABLE_PREBUILT
    if (!existsSync(source) || !statSync(source).isDirectory()) fail(`WORFY_STABLE_PREBUILT is not a folder: ${source}`)
  } else {
    // On Windows pnpm is pnpm.cmd, and Node does not start a .cmd without a shell.
    const built = spawnSync('pnpm', ['package'], { cwd: repo, stdio: 'inherit', shell: platform === 'win32' })
    if (built.error) fail(`could not run pnpm package: ${built.error.message}`)
    if (built.status !== 0) fail(`pnpm package exited with ${built.status}`)
    const dist = rules.join(repo, 'dist')
    if (platform === 'win32') {
      source = rules.join(dist, 'win-unpacked')
      if (!existsSync(source)) fail(`expected dist\\win-unpacked after the build, and it is not there`)
    } else {
      const found = (existsSync(dist) ? readdirSync(dist) : []).filter((name) => name.startsWith('mac') && existsSync(rules.join(dist, name, `${APP}.app`)))
      if (found.length !== 1) fail(`expected exactly one dist/mac*/${APP}.app after the build, found ${found.length}`)
      source = rules.join(dist, found[0], `${APP}.app`)
    }
  }
  // The file whose time is the time of the build: the last one the build writes into the app.
  const marker = platform === 'win32' ? rules.join(source, `${APP}.exe`) : rules.join(source, 'Contents', 'Info.plist')
  if (!existsSync(marker)) fail(`${source} does not look like a built ${APP}: there is no ${rules.relative(source, marker)} in it`)

  const commit = run('git', ['-C', repo, 'rev-parse', 'HEAD']).trim()
  // Untracked files count: the build bundles a new source file whether git tracks it or not.
  const dirty = run('git', ['-C', repo, 'status', '--porcelain']).trim() !== ''
  const builtAt = stamp(statSync(marker).mtimeMs)
  const installedAt = stamp(Date.now())

  refuseIfRunning()

  // Copy next to the target first, then swap: an interrupted copy never leaves half an app at the
  // target path.
  const staging = `${logical}.installing-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  try {
    // ditto keeps the bundle's signature, extended attributes and symlinks intact.
    if (platform === 'win32') cpSync(source, staging, { recursive: true })
    else run('ditto', [source, staging])
    rmSync(logical, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    renameSync(staging, logical)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  writeFileSync(metadata, `${JSON.stringify({ commit, dirty, builtAt, installedAt, source }, null, 2)}\n`)
  return `install-stable: installed ${logical} (commit ${commit.slice(0, 7)}${dirty ? ', uncommitted changes' : ''}), details in ${metadata}`
}

/** The repository this script lies in. */
function defaultRepo() {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/** Run as a script, not imported (the test imports the functions above). */
function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) {
  try {
    process.stdout.write(`${installStable(process.argv.slice(2))}\n`)
  } catch (error) {
    process.stderr.write(`install-stable: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
