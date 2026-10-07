// `worfy-spike-bin <who> [marks...] [--login]` — run by an agent in its Bash (ticket worfy-harness/01).
//
// Appends one JSON line to $WORFY_SPIKE_OUT/bin.jsonl: who ran it (`main`, `sub`, `wf`, `skill`…,
// as the prompt tells the agent), the remaining arguments (the hook marks the agent saw), whether
// GH_TOKEN is set and its sha256 — never the value. With --login it also asks the GitHub API
// whose token that is (`gh api user --jq .login`) and logs the login.
// Prints only `worfy-spike-bin ok <who> token=<yes|no>`, so the transcript carries no token.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const args = process.argv.slice(2)
const login = args.includes('--login')
const [who = 'unknown', ...marks] = args.filter((a) => a !== '--login')
const token = process.env.GH_TOKEN
const line = {
  at: new Date().toISOString(),
  who,
  marks,
  gh_token_set: Boolean(token),
  gh_token_sha256: token ? createHash('sha256').update(token).digest('hex') : null,
  // This plugin's own bin/ among the PATH entries (Claude Code adds it; the agent did not).
  plugin_bin_on_path: (process.env.PATH ?? '').split(':').includes(fileURLToPath(new URL('../bin', import.meta.url))),
}
if (login) {
  try {
    line.gh_login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (err) {
    line.gh_login_error = String(err?.status ?? err)
  }
}
const out = process.env.WORFY_SPIKE_OUT
if (out) appendFileSync(join(out, 'bin.jsonl'), `${JSON.stringify(line)}\n`)
process.stdout.write(`worfy-spike-bin ok ${who} token=${token ? 'yes' : 'no'}\n`)
