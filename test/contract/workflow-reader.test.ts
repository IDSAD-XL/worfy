// The workflow reader and watcher against a temporary git repository with worktrees, and a stub
// `bin/epic-status` in a temporary WORFY_CLAUDE_HOME. The stub reads Tickets the way the real
// script does for these tests' simple files: from the working tree, or from a branch for `--ref`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { readCheckout, readWorkflow, epicStatusRunner, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { Debounce, ticketsIgnored, WorkflowHub, WorkflowWatcher } from '../../src/main/workflow/watch'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { diffModels, type WorkflowDelta, type WorkflowModel } from '../../src/shared/workflow/types'
import { generateScratch } from './scratch-gen'

/**
 * The scripts' environment the readers are handed here: this process's own. The stub below reads
 * STUB_LOG, STUB_MODE and the like from it, and a test changes them between reads, so it is asked
 * on every run. In the app it is the login shell's (src/main/harness/script-env.ts).
 */
const ownEnv = (): Promise<NodeJS.ProcessEnv> => Promise.resolve(process.env)

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

/**
 * A temporary Claude home with no Harness of its own and the Harness plugin in
 * <home>/worfy-harness/plugin (worfy-harness ticket 12): the same stub as bin/epic-status of the
 * plugin, which also writes the HARNESS_HOME it was given to `harnessEnv`.
 */
function makePluginHome(dir: string): { home: string; harnessHome: string; log: string; harnessEnv: string } {
  const home = join(dir, 'claude-home')
  const harnessHome = join(home, 'worfy-harness')
  const plugin = join(harnessHome, 'plugin')
  mkdirSync(join(plugin, 'bin'), { recursive: true })
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worfy', version: '0.2.0+abc' }))
  const js = join(dir, 'stub.cjs')
  writeFileSync(js, STUB_JS)
  const harnessEnv = join(dir, 'harness-env.log')
  writeFileSync(harnessEnv, '')
  const script = join(plugin, 'bin', 'epic-status')
  writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "\${HARNESS_HOME-unset}" >> '${harnessEnv}'\nELECTRON_RUN_AS_NODE=1 exec '${process.execPath}' '${js}' "$@"\n`)
  chmodSync(script, 0o755)
  const log = join(dir, 'stub-calls.log')
  writeFileSync(log, '')
  process.env.STUB_LOG = log
  return { home, harnessHome, log, harnessEnv }
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
  delete process.env.STUB_SCRATCH
})

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function startWatcher(repo: string, home: string, deltas: WorkflowDelta[], run?: EpicStatusRunner): Promise<WorkflowWatcher> {
  const watcher = await WorkflowWatcher.start({ root: repo, claudeHome: home, env: ownEnv, onChange: (delta) => deltas.push(delta), ...(run ? { run } : {}) })
  cleanups.push(() => watcher.close())
  return watcher
}

// ── reader ───────────────────────────────────────────────────────────────────

describe('workflow reader', () => {
  it('reads Epics and Tickets from epic-status and adds "Где в коде" files and the Epic title', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })

    expect(model.error).toBeNull()
    expect(model.epics).toEqual([{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo epic: a small one' }])
    expect(model.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4])
    expect(ticketOf(model, 2)).toMatchObject({ state: 'open', blockedNums: [1], files: ['src/b.ts', 'src/shared.ts'], filesListed: true, fromBranch: null })
    expect(ticketOf(model, 4)).toMatchObject({ files: [], filesListed: false })
  })

  it('keeps only the keys of the model: extra keys of the script output do not pass through', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const model = await readCheckout(repo, epicStatusRunner(home, ownEnv))
    expect(JSON.stringify(model)).not.toContain('not-for-the-renderer')
    expect(Object.keys(model.tickets[0]!).sort()).toEqual(
      ['blockedNums', 'blockedParsed', 'blockedRaw', 'epic', 'fromBranch', 'files', 'filesListed', 'num', 'slug', 'state', 'statusRaw', 'title'].sort(),
    )
  })

  it('shows a Ticket claimed in a worktree branch as in work, marked with the branch; the mark goes after the merge', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')

    const before = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(ticketOf(before, 2)).toMatchObject({ state: 'work', statusRaw: 'claimed — 2026-10-05', fromBranch: 'demo/02' })
    expect(ticketOf(before, 3)).toMatchObject({ state: 'open', fromBranch: null })
    // The checkout itself still says open: the claim lives in the branch only.
    expect(readFileSync(join(repo, '.scratch/demo/issues/02-second.md'), 'utf8')).toMatch(/^Status: open$/m)

    git(repo, 'merge', '-q', '--ff-only', 'demo/02')
    const after = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(ticketOf(after, 2)).toMatchObject({ state: 'work', statusRaw: 'claimed — 2026-10-05', fromBranch: null })
  })

  it('does not let a branch left over after the merge override a Ticket done in the checkout', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const file = join(repo, '.scratch/demo/issues/02-second.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: done — 2026-10-06'))
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(ticketOf(model, 2)).toMatchObject({ state: 'done', fromBranch: null })
  })

  it('does not let a branch that never touched its Ticket (open from its base) override blocked in the checkout (ticket 30, Ticket 15 on 2026-10-06)', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    // The branch's worktree is made from main and leaves the Ticket file alone: Status open, as on its base.
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/03', join(repo, '.claude', 'worktrees', '03'), 'main')
    const file = join(repo, '.scratch/demo/issues/03-third.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked — rejected by review'))
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(ticketOf(model, 3)).toMatchObject({ state: 'blocked', statusRaw: 'blocked — rejected by review', fromBranch: null })
  })

  it('does not let a branch say claimed or done over blocked in the checkout: a Ticket sent back for rework stays blocked (ticket 30)', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const path = join(repo, '.claude', 'worktrees', '03')
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/03', path, 'main')
    const file = join(repo, '.scratch/demo/issues/03-third.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked — rejected by review'))
    const branchFile = join(path, '.scratch/demo/issues/03-third.md')
    for (const status of ['claimed — 2026-10-06', 'done — 2026-10-06']) {
      writeFileSync(branchFile, readFileSync(branchFile, 'utf8').replace(/^Status: .*$/m, `Status: ${status}`))
      git(path, 'commit', '-qam', `03: ${status}`)
      expect(ticketOf((await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model, 3), status).toMatchObject({
        state: 'blocked',
        statusRaw: 'blocked — rejected by review',
        fromBranch: null,
      })
    }
  })

  it('does not let a branch say open over a claim merged into the checkout, but lets it say blocked over it', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const path = join(repo, '.claude', 'worktrees', '04')
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/04', path, 'main')
    const file = join(repo, '.scratch/demo/issues/04-fourth.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed — 2026-10-06'))
    // The branch still says open, from its base: the checkout's claim stands.
    expect(ticketOf((await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model, 4)).toMatchObject({ state: 'work', statusRaw: 'claimed — 2026-10-06', fromBranch: null })
    // The branch blocks the Ticket: that is news the checkout does not have yet.
    const branchFile = join(path, '.scratch/demo/issues/04-fourth.md')
    writeFileSync(branchFile, readFileSync(branchFile, 'utf8').replace(/^Status: .*$/m, 'Status: blocked — waits for the owner'))
    git(path, 'commit', '-qam', 'block 04')
    expect(ticketOf((await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model, 4)).toMatchObject({ state: 'blocked', fromBranch: 'demo/04' })
  })

  it('understands the older <epic>/<NN>-<slug> branches and skips branches that name no Ticket', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/03-third', '03-third', '03-third.md')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature-x', join(dir, 'elsewhere'), 'main')
    git(repo, 'worktree', 'add', '-q', '-b', 'other-epic/01', join(dir, 'other'), 'main')

    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
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

    const real = epicStatusRunner(home, ownEnv)
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
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv }, counting)
    expect(model.tickets.filter((t) => t.fromBranch !== null).map((t) => t.num)).toEqual([5, 6, 7, 8, 9, 10])
    expect(peak).toBe(4)
  })

  it('gives an empty model with the reason when epic-status is missing, and does not throw; the reason names both places it looked', async () => {
    const repo = makeRepo(dir)
    const { model } = await readWorkflow({ root: repo, claudeHome: join(dir, 'no-such-home'), env: ownEnv })
    expect(model.tickets).toEqual([])
    expect(model.epics).toEqual([])
    const legacy = join(dir, 'no-such-home', 'bin', 'epic-status')
    const plugin = join(dir, 'no-such-home', 'worfy-harness', 'plugin', 'bin', 'epic-status')
    expect(model.error).toEqual({ code: 'not-found', message: `epic-status not found: ${legacy} or ${plugin}` })
  })

  it('runs epic-status of the Harness plugin when only the plugin is there, with HARNESS_HOME in its environment (worfy-harness ticket 12)', async () => {
    const repo = makeRepo(dir)
    const { home, harnessHome, log, harnessEnv } = makePluginHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(model.error).toBeNull()
    expect(model.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4])
    expect(ticketOf(model, 2)).toMatchObject({ state: 'work', fromBranch: 'demo/02' })
    expect(calls(log)).toEqual(['.', 'demo/02'])
    // Every run, the checkout's and the branch's, got the Harness home.
    expect(calls(harnessEnv)).toEqual([harnessHome, harnessHome])
    // The plain runner the MCP server uses (canvas-server.ts) finds it too.
    expect((await readCheckout(repo, epicStatusRunner(home, ownEnv))).error).toBeNull()
  })

  it('takes WORFY_HARNESS_HOME as the Harness home when it is set', async () => {
    const repo = makeRepo(dir)
    const { harnessHome, harnessEnv } = makePluginHome(dir)
    const before = process.env.WORFY_HARNESS_HOME
    process.env.WORFY_HARNESS_HOME = harnessHome
    try {
      // The Claude home is elsewhere and empty: the Harness home comes from the variable.
      const { model } = await readWorkflow({ root: repo, claudeHome: join(dir, 'empty-claude-home'), env: ownEnv })
      expect(model.error).toBeNull()
      expect(calls(harnessEnv)).toEqual([harnessHome])
    } finally {
      if (before === undefined) delete process.env.WORFY_HARNESS_HOME
      else process.env.WORFY_HARNESS_HOME = before
    }
  })

  it('keeps running <claudeHome>/bin/epic-status, without HARNESS_HOME, while the old Harness is there next to the plugin', async () => {
    const repo = makeRepo(dir)
    const { harnessEnv } = makePluginHome(dir)
    const { home, log } = makeClaudeHome(dir)
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(model.error).toBeNull()
    expect(calls(log)).toEqual(['.'])
    // The plugin's script was not run.
    expect(calls(harnessEnv)).toEqual([])
  })

  it('runs once more with the plugin when the old Harness goes away during a run (the move of ticket 14), instead of keeping the error', async () => {
    const repo = makeRepo(dir)
    const { home, log, harnessEnv } = makePluginHome(dir)
    // The old epic-status: the move takes <home>/bin away while it runs, and it fails.
    mkdirSync(join(home, 'bin'))
    writeFileSync(join(home, 'bin', 'epic-status'), `#!/bin/sh\nrm -rf '${join(home, 'bin')}'\nexit 1\n`)
    chmodSync(join(home, 'bin', 'epic-status'), 0o755)
    const model = await readCheckout(repo, epicStatusRunner(home, ownEnv))
    expect(model.error).toBeNull()
    expect(model.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4])
    expect(calls(log)).toEqual(['.'])
    expect(calls(harnessEnv)).toHaveLength(1)
  })

  it('does not run again when the Harness is the same after a failed run', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    process.env.STUB_MODE = 'fail'
    expect((await readCheckout(repo, epicStatusRunner(home, ownEnv))).error?.code).toBe('failed')
    expect(calls(log)).toEqual(['.'])
  })

  it('writes nothing under the Claude home or the Harness home while reading through the plugin', async () => {
    const repo = makeRepo(dir)
    const { home } = makePluginHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const before = treeState(home)
    await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(treeState(home)).toEqual(before)
  })

  it('reports a failing script and output that is not the expected JSON', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    process.env.STUB_MODE = 'fail'
    const failed = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(failed.error?.code).toBe('failed')
    expect(failed.error?.message).toMatch(/stub broke on purpose/)
    expect(failed.tickets).toEqual([])

    process.env.STUB_MODE = 'garbage'
    const garbage = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(garbage.error?.code).toBe('invalid-output')

    const wrongShape = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv }, async () => JSON.stringify({ ref: 'main', epics: [], tickets: [{ epic: 'demo', num: 'one' }] }))).model
    expect(wrongShape.error?.code).toBe('invalid-output')
  })

  it('writes nothing into the Project or the Claude home: both trees, .git included, are byte-for-byte the same after reads and watching', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const statusBefore = git(repo, 'status', '--porcelain', '--untracked-files=all')
    const before = treeState(repo)
    const homeBefore = treeState(home)

    await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
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

// ── Silent mode and a Harness without it (worfy-harness ticket 23) ───────────

/**
 * Stub `bin/profile` and `bin/ticket` next to bin/epic-status. `profile --json` prints `json` with
 * exit code `code`; `ticket root` prints `ticketsRoot` (exit 1 when it is null). Each run is logged
 * to `harness-calls.log` next to the Claude home, so the home itself stays as it was.
 */
function stubHarness(home: string, profile: { code: number; json: unknown }, ticketsRoot: string | null): string {
  const log = join(home, '..', 'harness-calls.log')
  writeFileSync(log, '')
  const answer = join(home, 'profile.json')
  writeFileSync(answer, typeof profile.json === 'string' ? profile.json : JSON.stringify(profile.json))
  const profileScript = join(home, 'bin', 'profile')
  writeFileSync(profileScript, `#!/bin/sh\necho "profile $*" >> '${log}'\ncat '${answer}'\nexit ${profile.code}\n`)
  chmodSync(profileScript, 0o755)
  const ticketScript = join(home, 'bin', 'ticket')
  writeFileSync(ticketScript, `#!/bin/sh\necho "ticket $* in $(pwd -P)" >> '${log}'\n${ticketsRoot === null ? 'exit 1' : `echo '${ticketsRoot}'`}\n`)
  chmodSync(ticketScript, 0o755)
  return log
}

/**
 * A Silent Project: the repository has no `.scratch` (and a worktree on `demo/02`), the Workflow
 * folder is another temporary folder with Epic `demo` — spec.md and two Tickets that name their
 * branch and repository.
 */
function makeSilent(base: string): { repo: string; folder: string; scratch: string } {
  const repo = join(base, 'silent-repo')
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, 'README.md'), 'code only\n')
  git(base, 'init', '-q', '-b', 'main', repo)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'code')
  git(repo, 'worktree', 'add', '-q', '-b', 'demo/02', join(repo, '.claude', 'worktrees', '02'), 'main')
  const folder = join(base, 'workflow-folder')
  const scratch = join(folder, '.scratch')
  const issues = join(scratch, 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(scratch, 'demo', 'spec.md'), '# Silent epic: tickets outside the repository\n')
  writeFileSync(join(issues, '01-first.md'), ticketText(1, 'claimed — 2026-10-09', '—', ['src/a.ts']).replace('Type: task', 'Type: task\nBranch: fix/first\nRepo: silent-repo'))
  writeFileSync(join(issues, '02-second.md'), ticketText(2, 'open', '01', ['src/b.ts', 'src/c.ts']))
  return { repo, folder, scratch }
}

const silentProfile = (repo: string, folder: string) => ({
  name: 'silent',
  mode: 'silent',
  _resolved: { name: 'silent', mode: 'silent', workflow_folder: folder, workspace: null, repos: [{ name: 'silent-repo', path: repo, gate_key: 'silent' }] },
})

describe('workflow reader in Silent mode', () => {
  it('Silent Project: the Epic title from spec.md and the Ticket files come from the Workflow folder; no epic-status --ref, fromBranch null', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const { home, log } = makeClaudeHome(dir)
    const harnessLog = stubHarness(home, { code: 0, json: silentProfile(repo, folder) }, scratch)
    process.env.STUB_SCRATCH = scratch

    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(model.error).toBeNull()
    expect(model.epics).toEqual([{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Silent epic: tickets outside the repository' }])
    expect(ticketOf(model, 1)).toMatchObject({ state: 'work', files: ['src/a.ts'], filesListed: true, fromBranch: null, branch: 'fix/first', repo: 'silent-repo' })
    expect(ticketOf(model, 2)).toMatchObject({ state: 'open', files: ['src/b.ts', 'src/c.ts'], filesListed: true, fromBranch: null })
    expect(model.branchErrors).toEqual([])
    // The worktree on demo/02 is there, and still no branch is read: in Silent mode the status lives in the Workflow folder only.
    expect(calls(log)).toEqual(['.'])
    expect(calls(harnessLog)).toEqual([`profile -C ${repo} --json`, `ticket root in ${realpathSync(repo)}`])
  })

  it('a Ticket file edited in the Workflow folder comes as a new model through the watcher; refs are not read', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const { home, log } = makeClaudeHome(dir)
    stubHarness(home, { code: 0, json: silentProfile(repo, folder) }, scratch)
    process.env.STUB_SCRATCH = scratch
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas)
    expect(ticketOf(watcher.current, 2)?.state).toBe('open')

    const file = join(scratch, 'demo', 'issues', '02-second.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked — waiting').replace('`src/c.ts`', '`src/d.ts`'))
    const { delta } = await nextDelta(deltas, (d) => d.tickets.length > 0)
    expect(delta.tickets.map((t) => [t.num, t.state, t.files, t.fromBranch])).toEqual([[2, 'blocked', ['src/b.ts', 'src/d.ts'], null]])

    // A new commit on the Ticket branch of the worktree changes nothing and runs no --ref.
    const worktree = join(repo, '.claude', 'worktrees', '02')
    writeFileSync(join(worktree, 'x.txt'), 'x')
    git(worktree, 'add', 'x.txt')
    git(worktree, 'commit', '-qm', 'x')
    await new Promise((done) => setTimeout(done, 700))
    await watcher.idle()
    expect(calls(log).filter((call) => call !== '.')).toEqual([])
  })

  it('a Full Project and a Harness without the new fields read as before the Ticket: exit 4, no _resolved.mode, a failing script', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const before = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(ticketOf(before, 2)).toMatchObject({ state: 'work', fromBranch: 'demo/02' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    for (const [label, profile, ticketsRoot] of [
      ['Full mode', { code: 0, json: { mode: 'full', _resolved: { mode: 'full', workflow_folder: repo, workspace: null, repos: [{ name: 'project', path: repo, gate_key: 'p' }] } } }, join(repo, '.scratch')],
      ['exit code 4', { code: 4, json: '' }, null],
      ['no _resolved.mode', { code: 0, json: { name: 'old', _resolved: { name: 'old', dir: '/x', repo_root: repo } } }, null],
      ['a failing script', { code: 1, json: 'registry is broken' }, null],
      ['exit code 3', { code: 3, json: '' }, null],
    ] as const) {
      stubHarness(home, profile, ticketsRoot)
      const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
      expect(model, label).toEqual(before)
    }
    warn.mockRestore()
  })

  it('writes nothing into the Workflow folder, the repository or the Claude home while reading and watching', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const { home } = makeClaudeHome(dir)
    stubHarness(home, { code: 0, json: silentProfile(repo, folder) }, scratch)
    process.env.STUB_SCRATCH = scratch
    const status = git(repo, 'status', '--porcelain', '--untracked-files=all')
    const refs = git(repo, 'for-each-ref')
    const [repoBefore, folderBefore, homeBefore] = [treeState(repo), treeState(folder), treeState(home)]

    await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    const watcher = await startWatcher(repo, home, [])
    await new Promise((done) => setTimeout(done, 500))
    await watcher.close()

    expect(treeState(repo)).toEqual(repoBefore)
    expect(treeState(folder)).toEqual(folderBefore)
    expect(treeState(home)).toEqual(homeBefore)
    expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe(status)
    expect(git(repo, 'for-each-ref')).toBe(refs)
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

  it('watches only what epic-status reads under the Tickets root', () => {
    const root = join(dir, '.scratch')
    const skips = ticketsIgnored(root)
    for (const path of [root, join(root, 'demo'), join(root, 'demo', 'spec.md'), join(root, 'demo', 'map.md'), join(root, 'demo', 'issues'), join(root, 'demo', 'issues', '03-third.md')]) {
      expect(skips(path), path).toBe(false)
    }
    for (const path of [
      join(root, 'demo', 'logs'),
      join(root, 'demo', 'logs', 'node_modules'),
      join(root, 'demo', 'evidence', '12-aligner', '.venv', 'lib', 'site.py'),
      join(root, 'demo', 'issues', 'notes.txt'),
      join(root, 'demo', 'issues', 'old'),
      join(root, 'demo', 'issues', 'old', '01-first.md'),
    ]) {
      expect(skips(path), path).toBe(true)
    }
  })

  it('treats an Epic folder whose name starts with two dots as an Epic, and a path outside the Tickets root as outside', () => {
    const root = join(dir, '.scratch')
    const skips = ticketsIgnored(root)
    for (const path of [join(root, '..hidden'), join(root, '..hidden', 'spec.md'), join(root, '..hidden', 'issues'), join(root, '..hidden', 'issues', '01-a.md'), join(root, '...', 'map.md')]) {
      expect(skips(path), path).toBe(false)
    }
    for (const path of [join(root, '..hidden', 'logs'), join(root, '..hidden', 'logs', 'x.log'), join(root, '..hidden', 'node_modules'), join(root, '...', 'evidence')]) {
      expect(skips(path), path).toBe(true)
    }
    // Outside the root nothing is skipped, as before: chokidar asks about the parent folder when the
    // root does not exist yet.
    for (const path of [join(root, '..'), join(root, '..', 'x'), join(`${root}2`, 'e', 'issues', '01.md'), join(`${root}2`, 'e', 'logs', 'x.log')]) {
      expect(skips(path), path).toBe(false)
    }
  })

  it('watches spec.md, map.md and issues whatever the case of their letters; a Ticket ends in .md as written', () => {
    // On a disk that ignores case (the default on macOS and Windows) epic-status finds Issues/ and
    // Spec.md too. Its glob for Tickets is *.md, and that one tells the case apart on any disk.
    const root = join(dir, '.scratch')
    const skips = ticketsIgnored(root)
    for (const path of [join(root, 'e', 'Spec.md'), join(root, 'e', 'MAP.md'), join(root, 'e', 'Issues'), join(root, 'e', 'Issues', '01-a.md'), join(root, 'e', 'ISSUES', '02-b.md')]) {
      expect(skips(path), path).toBe(false)
    }
    for (const path of [join(root, 'e', 'Issues', '01-a.MD'), join(root, 'e', 'Issues', 'sub', 'x.md'), join(root, 'e', 'Issues', 'notes.TXT'), join(root, 'e', 'Logs')]) {
      expect(skips(path), path).toBe(true)
    }
  })

  it('follows a Tickets root made after the start: the first Ticket, then an edit of it and a second Ticket', async () => {
    // A new Project before its first Epic: a repository with no `.scratch` yet.
    const repo = join(dir, 'project')
    mkdirSync(repo)
    writeFileSync(join(repo, 'README.md'), 'code only\n')
    git(dir, 'init', '-q', '-b', 'main', repo)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'code')
    const { home } = makeClaudeHome(dir)
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas)
    expect(watcher.current.tickets).toEqual([])

    const issues = join(repo, '.scratch', 'demo', 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# Demo epic: made after the start\n')
    const file = join(issues, '01-first.md')
    writeFileSync(file, ticketText(1, 'open', '—', null))
    const added = await nextDelta(deltas, (d) => d.tickets.some((t) => t.num === 1))
    expect(added.delta.tickets.map((t) => [t.epic, t.num, t.state])).toEqual([['demo', 1, 'open']])
    await watcher.idle()

    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked — waiting'))
    const edited = await nextDelta(deltas, (d) => d.tickets.length > 0)
    expect(edited.delta.tickets.map((t) => [t.num, t.state])).toEqual([[1, 'blocked']])

    writeFileSync(join(issues, '02-second.md'), ticketText(2, 'open', '01', null))
    const second = await nextDelta(deltas, (d) => d.tickets.length > 0)
    expect(second.delta.tickets.map((t) => [t.num, t.state])).toEqual([[2, 'open']])
  })

  it('logs an error event of either file watch and does not throw', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    // Both watches by chokidar, as on every system but Windows: there the Tickets root has a watch of
    // its own (worfy-windows ticket 20), whose errors test/unit/link-safe-watch.test.ts covers.
    const watcher = await WorkflowWatcher.start({ root: repo, claudeHome: home, env: ownEnv, onChange: () => undefined, ticketsWatch: 'chokidar' })
    cleanups.push(() => watcher.close())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // The watcher keeps its two chokidar watchers private: the Tickets root first, then the git refs.
    const watchers = (watcher as unknown as { watchers: { emit(event: 'error', error: Error): boolean }[] }).watchers
    expect(watchers).toHaveLength(2)
    const failure = new Error('EMFILE: too many open files, watch')

    // An 'error' event with no listener throws from `emit`.
    for (const one of watchers) expect(() => one.emit('error', failure)).not.toThrow()
    expect(logged.mock.calls).toEqual([
      ['[workflow] checkout watch error', failure],
      ['[workflow] branches watch error', failure],
    ])
    logged.mockRestore()
  })

  it('reads nothing again for a change outside what epic-status reads, a linked node_modules included, and still sees a new Epic', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    const modules = join(dir, 'node_modules')
    mkdirSync(join(modules, 'pkg'), { recursive: true })
    writeFileSync(join(modules, 'pkg', 'index.js'), '')
    const logs = join(repo, '.scratch', 'demo', 'logs')
    mkdirSync(logs)
    symlinkSync(modules, join(logs, 'node_modules'), 'dir')
    const deltas: WorkflowDelta[] = []
    await startWatcher(repo, home, deltas)
    writeFileSync(log, '')

    writeFileSync(join(modules, 'pkg', 'index.js'), 'changed')
    writeFileSync(join(logs, 'run.txt'), 'a log line')
    await new Promise((done) => setTimeout(done, 1000))
    expect(calls(log)).toEqual([])

    mkdirSync(join(repo, '.scratch', 'later', 'issues'), { recursive: true })
    writeFileSync(join(repo, '.scratch', 'later', 'issues', '01-new.md'), ticketText(1, 'open', '—', null))
    const { delta } = await nextDelta(deltas, (d) => d.tickets.some((t) => t.epic === 'later'))
    expect(delta.tickets.map((t) => [t.epic, t.num])).toEqual([['later', 1]])
  })

  it('does not lose a Ticket saved while the first read runs', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home, ownEnv)
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

  it('sends no onChange before start resolves, though a save during the first read makes start read twice', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home, ownEnv)
    const file = join(repo, '.scratch/demo/issues/03-third.md')
    let saved = false
    // The first checkout read saves a Ticket and lasts until the watcher has seen the save and asked
    // for one more read, which `start` then runs before it resolves.
    const racing: EpicStatusRunner = async (cwd, ref) => {
      const out = await real(cwd, ref)
      if (ref === null && !saved) {
        saved = true
        writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed — 2026-10-05'))
        await new Promise((done) => setTimeout(done, 1000))
      }
      return out
    }
    const deltas: WorkflowDelta[] = []
    let started = false
    const early: WorkflowDelta[] = []
    const watcher = await WorkflowWatcher.start({
      root: repo,
      claudeHome: home,
      env: ownEnv,
      run: racing,
      debounceMs: 50,
      onChange: (delta) => (started ? deltas : early).push(delta),
    })
    started = true
    cleanups.push(() => watcher.close())
    // The second read ran inside start: its result is already the model.
    expect(ticketOf(watcher.current, 3)?.state).toBe('work')
    await watcher.idle()
    expect(early).toEqual([])
  })

  // Counts reads after fs.watch events: FSEvents on macOS coalesces a save, inotify on the Linux CI

  // runner reports more events. worfy runs on macOS only; the Mac runs this in every gate.

  it.skipIf(process.platform !== 'darwin')('waits for 300 ms of quiet: saves closer together than that give exactly one read', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home, ownEnv)
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
    const real = epicStatusRunner(home, ownEnv)
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

  it('reads during a steady stream of saves: saves every 200 ms for 3 s give a read before the stream ends', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const real = epicStatusRunner(home, ownEnv)
    let checkoutReads = 0
    const counting: EpicStatusRunner = async (cwd, ref) => {
      if (ref === null) checkoutReads += 1
      return real(cwd, ref)
    }
    const deltas: WorkflowDelta[] = []
    const watcher = await startWatcher(repo, home, deltas, counting)
    expect(checkoutReads).toBe(1)

    const file = join(repo, '.scratch/demo/issues/03-third.md')
    const original = readFileSync(file, 'utf8')
    for (let i = 0; i < 15; i += 1) {
      writeFileSync(file, original.replace(/^Status: .*$/m, `Status: blocked — save ${i}`))
      await new Promise((done) => setTimeout(done, 200))
    }
    // Before max-wait every save restarted the 300 ms quiet period, and nothing was read until
    // the stream stopped.
    const readsDuringStream = checkoutReads - 1
    const deltasDuringStream = deltas.filter((d) => d.tickets.some((t) => t.num === 3)).length
    await watcher.idle()

    expect(readsDuringStream).toBeGreaterThanOrEqual(1)
    expect(deltasDuringStream).toBeGreaterThanOrEqual(1)
  })
})

describe('Debounce: quiet period with max-wait', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires no later than max-wait after the first event, however often events keep coming', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const start = Date.now()
    const fired: number[] = []
    const debounce = new Debounce(300, 1000, () => fired.push(Date.now() - start))
    // An event every 200 ms for 3 s: the quiet period alone would never end.
    for (let at = 0; at < 3000; at += 200) {
      debounce.trigger()
      vi.advanceTimersByTime(200)
    }
    // Each series ends at its max-wait; the next event starts a new one.
    expect(fired).toEqual([1000, 2000, 3000])

    // A last event after the stream: the quiet period alone decides, then nothing more.
    debounce.trigger()
    vi.advanceTimersByTime(299)
    expect(fired).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(fired).toEqual([1000, 2000, 3000, 3300])
    vi.advanceTimersByTime(5000)
    expect(fired).toHaveLength(4)
    expect(debounce.scheduled).toBe(false)
  })

  it('still waits only for the quiet period after a short burst, and cancel drops a scheduled call', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let fired = 0
    const debounce = new Debounce(300, 1000, () => (fired += 1))
    debounce.trigger()
    vi.advanceTimersByTime(60)
    debounce.trigger()
    vi.advanceTimersByTime(299)
    expect(fired).toBe(0)
    expect(debounce.scheduled).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
    // The max-wait timer of the finished series is gone: it does not fire on its own later.
    vi.advanceTimersByTime(2000)
    expect(fired).toBe(1)

    debounce.trigger()
    debounce.cancel()
    vi.advanceTimersByTime(2000)
    expect(fired).toBe(1)
    expect(debounce.scheduled).toBe(false)
  })
})

// ── hub ──────────────────────────────────────────────────────────────────────

describe('workflow hub', () => {
  it('shares one watcher per Project: the other window keeps getting changes after one leaves', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const hub = new WorkflowHub({ claudeHome: home, env: ownEnv })
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
    const real = epicStatusRunner(home, ownEnv)
    let scriptMs = 0
    const timed: EpicStatusRunner = async (cwd, ref) => {
      const start = performance.now()
      try {
        return await real(cwd, ref)
      } finally {
        scriptMs += performance.now() - start
      }
    }

    const previous = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv }, timed)).model
    const samples: number[] = []
    for (let i = 0; i < 3; i += 1) {
      scriptMs = 0
      const start = performance.now()
      const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv }, timed)
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
    // The app's hub runs the scripts with the login shell environment. The stub needs STUB_LOG of
    // this process, and a test must not run the login shell of the machine it runs on.
    vi.doMock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: ownEnv }))
    cleanups.push(async () => vi.doUnmock('../../src/main/harness/script-env'))
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
