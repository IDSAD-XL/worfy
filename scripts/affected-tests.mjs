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
// 3. A path of a `links` entry: the files the entry names. A named test file goes in as it is; any
//    other named file is a module, and the tests that import it, directly or not, go in. The table
//    holds what the import graph cannot see: a script a test starts as a process, a file a test or a
//    module reads as text.
// 4. A module (.ts, .tsx, .js, .mjs, .cjs, .css…): the test files that import it, directly or not,
//    by vite's module graph, as `vitest related` computes it.
//
// A file that none of this covers is ALL, never an empty list: a module outside src/ and test/ that no
// test imports and no `links` entry names, a file of any other kind (a shell script, YAML, JSON, an
// image) that no `links` entry names. Markdown (*.md) and the paths of `none` in the table are covered
// with no tests: an md-only change selects nothing. A module under src/ or test/ that no test imports
// is covered with no tests too.
//
// Output: ALL, or the selected files one per line, sorted, as paths from the repository root; nothing
// for an empty list. With --json one object: {"all": boolean, "files": [...], "reasons": [...]},
// `reasons` naming each file that made the answer ALL. Exit code 0 for an answer; 2 for wrong
// arguments, a git error, a working tree that is not <head>, or a table that cannot be read.
//
// The graph comes from vitest's own API, run on the vitest configuration of the working tree, so it
// resolves imports as the test run does. Loading that configuration runs what it runs before each
// `pnpm test` (the removal of a killed run's leftovers, vitest.config.ts). It runs under plain Node;
// no test is started.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import process from 'node:process'

const USAGE = 'usage: node scripts/affected-tests.mjs <base> <head> [--json]'
// With forward slashes on every platform: it is also how the messages name it.
const TABLE = 'scripts/affected-tests.table.json'
// What vite's module graph follows from a test file. A file of another kind never shows up in it.
const MODULE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/
// Modules under these folders reach the tests only through imports (or a `links` entry): one that no
// test imports is covered with no tests. Any other module that no test imports is ALL.
const IMPORT_ONLY = ['src/', 'test/']

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
  const json = argv.includes('--json')
  const rest = argv.filter((arg) => arg !== '--json')
  if (rest.length !== 2 || rest.some((arg) => arg.startsWith('-'))) throw new Refusal(USAGE)
  return { base: rest[0], head: rest[1], json }
}

/** The table, its three lists checked for shape: a wrong table must not read as "no links". */
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
  return { all: entries('all', false), none: entries('none', false), links: entries('links', true) }
}

const matches = (path, entry) => entry.paths.some((pattern) => posix.matchesGlob(path, pattern))

/**
 * What the changed files that are not in `all` select without the graph, and what the graph has to
 * answer. `testFiles` is every test file of the run; `exists` tells whether a path is a file of the
 * working tree. A reason is a file that makes the answer ALL.
 */
function classify(changed, table, testFiles, exists) {
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
    const links = table.links.filter((entry) => matches(path, entry))
    for (const named of links.flatMap((entry) => entry.files)) {
      if (testFiles.has(named)) files.add(named)
      else if (exists(named)) related.add(named)
      else reasons.push(`${path}: ${TABLE} names ${named}, which is not a file`)
    }
    const module = MODULE.test(path)
    if (module && exists(path) && !test) related.add(path)
    if (test || links.length > 0 || path.endsWith('.md') || table.none.some((entry) => matches(path, entry))) continue
    if (module && IMPORT_ONLY.some((folder) => path.startsWith(folder))) continue
    if (module && exists(path)) mustHaveImporters.push(path)
    else reasons.push(`${path}: neither the module graph nor ${TABLE} covers it`)
  }
  return { reasons, files, related, mustHaveImporters }
}

/** The vitest of this repository, set up on `root` to answer graph queries. */
async function openGraph(root) {
  // vitest/node from the folder of this script: the repository's own vitest.
  const { createVitest } = await import('vitest/node')
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
  return { testFiles, importers, close: () => vitest.close() }
}

async function main() {
  const { base, head, json } = parseArgs(process.argv.slice(2))
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
      const { reasons, files, related, mustHaveImporters } = classify(changed, table, graph.testFiles, exists)
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
}

main().catch((error) => {
  process.stderr.write(`affected-tests: ${error instanceof Refusal ? error.message : (error?.stack ?? String(error))}\n`)
  process.exitCode = 2
})
