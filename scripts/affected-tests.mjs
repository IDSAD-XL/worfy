#!/usr/bin/env node
// Which unit and contract test files a change touches:
//
//   node scripts/affected-tests.mjs <base> <head> [--json]
//
// The changed files are `git diff --name-only --no-renames <base>...<head>`: what the head changed
// since it left the base, a renamed file under both names. Run it in a checkout of <head>: the module
// graph is read from the working tree, so the script refuses (exit code 2) when the tree of HEAD is
// not the tree of <head>.
//
// Each changed file is looked at in this order:
//
// 1. A path of `all` in scripts/affected-tests.table.json (the configuration of the test run,
//    package.json, the lockfile, the setup files): the answer is ALL, the whole suite.
// 2. A test file of the run (test/unit/, test/contract/): it is in the list, always.
// 3. The rows of the table that match the path: the files they name. A named test file goes in as it
//    is; any other named file is a module, and the tests that import it, directly or not, go in. The
//    rows hold what the import graph cannot see: a script a test starts as a process, a file a test or
//    a module reads as text. `links` is written by hand in the table. The generated rows — what each
//    test file or helper reads by path (`reads`) or looks through (`scans`) — are built from the test
//    sources of the working tree on every run (generate() of scripts/affected-tests-table.mjs) and
//    never committed: a committed copy goes stale when a pull request that splits, adds or renames a
//    test file merges next to another one, each green on its own base.
// 4. A module (.ts, .tsx, .js, .mjs, .cjs, .css…): the test files that import it, directly or not,
//    by vite's module graph, as `vitest related` computes it.
//
// A row covers the path unless it is a scan (`"scan": true` in `links`, `scans` of a generated row): a
// test that reads every file of a folder looking for one thing, which adds itself to the list but does
// not stand for the tests of the file. A file that nothing covers is ALL, never an empty list:
// - a module outside src/ and test/ that no test imports and no covering row names;
// - a deleted module, anywhere: the graph of <head> no longer knows who imported it;
// - a file of any other kind (a shell script, YAML, JSON, an image, Markdown under src/, test/,
//   harness/ or scripts/) that no covering row names.
// Covered with no tests of their own: a module under src/ or test/ that no test imports, Markdown
// outside those folders, the paths of `none`, and a deleted test file. A Markdown-only change outside
// them selects only the tests that read that file.
//
// Output: ALL, or the selected files one per line, sorted, as paths from the repository root; nothing
// for an empty list. With --json one object: {"all": boolean, "files": [...], "reasons": [...]},
// `reasons` naming each file that made the answer ALL. Exit code 0 for an answer; 2 for wrong
// arguments, a git error, a working tree that is not <head>, or a table that cannot be read (one that
// still holds a committed `generated` part included).
//
// With --github-output the answer also goes to the file $GITHUB_OUTPUT, for the test jobs of CI
// (.github/workflows/ci.yml and windows-tests.yml): `run` is `all`, `none` or `some`, and `files` the
// selected files separated by spaces (empty unless `run` is `some`). A selected name with white space
// in it could not be split back into one file, so such an answer is `all`.
//
// The graph comes from vitest's own API, run on the vitest configuration of the working tree, so it
// resolves imports as the test run does. Loading that configuration runs what it runs before each
// `pnpm test` (the removal of a killed run's leftovers, vitest.config.ts). It runs under plain Node;
// no test is started.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import process from 'node:process'
import { generate } from './affected-tests-table.mjs'

const USAGE = 'usage: node scripts/affected-tests.mjs <base> <head> [--json] [--github-output]'
const FLAGS = ['--json', '--github-output']
// With forward slashes on every platform: it is also how the messages name it.
const TABLE = 'scripts/affected-tests.table.json'
// What vite's module graph follows from a test file. A file of another kind never shows up in it.
const MODULE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/
// Modules under these folders reach the tests only through imports (or a `links` entry): one that no
// test imports is covered with no tests. Any other module that no test imports is ALL.
const IMPORT_ONLY = ['src/', 'test/']
// Folders whose Markdown tests read (skills, fixtures, the eval READMEs): there it is a file like any other.
const CODE_FOLDERS = ['src/', 'test/', 'harness/', 'scripts/']

class Refusal extends Error {}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const text = String(error.stderr ?? error.message).trim()
    throw new Refusal(`git ${args.join(' ')} failed: ${text}`)
  }
}

function parseArgs(argv) {
  const rest = argv.filter((arg) => !FLAGS.includes(arg))
  if (rest.length !== 2 || rest.some((arg) => arg.startsWith('-'))) throw new Refusal(USAGE)
  const githubOutput = argv.includes('--github-output')
  if (githubOutput && !process.env.GITHUB_OUTPUT) throw new Refusal('--github-output: GITHUB_OUTPUT is not set')
  return { base: rest[0], head: rest[1], json: argv.includes('--json'), githubOutput }
}

/**
 * The table, its three lists checked for shape (a wrong table must not read as "no links"), and the
 * generated rows of the tree at `root`.
 */
function readTable(root) {
  let table
  try {
    table = JSON.parse(readFileSync(join(root, TABLE), 'utf8'))
  } catch (error) {
    throw new Refusal(`cannot read ${TABLE}: ${error.message}`)
  }
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
  const entries = (name, withFiles) => {
    const list = table?.[name]
    if (!Array.isArray(list) || !list.every((entry) => strings(entry?.paths) && (!withFiles || strings(entry.files)))) {
      throw new Refusal(`${TABLE}: "${name}" must be a list of {"paths": [...]${withFiles ? ', "files": [...]' : ''}}`)
    }
    return list
  }
  // A committed copy would be read in place of the sources, or next to them, and go stale again.
  if (table && Object.hasOwn(table, 'generated')) throw new Refusal(`${TABLE}: "generated" is built from the test sources on every run; remove it from the table`)
  const generated = generate(root)
  // A generated path is a file or a folder: the row matches the file and everything under the folder.
  const rows = (paths) => paths.flatMap((path) => [path, `${path}/**`])
  const links = [
    ...entries('links', true),
    ...generated.flatMap((entry) => [
      ...(entry.reads ? [{ paths: rows(entry.reads), files: [entry.file] }] : []),
      ...(entry.scans ? [{ paths: rows(entry.scans), files: [entry.file], scan: true }] : []),
    ]),
  ]
  return { all: entries('all', false), none: entries('none', false), links }
}

const matches = (path, entry) => entry.paths.some((pattern) => posix.matchesGlob(path, pattern))

/**
 * What the changed files that are not in `all` select without the graph, and what the graph has to
 * answer. `testFiles` is every test file of the run; `exists` tells whether a path is a file of the
 * working tree. A reason is a file that makes the answer ALL.
 */
function classify(changed, table, testFiles, isTestPath, exists) {
  const reasons = []
  const files = new Set()
  // Modules whose importers go in: the changed modules and the modules the table names.
  const related = new Set()
  // Changed modules that only count as covered when at least one test imports them.
  const mustHaveImporters = []
  for (const path of changed) {
    // A test file goes in itself, and its links too: a test that reads other test files as text
    // (a scan for a forbidden call) has to see the new one.
    const test = testFiles.has(path)
    if (test) files.add(path)
    const gone = !exists(path)
    const links = table.links.filter((entry) => matches(path, entry))
    for (const named of links.flatMap((entry) => entry.files)) {
      if (testFiles.has(named)) files.add(named)
      else if (exists(named)) related.add(named)
      else reasons.push(`${path}: ${TABLE} names ${named}, which is not a file`)
    }
    const module = MODULE.test(path)
    if (test || (gone && isTestPath(path))) continue
    if (module && gone) {
      reasons.push(`${path}: a deleted module — the graph of the head no longer knows who imported it`)
      continue
    }
    if (module) related.add(path)
    const markdown = path.endsWith('.md') && !CODE_FOLDERS.some((folder) => path.startsWith(folder))
    if (links.some((entry) => !entry.scan) || markdown || table.none.some((entry) => matches(path, entry))) continue
    if (module && IMPORT_ONLY.some((folder) => path.startsWith(folder))) continue
    if (module) mustHaveImporters.push(path)
    else reasons.push(`${path}: neither the module graph nor ${TABLE} covers it`)
  }
  return { reasons, files, related, mustHaveImporters }
}

/** The vitest of this repository, set up on `root` to answer graph queries. */
async function openGraph(root) {
  // vitest/node from the folder of this script: the repository's own vitest.
  const { createVitest } = await import('vitest/node')
  // vitest.config.ts leaves out the files a Windows CI shard runs in a job of its own; the answer is
  // about the whole suite.
  delete process.env.WORFY_TEST_EXCLUDE
  const vitest = await createVitest('test', { root, watch: false, run: true, reporters: [] })
  // Paths as vitest spells them, with forward slashes on Windows too: config.related is compared
  // with the module graph's own ids as it is, so it must be spelled the same way.
  const viteRoot = vitest.config.root
  const specs = await vitest.specifications.globTestSpecifications()
  const rel = (file) => posix.relative(viteRoot, file.split(sep).join('/'))
  const testFiles = new Set(specs.map((spec) => rel(spec.moduleId)))
  /** The test files that import one of `modules`, directly or not. */
  const importers = async (modules) => {
    vitest.config.related = modules.map((module) => posix.join(viteRoot, module))
    const found = await vitest.specifications.getRelevantTestSpecifications()
    return new Set(found.map((spec) => rel(spec.moduleId)))
  }
  /**
   * Whether `path` is where a test file of the run would be: true for a deleted one too. Matched
   * here rather than with project.matchesTestGlob, which adds a matching path to the project's
   * cached list of test files: the next graph query then loads a deleted test file from that list
   * and fails ("Failed to load url … Does the file exist?").
   */
  const isTestPath = (path) => vitest.projects.some(({ config }) => {
    const dir = (config.dir || config.root).split(sep).join('/')
    const file = posix.relative(dir, posix.join(viteRoot, path))
    const glob = (patterns) => patterns.some((pattern) => posix.matchesGlob(file, pattern))
    return glob(config.include) && !glob(config.exclude)
  })
  return { testFiles, isTestPath, importers, close: () => vitest.close() }
}

async function main() {
  const { base, head, json, githubOutput } = parseArgs(process.argv.slice(2))
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  const headTree = git(root, ['rev-parse', '--verify', '--end-of-options', `${head}^{tree}`]).trim()
  const workTree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']).trim()
  if (headTree !== workTree) throw new Refusal(`the working tree is not ${head}: check out ${head} first, the module graph is read from it`)
  const changed = git(root, ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--']).split('\0').filter(Boolean)
  const table = readTable(root)
  const exists = (path) => existsSync(join(root, path))

  let answer
  // A file of `all` decides alone, and needs no graph.
  const wholeRun = changed.filter((path) => table.all.some((entry) => matches(path, entry)))
  if (wholeRun.length > 0) answer = { all: true, files: [], reasons: wholeRun.map((path) => `${path}: changes the whole test run`) }
  else if (changed.length === 0) answer = { all: false, files: [], reasons: [] }
  else {
    const graph = await openGraph(root)
    try {
      const { reasons, files, related, mustHaveImporters } = classify(changed, table, graph.testFiles, graph.isTestPath, exists)
      if (related.size > 0) for (const file of await graph.importers([...related])) files.add(file)
      for (const module of mustHaveImporters) {
        if ((await graph.importers([module])).size === 0) reasons.push(`${module}: no test imports it and ${TABLE} has no link for it`)
      }
      answer = reasons.length > 0 ? { all: true, files: [], reasons } : { all: false, files: [...files].sort(), reasons: [] }
    } finally {
      await graph.close()
    }
  }

  if (json) process.stdout.write(`${JSON.stringify(answer)}\n`)
  else if (answer.all) process.stdout.write('ALL\n')
  else if (answer.files.length > 0) process.stdout.write(`${answer.files.join('\n')}\n`)
  if (!json) for (const line of answer.reasons) process.stderr.write(`affected-tests: ${line}\n`)
  if (githubOutput) appendFileSync(process.env.GITHUB_OUTPUT, githubLines(answer))
}

/** The answer as step outputs: `run` (all, none or some) and `files`, separated by spaces. */
function githubLines(answer) {
  const odd = answer.files.find((file) => /\s/.test(file))
  if (odd !== undefined) process.stderr.write(`affected-tests: ${JSON.stringify(odd)} has white space in its name, so the whole suite runs\n`)
  const run = answer.all || odd !== undefined ? 'all' : answer.files.length === 0 ? 'none' : 'some'
  return `run=${run}\nfiles=${run === 'some' ? answer.files.join(' ') : ''}\n`
}

main().catch((error) => {
  process.stderr.write(`affected-tests: ${error instanceof Refusal ? error.message : (error?.stack ?? String(error))}\n`)
  process.exitCode = 2
})
