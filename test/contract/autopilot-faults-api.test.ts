// The faults of the model's API during an Autopilot Run (worfy-faults ticket 02; the scenarios table of its spec):
// a 500, a 529 in the middle of the streamed answer, a dropped connection and the Limits in the
// turn of Wave 2. Each scenario runs on faultRun() (autopilot-faults-setup.ts) — the real
// Autopilot over the fake agent and a temporary git Project — and ends with checkRecovery
// (test/autopilot-invariants.ts): the Run names its end, the Wave's command went once, nothing
// was written to the Project or to GitHub, and a new start of the same Session goes through.
// The faulty turn is the first one of the Wave in autopilot-background.jsonl with its `result`
// replaced (the two implementers it started still run when the error comes, as in worfy-polish 50).
import { describe, expect, it, vi } from 'vitest'
import { CONTINUE_TEXT } from '../../src/main/autopilot/limits-wait'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { checkRecovery } from '../autopilot-invariants'
import { EPIC, faultRun, LIMITS_RESET_MS, PROJECT, until, type FaultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

/** The lines of the Wave's command in what the Orchestrator got: `/epic-wave …` or `/worfy:epic-wave …`. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/** What the default Run wave template sends for Wave 1 of the Epic (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'

/**
 * A Run whose Wave turn ends with the API error of `script` while the two implementers it started
 * still run: it stops with turn-error, the error's text in session-error, and gives the Orchestrator
 * back to a person as it runs, the implementers living on in that Session (worfy-autopilot-queue
 * ticket 08). The agent marks no Ticket, so the new start — which waits for that busy Orchestrator
 * (ADR-0099) until the implementers have reported and the turn of the last one's task-notification has ended — sends
 * Wave 1 again, as a Wave of its own, once: that turn has run, so no grace time is waited (worfy-polish ticket 65).
 * A Force stop then ends the new Run.
 */
async function apiFault(script: string, errorText: RegExp): Promise<FaultRun> {
  const h = faultRun({ scripts: [script, 'autopilot-waves'], marks: 'none', processes: 'exit-at-once' })
  expect(await h.start()).toEqual({ refusal: null })
  await h.stopped(1)
  expect(h.state()).toMatchObject({ status: 'stopped', reason: 'turn-error', wave: 1 })
  const first = h.journal(1)
  expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'turn-error' })
  const errors = first.flatMap((event) => (event.kind === 'session-error' ? [event.message] : []))
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatch(errorText)
  // The implementers still run, in the person's Session now: nothing was killed (ADR-0029, Amendments).
  expect(first.at(-1)).toMatchObject({ kind: 'orchestrator-returned', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
  expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)

  // A new start waits for that Orchestrator; once the implementers have reported and their last turn has ended, it goes through.
  expect(await h.startAgain()).toEqual({ refusal: null })
  expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
  h.releases.release('tasks')
  h.releases.release('tasks')
  await until(() => waveCommands(h).length >= 2 && h.kinds(2).includes('wave-started'), 'the Wave of the new Run')
  expect(h.journal(2)[0]).toMatchObject({ kind: 'run-started', epic: EPIC })
  expect(h.journal(2).filter((event) => event.kind === 'wave-started')).toMatchObject([{ wave: 1, tickets: ['01', '02'] }])
  await h.autopilot.forceStop(PROJECT)
  expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1])
  // The new Run took the Orchestrator only once the person's Session was free: its own process, nothing killed.
  expect(h.queries().filter((query) => query.unattended)).toHaveLength(2)
  expect(h.kinds(1)).not.toContain('tasks-killed')

  // The runs read the PRs through gh (I2 has calls to check), and only read them.
  expect(h.gh!.calls().length).toBeGreaterThan(0)
  expect(checkRecovery(h.recovery({ stop: 'turn-error', errorText, waves: 2 }))).toEqual([])
  return h
}

describe('Autopilot faults of the model API (worfy-faults ticket 02)', () => {
  it('API 500: the Run stops with turn-error and the error text, recovers by the rules, and a new start sends the Wave once', async () => {
    const h = await apiFault('autopilot-fault-api-500', /^API Error: 500 .*"api_error"/u)
    // A process stub stood behind each Claude Code query: after the Force stop only the attended
    // Orchestrator's lives, and the afterEach kills it.
    expect(h.processes!.alive()).toBe(1)
  })

  it('529 in the middle of the streamed answer: the same, and it is not taken for the Limits', async () => {
    const h = await apiFault('autopilot-fault-overloaded', /^API Error: 529 .*"overloaded_error"/u)
    for (const n of [1, 2]) expect(h.kinds(n)).not.toContain('limits-hit')
    expect(h.kinds(1)).not.toContain('waiting-until')
  })

  it('a dropped connection: the same', async () => {
    await apiFault('autopilot-fault-connection', /^API Error: Connection error\.$/u)
  })

  it('the Limits refuse the turn of Wave 2: the Run waits, resumes at the reset with one continuation, and Wave 1 never goes again', async () => {
    // Wave 1 goes through; Wave 2 starts a new SDK session, whose first turn the Limits refuse.
    const h = faultRun({ scripts: ['autopilot-waves', 'autopilot-limits'] })
    expect(await h.start()).toEqual({ refusal: null })
    // A run that does not wait ends: the assertion below says so at once, with no time-out.
    await until(() => h.state().status === 'waiting' || h.state().status === 'stopped', 'the wait for the Limits')
    expect(h.state()).toMatchObject({ status: 'waiting', wave: 2 })
    const resumesAt = LIMITS_RESET_MS + RESUME_MARGIN_MS
    expect(h.clock.pending().map((timer) => timer.at)).toContain(resumesAt)
    expect(waveCommands(h)).toHaveLength(2)

    // The reset comes on the test's clock: the Run resumes and the continuation's turn ends Wave 2.
    h.clock.advanceTo(resumesAt)
    await h.stopped(1)
    const kinds = h.kinds(1)
    expect(kinds.filter((kind) => kind === 'limits-hit' || kind === 'waiting-until' || kind === 'resumed')).toEqual(['limits-hit', 'waiting-until', 'resumed'])
    expect(kinds.indexOf('limits-hit')).toBeGreaterThan(kinds.indexOf('wave-finished'))
    expect(h.messages().filter((text) => text.startsWith(CONTINUE_TEXT))).toHaveLength(1)
    expect(waveCommands(h)).toEqual([WAVE_1, '/epic-wave Ticket-ы 03 эпика demo'])
    // Every Ticket is done after Wave 2: nothing is left to run.
    expect(h.journal(1).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-ready-wave' })

    expect(checkRecovery(h.recovery({ stop: 'no-ready-wave', waves: 2, resumed: true }))).toEqual([])
  })

  it("faultRun({ vendor: 'codex' }) runs the Wave on the fake Codex Orchestrator (the field ticket 06 needs)", async () => {
    // The fake app-servers in start order: the attended Orchestrator, the run's unattended Session.
    const h = faultRun({ vendor: 'codex', codexScripts: ['turn', 'autopilot-wave', 'resume'] })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.kinds(1).includes('wave-finished'), 'Wave 1 on Codex to finish', 10_000)
    expect(h.journal(1)[0]).toMatchObject({ kind: 'run-started', vendor: 'codex' })
    expect(h.journal(1).find((event) => event.kind === 'wave-started')).toMatchObject({ wave: 1, tickets: ['01', '02'] })
    await h.autopilot.forceStop(PROJECT)
    // The command went to the Codex thread through turn/start, once.
    expect(waveCommands(h)).toEqual([WAVE_1])
    expect(h.codexLogs.length).toBeGreaterThanOrEqual(2)
  })
})
