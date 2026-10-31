// A stand-in for `pnpm package` (README.md): puts the folder the build would leave — dist\win-unpacked
// on Windows, dist/mac-arm64/worfy.app elsewhere — with the marker of the commit in it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { report } from './report.mjs'

report('build')
const app = process.platform === 'win32' ? join('dist', 'win-unpacked') : join('dist', 'mac-arm64', 'worfy.app')
mkdirSync(app, { recursive: true })
writeFileSync(join(app, 'marker.txt'), readFileSync('marker.txt', 'utf8'))
process.stdout.write('fake build done\n')
