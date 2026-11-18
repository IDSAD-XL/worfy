#!/usr/bin/env node
// The stand-in gh of the pr-fix-* eval cases, in front of the stand-in of the pr-reply cases (../../pr-reply-fixture/gh.mjs).
// pr-fix.cjs copies it into <project>/.git/eval-gh/ as gh-fix.mjs and points the `gh` wrapper there. Nothing reaches
// GitHub. It answers, from pull.json next to it:
//
//   gh pr checks <n> [--repo o/r] [--json a,b]     — the checks of the head commit (`pull.checks`); without --json a
//                                                   table, exit 1 when one failed, as gh does
//   gh run view [<run>] [--job <job>] [--log-failed|--log] [--repo o/r]
//                                                 — the log of a run or a job (`pull.runs`)
//   gh run list [--branch b] [--json a,b]          — the runs (`pull.runs`), those of one branch
//   gh api user                                    — the person's login
//   gh api repos/o/r/commits/<ref>/check-runs      — the check runs of the head of the base (`pull.baseChecks`), when
//                                                   <ref> is the base branch or its head commit
//   gh api repos/o/r/commits/<ref>/status          — no commit status
//   gh api graphql -f query=<a query of viewer only>
//                                                 — the person's login
//   --jq <filter> (-q)                             — through jq when it runs here, else the JSON as it is
//   a write gh.mjs does not know                   — refused, exit 1: `run rerun|cancel|delete`, `workflow run|enable|
//                                                   disable`, `label`, `secret`, `variable`, `cache delete`
//   anything else                                  — handed to gh.mjs of the pr-reply cases (pull request, diff, review
//                                                   threads; it refuses every other write and what it cannot answer)
//
// Every call is one line of <project>/gh-calls.log, as in gh.mjs: `answered <what>`, `WRITE <args>` or `REFUSED <args>`.
// The git hooks of the fixture add their `PUSH` and `COMMIT` lines to the same log.
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..', '..')
const pull = JSON.parse(readFileSync(join(here, 'pull.json'), 'utf8'))
const args = process.argv.slice(2)
const log = (line) => appendFileSync(join(project, 'gh-calls.log'), `${line}\n`)
const shown = () => args.map((a) => (a.length > 60 ? `${a.slice(0, 57)}...` : a)).join(' ')
const repoName = `${pull.owner}/${pull.name}`

const option = (...names) => {
  for (const name of names) {
    const at = args.indexOf(name)
    if (at >= 0) return args[at + 1]
    const joined = args.find((a) => a.startsWith(`${name}=`))
    if (joined !== undefined) return joined.slice(name.length + 1)
  }
  return undefined
}
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
/** The words of the command without its options and their values. */
const positional = () => {
  const out = []
  const valued = new Set(['--repo', '-R', '--json', '--jq', '-q', '--job', '--branch', '-b', '--limit', '-L', '--template', '-t', '-f', '-F', '--field', '--raw-field', '-X', '--method', '-H', '--header'])
  for (let i = 0; i < args.length; i++) {
    if (valued.has(args[i])) i += 1
    else if (!args[i].startsWith('-')) out.push(args[i])
  }
  return out
}

function refuse(write) {
  log(`${write ? 'WRITE' : 'REFUSED'} ${shown()}`)
  process.stderr.write(write ? 'gh stand-in of the eval: a write to GitHub is refused\n' : 'gh stand-in of the eval: not answered offline\n')
  process.exit(1)
}

/** Writes `value` as gh does: through --jq when given, else as JSON. */
function emit(value) {
  const filter = option('--jq', '-q')
  const json = `${JSON.stringify(value, null, 2)}\n`
  if (filter !== undefined) {
    const jq = spawnSync('jq', ['-r', filter], { input: json, encoding: 'utf8' })
    if (jq.error === undefined) {
      process.stdout.write(jq.stdout)
      process.stderr.write(jq.stderr)
      process.exit(jq.status ?? 1)
    }
  }
  process.stdout.write(json)
  process.exit(0)
}
/** The fields of --json, from each of `items`. */
const picked = (items) => {
  const wanted = option('--json')
  return wanted === undefined ? items : items.map((item) => Object.fromEntries(wanted.split(',').filter((k) => k in item).map((k) => [k, item[k]])))
}
const otherRepo = () => {
  const repo = option('--repo', '-R')
  return repo !== undefined && repo.toLowerCase() !== repoName
}

const [command, sub] = args
const writes = { run: ['rerun', 'cancel', 'delete'], workflow: ['run', 'enable', 'disable'], cache: ['delete'] }
if (writes[command]?.includes(sub) || ['label', 'secret', 'variable'].includes(command)) refuse(true)

if (command === 'pr' && sub === 'checks') {
  const number = /^(?:.*\/pull\/)?#?(\d+)$/.exec(positional()[2] ?? '')?.[1]
  if (number !== String(pull.number) || otherRepo()) {
    log(`answered pr checks ${positional()[2] ?? ''} not found`)
    process.stderr.write(`no pull requests found for ${positional()[2] ?? ''}\n`)
    process.exit(1)
  }
  log(`answered pr checks ${number}`)
  if (option('--json') !== undefined) emit(picked(pull.checks))
  for (const check of pull.checks) process.stdout.write(`${check.name}\t${check.bucket}\t0\t${check.link}\t${check.description}\n`)
  process.exit(pull.checks.some((check) => check.bucket === 'fail' || check.bucket === 'cancel') ? 1 : 0)
}

if (command === 'run' && (sub === 'view' || sub === 'list')) {
  if (otherRepo()) refuse(false)
  if (sub === 'list') {
    const branch = option('--branch', '-b')
    log(`answered run list${branch === undefined ? '' : ` ${branch}`}`)
    emit(picked(pull.runs.filter((run) => branch === undefined || run.headBranch === branch).map((run) => ({ ...run, jobs: undefined }))))
  }
  const job = option('--job')
  const runId = positional()[2]
  const run = pull.runs.find((r) => (job === undefined ? String(r.databaseId) === runId : r.jobs.some((j) => String(j.databaseId) === job)))
  if (run === undefined) {
    log(`answered run view ${job ?? runId ?? ''} not found`)
    process.stderr.write(`could not find any workflow run with ID ${job ?? runId ?? ''}\n`)
    process.exit(1)
  }
  const jobs = run.jobs.filter((j) => job === undefined || String(j.databaseId) === job)
  log(`answered run view ${job === undefined ? run.databaseId : `job ${job}`}`)
  if (args.includes('--log-failed') || args.includes('--log')) {
    const failedOnly = args.includes('--log-failed')
    for (const j of jobs) if (!failedOnly || j.conclusion === 'failure') process.stdout.write(j.log)
    process.exit(0)
  }
  if (option('--json') !== undefined) emit(picked([{ ...run, jobs: run.jobs.map((j) => ({ databaseId: j.databaseId, name: j.name, conclusion: j.conclusion })) }])[0])
  process.stdout.write(`${run.conclusion === 'failure' ? 'X' : '✓'} ${run.headBranch} ${run.workflowName} #${run.databaseId}\n\nJOBS\n`)
  for (const j of jobs) process.stdout.write(`${j.conclusion === 'failure' ? 'X' : '✓'} ${j.name} (ID ${j.databaseId})\n`)
  process.exit(0)
}

if (command === 'api' && !args.some((a) => /^-X./.test(a)) && (option('-X', '--method') ?? 'GET').toUpperCase() === 'GET' && !args.includes('--input')) {
  const path = (positional()[1] ?? '').replace(/^\//, '').replace(/\?.*$/, '')
  const noFields = Object.keys(fields()).length === 0
  if (path === 'user' && noFields) {
    log('answered api user')
    emit({ login: pull.viewer, type: 'User' })
  }
  const commit = new RegExp(`^repos/${pull.owner}/${pull.name}/commits/([^/]+)/(check-runs|status)$`, 'i').exec(path)
  if (commit !== null && noFields) {
    const [, ref, what] = commit
    const isBase = ref === pull.view.baseRefName || ref === pull.view.baseRefOid
    log(`answered api commits ${isBase ? 'base' : ref.slice(0, 12)} ${what}`)
    if (what === 'status') emit({ state: 'pending', total_count: 0, statuses: [] })
    const runs = isBase ? pull.baseChecks : []
    emit({ total_count: runs.length, check_runs: runs })
  }
  if (path === 'graphql') {
    const query = fields().query ?? ''
    if (!query.startsWith('@') && !/\bmutation\b/.test(query) && !/\breviewThreads\b/.test(query) && /^\s*(?:query\b[^{]*)?\{\s*viewer\s*\{\s*login\s*\}\s*\}\s*$/.test(query)) {
      log('answered graphql viewer')
      emit({ data: { viewer: { login: pull.viewer } } })
    }
  }
}

// Everything else: the stand-in of the pr-reply cases answers it, or refuses it, and logs it.
const rest = spawnSync(process.execPath, [join(here, 'gh.mjs'), ...args], { stdio: 'inherit' })
process.exit(rest.status ?? 1)
