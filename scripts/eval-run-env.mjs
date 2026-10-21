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
 * Gives the runs their copy of git: `gitCopy` into `dir`, that folder first on the PATH of `env`, and
 * the two variables `harness/hooks/eval-env.cjs` reads — `EVAL_GIT` (the wrapper) and
 * `EVAL_HARNESS_HOME`. Changes `env` in place and returns the wrapper; `fail` as `gitCopy`.
 */
export function gitForRuns(dir, env, fail) {
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
 * one. `env` is the environment of the runs. `fail` when git names no folder or the copy does not
 * answer `--version`; a copy that was started is removed before `fail`.
 */
export function gitCopy(dir, env, fail) {
  // Windows starts no `#!/bin/sh` script by its path, and its PATH lookup of `git` finds only
  // git.exe. There `sh` (Git for Windows; `bash` may be the one of WSL) looks git up on PATH, as the
  // shell of a run does, and runs the wrapper.
  const exec =
    process.platform === 'win32' ? spawnSync('sh', ['-c', 'git --exec-path'], { encoding: 'utf8', env }) : spawnSync('git', ['--exec-path'], { encoding: 'utf8', env })
  const source = exec.status === 0 ? exec.stdout.trim() : ''
  if (source === '' || !existsSync(source) || !statSync(source).isDirectory()) return fail(`\`git --exec-path\` gave no folder (exit ${exec.status ?? exec.error?.code}): the runs need a copy of git`)
  const core = join(dir, 'git-core')
  const wrapper = join(dir, 'git')
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
