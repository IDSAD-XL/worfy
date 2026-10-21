#!/usr/bin/env node
// node scripts/eval-outcome-check.mjs <task> [--tasks-dir <dir>] [--hidden-dir <dir>] [--judge]
//
// The free check of an outcome task against its reference solutions (harness/evals-outcome/README.md,
// "Free check against the reference solutions"). For every scripts/eval-outcome/hidden/<task>/
// reference/<name>/ it builds the run's working folder in a temporary HOME (the task's scaffold.sh,
// then the reference's apply.sh), writes a trace whose shell commands are the lines of apply.sh and
// whose final answer is answer.md, scores it with the code a real run is scored with, runs every
// regex grader of the task against answer.md, and prints one line per value:
//   <reference>  <metric | grader name>  <expected>  <actual>  ok | MISMATCH | skipped
// Judge checks are not called unless --judge is given (it is paid; EVAL_OUTCOME_JUDGE replaces the
// judge); a metric that rests on them prints `skipped`.
//
// Exit code: 0 — every expectation met; 1 — a MISMATCH, or a reference that could not be built;
// 2 — usage or a bad score spec.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { claudeBinary, judgeCommand, loadSpec, scoreRun } from './eval-outcome-lib.mjs'
import { removeTree } from './remove-tree.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const stop = (code, message) => {
  process.stderr.write(`eval:outcome-check: ${message}\n`)
  process.exit(code)
}
const usage = 'usage: eval-outcome-check.mjs <task> [--tasks-dir <dir>] [--hidden-dir <dir>] [--judge]'

const args = process.argv.slice(2)
let task = null
let tasksDir = join(REPO, 'harness', 'evals-outcome')
let hiddenDir = join(REPO, 'scripts', 'eval-outcome', 'hidden')
let useJudge = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tasks-dir' && args[i + 1]) tasksDir = args[++i]
  else if (args[i] === '--hidden-dir' && args[i + 1]) hiddenDir = args[++i]
  else if (args[i] === '--judge') useJudge = true
  else if (!args[i].startsWith('-') && task === null) task = args[i]
  else stop(2, `unknown argument ${args[i]}; ${usage}`)
}
if (!task) stop(2, usage)
const taskDir = resolve(tasksDir, task)
const hiddenTask = resolve(hiddenDir, task)
if (!existsSync(join(taskDir, 'scaffold.sh'))) stop(2, `no ${join(taskDir, 'scaffold.sh')}`)
let spec
try {
  spec = loadSpec(hiddenTask)
} catch (error) {
  stop(2, error.message)
}
const judge = useJudge ? judgeCommand(process.env.EVAL_OUTCOME_JUDGE ? '' : claudeBinary(REPO, (message) => stop(2, message))) : null

/** The scalar fields of a grader's YAML front matter (`key: value`, quoted or not). */
function frontMatter(file) {
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
  const fields = {}
  for (const line of yaml.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1).replaceAll("''", "'")
    else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = JSON.parse(value)
    fields[match[1]] = value
  }
  return fields
}

const graderDir = join(taskDir, 'graders')
const graders = existsSync(graderDir)
  ? readdirSync(graderDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ name: f.slice(0, -3), ...frontMatter(join(graderDir, f)) }))
  : []
const regexGraders = graders.filter((g) => g.type === 'regex')
const REGEX_KEYS = ['type', 'pattern', 'flags', 'target', 'weight', 'description', 'match']
for (const g of graders) {
  const odd = Object.keys(g).filter((k) => k !== 'name' && !REGEX_KEYS.includes(k))
  if (g.type !== 'regex') process.stdout.write(`not checked: grader ${g.name} (${g.type ?? 'no type'}) needs a real run\n`)
  else if (odd.length > 0 || (g.match && g.match !== 'contains') || (g.target && g.target !== 'last_message')) process.stdout.write(`not checked exactly: grader ${g.name} has options this check does not apply (${[...odd, g.match && `match ${g.match}`, g.target && `target ${g.target}`].filter(Boolean).join(', ')})\n`)
}

const referenceDir = join(hiddenTask, 'reference')
const references = existsSync(referenceDir) ? readdirSync(referenceDir).filter((r) => existsSync(join(referenceDir, r, 'apply.sh'))).sort() : []
if (references.length === 0) stop(1, `no reference solutions in ${referenceDir}`)

const rows = []
let failed = false
for (const reference of references) {
  const dir = join(referenceDir, reference)
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'))
  const answer = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eval-outcome-check-')))
  try {
    const home = join(root, 'home')
    const work = join(home, 'cwd')
    for (const d of [work, join(root, 'tmp'), join(root, 'out')]) mkdirSync(d, { recursive: true })
    // The environment `claude plugin eval` gives a scaffold: short and fixed, HOME the run's own.
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'), TERM: 'dumb', GIT_CONFIG_NOSYSTEM: '1' }
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    for (const script of [join(taskDir, 'scaffold.sh'), join(dir, 'apply.sh')]) {
      const run = spawnSync('bash', [script], { cwd: work, env, encoding: 'utf8', timeout: 120_000 })
      if (run.status !== 0) throw new Error(`${script} exited ${run.status ?? run.error?.code}: ${(run.stderr ?? '').trim()}`)
    }
    const commands = readFileSync(join(dir, 'apply.sh'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
    const events = [
      { type: 'system', subtype: 'init', cwd: work },
      ...commands.map((command, i) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: `ref${i}`, name: 'Bash', input: { command } }] } })),
      { type: 'result', subtype: 'success', result: answer },
    ]
    const trace = join(root, 'out', 'trace.jsonl')
    writeFileSync(trace, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`)
    const record = scoreRun({ tracePath: trace, spec, judge })
    for (const [name, want] of Object.entries(expected.metrics ?? {})) {
      const got = record.metrics[name]
      if (got === undefined) {
        rows.push([reference, name, JSON.stringify(want), 'no such metric', 'MISMATCH'])
        failed = true
      } else if (got === null && want !== null) {
        rows.push([reference, name, JSON.stringify(want), 'skipped', 'skipped'])
      } else {
        const ok = got === want
        failed ||= !ok
        rows.push([reference, name, JSON.stringify(want), got === null ? 'skipped' : JSON.stringify(got), ok ? 'ok' : 'MISMATCH'])
      }
    }
    for (const grader of regexGraders) {
      const want = expected.graders?.[grader.name]
      const got = new RegExp(grader.pattern, grader.flags ?? '').test(answer.trim())
      const ok = want === got
      failed ||= !ok
      rows.push([reference, `grader ${grader.name}`, want === undefined ? 'no expectation' : JSON.stringify(want), JSON.stringify(got), ok ? 'ok' : 'MISMATCH'])
    }
  } catch (error) {
    rows.push([reference, 'build', '-', error instanceof Error ? error.message : String(error), 'MISMATCH'])
    failed = true
  } finally {
    removeTree(root)
  }
}

const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), ['reference', 'value', 'expected', 'actual'][i].length))
const line = (cells) => `${cells.map((c, i) => (i < 4 ? c.padEnd(widths[i]) : c)).join('  ')}\n`
process.stdout.write(line(['reference', 'value', 'expected', 'actual', 'verdict']))
for (const row of rows) process.stdout.write(line(row))
process.exit(failed ? 1 : 0)
