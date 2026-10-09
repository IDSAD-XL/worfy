// A stand-in for `gh` in tests (ticket 17). It never reaches GitHub.
//
// - GH_STUB_LOG: a file; each call appends its arguments as one JSON line (never the environment,
//   so GH_TOKEN stays out of it).
// - GH_STUB_FAIL: when set, the call prints it to stderr and exits 1 (not logged in, no network).
// - GH_STUB_DIR: a folder with the answers (test/contract/gh-world.ts writes them):
//   - fail: when it exists, the call prints its text to stderr and exits 1, as GH_STUB_FAIL does;
//     a test can create and remove it while the app runs.
//   - prs.json: the repository's PRs newest first in the shape of
//     `gh pr list --json number,headRefName,state,url,statusCheckRollup,comments`; none without it.
//   - auth-status.json: what `gh auth status --json hosts` prints (`{"hosts":{"<host>":[…]}}`);
//     no accounts without it.
//   - tokens.json: `{"<login>": "<token>"}`, for `gh auth token -u <login>`.
//   - repos.json: `{"<owner>/<repo>": {"<login>": true | false | <HTTP status>}}`: what
//     `gh api repos/<owner>/<repo>` answers to GH_TOKEN of that login — `permissions.push`, or a
//     failure with that status. A login it does not name gets 404, as GitHub answers for a private
//     repository the account cannot see.
//   - login.json: `{"login", "host"?, "token"}`, the account `gh auth login` adds. Without it the
//     sign-in fails.
//
// Understood (worfy-week ticket 01, worfy-harness ticket 25): `pr list` with --limit (default 30, as
// gh), --head <branch> (the exact branch, as gh) and --search "head:<branch>" (by prefix, as
// GitHub's search: `head:demo/1` also finds demo/18); `auth status --json hosts [--hostname <h>]`;
// `auth token -u <login> [--hostname <h>]`; `api repos/<owner>/<repo> [--jq .permissions.push]
// [--hostname <h>]`; `auth login`, which asks for Enter on its terminal first, as the real one
// waits for its user. Any other command exits 2, so a command that would change something —
// `auth switch`, `auth logout`, `config set` — fails loudly.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
if (process.env.GH_STUB_LOG) appendFileSync(process.env.GH_STUB_LOG, `${JSON.stringify(args)}\n`)
if (process.env.GH_STUB_FAIL) {
  process.stderr.write(`${process.env.GH_STUB_FAIL}\n`)
  process.exit(1)
}
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const dir = process.env.GH_STUB_DIR
if (dir && existsSync(join(dir, 'fail'))) {
  process.stderr.write(`${readFileSync(join(dir, 'fail'), 'utf8').trim()}\n`)
  process.exit(1)
}
const read = (file, fallback) => (dir && existsSync(join(dir, file)) ? JSON.parse(readFileSync(join(dir, file), 'utf8')) : fallback)
const fail = (message, code = 1) => {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}
const command = `${args[0] ?? ''} ${args[1] ?? ''}`

if (command === 'pr list') {
  let pulls = read('prs.json', [])
  const head = option('--head')
  if (head !== undefined) pulls = pulls.filter((pull) => pull.headRefName === head)
  const search = option('--search')
  if (search !== undefined) {
    const prefix = /^head:(\S+)$/.exec(search)
    pulls = prefix ? pulls.filter((pull) => pull.headRefName.startsWith(prefix[1])) : []
  }
  pulls = pulls.slice(0, Number(option('--limit') ?? 30))
  process.stdout.write(JSON.stringify(pulls))
} else if (command === 'auth status' && option('--json') === 'hosts' && !args.includes('--show-token') && !args.includes('-t')) {
  const status = read('auth-status.json', { hosts: {} })
  const host = option('--hostname')
  const hosts = host === undefined ? status.hosts : Object.fromEntries(Object.entries(status.hosts).filter(([name]) => name === host))
  process.stdout.write(`${JSON.stringify({ hosts })}\n`)
} else if (command === 'auth token' && option('-u') !== undefined) {
  const login = option('-u')
  const token = read('tokens.json', {})[login]
  if (token === undefined) fail(`no oauth token found for ${option('--hostname') ?? 'github.com'} account ${login}`)
  process.stdout.write(`${token}\n`)
} else if (args[0] === 'api' && /^repos\/[^/\s]+\/[^/\s]+$/.test(args[1] ?? '')) {
  const slug = args[1].slice('repos/'.length)
  const tokens = read('tokens.json', {})
  const login = Object.keys(tokens).find((name) => tokens[name] === process.env.GH_TOKEN)
  const answer = login === undefined ? 404 : (read('repos.json', {})[slug]?.[login] ?? 404)
  if (answer === 404) fail('gh: Not Found (HTTP 404)')
  if (typeof answer === 'number') fail(`gh: Resource not accessible by personal access token (HTTP ${answer})`)
  const repo = { full_name: slug, permissions: { admin: false, maintain: false, push: answer, triage: answer, pull: true } }
  process.stdout.write(option('--jq') === '.permissions.push' ? `${String(answer)}\n` : JSON.stringify(repo))
} else if (command === 'auth login' && args.length === 2) {
  const account = read('login.json', undefined)
  process.stdout.write('? Where do you use GitHub? GitHub.com\n! Press Enter to sign in (gh stub)\n')
  process.stdin.once('data', () => {
    if (account === undefined) fail('authentication cancelled (gh stub: no login.json)')
    const host = account.host ?? 'github.com'
    const status = read('auth-status.json', { hosts: {} })
    status.hosts[host] = [...(status.hosts[host] ?? []).map((each) => ({ ...each, active: false })), { active: true, gitProtocol: 'https', host, login: account.login, scopes: 'repo', state: 'success', tokenSource: 'keyring' }]
    writeFileSync(join(dir, 'auth-status.json'), JSON.stringify(status))
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ ...read('tokens.json', {}), [account.login]: account.token }))
    process.stdout.write(`✓ Logged in to ${host} account ${account.login} (keyring)\n`)
    process.exit(0)
  })
} else {
  fail(`gh stub: unsupported command: ${args.join(' ')}`, 2)
}
