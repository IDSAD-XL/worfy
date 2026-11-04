// A stand-in for one test run alone, started by `gate-failures rerun` from the argv of a failure record:
//
//   node stub-test.mjs <trace folder> <name> <exit code> <ms> [<lock folder>]
//
// It writes <trace folder>/<name>.json — when it started and ended, its pid and folder, whether it saw
// GATE_FAILURES_FILE, and the holder.json of the lock folder while it ran (null when there was none) — then
// waits <ms> and ends with <exit code>. A red one prints an error line with its own folder in it, which the
// rerun must scrub. <name>.started appears as soon as it starts, for a test that waits for that.
/* global process, setTimeout */
import fs from 'node:fs'
import path from 'node:path'

const [trace, name, code, wait, lockDir] = process.argv.slice(2)
const start = Date.now()
fs.writeFileSync(path.join(trace, `${name}.started`), `${process.pid}\n`)
let holder = null
if (lockDir) {
  try {
    holder = JSON.parse(fs.readFileSync(path.join(lockDir, 'holder.json'), 'utf8'))
  } catch {
    // no holder.json: the lock is not held by a rerun, or not held at all
  }
}
setTimeout(() => {
  const record = {
    name,
    pid: process.pid,
    cwd: process.cwd(),
    start,
    end: Date.now(),
    failuresFile: process.env.GATE_FAILURES_FILE ?? null,
    holder,
  }
  fs.writeFileSync(path.join(trace, `${name}.json`), `${JSON.stringify(record)}\n`)
  if (Number(code) !== 0) process.stderr.write(`\nAssertionError: ${name} failed in ${path.join(process.cwd(), 'test', 'x.test.ts')}\n    at more\n`)
  process.exitCode = Number(code)
}, Number(wait))
