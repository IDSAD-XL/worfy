// A process that does not end by itself (README.md): a git that hangs, or the process
// build-grandchild.mjs leaves under the build. It appends its pid to FAKE_UPDATE_PIDS, so the test
// can tell whether it was ended and end it itself after a failure.
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout } from 'node:timers'

if (process.env.FAKE_UPDATE_PIDS) appendFileSync(process.env.FAKE_UPDATE_PIDS, `${process.pid}\n`)
setTimeout(() => undefined, 300_000)
