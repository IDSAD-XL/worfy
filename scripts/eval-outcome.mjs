#!/usr/bin/env node
// pnpm eval:outcome -- --max-cost-usd <usd> [<claude plugin eval options>] [--no-score]
//
// Runs the outcome eval (scripts/eval-outcome/README.md): every task twice on the same model, with
// the plugin under test and without any plugin, through one `claude plugin eval --ablation
// with-without` call, then scores what each run left behind (scripts/eval-outcome-score.mjs).
// Real model calls on the owner's account, by hand: not in CI and not in any check.
//
// The call: a temporary copy of harness/ without `dependencies` in its manifest is the target;
// `--eval-dir evals-outcome` picks the tasks; `--keep-temp` keeps each run's working folder for the
// score; `--scaffold --trust-plugin`, the pinned agent and judge models, `--threshold 0` (a low
// score is a result here, not a failure), `--no-publish`, Bash, Write and Edit granted, and the
// arguments given. The runs get the environment `pnpm eval:harness` gives its runs: no variables of
// the Claude Code session this is started from, no other plugin copy on PATH, a copy of git first on
// PATH, EVAL_GIT and EVAL_HARNESS_HOME=worfy-harness (the plugin's state lives in .git/worfy-harness
// of the run's working folder, harness/hooks/eval-env.cjs).
//
// --max-cost-usd is required: every call is paid. --ablation, --eval-dir, --output-dir, --model and
// --judge-model are fixed and refused. With no task folder in harness/evals-outcome/ it says so and
// exits 1 before claude starts. HARNESS_DIR=<dir> evaluates another copy of the plugin (the tests).
// Results go to scripts/eval-outcome/results/<time>/, outside the plugin, so no plugin copy carries
// them; EVAL_OUTCOME_RESULTS names another folder (the tests).
//
// After the call, when it wrote aggregate-result.json, the result is scored (paid judge calls;
// EVAL_OUTCOME_JUDGE replaces the judge, EVAL_OUTCOME_HIDDEN the folder of score specs); --no-score
// skips that. A signal during the score stops it between runs: no outcome.json. Exit code: the worse
// of the call's and the score's; 1 — no task folder, no claude, a claude without `plugin eval`, no
// git, or a score with problems; 2 — usage; 128 + the signal number — stopped by a signal.
import { constants } from 'node:os'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import { fileURLToPath } from 'node:url'
import {
  checkVersion,
  claudeBinary,
  cleanEnv,
  gitCopy,
  JUDGE_MODEL,
  judgeCommand,
  MODEL,
  pluginCopy,
  runClaude,
  scoreResults,
  taskFolders,
} from './eval-outcome-lib.mjs'
import { removeTree } from './remove-tree.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = process.env.HARNESS_DIR ? resolve(process.env.HARNESS_DIR) : join(REPO, 'harness')
const EVAL_DIR = 'evals-outcome'
const OUTCOME = join(SOURCE, EVAL_DIR)
const say = (line) => process.stdout.write(`eval:outcome: ${line}\n`)
const stop = (code, message) => {
  process.stderr.write(`eval:outcome: ${message}\n`)
  process.exit(code)
}
const usage = 'usage: pnpm eval:outcome -- --max-cost-usd <usd> [<claude plugin eval options>] [--no-score]'

const given = process.argv.slice(2)
if (given[0] === '--') given.shift()
const score = !given.includes('--no-score')
const passThrough = given.filter((arg) => arg !== '--no-score')
const named = (name) => passThrough.some((arg) => arg === name || arg.startsWith(`${name}=`))
for (const fixed of ['--ablation', '--eval-dir', '--output-dir', '--model', '--judge-model']) if (named(fixed)) stop(2, `${fixed} is fixed by this script and cannot be given; ${usage}`)
const costIndex = passThrough.findIndex((arg) => arg === '--max-cost-usd' || arg.startsWith('--max-cost-usd='))
const cost = costIndex < 0 ? '' : passThrough[costIndex].includes('=') ? passThrough[costIndex].split('=')[1] : passThrough[costIndex + 1]
if (!(Number(cost) > 0)) stop(2, `--max-cost-usd <usd> is required: every run is paid; ${usage}`)

const tasks = taskFolders(OUTCOME)
if (tasks.length === 0) stop(1, `no task folder in ${OUTCOME}: nothing to run (the slot is empty)`)

const childEnv = cleanEnv()
const fail = (message) => stop(1, message)
const claude = claudeBinary(REPO, fail)
const version = checkVersion(claude, childEnv, fail)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
say(`claude ${version} (${claude}), model ${MODEL}, judge ${JUDGE_MODEL}, tasks: ${tasks.join(', ')}`)

// Ctrl-C, SIGTERM and SIGHUP reach claude too; this process outlives it to remove the copies, does
// not score (the judge is paid) and exits with 128 + the signal number. The handler only notes the
// signal and so defers the exit: during the score the run in hand finishes (the modes opened on a
// kept run come back as its copy ends), and the score stops before its next run.
let stopped = null
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopped ??= signal
  })
}
const signalsHandled = () => new Promise((done) => setImmediate(done))
const exitStopped = () => {
  say(`stopped by ${stopped}; the result is not scored, no outcome.json`)
  process.exit(128 + (constants.signals[stopped] ?? constants.signals.SIGTERM))
}

const RESULTS = process.env.EVAL_OUTCOME_RESULTS ? resolve(process.env.EVAL_OUTCOME_RESULTS) : join(REPO, 'scripts', 'eval-outcome', 'results')
const gitDir = join(RESULTS, `${stamp}-git`)
const evalGit = gitCopy(gitDir, childEnv, fail)
childEnv.PATH = [gitDir, childEnv.PATH].filter(Boolean).join(delimiter)
childEnv.EVAL_GIT = evalGit
childEnv.EVAL_HARNESS_HOME = 'worfy-harness'
const outputDir = join(RESULTS, stamp)
let harness = ''
let worst
try {
  harness = pluginCopy(SOURCE)
  say(`plugin under test — ${harness} (a copy of ${SOURCE} without dependencies); git for the runs — ${evalGit}`)
  // The target goes first: --allow-tools takes a list and would swallow it.
  const args = [
    'plugin',
    'eval',
    harness,
    '--scaffold',
    '--trust-plugin',
    '--ablation',
    'with-without',
    '--eval-dir',
    EVAL_DIR,
    '--keep-temp',
    '--threshold',
    '0',
    '--no-publish',
    '--model',
    MODEL,
    '--judge-model',
    JUDGE_MODEL,
    '--output-dir',
    outputDir,
    '--allow-tools',
    'Bash',
    'Write',
    'Edit',
    ...passThrough,
  ]
  say(`claude ${args.join(' ')}`)
  const run = runClaude(claude, args, { stdio: 'inherit', cwd: REPO, env: childEnv })
  // A claude that did not start (run.error, no status and no signal) is exit 1, not a signal.
  worst = run.status ?? (run.signal ? 128 + (constants.signals[run.signal] ?? constants.signals.SIGTERM) : 1)
  say(`claude exited ${worst}${run.error ? ` (${run.error.message})` : ''}`)
} finally {
  try {
    if (harness) removeTree(dirname(harness))
  } finally {
    removeTree(gitDir)
  }
}

await signalsHandled()
if (stopped) exitStopped()
const aggregate = join(outputDir, 'aggregate-result.json')
if (!existsSync(aggregate)) stop(Math.max(worst, 1), `no ${aggregate}: nothing to score`)
say(aggregate)
if (score) {
  const hiddenDir = process.env.EVAL_OUTCOME_HIDDEN || join(REPO, 'scripts', 'eval-outcome', 'hidden')
  const { problems, stopped: interrupted } = await scoreResults({ resultsDir: outputDir, hiddenDir, judge: judgeCommand(claude), log: say, stopped: () => stopped })
  if (interrupted) exitStopped()
  say(join(outputDir, 'outcome.json'))
  if (problems.length > 0) {
    process.stderr.write(`eval:outcome: not scored, or scored with checks that could not tell:\n${problems.join('\n')}\n`)
    worst = Math.max(worst, 1)
  }
} else {
  say(`not scored (--no-score): node scripts/eval-outcome-score.mjs ${outputDir}`)
}
process.exit(worst)
