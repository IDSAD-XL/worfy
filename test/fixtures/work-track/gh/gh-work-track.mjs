// A stand-in for `gh` (WORFY_GH) in test/contract/work-track-github.test.ts (worfy-work-track ticket 06): answers
// the two questions of the Work track reader from a synthetic repository, never reaches GitHub. A Node script,
// which worfy starts under its own Node on every system (src/main/program.ts).
//
// - WT_GH_DATA: a JSON file `{ "repo": "<owner>/<name>", "prs": [...], "runs": [...] }`. A PR is
//   `{ number, title, headRefName, createdAt, mergedAt, mergeOid, headOid }`; a run is a workflow run as the
//   REST API gives it (`id`, `name`, `head_branch`, `head_sha`, `status`, `conclusion`, `created_at`,
//   `run_started_at`, `updated_at`, `pull_requests`).
// - `api graphql -f query=… -f q=… [-f after=<cursor>]`: the search of merged PRs. `q` must hold
//   `repo:<repo> is:pr is:merged merged:<from>..<to>` (both ends included); the page size is the `first:` of the
//   query; the cursor is the offset of the next page. Answers `{ data: { search: { issueCount, pageInfo, nodes } } }`.
// - `api repos/<repo>/actions/runs?created=<from>..<to>&per_page=<n>&page=<p>`: the runs created in that range,
//   newest first, as `{ total_count, workflow_runs }`.
// - WT_GH_LOG: a file; each call appends `{"token", "args"}` as one JSON line, `token` being GH_TOKEN or null.
// - WT_GH_ACCOUNT, WT_GH_TOKEN: `auth token -u <WT_GH_ACCOUNT>` prints WT_GH_TOKEN; any other login fails.
// - WT_GH_FAIL: a file; while it exists, a call but `auth token` one of whose arguments contains its first line
//   prints the rest of the file to stderr and exits 1 (an empty first line matches every call).
// Any other command exits 2.
import { appendFileSync, existsSync, readFileSync, writeSync } from 'node:fs'
import process from 'node:process'
import { URL } from 'node:url'

const args = process.argv.slice(2)
const env = process.env
// Written with writeSync: the process ends right after, and a pipe on macOS is written asynchronously.
const out = (text) => writeSync(1, text)
const fail = (text, code = 1) => {
  writeSync(2, `${text}\n`)
  process.exit(code)
}
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
/** The values of `-f name=value`, by name. */
const fields = () => {
  const result = {}
  args.forEach((arg, index) => {
    if (arg !== '-f') return
    const value = args[index + 1] ?? ''
    const at = value.indexOf('=')
    result[value.slice(0, at)] = value.slice(at + 1)
  })
  return result
}
/** `<from>..<to>` as milliseconds, both ends included. */
const range = (text) => {
  const [from, to] = text.split('..')
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) fail(`gh stand-in: not a range: ${text}`, 2)
  return { start, end }
}

if (env.WT_GH_LOG) appendFileSync(env.WT_GH_LOG, `${JSON.stringify({ token: env.GH_TOKEN ?? null, args })}\n`)
const command = `${args[0] ?? ''} ${args[1] ?? ''}`
if (command !== 'auth token' && env.WT_GH_FAIL && existsSync(env.WT_GH_FAIL)) {
  const [match = '', ...text] = readFileSync(env.WT_GH_FAIL, 'utf8').split('\n')
  if (args.some((arg) => arg.includes(match))) fail(text.join('\n').trim())
}
const data = () => JSON.parse(readFileSync(env.WT_GH_DATA, 'utf8'))

if (command === 'auth token') {
  if (option('-u') !== env.WT_GH_ACCOUNT || !env.WT_GH_TOKEN) fail(`no oauth token found for github.com account ${option('-u') ?? ''}`)
  out(`${env.WT_GH_TOKEN}\n`)
} else if (command === 'api graphql') {
  const { query = '', q = '', after } = fields()
  const { repo, prs } = data()
  const merged = /(?:^| )merged:(\S+)/.exec(q)
  if (!q.includes(`repo:${repo}`) || !/(?:^| )is:pr(?: |$)/.test(q) || !/(?:^| )is:merged(?: |$)/.test(q) || !merged) fail(`gh stand-in: unsupported search: ${q}`, 2)
  const first = Number(/first:\s*(\d+)/.exec(query)?.[1] ?? 'NaN')
  if (!(first > 0 && first <= 100)) fail('gh stand-in: the search asks for no page size of 1 to 100', 2)
  const { start, end } = range(merged[1])
  const found = prs.filter((pr) => Date.parse(pr.mergedAt) >= start && Date.parse(pr.mergedAt) <= end).sort((a, b) => b.number - a.number)
  const offset = after === undefined ? 0 : Number(after)
  const page = found.slice(offset, offset + first)
  const next = offset + page.length
  const nodes = page.map((pr) => ({
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    mergeCommit: { oid: pr.mergeOid },
    commits: { nodes: [{ commit: { oid: pr.headOid } }] },
  }))
  out(JSON.stringify({ data: { search: { issueCount: found.length, pageInfo: { hasNextPage: next < found.length, endCursor: String(next) }, nodes } } }))
} else if (command.startsWith('api repos/')) {
  const { repo, runs } = data()
  const url = new URL(args[1], 'https://api.github.invalid/')
  if (url.pathname !== `/repos/${repo}/actions/runs`) fail(`gh stand-in: unsupported endpoint: ${args[1]}`, 2)
  const created = url.searchParams.get('created')
  if (created === null) fail('gh stand-in: runs without created=', 2)
  const { start, end } = range(created)
  const perPage = Number(url.searchParams.get('per_page') ?? 30)
  const page = Number(url.searchParams.get('page') ?? 1)
  const found = runs.filter((run) => Date.parse(run.created_at) >= start && Date.parse(run.created_at) <= end).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  out(JSON.stringify({ total_count: found.length, workflow_runs: found.slice((page - 1) * perPage, page * perPage) }))
} else fail(`gh stand-in: unsupported command: ${args.join(' ')}`, 2)
