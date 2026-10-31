// A stand-in for pnpm (README.md): `pnpm install --frozen-lockfile` appends a line to
// node_modules/.installs in the folder it runs in; any other call fails.
import { appendFileSync, mkdirSync } from 'node:fs'
import process from 'node:process'
import { report } from './report.mjs'

const args = process.argv.slice(2)
report('install')
if (args.join(' ') === 'install --frozen-lockfile') {
  mkdirSync('node_modules', { recursive: true })
  appendFileSync('node_modules/.installs', 'install\n')
} else {
  process.stderr.write(`pnpm stand-in: unsupported: ${args.join(' ')}\n`)
  process.exitCode = 2
}
