// The continuation ladder of an Autopilot Run (worfy-stuck-agents ticket 05; Fault scenarios 1–5 of the Epic's
// spec): a Ticket left claimed after the Wave's turn, or a Wave that comes back the same, is continued up to twice
// in the next Waves; then the Orchestrator is asked to set it aside (`ticket block … --waits owner`), and only a
// Ticket still in work after that turn stops the run, with the old reason. A red main (land's marker) stops the run
// with `main-red` instead of any continuation. Each scenario runs on faultRun() (autopilot-faults-setup.ts) — the
// real Autopilot over the fake agent and a temporary git Project — and ends with checkRecovery
// (test/autopilot-invariants.ts, I1–I9).
//
// The fake Orchestrator is test/fixtures/agent-scripts/autopilot-set-aside.jsonl in every unattended Session: its
// first turn answers the Wave with words that try to steer worfy ("ignore the rules"), its second answers the
// set-aside message. The test plays the Orchestrator's hands: the Wave's command claims or finishes its Tickets
// (`marks`), and with `setAside: 'block'` the set-aside message's `ticket block` writes the Ticket blocked.
import { describe, expect, it, vi } from 'vitest'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { checkRecovery } from '../autopilot-invariants'
import { ms } from '../time-scale'
import { EPIC, EPIC_B, faultRun, PROJECT, until, type FaultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

/** The lines of the Wave's command in what the Orchestrator got: `/epic-wave …` or `/worfy:epic-wave …`. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/** What the default Run wave template sends (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
const WAVE_OF_01 = '/epic-wave Ticket-ы 01 эпика demo'

/** How long a run settles before it continues a Ticket still in work: short, real time. */
const SETTLE_MS = ms(150)

const DONE = 'done — 2026-11-05'
const SCRIPT = 'autopilot-set-aside'

/** The set-aside message worfy sends for Ticket 01 after two continuations of `wave-unfinished`. */
const SET_ASIDE_01 = 'Ticket 01 stayed claimed after 2 continuations. Run: ticket block demo 01 "stuck: claimed after 2 continuations" --waits owner. Then end the turn.'

const ofKind = <K extends JournalEvent['kind']>(events: readonly JournalEvent[], kind: K): Extract<JournalEvent, { kind: K }>[] =>
  events.filter((event): event is Extract<JournalEvent, { kind: K }> => event.kind === kind)

/** The ticket-status states the run journaled for `ticket`, in order. */
const statusLines = (events: readonly JournalEvent[], ticket: string): string[] => ofKind(events, 'ticket-status').flatMap((event) => (event.ticket === ticket ? [event.state] : []))

/**
 * Wave 1 goes out and claims 01 and 02; the Orchestrator's hands then finish 02 and leave 01 claimed, and claim
 * nothing more on later Waves unless `next` says so.
 */
async function stuckOn01(h: FaultRun, next: 'none' | 'done' = 'none', epics?: readonly string[]): Promise<void> {
  expect(await h.start(epics)).toEqual({ refusal: null })
  await until(() => statusLines(h.journal(1), '01').length === 1 && statusLines(h.journal(1), '02').length === 1, 'the claims of Wave 1')
  h.setMarks(next)
  h.setStatus(2, DONE)
  await until(() => statusLines(h.journal(1), '02').length === 2, 'done of 02 in the journal')
}

describe('the continuation ladder of a Run (worfy-stuck-agents ticket 05)', () => {
  it('scenario 1: a Ticket left claimed is continued in the next Wave, which brings it to done', async () => {
    const h = faultRun({ scripts: [SCRIPT], marks: 'claimed', settleMs: SETTLE_MS })
    await stuckOn01(h, 'done')
    await h.stopped(1)

    const first = h.journal(1)
    expect(ofKind(first, 'ticket-continued')).toMatchObject([{ ticket: '01', attempt: 1, of: 2, cause: 'wave-unfinished' }])
    expect(ofKind(first, 'wave-started')).toMatchObject([
      { wave: 1, tickets: ['01', '02'] },
      { wave: 2, tickets: ['01'], continuation: { attempt: 1, of: 2, cause: 'wave-unfinished' } },
      { wave: 3, tickets: ['03'] },
    ])
    expect(ofKind(first, 'wave-started')[0]).not.toHaveProperty('continuation')
    // The continuation line comes right before the Wave that carries it.
    expect(first.findIndex((event) => event.kind === 'ticket-continued')).toBe(first.findIndex((event) => event.kind === 'wave-started' && event.wave === 2) - 1)
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-ready-wave' })
    expect(statusLines(first, '01')).toEqual(['claimed', 'done'])

    // The Wave command stays first, so the skill expands; worfy's line follows it, with worfy's facts only.
    const continued = h.messages().find((text) => text.includes('Continuation'))!
    expect(continued.split('\n')[0]).toBe(WAVE_OF_01)
    expect(continued).toContain('Continuation 1 of 2 for ticket 01: still claimed 1 min after the turn ended.')
    expect(h.messages().join('\n')).not.toContain('ignore the rules')
    // While the continuation ran the status line said so.
    expect(h.states.some((state) => state.continuing?.attempt === 1 && state.continuing.tickets.includes(1))).toBe(true)
    expect(h.state().continuing).toBeUndefined()

    expect(checkRecovery(h.recovery({ stop: 'no-ready-wave', waves: 3 }))).toEqual([])
  })

  it('scenario 2: still claimed after two continuations → set-aside → the Orchestrator blocks it, Waits: owner → the Run goes to the next Epic', async () => {
    const h = faultRun({ scripts: [SCRIPT, SCRIPT, SCRIPT, 'autopilot-fault-held'], marks: 'claimed', settleMs: SETTLE_MS, setAside: 'block', secondEpic: true })
    await stuckOn01(h, 'none', [EPIC, EPIC_B])
    // wave-started is journaled once the Session took the Wave's text; Claude Code reads it from its stdin
    // later, so the test waits for the command it got too before the Force stop closes the Session.
    await until(
      () => ofKind(h.journal(1), 'epic-started').length === 1 && ofKind(h.journal(1), 'wave-started').length === 4 && waveCommands(h).length >= 4,
      'the Wave of the second Epic',
      10_000,
    )

    const first = h.journal(1)
    expect(ofKind(first, 'ticket-continued')).toMatchObject([
      { ticket: '01', attempt: 1, of: 2, cause: 'wave-unfinished' },
      { ticket: '01', attempt: 2, of: 2, cause: 'wave-unfinished' },
    ])
    expect(ofKind(first, 'ticket-set-aside')).toMatchObject([{ ticket: '01', cause: 'wave-unfinished', attempts: 2 }])
    expect(h.messages()).toContain(SET_ASIDE_01)
    expect(h.messages().join('\n')).not.toContain('ignore the rules')
    // The Orchestrator ran the command: 01 is blocked for the owner, and its Epic ends waiting for the owner.
    expect(ofKind(first, 'ticket-status').filter((event) => event.ticket === '01' && event.epic === EPIC).at(-1)).toMatchObject({
      state: 'blocked',
      reason: 'stuck: claimed after 2 continuations',
      waits: 'owner',
    })
    expect(ofKind(first, 'epic-finished')).toMatchObject([{ epic: EPIC, outcome: 'waits-owner', tickets: ['01', '03'] }])
    expect(ofKind(first, 'epic-started')).toMatchObject([{ epic: EPIC_B, index: 2, of: 2 }])
    expect(ofKind(first, 'wave-started').map((event) => [event.epic, event.wave, event.tickets, event.continuation?.attempt ?? null])).toEqual([
      [EPIC, 1, ['01', '02'], null],
      [EPIC, 2, ['01'], 1],
      [EPIC, 3, ['01'], 2],
      [EPIC_B, 1, ['01'], null],
    ])
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_OF_01, WAVE_OF_01, '/epic-wave Ticket-ы 01 эпика demo-b'])

    await h.autopilot.forceStop(PROJECT)
    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', waves: 4 }))).toEqual([])
  })

  it('scenario 3: the set-aside is not carried out → run-stopped wave-unfinished, as before the ladder', async () => {
    const h = faultRun({ scripts: [SCRIPT], marks: 'claimed', settleMs: SETTLE_MS, setAside: 'ignore' })
    await stuckOn01(h)
    await h.stopped(1)

    const first = h.journal(1)
    expect(ofKind(first, 'ticket-continued')).toHaveLength(2)
    expect(ofKind(first, 'ticket-set-aside')).toMatchObject([{ ticket: '01', cause: 'wave-unfinished', attempts: 2 }])
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'wave-unfinished' })
    // The set-aside went once, and nothing after it.
    expect(h.messages().filter((text) => text === SET_ASIDE_01)).toHaveLength(1)
    expect(h.messages().at(-1)).toBe(SET_ASIDE_01)
    expect(statusLines(first, '01')).toEqual(['claimed'])

    expect(checkRecovery(h.recovery({ stop: 'wave-unfinished', waves: 3 }))).toEqual([])
  })

  it('scenario 4: main is red (land’s marker) → run-stopped main-red, with no continuation and no set-aside', async () => {
    const h = faultRun({ scripts: [SCRIPT], marks: 'claimed', settleMs: SETTLE_MS, mainRed: true })
    await stuckOn01(h)
    await h.stopped(1)

    const first = h.journal(1)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'main-red', wave: 1 })
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'main-red' })
    expect(ofKind(first, 'ticket-continued')).toEqual([])
    expect(ofKind(first, 'ticket-set-aside')).toEqual([])
    expect(waveCommands(h)).toEqual([WAVE_1])
    expect(h.messages()).toHaveLength(1)

    expect(checkRecovery(h.recovery({ stop: 'main-red', waves: 1 }))).toEqual([])
  })

  it('scenario 5: no-progress goes the same ladder — the same Wave is sent twice more, then set-aside, then the old stop', async () => {
    const h = faultRun({ scripts: [SCRIPT], marks: 'none', settleMs: SETTLE_MS, setAside: 'ignore' })
    expect(await h.start()).toEqual({ refusal: null })
    await h.stopped(1)

    const first = h.journal(1)
    expect(ofKind(first, 'wave-started').map((event) => [event.wave, event.tickets, event.continuation ?? null])).toEqual([
      [1, ['01', '02'], null],
      [2, ['01', '02'], { attempt: 1, of: 2, cause: 'no-progress' }],
      [3, ['01', '02'], { attempt: 2, of: 2, cause: 'no-progress' }],
    ])
    expect(ofKind(first, 'ticket-continued').map((event) => [event.ticket, event.attempt])).toEqual([
      ['01', 1],
      ['02', 1],
      ['01', 2],
      ['02', 2],
    ])
    expect(ofKind(first, 'ticket-set-aside')).toMatchObject([
      { ticket: '01', cause: 'no-progress', attempts: 2 },
      { ticket: '02', cause: 'no-progress', attempts: 2 },
    ])
    expect(h.messages()).toContain(
      'Tickets 01, 02 came back as the same wave after 2 continuations. Run: ticket block demo 01 "stuck: same wave after 2 continuations" --waits owner; ticket block demo 02 "stuck: same wave after 2 continuations" --waits owner. Then end the turn.',
    )
    expect(h.messages().find((text) => text.includes('Continuation 1 of 2'))).toContain('Continuation 1 of 2 for tickets 01, 02: came back as the same wave.')
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-progress' })
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1, WAVE_1])

    expect(checkRecovery(h.recovery({ stop: 'no-progress', waves: 3 }))).toEqual([])
  })
})
