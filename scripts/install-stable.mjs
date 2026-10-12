#!/usr/bin/env node
// Installs the stable copy of worfy outside the repository: Autopilot over worfy itself runs on
// this copy, never on a build that agents are rewriting in their worktrees (README.md, "Stable copy").
//
//   node scripts/install-stable.mjs [<target>]     (pnpm install:stable [<target>])
//
// Builds the app (`pnpm package`), copies it next to the target and swaps it in: the copy that was
// there is moved aside, the new one takes its place, and only then the old one is removed. When
// the swap fails, the old copy is put back. Writes the commit and the build time next to the copy,
// in <target>.json: nothing is written inside the copy afterwards, since that would break the
// ad-hoc signature of a .app. Refuses with a non-zero exit code while the copy is running.
//
//   macOS    the target is a path ending in .app, by default ~/Applications/worfy-stable.app;
//            the build is dist/mac*/worfy.app, copied with ditto.
//   Windows  the target is a folder, by default %LOCALAPPDATA%\worfy-stable; the build is
//            dist\win-unpacked (worfy.exe and what lies next to it). The target cannot be the
//            folder the installer of worfy uses, %LOCALAPPDATA%\Programs\worfy, nor any path that
//            starts with it (…\Programs\worfy-stable): the installer stops every program whose
//            path starts with its folder.
//
// WORFY_STABLE_PREBUILT=<path to a built app> skips the build and copies that app instead; the e2e
// tests use it to install the app they have already packaged into a temporary folder.
//
// One file with no import of its own: a test copies it alone into another repository. The parts
// that decide by the system take it as a parameter (test/unit/install-stable.test.ts).

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, posix, win32 } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The name of the app: of its program, and of the folder the installer puts it in (`name` of package.json). */
const APP = 'worfy'
/** How long the list of processes may take on Windows. */
const LISTING_TIMEOUT_MS = 30_000

const rulesOf = (platform) => (platform === 'win32' ? win32 : posix)

function fail(message) {
  throw new Error(message)
}

/**
 * Where the installer of worfy puts it on Windows on a first install: per user, without admin
 * rights. (A later install goes where the earlier one went, and `/D=` names another folder: such
 * a folder is known by the uninstaller in it, see notACopy.)
 */
export function installerDir(env, home) {
  return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Programs', APP)
}

/** The target when none is given. */
export function defaultTarget(platform, env, home) {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), `${APP}-stable`)
  return posix.join(home, 'Applications', `${APP}-stable.app`)
}

/**
 * The target as the script uses it, or an Error with the reason it is refused. On macOS it must
 * end in .app (a trailing slash, as shell completion writes it, is dropped first). On Windows it is
 * a folder, and:
 *   - neither the folder of the installer nor one inside or around it: the installer would
 *     overwrite the copy, or the copy the installed worfy;
 *   - no path that starts with the path of the installer's folder (…\Programs\worfy-2). The
 *     installer finds a running worfy by the text its path starts with, with no backslash at the
 *     end, and stops it: an install, an update or an uninstall of worfy would stop the copy.
 * `installed` is the folder of the installer; installerDir by default. A drive path written with
 * the prefix \\?\ or \\.\ is the same folder, and is taken without the prefix.
 */
export function checkTarget(platform, target, env, home, installed = installerDir(env, home)) {
  const rules = rulesOf(platform)
  if (platform !== 'win32') {
    const trimmed = target.length > 1 ? target.replace(/\/+$/, '') : target
    if (!trimmed.endsWith('.app')) fail(`the target must be a path ending in .app, got: ${trimmed}`)
    return trimmed
  }
  const folder = rules.resolve(target).replace(/^\\\\[?.]\\(?=[A-Za-z]:\\)/, '')
  if (rules.parse(folder).root === folder) fail(`the target must be a folder of its own, not a whole disk: ${folder}`)
  const inside = (base, path) => {
    const rel = rules.relative(base, path)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${rules.sep}`) && !rules.isAbsolute(rel))
  }
  if (inside(installed, folder) || inside(folder, installed)) {
    fail(`the target cannot be the folder the installer of ${APP} uses (${installed}), nor one inside or around it: ${folder}`)
  }
  if (folder.toLowerCase().startsWith(installed.toLowerCase())) {
    fail(`the target cannot start with the path of the folder the installer of ${APP} uses (${installed}): the installer stops every program whose path starts with it. Got: ${folder}`)
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
 * ProcessId, Name and ExecutablePath. A process counts when its executable lies inside one of
 * `targets`, in any case of the letters. So does a worfy.exe whose path Windows does not give
 * (the program of another user, or an elevated one): it may be the copy.
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
  const lines = []
  for (const each of Array.isArray(parsed) ? parsed : [parsed]) {
    const path = each?.ExecutablePath
    if (typeof path === 'string') {
      if (prefixes.some((prefix) => path.toLowerCase().startsWith(prefix))) lines.push(`${each.ProcessId} ${path}`)
    } else if (typeof each?.Name === 'string' && each.Name.toLowerCase() === `${APP}.exe`) {
      lines.push(`${each.ProcessId} ${each.Name} (Windows does not say where it runs from: another user's, or an elevated one)`)
    }
  }
  return lines
}

/**
 * Why a folder that is already at a Windows target is not replaced, or null. Only a folder that
 * holds worfy.exe, or an empty one, is taken for an earlier copy — everything in such a folder is
 * removed with it. A folder with the uninstaller of worfy is a worfy the installer put there,
 * wherever it is and however its path is written, never a copy. `names` are the names in it.
 */
export function notACopy(names) {
  const lower = names.map((name) => name.toLowerCase())
  if (lower.includes(`uninstall ${APP}.exe`)) return `it holds "Uninstall ${APP}.exe": the installer of ${APP} put it there, it is not a stable copy. Give another folder.`
  if (names.length === 0 || lower.includes(`${APP}.exe`)) return null
  return `it holds no ${APP}.exe, so it is not an earlier stable copy. Remove it yourself, or give another folder.`
}

/**
 * What an interrupted run left next to the target: `names` are the names in the folder of the
 * target, `base` the name of the target, `alive` says whether a process with a pid runs. Answers
 * the names to remove (`<base>.installing-<pid>`: a copy that never got in) and the names of
 * earlier copies set aside (`<base>.replaced-<pid>`), newest pid last. A name whose pid is a
 * running process is left alone: another install may be at work.
 */
export function leftovers(names, base, alive) {
  const stale = (kind) =>
    names.filter((name) => {
      if (!name.startsWith(`${base}.${kind}-`)) return false
      const pid = name.slice(base.length + kind.length + 2)
      return /^\d+$/.test(pid) && !alive(Number(pid))
    })
  return { installing: stale('installing'), replaced: stale('replaced') }
}

/**
 * How the app is built. On Windows pnpm is pnpm.cmd, and Node does not start a .cmd without a
 * shell; a shell gets the whole line as one text (Node 24 warns about arguments passed next to it).
 */
export function buildCommand(platform) {
  return platform === 'win32' ? { command: 'pnpm package', args: [], shell: true } : { command: 'pnpm', args: ['package'], shell: false }
}

/** Builds the app in the repository; throws when the build cannot run or fails. */
function packageApp(platform, repo) {
  const { command, args, shell } = buildCommand(platform)
  const built = spawnSync(command, args, { cwd: repo, stdio: 'inherit', shell })
  if (built.error) fail(`could not run pnpm package: ${built.error.message}`)
  if (built.status !== 0) fail(`pnpm package exited with ${built.status}`)
}

/**
 * The app `pnpm package` left in `dist`, or an Error. `names` are the names in `dist`, `exists`
 * says whether a path is there. Windows: dist\win-unpacked. macOS: the one folder of dist whose
 * name starts with `mac` and that holds worfy.app.
 */
export function builtApp(platform, dist, names, exists) {
  const rules = rulesOf(platform)
  if (platform === 'win32') {
    const source = rules.join(dist, 'win-unpacked')
    if (!exists(source)) fail('expected dist\\win-unpacked after the build, and it is not there')
    return source
  }
  const found = names.filter((name) => name.startsWith('mac') && exists(rules.join(dist, name, `${APP}.app`)))
  if (found.length !== 1) fail(`expected exactly one dist/mac*/${APP}.app after the build, found ${found.length}`)
  return rules.join(dist, found[0], `${APP}.app`)
}

/**
 * Puts the new copy at the target. The copy that is there is moved aside first, and stays whole
 * until the new one has taken its place: a step that fails leaves it at the target, or puts it
 * back. Answers the path of the earlier copy to remove, or null when there was none. `files` is
 * `{ there, rename }`: whether something is at a path (a link counts, wherever it leads), and a move.
 */
export function swapIn({ staging, target, aside }, files) {
  const reason = (error) => (error instanceof Error ? error.message : String(error))
  const had = files.there(target)
  if (had) {
    try {
      files.rename(target, aside)
    } catch (error) {
      fail(`the copy at ${target} could not be moved aside (${reason(error)}): a program may hold a file of it open. It is left as it was`)
    }
  }
  try {
    files.rename(staging, target)
  } catch (error) {
    if (!had) fail(`the new copy could not be put at ${target} (${reason(error)})`)
    try {
      files.rename(aside, target)
    } catch (again) {
      fail(`the new copy could not be put at ${target} (${reason(error)}), and the copy that was there could not be put back (${reason(again)}): it is at ${aside}`)
    }
    fail(`the new copy could not be put at ${target} (${reason(error)}); the copy that was there is back in place`)
  }
  return had ? aside : null
}

/** A time as the metadata file writes it: UTC, to the second. */
export function stamp(ms) {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) fail(`could not run ${command}: ${result.error.code === 'ETIMEDOUT' ? `no answer in ${options.timeout} ms` : result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${result.status}${result.stderr ? `:\n${result.stderr}` : ''}`)
  return result.stdout ?? ''
}

function processListing(platform) {
  if (platform !== 'win32') return run('ps', ['-axo', 'pid=,command='])
  // Windows PowerShell prints in the console code page unless told otherwise: a path with letters
  // outside it would not match.
  const script = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId, Name, ExecutablePath | ConvertTo-Json -Compress'
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 64 * 1024 * 1024, timeout: LISTING_TIMEOUT_MS })
}

/** True while a process with this pid is there. */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** True when something is at the path: a link counts, wherever it leads. */
function there(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Removes a folder of Windows with what is in it, and never what a link in it leads to: a link —
 * a symlink or a junction, at the path itself or anywhere below — is removed as a link. rmSync is
 * not used there: under Node 24 (the one Electron 44 carries) its `recursive` goes through a
 * junction and empties the folder behind it; under Node 22 it does not.
 */
function removeTree(path) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) {
    try {
      rmdirSync(path)
    } catch {
      unlinkSync(path)
    }
    return
  }
  if (!stat.isDirectory()) {
    rmSync(path, { force: true, maxRetries: 5, retryDelay: 100 })
    return
  }
  for (const name of readdirSync(path)) removeTree(win32.join(path, name))
  rmdirSync(path)
}

/** The path as the disk spells it — no \\?\, no short names, links followed — or null when it is not there. */
function onDisk(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * Installs the copy; answers the line to print. Throws an Error with the reason otherwise.
 * `build(platform, repo)` makes the app when no built one is given; packageApp by default.
 */
export function installStable(argv, { platform = process.platform, env = process.env, home = homedir(), repo = defaultRepo(), build = packageApp } = {}) {
  const rules = rulesOf(platform)
  if (argv.length > 1) fail(`expected at most one argument, the target path; got ${argv.length}`)
  const target = checkTarget(platform, argv[0] ?? defaultTarget(platform, env, home), env, home)
  /** Removes a copy, or what is left of one. */
  const remove = (path) => (platform === 'win32' ? removeTree(path) : rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const parent = rules.dirname(rules.resolve(target))
  mkdirSync(parent, { recursive: true })
  // Both spellings of the target: a process started through a symlinked folder (/var -> /private/var
  // on macOS) shows the path it was started by.
  const logical = rules.join(rules.resolve(parent), rules.basename(target))
  const physical = rules.join(realpathSync(parent), rules.basename(target))
  const metadata = metadataPath(platform, logical)
  const spellings = new Set([logical, physical])

  if (platform === 'win32') {
    // The target as Windows spells it: \\?\C:\…, an 8.3 name or a link to the installer's folder
    // is the installer's folder all the same, and a process shows the spelling of the disk.
    const real = onDisk(logical) ?? rules.join(onDisk(parent) ?? rules.dirname(physical), rules.basename(target))
    checkTarget(platform, real, env, home, onDisk(installerDir(env, home)) ?? installerDir(env, home))
    spellings.add(real)
    if (existsSync(logical)) {
      const reason = statSync(logical).isDirectory() ? notACopy(readdirSync(logical)) : 'it is a file, not a folder.'
      if (reason !== null) fail(`${logical} is there already, and ${reason}`)
    }
  }

  const refuseIfRunning = () => {
    const running = runningCopies(platform, [...spellings], processListing(platform))
    if (running.length === 0) return
    process.stderr.write(`${running.join('\n')}\n`)
    fail(`the stable copy at ${logical} is running. Quit it (stop Autopilot first, or wait for the gap between waves), then run this again.`)
  }

  // Before the build, so a refusal costs nothing; again before the copy, since the copy may have
  // been started while the build ran.
  refuseIfRunning()

  // What a run that was interrupted left behind: its unfinished copy is removed; an earlier copy
  // it had set aside goes back to the target when nothing took its place.
  const base = rules.basename(logical)
  const left = leftovers(readdirSync(rules.dirname(logical)), base, processAlive)
  for (const name of left.installing) remove(rules.join(rules.dirname(logical), name))
  for (const name of left.replaced.reverse()) {
    const kept = rules.join(rules.dirname(logical), name)
    if (there(logical)) remove(kept)
    else renameSync(kept, logical)
  }

  let source
  if (env.WORFY_STABLE_PREBUILT) {
    source = env.WORFY_STABLE_PREBUILT
    if (!existsSync(source) || !statSync(source).isDirectory()) fail(`WORFY_STABLE_PREBUILT is not a folder: ${source}`)
  } else {
    build(platform, repo)
    const dist = rules.join(repo, 'dist')
    source = builtApp(platform, dist, existsSync(dist) ? readdirSync(dist) : [], existsSync)
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
  // target path. The swap moves the earlier copy aside before the new one takes its place, and
  // removes it last: when a step fails — on Windows a folder cannot be renamed or removed while a
  // file in it is open — the earlier copy is still whole, and goes back.
  const staging = `${logical}.installing-${process.pid}`
  remove(staging)
  let earlier
  try {
    // ditto keeps the bundle's signature, extended attributes and symlinks intact. On Windows the
    // build is copied from its real folder: cpSync would copy a link to it as a link.
    if (platform === 'win32') cpSync(realpathSync(source), staging, { recursive: true })
    else run('ditto', [source, staging])
    earlier = swapIn({ staging, target: logical, aside: `${logical}.replaced-${process.pid}` }, { there, rename: renameSync })
  } finally {
    remove(staging)
  }

  writeFileSync(metadata, `${JSON.stringify({ commit, dirty, builtAt, installedAt, source }, null, 2)}\n`)
  let note = ''
  if (earlier !== null) {
    try {
      // A link at the target (a symlink, a junction) is removed as a link: what it led to stays.
      remove(earlier)
    } catch (error) {
      note = `\ninstall-stable: the earlier copy could not be removed and is left at ${earlier} (${error instanceof Error ? error.message : String(error)}); the next run removes it`
    }
  }
  return `install-stable: installed ${logical} (commit ${commit.slice(0, 7)}${dirty ? ', uncommitted changes' : ''}), details in ${metadata}${note}`
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
