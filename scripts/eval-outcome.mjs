#!/usr/bin/env node
// pnpm eval:outcome -- --max-cost-usd <usd> [--compare-profiles] [--dry-run] [<claude plugin eval options>] [--no-score]
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
// arguments given. The runs get the environment `pnpm eval:harness` gives its runs (both take it from
// scripts/eval-run-env.mjs): no variables of the Claude Code session this is started from, no other
// plugin copy on PATH, a copy of git first on PATH, EVAL_GIT and EVAL_HARNESS_HOME=worfy-harness (the
// plugin's state lives in .git/worfy-harness of the run's working folder, harness/hooks/eval-env.cjs).
//
// --compare-profiles compares two profiles of the same plugin instead of the plugin with no plugin:
// two calls on the same tasks, each with `--ablation none` (the arm with the plugin alone) and half
// of --max-cost-usd, one with the profile `full` and one with `eco` (PROFILES). Each call evaluates
// its own copy of the plugin, which differs from harness/ only in one more state script,
// evals-outcome/lib/plugin-state/zz-compare-profile.sh: it runs after worfy.sh in a task's scaffold
// and sets `workflow.agents` and `agents` of the profile worfy.sh wrote. After each call every
// kept run must show those fields in the profile the plugin read (.git/worfy-harness of its working
// folder); a run without them — a scaffold that does not run plugin-state/*.sh — fails the
// comparison with exit 1 before the next call and before the score. Results go to
// <results>/<time>/full/ and <time>/eco/, each scored, and <time>/compare.json puts them side by
// side per task: the metrics, tokens and cost of each profile, the rework rounds (subagent briefs
// that start with `Rework:` or carry a `Findings:` line) and subagents per run from the traces, and
// the difference eco − full (rates: Newcombe interval and Fisher p; tokens: the ratio full / eco).
//
// --dry-run prints the calls it would make — the plugin copy, the cost limit of each, the profile —
// and exits 0 before any plugin copy and before `claude plugin eval`: the price is read from the
// command eval really runs. It does run `claude --version` (free), as every run does.
//
// --max-cost-usd is required: every call is paid; a plain decimal above 0 and at most 1000, passed on
// as a number. --ablation, --eval-dir, --output-dir, --model and
// --judge-model are fixed and refused. With no task folder in harness/evals-outcome/ it says so and
// exits 1 before claude starts. HARNESS_DIR=<dir> evaluates another copy of the plugin (the tests).
// Results go to scripts/eval-outcome/results/<time>/, outside the plugin, so no plugin copy carries
// them; EVAL_OUTCOME_RESULTS names another folder (the tests).
//
// After the call, when it wrote aggregate-result.json, the result is scored (paid judge calls;
// EVAL_OUTCOME_JUDGE replaces the judge, EVAL_OUTCOME_HIDDEN the folder of score specs); --no-score
// skips that (not with --compare-profiles, which needs the score). A signal during the score stops
// it between runs: no outcome.json. A signal during the first call of --compare-profiles starts no
// second one. Exit code: the worse of the calls' and the scores'; 1 — no task folder, no claude, a
// claude without `plugin eval`, no git, a call without aggregate-result.json, a profile that did
// not reach the plugin, or a score with problems; 2 — usage; 128 + the signal number — stopped by a signal.
import { constants } from 'node:os'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { copyKeptRun, judgeCommand, readTrace, scoreResults, taskFolders } from './eval-outcome-lib.mjs'
import { fisherExact, newcombe } from './eval-outcome-stats.mjs'
import { checkVersion, claudeBinary, cleanEnv, gitFolder, gitForRuns, JUDGE_MODEL, MODEL, pluginCopy, runClaude } from './eval-run-env.mjs'
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
const usage = 'usage: pnpm eval:outcome -- --max-cost-usd <usd> [--compare-profiles] [--dry-run] [<claude plugin eval options>] [--no-score]'

/**
 * The profiles of --compare-profiles, in the order they run: the values of `workflow.agents` and
 * `agents` (null — no such field) the profile of a task's project gets. `eco` is the Pro preset of
 * src/shared/agent/plan-preset.ts (fewer agents per Ticket, Sonnet and effort medium for every role);
 * the contract test checks they are the same. `full` sets no models: the agents keep their own.
 */
const ROLE = { model: 'sonnet', effort: 'medium' }
const PROFILES = {
  full: { 'workflow.agents': 'full', agents: null },
  eco: { 'workflow.agents': 'eco', agents: { implementer: ROLE, reviewer: ROLE, scout: ROLE, verifier: ROLE } },
}
const PROFILE_SCRIPT = 'zz-compare-profile.sh'

/**
 * The state script of one profile run. Its name sorts after worfy.sh, and a scaffold runs
 * plugin-state/*.sh in name order. It finds the state folders the way worfy.sh does and sets the
 * fields in every profile there; none found is exit 1, so a scaffold that ran it first fails rather
 * than run the default profile.
 */
const profileScript = (name, fields) =>
  [
    '#!/usr/bin/env bash',
    `# Written by scripts/eval-outcome.mjs --compare-profiles into its copy of the plugin, never into`,
    `# harness/: the profile "${name}" of this run, set in the state plugin-state/worfy.sh wrote.`,
    'set -euo pipefail',
    'here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"',
    'plugin="$here/../../.."',
    'state="$(EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" env -u HARNESS_HOME node "$plugin/hooks/eval-env.cjs" harness-home)"',
    'home_state="$state"',
    '[ -n "${EVAL_HARNESS_HOME:-}" ] || home_state="$HOME/.claude/worfy-harness"',
    '# Git Bash spells HOME as /c/Users/...; node reads the Windows form.',
    'if command -v cygpath >/dev/null 2>&1; then home_state="$(cygpath -m "$home_state")"; fi',
    `node - "$state" "$home_state" <<'EOF'`,
    "const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    `const fields = ${JSON.stringify(fields)}`,
    'let set = 0',
    'for (const dir of new Set(process.argv.slice(2))) {',
    "  const projects = join(dir, 'projects')",
    '  for (const name of existsSync(projects) ? readdirSync(projects) : []) {',
    "    const file = join(projects, name, 'profile.json')",
    '    if (!existsSync(file)) continue',
    "    const profile = JSON.parse(readFileSync(file, 'utf8'))",
    "    profile.workflow = { ...profile.workflow, agents: fields['workflow.agents'] }",
    '    if (fields.agents === null) delete profile.agents',
    '    else profile.agents = fields.agents',
    "    writeFileSync(file, JSON.stringify(profile, null, 2) + '\\n')",
    '    set++',
    '  }',
    '}',
    `if (set === 0) { console.error('${PROFILE_SCRIPT}: no profile in ' + process.argv.slice(2).join(' and ') + ': run plugin-state/worfy.sh first'); process.exit(1) }`,
    'EOF',
    '',
  ].join('\n')

// --- the comparison of two profiles --------------------------------------------------------------

/** A subagent brief of a rework round, as the plugin's agents read it: `Rework:` first, or a `Findings:` line. */
const REWORK = /^\s*Rework:|^\s*Findings:/m

/** The subagent calls of a run and how many of them are rework rounds, from its trace (subagents' calls too). */
function traceAgents(tracePath) {
  const briefs = readTrace(tracePath)
    .flatMap((e) => (e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []))
    .filter((block) => block?.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task'))
    .map((block) => String(block.input?.prompt ?? ''))
  return { subagents: briefs.length, rework: briefs.filter((brief) => REWORK.test(brief)).length }
}

/** The state folder of the runs inside .git of their working folder: EVAL_HARNESS_HOME of scripts/eval-run-env.mjs. */
const RUN_STATE = 'worfy-harness'

/** JSON with the keys of every object sorted: two values are equal whatever their key order. */
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value)

/**
 * Where the profile of `run` did not reach the plugin: for every run of its result that is scored
 * (no error, a trace), the profiles the plugin reads in the kept working folder
 * (.git/worfy-harness/projects/<name>/profile.json, read from a copy, copyKeptRun) must exist and
 * have the fields of `run`. A task whose scaffold does not run plugin-state/*.sh has none. Returns
 * one line per such run.
 */
function profileProblems(run) {
  const aggregate = JSON.parse(readFileSync(join(run.outputDir, 'aggregate-result.json'), 'utf8'))
  const problems = []
  for (const testCase of aggregate.cases ?? []) {
    for (const [arm, results] of Object.entries(testCase.arms ?? {})) {
      for (const [index, result] of results.entries()) {
        if (result.error || !result.tracePath) continue
        const where = `profile ${run.name}, ${testCase.name} ${arm} #${index}`
        let copy = null
        try {
          copy = copyKeptRun(result.tracePath)
          const projects = join(copy.work, '.git', RUN_STATE, 'projects')
          const files = (existsSync(projects) ? readdirSync(projects) : []).map((name) => join(projects, name, 'profile.json')).filter((file) => existsSync(file))
          if (files.length === 0) problems.push(`${where}: no profile in .git/${RUN_STATE}/projects of its working folder (does the scaffold run plugin-state/*.sh?)`)
          for (const file of files) {
            const profile = JSON.parse(readFileSync(file, 'utf8'))
            const found = { 'workflow.agents': profile.workflow?.agents ?? null, agents: profile.agents ?? null }
            if (canonical(found) !== canonical(run.fields)) problems.push(`${where}: ${relative(copy.work, file)} has ${JSON.stringify(found)}`)
          }
        } catch (error) {
          problems.push(`${where}: its profile could not be read: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          if (copy) removeTree(copy.dir)
        }
      }
    }
  }
  return problems
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)

/** One profile's side of a task: the summary of the arm with the plugin and the counts from its traces. */
function sideOf(arm) {
  const counts = arm.runs.map((run) => traceAgents(run.tracePath))
  return {
    runs: arm.runs.length,
    excluded: arm.excluded.length,
    metrics: arm.metrics,
    tokens: arm.tokens,
    cost_usd: arm.cost_usd,
    duration_seconds: arm.duration_seconds,
    rework_rounds: { mean: mean(counts.map((c) => c.rework)), runs: counts.map((c) => c.rework) },
    subagents: { mean: mean(counts.map((c) => c.subagents)), runs: counts.map((c) => c.subagents) },
  }
}

/** compare.json: per task, the side of each profile and the difference eco − full. */
function compareProfiles(profileRuns, outcomes) {
  const summary = {
    schemaVersion: 1,
    maxCostUsd: limitUsd,
    profiles: Object.fromEntries(profileRuns.map((run) => [run.name, { fields: run.fields, results: run.outputDir, maxCostUsd: Number(run.limit) }])),
    tasks: {},
  }
  const names = [...new Set(Object.values(outcomes).flatMap((outcome) => Object.keys(outcome.tasks)))]
  for (const task of names) {
    const sides = Object.fromEntries(Object.entries(outcomes).map(([name, outcome]) => [name, outcome.tasks[task]?.arms.with ? sideOf(outcome.tasks[task].arms.with) : null]))
    const { full, eco } = sides
    const difference = {}
    if (full && eco) {
      for (const [metric, a] of Object.entries(eco.metrics)) {
        const b = full.metrics[metric]
        if (!b) continue
        if (a.kind === 'rate') {
          const fisherP = a.n > 0 && b.n > 0 ? fisherExact(a.k, a.n - a.k, b.k, b.n - b.k) : null
          difference[metric] = { kind: 'rate', ...newcombe(a.k, a.n, b.k, b.n), fisherP }
        } else {
          difference[metric] = { kind: 'mean', difference: a.mean !== null && b.mean !== null ? a.mean - b.mean : null }
        }
      }
      const minus = (a, b) => (a !== null && b !== null ? a - b : null)
      difference.rework_rounds = { kind: 'mean', difference: minus(eco.rework_rounds.mean, full.rework_rounds.mean) }
      difference.subagents = { kind: 'mean', difference: minus(eco.subagents.mean, full.subagents.mean) }
      difference.cost_usd = { kind: 'median', difference: minus(eco.cost_usd.median, full.cost_usd.median) }
      const [fullTokens, ecoTokens] = [full.tokens.median, eco.tokens.median]
      difference.tokens = { kind: 'tokens', full: fullTokens, eco: ecoTokens, ratio: fullTokens !== null && ecoTokens ? fullTokens / ecoTokens : null }
    }
    summary.tasks[task] = { ...sides, difference }
  }
  return summary
}

/** One line per task and profile, then the token ratio of the task. */
function summaryLines(summary) {
  const lines = []
  const show = (value, digits = 1) => (value === null || value === undefined ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(digits))
  for (const [task, { difference, ...sides }] of Object.entries(summary.tasks)) {
    for (const [name, side] of Object.entries(sides)) {
      if (side === null) {
        lines.push(`${task} ${name}: no run`)
        continue
      }
      const metrics = Object.entries(side.metrics).map(([metric, m]) => (m.kind === 'rate' ? `${metric} ${m.k}/${m.n}` : `${metric} ${show(m.mean, 2)}`))
      lines.push(
        `${task} ${name}: ${metrics.join(', ')}; tokens ${show(side.tokens.median, 0)} (median), rework rounds ${show(side.rework_rounds.mean)}, subagents ${show(side.subagents.mean)}, cost $${show(side.cost_usd.median, 2)} (median)`,
      )
    }
    if (difference.tokens) lines.push(`${task}: tokens full / eco ${show(difference.tokens.ratio, 2)}`)
  }
  return lines
}

// --- the run -------------------------------------------------------------------------------------

const OWN_FLAGS = ['--no-score', '--compare-profiles', '--dry-run']
/** The highest --max-cost-usd this script passes on: a typo of a few zeros must not reach a paid call. */
const COST_CEILING_USD = 1000
const given = process.argv.slice(2)
if (given[0] === '--') given.shift()
const score = !given.includes('--no-score')
const compare = given.includes('--compare-profiles')
const dryRun = given.includes('--dry-run')
const passThrough = given.filter((arg) => !OWN_FLAGS.includes(arg))
const named = (name) => passThrough.some((arg) => arg === name || arg.startsWith(`${name}=`))
for (const fixed of ['--ablation', '--eval-dir', '--output-dir', '--model', '--judge-model']) if (named(fixed)) stop(2, `${fixed} is fixed by this script and cannot be given; ${usage}`)
// `--dry-run=<anything>` is no dry run, and as an unknown option it would reach a paid call.
for (const flag of OWN_FLAGS) if (named(flag)) stop(2, `${flag} takes no value; ${usage}`)
const costIndex = passThrough.findIndex((arg) => arg === '--max-cost-usd' || arg.startsWith('--max-cost-usd='))
const inline = costIndex >= 0 && passThrough[costIndex].includes('=')
const cost = costIndex < 0 ? '' : inline ? passThrough[costIndex].split('=')[1] : passThrough[costIndex + 1]
// A plain decimal only: Number() also reads `Infinity`, `0x10` and `1e9`, and claude would get the raw text.
if (!/^\d+(?:\.\d+)?$/.test(cost ?? '') || !(Number(cost) > 0) || Number(cost) > COST_CEILING_USD) {
  stop(2, `--max-cost-usd <usd> is required: a plain decimal above 0 and at most ${COST_CEILING_USD} (every run is paid); ${usage}`)
}
const limitUsd = Number(cost)
// A second one would reach claude after the limit this script sets, and claude would take it.
if (passThrough.filter((arg) => arg === '--max-cost-usd' || arg.startsWith('--max-cost-usd=')).length > 1) stop(2, `--max-cost-usd is given twice; ${usage}`)
if (compare && !score) stop(2, `--compare-profiles compares the scores of its two runs: --no-score cannot go with it; ${usage}`)
// The arguments for claude without --max-cost-usd: each call gets its own limit.
const rest = passThrough.filter((_, i) => i !== costIndex && (inline || i !== costIndex + 1))
// Each of the two runs gets half, rounded down to the cent.
const half = Math.floor(Number(((limitUsd * 100) / 2).toFixed(6))) / 100
if (compare && !(half > 0)) stop(2, `--max-cost-usd ${cost} is too small for two runs: each gets half, at least 0.01; ${usage}`)

const tasks = taskFolders(OUTCOME)
if (tasks.length === 0) stop(1, `no task folder in ${OUTCOME}: nothing to run (the slot is empty)`)

const childEnv = cleanEnv()
const fail = (message) => stop(1, message)
const claude = claudeBinary(REPO, fail)
const version = checkVersion(claude, childEnv, fail)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
say(`claude ${version} (${claude}), model ${MODEL}, judge ${JUDGE_MODEL}, tasks: ${tasks.join(', ')}`)

const RESULTS = process.env.EVAL_OUTCOME_RESULTS ? resolve(process.env.EVAL_OUTCOME_RESULTS) : join(REPO, 'scripts', 'eval-outcome', 'results')
const runs = compare
  ? Object.entries(PROFILES).map(([name, fields]) => ({ name, fields, ablation: 'none', limit: String(half), outputDir: join(RESULTS, stamp, name) }))
  : [{ name: null, fields: null, ablation: 'with-without', limit: String(limitUsd), outputDir: join(RESULTS, stamp) }]
// The target goes first: --allow-tools takes a list and would swallow it.
const argsOf = (run, target) => [
  'plugin',
  'eval',
  target,
  '--scaffold',
  '--trust-plugin',
  '--ablation',
  run.ablation,
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
  run.outputDir,
  '--max-cost-usd',
  run.limit,
  '--allow-tools',
  'Bash',
  'Write',
  'Edit',
  ...rest,
]

if (dryRun) {
  for (const run of runs) {
    if (run.name) say(`profile ${run.name}: ${JSON.stringify(run.fields)}`)
    say(`${run.name ?? 'the call'} — claude ${argsOf(run, `<a copy of ${SOURCE}>`).join(' ')}`)
  }
  say(`dry run: no plugin copy made, plugin eval not started; together the calls may spend up to ${limitUsd} USD, and scoring adds the judge's calls`)
  process.exit(0)
}

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
const aggregateOf = (run) => join(run.outputDir, 'aggregate-result.json')

const gitDir = gitFolder(RESULTS, stamp)
const evalGit = gitForRuns(gitDir, childEnv, fail)
let worst = 0
const notApplied = []
try {
  for (const run of runs) {
    let harness = ''
    try {
      harness = pluginCopy(SOURCE)
      if (run.fields) writeFileSync(join(harness, EVAL_DIR, 'lib', 'plugin-state', PROFILE_SCRIPT), profileScript(run.name, run.fields))
      say(`plugin under test — ${harness} (a copy of ${SOURCE} without dependencies${run.name ? `, profile ${run.name}: ${JSON.stringify(run.fields)}` : ''}); git for the runs — ${evalGit}`)
      const args = argsOf(run, harness)
      say(`claude ${args.join(' ')}`)
      const call = runClaude(claude, args, { stdio: 'inherit', cwd: REPO, env: childEnv })
      // A claude that did not start (call.error, no status and no signal) is exit 1, not a signal.
      const code = call.status ?? (call.signal ? 128 + (constants.signals[call.signal] ?? constants.signals.SIGTERM) : 1)
      worst = Math.max(worst, code)
      say(`claude exited ${code}${call.error ? ` (${call.error.message})` : ''}`)
    } finally {
      if (harness) removeTree(dirname(harness))
    }
    await signalsHandled()
    // A stopped or failed first call starts no second: its money would buy no comparison. Nor does
    // a run whose profile did not reach the plugin: it would compare full with full.
    if (stopped || !existsSync(aggregateOf(run))) break
    if (run.fields) notApplied.push(...profileProblems(run))
    if (notApplied.length > 0) break
  }
} finally {
  removeTree(gitDir)
}

await signalsHandled()
if (stopped) exitStopped()
if (notApplied.length > 0) stop(1, `the profile under comparison did not reach the plugin, nothing scored:\n${notApplied.join('\n')}`)
for (const run of runs) {
  if (!existsSync(aggregateOf(run))) stop(Math.max(worst, 1), `no ${aggregateOf(run)}: nothing to score`)
  say(aggregateOf(run))
}
if (!score) {
  say(`not scored (--no-score): node scripts/eval-outcome-score.mjs ${runs[0].outputDir}`)
  process.exit(worst)
}
const hiddenDir = process.env.EVAL_OUTCOME_HIDDEN || join(REPO, 'scripts', 'eval-outcome', 'hidden')
const outcomes = {}
for (const run of runs) {
  const { outcome, problems, stopped: interrupted } = await scoreResults({ resultsDir: run.outputDir, hiddenDir, judge: judgeCommand(claude), log: say, stopped: () => stopped })
  if (interrupted) exitStopped()
  say(join(run.outputDir, 'outcome.json'))
  if (problems.length > 0) {
    process.stderr.write(`eval:outcome: ${run.name ? `profile ${run.name}: ` : ''}not scored, or scored with checks that could not tell:\n${problems.join('\n')}\n`)
    worst = Math.max(worst, 1)
  }
  outcomes[run.name] = outcome
}
if (compare) {
  const summary = compareProfiles(runs, outcomes)
  const file = join(RESULTS, stamp, 'compare.json')
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`)
  for (const line of summaryLines(summary)) say(line)
  say(file)
}
process.exit(worst)
