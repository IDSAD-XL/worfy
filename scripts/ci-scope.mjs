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
//   (HANDOFF.md, the lessons, Cyrillic in code) and it takes a minute. Otherwise every job runs,
//   but for macos-package on a pull request that changes no build input (isBuildInput): the free
//   plan runs 5 macOS jobs at a time, and a pull request that asked for 5 waited hours for them. A
//   push to main packages the app whatever it changed. A diff that cannot be read, a BASE of zeros
//   (a new branch) and an empty diff run every job too: when in doubt, test.
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

// Folders whose every file counts as code, Markdown included: the app, the tests, the Harness, the
// scripts and the design spec. Tests read Markdown from them: test/contract/harness-evals-outcome.test.ts
// reads scripts/eval-outcome/README.md, test/unit/kind-tokens.test.ts reads docs/design/F-SPEC.md.
const CODE_FOLDERS = ['src/', 'test/', 'harness/', 'scripts/', 'docs/design/']
// Single documents outside those folders that a test reads: test/contract/node-version.test.ts reads
// README.md, test/unit/check-lessons.test.ts the lessons index.
const READ_BY_TESTS = new Set(['README.md', 'docs/lessons/README.md'])

/** A path (from the repository root, forward slashes) whose change needs no test run. */
function isDocument(path) {
  if (READ_BY_TESTS.has(path) || CODE_FOLDERS.some((folder) => path.startsWith(folder))) return false
  return path.startsWith('.scratch/') || path.startsWith('docs/') || path.endsWith('.md')
}

// The files a pull request packages the app for (the job macos-package, `pnpm test:package`), two
// kinds of them:
// - build inputs: the dependencies and their install (postinstall rebuilds node-pty for Electron),
//   the configs of the build and of electron-builder, the build version, the icons in build/, the
//   scripts electron-builder copies into the .app, and the workflows;
// - the files the @packaged tests read that no other job checks: their spec files (packaged.spec.ts,
//   and terminal.spec.ts with its test of node-pty from app.asar.unpacked), the helpers that find
//   the packaged app, scripts/install-stable.mjs, which they install, and the Playwright config.
// A change of src/main, harness/ or anything else that matters only in the packaged app is not on
// this list: the push to main packages the app whatever it changed, and catches it there.
const BUILD_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'electron-builder.yml',
  'electron.vite.config.ts',
  'scripts/build-version.ts',
  'scripts/postinstall.mjs',
  'scripts/statusline-bridge.sh',
  'scripts/statusline-bridge.mjs',
  'scripts/install-stable.mjs',
  'playwright.config.ts',
  'test/e2e/packaged.spec.ts',
  'test/e2e/terminal.spec.ts',
  'test/e2e/helpers.ts',
])
const BUILD_FOLDERS = ['build/', '.github/workflows/']

/** A path whose change a pull request checks by packaging the app. */
const isBuildInput = (path) => BUILD_FILES.has(path) || BUILD_FOLDERS.some((folder) => path.startsWith(folder))

const only = (names) => Object.fromEntries(JOBS.map((name) => [name, names.includes(name)]))

/** The files changed between `base` and HEAD, or null when git cannot tell. */
function changedFiles(base) {
  if (!base || /^0+$/.test(base)) return null
  const git = (...args) => spawnSync('git', args, { encoding: 'utf8' })
  // A push names the commit main was at; a shallow checkout does not have it yet.
  if (git('cat-file', '-e', `${base}^{commit}`).status !== 0) git('fetch', '--no-tags', '--depth=1', 'origin', base)
  // -z: NUL after each path, and no path is quoted. Without it git (core.quotePath, on by default)
  // prints a path with non-ASCII bytes, a double quote or a control character as an escaped string
  // in quotes, and a ticket file with a Cyrillic name no longer starts with .scratch/.
  const diff = git('diff', '--name-only', '-z', '--no-renames', base, 'HEAD')
  if (diff.status !== 0) return null
  return diff.stdout.split('\0').filter((path) => path !== '')
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
  const why = `code changed: ${code.slice(0, 20).join(' ')}${code.length > 20 ? ` and ${code.length - 20} more` : ''}`
  if (event === 'pull_request' && !code.some(isBuildInput)) return { expect: only(JOBS.filter((name) => name !== 'macos-package')), why: `${why}; no build input, so no macos-package` }
  return { expect: only(JOBS), why }
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
