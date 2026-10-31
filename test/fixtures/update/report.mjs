// What every stand-in of this folder does first (README.md): appends its line to FAKE_UPDATE_TRACE
// and prints whether GH_TOKEN and GITHUB_TOKEN reached it, so a test reads both in build.log.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

/** `name` and the marker.txt of the commit the clone holds, if any. */
export function report(name) {
  const marker = existsSync('marker.txt') ? readFileSync('marker.txt', 'utf8').trim() : '-'
  if (process.env.FAKE_UPDATE_TRACE) appendFileSync(process.env.FAKE_UPDATE_TRACE, `${name} ${marker}\n`)
  const seen = (variable) => (process.env[variable] === undefined ? 'absent' : 'present')
  process.stdout.write(`${name}: GH_TOKEN=${seen('GH_TOKEN')} GITHUB_TOKEN=${seen('GITHUB_TOKEN')}\n`)
}
