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
//     `gh api repos/<owner>/<repo> [--hostname <h>]` answers to the token of that login — `permissions.push` (with
//     `--jq .permissions.push`: null as `null`, a text as it is), or a failure with that status. A login it does not name gets 404, as GitHub answers for a private
//     repository the account cannot see. The token is the one gh reads for the host (hostToken): GH_TOKEN for
//     github.com, GH_ENTERPRISE_TOKEN for a GitHub Enterprise Server host; without one, the host's active account.
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
//     A pull of graphql.json with `"hidden": true` sits in a repository the token cannot see: its alias is null and
//     the error is "Could not resolve to a Repository with the name …", as GitHub answers for a private one.
//     The files Viewed on github.com (worfy-pr-review ticket 09, `viewerViewedState`, variables `owner`, `name`, `pr`)
//     come from the pull's `"viewed": {"<path>": "VIEWED"|"UNVIEWED"|"DISMISSED"}`, one page; a PR it does not know is null.
//   - graphql-503: a number; that many `api graphql` calls fail with HTTP 503 first, one less each time.
//   - search.json: what the PR search (worfy-pr-review ticket 04, `search(type: ISSUE, query: $q, …)`) answers, `{"viewer"?
//     (graphql.json's), "rateLimit"?, "answers": [{"q": <the exact search string>, "after"?: <the cursor asked, null for
//     the first page>, "status"?: <HTTP status, 200>, "headers"?: {<extra headers>}, "message"?, "errors"?: [<GraphQL
//     errors>], "noData"?: true, "issueCount"?, "nodes"?: [{"repo", "number", "updatedAt"}], "endCursor"?,
//     "hasNextPage"?}]}`. A search none names answers no results. A status above 299 prints `{"message"}` as the body
//     and `gh: <message> (HTTP <status>)` on stderr and exits 1; `errors` go with the data and exit 1 with "GraphQL: …"
//     as gh does. With `-i` (any `api graphql` call) the status line and the headers come first, as gh prints them.
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
//     `threads`, with `first` its first comment, the databaseId there) and of a PR's conversation, are answered from
//     posted.json, with `viewer` the same login.
//
//   - reviews.json: a world where worfy may submit a review (worfy-pr-review ticket 11), `{"status"?, "landed"?,
//     "message"?, "existing"?: [<a review as GitHub lists it>]}`. Without the file a review is a write like any other
//     (below). Exactly one call is understood: `api --method POST repos/<o>/<r>/pulls/<n>/reviews --input <file>`, and
//     nothing else in it. The review goes into posted-reviews.json next to it, `[{"repo", "pr", "login", "raw" (the
//     bytes of the file as they are), "url", "id"}]`, the login by GH_TOKEN (tokens.json), and the call prints the
//     review GitHub creates (`id`, `html_url`, `user.login`, `body`, `state`, `commit_id`). With `status` the call fails
//     with that HTTP status, as gh does — `message` on stdout as GitHub's `{"message"}` — and posts nothing, unless
//     `landed` is true: then the review is posted although gh fails (an answer lost on the way). The read
//     `api repos/<o>/<r>/pulls/<n>/reviews?per_page=100&page=<k>` lists `existing`, then the reviews posted (with
//     `submitted_at` the time of the POST), 100 a page; `api repos/<o>/<r>/pulls/<n>/reviews/<id>/comments?per_page=100&page=<k>`
//     lists the line comments of one: `comments` of an `existing` review (`[{"path", "line", "body"}]`, not listed with
//     the review itself), the comments of the body posted for a posted one. The details query of the PR then holds a
//     posted Approve or Request changes in `latestOpinionatedReviews`.
//
//   - pulls.json: single PRs as `gh pr view <N> [--repo <owner>/<repo>] --json …` and `gh pr diff <N> [--repo …]` read
//     them (worfy-code-stories ticket 11), `{"<owner>/<repo>#<N>": {"view": {<the JSON fields of gh pr view>}, "diff":
//     "<the diff>"}}`. Without --repo the one PR of that number is taken. `pr view` prints `view` whole, whatever
//     --json asks; a PR the file does not hold fails as gh does ("no pull requests found").
//
//   - `auth status` without flags (worfy-auth-check ticket 05), as gh 2.97 prints it from auth-status.json and the
//     environment: with GH_TOKEN (or GITHUB_TOKEN) set and not empty, first its entry — "account <login> (GH_TOKEN)"
//     when tokens.json names that token, else "X Failed to log in … using token (GH_TOKEN)" — as the active one, then
//     the stored accounts, not active. Any failed entry prints the whole text to stderr and exits 1, as gh does; no
//     entry at all prints "You are not logged into any GitHub hosts" to stderr, exit 1.
//   - `api -i repos/<owner>/<repo>` (ticket 05): as gh prints `-i`, the status line, headers, blank line, body, from
//     repos.json for the login of GH_TOKEN — 200 with the repository for a boolean or null, the status for a number
//     (5xx too). A GH_TOKEN that tokens.json does not name is 401 "Bad credentials"; without GH_TOKEN the active
//     account of auth-status.json answers, and with none gh's "gh auth login" text, exit 4. Above 299 gh's line on
//     stderr and exit 1. The body carries GH_TOKEN as `stub_token` and the token of every login as `stub_tokens`,
//     so a test can tell that worfy never shows what gh printed.
//   - rest.json: REST reads of a pull request's diff (worfy-pr-review ticket 06), `{"<path with its query>": <body>}`:
//     `api repos/<o>/<r>/pulls/<n>/files?per_page=100&page=<k>`, `…/pulls/<n>/commits?…`, `…/commits/<sha>?…` and
//     `…/compare/<a>...<b>` with exactly one argument after `api`, answered with the body named by that path, as JSON.
//     A path the file does not name fails with HTTP 404, as GitHub answers for a PR or a commit it does not know.
//   - offline: when it exists, every `api` call fails as gh does without a network ("error connecting to
//     api.github.com", exit 1); the local commands (`auth status`, `auth token`) still answer.
//   - hang-leak: when it exists, every `api` call prints to stderr one line with GH_TOKEN and the proxy URL that
//     hang-leak names (its text, a password in it) and never exits, so the caller's time limit ends it with what
//     that first line said (ghRunner rejects with it): a test can tell that worfy redacts it.
//
// Never a write: a `--method`/`-X` other than GET (`--method=PATCH` and `-XPATCH` too), a GraphQL `mutation`, or, on
// a REST call, a field or an input (`-f`, `-F`, `--field`, `--raw-field`, `--input`, which make gh send a POST)
// exits 2 (after its line in the log).
//
// Understood (worfy-week ticket 01, worfy-harness ticket 25): `pr view` and `pr diff` from pulls.json; `pr list` with --limit (default 30, as
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
} else if (command === 'auth status' && args.length === 2) {
  authStatusText()
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
} else if (command === 'pr view' || command === 'pr diff') {
  const pulls = read('pulls.json', {})
  const repo = option('--repo')
  const key = repo === undefined ? Object.keys(pulls).find((name) => name.endsWith(`#${args[2]}`)) : `${repo}#${args[2]}`
  const pull = key === undefined ? undefined : pulls[key]
  if (pull === undefined) fail(`no pull requests found for ${args[2] ?? ''}`)
  process.stdout.write(command === 'pr view' ? JSON.stringify(pull.view) : pull.diff)
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
} else if (args[0] === 'api' && dir && existsSync(join(dir, 'hang-leak'))) {
  const proxy = readFileSync(join(dir, 'hang-leak'), 'utf8').trim()
  process.stderr.write(`Get "https://api.github.com/${args.at(-1) ?? ''}": proxyconnect tcp: dial ${proxy} (Authorization: token ${process.env.GH_TOKEN ?? ''})\n`)
  await sleep(600_000)
} else if (args[0] === 'api' && dir && existsSync(join(dir, 'offline'))) {
  fail('error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com')
} else if (replyPost() !== null) {
  postReply(replyPost())
} else if (reviewPost() !== null) {
  postReview(reviewPost())
} else if (reviewList() !== null) {
  listReviews(reviewList())
} else if (reviewCommentsList() !== null) {
  listReviewComments(reviewCommentsList())
} else if (args[0] === 'api' && (/^(GET)?$/i.test(option('--method') ?? option('-X') ?? '') === false || args.some(writeArg) || args.some((arg) => /\bmutation\b/.test(arg)))) {
  fail(`gh stub: a write is never expected: ${args.join(' ')}`, 2)
} else if (args[0] === 'api' && args[1] === 'graphql' && inboxQuery()) {
  graphql()
} else if (args[0] === 'api' && args.includes('-i') && args.some((arg) => /^notifications(\?|$)/.test(arg))) {
  notifications()
} else if (args[0] === 'api' && args.length === 3 && args[1] === '-i' && /^repos\/[^/\s]+\/[^/\s]+$/.test(args[2])) {
  repoWithHeaders(args[2].slice('repos/'.length))
} else if (args[0] === 'api' && args.length === 2 && /^repos\/[^/\s]+\/[^/\s]+\/(?:pulls|commits|compare)\//.test(args[1])) {
  const answers = read('rest.json', {})
  if (!Object.hasOwn(answers, args[1])) fail('gh: Not Found (HTTP 404)')
  process.stdout.write(JSON.stringify(answers[args[1]]))
} else if (args[0] === 'api' && /^repos\/[^/\s]+\/[^/\s]+$/.test(args[1] ?? '')) {
  const slug = args[1].slice('repos/'.length)
  const tokens = read('tokens.json', {})
  // As gh: the token of the asked host's variable, else that host's active account (worfy-polish 148).
  const host = (option('--hostname') ?? 'github.com').toLowerCase()
  const fromEnv = hostToken(host)
  const login = fromEnv !== null ? Object.keys(tokens).find((name) => tokens[name] === fromEnv) : (read('auth-status.json', { hosts: {} }).hosts[host] ?? []).find((entry) => entry.active === true && entry.state === 'success')?.login
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
  if (query.includes('search(type: ISSUE, query: $q')) {
    prSearch(vars, world, rateLimit)
    return
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
    const first = { nodes: [{ databaseId: replyTo }] }
    process.stdout.write(JSON.stringify({ data: { viewer: { login: stubLogin() }, node: nodes === null ? null : { first, comments: { nodes: nodes.map(commentNode) } } } }))
    return
  }
  if (query.includes('viewerViewedState')) {
    const pull = world.pulls.find((each) => each.repo === `${vars.owner}/${vars.name}` && each.number === Number(vars.pr))
    const nodes = Object.entries(pull?.viewed ?? {}).map(([path, state]) => ({ path, viewerViewedState: state }))
    const pullRequest = pull === undefined ? null : { files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } }
    process.stdout.write(JSON.stringify({ data: { repository: { pullRequest } } }))
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
      if (pull?.hidden === true) {
        data[`p${n}`] = null
        errors.push({ type: 'NOT_FOUND', path: [`p${n}`], message: `Could not resolve to a Repository with the name '${slug}'.` })
      } else if (pull === undefined || pull.missing === true) {
        data[`p${n}`] = { pullRequest: null }
        errors.push({ type: 'NOT_FOUND', path: [`p${n}`, 'pullRequest'], message: `Could not resolve to a PullRequest with the number of ${vars[key]}.` })
      } else data[`p${n}`] = { pullRequest: { number: pull.number, updatedAt: pull.updatedAt, headRefOid: pull.headRefOid, ...withPostedReviews(pull) } }
    }
    graphqlAnswer({ data, ...(errors.length > 0 ? { errors } : {}) }, rateLimit)
    return
  }
  fail(`gh stub: unsupported GraphQL query: ${query.slice(0, 80)}`, 2)
}

/**
 * Prints a GraphQL answer as gh does: with `-i`, the status line and the headers first; a status above 299 — the
 * body, then `gh: <message> (HTTP <status>)` on stderr, exit 1; GraphQL errors — the body, then "GraphQL: …", exit 1.
 */
function graphqlAnswer(body, rateLimit, status = 200, extra = {}) {
  if (args.includes('-i')) {
    const reasons = { 200: 'OK', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 502: 'Bad Gateway' }
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Ratelimit-Limit': String(rateLimit.limit),
      'X-Ratelimit-Remaining': String(rateLimit.remaining),
      'X-Ratelimit-Reset': String(Math.floor(Date.parse(rateLimit.resetAt) / 1000)),
      'X-Ratelimit-Resource': 'graphql',
      ...extra,
    }
    process.stdout.write(`HTTP/2.0 ${status} ${reasons[status] ?? 'Unknown'}\n`)
    for (const name of Object.keys(headers).sort()) process.stdout.write(`${name}: ${headers[name]}\r\n`)
    process.stdout.write('\r\n')
  }
  process.stdout.write(JSON.stringify(body))
  // As gh: an answer with GraphQL errors exits 1 and names the first one on stderr, the data on stdout all the same.
  const reason = status > 299 ? `gh: ${body.message ?? 'HTTP error'} (HTTP ${status})` : body.errors?.length > 0 ? `GraphQL: ${body.errors[0].message}${body.errors[0].path ? ` (${body.errors[0].path.join('.')})` : ''}` : null
  if (reason === null) return
  // Exit code 1 without process.exit, so stdout, which may be written later on a pipe, is not cut off.
  process.stderr.write(`${reason}\n`)
  process.exitCode = 1
}

/** The PR search of worfy-pr-review ticket 04: the answer search.json gives the search string and cursor. */
function prSearch(vars, world, rateLimit) {
  const searches = read('search.json', { answers: [] })
  const rate = searches.rateLimit ?? rateLimit
  const answer = searches.answers.find((each) => each.q === vars.q && (each.after ?? null) === (vars.cursor ?? null)) ?? {}
  const status = answer.status ?? 200
  if (status > 299) return graphqlAnswer({ message: answer.message ?? 'HTTP error', documentation_url: 'https://docs.github.com/graphql' }, rate, status, answer.headers)
  const nodes = (answer.nodes ?? []).map((node) => ({ number: node.number, updatedAt: node.updatedAt, repository: { nameWithOwner: node.repo } }))
  const search = { issueCount: answer.issueCount ?? nodes.length, pageInfo: { hasNextPage: answer.hasNextPage ?? false, endCursor: answer.endCursor ?? null }, nodes }
  const data = answer.noData === true ? null : { viewer: { login: searches.viewer ?? world.viewer }, rateLimit: rate, search }
  graphqlAnswer({ data, ...(answer.errors ? { errors: answer.errors } : {}) }, rate, status, answer.headers)
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
  return (query.includes('review: search(') && query.includes('involves: search(')) || query.includes('search(type: ISSUE, query: $q') || query.includes('pullRequest(number: $k0)') || query.includes('node(id: $thread)') || query.includes('pullRequest(number: $number)') || query.includes('viewerViewedState')
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

/** The reviews posted so far (posted-reviews.json). */
function postedReviews() {
  return read('posted-reviews.json', [])
}

/**
 * The review this call submits, when it is the one call worfy may make for it and reviews.json lets it: its
 * repository, PR and the file of its body. Null for any other call, which the write check then refuses.
 */
function reviewPost() {
  if (!dir || !existsSync(join(dir, 'reviews.json'))) return null
  if (args.length !== 6 || args[0] !== 'api' || args[1] !== '--method' || args[2] !== 'POST' || args[4] !== '--input') return null
  const match = /^repos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/reviews$/.exec(args[3])
  if (match === null) return null
  return { repo: match[1], pr: Number(match[2]), file: args[5] }
}

/** Posts the review into posted-reviews.json and prints it as GitHub creates it, or fails as reviews.json says. */
function postReview(review) {
  const world = read('reviews.json', {})
  const list = postedReviews()
  const raw = readFileSync(review.file, 'utf8')
  const request = JSON.parse(raw)
  const id = 7000 + list.length + 1
  const url = `https://github.com/${review.repo}/pull/${review.pr}#pullrequestreview-${id}`
  const login = stubLogin()
  if (world.status === undefined || world.landed === true) writeFileSync(join(dir, 'posted-reviews.json'), JSON.stringify([...list, { repo: review.repo, pr: review.pr, login, raw, url, id, at: new Date().toISOString() }]))
  if (world.status !== undefined) {
    if (world.message !== undefined) process.stdout.write(JSON.stringify({ message: world.message, documentation_url: 'https://docs.github.com/rest' }))
    fail(`gh: ${world.message ?? 'Server Error'} (HTTP ${world.status})`)
  }
  process.stdout.write(JSON.stringify(reviewOf({ login, raw, url, id, at: new Date().toISOString() }, request)))
}

/** A review as GitHub gives it, of a body worfy sent. */
function reviewOf(each, request = JSON.parse(each.raw)) {
  const state = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }[request.event] ?? 'PENDING'
  return { id: each.id, user: { login: each.login }, body: request.body ?? '', state, html_url: each.url, commit_id: request.commit_id, submitted_at: each.at ?? null }
}

/**
 * The details of `pull` (its `pull` of graphql.json) with the Approve and Request changes posted to it since
 * (posted-reviews.json) in `latestOpinionatedReviews`, as GitHub then lists them: the poster's earlier one replaced.
 */
function withPostedReviews(pull) {
  const posted = existsSync(join(dir, 'reviews.json')) ? postedReviews().filter((each) => each.repo === pull.repo && each.pr === pull.number) : []
  if (posted.length === 0) return pull.pull
  let nodes = pull.pull.latestOpinionatedReviews?.nodes ?? []
  for (const each of posted) {
    const review = reviewOf(each)
    if (review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED') continue
    nodes = [...nodes.filter((node) => node.author?.login !== each.login), { author: { login: each.login }, state: review.state, submittedAt: new Date().toISOString(), authorCanPushToRepository: true, commit: { oid: review.commit_id } }]
  }
  return { ...pull.pull, latestOpinionatedReviews: { nodes } }
}

/** The PR and page of a read of its reviews, when reviews.json is there; null for any other call. */
function reviewList() {
  if (!dir || !existsSync(join(dir, 'reviews.json')) || args.length !== 2 || args[0] !== 'api') return null
  const match = /^repos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/reviews\?per_page=100&page=(\d+)$/.exec(args[1])
  return match === null ? null : { repo: match[1], pr: Number(match[2]), page: Number(match[3]) }
}

/** The review and page of a read of its line comments, when reviews.json is there; null for any other call. */
function reviewCommentsList() {
  if (!dir || !existsSync(join(dir, 'reviews.json')) || args.length !== 2 || args[0] !== 'api') return null
  const match = /^repos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/reviews\/(\d+)\/comments\?per_page=100&page=(\d+)$/.exec(args[1])
  return match === null ? null : { repo: match[1], pr: Number(match[2]), id: Number(match[3]), page: Number(match[4]) }
}

/** The line comments of a review: `comments` of an `existing` one, those of the body posted for a posted one; a page of 100. */
function listReviewComments(asked) {
  const world = read('reviews.json', {})
  const existing = (world.existing ?? []).find((each) => each.id === asked.id)
  const posted = postedReviews().find((each) => each.repo === asked.repo && each.pr === asked.pr && each.id === asked.id)
  if (existing === undefined && posted === undefined) fail('gh: Not Found (HTTP 404)')
  const comments = (existing !== undefined ? (existing.comments ?? []) : (JSON.parse(posted.raw).comments ?? [])).map((each, at) => ({ id: asked.id * 1000 + at, pull_request_review_id: asked.id, path: each.path, line: each.line ?? null, body: each.body }))
  process.stdout.write(JSON.stringify(comments.slice((asked.page - 1) * 100, asked.page * 100)))
}

/** A review of `existing` as GitHub lists it: its line comments come from their own endpoint. */
function withoutComments(review) {
  const listed = { ...review }
  delete listed.comments
  return listed
}

/** `existing` (without their `comments`), then the reviews posted to that PR, a page of 100. */
function listReviews(asked) {
  const world = read('reviews.json', {})
  const all = [...(world.existing ?? []).map((review) => withoutComments(review)), ...postedReviews().filter((each) => each.repo === asked.repo && each.pr === asked.pr).map((each) => reviewOf(each))]
  process.stdout.write(JSON.stringify(all.slice((asked.page - 1) * 100, asked.page * 100)))
}

/** The token gh takes from its environment for github.com: GH_TOKEN, then GITHUB_TOKEN; an empty one is unset. */
function environmentToken() {
  if (process.env.GH_TOKEN) return { variable: 'GH_TOKEN', token: process.env.GH_TOKEN }
  if (process.env.GITHUB_TOKEN) return { variable: 'GITHUB_TOKEN', token: process.env.GITHUB_TOKEN }
  return null
}

/**
 * The token gh takes from its environment for a call to `host`: GH_TOKEN, then GITHUB_TOKEN for github.com and
 * `*.ghe.com`; GH_ENTERPRISE_TOKEN, then GITHUB_ENTERPRISE_TOKEN for a GitHub Enterprise Server host, which never
 * reads GH_TOKEN. An empty one is unset.
 */
function hostToken(host) {
  if (host === 'github.com' || host.endsWith('.ghe.com')) return environmentToken()?.token ?? null
  return process.env.GH_ENTERPRISE_TOKEN || process.env.GITHUB_ENTERPRISE_TOKEN || null
}

/** `auth status` without flags, as gh 2.97 prints it (fixtures of worfy-auth-check ticket 01). */
function authStatusText() {
  const tokens = read('tokens.json', {})
  const stored = read('auth-status.json', { hosts: {} }).hosts['github.com'] ?? []
  const fromEnv = environmentToken()
  const blocks = []
  let failed = false
  if (fromEnv !== null) {
    const login = Object.keys(tokens).find((name) => tokens[name] === fromEnv.token)
    if (login === undefined) {
      failed = true
      blocks.push([`  X Failed to log in to github.com using token (${fromEnv.variable})`, '  - Active account: true', `  - The token in ${fromEnv.variable} is invalid.`])
    } else blocks.push([`  ✓ Logged in to github.com account ${login} (${fromEnv.variable})`, '  - Active account: true', '  - Git operations protocol: https', '  - Token: gho_************************************'])
  }
  for (const entry of stored) {
    const active = fromEnv === null && entry.active === true
    if (entry.state === 'success') blocks.push([`  ✓ Logged in to github.com account ${entry.login} (keyring)`, `  - Active account: ${String(active)}`, '  - Git operations protocol: https', '  - Token: gho_************************************'])
    else {
      failed = true
      blocks.push([`  X Failed to log in to github.com account ${entry.login} (keyring)`, `  - Active account: ${String(active)}`, '  - The token in keyring is invalid.'])
    }
  }
  if (blocks.length === 0) fail('You are not logged into any GitHub hosts. To log in, run: gh auth login')
  const text = `github.com\n${blocks.map((lines) => lines.join('\n')).join('\n\n')}\n`
  if (failed) {
    process.stderr.write(text)
    process.exit(1)
  }
  process.stdout.write(text)
}

/** `api -i repos/<slug>`: GitHub's answer with its status line and headers, for the token gh takes. */
function repoWithHeaders(slug) {
  const reasons = { 200: 'OK', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' }
  const tokens = read('tokens.json', {})
  const fromEnv = environmentToken()
  let login
  if (fromEnv !== null) login = Object.keys(tokens).find((name) => tokens[name] === fromEnv.token)
  else {
    login = (read('auth-status.json', { hosts: {} }).hosts['github.com'] ?? []).find((entry) => entry.active === true && entry.state === 'success')?.login
    if (login === undefined) fail('To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.', 4)
  }
  const answers = read('repos.json', {})[slug] ?? {}
  const answer = login === undefined ? 401 : !Object.hasOwn(answers, login) ? 404 : answers[login]
  const status = typeof answer === 'number' ? answer : 200
  const leak = { stub_token: fromEnv?.token ?? null, stub_tokens: Object.values(tokens) }
  const message = status === 401 ? 'Bad credentials' : status === 404 ? 'Not Found' : status >= 500 ? 'Server Error' : 'Forbidden'
  const body = status === 200 ? { full_name: slug, permissions: { push: answer === true, pull: true }, ...leak } : { message, documentation_url: 'https://docs.github.com/rest', status: String(status), ...leak }
  process.stdout.write(`HTTP/2.0 ${status} ${reasons[status] ?? 'Unknown'}\nContent-Type: application/json; charset=utf-8\r\nX-Github-Request-Id: 0000:0000\r\n\r\n${JSON.stringify(body)}`)
  if (status === 200) return
  process.stderr.write(`gh: ${message} (HTTP ${status})\n`)
  process.exitCode = 1
}
