// A stand-in for pnpm (README.md): `pnpm install --frozen-lockfile` appends a line to
// node_modules/.installs in the folder it runs in and, when node_modules/electron is not there yet,
// puts an Electron whose download finished there (electron.mjs), unless FAKE_PNPM_ELECTRON is
// `none`; any other call fails. Like the real pnpm, it leaves a node_modules/electron that is there
// as it is.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import process from 'node:process'
import { putElectron } from './electron.mjs'
import { report } from './report.mjs'

const args = process.argv.slice(2)
report('install')
if (args.join(' ') === 'install --frozen-lockfile') {
  mkdirSync('node_modules', { recursive: true })
  appendFileSync('node_modules/.installs', 'install\n')
  if (process.env.FAKE_PNPM_ELECTRON !== 'none' && !existsSync('node_modules/electron')) putElectron()
} else {
  process.stderr.write(`pnpm stand-in: unsupported: ${args.join(' ')}\n`)
  process.exitCode = 2
}
