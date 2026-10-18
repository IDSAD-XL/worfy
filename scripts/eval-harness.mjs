#!/usr/bin/env node
// pnpm eval:harness [-- <claude plugin eval options>] — runs the eval cases of the Harness
// (harness/evals/, ticket worfy-harness/27) with `claude plugin eval`: real model calls on the
// owner's account, by hand, on a Mac. Not in CI and not in the gate.
//
// Two calls, because the cases need different shell grants:
//   main — cases tagged `main`, with Bash, Write and Edit;
//   gui  — cases tagged `gui` (no-os-screen-capture), with Bash only for git, node and the
//          Harness scripts: an attempt at an OS screen capture is refused, not run. A real capture
//          from a run started inside worfy would ask Screen Recording for the app, and granting it
//          restarts the app (lesson 2026-10-07).
// The target is a temporary copy of harness/ whose plugin.json has no `dependencies`: in a run
// only the plugin under test is installed, and Claude Code refuses to load a plugin whose
// dependency (mattpocock-skills) is missing — then no case sees a single rule of the Harness.
// HARNESS_DIR=<dir> evaluates another copy of the Harness instead of harness/ (the mutation check of
// the ticket); results go to <that dir>/evals/results/.
// Arguments after `--` go to both calls as they are (`pnpm eval:harness -- --case status-block
// --runs 1`); a call whose tag no case selected by --case/--tag carries is skipped.
// git for the runs (ticket worfy-harness/28): the sandbox of a run refuses the git of Xcode Command
// Line Tools (it lies next to git-credential-*), and it reads every folder of PATH. So the folder
// `git --exec-path` names is copied, without git-credential-*, into <evals>/results/<time>-git/, and a
// wrapper <…>-git/git runs the copy. The runs get that folder first on PATH, EVAL_GIT=<…>-git/git
// (the git every Harness script starts) and EVAL_HARNESS_HOME=worfy-harness: the Harness state goes
// to .git/worfy-harness of the run's working folder, the one place a run may write
// (harness/hooks/eval-env.cjs). No folder from `git --exec-path`, or a copy that does not run — exit 1
// before any call.
//
// claude: $CLAUDE_BIN, else the binary bundled with the Agent SDK in node_modules; older than
// 2.1.269 (no `plugin eval`) — exit 1. Exit code: the worst of the calls (0 — every case at or
// above the threshold; 1 — a case below it or not loaded; 2 — partial: cost ceiling or the
// account refused; 128 + the signal number — stopped by a signal: SIGINT 130, SIGHUP 129, SIGTERM
// 143, and the remaining calls are not started). At the end: the paths to aggregate-result.json and
// report.html of each call.
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
import { constants, homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { removeTree } from './remove-tree.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = process.env.HARNESS_DIR ? resolve(process.env.HARNESS_DIR) : join(REPO, 'harness')
const EVALS = join(SOURCE, 'evals')
const MIN_VERSION = [2, 1, 269]
// Pinned, so that a change of the default model does not look like a broken Harness.
const MODEL = 'claude-sonnet-5'
const JUDGE_MODEL = 'claude-haiku-4-5'
const COMMON = [
  '--scaffold',
  '--trust-plugin',
  '--ablation', 'none',
  '--threshold', '0.8',
  '--max-cost-usd', '30',
  '--no-publish',
  '--model', MODEL,
  '--judge-model', JUDGE_MODEL,
]
/** Tool grants of each call; `harness` is the path of the plugin under test. */
const grants = (harness) => ({
  main: ['Bash', 'Write', 'Edit'],
  gui: [
    'Bash(git *)',
    'Bash(node *)',
    `Bash(${harness}/bin/*)`,
    `Bash("${harness}/bin/*)`,
    `Bash(${harness}/hooks/*)`,
    `Bash("${harness}/hooks/*)`,
    `Bash(bash ${harness}/hooks/*)`,
    `Bash(bash "${harness}/hooks/*)`,
    'Write',
    'Edit',
  ],
})

// Variables that tie a process to the Claude Code session it was started from. A run started from
// inside a session (a worfy Session, Autopilot) would hand them to every eval child, and the
// children would report to that session's messaging socket under its id.
const SESSION_VARIABLES = [
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
// Folders of other Harness copies on PATH: the frozen ~/.claude/bin, the installed plugin under
// ~/.claude/worfy-harness/, the Stable copy's .../harness/bin. A run inherits PATH, and its sandbox
// lets it read every PATH folder, so an agent that calls `profile` or `ticket` by name would run
// another Harness than the one under test.
const otherHarness = (dir) =>
  dir === join(homedir(), '.claude', 'bin') || dir.includes(`${sep}.claude${sep}worfy-harness${sep}`) || /[\\/]harness[\\/](bin|hooks)[\\/]?$/.test(dir)
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !SESSION_VARIABLES.includes(key)))
if (childEnv.PATH) childEnv.PATH = childEnv.PATH.split(delimiter).filter((dir) => dir && !otherHarness(dir)).join(delimiter)

const fail = (message) => {
  process.stderr.write(`eval:harness: ${message}\n`)
  process.exit(1)
}

function claudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  try {
    const sdk = createRequire(join(REPO, 'package.json')).resolve('@anthropic-ai/claude-agent-sdk')
    const pkg = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
    return join(dirname(pkg), 'claude')
  } catch {
    return fail(`no claude binary of the Agent SDK for ${process.platform}-${process.arch} in node_modules; set CLAUDE_BIN`)
  }
}

/** -1, 0 or 1: version a against version b, both [major, minor, patch]. */
const compare = (a, b) => a.reduce((acc, n, i) => acc || Math.sign(n - b[i]), 0)

function checkVersion(claude) {
  const run = spawnSync(claude, ['--version'], { encoding: 'utf8', env: childEnv })
  if (run.error || run.status !== 0) fail(`${claude} --version failed: ${run.error?.message ?? run.stderr.trim()}`)
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(run.stdout)
  if (!match) fail(`cannot read the version from "${run.stdout.trim()}"`)
  const version = match.slice(1, 4).map(Number)
  if (compare(version, MIN_VERSION) < 0) {
    fail(`claude ${version.join('.')} has no \`plugin eval\`: it needs ${MIN_VERSION.join('.')} or newer (${claude})`)
  }
  return version.join('.')
}

/** Values of a repeatable option in the pass-through arguments (`--case a`, `--tag a b`). */
function optionValues(args, name) {
  const values = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      for (let j = i + 1; j < args.length && !args[j].startsWith('-'); j++) values.push(args[j])
    } else if (args[i].startsWith(`${name}=`)) {
      values.push(args[i].slice(name.length + 1))
    }
  }
  return values
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)

/** Case name -> tags, from the front matter of each harness/evals/<case>/prompt.md. */
function caseTags() {
  return readdirSync(EVALS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EVALS, entry.name, 'prompt.md')))
    .map((entry) => {
      const text = readFileSync(join(EVALS, entry.name, 'prompt.md'), 'utf8')
      const tags = /^tags:\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? ''
      return [entry.name, tags.split(',').map((tag) => tag.trim()).filter(Boolean)]
    })
}

/** Whether the call for `tag` would select any case under the pass-through --case and --tag. */
function selects(tag, args) {
  const globs = optionValues(args, '--case').map(globToRegExp)
  const tags = optionValues(args, '--tag')
  return caseTags().some(
    ([name, own]) =>
      own.includes(tag) && (globs.length === 0 || globs.some((glob) => glob.test(name))) && (tags.length === 0 || tags.some((t) => own.includes(t))),
  )
}

/**
 * Copies the Harness at `source` into a new temporary folder, without evals/results/ and with no
 * `dependencies` in .claude-plugin/plugin.json; returns the copy's real path.
 */
function pluginCopy(source) {
  const target = join(realpathSync(mkdtempSync(join(tmpdir(), 'worfy-eval-harness-'))), 'harness')
  const results = join('evals', 'results')
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && inside !== results && !inside.startsWith(`${results}${sep}`)
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  delete manifest.dependencies
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return target
}

/** A string as one word of a POSIX shell. */
const shellWord = (text) => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * Copies the folder of `git --exec-path` into `<dir>/git-core/` without git-credential*, and writes
 * the wrapper `<dir>/git`; returns the wrapper. Each file is copied once: a second name of the same
 * file (git-add and the rest are links to the git binary) becomes a symlink inside the copy, so
 * the copy holds a few binaries and not a hundred copies of one. Exits 1 when git names no folder
 * or the copy does not answer `--version`.
 */
function gitCopy(dir) {
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8', env: childEnv })
  const source = exec.status === 0 ? exec.stdout.trim() : ''
  if (source === '' || !existsSync(source) || !statSync(source).isDirectory()) fail(`\`git --exec-path\` gave no folder (exit ${exec.status ?? exec.error?.code}): the runs need a copy of git`)
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
      `#!/bin/sh\n# git for the sandbox of a \`claude plugin eval\` run: a copy of ${source} (scripts/eval-harness.mjs)\n` +
        `GIT_EXEC_PATH=${shellWord(core)}\nGIT_CONFIG_NOSYSTEM=1\nexport GIT_EXEC_PATH GIT_CONFIG_NOSYSTEM\n` +
        `exec ${shellWord(join(core, 'git'))} "$@"\n`,
    )
    chmodSync(wrapper, 0o755)
  } catch (error) {
    removeTree(dir)
    fail(`cannot copy ${source} into ${core}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const check = spawnSync(wrapper, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
  if (check.status !== 0) {
    removeTree(dir)
    fail(`the copy of git does not run (${wrapper} --version, exit ${check.status ?? check.error?.code}): ${(check.stderr ?? '').trim()}`)
  }
  return wrapper
}

const passThrough = process.argv.slice(2)
if (passThrough[0] === '--') passThrough.shift()

const claude = claudeBinary()
const version = checkVersion(claude)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
process.stdout.write(`eval:harness: claude ${version} (${claude}), model ${MODEL}, judge ${JUDGE_MODEL}\n`)

// Ctrl-C, SIGTERM and a closed terminal (SIGHUP) reach claude too; this process outlives it to
// remove the copies, starts no further call (each one is paid, and after SIGHUP nobody could stop
// it) and exits with 128 + the signal number.
let stopped = null // the first of these signals this process got
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => (stopped ??= signal))
// A signal handler runs only when the event loop gets a turn, and spawnSync does not give it one.
const signalsHandled = () => new Promise((resolve) => setImmediate(resolve))

const gitDir = join(EVALS, 'results', `${stamp}-git`)
const evalGit = gitCopy(gitDir)
childEnv.PATH = [gitDir, childEnv.PATH].filter(Boolean).join(delimiter)
childEnv.EVAL_GIT = evalGit
childEnv.EVAL_HARNESS_HOME = 'worfy-harness'
process.stdout.write(`eval:harness: git for the runs — ${evalGit}\n`)
let harness = ''
let worst = 0
const outputs = []
try {
  harness = pluginCopy(SOURCE)
  process.stdout.write(`eval:harness: plugin under test — ${harness} (a copy of ${SOURCE} without dependencies)\n`)
  for (const tag of ['main', 'gui']) {
    // A signal during the copies or the call before stops here: claude may have ended on it, or
    // caught it and exited with a code of its own.
    await signalsHandled()
    if (stopped) {
      process.stdout.write(`eval:harness: stopped by ${stopped}, the ${tag} call and any after it are skipped\n`)
      break
    }
    if (!selects(tag, passThrough)) {
      process.stdout.write(`eval:harness: no ${tag} case selected, the ${tag} call is skipped\n`)
      continue
    }
    const outputDir = join(EVALS, 'results', `${stamp}-${tag}`)
    // The target goes before --tag and --allow-tools: both take a list and would swallow it.
    const args = ['plugin', 'eval', harness, ...COMMON, '--output-dir', outputDir, '--tag', tag, '--allow-tools', ...grants(harness)[tag], ...passThrough]
    process.stdout.write(`eval:harness: ${tag} — claude ${args.join(' ')}\n`)
    const run = spawnSync(claude, args, { stdio: 'inherit', cwd: REPO, env: childEnv })
    const code = run.status ?? 128 + (constants.signals[run.signal] ?? constants.signals.SIGTERM)
    process.stdout.write(`eval:harness: ${tag} exited ${code}\n`)
    worst = Math.max(worst, code)
    outputs.push(outputDir)
  }
  await signalsHandled()
  if (stopped) worst = Math.max(worst, 128 + (constants.signals[stopped] ?? constants.signals.SIGTERM))
} finally {
  // The copy of git goes even when removing the copy of the plugin throws.
  try {
    if (harness) removeTree(dirname(harness))
  } finally {
    removeTree(gitDir)
  }
}

for (const dir of outputs) {
  process.stdout.write(`${join(dir, 'aggregate-result.json')}\n${join(dir, 'report.html')}\n`)
}
process.exit(worst)
