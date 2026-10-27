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

import process from 'node:process'

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
  const jobs = Object.keys(needs).filter((name) => name !== 'changes')
  for (const name of Object.keys(expect)) if (!jobs.includes(name)) problems.push(`${name}: in "expect" of changes, but ci-ok does not need it`)
  for (const name of jobs) {
    const result = needs[name]?.result
    if (!(name in expect)) {
      problems.push(`${name}: ci-ok needs it, but scripts/ci-scope.mjs does not name it`)
      continue
    }
    const wanted = expect[name] === true ? 'success' : 'skipped'
    lines.push(`${name}: ${result} (${expect[name] === true ? 'needed' : 'not needed'})`)
    if (result !== wanted) problems.push(`${name}: ${result}, expected ${wanted}`)
  }
  return { lines, problems }
}

const { lines, problems } = verdict(process.env.NEEDS)
for (const line of lines) process.stdout.write(`${line}\n`)
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`ci-ok: ${problem}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('ci-ok: every job the run needs succeeded\n')
}
