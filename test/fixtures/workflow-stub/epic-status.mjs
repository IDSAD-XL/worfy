// The stub epic-status of test/contract/workflow-reader.test.ts, run by ./epic-status with the
// test's Node. It reads Tickets the way the real script does for those tests' simple files: from the
// working tree, or from a branch for `--ref`. STUB_LOG, STUB_DELAY_MS, STUB_SCRATCH and STUB_MODE
// come from the environment the test hands the reader.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
const args = process.argv.slice(2)
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null
appendFileSync(process.env.STUB_LOG, (ref ?? '.') + '\n')
if (process.env.STUB_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.STUB_DELAY_MS))
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' })
let files
if (ref) {
  files = git('ls-tree', '-r', '--name-only', ref, '--', '.scratch').split('\n').filter(Boolean).map((p) => [p, () => git('show', ref + ':' + p)])
} else {
  // STUB_SCRATCH: the tickets root of a Silent Project, outside the repository (its Workflow folder).
  const scratch = process.env.STUB_SCRATCH || '.scratch'
  files = []
  if (existsSync(scratch)) for (const epic of readdirSync(scratch)) {
    for (const f of ['spec.md', 'map.md']) if (existsSync(join(scratch, epic, f))) files.push([join('.scratch', epic, f), () => ''])
    const dir = join(scratch, epic, 'issues')
    if (existsSync(dir)) for (const f of readdirSync(dir)) files.push([join('.scratch', epic, 'issues', f), () => readFileSync(join(dir, f), 'utf8')])
  }
}
const epics = new Map()
const tickets = []
for (const [path, read] of files) {
  const parts = path.split('/')
  const epic = parts[1]
  if (!epics.has(epic)) epics.set(epic, { epic, hasSpec: false, hasMap: false })
  if (parts.length === 3 && parts[2] === 'spec.md') epics.get(epic).hasSpec = true
  if (parts.length !== 4 || parts[2] !== 'issues' || !parts[3].endsWith('.md')) continue
  const m = /^(\d+)-(.*)\.md$/.exec(parts[3])
  if (!m) continue
  const text = read()
  const last = (name) => { let v = null; for (const l of text.split('\n')) { const x = new RegExp('^' + name + ':\\s*(.*)$', 'i').exec(l); if (x) v = x[1] } return v }
  const status = last('Status')
  const blocked = last('Blocked by')
  const word = (status ?? '').split(/\s/)[0]
  const state = status === null ? 'none' : /^done$/i.test(word) ? 'done' : /^claimed$/i.test(word) ? 'work' : /^blocked$/i.test(word) ? 'blocked' : 'open'
  const nums = blocked && !/^[—-]$/.test(blocked.trim()) ? blocked.split(',').map((s) => Number(s.trim())) : []
  // Branch: and Repo: as the Harness of Silent mode gives them; only when the Ticket has the line.
  const lines = {}
  for (const [key, name] of [['branch', 'Branch'], ['repo', 'Repo']]) { const v = last(name); if (v !== null) lines[key] = v }
  tickets.push({ epic, num: Number(m[1]), slug: m[2], title: (text.split('\n')[0] || '').replace(/^#\s*/, ''), statusRaw: status, state,
    blockedRaw: blocked, blockedNums: nums, blockedParsed: nums.every((n) => !Number.isNaN(n)), ...lines, ref: ref ?? '.', secret: 'not-for-the-renderer' })
}
if (process.env.STUB_MODE === 'fail') { process.stderr.write('stub broke on purpose\n'); process.exit(3) }
if (process.env.STUB_MODE === 'garbage') { process.stdout.write('not json at all'); process.exit(0) }
process.stdout.write(JSON.stringify({ ref: ref ?? 'main', epics: [...epics.values()], tickets, extra: { secret: 'not-for-the-renderer' } }))
