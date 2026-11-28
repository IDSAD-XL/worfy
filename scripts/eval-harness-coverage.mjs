// Which eval case of the Harness checks which file (tickets worfy-harness/29, worfy-harness-eval/04). The
// map is harness/evals/lib/coverage.json, with paths relative to harness/:
//   cases     — case name -> the rule files the case checks;
//   scripts   — file the cases run (a hook script, a script of bin/, a library of lib/) -> what leads
//               to its cases: case names, "*" for every case, or paths of the map (a rule file or
//               another file of `scripts`), whose cases it takes;
//   uncovered — rule file or file the cases run -> one sentence on why no case checks it.
// The shared fixtures (a folder of evals/ that a case's scaffold.sh runs from another case folder) are
// found from the scaffold.sh files, not from the map. Pure functions over the map, kept out of
// scripts/eval-harness.mjs, which starts a run as soon as it is imported. `pnpm eval:harness -- --changed
// <base>` uses them to run only the cases of the files a branch changed;
// test/contract/harness-evals-run.test.ts checks the map against the disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAP = 'evals/lib/coverage.json'
// The two files that put the rules into a session: a change to them is a change to the rules.
const INJECTION = ['hooks/hooks.json', 'hooks/inject-rules.mjs']
// The value of `scripts` that stands for every case.
const EVERY = '*'

/** The files under `dir` (relative, with `/`), deepest last; dot files are left out. */
function filesUnder(dir, prefix = '') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`) : entry.isFile() ? [`${prefix}${entry.name}`] : [],
    )
}

/**
 * The rule files of the Harness at `harnessDir`, relative to it and sorted: every file under
 * skills/, agents/*.md, hooks/rules/*.md, hooks/hooks.json and hooks/inject-rules.mjs.
 */
export function ruleFiles(harnessDir) {
  const markdown = (sub) => filesUnder(join(harnessDir, sub)).filter((file) => !file.includes('/') && file.endsWith('.md')).map((file) => `${sub}/${file}`)
  return [
    ...filesUnder(join(harnessDir, 'skills')).map((file) => `skills/${file}`),
    ...markdown('agents'),
    ...markdown('hooks/rules'),
    ...INJECTION.filter((file) => existsSync(join(harnessDir, file))),
  ].sort()
}

/**
 * The files the cases of the Harness at `harnessDir` run, relative to it and sorted: the files of
 * hooks/ (the hook scripts and the modules they load, without the two rule files of INJECTION), of
 * bin/ (the scripts), and every file under lib/ (the libraries). The tests, hooks/tests/ and bin/tests/,
 * and the injected rules, hooks/rules/, are left out.
 */
export function scriptFiles(harnessDir) {
  const top = (sub) => filesUnder(join(harnessDir, sub)).filter((file) => !file.includes('/')).map((file) => `${sub}/${file}`)
  return [
    ...top('hooks').filter((file) => !INJECTION.includes(file)),
    ...top('bin'),
    ...filesUnder(join(harnessDir, 'lib')).map((file) => `lib/${file}`),
  ].sort()
}

/** The map of the Harness at `harnessDir`; throws when it cannot be read or is not JSON. */
export function readCoverage(harnessDir) {
  return JSON.parse(readFileSync(join(harnessDir, MAP), 'utf8'))
}

/** The eval cases of the Harness at `harnessDir`: the folders of evals/ with a prompt.md, sorted. */
export function caseNames(harnessDir) {
  const evals = join(harnessDir, 'evals')
  if (!existsSync(evals)) return []
  return readdirSync(evals, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(evals, entry.name, 'prompt.md')))
    .map((entry) => entry.name)
    .sort()
}

/**
 * The shared fixtures of the Harness at `harnessDir` and the cases that take them:
 * { 'evals/<folder>/[<sub>/]': [case, …] }. A shared fixture is the folder of a file that the
 * scaffold.sh of a case names in another folder of evals/ (`"$here/../pr-reply-fixture/pull.sh"` ->
 * evals/pr-reply-fixture/), outside a comment, when that folder of evals/ exists; evals/lib/ is left
 * out, as every case takes it.
 */
export function fixtureUsers(harnessDir) {
  const users = {}
  for (const name of caseNames(harnessDir)) {
    const scaffold = join(harnessDir, 'evals', name, 'scaffold.sh')
    if (!existsSync(scaffold)) continue
    for (const line of readFileSync(scaffold, 'utf8').split('\n')) {
      if (/^\s*#/.test(line)) continue
      for (const [, folder, rest] of line.matchAll(/\.\.\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+)/g)) {
        // `../src/sum.mjs` of a step inside the demo repository is no folder of evals/.
        if (folder === 'lib' || folder === name || folder.startsWith('.') || !existsSync(join(harnessDir, 'evals', folder))) continue
        const sub = rest.includes('/') ? `${rest.slice(0, rest.lastIndexOf('/'))}/` : ''
        const dir = `evals/${folder}/${sub}`
        users[dir] = [...new Set([...(users[dir] ?? []), name])].sort()
      }
    }
  }
  return users
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What is wrong with the map of the Harness at `harnessDir`, one line per problem; [] when nothing is.
 * A rule file must be under at least one case or in `uncovered`, never both; a file the cases run must
 * be in the map exactly once, under `scripts` or in `uncovered`; every path of the map must be on disk
 * and of its kind; every case of the map must have its folder and every case folder its entry; a case
 * names at least one file and an entry of `scripts` at least one case or path, each of them a case, "*"
 * or a path of the map that leads to cases; a reason is not empty; every shared fixture folder (a
 * folder of evals/ other than lib/ with no prompt.md) is taken by the scaffold.sh of some case.
 */
export function coverageProblems(harnessDir) {
  let coverage
  let text
  try {
    text = readFileSync(join(harnessDir, MAP), 'utf8')
    coverage = JSON.parse(text)
  } catch (error) {
    return [`cannot read ${MAP}: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (!isObject(coverage) || !isObject(coverage.cases) || !isObject(coverage.scripts) || !isObject(coverage.uncovered)) {
    return [`${MAP} must hold the objects "cases", "scripts" and "uncovered"`]
  }
  const problems = []
  const rules = new Set(ruleFiles(harnessDir))
  const scripts = scriptFiles(harnessDir)
  const scriptSet = new Set(scripts)
  const covered = new Set()
  const folders = new Set(caseNames(harnessDir))
  const onDisk = (path) => {
    const file = join(harnessDir, path)
    if (existsSync(file) && statSync(file).isFile()) return true
    problems.push(`missing on disk: ${path}`)
    return false
  }
  for (const [name, files] of Object.entries(coverage.cases)) {
    if (!isStringList(files)) {
      problems.push(`case lists no paths: ${name}`)
      continue
    }
    if (files.length === 0) problems.push(`case names no rule file: ${name}`)
    if (!folders.has(name)) problems.push(`case without a folder: ${name}`)
    for (const path of files) {
      covered.add(path)
      if (onDisk(path) && !rules.has(path)) problems.push(`not a rule file: ${path}`)
    }
  }
  for (const name of folders) if (!(name in coverage.cases)) problems.push(`case folder not in the map: ${name}`)
  for (const [path, leads] of Object.entries(coverage.scripts)) {
    if (onDisk(path) && !scriptSet.has(path)) problems.push(`not a script: ${path}`)
    if (!isStringList(leads) || leads.length === 0) {
      problems.push(`script names no case: ${path}`)
      continue
    }
    for (const lead of leads) {
      if (lead === EVERY || folders.has(lead) || covered.has(lead) || Object.hasOwn(coverage.scripts, lead)) continue
      if (Object.hasOwn(coverage.uncovered, lead)) problems.push(`leads to a file of uncovered: ${lead} (${path})`)
      else problems.push(`neither a case nor a mapped file: ${lead} (${path})`)
    }
  }
  for (const [path, reason] of Object.entries(coverage.uncovered)) {
    if (typeof reason !== 'string' || reason.trim() === '') problems.push(`empty reason: ${path}`)
    if (covered.has(path)) problems.push(`both under a case and in uncovered: ${path}`)
    if (onDisk(path) && !rules.has(path) && !scriptSet.has(path)) problems.push(`not a rule file or a script: ${path}`)
  }
  for (const path of rules) if (!covered.has(path) && !(path in coverage.uncovered)) problems.push(`not mapped: ${path}`)
  // Exactly once, under `scripts` or in `uncovered`: JSON.parse keeps the last of two equal keys, so
  // the keys are counted in the text of the map.
  for (const path of scripts) {
    const times = text.match(new RegExp(`"${literal(path)}"\\s*:`, 'g'))?.length ?? 0
    if (times === 0) problems.push(`not mapped: ${path}`)
    else if (times > 1) problems.push(`mapped more than once: ${path}`)
  }
  const fixtures = Object.keys(fixtureUsers(harnessDir))
  const evals = join(harnessDir, 'evals')
  if (existsSync(evals)) {
    for (const entry of readdirSync(evals, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'lib' || entry.name === 'results' || entry.name.startsWith('.') || folders.has(entry.name)) continue
      if (!fixtures.some((dir) => dir.startsWith(`evals/${entry.name}/`))) problems.push(`shared fixture no case takes: evals/${entry.name}/`)
    }
  }
  return [...new Set(problems)]
}

/**
 * The cases the entry `path` of `scripts` (the `scripts` of the map) leads to: its case names, every
 * case for "*", and the cases of each path it names — a rule file under a case (`byFile`), or another
 * entry of `scripts`, followed once each.
 */
function scriptCases(path, scripts, names, byFile, seen = new Set()) {
  if (seen.has(path)) return []
  seen.add(path)
  const cases = []
  for (const lead of scripts[path] ?? []) {
    if (lead === EVERY) cases.push(...names)
    else if (names.includes(lead)) cases.push(lead)
    else if (byFile.has(lead)) cases.push(...byFile.get(lead))
    else if (Object.hasOwn(scripts, lead)) cases.push(...scriptCases(lead, scripts, names, byFile, seen))
  }
  return cases
}

/**
 * The cases to run for `changedPaths` (relative to the repository root, with `/`, as git prints
 * them): a rule file of `coverage.cases` -> its cases; a file of `coverage.scripts` -> the cases its
 * entry leads to; a file in harness/evals/<case>/ -> that case, and the cases that take its folder as
 * a shared fixture (`fixtures`, from fixtureUsers); a file in another folder of harness/evals/ -> the
 * cases that take it; a file in harness/evals/lib/ -> every case (the fixture and the map are shared).
 * A file of `coverage.uncovered` goes to `uncovered` with its reason; any other path chooses nothing.
 * Returns { cases: sorted names, files: [{ path, cases }] for each path that chose a case,
 * uncovered: [{ path, reason }] }.
 */
export function casesFor(changedPaths, coverage, names, fixtures = {}) {
  const byFile = new Map()
  for (const [name, files] of Object.entries(coverage.cases)) {
    for (const file of files) byFile.set(file, [...(byFile.get(file) ?? []), name])
  }
  const scripts = coverage.scripts ?? {}
  const chosen = new Set()
  const files = []
  const uncovered = []
  for (const path of [...new Set(changedPaths)].sort()) {
    if (!path.startsWith('harness/')) continue
    const inside = path.slice('harness/'.length)
    const folder = /^evals\/([^/]+)\//.exec(inside)?.[1]
    let cases = []
    if (folder === 'lib') cases = [...names]
    else if (folder !== undefined) {
      if (names.includes(folder)) cases.push(folder)
      for (const [dir, users] of Object.entries(fixtures)) if (inside.startsWith(dir)) cases.push(...users.filter((name) => names.includes(name)))
    } else if (byFile.has(inside)) cases = byFile.get(inside)
    else if (Object.hasOwn(scripts, inside)) cases = scriptCases(inside, scripts, names, byFile)
    else if (Object.hasOwn(coverage.uncovered, inside)) uncovered.push({ path, reason: coverage.uncovered[inside] })
    if (cases.length === 0) continue
    cases = [...new Set(cases)].sort()
    for (const name of cases) chosen.add(name)
    files.push({ path, cases })
  }
  return { cases: [...chosen].sort(), files, uncovered }
}
