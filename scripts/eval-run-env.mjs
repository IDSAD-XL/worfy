// The run environment both paid evals share: `pnpm eval:harness` (scripts/eval-harness.mjs) and
// `pnpm eval:outcome` (scripts/eval-outcome.mjs). The pinned models and the minimum claude version,
// the environment of the runs without the variables of a Claude Code session and without another
// plugin copy on PATH, the claude binary and its version check, the copy of the plugin under test and
// the copy of git the sandbox of a run accepts. Importing this module runs nothing.
//
// A function that can fail takes `fail(message)` from its caller: each script exits with its own
// prefix and code. `fail` is expected not to return; when it does, the function returns its value.
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, sep } from 'node:path'
import process from 'node:process'
import { removeTree } from './remove-tree.mjs'

/** Pinned, so that a change of the default model does not look like a change of the plugin. */
export const MODEL = 'claude-sonnet-5'
export const JUDGE_MODEL = 'claude-haiku-4-5'
/** The first claude with `plugin eval`. */
export const MIN_VERSION = [2, 1, 269]

/**
 * Variables that tie a process to the Claude Code session it was started from. A run started from
 * inside a session (a worfy Session, Autopilot) would hand them to every eval child, and the
 * children would report to that session's messaging socket under its id.
 */
export const SESSION_VARIABLES = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
]

/**
 * A PATH folder of another copy of the plugin: the frozen ~/.claude/bin, the installed plugin under
 * ~/.claude/worfy-harness/, the Stable copy's .../harness/bin. A run inherits PATH, and its sandbox
 * lets it read every PATH folder, so an agent that calls `profile` or `ticket` by name would run
 * another copy than the one under test.
 */
const otherHarness = (dir) =>
  dir === join(homedir(), '.claude', 'bin') || dir.includes(`${sep}.claude${sep}worfy-harness${sep}`) || /[\\/]harness[\\/](bin|hooks)[\\/]?$/.test(dir)

/** `env` without the session variables and with no other plugin copy on PATH; a new object. */
export function cleanEnv(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !SESSION_VARIABLES.includes(key)))
  if (clean.PATH) clean.PATH = clean.PATH.split(delimiter).filter((dir) => dir && !otherHarness(dir)).join(delimiter)
  return clean
}

/** $CLAUDE_BIN, else the claude binary of the Agent SDK in node_modules of `repo`. */
export function claudeBinary(repo, fail) {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  try {
    const sdk = createRequire(join(repo, 'package.json')).resolve('@anthropic-ai/claude-agent-sdk')
    const pkg = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
    return join(dirname(pkg), 'claude')
  } catch {
    return fail(`no claude binary of the Agent SDK for ${process.platform}-${process.arch} in node_modules; set CLAUDE_BIN`)
  }
}

/**
 * spawnSync of claude. On Windows a CLAUDE_BIN that ends in `.mjs` is a stand-in of the tests: Windows
 * starts no script by its path, so it runs as a script of this process's own Node (the way worfy
 * starts a `.mjs` WORFY_CLAUDE, src/main/program.ts). The environment is the caller's: under
 * `pnpm eval:*` this process is plain node, and when it runs as Electron's Node it does so only
 * because ELECTRON_RUN_AS_NODE=1 is in its own environment, which cleanEnv keeps. Elsewhere, and
 * for the SDK's binary or any other path, claude starts by its path.
 */
export const runClaude = (claude, args, options) =>
  process.platform === 'win32' && claude.endsWith('.mjs') ? spawnSync(process.execPath, [claude, ...args], options) : spawnSync(claude, args, options)

/** The version of `claude` as text, or `fail` when it does not answer or is older than MIN_VERSION. */
export function checkVersion(claude, env, fail) {
  const run = runClaude(claude, ['--version'], { encoding: 'utf8', env })
  if (run.error || run.status !== 0) return fail(`${claude} --version failed: ${run.error?.message ?? run.stderr.trim()}`)
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(run.stdout)
  if (!match) return fail(`cannot read the version from "${run.stdout.trim()}"`)
  const version = match.slice(1, 4).map(Number)
  const older = version.reduce((acc, n, i) => acc || Math.sign(n - MIN_VERSION[i]), 0) < 0
  if (older) return fail(`claude ${version.join('.')} has no \`plugin eval\`: it needs ${MIN_VERSION.join('.')} or newer (${claude})`)
  return version.join('.')
}

/** The results folders of both evals inside the plugin: `claude plugin eval` writes to <eval dir>/results. */
const RESULTS = [join('evals', 'results'), join('evals-outcome', 'results')]

/**
 * Copies the plugin at `source` into a new temporary folder, without the results of either eval and
 * without `dependencies` in .claude-plugin/plugin.json (a run installs only the plugin under test,
 * and Claude Code does not load a plugin whose dependency is missing); returns the copy's real path.
 * The caller removes dirname() of it.
 */
export function pluginCopy(source) {
  const target = join(realpathSync(mkdtempSync(join(tmpdir(), 'eval-plugin-'))), 'harness')
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && !RESULTS.some((results) => inside === results || inside.startsWith(`${results}${sep}`))
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  delete manifest.dependencies
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return target
}

/**
 * The folder of the copy of git of one eval run, named by the run's `stamp`. On macOS it is
 * ~/Library/Caches/worfy-eval/<stamp>-git, whatever folder the checkout is in; elsewhere it is
 * <results>/<stamp>-git, as before. The sandbox of a `claude plugin eval` run on macOS denies reading
 * /Users, /tmp, /private/tmp and the user's /var/folders/…/T; it re-opened every PATH folder under the
 * home folder and not the one under /private/tmp: a copy under <results> of a checkout in a temporary
 * folder (an Orchestrator's scratchpad) stayed unreadable
 * ("Operation not permitted"), `git` fell through to the xcrun shim /usr/bin/git, which exits 72
 * there, and the Harness scripts answered "not a git repository" (allowRead of
 * <run>/config/settings.json, claude 2.1.289, 2026-10-23).
 */
// shortcut: relies on the sandbox re-opening the PATH folders under the home folder (seen in allowRead,
// not documented), redo when a run's settings.json stops listing such a PATH folder in allowRead.
export function gitFolder(results, stamp, platform = process.platform) {
  return platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'worfy-eval', `${stamp}-git`) : join(results, `${stamp}-git`)
}

/** The name of a copy of git: the stamp of its run (`new Date().toISOString()` with `:` and `.` as `-`), then `-git`. */
const COPY_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-git$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Removes the copies of git in `parent` that runs left behind (a run ended by SIGKILL, out of memory
 * or a reboot never removes its own): a folder named like a copy whose stamp and modification time
 * are both more than a day before `now`. A younger one may belong to a run still going, and anything
 * else in `parent` (a file, a link, another name) stays. Returns the removed paths and, for each one
 * that could not go, its path and the error.
 */
export function pruneGitCopies(parent, now = Date.now()) {
  const removed = []
  const failed = []
  let names
  try {
    names = readdirSync(parent)
  } catch {
    return { removed, failed }
  }
  for (const name of names) {
    const match = COPY_NAME.exec(name)
    if (!match) continue
    const path = join(parent, name)
    const [, day, hours, minutes, seconds, ms] = match
    const started = Date.parse(`${day}T${hours}:${minutes}:${seconds}.${ms}Z`)
    try {
      const stat = lstatSync(path)
      if (!stat.isDirectory() || !(now - started > DAY_MS) || !(now - stat.mtimeMs > DAY_MS)) continue
      removeTree(path)
      removed.push(path)
    } catch (error) {
      failed.push({ path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { removed, failed }
}

/**
 * Gives the runs their copy of git: `gitCopy` into `dir`, that folder first on the PATH of `env`, and
 * the two variables `harness/hooks/eval-env.cjs` reads — `EVAL_GIT` (the wrapper) and
 * `EVAL_HARNESS_HOME`. Changes `env` in place and returns the wrapper; `fail` as `gitCopy`.
 */
export function gitForRuns(dir, env, fail) {
  // On macOS the copies of every checkout share ~/Library/Caches/worfy-eval (gitFolder), and nothing
  // else removes the ones a killed run left there; elsewhere they lie in the results folder, as before.
  if (process.platform === 'darwin') {
    for (const { path, error } of pruneGitCopies(dirname(dir)).failed) process.stderr.write(`eval: cannot remove an old copy of git ${path}: ${error}\n`)
  }
  const git = gitCopy(dir, env, fail)
  env.PATH = [dir, env.PATH].filter(Boolean).join(delimiter)
  env.EVAL_GIT = git
  env.EVAL_HARNESS_HOME = 'worfy-harness'
  return git
}

/** A string as one word of a POSIX shell. */
const shellWord = (text) => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * Copies the folder `git --exec-path` names into `<dir>/git-core/` without git-credential*, and
 * writes the wrapper `<dir>/git`; returns the wrapper. The sandbox of a run refuses the git of Xcode
 * Command Line Tools (it lies next to git-credential-*) and reads every PATH folder. Each file is
 * copied once: a second name of the same file (git-add and the rest are links to the git binary)
 * becomes a symlink inside the copy, so the copy holds a few binaries and not a hundred copies of
 * one. `env` is the environment of the runs. `fail` when git names no folder, when `dir` already
 * exists (another run with the same stamp: its copy is left alone), or when the copy does not answer
 * `--version`; a copy that was started is removed before `fail`.
 */
export function gitCopy(dir, env, fail) {
  // Windows starts no `#!/bin/sh` script by its path, and its PATH lookup of `git` finds only
  // git.exe. There `sh` (Git for Windows; `bash` may be the one of WSL) looks git up on PATH, as the
  // shell of a run does, and runs the wrapper. Inside sh the PATH of the runs is set again, in sh's
  // spelling (cygpath): the sh.exe of Git's bin/ folder (first on PATH on the GitHub Windows runner)
  // is a launcher that puts Git's own mingw64/bin and usr/bin before PATH, and then the git of Git
  // answered instead of the first git on the PATH of the runs. No cygpath — exit 127, a failure.
  const exec =
    process.platform === 'win32'
      ? spawnSync('sh', ['-c', 'PATH="$(cygpath -u -p "$1")" && exec git --exec-path', 'sh', env.PATH ?? ''], { encoding: 'utf8', env })
      : spawnSync('git', ['--exec-path'], { encoding: 'utf8', env })
  const source = exec.status === 0 ? exec.stdout.trim() : ''
  if (source === '' || !existsSync(source) || !statSync(source).isDirectory()) return fail(`\`git --exec-path\` gave no folder (exit ${exec.status ?? exec.error?.code}): the runs need a copy of git`)
  const core = join(dir, 'git-core')
  const wrapper = join(dir, 'git')
  // Not `recursive` for `dir` itself: two runs started in the same millisecond name the same folder,
  // and the second must not copy into the first one's copy or remove it.
  try {
    mkdirSync(dirname(dir), { recursive: true })
    mkdirSync(dir)
  } catch (error) {
    return fail(`cannot create ${dir} for the copy of git: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const copied = new Map() // device:inode of a file -> its path in the copy
    const copyFolder = (from, to) => {
      mkdirSync(to, { recursive: true })
      // git first: the other names of its binary become links to it.
      const names = readdirSync(from).sort((a, b) => (a === 'git' ? -1 : b === 'git' ? 1 : a < b ? -1 : a > b ? 1 : 0))
      for (const name of names) {
        if (name.startsWith('git-credential')) continue
        const file = join(from, name)
        const target = join(to, name)
        const stat = statSync(file)
        if (stat.isDirectory()) {
          copyFolder(file, target)
          continue
        }
        const first = copied.get(`${stat.dev}:${stat.ino}`)
        if (first) {
          symlinkSync(relative(dirname(target), first), target)
        } else {
          copyFileSync(file, target)
          chmodSync(target, stat.mode & 0o777)
          copied.set(`${stat.dev}:${stat.ino}`, target)
        }
      }
    }
    copyFolder(source, core)
    // GIT_CONFIG_NOSYSTEM: the system gitconfig of Command Line Tools sets credential.helper osxkeychain.
    writeFileSync(
      wrapper,
      `#!/bin/sh\n# git for the sandbox of a \`claude plugin eval\` run: a copy of ${source} (scripts/eval-run-env.mjs)\n` +
        `GIT_EXEC_PATH=${shellWord(core)}\nGIT_CONFIG_NOSYSTEM=1\nexport GIT_EXEC_PATH GIT_CONFIG_NOSYSTEM\n` +
        `exec ${shellWord(join(core, 'git'))} "$@"\n`,
    )
    chmodSync(wrapper, 0o755)
  } catch (error) {
    removeTree(dir)
    return fail(`cannot copy ${source} into ${core}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // shortcut: on Windows the check keeps the PATH of the runs, redo when the paid runs go to Windows
  // (the copied git.exe loads its DLLs from mingw64/bin of the real one through that PATH).
  const check =
    process.platform === 'win32'
      ? spawnSync('sh', [wrapper, '--version'], { encoding: 'utf8', env: { PATH: env.PATH } })
      : spawnSync(wrapper, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
  if (check.status !== 0) {
    removeTree(dir)
    return fail(`the copy of git does not run (${wrapper} --version, exit ${check.status ?? check.error?.code}): ${(check.stderr ?? '').trim()}`)
  }
  return wrapper
}
