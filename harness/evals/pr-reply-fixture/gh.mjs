#!/usr/bin/env node
// The stand-in gh of the pr-reply-* eval cases. pull.cjs copies it into <project>/.git/eval-gh/ next to pull.json, the
// invented pull request octo-org/ledger#7, and puts that folder first on the PATH of the run's shells. Nothing reaches
// GitHub:
//
//   gh pr view <n> [--repo o/r] [--json a,b]   — the pull request of pull.json, the fields asked for
//   gh pr diff <n> [--repo o/r]                — its diff
//   gh api graphql -f query=<a query that reads reviewThreads> [-f owner= -f name= -F number=]
//                                              — viewer, headRefOid, the review threads and the conversation comments
//   gh --version, gh auth status               — a harmless answer
//   a write                                    — refused, exit 1: a mutation, `api` with a method other than GET or
//                                                with fields on a REST path, `pr review|comment|merge|create|edit|close|
//                                                reopen|ready`, `issue create|comment|edit|close|reopen`, `release`,
//                                                `repo create|edit|delete|fork|rename`
//   anything else                              — refused, exit 1
//
// Every call is one line of <project>/gh-calls.log: `answered <what>`, `WRITE <args>` or `REFUSED <args>`. A query is
// logged by its operation name only, never with a text of the pull request.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..', '..')
const pull = JSON.parse(readFileSync(join(here, 'pull.json'), 'utf8'))
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

/** The pull request a `pr view|diff <n>` names: its number or link, and `--repo` when given. */
const named = () => {
  const number = /^(?:.*\/pull\/)?#?(\d+)$/.exec(args[2] ?? '')?.[1]
  const repo = option('--repo') ?? option('-R')
  if (number !== String(pull.number) || (repo !== undefined && repo.toLowerCase() !== `${pull.owner}/${pull.name}`)) {
    log(`answered pr ${args[1]} ${args[2] ?? ''} not found`)
    process.stderr.write(`GraphQL: Could not resolve to a PullRequest with the number of ${args[2] ?? ''}. (repository.pullRequest)\n`)
    process.exit(1)
  }
  return number
}

if (args[0] === 'pr' && args[1] === 'view') {
  const number = named()
  const wanted = option('--json')
  const out = wanted === undefined ? pull.view : Object.fromEntries(wanted.split(',').filter((k) => k in pull.view).map((k) => [k, pull.view[k]]))
  log(`answered pr view ${number}`)
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'diff') {
  const number = named()
  log(`answered pr diff ${number}`)
  process.stdout.write(pull.diff)
  process.exit(0)
}

if (args[0] === 'api' && args[1] === 'graphql') {
  const f = fields()
  const query = f.query ?? ''
  if (!/\breviewThreads\b/.test(query)) refuse(false)
  const op = /^\s*query\s+([A-Za-z_]\w*)/.exec(query)?.[1] ?? 'query'
  const owner = f.owner ?? pull.owner
  const name = f.name ?? pull.name
  if (owner.toLowerCase() !== pull.owner || name.toLowerCase() !== pull.name || (f.number !== undefined && f.number !== String(pull.number))) {
    log(`answered ${op} not found`)
    process.stderr.write(`GraphQL: Could not resolve to a Repository with the name ${owner}/${name}. (repository)\n`)
    process.exit(1)
  }
  log(`answered ${op}`)
  const data = {
    viewer: { login: pull.viewer },
    repository: {
      pullRequest: {
        number: pull.number,
        headRefOid: pull.view.headRefOid,
        author: pull.view.author,
        reviewThreads: { pageInfo: { hasNextPage: false, endCursor: 'end' }, nodes: pull.threads },
        comments: { pageInfo: { hasNextPage: false, endCursor: 'end' }, nodes: pull.conversation },
      },
    },
  }
  process.stdout.write(`${JSON.stringify({ data })}\n`)
  process.exit(0)
}

refuse(false)
