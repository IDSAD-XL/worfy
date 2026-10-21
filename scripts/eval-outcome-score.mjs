#!/usr/bin/env node
// node scripts/eval-outcome-score.mjs <results dir> [--hidden-dir <dir>]
// node scripts/eval-outcome-score.mjs --validate <hidden task dir>
//
// Scores a result of `pnpm eval:outcome` (scripts/eval-outcome/README.md, "The score spec"): for
// every run of both arms in <results dir>/aggregate-result.json it copies the kept working folder
// the run's trace points at, runs the checks of scripts/eval-outcome/hidden/<task>/score.json on
// the copy, asks the judge, and writes <results dir>/outcome.json with the metrics per task and arm
// and the comparison of the arms. The kept folders are only read.
//
// The judge is paid: claude -p on the pinned judge model, or the command in EVAL_OUTCOME_JUDGE (a
// JSON list of arguments; the tests give a stub). --hidden-dir (or EVAL_OUTCOME_HIDDEN) points at
// another folder of score specs. --validate checks one score spec and exits.
//
// Ctrl-C, SIGTERM or SIGHUP: it finishes the run in hand (the modes it opened on a kept run come back
// as that copy ends), scores no more and writes no outcome.json. The handler only notes the signal,
// so the exit waits for the run in hand.
//
// Exit code: 0 — scored; 1 — no aggregate-result.json, a task without a valid score spec, a run that
// could not be scored or a check that could not tell (outcome.json lists them under problems; the
// rest is still scored); 2 — usage; 128 + the signal number — stopped by a signal.
import { existsSync } from 'node:fs'
import { constants } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { judgeCommand, loadSpec, scoreResults } from './eval-outcome-lib.mjs'
import { claudeBinary } from './eval-run-env.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const say = (line) => process.stdout.write(`eval:outcome-score: ${line}\n`)
const stop = (code, message) => {
  process.stderr.write(`eval:outcome-score: ${message}\n`)
  process.exit(code)
}

const args = process.argv.slice(2)
if (args[0] === '--validate') {
  if (!args[1]) stop(2, 'usage: eval-outcome-score.mjs --validate <hidden task dir>')
  try {
    loadSpec(resolve(args[1]))
  } catch (error) {
    stop(1, error.message)
  }
  say(`${join(resolve(args[1]), 'score.json')} is valid`)
  process.exit(0)
}

let resultsDir = null
let hiddenDir = process.env.EVAL_OUTCOME_HIDDEN || join(REPO, 'scripts', 'eval-outcome', 'hidden')
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--hidden-dir' && args[i + 1]) hiddenDir = args[++i]
  else if (!args[i].startsWith('-') && resultsDir === null) resultsDir = args[i]
  else stop(2, `unknown argument ${args[i]}; usage: eval-outcome-score.mjs <results dir> [--hidden-dir <dir>]`)
}
if (!resultsDir) stop(2, 'usage: eval-outcome-score.mjs <results dir> [--hidden-dir <dir>]')
if (!existsSync(join(resultsDir, 'aggregate-result.json'))) stop(1, `no aggregate-result.json in ${resultsDir}`)

let judge
try {
  judge = judgeCommand(process.env.EVAL_OUTCOME_JUDGE ? '' : claudeBinary(REPO, (message) => stop(1, message)))
} catch (error) {
  stop(2, error.message)
}
let signal = null
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(name, () => {
    signal ??= name
  })
}
const { problems, stopped } = await scoreResults({ resultsDir: resolve(resultsDir), hiddenDir: resolve(hiddenDir), judge, log: say, stopped: () => signal })
if (stopped) stop(128 + (constants.signals[stopped] ?? constants.signals.SIGTERM), `stopped by ${stopped}: no outcome.json written; score again to finish`)
say(join(resolve(resultsDir), 'outcome.json'))
if (problems.length > 0) stop(1, `not scored, or scored with checks that could not tell:\n${problems.join('\n')}`)
