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
//   (HANDOFF.md, the lessons, Cyrillic in code) and it takes a minute. Otherwise a push to main runs
//   every job, the whole suite in each. A pull request runs the Linux and Windows jobs and only the
//   macOS jobs its diff asks for: the free plan runs 5 macOS jobs at a time, and pull requests
//   waited 26 to 67 minutes in that queue. macos-package runs when it changes a build input
//   (isBuildInput), macos-e2e when it changes the app (isAppPath, the Harness the app carries too),
//   macos-tests when it changes the app, scripts/, harness/ or a macOS-only test file, and then with
//   the macOS-only test files alone (darwinTestFiles,
//   the second output `macos-tests-files`; empty means every file). A diff that cannot be read, a
//   BASE of zeros (a new branch) and an empty diff run every job, the whole suite in each: when in
//   doubt, test. windows-e2e runs whenever macos-e2e does.
// - workflow_dispatch: JOB=check runs lint-typecheck and linux-tests, as the batch run of a Wave did
//   before CI ran on pull requests; JOB=full-macos runs lint-typecheck and the macOS jobs.
//
// The answer is also printed, with the files that decided it. `--darwin-tests` only prints the
// macOS-only test files (darwinTestFiles) of the working tree. Any other event or JOB is refused with
// exit code 1. Only Node's own modules and git are used: the script runs on the Node the runner
// image ships.

import { spawnSync } from 'node:child_process'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { sep } from 'node:path'
import process from 'node:process'

const JOBS = ['lint-typecheck', 'linux-tests', 'macos-tests', 'macos-e2e', 'macos-package', 'windows', 'windows-e2e']
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

// The files a pull request runs the e2e tests for (the job macos-e2e, `pnpm test:e2e`): the build
// inputs above, the app (all of src/, card-runtime too: src/main serves it), the e2e tests, the files
// outside test/e2e that they import or read (test/contract/ci-workflow.test.ts checks that every
// such import is here), the configs electron-vite builds with, the scripts the build and the job
// run, and harness/: the build copies it to out/harness, the app ships and reads that copy, and e2e
// tests (harness-install, harness-migrate, first-run, projects-connect) run it. The parts of harness/
// the build leaves out (HARNESS_NOT_BUNDLED, the same list as in electron.vite.config.ts) are not the
// app. A change of test/unit or test/contract, of another script or of a document runs no e2e on a
// pull request: the push to main runs them all, and catches it there.
const APP_FILES = new Set([
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'scripts/dev-bundle.ts',
  'scripts/ci-display.js',
  'test/harness-node.ts',
  'test/zsh.ts',
  'test/windows-profile.ts',
  'test/big-transcript.ts',
  'test/quarantine.ts',
  'test/flaky.ts',
  'test/claude-home-legacy.ts',
])
const APP_FOLDERS = ['src/', 'test/e2e/', 'test/fixtures/', 'test/quarantine/']
// test/contract/ci-workflow.test.ts checks that this is HARNESS_NOT_BUNDLED of electron.vite.config.ts.
const HARNESS_NOT_BUNDLED = ['bin/tests', 'hooks/tests', 'evals', 'evals-outcome']

/** A path of harness/ that the build copies into the app. */
function isBundledHarness(path) {
  if (!path.startsWith('harness/')) return false
  const inside = path.slice('harness/'.length)
  return !HARNESS_NOT_BUNDLED.some((dir) => inside === dir || inside.startsWith(`${dir}/`))
}

/** A path whose change a pull request checks with the e2e tests on macOS. */
const isAppPath = (path) =>
  isBuildInput(path) || APP_FILES.has(path) || APP_FOLDERS.some((folder) => path.startsWith(folder)) || isBundledHarness(path)

// The job macos-tests on a pull request runs only the test files that check something on macOS that
// the Linux and Windows jobs do not: a test or a describe that runs on macOS only, or an assertion
// that differs there (darwinTestFiles). On the macOS runner they took 179 s of the 1131 s that all
// 462 files took (run 40744007856): the job ends in a few minutes instead of 11. It runs when the
// pull request changes the app (isAppPath), one of those files, the way vitest runs, or code under
// scripts/ or harness/, which those files check too (make-icons.test.ts runs scripts/make-icons.mjs
// with the real sips, harness-evals.test.ts the Harness evals with the git of macOS). The push to
// main runs the whole suite on macOS, and catches what an unguarded test finds only there.
const TEST_RUNNER = new Set(['vitest.config.ts', 'scripts/vitest-electron.mjs'])
const CHECKED_FOLDERS = ['scripts/', 'harness/']
const TEST_FOLDERS = ['test/unit/', 'test/contract/']
// The guard of a test that runs on macOS only, or of an assertion that differs there:
// `process.platform === 'darwin'`, `!== "darwin"`, `platform() === 'darwin'`, `'darwin' ===
// process.platform` and `case 'darwin'`. test/contract/ci-workflow.test.ts fails on a test file that
// guards on macOS another way (an imported isMac in skipIf or runIf).
const DARWIN_GUARD = /platform(\(\))?\s*[!=]==?\s*['"]darwin['"]|['"]darwin['"]\s*[!=]==?\s*[\w.]*platform\b|case\s+['"]darwin['"]/
// The names the job hands to `pnpm test` unquoted, one word each.
const PLAIN_NAME = /^test\/(unit|contract)\/[A-Za-z0-9._-]+\.test\.tsx?$/

/** The test files of vitest that hold a darwin guard, or null when one cannot be read or named plainly. */
function darwinTestFiles() {
  const files = []
  for (const folder of TEST_FOLDERS) {
    let names
    try {
      names = readdirSync(folder, { recursive: true, encoding: 'utf8' })
    } catch {
      return null
    }
    for (const name of names.sort()) {
      const path = `${folder}${name.split(sep).join('/')}`
      if (!/\.test\.tsx?$/.test(path)) continue
      let text
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        return null
      }
      if (!DARWIN_GUARD.test(text)) continue
      if (!PLAIN_NAME.test(path)) return null
      files.push(path)
    }
  }
  return files
}

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
  if (event === 'push') return { expect: only(JOBS), why }
  const decided = pullRequest(code)
  return { expect: decided.expect, files: decided.files, why: [why, ...decided.notes].join('; ') }
}

/** The macOS jobs of a pull request that changes code: each only when the diff asks for it. */
function pullRequest(code) {
  const expect = only(JOBS)
  const notes = []
  if (!code.some(isBuildInput)) {
    expect['macos-package'] = false
    notes.push('no build input, so no macos-package')
  }
  if (!code.some(isAppPath)) {
    // windows-e2e runs the same e2e tests on Windows, so it follows macos-e2e.
    expect['macos-e2e'] = false
    expect['windows-e2e'] = false
    notes.push('no app path, so no macos-e2e and no windows-e2e')
  }
  const darwin = darwinTestFiles()
  if (darwin === null || darwin.length === 0) {
    // A test file the script cannot read or name plainly: when in doubt, the whole suite.
    notes.push('the macOS-only test files could not be listed, so macos-tests runs every file')
    return { expect, files: [], notes }
  }
  const checked = (path) => isAppPath(path) || TEST_RUNNER.has(path) || CHECKED_FOLDERS.some((folder) => path.startsWith(folder))
  if (!code.some((path) => checked(path) || darwin.includes(path))) {
    expect['macos-tests'] = false
    notes.push('no app path, script, Harness or macOS-only test file, so no macos-tests')
    return { expect, files: [], notes }
  }
  notes.push(`macos-tests runs the ${darwin.length} macOS-only test files`)
  return { expect, files: darwin, notes }
}

// `node scripts/ci-scope.mjs --darwin-tests` prints the macOS-only test files of the working tree,
// one per line (exit 1 when they cannot be listed): the contract test compares them with its own look.
const answer = process.argv[2] === '--darwin-tests' ? { darwin: darwinTestFiles() } : decide(process.env)
if (answer.darwin !== undefined) {
  if (answer.darwin === null) process.exitCode = 1
  else process.stdout.write(answer.darwin.map((file) => `${file}\n`).join(''))
} else if (answer.error) {
  process.stderr.write(`ci-scope: ${answer.error}\n`)
  process.exitCode = 1
} else {
  const expect = JSON.stringify(answer.expect)
  // The test files macos-tests hands to `pnpm test`; empty: every file.
  const files = (answer.files ?? []).join(' ')
  process.stdout.write(`${answer.why}\nexpect=${expect}\nmacos-tests-files=${files}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `expect=${expect}\nmacos-tests-files=${files}\n`)
}
