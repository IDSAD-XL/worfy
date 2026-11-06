// The faults of the processes of an Autopilot Run (worfy-faults ticket 03; the scenarios table of its
// spec): the Claude Code process of the Orchestrator dies while its implementers write in the
// background, and an implementer ends with task_notification `failed` while its Ticket stays
// `claimed` or goes back to `open`. Each scenario runs on faultRun() (autopilot-faults-setup.ts) —
// the real Autopilot over the fake agent and a temporary git Project — and ends with checkRecovery
// (test/autopilot-invariants.ts). The implementers are the Subagents of
// test/fixtures/agent-scripts/autopilot-background.jsonl, seen through task_started and
// task_notification.
import type { ChildProcess } from 'node:child_process'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { QueryRequest } from '../../src/main/agent/session'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { checkRecovery } from '../autopilot-invariants'
import { ms } from '../time-scale'
import { EPIC, faultRun, PROJECT, until, type FaultRun } from './autopilot-faults-setup'
import type { StubKind } from './claude-process-stub'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

/** The lines of the Wave's command in what the Orchestrator got: `/epic-wave …` or `/worfy:epic-wave …`. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/** What the default Run wave template sends for a Wave of the Epic (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
const WAVE_OF_01 = '/epic-wave Ticket-ы 01 эпика demo'

/** The Status: lines the test writes for the Orchestrator. */
const CLAIMED = 'claimed — 2026-11-05'
const DONE = 'done — 2026-11-05'
const OPEN = 'open'

/** How long a run settles before wave-unfinished here: long enough to tell from an at-once stop. */
const SETTLE_MS = ms(150)

/** The ticket-status states the run journaled for `ticket`, in order. */
const statusLines = (events: readonly JournalEvent[], ticket: string): string[] =>
  events.flatMap((event) => (event.kind === 'ticket-status' && event.ticket === ticket ? [event.state] : []))

/** The ids of the live tasks of the run's last background-tasks line. */
const lastTasks = (h: FaultRun, n = 1): string[] => {
  const last = h.journal(n).findLast((event) => event.kind === 'background-tasks')
  return last?.kind === 'background-tasks' ? last.tasks.map((task) => task.id) : []
}

/** Every faultRun of this file, for the check that it left no stub process alive. */
const runs: FaultRun[] = []

afterAll(() => {
  // autopilot-faults-setup.ts stops every run and kills every stub process after each test.
  for (const h of runs) expect(h.processes?.alive() ?? 0).toBe(0)
})

/**
 * A Claude process stub behind every query that exits when its stdin ends; the processes of the
 * unattended Orchestrator Sessions are kept in `unattended`, as each Session learns of its own (the
 * stub picks the kind before it spawns, so the Session's `spawned` is wrapped by then).
 */
function stubs(): { kind: (n: number, request: QueryRequest) => StubKind; unattended: ChildProcess[] } {
  const unattended: ChildProcess[] = []
  return {
    unattended,
    kind: (_n, request) => {
      if (request.unattended === true) {
        const told = request.spawned
        request.spawned = (child) => {
          unattended.push(child as ChildProcess)
          told?.(child)
        }
      }
      return 'exit-at-once'
    },
  }
}

describe('Autopilot faults of the processes (worfy-faults ticket 03)', () => {
  it('Claude Code of the Orchestrator dies while both implementers write: session-error, the Run stops, a new start goes to a new Session and sends its Wave once', async () => {
    const processes = stubs()
    // The Run's Orchestrator dies; the new start's Orchestrator holds its Wave turn until the Force stop.
    const h = faultRun({ scripts: ['autopilot-fault-orchestrator-died', 'autopilot-fault-held'], marks: 'none', processes: processes.kind })
    runs.push(h)
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => lastTasks(h).length === 2, 'both implementers to start')
    // The Orchestrator claimed Ticket 01 for its implementer before it died.
    h.setStatus(1, CLAIMED)
    await until(() => statusLines(h.journal(1), '01').length === 1, 'the claim of 01 in the journal')

    // The death, as Claude Code dies: its process is gone, then the SDK's message stream throws.
    const orchestrator = processes.unattended[0]!
    const gone = new Promise<void>((done) => orchestrator.once('exit', () => done()))
    orchestrator.kill('SIGKILL')
    await gone
    h.releases.release('die')
    await h.stopped(1)

    // The Tickets of the Wave the error interrupted stay resumable, as after a Force stop (worfy-retry ticket 14).
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'session-error', wave: 1, backgroundTasks: 0, resumable: [1, 2] })
    const first = h.journal(1)
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'session-error' })
    expect(first.flatMap((event) => (event.kind === 'session-error' ? [event.message] : []))).toEqual([expect.stringMatching(/^Claude Code process exited with code 1\b/u)])
    // The run waits for no task of the dead process: the set is emptied before the error.
    expect(lastTasks(h)).toEqual([])
    expect(first.findIndex((event) => event.kind === 'background-tasks' && event.tasks.length === 0)).toBeLessThan(first.findIndex((event) => event.kind === 'session-error'))
    expect(waveCommands(h)).toEqual([WAVE_1])
    expect(statusLines(first, '01')).toEqual(['claimed'])

    // A new start goes through on a new Orchestrator Session, and its Wave command goes once.
    expect(await h.startAgain()).toEqual({ refusal: null })
    await until(() => waveCommands(h).length >= 2 && h.kinds(2).includes('wave-started'), 'the Wave of the new Run')
    expect(h.journal(2)[0]).toMatchObject({ kind: 'run-started', epic: EPIC })
    // 01 is still claimed by the dead implementer: the Wave the session-error interrupted is resumable,
    // so the new Run's Wave names 01 along with the ready 02 (worfy-retry ticket 14, ADR-0050).
    expect(h.journal(2).filter((event) => event.kind === 'wave-started')).toMatchObject([{ wave: 1, tickets: ['01', '02'] }])
    await h.autopilot.forceStop(PROJECT)
    const unattended = h.queries().filter((query) => query.unattended)
    expect(unattended).toHaveLength(2)
    expect(unattended[1]!.messages.filter((text) => /^\s*\/(?:worfy:)?epic-wave\b/mu.test(text))).toHaveLength(1)
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1])

    expect(checkRecovery(h.recovery({ stop: 'session-error', errorText: /^Claude Code process exited with code 1\b/u, waves: 2 }))).toEqual([])
  })

  it('an implementer fails and its Ticket stays claimed: the run settles and stops with wave-unfinished after settleMs, the Wave goes once', async () => {
    const h = faultRun({ scripts: ['autopilot-fault-implementer-failed'], marks: 'claimed', processes: 'exit-at-once', settleMs: SETTLE_MS })
    runs.push(h)
    expect(await h.start()).toEqual({ refusal: null })
    // The Wave's command claimed 01 and 02; both implementers run.
    await until(() => lastTasks(h).length === 2 && statusLines(h.journal(1), '02').length === 1, 'both implementers and both claims')
    h.releases.release('failed')
    await until(() => lastTasks(h).length === 1, 'the failed implementer to end')
    // The second implementer's Ticket is merged; 01 stays claimed.
    h.setStatus(2, DONE)
    await until(() => statusLines(h.journal(1), '02').length === 2, 'done of 02 in the journal')
    h.releases.release('completed')
    await until(() => lastTasks(h).length === 0, 'the last implementer to end')
    const lastTaskEnded = Date.parse(h.journal(1).findLast((event) => event.kind === 'background-tasks')!.at)
    await h.stopped(1)

    const first = h.journal(1)
    const stopped = first.find((event) => event.kind === 'run-stopped')
    expect(stopped).toMatchObject({ reason: 'wave-unfinished' })
    // It settled first: the settle starts after the last turn, which comes after the last task ended,
    // so a stop at once (no settling) lands well inside settleMs of that line.
    expect(Date.parse(stopped!.at) - lastTaskEnded).toBeGreaterThanOrEqual(SETTLE_MS)
    expect(first.map((event) => event.kind)).not.toContain('wave-finished')
    expect(waveCommands(h)).toEqual([WAVE_1])
    expect(statusLines(first, '01')).toEqual(['claimed'])
    expect(statusLines(first, '02')).toEqual(['claimed', 'done'])

    expect(checkRecovery(h.recovery({ stop: 'wave-unfinished', waves: 1 }))).toEqual([])
  })

  it('an implementer fails and the Orchestrator gives its Ticket back to open: the next Wave holds only that Ticket, not no-progress', async () => {
    // The second Wave starts a new Orchestrator Session, which holds its turn until the Force stop.
    const h = faultRun({ scripts: ['autopilot-fault-implementer-failed', 'autopilot-fault-held'], marks: 'claimed', processes: 'exit-at-once', settleMs: SETTLE_MS })
    runs.push(h)
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => lastTasks(h).length === 2 && statusLines(h.journal(1), '02').length === 1, 'both implementers and both claims')
    h.releases.release('failed')
    await until(() => lastTasks(h).length === 1, 'the failed implementer to end')
    h.setStatus(1, OPEN)
    h.setStatus(2, DONE)
    await until(() => statusLines(h.journal(1), '01').length === 2 && statusLines(h.journal(1), '02').length === 2, 'open of 01 and done of 02 in the journal')
    h.releases.release('completed')
    await until(() => waveCommands(h).length >= 2 && h.journal(1).filter((event) => event.kind === 'wave-started').length === 2, 'the second Wave')

    const first = h.journal(1)
    expect(first.filter((event) => event.kind === 'wave-started')).toMatchObject([
      { wave: 1, tickets: ['01', '02'] },
      { wave: 2, tickets: ['01'] },
    ])
    expect(first.find((event) => event.kind === 'wave-finished')).toMatchObject({ wave: 1 })
    expect(h.state()).toMatchObject({ status: 'running', wave: 2 })
    await h.autopilot.forceStop(PROJECT)
    expect(h.journal(1).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'user-force-stop' })
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_OF_01])

    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', waves: 2 }))).toEqual([])
  })
})
