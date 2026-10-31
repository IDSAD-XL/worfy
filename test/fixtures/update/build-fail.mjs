// A stand-in for `pnpm package` that fails (README.md): prints a line to stderr and exits 1.
import process from 'node:process'
import { report } from './report.mjs'

report('build')
process.stderr.write('fake build failed: electron-builder said no\n')
process.exitCode = 1
