// The faults of an Autopilot Run whose Orchestrator runs on Codex (worfy-faults ticket 06; the
// scenarios table of its spec, the rows of a failed Codex turn and a dead app-server). Each scenario
// runs on faultRun({ vendor: 'codex' }) (autopilot-faults-setup.ts): the real Autopilot over the fake
// Codex app-server (WORFY_CODEX=fake, a CODEX_HOME of the test; the real Codex never starts) and a
// temporary git Project, and ends with checkRecovery (test/autopilot-invariants.ts).
//
// The fake app-servers start in this order: 1 the attended Orchestrator (`turn`), 2 the Run's
// unattended Session, which plays the fault, 3 the Orchestrator given back attended on the Wave's
// thread (`resume`), 4 the new Run's Session, which resumes that thread too (`resume`: its turn/start
// carries the Wave's command), 5 the Orchestrator given back again after the Force stop (`resume`).
//
// - A failed turn (autopilot-fault-turn-failed.jsonl): turn/completed with status `failed` and a 500
//   of the model's API. Expected as the API 500 of ticket 02: turn-error, the error's text in
//   session-error, and a new start sends Wave 1 again, once.
// - A dead app-server (autopilot-fault-exit.jsonl): the fake exits with code 1 in the middle of the
//   Wave's turn (its `exit` step). Expected as the death of the Claude Code of the Orchestrator:
//   session-error, run-stopped, and a new Run starts in a new Session.
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { checkRecovery } from '../autopilot-invariants'
import { EPIC, faultRun, PROJECT, until, type FaultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

// Every fake app-server process the test starts, to see that none outlives the test: faultRun keeps its
// own list for the afterEach, which kills whatever is left, so the test looks before that.
const fakes = vi.hoisted(() => [] as ChildProcess[])
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const spawn = (...args: Parameters<typeof actual.spawn>): ChildProcess => {
    const child = (actual.spawn as (...each: unknown[]) => ChildProcess)(...args)
    if (Array.isArray(args[1]) && args[1].some((arg) => String(arg).endsWith('fake-app-server.mjs'))) fakes.push(child)
    return child
  }
  return { ...actual, spawn }
})

/** The lines of the Wave's command in what the Orchestrator got: `/epic-wave …` or `/worfy:epic-wave …`. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/** What the default Run wave template sends for Wave 1 of the Epic (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'

/** The thread of the Wave in the fault scripts: the Run's Session starts it, the give-back and the new Run resume it. */
const WAVE_THREAD = 'thr_fake_wave'

/**
 * A Run on Codex whose Wave turn plays the fault `script`: it stops with `reason`, the error's text in
 * one session-error. The agent marks no Ticket, so the new start sends Wave 1 again, once, on the
 * Wave's thread; a Force stop then ends the new Run. Every fake app-server has exited by the end.
 */
async function codexFault(script: string, reason: string, errorText: RegExp): Promise<FaultRun> {
  fakes.splice(0)
  const h = faultRun({ vendor: 'codex', marks: 'none', codexScripts: ['turn', script, 'resume'] })
  expect(await h.start()).toEqual({ refusal: null })
  await h.stopped(1)
  expect(h.state()).toMatchObject({ status: 'stopped', reason, wave: 1 })
  const first = h.journal(1)
  expect(first[0]).toMatchObject({ kind: 'run-started', vendor: 'codex' })
  expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason })
  const errors = first.filter((event) => event.kind === 'session-error')
  expect(errors).toMatchObject([{ session: WAVE_THREAD }])
  expect(errors.map((event) => (event.kind === 'session-error' ? event.message : ''))).toEqual([expect.stringMatching(errorText)])
  expect(waveCommands(h)).toEqual([WAVE_1])

  // A new start goes through and sends Wave 1 once more, to the Wave's thread, in a new process.
  expect(await h.startAgain()).toEqual({ refusal: null })
  await until(() => waveCommands(h).length >= 2 && h.kinds(2).includes('wave-started'), 'the Wave of the new Run', 10_000)
  expect(h.journal(2)[0]).toMatchObject({ kind: 'run-started', epic: EPIC, vendor: 'codex' })
  expect(h.journal(2).filter((event) => event.kind === 'wave-started')).toMatchObject([{ wave: 1, tickets: ['01', '02'], session: WAVE_THREAD }])
  await h.autopilot.forceStop(PROJECT)
  expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1])
  expect(h.codexLogs).toHaveLength(5)

  // The runs read the PRs through gh (I2 has calls to check), and only read them.
  expect(h.gh!.calls().length).toBeGreaterThan(0)
  expect(checkRecovery(h.recovery({ stop: reason, errorText, waves: 2 }))).toEqual([])

  // No fake app-server outlives the Sessions: closing them ends every process, the dead one included.
  // The give-back after the Force stop starts its process on its own time: the test waits for it first.
  await until(() => fakes.length === 5, 'the process of the give-back')
  await h.registry.closeAll()
  await until(() => fakes.every((child) => hasExited(child)), 'every fake app-server to exit')
  return h
}

describe('Autopilot faults on a Codex Orchestrator (worfy-faults ticket 06)', () => {
  it('a failed turn: the Run stops with turn-error and the error text, recovers by the rules, and a new start sends the Wave once', async () => {
    await codexFault('autopilot-fault-turn-failed', 'turn-error', /^unexpected status 500 Internal Server Error: .*\nRequest id req_fake_500\.$/u)
  })

  it('the app-server dies in the middle of the Wave: session-error, run-stopped, and a new Run starts in a new Session', async () => {
    await codexFault('autopilot-fault-exit', 'session-error', /^Codex app-server exited with code 1\b/u)
    // The Run's process ended by itself, with the code of the script's exit step, before anything closed it.
    expect(fakes[1]?.exitCode).toBe(1)
  })
})
