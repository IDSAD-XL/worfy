#!/usr/bin/env node
// The stand-in gh of the human-review-setup-* eval cases. history.cjs copies it into <project>/.git/eval-gh/ next to
// history.json, the invented review history of quillwork/ledger, and puts that folder first on the PATH of the run's
// shells. Nothing reaches GitHub:
//
//   gh api graphql -f query=query ReviewHistory… — the GraphQL answers bin/review-history reads, as `gh api --include`
//                                                  gives them: the whole history on one page
//   gh pr view <n> [--json a,b]                  — the pull request of history.json, the fields asked for
//   gh --version, gh auth status                 — a harmless answer
//   a write                                      — refused, exit 1: a mutation, `api` with a method other than GET or
//                                                  with fields, `pr review|comment|merge|create|edit|close|reopen|ready`,
//                                                  `issue create|comment|edit|close`, `release`, `repo create|edit|delete`
//   anything else                                — refused, exit 1
//
// Every call is one line of <project>/gh-calls.log: `answered <what>`, `WRITE <args>` or `REFUSED <args>`. A query is
// logged by its operation name only, never with a text of the history.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..', '..')
const history = JSON.parse(readFileSync(join(here, 'history.json'), 'utf8'))
const args = process.argv.slice(2)
const log = (line) => appendFileSync(join(project, 'gh-calls.log'), `${line}\n`)
const shown = () => args.map((a) => (a.length > 60 ? `${a.slice(0, 57)}...` : a)).join(' ')

/** The value of `-f k=v`, `-F k=v`, `--field k=v`, `--raw-field k=v` arguments. */
const fields = () => {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    if (['-f', '-F', '--field', '--raw-field'].includes(args[i]) && i + 1 < args.length) {
      const at = args[i + 1].indexOf('=')
      if (at > 0) out[args[i + 1].slice(0, at)] = args[i + 1].slice(at + 1)
    }
  }
  return out
}
const option = (name) => {
  const at = args.indexOf(name)
  if (at >= 0) return args[at + 1]
  const joined = args.find((a) => a.startsWith(`${name}=`))
  return joined === undefined ? undefined : joined.slice(name.length + 1)
}

function refuse(write) {
  log(`${write ? 'WRITE' : 'REFUSED'} ${shown()}`)
  process.stderr.write(write ? 'gh stand-in of the eval: a write to GitHub is refused\n' : 'gh stand-in of the eval: not answered offline\n')
  process.exit(1)
}

const isWrite = () => {
  const [command, sub] = args
  if (command === 'api') {
    const method = (option('-X') ?? option('--method') ?? 'GET').toUpperCase()
    if (method !== 'GET') return true
    if (args[1] === 'graphql') return /^\s*mutation\b/.test(fields().query ?? '')
    return args.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a))
  }
  if (command === 'pr') return ['review', 'comment', 'merge', 'create', 'edit', 'close', 'reopen', 'ready'].includes(sub)
  if (command === 'issue') return ['create', 'comment', 'edit', 'close', 'reopen'].includes(sub)
  if (command === 'release') return sub !== 'list' && sub !== 'view'
  if (command === 'repo') return ['create', 'edit', 'delete', 'fork', 'rename'].includes(sub)
  return false
}

if (isWrite()) refuse(true)

if (args[0] === '--version') {
  log('answered --version')
  process.stdout.write('gh version 2.0.0 (eval stand-in)\n')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  log('answered auth status')
  process.stdout.write('github.com\n  Logged in to github.com (eval stand-in)\n')
  process.exit(0)
}

if (args[0] === 'api' && args[1] === 'graphql') {
  const f = fields()
  const op = /^\s*query\s+(ReviewHistory[A-Za-z]*)/.exec(f.query ?? '')?.[1]
  if (op === undefined) refuse(false)
  const ok = (data) => {
    log(`answered ${op}`)
    process.stdout.write(`HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nX-Ratelimit-Remaining: 4990\r\n\r\n${JSON.stringify({ data })}\n`)
    process.exit(0)
  }
  const empty = { pageInfo: { hasNextPage: false, endCursor: 'end' }, nodes: [] }
  if (op === 'ReviewHistoryThreadComments') ok({ node: { comments: empty } })
  if (f.owner !== history.owner || f.name !== history.name) {
    log(`answered ${op} not found`)
    process.stdout.write(`HTTP/2.0 200 OK\r\n\r\n${JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: `Could not resolve to a Repository with the name ${f.owner}/${f.name}.` }] })}\n`)
    process.stderr.write(`GraphQL: Could not resolve to a Repository with the name ${f.owner}/${f.name}. (repository)\n`)
    process.exit(1)
  }
  if (op === 'ReviewHistoryPage') ok({ repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: 'end' }, nodes: history.pulls } } })
  const key = { ReviewHistoryReviews: 'reviews', ReviewHistoryThreads: 'reviewThreads', ReviewHistoryComments: 'comments' }[op]
  if (key !== undefined) ok({ repository: { pullRequest: { [key]: empty } } })
  refuse(false)
}

if (args[0] === 'pr' && args[1] === 'view') {
  const number = /^(?:.*\/pull\/)?#?(\d+)$/.exec(args[2] ?? '')?.[1]
  const view = number === undefined ? undefined : history.views[number]
  if (view === undefined) {
    log(`answered pr view ${args[2] ?? ''} not found`)
    process.stderr.write(`GraphQL: Could not resolve to a PullRequest with the number of ${args[2] ?? ''}. (repository.pullRequest)\n`)
    process.exit(1)
  }
  const wanted = option('--json')
  const out = wanted === undefined ? view : Object.fromEntries(wanted.split(',').filter((k) => k in view).map((k) => [k, view[k]]))
  log(`answered pr view ${number}`)
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  process.exit(0)
}

refuse(false)
