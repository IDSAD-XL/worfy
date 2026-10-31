// What every stand-in of this folder does first (README.md): appends its line to FAKE_UPDATE_TRACE
// and prints the names of the token variables that reached it, GH_TOKEN and GITHUB_TOKEN in any
// case of the letters, so a test reads them in build.log.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const TOKENS = ['GH_TOKEN', 'GITHUB_TOKEN']

/** `name` and the marker.txt of the commit the clone holds, if any. */
export function report(name) {
  const marker = existsSync('marker.txt') ? readFileSync('marker.txt', 'utf8').trim() : '-'
  if (process.env.FAKE_UPDATE_TRACE) appendFileSync(process.env.FAKE_UPDATE_TRACE, `${name} ${marker}\n`)
  const seen = Object.keys(process.env).filter((variable) => TOKENS.includes(variable.toUpperCase()))
  process.stdout.write(`${name}: tokens=${seen.length === 0 ? 'none' : seen.join(',')}\n`)
}
