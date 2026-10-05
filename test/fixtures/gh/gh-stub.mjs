// A stand-in for `gh` in tests (ticket 17). It never reaches GitHub.
//
// - GH_STUB_LOG: a file; each call appends its arguments as one JSON line.
// - GH_STUB_FAIL: when set, the call prints it to stderr and exits 1 (not logged in, no network).
// - GH_STUB_DIR: a folder with prs.json, the repository's PRs newest first in the shape of
//   `gh pr list --json number,headRefName,state,url,statusCheckRollup,comments`. Without it the
//   repository has no PRs.
//
// Only `gh pr list` is understood, with --limit (default 30, as gh) and --search "head:<branch>";
// any other command exits 2, so a command that would change something fails loudly.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
if (process.env.GH_STUB_LOG) appendFileSync(process.env.GH_STUB_LOG, `${JSON.stringify(args)}\n`)
if (process.env.GH_STUB_FAIL) {
  process.stderr.write(`${process.env.GH_STUB_FAIL}\n`)
  process.exit(1)
}
if (args[0] !== 'pr' || args[1] !== 'list') {
  process.stderr.write(`gh stub: unsupported command: ${args.join(' ')}\n`)
  process.exit(2)
}
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const dir = process.env.GH_STUB_DIR
let pulls = dir && existsSync(join(dir, 'prs.json')) ? JSON.parse(readFileSync(join(dir, 'prs.json'), 'utf8')) : []
const search = option('--search')
if (search !== undefined) {
  const head = /^head:(\S+)$/.exec(search)
  pulls = head ? pulls.filter((pull) => pull.headRefName === head[1]) : []
}
pulls = pulls.slice(0, Number(option('--limit') ?? 30))
process.stdout.write(JSON.stringify(pulls))
