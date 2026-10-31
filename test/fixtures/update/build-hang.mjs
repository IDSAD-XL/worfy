// A stand-in for `pnpm package` that does not end by itself (README.md): the test stops the build.
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { report } from './report.mjs'

report('build')
process.stdout.write('fake build waits\n')
setTimeout(() => undefined, 300_000)
