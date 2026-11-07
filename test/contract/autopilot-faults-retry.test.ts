// The faults of the model's API during an Autopilot Run with Auto-continue on (worfy-retry ticket 09;
// .scratch/worfy-retry/spec.md, the worfy-faults compatibility section): the same 500, 529 in the middle of the
// streamed answer and dropped connection as worfy-faults ticket 02 (autopilot-faults-api.test.ts), now
// survived — `turn-retry`, a continuation on the test's clock, `resumed` — and the two ways the run
// still gives up: five errors in a row (`retry-refused` `cap`) and an external action without its
// result (`retry-refused` `in-flight`). And the Limits of the owner's plan, the 7-day window with no
// `five_hour`, refusing the turn of Wave 2. Each scenario runs on faultRun({ autoContinue: true })
// and ends with checkRecovery (test/autopilot-invariants.ts): its rules I1–I8 hold with the switch on.
//
// The faulty turn of autopilot-fault-retry-*.jsonl is the one of worfy-faults 02 — two implementers
// started in the background, then the error — followed by the continuation's turn; the implementers
// then report as in autopilot-background.jsonl.
import { describe, expect, it, vi } from 'vitest'
import { CONTINUE_TEXT } from '../../src/main/autopilot/limits-wait'
import { MAX_RETRIES, RETRY_DELAYS_MS } from '../../src/shared/agent/continue-plan'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { checkRecovery } from '../autopilot-invariants'
import { faultRun, START_MS, until, type FaultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

/** What the default Run wave template sends for each Wave of the Epic (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
const WAVE_2 = '/epic-wave Ticket-ы 03 эпика demo'
/** The reset of the refused 7-day window in autopilot-limits-weekly.jsonl: 2026-10-08T07:10:00Z, 3 days after the start. */
const WEEKLY_RESET_MS = 1791443400 * 1000

type TurnRetry = Extract<JournalEvent, { kind: 'turn-retry' }>

/** The lines of the Wave's command in what the Orchestrator got: `/epic-wave …` or `/worfy:epic-wave …`. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))
/** The texts the Orchestrator got that are continuations after a temporary API error (retryText). */
const continuations = (h: FaultRun): string[] => h.messages().filter((text) => text.startsWith('The previous turn ended with a temporary API error'))
const retries = (h: FaultRun): TurnRetry[] => h.journal(1).filter((event): event is TurnRetry => event.kind === 'turn-retry')

/** Waits for the run's `count`-th `turn-retry` and its wait. */
async function untilRetry(h: FaultRun, count: number): Promise<void> {
  await until(() => retries(h).length >= count && h.state().status === 'waiting' && h.state().waitingFor === 'retry', `turn-retry ${count}`)
}

/** The pause of the retry runs out on the test's clock: its timer fires, and the continuation goes. */
async function continueAfter(h: FaultRun, count: number): Promise<void> {
  const at = h.state().resumesAt
  if (at === null) throw new Error('the run waits for no retry')
  h.clock.advanceTo(at)
  await until(() => continuations(h).length >= count, `continuation ${count}`)
}

/**
 * A Run whose Wave turn ends with the API error of `script` while the two implementers it started
 * still run: with the switch on it waits a minute (`turn-retry` 1 of 5), sends one continuation
 * (`resumed`), the implementers report, Wave 1 ends and Wave 2 goes; nothing is left to run then.
 */
async function apiFaultSurvived(script: string, error: TurnRetry['error'], errorText: RegExp): Promise<FaultRun> {
  const h = faultRun({ scripts: [script, 'autopilot-waves'], autoContinue: true })
  expect(await h.start()).toEqual({ refusal: null })
  await untilRetry(h, 1)
  expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'retry', retry: { attempt: 1, of: MAX_RETRIES }, resumesAt: START_MS + RETRY_DELAYS_MS[0]!, wave: 1 })
  expect(retries(h)).toMatchObject([{ attempt: 1, of: MAX_RETRIES, error }])
  expect(retries(h)[0]!.message).toMatch(errorText)
  expect(h.messages()).toEqual([WAVE_1])

  await continueAfter(h, 1)
  expect(continuations(h)).toHaveLength(1)
  expect(continuations(h)[0]).not.toMatch(/epic-wave/u)
  // The implementers report in the same Session; then Wave 1 is over and Wave 2 runs in a new one.
  h.releases.release('tasks')
  h.releases.release('tasks')
  await h.stopped(1)

  const kinds = h.kinds(1).filter((kind) => kind !== 'ticket-status' && kind !== 'background-tasks')
  expect(kinds.slice(0, kinds.indexOf('wave-finished') + 1)).toEqual(['run-started', 'wave-started', 'turn-retry', 'resumed', 'wave-finished'])
  expect(h.kinds(1)).not.toContain('session-error')
  expect(h.journal(1).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-ready-wave' })
  // The Wave's command went once per Wave; the continuation is not one.
  expect(waveCommands(h)).toEqual([WAVE_1, WAVE_2])
  expect(continuations(h)).toHaveLength(1)
  expect(h.gh!.calls().length).toBeGreaterThan(0)
  expect(checkRecovery(h.recovery({ stop: 'no-ready-wave', errorText, waves: 2, resumed: true }))).toEqual([])
  return h
}

/**
 * A Run that gives the retry up: run 1 stops with turn-error after `retry-refused` `reason`, and a
 * new start runs Wave 2 (the agent marked Wave 1 done when its command came).
 */
async function givenUp(h: FaultRun, reason: 'cap' | 'in-flight', errorText: RegExp): Promise<void> {
  await h.stopped(1)
  expect(h.state()).toMatchObject({ status: 'stopped', reason: 'turn-error', wave: 1 })
  const events = h.journal(1)
  expect(events.filter((event) => event.kind === 'retry-refused')).toMatchObject([{ reason }])
  const kinds = events.map((event) => event.kind).filter((kind) => kind !== 'ticket-status')
  expect(kinds.slice(kinds.indexOf('retry-refused'), kinds.indexOf('run-stopped') + 1)).toEqual(['retry-refused', 'session-error', 'run-stopped'])

  expect(await h.startAgain()).toEqual({ refusal: null })
  await h.stopped(2)
  expect(h.journal(2).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-ready-wave' })
  expect(waveCommands(h)).toEqual([WAVE_1, WAVE_2])
  expect(checkRecovery(h.recovery({ stop: 'turn-error', errorText, waves: 2, refused: reason }))).toEqual([])
}

describe('Autopilot faults of the model API with Auto-continue on (worfy-retry ticket 09)', () => {
  it('API 500: turn-retry, one continuation at the timer, resumed, and the Run goes on by the rules', async () => {
    await apiFaultSurvived('autopilot-fault-retry-500', 'api-500', /^API Error: 500 .*"api_error"/u)
  })

  it('529 in the middle of the streamed answer: the same, and it is not taken for the Limits', async () => {
    const h = await apiFaultSurvived('autopilot-fault-retry-overloaded', 'overloaded', /^API Error: 529 .*"overloaded_error"/u)
    expect(h.kinds(1)).not.toContain('limits-hit')
    expect(h.kinds(1)).not.toContain('waiting-until')
  })

  it('a dropped connection: the same', async () => {
    await apiFaultSurvived('autopilot-fault-retry-connection', 'connection', /^API Error: Connection error\.$/u)
  })

  it('five 529 in a row: pauses of 1, 5, 15, 30 and 60 minutes, then retry-refused cap and turn-error; a new start goes through', async () => {
    const h = faultRun({ scripts: ['autopilot-retry-overloaded-5', 'autopilot-waves'], autoContinue: true })
    expect(await h.start()).toEqual({ refusal: null })
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      await untilRetry(h, attempt)
      expect(h.state()).toMatchObject({ retry: { attempt, of: MAX_RETRIES }, resumesAt: h.clock.now + RETRY_DELAYS_MS[attempt - 1]! })
      await continueAfter(h, attempt)
    }
    await givenUp(h, 'cap', /^API Error: 529 .*gave up after 5 retries$/su)
    expect(continuations(h)).toHaveLength(MAX_RETRIES)
  })

  it('a git push without its result, then a 500: retry-refused in-flight names the push, no continuation, turn-error; a new start goes through', async () => {
    const h = faultRun({ scripts: ['autopilot-retry-in-flight', 'autopilot-waves'], autoContinue: true })
    expect(await h.start()).toEqual({ refusal: null })
    await givenUp(h, 'in-flight', /^API Error: 500 .*"api_error"/u)
    expect(h.journal(1).find((event) => event.kind === 'retry-refused')).toMatchObject({ actions: ['git push origin demo/01'] })
    expect(h.kinds(1)).not.toContain('turn-retry')
    expect(continuations(h)).toEqual([])
  })

  it('the Limits refuse the turn of Wave 2 by the 7-day window, with no five_hour: the Run waits for that reset, resumes with one continuation, and Wave 1 never goes again', async () => {
    const h = faultRun({ scripts: ['autopilot-waves', 'autopilot-limits-weekly'], autoContinue: true })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.state().status === 'waiting' || h.state().status === 'stopped', 'the wait for the Limits')
    const resumesAt = WEEKLY_RESET_MS + RESUME_MARGIN_MS
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'limits', limitsWindow: 'seven_day', resumesAt, wave: 2 })
    expect(Object.keys(h.tracker.snapshot().windows)).toEqual(['seven_day'])
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_2])

    h.clock.advanceTo(resumesAt)
    await h.stopped(1)
    const kinds = h.kinds(1)
    expect(kinds.filter((kind) => kind === 'limits-hit' || kind === 'waiting-until' || kind === 'resumed')).toEqual(['limits-hit', 'waiting-until', 'resumed'])
    expect(kinds).not.toContain('turn-retry')
    expect(h.journal(1).find((event) => event.kind === 'limits-hit')).toMatchObject({ window: 'seven_day' })
    expect(h.messages().filter((text) => text.startsWith(CONTINUE_TEXT))).toHaveLength(1)
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_2])
    expect(h.journal(1).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-ready-wave' })
    expect(checkRecovery(h.recovery({ stop: 'no-ready-wave', waves: 2, resumed: true }))).toEqual([])
  })
})
