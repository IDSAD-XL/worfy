#!/usr/bin/env node
// The verdict of the job `ci-ok` of the CI workflow (.github/workflows/ci.yml): the one check a
// merge reads.
//
//   NEEDS='<toJSON(needs)>' node scripts/ci-ok.mjs
//
// NEEDS is the `needs` context of ci-ok: every other job of the workflow, each with its `result`, and
// `changes` with the output `expect` that scripts/ci-scope.mjs wrote — `true` for each job the run
// needs. The verdict is green (exit code 0) when `changes` succeeded and every other job matches
// it: a job the run needs succeeded, a job it does not need was skipped (a change of documents only
// skips the tests, and that counts as green). Red (exit code 1) when a job failed or was cancelled,
// when a needed job was skipped, when a job ran that was not needed, and when the jobs of NEEDS and the
// keys of `expect` differ — a job added to ci.yml but not to ci-scope.mjs, or the other way round.
// One line per job is printed either way.
//
// A job of NON_BLOCKING is seen but does not decide: when the run needs it, any result of it keeps
// ci-ok green, and a result other than success is printed as a warning (a `::warning::` annotation on
// the run's summary). A run that does not need it must still skip it. windows-e2e stays here until
// five push runs on main in a row are green; a later pull request moves it out.

import process from 'node:process'

const NON_BLOCKING = new Set(['windows-e2e'])

function verdict(raw) {
  let needs
  try {
    needs = JSON.parse(raw ?? '')
  } catch {
    return { lines: [], problems: ['NEEDS is not JSON'] }
  }
  const changes = needs?.changes
  if (!changes) return { lines: [], problems: ['NEEDS has no job "changes"'] }
  if (changes.result !== 'success') return { lines: [`changes: ${changes.result}`], problems: [`changes: ${changes.result}, so no job knows what to run`] }
  let expect
  try {
    expect = JSON.parse(changes.outputs?.expect ?? '')
  } catch {
    return { lines: [], problems: ['the output "expect" of changes is not JSON'] }
  }
  const lines = []
  const problems = []
  const warnings = []
  const jobs = Object.keys(needs).filter((name) => name !== 'changes')
  for (const name of Object.keys(expect)) if (!jobs.includes(name)) problems.push(`${name}: in "expect" of changes, but ci-ok does not need it`)
  for (const name of jobs) {
    const result = needs[name]?.result
    if (!(name in expect)) {
      problems.push(`${name}: ci-ok needs it, but scripts/ci-scope.mjs does not name it`)
      continue
    }
    const needed = expect[name] === true
    const wanted = needed ? 'success' : 'skipped'
    const free = needed && NON_BLOCKING.has(name)
    lines.push(`${name}: ${result} (${needed ? 'needed' : 'not needed'}${free ? ', does not block ci-ok' : ''})`)
    if (result === wanted) continue
    if (free) warnings.push(`${name}: ${result}, expected ${wanted}; it does not block ci-ok yet`)
    else problems.push(`${name}: ${result}, expected ${wanted}`)
  }
  return { lines, problems, warnings }
}

const { lines, problems, warnings = [] } = verdict(process.env.NEEDS)
for (const line of lines) process.stdout.write(`${line}\n`)
for (const warning of warnings) process.stdout.write(`::warning::${warning}\n`)
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`ci-ok: ${problem}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('ci-ok: every job the run needs succeeded\n')
}
