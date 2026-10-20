#!/usr/bin/env node
// Checks the list of test files given to the manual "Windows tests" workflow
// (.github/workflows/windows-tests.yml, worfy-windows ticket 25) before anything is installed:
//
//   TEST_FILES="<files>" node scripts/windows-test-list.mjs
//
// The list is split at spaces, line breaks and commas. It is accepted when it names 1 to 12 files and
// every element is a test file of test/unit/ or test/contract/, spelled as a path from the
// repository root with forward slashes. An accepted list is printed and, under GitHub Actions,
// written to the step output `files`, separated by spaces; the exit code is 0. A refused list
// prints one line per reason on stderr, writes no output, and the exit code is 1.
//
// Why each rule: a Windows runner minute is paid, the whole suite is red on Windows, and vitest reads
// an argument as a filter that matches every test file whose path contains it, or as an option when
// it starts with "-". An element is therefore one existing file, never a pattern, a folder or a flag.
// The e2e, packaged-app and acceptance tests stay off the runner, and so does a file that runs longer
// than the job's 10 minutes on Windows (RUNS_ON_THE_PC): a run that can only end at the time limit
// costs the full 10 minutes and answers nothing.
//
// The paths are read from the working directory — the repository root in the workflow — because
// vitest resolves the same arguments from there. Only Node's own modules are used: the script runs
// on the Node the runner image ships, before `pnpm install`.

import { appendFileSync, readdirSync } from 'node:fs'
import process from 'node:process'

const MAX_FILES = 12
const FOLDERS = ['test/unit', 'test/contract']
const FORBIDDEN_WORDS = ['e2e', 'packaged', 'acceptance']
// Test files longer than the job's 10 minutes on Windows, and what they run instead of the runner.
const RUNS_ON_THE_PC = new Map([
  [
    'test/contract/harness-scripts.test.ts',
    "runs every Harness shell test, about 26 minutes on Windows: it runs longer than this job's 10 minutes and is run on the owner's Windows PC instead",
  ],
])

/**
 * Every regular file under `folder`, as a path from the working directory with forward slashes.
 * A symbolic link is neither listed nor followed: a link inside test/unit/ must not lead to a file
 * that lives elsewhere.
 */
function filesUnder(folder) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) found.push(path)
    }
  }
  walk(folder)
  return found
}

/** Why `element` may not be run, or undefined when it may. */
function refusal(element, onDisk) {
  if (element.startsWith('-')) return 'starts with "-": vitest would read it as an option'
  // Also what keeps the run step safe: it hands the list to bash unquoted, to be split at spaces.
  if (!/^[A-Za-z0-9._/-]+$/.test(element)) return 'has a character other than letters, digits, ".", "_", "-" and "/"'
  if (!FOLDERS.some((folder) => element.startsWith(`${folder}/`))) return 'is not under test/unit/ or test/contract/'
  if (!/\.test\.tsx?$/.test(element)) return 'is not a *.test.ts or *.test.tsx file'
  const lower = element.toLowerCase()
  const word = FORBIDDEN_WORDS.find((forbidden) => lower.includes(forbidden))
  if (word) return `has "${word}" in its name: e2e, packaged-app and acceptance tests do not run here`
  // The exact spelling of a path found by walking the two folders: no "..", no ".", no doubled
  // slash, no other letter case, nothing reached through a symbolic link.
  if (!onDisk.includes(element)) return 'is not a file found under test/unit/ or test/contract/ (spell the path as git lists it)'
  // After the check on disk: refused with this reason, the file is one this repository has.
  const elsewhere = RUNS_ON_THE_PC.get(element)
  if (elsewhere) return elsewhere
  // vitest matches an argument as a part of a path, without regard to letter case.
  const other = onDisk.find((file) => file !== element && /\.test\.tsx?$/.test(file) && file.toLowerCase().includes(lower))
  if (other) return `also matches ${other}: vitest would run both files`
  return undefined
}

const elements = (process.env.TEST_FILES ?? '').split(/[\s,]+/).filter(Boolean)
const onDisk = FOLDERS.flatMap(filesUnder)

const refusals = []
if (elements.length === 0) refusals.push('the list is empty: name at least one test file')
if (elements.length > MAX_FILES) refusals.push(`${elements.length} files listed, one run takes ${MAX_FILES} at most`)
for (const element of elements) {
  const reason = refusal(element, onDisk)
  // JSON spelling: an element cannot start a line or carry a control character into the log.
  if (reason) refusals.push(`${JSON.stringify(element)}: ${reason}`)
}

if (refusals.length > 0) {
  for (const line of refusals) process.stderr.write(`windows-test-list: ${line}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`windows-test-list: ${elements.length} accepted\n${elements.join('\n')}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `files=${elements.join(' ')}\n`)
}
