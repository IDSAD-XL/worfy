// The stub epic-status of test/contract/workflow-reader.test.ts, imported by ./epic-status, which
// node runs. It reads Tickets the way the real script does for those tests' simple files: from the
// working tree, or from a branch for `--ref`. The header is the one-fact-per-line format of
// harness/bin/TICKETS.md: `Status: <word> [<time>]`, `Blocked reason:`, `Waits:`, `PR: #N`; any other
// Status line is an old header, state none. STUB_LOG, STUB_DELAY_MS, STUB_SCRATCH and STUB_MODE
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
  // join() gives backslashes on Windows, git gives slashes.
  const parts = path.split(/[\\/]/)
  const epic = parts[1]
  if (!epics.has(epic)) epics.set(epic, { epic, hasSpec: false, hasMap: false })
  if (parts.length === 3 && parts[2] === 'spec.md') epics.get(epic).hasSpec = true
  if (parts.length !== 4 || parts[2] !== 'issues' || !parts[3].endsWith('.md')) continue
  const m = /^(\d+)-(.*)\.md$/.exec(parts[3])
  if (!m) continue
  // The real script cuts a \r at the end of a line: a checkout on Windows has CRLF, `git show` gives LF.
  const text = read().replace(/\r\n/g, '\n')
  const last = (name) => { let v = null; for (const l of text.split('\n')) { const x = new RegExp('^' + name + ':\\s*(.*)$', 'i').exec(l); if (x) v = x[1] } return v }
  const first = (name) => { for (const l of text.split('\n')) { const x = new RegExp('^' + name + ':\\s*(.*)$').exec(l); if (x) return x[1].trim() } return null }
  const line = text.split('\n').find((l) => /^\**status\**\s*:/i.test(l)) ?? null
  const status = line === null ? null : line.replace(/^[^:]*:\s*/, '')
  const fmt = line === null ? null : /^Status: (open|claimed|blocked|done)(?: (\S+))?$/.exec(line)
  const state = fmt === null ? 'none' : fmt[1] === 'claimed' ? 'work' : fmt[1]
  const pr = fmt && /^#(\d+)$/.exec(first('PR') ?? '')
  const facts = { statusAt: fmt?.[2] ?? null, statusError: line !== null && fmt === null ? 'old header' : null,
    blockedReason: fmt ? first('Blocked reason') : null, waits: fmt ? first('Waits') : null, pr: pr ? Number(pr[1]) : null }
  const blocked = last('Blocked by')
  const nums = blocked && !/^[—-]$/.test(blocked.trim()) ? blocked.split(',').map((s) => Number(s.trim())) : []
  // Branch: and Repo: as the Harness of Silent mode gives them; only when the Ticket has the line.
  const lines = {}
  for (const [key, name] of [['branch', 'Branch'], ['repo', 'Repo']]) { const v = last(name); if (v !== null) lines[key] = v }
  tickets.push({ epic, num: Number(m[1]), slug: m[2], title: (text.split('\n')[0] || '').replace(/^#\s*/, ''), statusRaw: status, state, ...facts,
    blockedRaw: blocked, blockedNums: nums, blockedParsed: nums.every((n) => !Number.isNaN(n)), ...lines, ref: ref ?? '.', secret: 'not-for-the-renderer' })
}
if (process.env.STUB_MODE === 'fail') { process.stderr.write('stub broke on purpose\n'); process.exit(3) }
if (process.env.STUB_MODE === 'garbage') { process.stdout.write('not json at all'); process.exit(0) }
process.stdout.write(JSON.stringify({ ref: ref ?? 'main', epics: [...epics.values()], tickets, extra: { secret: 'not-for-the-renderer' } }))
