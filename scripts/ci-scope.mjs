#!/usr/bin/env node
// Decides which jobs of the CI workflow (.github/workflows/ci.yml) a run needs, before anything is
// installed:
//
//   EVENT=<github.event_name> JOB=<input "job"> BASE=<commit> node scripts/ci-scope.mjs
//
// The answer is the step output `expect`: a JSON object with one key per job of ci.yml — but for
// `changes`, the job that runs this script, and `ci-ok`, the job that reads the answer — and `true`
// for each job the run needs. The jobs run on `fromJSON(needs.changes.outputs.expect)['<job>']`, and
// ci-ok (scripts/ci-ok.mjs) holds every job to it: a job the run needs must succeed, any other must
// be skipped. A job added to ci.yml without a key here turns ci-ok red.
//
// - pull_request and push: the files that differ between BASE and HEAD. When every one of them is a
//   document (isDocument), only lint-typecheck runs: lint is the check that reads documents
//   (HANDOFF.md, the lessons, Cyrillic in code) and it takes a minute. Otherwise every job runs.
//   A diff that cannot be read, a BASE of zeros (a new branch) and an empty diff run every job too:
//   when in doubt, test.
// - workflow_dispatch: JOB=check runs lint-typecheck and linux-tests, as the batch run of a Wave did
//   before CI ran on pull requests; JOB=full-macos runs lint-typecheck and the macOS jobs.
//
// The answer is also printed, with the files that decided it. Any other event or JOB is refused with
// exit code 1. Only Node's own modules and git are used: the script runs on the Node the runner
// image ships.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const JOBS = ['lint-typecheck', 'linux-tests', 'macos-tests', 'macos-e2e', 'macos-package', 'windows']
const MACOS = ['macos-tests', 'macos-e2e', 'macos-package']

// Documents that a test reads from the repository: a change to one of them runs the tests.
// test/contract/node-version.test.ts reads README.md; test/unit/check-lessons.test.ts reads the
// lessons index.
const READ_BY_TESTS = new Set(['README.md', 'docs/lessons/README.md'])
const CODE_FOLDERS = ['src/', 'test/', 'harness/']

/** A path (from the repository root, forward slashes) whose change needs no test run. */
function isDocument(path) {
  if (READ_BY_TESTS.has(path)) return false
  if (path.startsWith('.scratch/') || path.startsWith('docs/')) return true
  return path.endsWith('.md') && !CODE_FOLDERS.some((folder) => path.startsWith(folder))
}

const only = (names) => Object.fromEntries(JOBS.map((name) => [name, names.includes(name)]))

/** The files changed between `base` and HEAD, or null when git cannot tell. */
function changedFiles(base) {
  if (!base || /^0+$/.test(base)) return null
  const git = (...args) => spawnSync('git', args, { encoding: 'utf8' })
  // A push names the commit main was at; a shallow checkout does not have it yet.
  if (git('cat-file', '-e', `${base}^{commit}`).status !== 0) git('fetch', '--no-tags', '--depth=1', 'origin', base)
  const diff = git('diff', '--name-only', '--no-renames', base, 'HEAD')
  if (diff.status !== 0) return null
  return diff.stdout.split('\n').filter((line) => line !== '')
}

function decide(env) {
  const event = env.EVENT ?? ''
  if (event === 'workflow_dispatch') {
    if (env.JOB === 'check') return { expect: only(['lint-typecheck', 'linux-tests']), why: 'dispatch, job check' }
    if (env.JOB === 'full-macos') return { expect: only(['lint-typecheck', ...MACOS]), why: 'dispatch, job full-macos' }
    return { error: `workflow_dispatch with job ${JSON.stringify(env.JOB ?? '')}: expected check or full-macos` }
  }
  if (event !== 'pull_request' && event !== 'push') return { error: `event ${JSON.stringify(event)}: expected pull_request, push or workflow_dispatch` }
  const files = changedFiles(env.BASE ?? '')
  if (files === null) return { expect: only(JOBS), why: `the files changed since ${JSON.stringify(env.BASE ?? '')} could not be read` }
  if (files.length === 0) return { expect: only(JOBS), why: 'no file changed' }
  const code = files.filter((file) => !isDocument(file))
  if (code.length === 0) return { expect: only(['lint-typecheck']), why: `documents only: ${files.join(' ')}` }
  return { expect: only(JOBS), why: `code changed: ${code.slice(0, 20).join(' ')}${code.length > 20 ? ` and ${code.length - 20} more` : ''}` }
}

const answer = decide(process.env)
if (answer.error) {
  process.stderr.write(`ci-scope: ${answer.error}\n`)
  process.exitCode = 1
} else {
  const expect = JSON.stringify(answer.expect)
  process.stdout.write(`${answer.why}\nexpect=${expect}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `expect=${expect}\n`)
}
