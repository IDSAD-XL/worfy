// A stand-in for `pnpm package` that starts a process of its own, as pnpm starts electron-builder
// (README.md): hang.mjs, then waits. Ending only this process leaves that one running.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { report } from './report.mjs'

report('build')
spawn(process.execPath, [join(import.meta.dirname, 'hang.mjs')], { stdio: 'ignore' })
setTimeout(() => undefined, 300_000)
