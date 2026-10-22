// The workflow reader and watcher against a temporary git repository with worktrees, and a stub
// `bin/epic-status` in a temporary WORFY_CLAUDE_HOME. The stub reads Tickets the way the real
// script does for these tests' simple files: from the working tree, or from a branch for `--ref`.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { codeSection, enrichSnapshot, readCheckout, readWorkflow, epicStatusRunner, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { Debounce, ticketsIgnored, WorkflowHub, WorkflowWatcher, type WatchOptions } from '../../src/main/workflow/watch'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { diffModels, type EpicStatusSnapshot, type WorkflowDelta, type WorkflowModel } from '../../src/shared/workflow/types'
import { hasSh, NODE_DIR, withPath } from '../harness-node'
import { generateScratch } from './scratch-gen'
import { removeTestTree } from '../remove'

/**
 * The scripts' environment the readers are handed here: this process's own. The stub below reads
 * STUB_LOG, STUB_MODE and the like from it, and a test changes them between reads, so it is asked
 * on every run. In the app it is the login shell's (src/main/harness/script-env.ts).
 */
const ownEnv = (): Promise<NodeJS.ProcessEnv> => Promise.resolve(process.env)

// ── stub epic-status ──────────────────────────────────────────────────────────

/**
 * The stand-ins of the Harness scripts are files in test/fixtures, the same in every test; a test
 * only links them into its temporary homes. macOS checks every new executable file on its first run,
 * one at a time for the whole machine, and a new script per test made the tests of a loaded full
 * run time out at 15 s (worfy-polish ticket 30). They are Node scripts: worfy runs them as
 * `node <script>` with the node on the PATH of the environment it is handed (test/harness-node.ts).
 */
const FIXTURES = join(__dirname, '..', 'fixtures')
const WORKFLOW_STUB = join(FIXTURES, 'workflow-stub')
const CANNED = join(FIXTURES, 'harness-stub', 'canned')

/** Links `target` at `path`, replacing whatever link was there. */
function link(target: string, path: string): void {
  rmSync(path, { force: true })
  symlinkSync(target, path)
}

/**
 * The canned Harness script (test/fixtures/harness-stub/canned) at `path`: prints `out`, exits with
 * `code`, and logs each run to `log` when it is given.
 */
function canned(path: string, answer: { out: string; code: number; log?: string }): void {
  link(CANNED, path)
  writeFileSync(`${path}.out`, answer.out)
  writeFileSync(`${path}.code`, String(answer.code))
  if (answer.log === undefined) rmSync(`${path}.log`, { force: true })
  else writeFileSync(`${path}.log`, answer.log)
}

/** A temporary Claude home whose bin/epic-status runs the stub with this test's Node. */
function makeClaudeHome(dir: string): { home: string; log: string } {
  const home = join(dir, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  link(join(WORKFLOW_STUB, 'epic-status'), join(home, 'bin', 'epic-status'))
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
  const harnessEnv = join(dir, 'harness-env.log')
  writeFileSync(harnessEnv, '')
  process.env.STUB_HARNESS_ENV = harnessEnv
  link(join(WORKFLOW_STUB, 'plugin-epic-status'), join(plugin, 'bin', 'epic-status'))
  const log = join(dir, 'stub-calls.log')
  writeFileSync(log, '')
  process.env.STUB_LOG = log
  return { home, harnessHome, log, harnessEnv }
}

const calls = (log: string): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean)

/** An empty folder of this test: a PATH of it has no node. */
function emptyDir(): string {
  const path = join(dir, 'no-node-here')
  mkdirSync(path, { recursive: true })
  return path
}

/**
 * Takes node off this process's own PATH, as worfy started from Finder has it; gives back the undo.
 * Every spelling of the key goes: on Windows `Path` and `PATH` are one variable.
 */
function withoutNodeHere(): () => void {
  const saved = Object.entries(process.env).filter(([key]) => key.toUpperCase() === 'PATH')
  for (const [key] of saved) delete process.env[key]
  process.env.PATH = emptyDir()
  return () => {
    delete process.env.PATH
    for (const [key, value] of saved) process.env[key] = value
  }
}

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
  writeFileSync(join(issues, '01-first.md'), ticketText(1, 'done 2026-10-01', '—', ['src/a.ts']))
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
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed 2026-10-05'))
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
  delete process.env.STUB_HARNESS_ENV
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
  it('reads Epics and Tickets from epic-status and adds the trail-section files and the Epic title', async () => {
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
      ['blockedNums', 'blockedParsed', 'blockedRaw', 'blockedReason', 'epic', 'fromBranch', 'files', 'filesListed', 'manualChecks', 'num', 'pr', 'slug', 'state', 'statusAt', 'statusError', 'statusRaw', 'title', 'version', 'waits'].sort(),
    )
  })

  it('gives each Ticket the version of its file text: an edit of the body alone is a change of the Ticket', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const first: WorkflowModel = { ...(await readCheckout(repo, epicStatusRunner(home, ownEnv))), branchErrors: [] }
    const file = join(repo, '.scratch', 'demo', 'issues', '02-second.md')
    const before = ticketOf(first, 2)?.version
    expect(before).toMatch(/^[0-9a-f]{16}$/)
    // Another Ticket's file has a version of its own.
    expect(ticketOf(first, 1)?.version).not.toBe(before)
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n## Итог\n\nOnly the body changed.\n`)
    const second: WorkflowModel = { ...(await readCheckout(repo, epicStatusRunner(home, ownEnv))), branchErrors: [] }
    expect(ticketOf(second, 2)?.version).not.toBe(before)
    expect(ticketOf(second, 1)?.version).toBe(ticketOf(first, 1)?.version)
    const delta = diffModels(first, second)
    expect(delta?.tickets.map((ticket) => ticket.num)).toEqual([2])
  })

  it('carries the manual checks of each Ticket\'s done section; a Ticket without them has []', async () => {
    const repo = makeRepo(dir)
    const issues = join(repo, '.scratch', 'demo', 'issues')
    const done = (items: string[]) => ['', '## Готово, когда', '', ...items, ''].join('\n')
    writeFileSync(join(issues, '01-first.md'), ticketText(1, 'done 2026-10-01', '—', ['src/a.ts']) + done(['- [ ] `pnpm test` exit 0', '- [x] (вручную) Stable copy: the frame is drawn.', '- [ ] (вручную) Stable copy after the merge:', '      the palette lists this check.']))
    writeFileSync(join(issues, '02-second.md'), ticketText(2, 'open', '01', ['src/b.ts']) + done(['- [ ] (вручную) dev build: ⌘Z undoes the move.']))
    const { home } = makeClaudeHome(dir)
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })

    expect(model.error).toBeNull()
    expect(ticketOf(model, 1)?.manualChecks).toEqual([
      { text: 'Stable copy: the frame is drawn.', checked: true },
      { text: 'Stable copy after the merge: the palette lists this check.', checked: false },
    ])
    expect(ticketOf(model, 2)?.manualChecks).toEqual([{ text: 'dev build: ⌘Z undoes the move.', checked: false }])
    expect(ticketOf(model, 3)?.manualChecks).toEqual([])
  })

  it('shows a Ticket claimed in a worktree branch as in work, marked with the branch; the mark goes after the merge', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')

    const before = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(ticketOf(before, 2)).toMatchObject({ state: 'work', statusRaw: 'claimed 2026-10-05', fromBranch: 'demo/02' })
    expect(ticketOf(before, 3)).toMatchObject({ state: 'open', fromBranch: null })
    // The checkout itself still says open: the claim lives in the branch only.
    expect(readFileSync(join(repo, '.scratch/demo/issues/02-second.md'), 'utf8')).toMatch(/^Status: open$/m)

    git(repo, 'merge', '-q', '--ff-only', 'demo/02')
    const after = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(ticketOf(after, 2)).toMatchObject({ state: 'work', statusRaw: 'claimed 2026-10-05', fromBranch: null })
  })

  it('does not let a branch left over after the merge override a Ticket done in the checkout', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const file = join(repo, '.scratch/demo/issues/02-second.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: done 2026-10-06'))
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(ticketOf(model, 2)).toMatchObject({ state: 'done', fromBranch: null })
  })

  it('does not let a branch that never touched its Ticket (open from its base) override blocked in the checkout (ticket 30, Ticket 15 on 2026-10-06)', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    // The branch's worktree is made from main and leaves the Ticket file alone: Status open, as on its base.
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/03', join(repo, '.claude', 'worktrees', '03'), 'main')
    const file = join(repo, '.scratch/demo/issues/03-third.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked 2026-10-06\nBlocked reason: rejected by review'))
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(ticketOf(model, 3)).toMatchObject({ state: 'blocked', statusRaw: 'blocked 2026-10-06', blockedReason: 'rejected by review', fromBranch: null })
  })

  it('does not let a branch say claimed or done over blocked in the checkout: a Ticket sent back for rework stays blocked (ticket 30)', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const path = join(repo, '.claude', 'worktrees', '03')
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/03', path, 'main')
    const file = join(repo, '.scratch/demo/issues/03-third.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked 2026-10-06\nBlocked reason: rejected by review'))
    const branchFile = join(path, '.scratch/demo/issues/03-third.md')
    for (const status of ['claimed 2026-10-06', 'done 2026-10-06']) {
      writeFileSync(branchFile, readFileSync(branchFile, 'utf8').replace(/^Status: .*$/m, `Status: ${status}`))
      git(path, 'commit', '-qam', `03: ${status}`)
      expect(ticketOf((await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model, 3), status).toMatchObject({
        state: 'blocked',
        statusRaw: 'blocked 2026-10-06', blockedReason: 'rejected by review',
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
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed 2026-10-06'))
    // The branch still says open, from its base: the checkout's claim stands.
    expect(ticketOf((await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model, 4)).toMatchObject({ state: 'work', statusRaw: 'claimed 2026-10-06', fromBranch: null })
    // The branch blocks the Ticket: that is news the checkout does not have yet.
    const branchFile = join(path, '.scratch/demo/issues/04-fourth.md')
    writeFileSync(branchFile, readFileSync(branchFile, 'utf8').replace(/^Status: .*$/m, 'Status: blocked 2026-10-07\nBlocked reason: waits for the owner\nWaits: owner'))
    git(path, 'commit', '-qam', 'block 04')
    // The reason, Waits and the time come with the branch's state, not from the checkout's claim.
    expect(ticketOf((await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model, 4)).toMatchObject({
      state: 'blocked',
      statusRaw: 'blocked 2026-10-07',
      statusAt: '2026-10-07',
      blockedReason: 'waits for the owner',
      waits: 'owner',
      fromBranch: 'demo/04',
    })
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
    // A missing script is said before a missing node: neither file is there to run.
    const bare = await readCheckout(repo, epicStatusRunner(join(dir, 'no-such-home'), () => Promise.resolve(withPath(process.env, [emptyDir()]))))
    expect(bare.error).toEqual({ code: 'not-found', message: `epic-status not found: ${legacy} or ${plugin}` })
  })

  // worfy-windows ticket 05: the script runs as `node <script>`, node from the environment handed to the runner.
  it("reads the Epics with node only on the PATH of the runner's environment, none on worfy's own", async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    const scriptsEnv = withPath(process.env, [NODE_DIR])
    const restore = withoutNodeHere()
    try {
      const model = await readCheckout(repo, epicStatusRunner(home, () => Promise.resolve(scriptsEnv)))
      expect(model.error).toBeNull()
      expect(model.epics.map((epic) => epic.epic)).toEqual(['demo'])
      expect(model.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4])
    } finally {
      restore()
    }
  })

  /**
   * An older Harness in <dir>/claude-home/bin: its epic-status is a bash script that prints Epic
   * `demo` when called as worfy calls it, `--json` or `--json --ref <branch>`; any other arguments
   * fail with exit code 2 and say so, so a start that loses them does not read the Epics.
   */
  function bashHarness(): { home: string; script: string } {
    const home = join(dir, 'claude-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    const answer = join(dir, 'bash-answer.json')
    writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [] }))
    const script = join(home, 'bin', 'epic-status')
    const expected = '[ "$#" -eq 1 ] && [ "$1" = --json ] || { [ "$#" -eq 3 ] && [ "$1" = --json ] && [ "$2" = --ref ] && [ -n "$3" ]; }'
    writeFileSync(script, `#!/bin/sh\nif ! { ${expected}; }; then echo "epic-status stand-in: unexpected arguments: $*" >&2; exit 2; fi\ncat '${answer}'\n`)
    chmodSync(script, 0o755)
    return { home, script }
  }

  // The stand-in itself, run by sh wherever there is one (on Windows, Git Bash's): it answers only
  // to worfy's arguments, so the case below proves they reach the script.
  it.skipIf(!hasSh())("the older Harness's stand-in answers only to the arguments worfy passes", () => {
    const { script } = bashHarness()
    const run = (args: string[]): ReturnType<typeof spawnSync> => spawnSync('sh', [script, ...args], { encoding: 'utf8' })
    for (const args of [['--json'], ['--json', '--ref', 'demo/02']]) {
      const ok = run(args)
      expect(ok.status).toBe(0)
      expect(JSON.parse(String(ok.stdout))).toMatchObject({ epics: [{ epic: 'demo' }] })
    }
    for (const args of [[], ['--ref', 'demo/02'], ['--json', '--ref'], ['--json', 'extra']]) {
      const refused = run(args)
      expect(refused.status).toBe(2)
      expect(String(refused.stderr)).toContain('epic-status stand-in: unexpected arguments')
    }
  })

  // An older Harness (the old <claude home>/bin, or a plugin not updated yet) still has the bash epic-status.
  it.skipIf(process.platform === 'win32')("an older Harness's bash epic-status is started by itself, not by node, which could not read it", async () => {
    const repo = makeRepo(dir)
    const { home } = bashHarness()
    const model = await readCheckout(repo, epicStatusRunner(home, ownEnv))
    expect(model.error).toBeNull()
    expect(model.epics.map((epic) => epic.epic)).toEqual(['demo'])
    // A branch's read passes `--ref <branch>` too.
    expect(JSON.parse(await epicStatusRunner(home, ownEnv)(repo, 'demo/02'))).toMatchObject({ epics: [{ epic: 'demo' }] })
  })

  it.skipIf(process.platform !== 'win32')("on Windows an older Harness's bash epic-status is not run, and the reason says to update the Harness", async () => {
    const repo = makeRepo(dir)
    const { home, script } = bashHarness()
    const model = await readCheckout(repo, epicStatusRunner(home, ownEnv))
    expect(model.epics).toEqual([])
    expect(model.error).toEqual({ code: 'failed', message: `this Harness's epic-status is not a Node script — update the Harness (${script})` })
  })

  it('says node is not on the PATH, not that epic-status is missing, when the environment has no node', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    const model = await readCheckout(repo, epicStatusRunner(home, () => Promise.resolve(withPath(process.env, [emptyDir()]))))
    expect(model.error?.code).toBe('not-found')
    expect(model.error?.message).toBe(`node not found in PATH: epic-status is not run (${join(home, 'bin', 'epic-status')})`)
    // Nothing was started.
    expect(calls(log)).toEqual([])
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
    link(join(WORKFLOW_STUB, 'bin-gone'), join(home, 'bin', 'epic-status'))
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
  canned(join(home, 'bin', 'profile'), { out: typeof profile.json === 'string' ? profile.json : JSON.stringify(profile.json), code: profile.code, log })
  canned(join(home, 'bin', 'ticket'), ticketsRoot === null ? { out: '', code: 1, log } : { out: `${ticketsRoot}\n`, code: 0, log })
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
  writeFileSync(join(issues, '01-first.md'), ticketText(1, 'claimed 2026-10-09', '—', ['src/a.ts']).replace('Type: task', 'Type: task\nBranch: fix/first\nRepo: silent-repo'))
  writeFileSync(join(issues, '02-second.md'), ticketText(2, 'open', '01', ['src/b.ts', 'src/c.ts']))
  return { repo, folder, scratch }
}

const silentProfile = (repo: string, folder: string) => ({
  name: 'silent',
  mode: 'silent',
  _resolved: { name: 'silent', mode: 'silent', workflow_folder: folder, workspace: null, repos: [{ name: 'silent-repo', path: repo, gate_key: 'silent' }] },
})

// ── the headings the Profile names ───────────────────────────────────────────

// tickets.trail_section, tickets.done_section and tickets.manual_mark of `profile --json`: a Project
// whose documents are in another language. Without them the English defaults are read; the Russian
// ones of the Tickets above are read for one more release besides.
describe('workflow reader and the headings the Profile names', () => {
  const FRENCH = { trail_section: '## Fichiers', done_section: '## Fini quand', manual_mark: 'à la main' }
  const frenchTicket = (num: number, files: string[], checks: string[]): string =>
    [`# 0${num} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Fichiers', '', ...files.map((f) => `- \`${f}\``), '', '## Fini quand', '', ...checks, '',
      '## Where in code', '', '- `src/english.ts`', '', '## Done when', '', '- [ ] (manual) English', ''].join('\n')
  const englishTicket = (num: number, files: string[], checks: string[]): string =>
    [`# 0${num} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Where in code', '', ...files.map((f) => `- \`${f}\``), '', '## Done when', '', ...checks, ''].join('\n')
  const fullProfile = (repo: string, tickets?: object): object => ({
    mode: 'full',
    ...(tickets ? { tickets } : {}),
    _resolved: { mode: 'full', workflow_folder: repo, workspace: null, repos: [{ name: 'project', path: repo, gate_key: 'p' }] },
  })

  it('reads the trail section and the manual items under the headings the Profile names, and not the English ones then', async () => {
    const repo = makeRepo(dir)
    const issues = join(repo, '.scratch', 'demo', 'issues')
    writeFileSync(join(issues, '01-first.md'), frenchTicket(1, ['src/fr.ts', 'src/deux.ts'], ['- [ ] (à la main) la copie Stable', '- [x] (à la main, propriétaire) vu']))
    const { home } = makeClaudeHome(dir)
    stubHarness(home, { code: 0, json: fullProfile(repo, FRENCH) }, join(repo, '.scratch'))
    const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
    expect(model.error).toBeNull()
    expect(ticketOf(model, 1)).toMatchObject({
      files: ['src/fr.ts', 'src/deux.ts'],
      filesListed: true,
      manualChecks: [
        { text: 'la copie Stable', checked: false },
        { text: '(propriétaire) vu', checked: true },
      ],
    })
    // The Tickets of makeRepo are in Russian: read for one more release whatever the Profile names.
    expect(ticketOf(model, 2)).toMatchObject({ files: ['src/b.ts', 'src/shared.ts'], filesListed: true })
  })

  it('reads the English sections of a Profile that names none, and of a Harness without a Profile', async () => {
    const repo = makeRepo(dir)
    const issues = join(repo, '.scratch', 'demo', 'issues')
    writeFileSync(join(issues, '01-first.md'), englishTicket(1, ['src/en.ts'], ['- [ ] `pnpm test` exit 0', '- [ ] (manual) dev build: the frame is drawn.']))
    const { home } = makeClaudeHome(dir)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const [label, profile] of [
      ['a Profile without the fields', { code: 0, json: fullProfile(repo) }],
      ['no Profile (exit code 3)', { code: 3, json: '' }],
    ] as const) {
      stubHarness(home, profile, join(repo, '.scratch'))
      const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
      expect(ticketOf(model, 1), label).toMatchObject({ files: ['src/en.ts'], filesListed: true, manualChecks: [{ text: 'dev build: the frame is drawn.', checked: false }] })
    }
    warn.mockRestore()
  })

  it('the watcher reads the Tickets with the headings of the layout it asked for', async () => {
    const repo = makeRepo(dir)
    writeFileSync(join(repo, '.scratch', 'demo', 'issues', '01-first.md'), frenchTicket(1, ['src/fr.ts'], ['- [ ] (à la main) vérifier']))
    const { home } = makeClaudeHome(dir)
    stubHarness(home, { code: 0, json: fullProfile(repo, FRENCH) }, join(repo, '.scratch'))
    const watcher = await startWatcher(repo, home, [])
    expect(ticketOf(watcher.current, 1)).toMatchObject({ files: ['src/fr.ts'], manualChecks: [{ text: 'vérifier', checked: false }] })
  })

  it('codeSection: the English heading by default, the given one, and the characters of a heading as they are', () => {
    const markdown = ['# t', '', '## Where in code', '', '- `src/a.ts`', '', '## Files (all)', '', '- `src/b.ts`', ''].join('\n')
    expect(codeSection(markdown)).toEqual({ listed: true, files: ['src/a.ts'] })
    expect(codeSection(markdown, '## Files (all)')).toEqual({ listed: true, files: ['src/b.ts'] })
    expect(codeSection(markdown, '## Files (.*)')).toEqual({ listed: false, files: [] })
  })

  it('codeSection: a deeper heading stays in the section, a third-level Profile heading beside the old second-level one', () => {
    const markdown = ['# t', '', '## Где в коде', '', '- `src/a.ts`', '', '### Tests', '', '- `test/a.test.ts`', '', '## Next', '', '- `src/no.ts`',
      '', '### Fichiers', '', '- `src/b.ts`', '', '#### Détails', '', '- `src/c.ts`', '', '### Autre', '', '- `src/no2.ts`', ''].join('\n')
    expect(codeSection(markdown, '### Fichiers')).toEqual({ listed: true, files: ['src/a.ts', 'test/a.test.ts', 'src/b.ts', 'src/c.ts'] })
    // A second-level Profile heading is not met by a third-level one of the same text.
    expect(codeSection(markdown, '## Fichiers').files).toEqual(['src/a.ts', 'test/a.test.ts'])
  })
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
    expect(calls(harnessLog)).toEqual([`profile -C ${repo} --json in ${realpathSync(repo)}`, `ticket root in ${realpathSync(repo)}`])
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
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked\nBlocked reason: waiting').replace('`src/c.ts`', '`src/d.ts`'))
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

  it('a Full Project and a Harness without the new fields read as before the Ticket: Full mode, no _resolved.mode, exit code 3', async () => {
    const repo = makeRepo(dir)
    const { home } = makeClaudeHome(dir)
    claimInWorktree(repo, 'demo/02', '02', '02-second.md')
    const before = (await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })).model
    expect(ticketOf(before, 2)).toMatchObject({ state: 'work', fromBranch: 'demo/02' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    for (const [label, profile, ticketsRoot] of [
      ['Full mode', { code: 0, json: { mode: 'full', _resolved: { mode: 'full', workflow_folder: repo, workspace: null, repos: [{ name: 'project', path: repo, gate_key: 'p' }] } } }, join(repo, '.scratch')],
      ['no _resolved.mode', { code: 0, json: { name: 'old', _resolved: { name: 'old', dir: '/x', repo_root: repo } } }, null],
      ['exit code 3', { code: 3, json: '' }, null],
    ] as const) {
      stubHarness(home, profile, ticketsRoot)
      const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
      expect(model, label).toEqual(before)
    }
    warn.mockRestore()
  })

  it('a failed profile call (worfy-harness ticket 37) — exit code 4, a failing script: no Tickets, the reason in the model, epic-status not run', async () => {
    const repo = makeRepo(dir)
    const { home, log } = makeClaudeHome(dir)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const [label, profile, reason] of [
      ['exit code 4', { code: 4, json: '' }, /answered --json with exit code 4/],
      ['a failing script', { code: 1, json: 'registry is broken' }, /failed with exit code 1/],
    ] as const) {
      stubHarness(home, profile, null)
      writeFileSync(log, '')
      const { model } = await readWorkflow({ root: repo, claudeHome: home, env: ownEnv })
      expect(model, label).toMatchObject({ root: repo, epics: [], tickets: [], branchErrors: [], error: { code: 'failed' } })
      expect(model.error?.message, label).toMatch(/^worfy could not ask the Harness where the workflow of this Project lives: /)
      expect(model.error?.message, label).toMatch(reason)
      expect(calls(log), label).toEqual([])
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
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked\nBlocked reason: waiting'))
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

    writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: blocked\nBlocked reason: waiting'))
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
        writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed 2026-10-05'))
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
        writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, 'Status: claimed 2026-10-05'))
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

  // Counts reads after fs.watch events. Not on Linux: FSEvents on macOS coalesces a save, inotify on
  // the CI runner reports more events. worfy runs on macOS and Windows; the Mac and the Windows PC
  // run this in every gate.
  it.skipIf(process.platform === 'linux')('waits for 300 ms of quiet: saves closer together than that give exactly one read', async () => {
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
      writeFileSync(file, original.replace(/^Status: .*$/m, `Status: blocked\nBlocked reason: save ${i}`))
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

// ── a Tickets root that is not there ─────────────────────────────────────────

/**
 * A Silent Project whose Workflow folder has no `.scratch` yet: a git repository, as
 * harness/bin/project-connect makes it (`'git'`), or no folder at all (`'none'`: removed, or on a
 * disk that is not mounted).
 */
function makeSilentWithout(base: string, folderState: 'git' | 'none'): { repo: string; folder: string; scratch: string } {
  const repo = join(base, 'silent-repo')
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, 'README.md'), 'code only\n')
  git(base, 'init', '-q', '-b', 'main', repo)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'code')
  const folder = join(base, 'workflow-folder')
  if (folderState === 'git') git(base, 'init', '-q', '-b', 'main', folder)
  return { repo, folder, scratch: join(folder, '.scratch') }
}

/** Writes Epic `epic` with the open Tickets `nums` into the Tickets root `scratch`. */
function putEpic(scratch: string, epic: string, nums: number[]): void {
  const issues = join(scratch, epic, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(scratch, epic, 'spec.md'), `# ${epic}: an Epic\n`)
  for (const num of nums) writeFileSync(join(issues, `${String(num).padStart(2, '0')}-t.md`), ticketText(num, 'open', '—', null))
}

/** Sets the Status line of Ticket `num` of `epic` under `scratch`. */
function setStatus(scratch: string, epic: string, num: number, status: string): void {
  const file = join(scratch, epic, 'issues', `${String(num).padStart(2, '0')}-t.md`)
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, `Status: ${status}`))
}

const isFolder = (path: string): Promise<boolean> =>
  Promise.resolve().then(() => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  })

/**
 * A watch of the Tickets root that never reports anything: the notification about the root is lost.
 * Like chokidar's, its close removes every listener, so a 'ready' still to come reaches nobody.
 * `readyMs` is when it says 'ready'; `onMade` gets each watch made, to send it events.
 */
function deafWatch(made: string[], readyMs = 0, onMade: (watch: EventEmitter) => void = () => undefined): (ticketsRoot: string) => FSWatcher {
  return (ticketsRoot) => {
    made.push(ticketsRoot)
    const watch: EventEmitter & { close: () => Promise<void> } = Object.assign(new EventEmitter(), {
      close: () => {
        watch.removeAllListeners()
        return Promise.resolve()
      },
    })
    setTimeout(() => watch.emit('ready'), readyMs)
    onMade(watch)
    return watch as unknown as FSWatcher
  }
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Waits until `done` holds, or fails after `ms`. */
async function until(what: string, done: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await pause(10)
  }
}

const RETRY_MS = 100

async function startSilent(repo: string, folder: string, scratch: string, deltas: WorkflowDelta[], extra: Partial<WatchOptions> = {}): Promise<{ watcher: WorkflowWatcher; log: string }> {
  const { home, log } = makeClaudeHome(dir)
  stubHarness(home, { code: 0, json: silentProfile(repo, folder) }, scratch)
  process.env.STUB_SCRATCH = scratch
  const watcher = await WorkflowWatcher.start({
    root: repo,
    claudeHome: home,
    env: ownEnv,
    onChange: (delta) => deltas.push(delta),
    ticketsWatch: 'chokidar',
    ticketsRootRetryMs: RETRY_MS,
    ...extra,
  })
  cleanups.push(() => watcher.close())
  return { watcher, log }
}

const hasEpic = (epic: string) => (delta: WorkflowDelta) => delta.epics.some((e) => e.epic === epic)

/** The ticketsRootThere of the watcher, with each look counted in `looks`. */
const countedLooks = (looks: string[]) => (path: string) => {
  looks.push(path)
  return isFolder(path)
}

/** Real chokidar watches of the Tickets root, with the ones made and the ones still open. */
function countedChokidar(): { made: FSWatcher[]; open: Set<FSWatcher>; make: NonNullable<WatchOptions['watchTicketsRoot']> } {
  const open = new Set<FSWatcher>()
  const made: FSWatcher[] = []
  cleanups.push(async () => {
    await Promise.all([...open].map((w) => w.close()))
  })
  const make: NonNullable<WatchOptions['watchTicketsRoot']> = (path, ignored) => {
    const real = chokidarWatch(path, { ignoreInitial: true, ignored })
    const close = real.close.bind(real)
    real.close = () => {
      open.delete(real)
      return close()
    }
    open.add(real)
    made.push(real)
    return real
  }
  return { made, open, make }
}

// The rule is the chokidar path's; on Windows link-safe-watch.ts watches the Tickets root, and a
// folder chokidar watches there that is removed sends events without end (worfy-windows ticket 37).
describe.skipIf(process.platform === 'win32')('workflow watcher: a Tickets root that is not a folder (chokidar path)', () => {
  it('a Tickets root removed and made again 2 s later with another Epic: the model with it comes within 5 s, an edit of its Ticket is one more, and the looks stop once it is there', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const deltas: WorkflowDelta[] = []
    const looks: string[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas, { ticketsRootThere: countedLooks(looks) })
    expect(watcher.current.epics.map((e) => e.epic)).toEqual(['demo'])

    removeTestTree(scratch)
    expect(existsSync(scratch)).toBe(false)
    await nextDelta(deltas, (d) => d.removedTickets.length > 0)
    await pause(2000)
    putEpic(scratch, 'next', [1])
    await nextDelta(deltas, hasEpic('next'), 5000)
    await watcher.idle()

    // No more timed looks once the root is there again.
    const looksAfter = looks.length
    await pause(RETRY_MS * 5)
    expect(looks.length).toBe(looksAfter)

    setStatus(scratch, 'next', 1, 'blocked')
    const edited = await nextDelta(deltas, (d) => d.tickets.length > 0, 5000)
    expect(edited.delta.tickets.map((t) => [t.epic, t.num, t.state])).toEqual([['next', 1, 'blocked']])
  }, 20_000)

  it('a Tickets root removed and made again with another Epic before the watcher read (12 ms): an edit of its Ticket comes as a new model within 5 s', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const deltas: WorkflowDelta[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas)

    removeTestTree(scratch)
    expect(existsSync(scratch)).toBe(false)
    await pause(12)
    putEpic(scratch, 'next', [1])
    await nextDelta(deltas, hasEpic('next'), 5000)
    // idle waits for the watch made anew and its read too.
    await watcher.idle()

    setStatus(scratch, 'next', 1, 'blocked')
    const edited = await nextDelta(deltas, (d) => d.tickets.length > 0, 5000)
    expect(edited.delta.tickets.map((t) => [t.epic, t.num, t.state])).toEqual([['next', 1, 'blocked']])
  }, 20_000)

  // The case the 12 ms test above falls into on a loaded machine (it failed so twice in a full run
  // on 2026-10-21): the root is a folder again before chokidar looks at it after the removal
  // events, so chokidar reports the removal of what was in it but never of the root itself, and
  // its watch of the root stays on the removed folder. Measured with no pause before the watcher
  // compared the folder (`checkRootReplaced`): the read the removal events ask for showed the new
  // Epic, and the edit of its Ticket never came in 9 runs of 20 on an idle Mac.
  it('a Tickets root removed and made again at once, before chokidar looks at it: an edit of its Ticket comes as a new model within 5 s', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const deltas: WorkflowDelta[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas)

    removeTestTree(scratch)
    putEpic(scratch, 'next', [1])
    await nextDelta(deltas, hasEpic('next'), 5000)
    await watcher.idle()

    setStatus(scratch, 'next', 1, 'blocked')
    const edited = await nextDelta(deltas, (d) => d.tickets.length > 0, 5000)
    expect(edited.delta.tickets.map((t) => [t.epic, t.num, t.state])).toEqual([['next', 1, 'blocked']])
  }, 20_000)

  it('the same Tickets root removed and made again, the watch told only of what was in it (a stubbed watch): the read sees another folder and makes the watch anew', async () => {
    // The real race above, with the order fixed: chokidar's look at the root is replaced by a
    // watch that reports only what a test emits.
    const { repo, folder, scratch } = makeSilent(dir)
    const deltas: WorkflowDelta[] = []
    const made: string[] = []
    const watches: EventEmitter[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas, { watchTicketsRoot: deafWatch(made, 0, (watch) => watches.push(watch)) })
    await watcher.idle()

    // The same folder: a read leaves the watch alone.
    putEpic(scratch, 'more', [1])
    watches[0]!.emit('all', 'add', join(scratch, 'more', 'issues', '01-t.md'))
    await nextDelta(deltas, hasEpic('more'), 5000)
    await watcher.idle()
    expect(made).toEqual([scratch])

    removeTestTree(scratch)
    // Another folder at the path: its birth time differs even where the system gives the inode number again.
    await pause(20)
    putEpic(scratch, 'next', [1])
    // What chokidar reports when it looks too late: the removal of what was in the root, not of the root.
    watches[0]!.emit('all', 'unlink', join(scratch, 'more', 'issues', '01-t.md'))
    await nextDelta(deltas, hasEpic('next'), 5000)
    await until('the watch made anew', () => made.length === 2)
    expect(made).toEqual([scratch, scratch])
    await watcher.idle()
  }, 20_000)

  it('the removal of an Epic folder, not of the root, does not make the watch anew', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const deltas: WorkflowDelta[] = []
    const chokidar = countedChokidar()
    const { watcher } = await startSilent(repo, folder, scratch, deltas, { watchTicketsRoot: chokidar.make })
    expect(chokidar.made).toHaveLength(1)

    removeTestTree(join(scratch, 'demo'))
    expect(existsSync(join(scratch, 'demo'))).toBe(false)
    await nextDelta(deltas, (d) => d.removedEpics.includes('demo'), 5000)
    await watcher.idle()
    expect(chokidar.made).toHaveLength(1)
  }, 20_000)

  it('Silent layout, no Workflow folder at the start: made later with .scratch and an Epic, the model with the Epic comes within 5 s', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'none')
    const deltas: WorkflowDelta[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas)
    expect(watcher.current.epics).toEqual([])

    await pause(500)
    git(dir, 'init', '-q', '-b', 'main', folder)
    putEpic(scratch, 'demo', [1, 2])
    const added = await nextDelta(deltas, hasEpic('demo'), 5000)
    expect(added.delta.tickets.map((t) => [t.epic, t.num])).toEqual([
      ['demo', 1],
      ['demo', 2],
    ])
  }, 20_000)

  it('Silent layout, a Workflow folder with .git and no .scratch: an Epic put and committed comes as a model, then an edit of its Ticket as one more', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    const deltas: WorkflowDelta[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas)
    expect(watcher.current.epics).toEqual([])

    // What step 15 of the acceptance run does: the Epic is put, then committed in the Workflow folder.
    putEpic(scratch, 'e3-acceptance', [1])
    git(folder, 'add', '-A')
    git(folder, 'commit', '-qm', 'epic')
    await nextDelta(deltas, hasEpic('e3-acceptance'), 5000)
    await watcher.idle()

    setStatus(scratch, 'e3-acceptance', 1, 'blocked')
    const edited = await nextDelta(deltas, (d) => d.tickets.length > 0, 5000)
    expect(edited.delta.tickets.map((t) => [t.epic, t.num, t.state])).toEqual([['e3-acceptance', 1, 'blocked']])
  }, 20_000)

  it('a lost notification: the root appears and the watch never tells of it — the Epic is in the model within 5 s', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    const deltas: WorkflowDelta[] = []
    const made: string[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas, { watchTicketsRoot: deafWatch(made) })
    expect(made).toEqual([scratch])
    expect(watcher.current.epics).toEqual([])

    putEpic(scratch, 'demo', [1])
    await nextDelta(deltas, hasEpic('demo'), 5000)
    // The watch was made anew on the folder that is there now.
    expect(made).toEqual([scratch, scratch])
  }, 20_000)

  it('a root removed whose own removal event is lost (only an event about a file in it came): the read looks for it, and the Epic made again is read', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const deltas: WorkflowDelta[] = []
    const made: string[] = []
    const watches: EventEmitter[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas, { watchTicketsRoot: deafWatch(made, 0, (watch) => watches.push(watch)) })

    removeTestTree(scratch)
    expect(existsSync(scratch)).toBe(false)
    watches[0]!.emit('all', 'unlink', join(scratch, 'demo', 'issues', '01-first.md'))
    await nextDelta(deltas, (d) => d.removedEpics.includes('demo'), 5000)
    putEpic(scratch, 'next', [1])
    await nextDelta(deltas, hasEpic('next'), 5000)
    expect(made).toEqual([scratch, scratch])
    await watcher.idle()
  }, 20_000)

  it('a file where the Tickets root should be is not a folder: replaced by a folder with an Epic, the Epic is read', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    writeFileSync(scratch, 'not a folder')
    const deltas: WorkflowDelta[] = []
    const made: string[] = []
    const { watcher } = await startSilent(repo, folder, scratch, deltas, { watchTicketsRoot: deafWatch(made) })
    expect(watcher.current.epics).toEqual([])

    rmSync(scratch)
    putEpic(scratch, 'demo', [1])
    await nextDelta(deltas, hasEpic('demo'), 5000)
  }, 20_000)

  it('the start does not hang when the first watch is made anew before it is ready (the root removed during its first scan)', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const made: string[] = []
    // Each watch says 'ready' after 300 ms; the first one tells of the removal of the root at 50 ms.
    const watchTicketsRoot = deafWatch(made, 300, (watch) => {
      if (made.length === 1) setTimeout(() => watch.emit('unlinkDir', scratch), 50)
    })
    const started = startSilent(repo, folder, scratch, [], { watchTicketsRoot })
    const outcome = await Promise.race([started.then(() => 'started'), pause(3000).then(() => 'still waiting after 3 s')])
    expect(outcome).toBe('started')
    expect(made).toEqual([scratch, scratch])
  }, 10_000)

  it('while the Tickets root is a folder, there are no timed looks for it and no reads beyond the start', async () => {
    const { repo, folder, scratch } = makeSilent(dir)
    const looks: string[] = []
    const { watcher, log } = await startSilent(repo, folder, scratch, [], { ticketsRootThere: countedLooks(looks) })
    await watcher.idle()
    const [looksAtStart, readsAtStart] = [looks.length, calls(log).length]

    await pause(RETRY_MS * 8)
    await watcher.idle()
    expect(looks.length).toBe(looksAtStart)
    expect(calls(log).length).toBe(readsAtStart)
  })

  it('after the watch is made anew, one edit of a Ticket gives one read, not two, and only the new watch is open', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    const deltas: WorkflowDelta[] = []
    const chokidar = countedChokidar()
    const { watcher, log } = await startSilent(repo, folder, scratch, deltas, { watchTicketsRoot: chokidar.make })

    putEpic(scratch, 'demo', [1])
    await nextDelta(deltas, hasEpic('demo'), 5000)
    // The look finds the root and makes the watch anew; idle then waits for that and its read.
    await until('the watch made anew', () => chokidar.made.length === 2)
    await watcher.idle()
    expect([...chokidar.open]).toEqual([chokidar.made[1]])
    const before = calls(log).length

    setStatus(scratch, 'demo', 1, 'blocked')
    await nextDelta(deltas, (d) => d.tickets.length > 0, 5000)
    // Time for a second read, if one were coming.
    await pause(700)
    await watcher.idle()
    expect(calls(log).length).toBe(before + 1)
  }, 20_000)

  it('close drops the timer of the looks for the root', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    const looks: string[] = []
    const { watcher } = await startSilent(repo, folder, scratch, [], { ticketsRootThere: countedLooks(looks) })
    await until('three looks', () => looks.length >= 3)

    await watcher.close()
    const atClose = looks.length
    await pause(RETRY_MS * 5)
    expect(looks.length).toBe(atClose)
  })

  it('a look that fails other than "not there" (no access) is logged once; the looks go on', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cleanups.push(async () => warn.mockRestore())
    let looks = 0
    const { watcher } = await startSilent(repo, folder, scratch, [], {
      ticketsRootThere: () => {
        looks += 1
        return Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
      },
    })
    await until('four looks', () => looks >= 4)
    await watcher.close()
    expect(warn.mock.calls.filter(([line]) => String(line).includes('cannot look at the Tickets root'))).toHaveLength(1)
  })
})

describe('workflow watcher: the links-read-first path (Windows)', () => {
  it('does not look for a Tickets root that is not there', async () => {
    const { repo, folder, scratch } = makeSilentWithout(dir, 'git')
    const looks: string[] = []
    const { watcher } = await startSilent(repo, folder, scratch, [], { ticketsWatch: 'links-read-first', ticketsRootThere: countedLooks(looks) })
    await pause(RETRY_MS * 5)
    await watcher.close()
    expect(looks).toEqual([])
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
  it('parses the answer, reads the files section of each Ticket and diffs 682 Tickets in ≤ 300 ms of its own time (450 ms on Windows)', async () => {
    const repo = join(dir, 'big')
    const { json, ticketCount } = generateScratch(repo)
    expect(ticketCount).toBe(682)
    expect(json.epics).toHaveLength(42)
    const home = join(dir, 'big-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    canned(join(home, 'bin', 'epic-status'), { out: JSON.stringify(json), code: 0 })

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
    // Windows on the PC, 2026-10-19, links checked once per folder in a read: best 224–330 ms (samples 224–432, CPU 75–95 % busy); 424–570 ms without that.
    expect(best).toBeLessThanOrEqual(process.platform === 'win32' ? 450 : 300)
  })
})

// On Windows each Ticket file and folder is checked for a link to a share before it is read
// (src/main/remote-links.ts). The paths share their folders, and each folder is looked at once
// per read. The path rules are path.win32 and the file system is replaced, so this runs anywhere.
describe('workflow reader and the links on the way to the Tickets (Windows rules)', () => {
  const ROOT = 'C:\\p\\repo'
  const SCRATCH = 'C:\\p\\repo\\.scratch'
  const ISSUES = 'C:\\p\\repo\\.scratch\\alpha\\issues'
  const ticket = (num: number, slug: string): EpicStatusSnapshot['tickets'][number] => ({
    epic: 'alpha',
    num,
    slug,
    title: slug,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
  })
  const SNAPSHOT: EpicStatusSnapshot = {
    ref: 'HEAD',
    epics: [{ epic: 'alpha', hasSpec: true, hasMap: false }],
    tickets: [ticket(1, 'first'), ticket(2, 'second'), ticket(3, 'third')],
  }
  const NAMES = ['01-first.md', '02-second.md', '03-third.md']
  const ticketText = (file: string): string => ['# Ticket', '', '## Где в коде', '', '- `' + file + '`', ''].join('\n')

  /** The Tickets of one Epic; `linked` maps a link to its target and may change between reads. */
  function system() {
    const lstat: string[] = []
    const readText: string[] = []
    const linked = new Map<string, string>()
    const texts = new Map([[`${SCRATCH}\\alpha\\spec.md`, '# Alpha epic\n'], ...NAMES.map((name, index): [string, string] => [`${ISSUES}\\${name}`, ticketText(`src/${index}.ts`)])])
    const options = {
      paths: win32,
      fs: {
        readText: async (path: string): Promise<string | null> => (readText.push(path), texts.get(path) ?? null),
        readdir: async (dir: string): Promise<string[]> => (dir === ISSUES ? NAMES : []),
      },
      links: {
        isLink: async (path: string): Promise<boolean | null> => (lstat.push(path), linked.has(path)),
        readlink: async (path: string): Promise<string> => linked.get(path)!,
      },
    }
    return { lstat, readText, linked, options }
  }

  it('looks at each folder on the way to the Tickets once in a read, however many Tickets lie under it', async () => {
    const fake = system()
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, fake.options)
    expect(model.tickets.map((each) => each.files)).toEqual([['src/0.ts'], ['src/1.ts'], ['src/2.ts']])
    expect(model.epics.map((epic) => epic.title)).toEqual(['Alpha epic'])
    // The spec, the folder of the issues and three Tickets: five walks over the same folders.
    expect(fake.lstat.filter((path) => path === ISSUES)).toHaveLength(1)
    expect(fake.lstat.filter((path) => path === SCRATCH)).toHaveLength(1)
    expect(new Set(fake.lstat).size).toBe(fake.lstat.length)
  })

  it('sees a link to a share put in place between two reads: the second read does not read that Ticket', async () => {
    const fake = system()
    const first = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, fake.options)
    expect(first.tickets.map((each) => each.filesListed)).toEqual([true, true, true])

    fake.linked.set(`${ISSUES}\\01-first.md`, '\\\\evil\\share\\01-first.md')
    fake.readText.length = 0
    fake.lstat.length = 0
    const second = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, fake.options)
    expect(second.tickets.map((each) => [each.files, each.filesListed])).toEqual([
      [[], false],
      [['src/1.ts'], true],
      [['src/2.ts'], true],
    ])
    expect(fake.readText).not.toContain(`${ISSUES}\\01-first.md`)
    // The second read looked at the folders again, not at answers kept from the first.
    expect(fake.lstat).toContain(ISSUES)
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
