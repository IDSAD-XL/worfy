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
//   doubt, test. windows-e2e runs whenever macos-e2e does. Both run only the spec files the diff
//   asks for (e2eSpecs: a changed spec file, the spec files scripts/e2e-specs.table.json gives a path
//   of src/ or harness/, every spec file for anything else), the outputs `e2e-files` (empty means
//   every spec file) and `macos-e2e-shards` / `windows-e2e-shards`: fewer shards for fewer files.
//   A push, a run by hand and a pull request that asks for every spec file get the full shards.
//   linux-tests and windows run on a pull request only the unit and contract test files its diff
//   touches: the output `tests-base` is the commit BASE names, and each of their jobs runs
//   `node scripts/affected-tests.mjs <tests-base> HEAD` after its install (that script needs the
//   dependencies; this one runs before them). Every other run — a push, a run by hand, a diff that
//   cannot be read, no file changed — leaves `tests-base` empty: the whole suite.
// - workflow_dispatch: JOB=check runs lint-typecheck and linux-tests, as the batch run of a Wave did
//   before CI ran on pull requests; JOB=full-macos runs lint-typecheck and the macOS jobs.
//
// The answer is also printed, with the files that decided it. `--darwin-tests` only prints the
// macOS-only test files (darwinTestFiles) of the working tree. Any other event or JOB is refused with
// exit code 1. Only Node's own modules and git are used: the script runs on the Node the runner
// image ships.

import { spawnSync } from 'node:child_process'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { listSpecs, readTimings } from './e2e-shard.mjs'

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
//   scripts electron-builder copies into the .app, and ci.yml where it packages the app or runs the
//   e2e tests (ciPackaging); windows-tests.yml and any other workflow package nothing;
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
  // Only when it changes what packages the app or runs the e2e tests: pullRequest drops it otherwise.
  '.github/workflows/ci.yml',
])
const BUILD_FOLDERS = ['build/']

/** A path whose change a pull request checks by packaging the app. */
const isBuildInput = (path) => BUILD_FILES.has(path) || BUILD_FOLDERS.some((folder) => path.startsWith(folder))

// The files a pull request runs the e2e tests for (the job macos-e2e, `pnpm test:e2e`): the build
// inputs above, the app (all of src/, card-runtime too: src/main serves it), the e2e tests, the files
// outside test/e2e that they import or read (test/contract/ci-workflow.test.ts checks that every
// such import is here, and every folder of test/fixtures they read: E2E_FIXTURES), the configs electron-vite builds with, the scripts the build and the job
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
  'scripts/e2e-shard.mjs',
  'test/harness-node.ts',
  'test/zsh.ts',
  'test/windows-profile.ts',
  'test/big-transcript.ts',
  'test/quarantine.ts',
  'test/flaky.ts',
  'test/time-scale.ts',
  'test/claude-home-legacy.ts',
])
// The folders of test/fixtures that the e2e tests and their helpers read. The others (eval-stub,
// sdk-messages, …) only unit and contract tests read: a pull request that changes one of them runs no
// e2e test.
const E2E_FIXTURES = ['agent-scripts', 'browser', 'claude-home', 'claude-home-legacy', 'e2e-shell', 'first-run-tools', 'gh', 'worfy-mvp-epic']
const APP_FOLDERS = ['src/', 'test/e2e/', 'test/quarantine/', ...E2E_FIXTURES.map((name) => `test/fixtures/${name}/`)]
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

// Which e2e spec files a pull request that changes the app runs (e2eSpecs), on macOS and Windows
// alike. Each app path of the diff decides in this order:
// - a spec file (test/e2e/**/*.spec.ts) runs itself; a deleted one asks for nothing;
// - a quarantine entry (test/quarantine/<id>.json) runs the spec file its `file` names, before the
//   change and after it: only a spec that calls quarantined('<id>') reads it. An entry of a vitest
//   test (`runner: "vitest"`) runs none. A deleted entry, one that cannot be read, and one that
//   names no spec file or one that does not exist run every spec file;
// - any other app path outside src/ and harness/ (a helper of test/e2e, a fixture folder the e2e
//   tests read, the Playwright config, a build input, package.json, a tsconfig) runs every spec
//   file: they reach every test;
// - a path of src/ or harness/ runs the spec files the table SPEC_TABLE gives it, the union over
//   every rule whose glob matches it; a path no rule matches runs every spec file.
// The table is a JSON file: {"rules": [{"paths": [<glob>], "specs": [<spec file>], "why": <text>}]},
// globs from the repository root, `**` any number of folders (none too), `*` any characters but `/`.
// It is kept small on purpose: a rule that leaves out a spec file which does check that code lets a
// regression through to the push to main, which runs every spec file. A table that cannot be read or
// holds a wrong rule, and a rule that names a spec file that does not exist, run every spec file.
export const SPEC_TABLE = 'scripts/e2e-specs.table.json'
// Full runs: the shards of the e2e jobs on a push to main and on a pull request that runs every spec
// file. macos-e2e splits by measured time (scripts/e2e-shard.mjs), windows-e2e with Playwright's
// --shard.
export const E2E_SHARDS = { 'macos-e2e': 1, 'windows-e2e': 4 }
const NARROWED = ['src/', 'harness/']
const SPEC_FILE = /^test\/e2e\/.+\.spec\.ts$/
const QUARANTINE_ENTRY = /^test\/quarantine\/[^/]+\.json$/

const escapeRegExp = (text) => text.replace(/[.+^${}()|[\]\\?]/g, '\\$&')

/** A glob of the table as a regular expression over the whole path (as in windows-verdict-scope.mjs). */
export function globRegExp(glob) {
  const source = glob
    .split('**/')
    .map((part) =>
      part
        .split('**')
        .map((piece) => piece.split('*').map(escapeRegExp).join('[^/]*'))
        .join('.*'),
    )
    .join('(?:.*/)?')
  return new RegExp(`^${source}$`)
}

/** The rules of the table in `root`, each with its globs as regular expressions. Throws an Error with a reason. */
export function readSpecTable(root) {
  const table = JSON.parse(readFileSync(resolve(root, SPEC_TABLE), 'utf8'))
  if (!Array.isArray(table?.rules)) throw new Error('no "rules" list')
  return table.rules.map((rule, at) => {
    const where = `rule ${at + 1}`
    const strings = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === 'string' && item !== '')
    if (!strings(rule?.paths)) throw new Error(`${where}: "paths" is not a list of globs`)
    if (!strings(rule.specs)) throw new Error(`${where}: "specs" is not a list of spec files`)
    const outside = rule.paths.find((glob) => !NARROWED.some((folder) => glob.startsWith(folder)))
    if (outside !== undefined) throw new Error(`${where}: ${outside} is outside ${NARROWED.join(' and ')}`)
    const odd = rule.specs.find((spec) => !SPEC_FILE.test(spec))
    if (odd !== undefined) throw new Error(`${where}: ${odd} is not a spec file under test/e2e`)
    return { paths: rule.paths, specs: rule.specs, matchers: rule.paths.map(globRegExp) }
  })
}

/**
 * The e2e spec files for the changed `paths` (only app paths count), given every spec file of the
 * tree (`specs`), the rules of the table (`rules`, or an Error when it cannot be read) and what a
 * quarantine entry names (`quarantined`: path → its spec files before and after the change, or null
 * when they cannot be told): { files: null } — every spec file; { files: [] } — none; otherwise the
 * files, sorted. `why` says what decided it.
 */
export function e2eSpecs(paths, specs, rules, quarantined = () => null) {
  const existing = new Set(specs)
  const files = new Set()
  for (const path of paths.filter(isAppPath)) {
    if (SPEC_FILE.test(path)) {
      if (existing.has(path)) files.add(path)
      continue
    }
    if (QUARANTINE_ENTRY.test(path)) {
      const named = quarantined(path)
      if (named === null) return { files: null, why: `${path} is gone, cannot be read or names no spec file` }
      const missing = named.find((spec) => !existing.has(spec))
      if (missing !== undefined) return { files: null, why: `${path} names ${missing}, which does not exist` }
      for (const spec of named) files.add(spec)
      continue
    }
    if (!NARROWED.some((folder) => path.startsWith(folder))) return { files: null, why: `${path} reaches every e2e test` }
    if (rules instanceof Error) return { files: null, why: `${SPEC_TABLE} cannot be read (${rules.message})` }
    const matched = rules.filter((rule) => rule.matchers.some((matcher) => matcher.test(path)))
    if (matched.length === 0) return { files: null, why: `${path} is not in ${SPEC_TABLE}` }
    for (const rule of matched) {
      const missing = rule.specs.find((spec) => !existing.has(spec))
      if (missing !== undefined) return { files: null, why: `${SPEC_TABLE} names ${missing}, which does not exist` }
      for (const spec of rule.specs) files.add(spec)
    }
  }
  const list = [...files].sort()
  return { files: list, why: list.length === 0 ? 'only deleted spec files' : `${list.length} spec files by ${SPEC_TABLE}` }
}

/**
 * The shards, `i/n`, of an e2e job that runs `files` (null: every spec file) where a full run has
 * `full` shards: as many as keep each shard to about the time of a full shard by `seconds` (spec
 * file → seconds; a file it does not know counts as the slowest), at least 1, never more than the
 * files.
 */
export function e2eShards(files, specs, seconds, full) {
  let count = full
  if (files !== null) {
    const known = Object.values(seconds)
    const slowest = known.length > 0 ? Math.max(...known) : 1
    const cost = (file) => (Object.hasOwn(seconds, file) ? seconds[file] : slowest)
    const all = specs.reduce((sum, file) => sum + cost(file), 0)
    const part = files.reduce((sum, file) => sum + cost(file), 0)
    count = Math.min(full, files.length, Math.max(1, Math.ceil((full * part) / (all || 1))))
  }
  return Array.from({ length: count }, (_, at) => `${at + 1}/${count}`)
}

// The job macos-tests on a pull request runs only the test files that check something on macOS that
// the Linux and Windows jobs do not: a test or a describe that runs on macOS only, or an assertion
// that differs there (darwinTestFiles). On the macOS runner they took 179 s of the 1131 s that all
// 462 files took (run 40744007856): the job ends in a few minutes instead of 11. It runs when the
// pull request changes the app (isAppPath), one of those files, the way vitest runs, or code under
// scripts/ or harness/, which those files check too (make-icons.test.ts runs scripts/make-icons.mjs
// with the real sips, harness-evals-run.test.ts the Harness evals with the git of macOS). The push to
// main runs the whole suite on macOS, and catches what an unguarded test finds only there.
const TEST_RUNNER = new Set(['vitest.config.ts', 'scripts/vitest-electron.mjs'])
// test/fixtures/ too: a fixture no e2e test reads is read by unit and contract tests, macOS-only ones
// among them (harness-evals-run.test.ts reads test/fixtures/eval-stub/).
const CHECKED_FOLDERS = ['scripts/', 'harness/', 'test/fixtures/']
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

// The CI workflow, and its parts that package the app or run the e2e tests: the job changes, which
// decides what they run, the jobs macos-e2e, macos-package and windows-e2e, and what comes before
// `jobs:` (the triggers, the env every job gets). A change of another job or of a comment does not
// ask for macos-package or for the e2e tests; a change of the job macos-tests asks for macos-tests.
const CI_WORKFLOW = '.github/workflows/ci.yml'
const PACKAGING_PARTS = ['', 'changes', 'macos-e2e', 'macos-package', 'windows-e2e']

// A job key under `jobs:`: two spaces, the name (bare or in quotes), a colon, then nothing, a
// comment or an anchor. A job written on one line (`name: {runs-on: …}`) is no key here: its body
// would not be read, so the job counts as not found.
const JOB_KEY = /^ {2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:(?:\s*(?:#.*|&\S+.*))?$/
// A value that starts a block scalar (`run: |`, `- run: >-`): the lines after it that are indented
// more than its key, blank lines among them, are data, `#` lines too.
const BLOCK_SCALAR = /:\s*[|>][-+0-9]*\s*(?:#.*)?$/
// An anchor (&name), an alias (*name) or a merge key (<<:) of YAML: one part can then change another.
const ANCHOR = /(?:^|[\s[{,])[&*][A-Za-z0-9_-]+(?=$|[\s,\]}])|^\s*(?:- )?<<\s*:/

/**
 * The parts of a workflow, read as text the way the contract tests read it (block style, one key per
 * line): `parts` — '' for the top-level keys but `jobs:`, and one part per job, each its lines
 * without comments and blank lines (but inside a block scalar); `anchored` — whether a line outside a
 * block scalar holds a YAML anchor, alias or merge key.
 */
export function workflowParts(text) {
  const parts = new Map([['', []]])
  let part = ''
  let inJobs = false
  let anchored = false
  // The indent of the key whose block scalar is being read; -1 outside one.
  let block = -1
  const endBlock = () => {
    const lines = parts.get(part)
    while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop()
    block = -1
  }
  for (const line of text.split(/\r?\n/)) {
    const indent = line.length - line.trimStart().length
    if (block >= 0) {
      if (line.trim() === '' || indent > block) {
        parts.get(part).push(line)
        continue
      }
      endBlock()
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (ANCHOR.test(line)) anchored = true
    if (indent === 0) {
      inJobs = /^jobs:\s*(?:#.*)?$/.test(line)
      part = ''
      if (inJobs) continue
    } else if (inJobs && indent === 2) {
      const job = JOB_KEY.exec(line)
      if (job) {
        part = job[1] ?? job[2] ?? job[3]
        parts.set(part, [])
        continue
      }
    }
    parts.get(part).push(line)
    // In `- run: |` the key is past the dash: the script is what is indented more than the key.
    if (BLOCK_SCALAR.test(line)) block = indent + (/^-\s+/.exec(line.trimStart())?.[0].length ?? 0)
  }
  if (block >= 0) endBlock()
  return { parts, anchored }
}

/** The text of `path` at the commit `ref` names, or null when git cannot show it. */
function fileAt(ref, path) {
  const shown = spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' })
  return shown.status === 0 ? shown.stdout : null
}

/**
 * The spec files the quarantine entry `path` names at `base` (when it is there) and at HEAD, or null
 * when HEAD has no such entry or one of them cannot be read or names no spec file. An entry of a
 * vitest test names none: it adds no spec file.
 */
function quarantinedSpecs(base, path) {
  const now = fileAt('HEAD', path)
  if (now === null) return null
  const before = fileAt(base, path)
  const specs = []
  for (const text of before === null ? [now] : [before, now]) {
    let entry
    try {
      entry = JSON.parse(text)
    } catch {
      return null
    }
    if (entry?.runner === 'vitest') continue
    const file = entry?.file
    if (typeof file !== 'string' || !SPEC_FILE.test(file)) return null
    specs.push(file)
  }
  return specs
}

/**
 * What a change of ci.yml between `base` and HEAD asks for: `packaging` — macos-package and every
 * e2e spec file, `macosTests` — macos-tests, and a `note` that names the parts. A ci.yml git cannot
 * show on either side (added, deleted, unreadable) asks for everything: when in doubt, test.
 */
function ciPackaging(base) {
  const before = fileAt(base, CI_WORKFLOW)
  const after = fileAt('HEAD', CI_WORKFLOW)
  if (before === null || after === null) return { packaging: true, macosTests: true, note: `${CI_WORKFLOW} changes what packages the app or runs the e2e tests (it is new, gone or unreadable)` }
  const [old, now] = [workflowParts(before), workflowParts(after)]
  const packaging = (why) => ({ packaging: true, macosTests: true, note: `${CI_WORKFLOW} changes what packages the app or runs the e2e tests (${why})` })
  if (old.anchored || now.anchored) return packaging('it uses YAML anchors or aliases, which tie its parts together')
  // A job this cannot find on one side: its lines went to another part, so no change of it shows.
  const missing = ['macos-tests', ...PACKAGING_PARTS].filter((name) => name !== '' && !(old.parts.has(name) && now.parts.has(name)))
  if (missing.length > 0) return packaging(missing.map((name) => `no job ${name} on both sides`).join(', '))
  const same = (name) => JSON.stringify(old.parts.get(name)) === JSON.stringify(now.parts.get(name))
  const changed = PACKAGING_PARTS.filter((name) => !same(name))
  const macosTests = !same('macos-tests')
  if (changed.length > 0) {
    const named = changed.map((name) => (name === '' ? 'the keys before jobs:' : `the job ${name}`)).join(', ')
    return { packaging: true, macosTests, note: `${CI_WORKFLOW} changes what packages the app or runs the e2e tests (${named})` }
  }
  return { packaging: false, macosTests, note: `${CI_WORKFLOW} changes nothing that packages the app or runs the e2e tests` }
}

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

/** The full name of the commit `ref` names, or '' when git cannot name it. */
function commitOf(ref) {
  const named = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' })
  return named.status === 0 ? named.stdout.trim() : ''
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
  const decided = pullRequest(code, code.includes(CI_WORKFLOW) ? ciPackaging(env.BASE) : null, env.BASE)
  const testsBase = commitOf(env.BASE)
  const tests = testsBase ? `linux-tests and windows run the test files the diff touches since ${testsBase}` : 'the base commit could not be named, so linux-tests and windows run every test file'
  return { expect: decided.expect, files: decided.files, e2e: decided.e2e, testsBase, tests, why: [why, ...decided.notes].join('; ') }
}

/**
 * The macOS jobs of a pull request that changes `all` code: each only when the diff asks for it.
 * `ci` says what a change of ci.yml asks for (ciPackaging), null when the diff leaves it alone.
 */
function pullRequest(all, ci, base) {
  const expect = only(JOBS)
  const notes = []
  // ci.yml is a build input and an app path only when it changes what packages the app or runs the
  // e2e tests; otherwise it asks for macos-tests at most, when its job macos-tests changed.
  const code = ci === null || ci.packaging ? all : all.filter((path) => path !== CI_WORKFLOW)
  if (ci !== null) notes.push(ci.note)
  if (!code.some(isBuildInput)) {
    expect['macos-package'] = false
    notes.push('no build input, so no macos-package')
  }
  let e2e = FULL_E2E
  if (!code.some(isAppPath)) {
    // windows-e2e runs the same e2e tests on Windows, so it follows macos-e2e.
    expect['macos-e2e'] = false
    expect['windows-e2e'] = false
    notes.push('no app path, so no macos-e2e and no windows-e2e')
  } else {
    e2e = pullRequestE2e(code, base)
    if (e2e.none) {
      expect['macos-e2e'] = false
      expect['windows-e2e'] = false
    }
  }
  const darwin = darwinTestFiles()
  if (darwin === null || darwin.length === 0) {
    // A test file the script cannot read or name plainly: when in doubt, the whole suite.
    notes.push('the macOS-only test files could not be listed, so macos-tests runs every file')
    return { expect, files: [], e2e, notes }
  }
  const checked = (path) => isAppPath(path) || TEST_RUNNER.has(path) || CHECKED_FOLDERS.some((folder) => path.startsWith(folder))
  if (!ci?.macosTests && !code.some((path) => checked(path) || darwin.includes(path))) {
    expect['macos-tests'] = false
    notes.push('no app path, script, Harness or macOS-only test file, so no macos-tests')
    return { expect, files: [], e2e, notes }
  }
  notes.push(`macos-tests runs the ${darwin.length} macOS-only test files`)
  return { expect, files: darwin, e2e, notes }
}

const fullShards = (job) => e2eShards(null, [], {}, E2E_SHARDS[job])
/** Every spec file, in the shards of a full run: a push, a run by hand, a pull request that asks for all. */
const FULL_E2E = { files: [], shards: { 'macos-e2e': fullShards('macos-e2e'), 'windows-e2e': fullShards('windows-e2e') } }

/** The e2e spec files and shards of a pull request that changes the app, read from the working tree. */
function pullRequestE2e(code, base) {
  const root = process.cwd()
  let specs
  let seconds
  try {
    specs = listSpecs(root)
    seconds = readTimings(root)
  } catch (error) {
    return { ...FULL_E2E, note: `the e2e spec files or their timings cannot be read (${error instanceof Error ? error.message : String(error)}), so every e2e spec file runs` }
  }
  let rules
  try {
    rules = readSpecTable(root)
  } catch (error) {
    rules = error instanceof Error ? error : new Error(String(error))
  }
  const chosen = e2eSpecs(code, specs, rules, (path) => quarantinedSpecs(base, path))
  if (chosen.files === null) return { ...FULL_E2E, note: `${chosen.why}, so every e2e spec file runs` }
  if (chosen.files.length === 0) return { ...FULL_E2E, none: true, note: `${chosen.why}, so no macos-e2e and no windows-e2e` }
  const shards = Object.fromEntries(Object.entries(E2E_SHARDS).map(([job, full]) => [job, e2eShards(chosen.files, specs, seconds, full)]))
  return { files: chosen.files, shards, note: `the e2e jobs run ${chosen.why}: ${chosen.files.join(' ')}` }
}

// `node scripts/ci-scope.mjs --darwin-tests` prints the macOS-only test files of the working tree,
// one per line (exit 1 when they cannot be listed): the contract test compares them with its own look.
function main() {
  const answer = process.argv[2] === '--darwin-tests' ? { darwin: darwinTestFiles() } : decide(process.env)
  if (answer.darwin !== undefined) {
    if (answer.darwin === null) process.exitCode = 1
    else process.stdout.write(answer.darwin.map((file) => `${file}\n`).join(''))
    return
  }
  if (answer.error) {
    process.stderr.write(`ci-scope: ${answer.error}\n`)
    process.exitCode = 1
    return
  }
  const e2e = answer.e2e ?? FULL_E2E
  const lines = [
    `expect=${JSON.stringify(answer.expect)}`,
    // The test files macos-tests hands to `pnpm test`; empty: every file.
    `macos-tests-files=${(answer.files ?? []).join(' ')}`,
    // The spec files macos-e2e and windows-e2e run, plain names separated by spaces; empty: every
    // spec file. And the shards of each job's matrix, a JSON list of `i/n`.
    `e2e-files=${e2e.files.join(' ')}`,
    `macos-e2e-shards=${JSON.stringify(e2e.shards['macos-e2e'])}`,
    `windows-e2e-shards=${JSON.stringify(e2e.shards['windows-e2e'])}`,
    // The base linux-tests and windows hand to scripts/affected-tests.mjs; empty: every test file.
    `tests-base=${answer.testsBase ?? ''}`,
  ].join('\n')
  // The e2e note of a pull request that changes the app, and the note on its unit and contract tests,
  // go on lines of their own.
  const note = `${answer.e2e?.note ? `e2e: ${answer.e2e.note}\n` : ''}${answer.tests ? `tests: ${answer.tests}\n` : ''}`
  process.stdout.write(`${answer.why}\n${note}${lines}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
