// Which eval case of the Harness checks which rule file (ticket worfy-harness/29). The map is
// harness/evals/lib/coverage.json, with paths relative to harness/:
//   cases     — case name -> the rule files the case checks;
//   uncovered — rule file -> one sentence on why no case checks it.
// Pure functions over the map, kept out of scripts/eval-harness.mjs, which starts a run as soon as it
// is imported. `pnpm eval:harness -- --changed <base>` uses them to run only the cases of the rule
// files a branch changed; test/contract/harness-evals-run.test.ts checks the map against the disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAP = 'evals/lib/coverage.json'
// The two files that put the rules into a session: a change to them is a change to the rules.
const INJECTION = ['hooks/hooks.json', 'hooks/inject-rules.mjs']

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

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * What is wrong with the map of the Harness at `harnessDir`, one line per problem; [] when nothing is.
 * A rule file must be under at least one case or in `uncovered`, never both; every path of the map
 * must be a rule file on disk; every case of the map must have its folder and every case folder its
 * entry; a case names at least one file; a reason is not empty.
 */
export function coverageProblems(harnessDir) {
  let coverage
  try {
    coverage = readCoverage(harnessDir)
  } catch (error) {
    return [`cannot read ${MAP}: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (!isObject(coverage) || !isObject(coverage.cases) || !isObject(coverage.uncovered)) return [`${MAP} must hold the objects "cases" and "uncovered"`]
  const problems = []
  const rules = new Set(ruleFiles(harnessDir))
  const covered = new Set()
  const folders = new Set(caseNames(harnessDir))
  const checkPath = (path) => {
    const file = join(harnessDir, path)
    if (!existsSync(file) || !statSync(file).isFile()) problems.push(`missing on disk: ${path}`)
    else if (!rules.has(path)) problems.push(`not a rule file: ${path}`)
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
      checkPath(path)
    }
  }
  for (const name of folders) if (!(name in coverage.cases)) problems.push(`case folder not in the map: ${name}`)
  for (const [path, reason] of Object.entries(coverage.uncovered)) {
    if (typeof reason !== 'string' || reason.trim() === '') problems.push(`empty reason: ${path}`)
    if (covered.has(path)) problems.push(`both under a case and in uncovered: ${path}`)
    checkPath(path)
  }
  for (const path of rules) if (!covered.has(path) && !(path in coverage.uncovered)) problems.push(`not mapped: ${path}`)
  return [...new Set(problems)]
}

/**
 * The cases to run for `changedPaths` (relative to the repository root, with `/`, as git prints
 * them): a rule file of `coverage.cases` -> its cases; a file in harness/evals/<case>/ -> that case;
 * a file in harness/evals/lib/ -> every case (the fixture and the map are shared). A rule file of
 * `coverage.uncovered` goes to `uncovered` with its reason; any other path chooses nothing.
 * Returns { cases: sorted names, files: [{ path, cases }] for each path that chose a case,
 * uncovered: [{ path, reason }] }.
 */
export function casesFor(changedPaths, coverage, names) {
  const byFile = new Map()
  for (const [name, files] of Object.entries(coverage.cases)) {
    for (const file of files) byFile.set(file, [...(byFile.get(file) ?? []), name])
  }
  const chosen = new Set()
  const files = []
  const uncovered = []
  for (const path of [...new Set(changedPaths)].sort()) {
    if (!path.startsWith('harness/')) continue
    const inside = path.slice('harness/'.length)
    const folder = /^evals\/([^/]+)\//.exec(inside)?.[1]
    let cases = []
    if (folder === 'lib') cases = [...names]
    else if (folder !== undefined && names.includes(folder)) cases = [folder]
    else if (byFile.has(inside)) cases = byFile.get(inside)
    else if (Object.hasOwn(coverage.uncovered, inside)) uncovered.push({ path, reason: coverage.uncovered[inside] })
    if (cases.length === 0) continue
    cases = [...new Set(cases)].sort()
    for (const name of cases) chosen.add(name)
    files.push({ path, cases })
  }
  return { cases: [...chosen].sort(), files, uncovered }
}
