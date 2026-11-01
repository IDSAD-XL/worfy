// A stand-in for `gh` (WORFY_GH) in test/contract/flight-recorder-github.test.ts (worfy-flight-recorder
// ticket 15): answers from the gh answers of the night-Run fixture, never reaches GitHub. A Node script,
// which worfy starts under its own Node on every system (src/main/program.ts).
//
// - FR_GH_DIR: the folder of the answers (night-run/gh): `pr-view-<n>.json` for `pr list --head <branch>`
//   (the PRs of that branch, newest first), `run-list-<branch, "/" as "-">.json` for `run list --branch`,
//   and every `run-list-*.json` for `run list --commit <sha>` (the runs whose headSha is that sha).
// - FR_GH_LOG: a file; each call appends `{"token", "args"}` as one JSON line, `token` being GH_TOKEN or null.
// - FR_GH_ACCOUNT, FR_GH_TOKEN: `auth token -u <FR_GH_ACCOUNT>` prints FR_GH_TOKEN; any other login fails.
// - FR_GH_FAIL: a file; while it exists every call but `auth token` (which reads the local keyring) prints its
//   text to stderr and exits 1 (no network).
// Any other command exits 2.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const env = process.env
// Written with writeSync: the process ends right after, and a pipe on macOS is written asynchronously.
const out = (text) => writeSync(1, text)
const fail = (text, code = 1) => {
  writeSync(2, `${text}\n`)
  process.exit(code)
}
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const read = (file) => JSON.parse(readFileSync(join(env.FR_GH_DIR, file), 'utf8'))

if (env.FR_GH_LOG) appendFileSync(env.FR_GH_LOG, `${JSON.stringify({ token: env.GH_TOKEN ?? null, args })}\n`)
const command = `${args[0] ?? ''} ${args[1] ?? ''}`
if (command !== 'auth token' && env.FR_GH_FAIL && existsSync(env.FR_GH_FAIL)) fail(readFileSync(env.FR_GH_FAIL, 'utf8').trim())
const files = readdirSync(env.FR_GH_DIR)
if (command === 'auth token') {
  if (option('-u') !== env.FR_GH_ACCOUNT || !env.FR_GH_TOKEN) fail(`no oauth token found for github.com account ${option('-u') ?? ''}`)
  out(`${env.FR_GH_TOKEN}\n`)
} else if (command === 'pr list' && option('--json') !== undefined && option('--head') !== undefined) {
  const prs = files.filter((file) => /^pr-view-\d+\.json$/.test(file)).map(read).filter((pr) => pr.headRefName === option('--head'))
  out(JSON.stringify(prs.sort((a, b) => b.number - a.number).slice(0, Number(option('--limit') ?? 30))))
} else if (command === 'run list' && option('--json') !== undefined && option('--branch') !== undefined) {
  const file = `run-list-${option('--branch').replaceAll('/', '-')}.json`
  out(JSON.stringify(files.includes(file) ? read(file) : []))
} else if (command === 'run list' && option('--json') !== undefined && option('--commit') !== undefined) {
  const runs = files.filter((file) => /^run-list-.+\.json$/.test(file)).flatMap(read).filter((run) => run.headSha === option('--commit'))
  out(JSON.stringify(runs))
} else fail(`gh stand-in: unsupported command: ${args.join(' ')}`, 2)
