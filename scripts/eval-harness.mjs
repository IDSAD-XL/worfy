#!/usr/bin/env node
// pnpm eval:harness [-- <claude plugin eval options>] — runs the eval cases of the Harness
// (harness/evals/, ticket worfy-harness/27) with `claude plugin eval`: real model calls on the
// owner's account, by hand, on a Mac. Not in CI and not in the gate.
//
// One call per tag, because the cases need different shell grants (with --changed, below, a tag of
// which only some cases are chosen gets one call per chosen case):
//   main — cases tagged `main`, with Bash, Write and Edit;
//   gui  — cases tagged `gui` (no-os-screen-capture), with Bash only for git, node, the Harness
//          scripts, `echo` and `set -o pipefail`: an attempt at an OS screen capture is refused,
//          not run. A real capture from a run started inside worfy would ask Screen Recording for
//          the app, and granting it restarts the app (lesson 2026-10-07).
// The target is a temporary copy of harness/ whose plugin.json has no `dependencies`: in a run
// only the plugin under test is installed, and Claude Code refuses to load a plugin whose
// dependency (mattpocock-skills) is missing — then no case sees a single rule of the Harness.
// HARNESS_DIR=<dir> evaluates another copy of the Harness instead of harness/ (the mutation check of
// the ticket); results go to <that dir>/evals/results/.
// Arguments after `--` go to every call as they are (`pnpm eval:harness -- --case status-block
// --runs 1`); a call whose tag no case selected by --case/--tag carries is skipped.
// `--changed <base>` (ticket worfy-harness/29) is this script's own and does not reach claude: it runs
// only the cases of the rule files changed since <base> — `git diff <base>...HEAD` plus what
// `git status` shows, the way the gate finds changed files — by the map harness/evals/lib/coverage.json
// (scripts/eval-harness-coverage.mjs). It prints which file chose which cases and which changed rule
// file has no case. No case chosen — exit 0 without claude. Exit 1 without claude: an unknown <base>,
// a git failure, --changed with --case, --tag or HARNESS_DIR, or a map that does not match harness/.
// `claude plugin eval --case` takes one name glob, so when the change chooses some cases of a tag but
// not all of them, each chosen case of that tag is a call of its own.
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
// 2.1.269 (no `plugin eval`) — exit 1. The cost ceiling is BUDGET_USD for the whole run: each call
// gets --max-cost-usd with what the calls before it left, by the costUsd of their reports; nothing
// left — the remaining calls are not started, exit 2. Exit code: the worst of the calls (0 — every case at or
// above the threshold; 1 — a case below it or not loaded; 2 — partial: cost ceiling or the
// account refused; 128 + the signal number — stopped by a signal: SIGINT 130, SIGHUP 129, SIGTERM
// 143, and the remaining calls are not started). At the end: the paths to aggregate-result.json and
// report.html of each call, then one line per call for the PR description, from its
// aggregate-result.json: `eval:harness <tag>: casesPassed <n> of <selected>, overallScore <x>, costUsd
// <y>, claudeVersion <v>, cases <a,b>` (`, partial` at the end of a partial run), or
// `eval:harness <tag>: no aggregate-result.json`; the exit code does not depend on these lines.
// The pinned models, the environment of the runs and the copies of the plugin and of git come from
// scripts/eval-run-env.mjs, which `pnpm eval:outcome` shares.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { constants } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { casesFor, coverageProblems, readCoverage } from './eval-harness-coverage.mjs'
import { checkVersion, claudeBinary, cleanEnv, gitForRuns, JUDGE_MODEL, MODEL, pluginCopy, runClaude } from './eval-run-env.mjs'
import { removeTree } from './remove-tree.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = process.env.HARNESS_DIR ? resolve(process.env.HARNESS_DIR) : join(REPO, 'harness')
const EVALS = join(SOURCE, 'evals')
// The cost ceiling of one run of this script, in USD, across all of its calls: each call gets
// --max-cost-usd with what the calls before it left.
const BUDGET_USD = 30
const COMMON = [
  '--scaffold',
  '--trust-plugin',
  '--ablation', 'none',
  '--threshold', '0.8',
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
    // Claude Code checks each part of a compound command against these rules and lets neither of
    // these through on its own (claude 2.1.289); the Harness asks for both around every check.
    'Bash(echo *)',
    'Bash(set -o pipefail)',
    'Write',
    'Edit',
  ],
})

// The environment of every child: no Claude Code session variables, no other Harness copy on PATH.
const childEnv = cleanEnv()

const fail = (message) => {
  process.stderr.write(`eval:harness: ${message}\n`)
  process.exit(1)
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

/** The cases the call for `tag` selects under the pass-through --case and --tag, sorted. */
function selected(tag, args) {
  const globs = optionValues(args, '--case').map(globToRegExp)
  const tags = optionValues(args, '--tag')
  return caseTags()
    .filter(
      ([name, own]) =>
        own.includes(tag) && (globs.length === 0 || globs.some((glob) => glob.test(name))) && (tags.length === 0 || tags.some((t) => own.includes(t))),
    )
    .map(([name]) => name)
    .sort()
}

const hasOption = (args, name) => args.some((arg) => arg === name || arg.startsWith(`${name}=`))

/**
 * The files changed since `base` in the repository of this script, relative to its root: what the
 * branch added on top of its merge-base with `base` (`git diff <base>...HEAD`), and what
 * `git status` shows — staged, unstaged and untracked, every file of a new folder. A rename counts
 * as its two paths (`--no-renames`: the old path arrives as a deletion), so a file moved from one
 * case folder to another changes both cases. `-z`: paths come NUL-separated and never quoted.
 * Exits 1 when git fails, an unknown base among the reasons.
 */
function changedFiles(base) {
  const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env: childEnv })
  const steps = [
    ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`, '--'],
    ['status', '--porcelain', '--no-renames', '-z', '--untracked-files=all'],
  ]
  const found = []
  for (const args of steps) {
    const run = git(args)
    if (run.error || run.status !== 0) fail(`--changed: git ${args.join(' ')} failed (exit ${run.status ?? run.error?.code}): ${(run.stderr ?? '').trim()}`)
    const entries = run.stdout.split('\0').filter(Boolean)
    // `git status --porcelain -z`: two status letters and a space, then the path.
    found.push(...(args[0] === 'status' ? entries.map((entry) => entry.slice(3)) : entries))
  }
  return [...new Set(found)].sort()
}

/**
 * What a finished call spent: the costUsd of the aggregate-result.json in its `outputDir`, a partial
 * run's too; `granted`, the --max-cost-usd it was given, when the report is missing, unreadable or has
 * no costUsd — a call that crashed after spending must not hand its whole limit to the next one.
 */
function spentIn(outputDir, granted) {
  try {
    const cost = JSON.parse(readFileSync(join(outputDir, 'aggregate-result.json'), 'utf8'))?.costUsd
    // shortcut: a call without a costUsd counts its whole limit, redo if claude reports a crashed call's spend.
    return typeof cost === 'number' && cost >= 0 ? cost : granted
  } catch {
    return granted
  }
}

/** The line of one call for the PR description, from the aggregate-result.json the call wrote. */
function summary({ tag, outputDir, cases }) {
  let report = null
  try {
    report = JSON.parse(readFileSync(join(outputDir, 'aggregate-result.json'), 'utf8'))
  } catch {
    // No file, or not JSON: the same line below.
  }
  if (typeof report !== 'object' || report === null) return `eval:harness ${tag}: no aggregate-result.json`
  const aggregates = typeof report.aggregates === 'object' && report.aggregates !== null ? report.aggregates : {}
  const number = (value) => (typeof value === 'number' ? Number(value.toFixed(2)) : 'unknown')
  return (
    `eval:harness ${tag}: casesPassed ${aggregates.casesPassed ?? 'unknown'} of ${cases.length}, overallScore ${number(aggregates.overallScore)}, ` +
    `costUsd ${number(report.costUsd)}, claudeVersion ${report.claudeVersion ?? 'unknown'}, cases ${cases.join(',')}${report.partial === true ? ', partial' : ''}`
  )
}

const passThrough = process.argv.slice(2)
if (passThrough[0] === '--') passThrough.shift()

// --changed <base> or --changed=<base>: taken out of the arguments for claude.
let chosen = null // the cases --changed chose; null without --changed
const changedAt = passThrough.findIndex((arg) => arg === '--changed' || arg.startsWith('--changed='))
if (changedAt !== -1) {
  const option = passThrough[changedAt]
  const base = option === '--changed' ? passThrough[changedAt + 1] : option.slice('--changed='.length)
  passThrough.splice(changedAt, option === '--changed' ? 2 : 1)
  if (!base || base.startsWith('-')) fail('--changed needs a base: --changed origin/main')
  for (const name of ['--case', '--tag', '--changed']) if (hasOption(passThrough, name)) fail(`--changed chooses the cases itself and does not go with ${name}`)
  if (process.env.HARNESS_DIR) fail('--changed reads the changes of harness/ in this repository and does not go with HARNESS_DIR')
  const problems = coverageProblems(SOURCE)
  if (problems.length > 0) fail(`--changed: harness/evals/lib/coverage.json does not match harness/:\n  ${problems.join('\n  ')}`)
  const selection = casesFor(changedFiles(base), readCoverage(SOURCE), caseTags().map(([name]) => name))
  for (const { path, cases } of selection.files) process.stdout.write(`eval:harness: ${path} -> ${cases.join(', ')}\n`)
  for (const { path, reason } of selection.uncovered) process.stdout.write(`eval:harness: no case: ${path} — ${reason}\n`)
  if (selection.cases.length === 0) {
    process.stdout.write(`eval:harness: no case selected by the files changed since ${base}, claude is not called\n`)
    process.exit(0)
  }
  chosen = selection.cases
}

// The calls: { tag, name (of the call and its results folder), args (only this call's), cases }.
const calls = []
for (const tag of ['main', 'gui']) {
  const all = selected(tag, chosen ? [] : passThrough)
  const cases = chosen ? all.filter((name) => chosen.includes(name)) : all
  if (cases.length === 0) process.stdout.write(`eval:harness: no ${tag} case selected, the ${tag} call is skipped\n`)
  else if (cases.length === all.length) calls.push({ tag, name: tag, args: [], cases })
  else for (const name of cases) calls.push({ tag, name: `${tag}-${name}`, args: ['--case', name], cases: [name] })
}

const claude = claudeBinary(REPO, fail)
const version = checkVersion(claude, childEnv, fail)
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
const evalGit = gitForRuns(gitDir, childEnv, fail)
process.stdout.write(`eval:harness: git for the runs — ${evalGit}\n`)
let harness = ''
let worst = 0
const outputs = []
try {
  harness = pluginCopy(SOURCE)
  process.stdout.write(`eval:harness: plugin under test — ${harness} (a copy of ${SOURCE} without dependencies)\n`)
  for (const call of calls) {
    // A signal during the copies or the call before stops here: claude may have ended on it, or
    // caught it and exited with a code of its own.
    await signalsHandled()
    if (stopped) {
      process.stdout.write(`eval:harness: stopped by ${stopped}, the ${call.name} call and any after it are skipped\n`)
      break
    }
    const spent = outputs.reduce((sum, done) => sum + spentIn(done.outputDir, done.granted), 0)
    const left = Number((BUDGET_USD - spent).toFixed(2))
    if (left <= 0) {
      process.stdout.write(
        `eval:harness: the ${BUDGET_USD} USD of this run are spent (${Number(spent.toFixed(2))} USD), the ${call.name} call and any after it are skipped\n`,
      )
      // As a call that hit its ceiling: the run is partial.
      worst = Math.max(worst, 2)
      break
    }
    const outputDir = join(EVALS, 'results', `${stamp}-${call.name}`)
    // The target goes before --tag and --allow-tools: both take a list and would swallow it.
    const args = [
      'plugin', 'eval', harness, ...COMMON, '--max-cost-usd', String(left), '--output-dir', outputDir,
      '--tag', call.tag, '--allow-tools', ...grants(harness)[call.tag], ...passThrough, ...call.args,
    ]
    process.stdout.write(`eval:harness: ${call.name} — claude ${args.join(' ')}\n`)
    const run = runClaude(claude, args, { stdio: 'inherit', cwd: REPO, env: childEnv })
    const code = run.status ?? 128 + (constants.signals[run.signal] ?? constants.signals.SIGTERM)
    process.stdout.write(`eval:harness: ${call.name} exited ${code}\n`)
    worst = Math.max(worst, code)
    outputs.push({ ...call, outputDir, granted: left })
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

for (const { outputDir } of outputs) {
  process.stdout.write(`${join(outputDir, 'aggregate-result.json')}\n${join(outputDir, 'report.html')}\n`)
}
for (const call of outputs) process.stdout.write(`${summary(call)}\n`)
process.exit(worst)
