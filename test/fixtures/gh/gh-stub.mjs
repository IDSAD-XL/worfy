// A stand-in for `gh` in tests (ticket 17). It never reaches GitHub.
//
// - GH_STUB_LOG: a file; each call appends its arguments as one JSON line (never the environment,
//   so GH_TOKEN stays out of it).
// - GH_STUB_RUNTIME: a file; each call appends how it runs as one JSON line, `{"runAsNode", "type"}`:
//   ELECTRON_RUN_AS_NODE and Electron's process.type, null when unset. Under worfy's own Node
//   (src/main/program.ts) that is `{"runAsNode":"1","type":null}`. Without the variable Electron
//   would still run the script, as the main script of a second app, and `type` would be "browser".
// - GH_STUB_FAIL: when set, the call prints it to stderr and exits 1 (not logged in, no network).
// - GH_STUB_DIR: a folder with the answers (test/contract/gh-world.ts writes them):
//   - fail: when it exists, the call prints its text to stderr and exits 1, as GH_STUB_FAIL does;
//     a test can create and remove it while the app runs.
//   - hang: when it exists (and `fail` does not), the call appends its process id to `hang.pids`
//     next to it, waits as many milliseconds as the file holds (60 000 when it holds no number) and
//     then exits 1: gh that hangs (worfy-faults ticket 04). A runner's timeout ends it sooner; the
//     test kills whatever `hang.pids` names that still runs.
//   - prs.json: the repository's PRs newest first in the shape of
//     `gh pr list --json number,headRefName,state,url,statusCheckRollup,comments`; none without it.
//   - auth-status.json: what `gh auth status --json hosts` prints (`{"hosts":{"<host>":[…]}}`);
//     no accounts without it.
//   - tokens.json: `{"<login>": "<token>"}`, for `gh auth token -u <login> [--hostname <h>]`; a login
//     auth-status.json lists only under other hosts than the asked one (github.com without
//     --hostname) has no token there, as gh answers.
//   - repos.json: `{"<owner>/<repo>": {"<login>": true | false | null | "<text>" | <HTTP status>}}`: what
//     `gh api repos/<owner>/<repo>` answers to GH_TOKEN of that login — `permissions.push` (with
//     `--jq .permissions.push`: null as `null`, a text as it is), or a failure with that status. A login it does not name gets 404, as GitHub answers for a private
//     repository the account cannot see.
//   - login.json: `{"login", "host"?, "token"}`, the account `gh auth login` adds. Without it the
//     sign-in fails.
//   - old-gh.json: `{"version", "text", "stream"?, "code"?}`, a gh older than 2.81 (worfy-polish
//     ticket 76): `auth status --json …` fails with "unknown flag: --json" as such a gh does, and
//     `auth status` without flags prints `text` to `stream` (stdout by default) and exits `code` (0).
//     `--version` prints `version`; without the file it prints 2.97.0.
//   - graphql.json: the PRs the PR inbox reads (worfy-pr-inbox ticket 02), `{"viewer", "rateLimit"?, "detailsMax"?,
//     "pulls": [{"repo": "<owner>/<name>", "number", "updatedAt", "headRefOid", "reviewRequested"?, "involves"?,
//     "missing"?, "pull"?: {<the GraphQL fields of the PR>}}]}`. Only the inbox's two queries are understood; any
//     other `api graphql` exits 2 as an unsupported command. The search (`review: search(` and `involves: search(`)
//     is answered by the search strings of its variables: the `repo:` qualifiers keep the PRs of those
//     repositories, and `review-requested:@me` / `involves:@me` keep those whose flag is true. The details query
//     (`pullRequest(number: $k0)`) answers each alias `pN` from the variables `oN`, `nN`, `kN` (owner, name,
//     number); a PR it does not know, or one with `"missing": true`, is null, and, as gh does on a GraphQL error,
//     the call prints the data and exits 1 with "GraphQL: Could not resolve to a PullRequest …". A details query
//     of more PRs than `detailsMax` fails with HTTP 504, as GitHub times out on a heavy page. `rateLimit` goes
//     into every answer.
//   - graphql-503: a number; that many `api graphql` calls fail with HTTP 503 first, one less each time.
//   - notifications.json: what `api -i notifications?participating=true [-H "If-Modified-Since: <date>"]` answers
//     (worfy-pr-inbox ticket 08), `{"lastModified"?, "pollInterval"? (60), "rate"?: {"limit", "remaining", "reset"},
//     "status"?, "message"?, "retryAfter"?, "notifications"?: [<GitHub's notification threads>], "body"?: <a raw body
//     printed in place of `notifications`>}`. Without `status`:
//     304 when If-Modified-Since equals `lastModified`, else 200 with `notifications` as the body. Printed as gh
//     prints `-i`: status line, headers, blank line, body; above 299 gh's line on stderr and exit 1, a 304 too
//     (`gh: HTTP 304`), as gh exits on any status above 299.
//
//   - replies.json: a world where worfy may post a reply (worfy-pr-inbox ticket 05), `{"status"?, "landed"?,
//     "threads"?: {"<thread node id>": <databaseId of its first comment>}}`. Without the file a reply is a write like
//     any other (below). Exactly two calls are understood, each with one `-f body=<text>` and nothing else:
//     `api --method POST repos/<o>/<r>/pulls/<n>/comments/<id>/replies` and `api --method POST repos/<o>/<r>/issues/<n>/comments`.
//     The reply goes into posted.json next to it, `[{"repo", "pr", "replyTo" (null in the conversation), "login",
//     "body", "url"}]`, the login by GH_TOKEN (tokens.json), and the call prints the comment GitHub creates
//     (`id`, `html_url`, `body`, `user.login`). With `status` the call fails with that HTTP status, as gh does, and
//     posts nothing — unless `landed` is true: then the reply is posted although gh fails (an answer lost on the way).
//     The two GraphQL reads before a Send, the comments of a thread (`node(id: $thread)`, the thread found through
//     `threads`) and of a PR's conversation, are answered from posted.json, with `viewer` the same login.
//
// Never a write: a `--method`/`-X` other than GET (`--method=PATCH` and `-XPATCH` too), a GraphQL `mutation`, or, on
// a REST call, a field or an input (`-f`, `-F`, `--field`, `--raw-field`, `--input`, which make gh send a POST)
// exits 2 (after its line in the log).
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
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
if (process.env.GH_STUB_LOG) appendFileSync(process.env.GH_STUB_LOG, `${JSON.stringify(args)}\n`)
if (process.env.GH_STUB_RUNTIME) appendFileSync(process.env.GH_STUB_RUNTIME, `${JSON.stringify({ runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null, type: process.type ?? null })}\n`)
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
if (dir && existsSync(join(dir, 'hang'))) {
  const wait = Number(readFileSync(join(dir, 'hang'), 'utf8').trim()) || 60_000
  appendFileSync(join(dir, 'hang.pids'), `${process.pid}\n`)
  await sleep(wait)
  process.stderr.write(`gh stub: hung for ${wait} ms\n`)
  process.exit(1)
}
const read = (file, fallback) => (dir && existsSync(join(dir, file)) ? JSON.parse(readFileSync(join(dir, file), 'utf8')) : fallback)
const fail = (message, code = 1) => {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}
const command = `${args[0] ?? ''} ${args[1] ?? ''}`
const oldGh = read('old-gh.json', undefined)

if (args.length === 1 && args[0] === '--version') {
  const version = oldGh?.version ?? '2.97.0'
  process.stdout.write(`gh version ${version} (2025-01-01)\nhttps://github.com/cli/cli/releases/tag/v${version}\n`)
} else if (oldGh !== undefined && command === 'auth status' && args.includes('--json')) {
  fail('unknown flag: --json\n\nUsage:  gh auth status [flags]\n')
} else if (oldGh !== undefined && command === 'auth status' && args.length === 2) {
  ;(oldGh.stream === 'stderr' ? process.stderr : process.stdout).write(oldGh.text)
  process.exit(oldGh.code ?? 0)
} else if (command === 'pr list') {
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
  const host = option('--hostname') ?? 'github.com'
  // As gh: the token is looked up on the asked host only, so a login listed only for another host has none here.
  const listed = Object.entries(read('auth-status.json', { hosts: {} }).hosts).filter(([, entries]) => entries.some((entry) => entry?.login === login))
  const elsewhere = listed.length > 0 && !listed.some(([name]) => name === host)
  const token = elsewhere ? undefined : read('tokens.json', {})[login]
  if (token === undefined) fail(`no oauth token found for ${host} account ${login}`)
  process.stdout.write(`${token}\n`)
} else if (replyPost() !== null) {
  postReply(replyPost())
} else if (args[0] === 'api' && (/^(GET)?$/i.test(option('--method') ?? option('-X') ?? '') === false || args.some(writeArg) || args.some((arg) => /\bmutation\b/.test(arg)))) {
  fail(`gh stub: a write is never expected: ${args.join(' ')}`, 2)
} else if (args[0] === 'api' && args[1] === 'graphql' && inboxQuery()) {
  graphql()
} else if (args[0] === 'api' && args.includes('-i') && args.some((arg) => /^notifications(\?|$)/.test(arg))) {
  notifications()
} else if (args[0] === 'api' && /^repos\/[^/\s]+\/[^/\s]+$/.test(args[1] ?? '')) {
  const slug = args[1].slice('repos/'.length)
  const tokens = read('tokens.json', {})
  const login = Object.keys(tokens).find((name) => tokens[name] === process.env.GH_TOKEN)
  const answers = read('repos.json', {})[slug] ?? {}
  const answer = login === undefined || !Object.hasOwn(answers, login) ? 404 : answers[login]
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

/** `api graphql`: the PR inbox's search or details query, answered from graphql.json. */
function graphql() {
  const vars = {}
  for (let i = 2; i < args.length - 1; i++) {
    if (!['-f', '-F', '--raw-field', '--field'].includes(args[i])) continue
    const pair = args[i + 1]
    const at = pair.indexOf('=')
    vars[pair.slice(0, at)] = pair.slice(at + 1)
  }
  const world = read('graphql.json', { viewer: 'nobody', pulls: [] })
  const rateLimit = world.rateLimit ?? { limit: 5000, remaining: 4999, resetAt: '2099-01-01T00:00:00Z' }
  const query = vars.query ?? ''
  const pending503 = dir && existsSync(join(dir, 'graphql-503')) ? Number(readFileSync(join(dir, 'graphql-503'), 'utf8').trim()) : 0
  if (pending503 > 0) {
    writeFileSync(join(dir, 'graphql-503'), String(pending503 - 1))
    fail('gh: Service Unavailable (HTTP 503)')
  }
  if (query.includes('search(')) {
    const data = { viewer: { login: world.viewer }, rateLimit }
    for (const [name, text] of Object.entries(vars)) {
      if (name === 'query') continue
      const repos = [...text.matchAll(/(?:^|\s)repo:(\S+)/g)].map((match) => match[1])
      const flag = text.includes('review-requested:@me') ? 'reviewRequested' : text.includes('involves:@me') ? 'involves' : null
      const nodes = world.pulls
        .filter((pull) => repos.includes(pull.repo) && flag !== null && pull[flag] === true)
        .map((pull) => ({ number: pull.number, updatedAt: pull.updatedAt, headRefOid: pull.headRefOid, repository: { nameWithOwner: pull.repo } }))
      data[name] = { issueCount: nodes.length, nodes }
    }
    process.stdout.write(JSON.stringify({ data }))
    return
  }
  if (query.includes('node(id: $thread)')) {
    const replyTo = read('replies.json', {}).threads?.[vars.thread]
    const nodes = replyTo === undefined ? null : posted().filter((each) => each.replyTo === replyTo)
    process.stdout.write(JSON.stringify({ data: { viewer: { login: stubLogin() }, node: nodes === null ? null : { comments: { nodes: nodes.map(commentNode) } } } }))
    return
  }
  if (query.includes('pullRequest(number: $number)')) {
    const slug = `${vars.owner}/${vars.name}`
    const nodes = posted().filter((each) => each.repo === slug && each.pr === Number(vars.number) && each.replyTo === null)
    process.stdout.write(JSON.stringify({ data: { viewer: { login: stubLogin() }, repository: { pullRequest: { comments: { nodes: nodes.map(commentNode) } } } } }))
    return
  }
  if (query.includes('pullRequest(number: $k0)')) {
    const aliases = Object.keys(vars).filter((name) => /^k\d+$/.test(name))
    if (world.detailsMax !== undefined && aliases.length > world.detailsMax) fail("gh: We couldn't respond to your request in time. (HTTP 504)")
    const data = { rateLimit }
    const errors = []
    for (const key of aliases) {
      const n = key.slice(1)
      const slug = `${vars[`o${n}`]}/${vars[`n${n}`]}`
      const pull = world.pulls.find((each) => each.repo === slug && each.number === Number(vars[key]))
      if (pull === undefined || pull.missing === true) {
        data[`p${n}`] = { pullRequest: null }
        errors.push({ type: 'NOT_FOUND', path: [`p${n}`, 'pullRequest'], message: `Could not resolve to a PullRequest with the number of ${vars[key]}.` })
      } else data[`p${n}`] = { pullRequest: { number: pull.number, updatedAt: pull.updatedAt, headRefOid: pull.headRefOid, ...pull.pull } }
    }
    process.stdout.write(JSON.stringify(errors.length > 0 ? { data, errors } : { data }))
    // As gh: an answer with GraphQL errors exits 1 and names the first one on stderr, the data on stdout all the same.
    if (errors.length > 0) fail(`GraphQL: ${errors[0].message} (${errors[0].path.join('.')})`)
    return
  }
  fail(`gh stub: unsupported GraphQL query: ${query.slice(0, 80)}`, 2)
}

/**
 * `api -i notifications…`: GitHub's notifications of the user, answered from notifications.json, printed as gh 2.x
 * prints an answer with `-i` (pkg/cmd/api/api.go): the status line, the headers as `Name: value\r\n`, a blank
 * `\r\n`, then the body. A status above 299 then prints `gh: <message> (HTTP <status>)`, or `gh: HTTP <status>`
 * when the body has no message, to stderr and exits 1 — a 304 too.
 */
function notifications() {
  const reasons = { 200: 'OK', 304: 'Not Modified', 401: 'Unauthorized', 403: 'Forbidden', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway' }
  const world = read('notifications.json', {})
  const header = args.find((arg, i) => args[i - 1] === '-H' && /^If-Modified-Since:/i.test(arg))
  const since = header?.slice(header.indexOf(':') + 1).trim()
  const status = world.status ?? (since !== undefined && world.lastModified !== undefined && since === world.lastModified ? 304 : 200)
  const rate = world.rate ?? { limit: 5000, remaining: 4990, reset: 4102444800 }
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Poll-Interval': String(world.pollInterval ?? 60),
    'X-Ratelimit-Limit': String(rate.limit),
    'X-Ratelimit-Remaining': String(rate.remaining),
    'X-Ratelimit-Reset': String(rate.reset),
  }
  if (world.lastModified !== undefined) headers['Last-Modified'] = world.lastModified
  if (world.retryAfter !== undefined) headers['Retry-After'] = String(world.retryAfter)
  process.stdout.write(`HTTP/2.0 ${status} ${reasons[status] ?? 'Unknown'}\n`)
  for (const name of Object.keys(headers).sort()) process.stdout.write(`${name}: ${headers[name]}\r\n`)
  process.stdout.write('\r\n')
  if (status === 200) {
    process.stdout.write(world.body ?? JSON.stringify(world.notifications ?? []))
    return
  }
  const message = status === 304 ? undefined : (world.message ?? (status === 403 ? 'Resource not accessible by personal access token' : status >= 500 ? 'Server Error' : undefined))
  if (message !== undefined) process.stdout.write(JSON.stringify({ message, documentation_url: 'https://docs.github.com/rest', status: String(status) }))
  // Exit code 1 without process.exit, so stdout, which may be written later on a pipe, is not cut off.
  process.stderr.write(message === undefined ? `gh: HTTP ${status}\n` : `gh: ${message} (HTTP ${status})\n`)
  process.exitCode = 1
}

/** Whether `arg` of an `api` call asks gh to write: another method in one argument, or a field or input of a REST call. */
function writeArg(arg) {
  if (/^(?:--method=|-X)(?!GET$)./i.test(arg)) return true
  return args[1] !== 'graphql' && /^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/.test(arg)
}

/** Whether an `api graphql` call is one of the PR inbox's queries; any other GraphQL is not understood. */
function inboxQuery() {
  const query = args.find((arg, i) => args[i - 1] === '-f' && arg.startsWith('query=')) ?? ''
  return (query.includes('review: search(') && query.includes('involves: search(')) || query.includes('pullRequest(number: $k0)') || query.includes('node(id: $thread)') || query.includes('pullRequest(number: $number)')
}

/** The login of GH_TOKEN (tokens.json); the viewer of graphql.json without one. */
function stubLogin() {
  const tokens = read('tokens.json', {})
  return Object.keys(tokens).find((name) => tokens[name] === process.env.GH_TOKEN) ?? read('graphql.json', {}).viewer ?? 'nobody'
}

/** The replies posted so far (posted.json). */
function posted() {
  return read('posted.json', [])
}

/** A posted reply as GraphQL gives a comment. A function, not a const: the calls above run before this line. */
function commentNode(each) {
  return { author: { login: each.login }, body: each.body, url: each.url }
}

/**
 * The reply this call posts, when it is one of the two worfy may make and replies.json lets it: its repository, PR,
 * the comment it answers (null in the conversation) and its body. Null for any other call, which the write check
 * then refuses.
 */
function replyPost() {
  if (!dir || !existsSync(join(dir, 'replies.json'))) return null
  if (args.length !== 6 || args[0] !== 'api' || args[1] !== '--method' || args[2] !== 'POST' || args[4] !== '-f' || !args[5].startsWith('body=')) return null
  const thread = /^repos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/comments\/(\d+)\/replies$/.exec(args[3])
  const conversation = /^repos\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)\/comments$/.exec(args[3])
  const match = thread ?? conversation
  if (match === null) return null
  return { repo: match[1], pr: Number(match[2]), replyTo: thread === null ? null : Number(thread[3]), body: args[5].slice('body='.length) }
}

/** Posts the reply into posted.json and prints the comment, or fails as replies.json says. */
function postReply(reply) {
  const world = read('replies.json', {})
  const list = posted()
  const id = 9000 + list.length + 1
  const url = reply.replyTo === null ? `https://github.com/${reply.repo}/pull/${reply.pr}#issuecomment-${id}` : `https://github.com/${reply.repo}/pull/${reply.pr}#discussion_r${id}`
  const login = stubLogin()
  if (world.status === undefined || world.landed === true) writeFileSync(join(dir, 'posted.json'), JSON.stringify([...list, { ...reply, login, url }]))
  if (world.status !== undefined) fail(`gh: Server Error (HTTP ${world.status})`)
  process.stdout.write(JSON.stringify({ id, html_url: url, body: reply.body, user: { login } }))
}
