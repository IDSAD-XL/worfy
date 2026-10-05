// The workflow reader and watcher against a temporary git repository with worktrees, and a stub
// `bin/epic-status` in a temporary WORFY_CLAUDE_HOME. The stub reads Tickets the way the real
// script does for these tests' simple files: from the working tree, or from a branch for `--ref`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { readCheckout, readWorkflow, epicStatusRunner, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { WorkflowHub, WorkflowWatcher } from '../../src/main/workflow/watch'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { diffModels, type WorkflowDelta, type WorkflowModel } from '../../src/shared/workflow/types'
import { generateScratch } from './scratch-gen'

// ── stub epic-status ──────────────────────────────────────────────────────────

const STUB_JS = String.raw`
const { execFileSync } = require('node:child_process')
const { appendFileSync, existsSync, readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null
appendFileSync(process.env.STUB_LOG, (ref ?? '.') + '\n')
if (process.env.STUB_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.STUB_DELAY_MS))
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' })
let files
if (ref) {
  files = git('ls-tree', '-r', '--name-only', ref, '--', '.scratch').split('\n').filter(Boolean).map((p) => [p, () => git('show', ref + ':' + p)])
} else {
  files = []
  if (existsSync('.scratch')) for (const epic of readdirSync('.scratch')) {
    for (const f of ['spec.md', 'map.md']) if (existsSync(join('.scratch', epic, f))) files.push([join('.scratch', epic, f), () => ''])
    const dir = join('.scratch', epic, 'issues')
    if (existsSync(dir)) for (const f of readdirSync(dir)) files.push([join(dir, f), () => readFileSync(join(dir, f), 'utf8')])
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
  tickets.push({ epic, num: Number(m[1]), slug: m[2], title: (text.split('\n')[0] || '').replace(/^#\s*/, ''), statusRaw: status, state,
    blockedRaw: blocked, blockedNums: nums, blockedParsed: nums.every((n) => !Number.isNaN(n)), ref: ref ?? '.', secret: 'not-for-the-renderer' })
}
if (process.env.STUB_MODE === 'fail') { process.stderr.write('stub broke on purpose\n'); process.exit(3) }
if (process.env.STUB_MODE === 'garbage') { process.stdout.write('not json at all'); process.exit(0) }
process.stdout.write(JSON.stringify({ ref: ref ?? 'main', epics: [...epics.values()], tickets, extra: { secret: 'not-for-the-renderer' } }))
`

/** A temporary Claude home whose bin/epic-status runs the stub with this test's Node. */
function makeClaudeHome(dir: string): { home: string; log: string } {
  const home = join(dir, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  const js = join(home, 'stub.cjs')
  writeFileSync(js, STUB_JS)
  const script = join(home, 'bin', 'epic-status')
  writeFileSync(script, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${process.execPath}' '${js}' "$@"\n`)
  chmodSync(script, 0o755)
  const log = join(dir, 'stub-calls.log')
  writeFileSync(log, '')
  process.env.STUB_LOG = log
  return { home, log }
}

const calls = (log: string): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean)

// ── temporary repository ─────────────────────────────────────────────────────

function ticketText(num: number, status: string, blocked: string, files: string[] | null): string {
  const nn = String(num).padStart(2, '0')
  const section = files === null ? [] : ['## Где в коде', '', ...files.map((f) => `- \`${f}\``), '']
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Что делаем', '', 'text', '', ...section].join('\n')
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
}

/** A repository with Epic `demo` (Tickets 01–04) committed on main. */
function makeRepo(dir: string): string {
  const repo = join(dir, 'project')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# Demo epic: a small one\n\ntext\n')
  writeFileSync(join(issues, '01-first.md'), ticketText(1, 'done — 2026-10-01', '—', ['src/a.ts']))
  writeFileSync(join(issues, '02-second.md'), ticketText(2, 'open', '01', ['src/b.ts', 'src/shared.ts']))
  writeFileSync(join(issues, '03-third.md'), ticketText(3, 'open', '01', ['src/shared.ts']))
  writeFileSync(join(issues, '04-fourth.md'), ticketText(4, 'open', '—', null))
  git(dir, 'init', '-q', '-b', 'main', repo)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'epic')
  return repo
}

/** Adds a worktree on a new branch and commits a claim of `ticketFile` there, like `ticket claim`. */
function claimInWorktree(repo: string, branch: string, folder: string, ticketFile: string): string {
  const path = join(repo, '.claude', 'worktrees', folder)
  git(repo, 'worktree', 'add', '-q', '-b', branch, path, 'main')
  const file = join(path, '.scratch', 'demo', 'issues', ticketFile)
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed — 2026-10-05'))
  git(path, 'commit', '-qam', `claim ${branch}`)
  return path
}

/** Every file under `dir` with its size, mtime and content hash, `.git` included. */
function treeState(dir: string): Map<string, string> {
  const state = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const stats = statSync(path)
        state.set(path, `${stats.size}:${stats.mtimeMs}:${createHash('sha1').update(readFileSync(path)).digest('hex')}`)
      }
    }
  }
  walk(dir)
  return state
}

const ticketOf = (model: WorkflowModel, num: number) => model.tickets.find((t) => t.epic === 'demo' && t.num === num)

/** Resolves with the next delta for which `match` holds, or rejects after `ms`. */
function nextDelta(deltas: WorkflowDelta[], match: (delta: WorkflowDelta) => boolean, ms = 5000): Promise<{ delta: WorkflowDelta; at: number }> {
  const start = deltas.length
  return new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + ms
    const poll = () => {
      const found = deltas.slice(start).find(match)
      if (found) return resolvePromise({ delta: found, at: performance.now() })
      if (Date.now() > deadline) return reject(new Error(`no matching workflow delta within ${ms} ms; got ${JSON.stringify(deltas.slice(start))}`))
      setTimeout(poll, 10)
    }
    poll()
  })
}

let dir: string
let cleanups: (() => Promise<void>)[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-workflow-'))
  cleanups = []
  delete process.env.STUB_MODE
  delete process.env.STUB_DELAY_MS
})

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function startWatcher(repo: string, home: string, deltas: WorkflowDelta[], run?: EpicStatusRunner): Promise<WorkflowWatcher> {
  const watcher = await WorkflowWatcher.start({ root: repo, claudeHome: home, onChange: (delta) => deltas.push(delta), ...(run ? { run } : {}) })
  cleanups.push(() => watcher.close())
  return watcher
}

// ── reader ───────────────────────────────────────────────────────────────────

describe('workflow reader', () => {
  it('reads Epics and Tickets from epic-status and adds "Где в коде" files and the Epic title', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const { model } = await readWorkflow({ root: repo, claudeHome: home })

    expect(model.error).toBeNull()
    expect(model.epics).toEqual([{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo epic: a small one' }])
    expect(model.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4])
    expect(ticketOf(model, 2)).toMatchObject({ state: 'open', blockedNums: [1], files: ['src/b.ts', 'src/shared.ts'], filesListed: true, fromBranch: null })
    expect(ticketOf(model, 4)).toMatchObject({ files: [], filesListed: false })
  })

  it('keeps only the keys of the model: extra keys of the script output do not pass through', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const model = await readCheckout(repo, epicStatusRunner(home))
    expect(JSON.stringify(model)).not.toContain('not-for-the-renderer')
    expect(Object.keys(model.tickets[0]!).sort()).toEqual(
      ['blockedNums', 'blockedParsed', 'blockedRaw', 'epic', 'fromBranch', 'files', 'filesListed', 'num', 'slug', 'state', 'statusRaw', 'title'].sort(),
    )
  })

  it('shows a Ticket claimed in a worktree branch as in work, marked with the branch; the mark goes after the merge', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')

    const before = (await readWorkflow({ root: repo, claudeHome: home })).model
    expect(ticketOf(before, 2)).toMatchObject({ state: 'work', statusRaw: 'claimed — 2026-10-05', fromBranch: 'demo/02' })
    expect(ticketOf(before, 3)).toMatchObject({ state: 'open', fromBranch: null })
    // The checkout itself still says open: the claim lives in the branch only.
    expect(readFileSync(join(repo, '.scratch/demo/issues/02-second.md'), 'utf8')).toMatch(/^Status: open$/m)

    git(repo, 'merge', '-q', '--ff-only', 'demo/02')
    const after = (await readWorkflow({ root: repo, claudeHome: home })).model
    expect(ticketOf(after, 2)).toMatchObject({ state: 'work', statusRaw: 'claimed — 2026-10-05', fromBranch: null })
  })

  it('does not let a branch left over after the merge override a Ticket done in the checkout', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const file = join(repo, '.scratch/demo/issues/02-second.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: done — 2026-10-06'))
    const { model } = await readWorkflow({ root: repo, claudeHome: home })
    expect(ticketOf(model, 2)).toMatchObject({ state: 'done', fromBranch: null })
  })

  it('understands the older <epic>/<NN>-<slug> branches and skips branches that name no Ticket', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/03-third', '03-third', '03-third.md')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature-x', join(dir, 'elsewhere'), 'main')
    git(repo, 'worktree', 'add', '-q', '-b', 'other-epic/01', join(dir, 'other'), 'main')

    const { model } = await readWorkflow({ root: repo, claudeHome: home })
    expect(ticketOf(model, 3)).toMatchObject({ state: 'work', fromBranch: 'demo/03-third' })
    // feature-x is not a Ticket branch; other-epic/01 names a Ticket the checkout does not have.
    expect(calls(log).sort()).toEqual(['.', 'demo/03-third'])
  })

  it('runs at most 4 branch snapshots at once', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    for (let n = 5; n <= 10; n += 1) {
      writeFileSync(join(repo, `.scratch/demo/issues/${String(n).padStart(2, '0')}-extra.md`), ticketText(n, 'open', '—', [`src/x${n}.ts`]))
    }
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'more')
    for (let n = 5; n <= 10; n += 1) claimInWorktree(repo, `demo/${String(n).padStart(2, '0')}`, String(n).padStart(2, '0'), `${String(n).padStart(2, '0')}-extra.md`)

    const real = epicStatusRunner(home)
    let inFlight = 0
    let peak = 0
    const counting: EpicStatusRunner = async (cwd, ref) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await new Promise((done) => setTimeout(done, 50))
        return await real(cwd, ref)
      } finally {
        inFlight -= 1
      }
    }
    const { model } = await readWorkflow({ root: repo, claudeHome: home }, counting)
    expect(model.tickets.filter((t) => t.fromBranch !== null).map((t) => t.num)).toEqual([5, 6, 7, 8, 9, 10])
    expect(peak).toBe(4)
  })

  it('gives an empty model with the reason when epic-status is missing, and does not throw', async () => {
    const repo = makeRepo(dir)
    const { model } = await readWorkflow({ root: repo, claudeHome: join(dir, 'no-such-home') })
    expect(model.tickets).toEqual([])
    expect(model.epics).toEqual([])
    expect(model.error).toEqual({ code: 'not-found', message: `epic-status not found: ${join(dir, 'no-such-home', 'bin', 'epic-status')}` })
  })

  it('reports a failing script and output that is not the expected JSON', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    process.env.STUB_MODE = 'fail'
    const failed = (await readWorkflow({ root: repo, claudeHome: home })).model
    expect(failed.error?.code).toBe('failed')
    expect(failed.error?.message).toMatch(/stub broke on purpose/)
    expect(failed.tickets).toEqual([])

    process.env.STUB_MODE = 'garbage'
    const garbage = (await readWorkflow({ root: repo, claudeHome: home })).model
    expect(garbage.error?.code).toBe('invalid-output')

    const wrongShape = (await readWorkflow({ root: repo, claudeHome: home }, async () => JSON.stringify({ ref: 'main', epics: [], tickets: [{ epic: 'demo', num: 'one' }] }))).model
    expect(wrongShape.error?.code).toBe('invalid-output')
  })

  it('writes nothing into the Project or the Claude home: both trees, .git included, are byte-for-byte the same after reads and watching', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const statusBefore = git(repo, 'status', '--porcelain', '--untracked-files=all')
    const before = treeState(repo)
    const homeBefore = treeState(home)

    await readWorkflow({ root: repo, claudeHome: home })
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas)
    await new Promise((done) => setTimeout(done, 500))
    await watcher.close()

    expect(treeState(repo)).toEqual(before)
    expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe(statusBefore)
    // The Claude home that bin/epic-status runs from is read-only for worfy too (ADR 0005).
    expect(treeState(home)).toEqual(homeBefore)
  })
})

// ── watcher ──────────────────────────────────────────────────────────────────

describe('workflow watcher', () => {
  it('sends only the changed Ticket ≤ 1.5 s after a Ticket file is saved', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas)
    expect(ticketOf(watcher.current, 3)?.state).toBe('open')

    const file = join(repo, '.scratch/demo/issues/03-third.md')
    const savedAt = performance.now()
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked — waiting'))
    const { delta, at } = await nextDelta(deltas, (d) => d.tickets.length > 0)

    expect(at - savedAt).toBeLessThanOrEqual(1500)
    expect(delta.tickets.map((t) => [t.num, t.state])).toEqual([[3, 'blocked']])
    expect(delta.epics).toEqual([])
    expect(delta.removedTickets).toEqual([])
  })

  it('re-reads only the branch whose ref moved and marks the newly claimed Ticket', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const deltas: WorkflowDelta[] = []
    await startWatcher(repo, home, deltas)
    writeFileSync(log, '')

    claimInWorktree(repo, 'demo/03', '03', '03-third.md')
    const { delta } = await nextDelta(deltas, (d) => d.tickets.some((t) => t.num === 3))
    expect(delta.tickets.map((t) => [t.num, t.state, t.fromBranch])).toEqual([[3, 'work', 'demo/03']])
    // The checkout and demo/02 are not read again; demo/03 may be read twice if the debounce fell
    // between `worktree add` and the claim commit.
    expect(calls(log).length).toBeGreaterThan(0)
    expect(new Set(calls(log))).toEqual(new Set(['demo/03']))
  })

  it('reports a removed Ticket', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const deltas: WorkflowDelta[] = []
    await startWatcher(repo, home, deltas)
    rmSync(join(repo, '.scratch/demo/issues/04-fourth.md'))
    const { delta } = await nextDelta(deltas, (d) => d.removedTickets.length > 0)
    expect(delta.removedTickets).toEqual([{ epic: 'demo', num: 4 }])
  })

  it('does not lose a Ticket saved while the first read runs', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home)
    const file = join(repo, '.scratch/demo/issues/03-third.md')
    let savedAt = 0
    // The first checkout read answers with the state from before the save, as a slow read would.
    const racing: EpicStatusRunner = async (cwd, ref) => {
      const out = await real(cwd, ref)
      if (ref === null && !savedAt) {
        writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed — 2026-10-05'))
        savedAt = performance.now()
        await new Promise((done) => setTimeout(done, 100))
      }
      return out
    }
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas, racing)
    expect(savedAt).toBeGreaterThan(0)

    // Either `start` already gives the saved state, or a delta brings it within 1.5 s of the save.
    if (ticketOf(watcher.current, 3)?.state !== 'work') {
      const { delta, at } = await nextDelta(deltas, (d) => d.tickets.some((t) => t.num === 3))
      expect(delta.tickets.map((t) => [t.num, t.state])).toEqual([[3, 'work']])
      expect(at - savedAt).toBeLessThanOrEqual(1500)
    }
    await watcher.idle()
    expect(ticketOf(watcher.current, 3)?.state).toBe('work')
  })

  it('waits for 300 ms of quiet: saves closer together than that give exactly one read', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home)
    let checkoutReads = 0
    const counting: EpicStatusRunner = async (cwd, ref) => {
      if (ref === null) checkoutReads += 1
      return real(cwd, ref)
    }
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas, counting)
    expect(checkoutReads).toBe(1)

    const file = join(repo, '.scratch/demo/issues/03-third.md')
    for (const word of ['one', 'two', 'three']) {
      writeFileSync(file, readFileSync(file, 'utf8') + `\n${word}\n`)
      await new Promise((done) => setTimeout(done, 60))
    }
    await new Promise((done) => setTimeout(done, 500))
    await watcher.idle()
    expect(checkoutReads).toBe(2)
  })

  it('never overlaps reads: saves during a read give exactly one more read', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home)
    let checkoutReads = 0
    let inFlight = 0
    let peak = 0
    let release: (() => void) | null = null
    let started: (() => void) | null = null
    const slow: EpicStatusRunner = async (cwd, ref) => {
      if (ref !== null) return real(cwd, ref)
      checkoutReads += 1
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        if (checkoutReads === 2) {
          started?.()
          await new Promise<void>((done) => (release = done))
        }
        return await real(cwd, ref)
      } finally {
        inFlight -= 1
      }
    }
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas, slow)
    expect(checkoutReads).toBe(1)

    const file = join(repo, '.scratch/demo/issues/03-third.md')
    const readStarted = new Promise<void>((done) => (started = done))
    writeFileSync(file, readFileSync(file, 'utf8') + '\nfirst save\n')
    await readStarted
    // Two more saves while the second read hangs: they must collapse into one following read.
    writeFileSync(file, readFileSync(file, 'utf8') + '\nsecond save\n')
    await new Promise((done) => setTimeout(done, 400))
    writeFileSync(file, readFileSync(file, 'utf8') + '\nthird save\n')
    await new Promise((done) => setTimeout(done, 400))
    ;(release as (() => void) | null)?.()
    await watcher.idle()
    await new Promise((done) => setTimeout(done, 400))
    await watcher.idle()

    expect(peak).toBe(1)
    expect(checkoutReads).toBe(3)
  })
})

// ── hub ──────────────────────────────────────────────────────────────────────

describe('workflow hub', () => {
  it('shares one watcher per Project: the other window keeps getting changes after one leaves', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const hub = new WorkflowHub({ claudeHome: home })
    cleanups.push(() => hub.closeAll())
    const first: WorkflowDelta[] = []
    const second: WorkflowDelta[] = []

    const [a, b] = await Promise.all([
      hub.open(repo, { id: 1, send: (delta) => void first.push(delta) }),
      hub.open(repo, { id: 2, send: (delta) => void second.push(delta) }),
    ])
    expect(a).toBe(b)
    expect(hub.roots).toEqual([repo])

    expect(await hub.close(repo, 1)).toBe(true)
    expect(hub.roots).toEqual([repo])

    const file = join(repo, '.scratch/demo/issues/02-second.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked'))
    const { delta } = await nextDelta(second, (d) => d.tickets.length > 0)
    expect(delta.tickets.map((t) => [t.num, t.state])).toEqual([[2, 'blocked']])
    expect(first).toEqual([])

    expect(await hub.close(repo, 2)).toBe(true)
    expect(hub.roots).toEqual([])
  })
})

// ── size of an Auction-like Project ──────────────────────────────────────────

describe('workflow reader on an Auction-sized Project', () => {
  it('parses the answer, reads "Где в коде" and diffs 682 Tickets in ≤ 300 ms of its own time', async () => {
    const repo = join(dir, 'big')
    const { json, ticketCount } = generateScratch(repo)
    expect(ticketCount).toBe(682)
    expect(json.epics).toHaveLength(42)
    const answer = join(dir, 'answer.json')
    writeFileSync(answer, JSON.stringify(json))
    const home = join(dir, 'big-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    writeFileSync(join(home, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
    chmodSync(join(home, 'bin', 'epic-status'), 0o755)

    // The script's own time (process start, cat) is not worfy's: measure it and take it out.
    const real = epicStatusRunner(home)
    let scriptMs = 0
    const timed: EpicStatusRunner = async (cwd, ref) => {
      const start = performance.now()
      try {
        return await real(cwd, ref)
      } finally {
        scriptMs += performance.now() - start
      }
    }

    const previous = (await readWorkflow({ root: repo, claudeHome: home }, timed)).model
    const samples: number[] = []
    for (let i = 0; i < 3; i += 1) {
      scriptMs = 0
      const start = performance.now()
      const { model } = await readWorkflow({ root: repo, claudeHome: home }, timed)
      diffModels(previous, model)
      samples.push(performance.now() - start - scriptMs)
      expect(model.tickets).toHaveLength(682)
      expect(model.tickets.every((t) => t.files.length === 3)).toBe(true)
    }
    const best = Math.min(...samples)
    console.info(`[workflow] Auction-sized read, worfy's own share: ${samples.map((s) => s.toFixed(0)).join(', ')} ms`)
    expect(best).toBeLessThanOrEqual(300)
  })
})

// ── IPC ──────────────────────────────────────────────────────────────────────

describe('workflow IPC channels', () => {
  type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

  async function setup() {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    process.env.WORFY_CLAUDE_HOME = home
    vi.resetModules()
    const module = await import('../../src/main/ipc/workflow')
    cleanups.push(() => module.workflowHub.closeAll())

    const handlers = new Map<string, Listener>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    await registerIpc(ipc, { modules: { './workflow.ts': async () => module.default }, isTrustedSender: () => true })

    const sent: { channel: string; payload: unknown }[] = []
    const destroyed: (() => void)[] = []
    const sender = {
      id: 7,
      isDestroyed: () => false,
      once: (name: string, listener: () => void) => {
        if (name === 'destroyed') destroyed.push(listener)
        return sender
      },
      send: (channel: string, payload: unknown) => void sent.push({ channel, payload }),
    }
    const call = async (name: string, input: unknown) => {
      const event = { senderFrame: { url: 'app://' }, sender } as unknown as IpcMainInvokeEvent
      return (await handlers.get(IPC_CHANNEL_PREFIX + name)!(event, input)) as IpcResult<unknown>
    }
    return { repo, call, sent, destroyed, hub: module.workflowHub }
  }

  it('rejects a root of the wrong type or a relative path without watching anything', async () => {
    const { call, hub } = await setup()
    for (const input of [{ root: 42 }, { root: 'relative/path' }, {}, undefined]) {
      const result = await call('workflow.open', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error).toMatch(/workflow\.open: invalid input/)
    }
    expect(hub.roots).toEqual([])
  })

  it('answers workflow.open with the parsed model only and streams workflow.changed to the window', async () => {
    const { repo, call, sent, hub } = await setup()
    const result = await call('workflow.open', { root: repo, injected: 'drop me' })
    expect(result.ok).toBe(true)
    const model = (result as { ok: true; value: WorkflowModel }).value
    expect(model.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4])
    expect(JSON.stringify(result)).not.toContain('not-for-the-renderer')
    expect(JSON.stringify(result)).not.toContain('drop me')
    expect(hub.roots).toEqual([repo])

    const file = join(repo, '.scratch/demo/issues/02-second.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked'))
    const deadline = Date.now() + 5000
    while (!sent.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20))
    expect(sent[0]?.channel).toBe('worfy:workflow.changed')
    const delta = sent[0]!.payload as WorkflowDelta
    expect(delta.tickets.map((t) => [t.num, t.state])).toEqual([[2, 'blocked']])
    expect(JSON.stringify(delta)).not.toContain('not-for-the-renderer')

    expect(await call('workflow.close', { root: repo })).toEqual({ ok: true, value: { closed: true } })
    expect(await call('workflow.close', { root: repo })).toEqual({ ok: true, value: { closed: false } })
    expect(hub.roots).toEqual([])
  })

  it('takes a destroyed window off every Project it opened', async () => {
    const { repo, call, destroyed, hub } = await setup()
    expect((await call('workflow.open', { root: repo })).ok).toBe(true)
    expect((await call('workflow.open', { root: repo })).ok).toBe(true)
    expect(hub.roots).toEqual([repo])
    // One listener per window, however many times it opens a Project.
    expect(destroyed).toHaveLength(1)

    destroyed[0]!()
    const deadline = Date.now() + 5000
    while (hub.roots.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20))
    expect(hub.roots).toEqual([])
  })
})
