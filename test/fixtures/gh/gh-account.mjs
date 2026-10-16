// A gh for the tests of the Project's GitHub account (test/contract/github-prs.test.ts, worfy-week
// ticket 01): logs "<GH_TOKEN or <unset>>\t<arg>\t<arg>…" to $GH_STUB_LOG, is logged in only as
// $GH_STUB_ACCOUNT when $GH_STUB_TOKEN is set, and answers `pr list` from $GH_STUB_DIR/prs.json.
//
// A Node script, not a `#!/bin/sh` one: worfy starts a WORFY_GH (or `command`) that ends in `.mjs`
// as a script of its own Node (src/main/program.ts), on every system; Windows cannot start a shell
// script as a program (worfy-windows ticket 14). It needs no PATH: the tests run it with
// PATH=/usr/bin:/bin. It is a file of test/fixtures, not a script per test: macOS checks every new
// executable file on its first run (worfy-polish ticket 30).
import { appendFileSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const env = process.env
// Written with writeSync: the process ends right after, and a pipe on macOS is written asynchronously.
const out = (text) => writeSync(1, text)
const err = (text) => writeSync(2, text)

appendFileSync(env.GH_STUB_LOG, `${env.GH_TOKEN ?? '<unset>'}${args.map((arg) => `\t${arg}`).join('')}\n`)

if (args[0] === 'auth' && args[1] === 'token') {
  if (args[2] === '-u' && args[3] === env.GH_STUB_ACCOUNT && env.GH_STUB_TOKEN) {
    out(`${env.GH_STUB_TOKEN}\n`)
    process.exit(0)
  }
  err(`no oauth token found for github.com account ${args[3] ?? ''}\n`)
  process.exit(1)
}
if (args[0] === 'pr' && args[1] === 'list') {
  if (env.GH_STUB_LIST_EXIT) {
    err(env.GH_STUB_LIST_STDERR ?? '')
    process.exit(Number(env.GH_STUB_LIST_EXIT))
  }
  out(readFileSync(join(env.GH_STUB_DIR, 'prs.json'), 'utf8'))
  process.exit(0)
}
err(`gh stub: unsupported command: ${args.join(' ')}\n`)
process.exit(2)
