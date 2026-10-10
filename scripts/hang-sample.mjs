#!/usr/bin/env node
// Saves the thread stacks of a packaged worfy that stopped answering (macOS only):
//
//   node scripts/hang-sample.mjs <pid> [seconds]
//
// <pid> is the main process of a packaged worfy — the exact pid got when it was started, for
// example the stable copy that Autopilot drives over CDP (README.md, "Stable copy"). A CDP call
// such as Runtime.evaluate runs in the renderer process, a child of the main one, so the script
// samples the main process and its children from the same .app, all at once, with
// /usr/bin/sample: the stacks of every thread over [seconds] (1–60, default 3) without stopping
// the process. The stacks are native only, no JavaScript frames: enough to tell a wait for I/O or
// for a system window from a busy loop.
//
//   sampled: <pid> <kind> <file>     one line per file; <kind> is main, the helper's --type=
//                                    (renderer, gpu-process, utility) or the executable's name (claude)
//   skipped: <pid> <path>            a child outside the .app (a Terminal's shell, git, gh): not sampled
//   failed: <pid> <kind>: <why>      on stderr
//
// The files are <data root>/logs/hang-<time>-<pid>.txt, next to process-gone.jsonl; the name of
// the process is in the first lines of each file. The data root is the packaged worfy's:
// WORFY_DATA_DIR when it is set, else ~/Library/Application Support/worfy (dataRoot() of
// src/main/storage/paths.ts; this script runs without the app and cannot import it,
// test/unit/hang-sample.test.ts keeps the two in step).
//
// Exit code: 0 when every `sample` returned 0, else the first non-zero code in the order of the
// lines above (1 when `sample` could not run). 2 and no file when the arguments are wrong, the
// system is not macOS, or <pid> is not `<bundle>.app/Contents/MacOS/worfy` — a helper, a shell, a
// dev run of Electron. The bundle may have any name and place; the executable's name comes from
// `productName: worfy` (electron-builder.yml).
//
// The arguments of a process are read only for `--type=` and never printed: they can hold a token.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const USAGE = 'usage: node scripts/hang-sample.mjs <pid of the main process of a packaged worfy> [seconds, 1-60, default 3]'
const DEFAULT_SECONDS = 3
const MAX_SECONDS = 60
/** How long past its seconds a `sample` may take to write its file before it is ended. */
const SAMPLE_GRACE_MS = 60_000
const REFUSED = 2

/** The logs folder of the packaged worfy: WORFY_DATA_DIR when set, else the default data folder on macOS. */
export function logsFolder(env = process.env, home = homedir()) {
  const root = env.WORFY_DATA_DIR ? posix.resolve(env.WORFY_DATA_DIR) : posix.join(home, 'Library', 'Application Support', 'worfy')
  return posix.join(root, 'logs')
}

/** `<pid> [seconds]` as numbers, or null when they are not a pid and 1–60 seconds. */
function parseArgs(args) {
  const [pidText, secondsText, ...rest] = args
  if (pidText === undefined || rest.length > 0) return null
  const whole = (text) => (/^[0-9]+$/.test(text) ? Number(text) : Number.NaN)
  const pid = whole(pidText)
  const seconds = secondsText === undefined ? DEFAULT_SECONDS : whole(secondsText)
  if (!(pid > 0) || !(seconds >= 1 && seconds <= MAX_SECONDS)) return null
  return { pid, seconds }
}

/** The .app whose main executable `comm` is, or null: `<bundle>.app/Contents/MacOS/worfy`. */
function bundleOf(comm) {
  return /^(\/.+\.app)\/Contents\/MacOS\/worfy$/.exec(comm)?.[1] ?? null
}

/** The kind of a process of the bundle: Chromium's `--type=` of a helper, else the executable's name. */
function kindOf({ comm, args }) {
  return /(?:^|\s)--type=([a-z-]+)(?:\s|$)/.exec(args)?.[1] ?? posix.basename(comm)
}

/** 20261010T123456Z: the time of the run in the names of its files. */
function stamp(time) {
  return `${time.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
}

/**
 * Runs the script over `deps` (the real system by default) and returns the exit code. The tests
 * pass a faked `ps`, `pgrep` and `sample`.
 */
export async function hangSample(args, deps = systemDeps()) {
  const { platform, env, home, now, ps, childrenOf, realpath, mkdir, sample, out, err } = deps
  const parsed = parseArgs(args)
  if (parsed === null) {
    err(USAGE)
    return REFUSED
  }
  const { pid, seconds } = parsed
  if (platform !== 'darwin') {
    err('hang-sample: macOS only (it runs /usr/bin/sample)')
    return REFUSED
  }
  const main = ps(pid)
  if (main === null) {
    err(`hang-sample: no process with pid ${pid}`)
    return REFUSED
  }
  const bundle = bundleOf(main.comm)
  if (bundle === null) {
    err(`hang-sample: ${pid} is not the main process of a packaged worfy (<bundle>.app/Contents/MacOS/worfy): ${main.comm}`)
    return REFUSED
  }

  // A helper's path may name the bundle through a symlink the main one does not (/var, /private/var).
  const inside = `${realpath(bundle)}/`
  const chosen = [{ pid, kind: 'main' }]
  for (const child of childrenOf(pid)) {
    const found = ps(child)
    if (found === null) out(`skipped: ${child} (ended)`)
    else if (realpath(found.comm).startsWith(inside)) chosen.push({ pid: child, kind: kindOf(found) })
    else out(`skipped: ${child} ${found.comm}`)
  }

  const folder = logsFolder(env, home)
  try {
    mkdir(folder)
  } catch (error) {
    err(`hang-sample: cannot create ${folder}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const time = stamp(now())
  // All at once, so every file covers the same seconds.
  const results = await Promise.all(
    chosen.map(async ({ pid: target, kind }) => {
      const file = posix.join(folder, `hang-${time}-${target}.txt`)
      try {
        const code = await sample(target, seconds, file)
        return { target, kind, file, code, why: `sample exited with code ${code}` }
      } catch (error) {
        return { target, kind, file, code: 1, why: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  for (const { target, kind, file, code, why } of results) {
    if (code === 0) out(`sampled: ${target} ${kind} ${file}`)
    else err(`failed: ${target} ${kind}: ${why}`)
  }
  return results.find(({ code }) => code !== 0)?.code ?? 0
}

/** stdout of a command, or null when it exits with a non-zero code (`ps` and `pgrep` do when nothing matches). */
function read(file, args) {
  const run = spawnSync(file, args, { encoding: 'utf8' })
  return run.status === 0 ? run.stdout : null
}

/** The real system: `ps`, `pgrep` and `sample` of macOS, the real clock and the standard streams. */
export function systemDeps() {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    now: () => new Date(),
    ps: (pid) => {
      // On macOS `comm` is the whole path of the executable; -ww keeps both columns uncut.
      const comm = read('/bin/ps', ['-ww', '-o', 'comm=', '-p', String(pid)])?.trim()
      if (!comm) return null
      return { comm, args: read('/bin/ps', ['-ww', '-o', 'args=', '-p', String(pid)])?.trim() ?? '' }
    },
    childrenOf: (pid) =>
      (read('/usr/bin/pgrep', ['-P', String(pid)]) ?? '')
        .split('\n')
        .map(Number)
        .filter((child) => child > 0),
    realpath: (path) => {
      try {
        return realpathSync(path)
      } catch {
        return path
      }
    },
    mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
    sample: runSample,
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
  }
}

/** One `sample` run; resolves with its exit code, or 124 when it had to be ended for taking too long. */
function runSample(pid, seconds, file) {
  return new Promise((done, failed) => {
    const child = spawn('/usr/bin/sample', [String(pid), String(seconds), '-file', file], { stdio: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), seconds * 1000 + SAMPLE_GRACE_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      failed(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done(code ?? 124)
    })
  })
}

/** Run as a script, not imported (the test imports the functions above). */
function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) process.exitCode = await hangSample(process.argv.slice(2))
