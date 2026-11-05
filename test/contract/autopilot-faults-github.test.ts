// The faults on the GitHub side of an Autopilot Run (worfy-faults ticket 04; the scenarios table of
// its spec): gh that hangs, gh that answers 5xx, and a merge conflict. Each scenario runs on faultRun()
// (autopilot-faults-setup.ts) — the real Autopilot over the fake agent and a temporary git Project —
// with the run's own PrTracker over the gh stand-in (test/fixtures/gh/gh-stub.mjs): one gh call may
// take ms(500), and the tracker's clock is the test's. Each ends with checkRecovery
// (test/autopilot-invariants.ts); its I2 holds the gh side: every call in the stand-in's log is a read.
//
// worfy does no merge (ADR-0002): the Orchestrator sees the conflict, and worfy sees only the Ticket
// it blocked. The run reads the PRs in the background and never waits on gh but for its last read,
// END_READ_MS at most (src/main/autopilot/run.ts, the paragraph on the narrow fix round).
import { spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIELDS } from '../../src/main/github/prs'
import { checkRecovery } from '../autopilot-invariants'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
import { AGENT_SCRIPTS, faultRun, until, type FaultRun, type FaultScript } from './autopilot-faults-setup'
import { ghWorld } from './gh-world'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const STUB = join(import.meta.dirname, '..', 'fixtures', 'gh', 'gh-stub.mjs')

/** How long one gh call of the run may take (ghRunner's timeoutMs). */
const GH_TIMEOUT_MS = ms(500)
/** The limit of the run's last read of the PRs before run-stopped, on the test's clock. */
const END_READ_MS = 5_000
/** How often the run reads the PRs, on the test's clock: longer than END_READ_MS, so moving the clock by it fires no read. */
const EVERY_MS = 60_000
/** The PR tracker's base interval, on the test's clock: after a failed read it waits twice that. */
const BASE_MS = 1_000

/** What the default Run wave template sends for Wave 1 of the Epic (ADR-0033); its Russian words are the template's. */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'

/** The verdict of a narrow fix round as the /epic-wave skill comments it on the PR of Ticket 02 (ADR-0046). */
const NARROW = 'NARROW: REJECTED: src/f2.ts:1 still open'

/** The PRs of Tickets 01 and 02 in `gh pr list --json` shape; 02 has the narrow round's verdict, with no time, so any run takes it. */
const PULLS = [
  { number: 12, headRefName: 'demo/02', state: 'OPEN', url: 'https://github.com/o/r/pull/12', statusCheckRollup: [], comments: [{ body: NARROW }] },
  { number: 11, headRefName: 'demo/01', state: 'OPEN', url: 'https://github.com/o/r/pull/11', statusCheckRollup: [], comments: [] },
]

/** The one read the tracker runs: the whole list (src/main/github/prs.ts). */
const PR_LIST = ['pr', 'list', '--state', 'all', '--limit', '100', '--json', FIELDS]

/** The lines of the Wave's command in what the Orchestrator got: `/epic-wave …` or `/worfy:epic-wave …`. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/** A fixture of test/fixtures/agent-scripts whose turn waits for the test's release `turn` after its init. */
function held(name: string): FaultScript {
  const lines = readFileSync(join(AGENT_SCRIPTS, `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const init = lines.findIndex((line) => line.type === 'system')
  return [...lines.slice(0, init + 1), { fake: 'wait_release', name: 'turn' }, ...lines.slice(init + 1)]
}

// ── the hung gh calls ────────────────────────────────────────────────────────

/** The GH_STUB_DIR of every gh world with a `hang` file: the afterEach kills what still runs of them. */
const hangDirs: string[] = []

/** The process ids of the hung calls of the stand-in in `dir` so far (hang.pids). */
function hungPids(dir: string): number[] {
  try {
    return readFileSync(join(dir, 'hang.pids'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map(Number)
  } catch {
    return []
  }
}

/** Whether the process still runs: signal 0 checks without killing; EPERM means it runs as someone else. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Registered after autopilot-faults-setup's, so it runs first (vitest runs afterEach hooks in reverse):
// the stand-in's folder is still there to read.
afterEach(() => {
  for (const dir of hangDirs.splice(0)) {
    for (const pid of hungPids(dir).filter(alive)) process.kill(pid, 'SIGKILL')
  }
})

/** Puts gh of the run's world into the hang mode: every call waits `wait` (default 60 s) and fails. */
function hang(h: FaultRun, wait = ''): void {
  writeFileSync(join(h.gh!.dir, 'hang'), wait)
  hangDirs.push(h.gh!.dir)
}

/** Runs the stand-in once with `GH_STUB_DIR` = `dir`: its exit code, stderr and how long it took (real ms). */
function runStub(dir: string, args: readonly string[]): Promise<{ code: number | null; stderr: string; tookMs: number }> {
  const started = Date.now()
  const child = spawn(scriptNode(), [STUB, ...args], { cwd: dir, env: { ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_STUB_DIR: dir, GH_STUB_LOG: join(dir, 'calls.jsonl') }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  return new Promise((done, fail) => {
    child.once('error', fail)
    child.once('close', (code) => done({ code, stderr, tookMs: Date.now() - started }))
  })
}

describe('the gh stand-in in the hang mode (worfy-faults ticket 04)', () => {
  it('with a hang file waits as long as it says, then exits 1; without it answers at once as before', async () => {
    const h = faultRun({ prs: { pulls: PULLS } })
    const dir = h.gh!.dir
    const before = await runStub(dir, ['pr', 'list'])
    expect(before).toMatchObject({ code: 0, stderr: '' })

    const wait = 400
    hang(h, String(wait))
    const hung = await runStub(dir, ['pr', 'list'])
    expect(hung.code).toBe(1)
    expect(hung.stderr).toBe(`gh stub: hung for ${wait} ms\n`)
    expect(hung.tookMs).toBeGreaterThanOrEqual(wait)
    expect(hungPids(dir)).toHaveLength(1)
    // `fail` still comes first: a 502 answers at once, without the wait.
    writeFileSync(join(dir, 'fail'), 'HTTP 502: Bad Gateway (https://api.github.com/graphql)')
    expect(await runStub(dir, ['pr', 'list'])).toMatchObject({ code: 1, stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n' })
    expect(hungPids(dir)).toHaveLength(1)

    // The file gone, the stand-in answers as it did; every call is in its log.
    rmSync(join(dir, 'fail'))
    rmSync(join(dir, 'hang'))
    expect(await runStub(dir, ['pr', 'list'])).toMatchObject({ code: 0, stderr: '' })
    expect(h.gh!.calls()).toEqual([['pr', 'list'], ['pr', 'list'], ['pr', 'list'], ['pr', 'list']])
  })

  it('gh-world runs it as before: no hang file, no hang.pids', async () => {
    const world = ghWorld(join(faultRun({ prs: false }).scratch, 'gh'), { accounts: [] })
    writeFileSync(join(world.dir, 'prs.json'), JSON.stringify(PULLS))
    expect(JSON.parse(await world.run(['pr', 'list', '--limit', '1'], world.dir))).toEqual([PULLS[0]])
    expect(hungPids(world.dir)).toEqual([])
  })
})

describe('Autopilot faults on the GitHub side (worfy-faults ticket 04)', () => {
  it('gh hangs the whole Run: the Waves go on, no narrow-round, the stop waits END_READ_MS at most, and no hung gh is left', async () => {
    // Wave 2's turn waits for the test, so the run's last read of the PRs starts after the first gh call has died.
    const h = faultRun({ scripts: ['autopilot-waves', held('autopilot-waves')], prs: { pulls: PULLS, timeoutMs: GH_TIMEOUT_MS, baseIntervalMs: BASE_MS, everyMs: EVERY_MS, endReadMs: END_READ_MS } })
    hang(h)
    expect(await h.start()).toEqual({ refusal: null })

    // Wave 1 is done and Wave 2 started while the read of Wave 1 hangs: the run does not wait for it.
    // That read is the only gh call before the release: the read of Wave 2 joins it or finds its interval not passed.
    await until(() => h.kinds(1).filter((kind) => kind === 'wave-started').length === 2, 'Wave 2 to start')
    // ghRunner's timeout ends the hung call: no stand-in outlives it.
    await until(() => h.gh!.calls().length === 1 && hungPids(h.gh!.dir).length === 1 && !alive(hungPids(h.gh!.dir)[0]!), 'the hung gh call of Wave 1 to end by the timeout')
    expect(h.gh!.calls()).toEqual([PR_LIST])

    // The doubled interval passes on the test's clock (no other timer is due by then), Wave 2's turn
    // ends, nothing is ready, and the run's last read of the PRs hangs on a new call. Its limit is then
    // the only timer of END_READ_MS: the read of the Tickets set the other one in the same step and has answered.
    h.clock.advance(2 * BASE_MS)
    h.releases.release('turn')
    await until(() => h.clock.pending().filter((timer) => timer.ms === END_READ_MS).length === 1 && hungPids(h.gh!.dir).length === 2, 'the last read of the PRs')
    expect(h.kinds(1)).not.toContain('run-stopped')
    const last = hungPids(h.gh!.dir)[1]!
    h.clock.advance(END_READ_MS)
    await h.stopped(1)
    // The run stopped at END_READ_MS on its clock while that gh call still hung: it waited no longer.
    // (The call lives GH_TIMEOUT_MS of real time, many times what the stop takes after the move.)
    expect(alive(last)).toBe(true)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'no-ready-wave', wave: 2 })
    expect(h.kinds(1)).not.toContain('narrow-round')

    await until(() => hungPids(h.gh!.dir).every((pid) => !alive(pid)), 'the last hung gh call to end by the timeout')
    // I2: the log holds only `pr list`.
    expect(h.gh!.calls().every((args) => args[0] === 'pr' && args[1] === 'list')).toBe(true)
    expect(checkRecovery(h.recovery({ stop: 'no-ready-wave', waves: 2 }))).toEqual([])
  })

  it('gh answers 502, then recovers: the next gh call comes after the doubled interval, and narrow-round is journaled once', async () => {
    // Both Waves' turns wait for the test, so the run is still in Wave 1 while gh fails and recovers.
    const h = faultRun({ scripts: [held('autopilot-waves')], prs: { pulls: PULLS, timeoutMs: GH_TIMEOUT_MS, baseIntervalMs: BASE_MS, maxIntervalMs: 8 * BASE_MS, everyMs: BASE_MS, endReadMs: END_READ_MS } })
    const error = 'HTTP 502: Bad Gateway (https://api.github.com/graphql)'
    writeFileSync(join(h.gh!.dir, 'fail'), error)
    expect(await h.start()).toEqual({ refusal: null })

    // The read at wave-started fails; the tracker doubles its interval. A read of the test's own now
    // joins the run's while it runs, and starts no gh after it (the interval has not passed).
    await until(() => h.kinds(1).includes('wave-started') && h.gh!.calls().length === 1, 'the first read of the PRs')
    expect((await h.prs!.read(h.repo, [])).gh).toEqual({ available: false, error, intervalMs: 2 * BASE_MS })
    expect(h.gh!.calls()).toEqual([PR_LIST])

    // GitHub answers again. One base interval later the run reads, and the tracker runs no gh.
    rmSync(join(h.gh!.dir, 'fail'))
    h.clock.advance(BASE_MS)
    expect((await h.prs!.read(h.repo, [])).gh).toEqual({ available: false, error, intervalMs: 2 * BASE_MS })
    expect(h.gh!.calls()).toEqual([PR_LIST])
    expect(h.kinds(1)).not.toContain('narrow-round')

    // At the doubled interval the run's read starts gh, which answers: the narrow round of 02 goes to the journal.
    h.clock.advance(BASE_MS)
    await until(() => h.kinds(1).includes('narrow-round'), 'narrow-round after gh recovered')
    expect(h.gh!.calls()).toEqual([PR_LIST, PR_LIST])

    // Both Waves end; the reads of Wave 2 and the last one see the same comment and journal it no more.
    h.releases.release('turn')
    h.releases.release('turn')
    await h.stopped(1)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'no-ready-wave', wave: 2 })
    expect(h.journal(1).filter((event) => event.kind === 'narrow-round')).toMatchObject([{ ticket: '02', outcome: 'rejected', text: NARROW }])
    expect(h.gh!.calls().every((args) => args[0] === 'pr' && args[1] === 'list')).toBe(true)
    expect(checkRecovery(h.recovery({ stop: 'no-ready-wave', waves: 2 }))).toEqual([])
  })

  it('a merge conflict: the Orchestrator reports it and blocks 02, the Run stops with blocked-tickets, and a new Run does not take 02', async () => {
    // The agent marks nothing: the test writes the Tickets as the Orchestrator's `ticket` would, while the turn waits.
    const h = faultRun({ scripts: ['autopilot-fault-conflict'], marks: 'none', prs: { pulls: PULLS, timeoutMs: GH_TIMEOUT_MS } })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => waveCommands(h).length === 1, 'the command of Wave 1')
    h.setStatus(1, 'done 2026-11-05T10:00Z')
    // `ticket block` writes the reason on its own line under Status:.
    h.setStatus(2, 'blocked 2026-11-05T10:01Z\nBlocked reason: merge conflict in src/f2.ts')
    h.releases.release('turn')
    await h.stopped(1)

    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'blocked-tickets', wave: 1 })
    const first = h.journal(1)
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'blocked-tickets', tickets: ['02'], lastText: expect.stringContaining('merge conflict in src/f2.ts') as unknown })
    expect(first.filter((event) => event.kind === 'ticket-status' && event.ticket === '02')).toMatchObject([{ state: 'blocked' }])

    // The new Run finds nothing ready: 02 is blocked and 03 waits for it. No Wave, no message.
    expect(await h.startAgain()).toEqual({ refusal: null })
    await h.stopped(2)
    expect(h.kinds(2)).toEqual(['run-started', 'run-stopped'])
    expect(h.journal(2).at(-1)).toMatchObject({ reason: 'blocked-tickets', tickets: ['02'] })
    expect(waveCommands(h)).toEqual([WAVE_1])

    // worfy only read GitHub: the merge is the Orchestrator's.
    expect(h.gh!.calls().length).toBeGreaterThan(0)
    expect(h.gh!.calls().every((args) => args[0] === 'pr' && args[1] === 'list')).toBe(true)
    expect(checkRecovery(h.recovery({ stop: 'blocked-tickets', waves: 1 }))).toEqual([])
  })
})
