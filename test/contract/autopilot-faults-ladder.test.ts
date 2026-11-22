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
// (`marks`), and with `setAside: 'block'` the set-aside message's `ticket block` writes the Ticket blocked. In the
// scenarios that start with stuckOn01 the first Session plays HELD, the same script whose Wave 1 turn ends only when
// the test lets it: the run settles from the end of a turn on real time, and the test's own writes come before that.
//
// Fault scenario 7 (worfy-stuck-agents ticket 09) is here too, with its negative cases: a turn that goes quiet stops
// the run with `turn-hung` and interrupts nothing; a hook that runs is no quiet; a quiet background task stays
// `background-stalled`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Session } from '../../src/main/agent/session'
import { QUIET_MARK_MS } from '../../src/shared/agent/quiet'
import { QUIET_HUNG_MS } from '../../src/shared/autopilot/cycle'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { checkRecovery } from '../autopilot-invariants'
import { ms } from '../time-scale'
import { AGENT_SCRIPTS, EPIC, EPIC_B, faultRun, PROJECT, START_MS, until, type FaultRun, type FaultScript } from './autopilot-faults-setup'

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

/**
 * How long a run settles before it continues a Ticket still in work: short, real time. It starts when a Wave's turn
 * ends, and the test's writes in Wave 1 are all done before that turn ends (HELD), so they do not race it.
 */
const SETTLE_MS = ms(150)

const DONE = 'done — 2026-11-05'
const SCRIPT = 'autopilot-set-aside'

/** The release that ends the Wave 1 turn of HELD. */
const WAVE_1_TURN = 'wave-1-turn'

/**
 * SCRIPT with its first turn held before its result until the test releases WAVE_1_TURN: the script of the run's
 * first Session, so the Wave 1 turn ends only after the test has played the Orchestrator's hands (stuckOn01).
 */
const HELD: FaultScript = (() => {
  const lines = readFileSync(join(AGENT_SCRIPTS, `${SCRIPT}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const result = lines.findIndex((line) => line.type === 'result')
  if (result < 0) throw new Error(`${SCRIPT}.jsonl has no result line`)
  return [...lines.slice(0, result), { fake: 'wait_release', name: WAVE_1_TURN }, ...lines.slice(result)]
})()

/** Where the block goes (worfy-polish 138): the Ticket's worktree with a commit on its branch, or the main branch. */
const COMMIT =
  'commit only the Ticket file on its branch: git -C <worktree> commit -m "<message>" -- <ticket file>. ' +
  'A Ticket with no worktree gets the block on the main branch the way the documents PR carries statuses, never by a direct commit to main.'

/** The set-aside message worfy sends for Ticket 01 after two continuations of `wave-unfinished`. */
const SET_ASIDE_01 = `Ticket 01 stayed claimed after 2 continuations. Run: ticket block demo 01 "stuck: claimed after 2 continuations" --waits owner. Run it in the Ticket's own worktree and ${COMMIT} Then end the turn.`

/** The same message for Ticket 01 claimed in its worktree branch `demo/01`: it names the branch. */
const SET_ASIDE_01_BRANCH = `Ticket 01 stayed claimed after 2 continuations. Run: ticket block demo 01 "stuck: claimed after 2 continuations" --waits owner. Run it in the Ticket's own worktree (branch demo/01) and ${COMMIT} Then end the turn.`

/** The same message in Silent mode: no worktree, no commit; the status goes into the Workflow folder. */
const SET_ASIDE_01_SILENT =
  'Ticket 01 stayed claimed after 2 continuations. Run: ticket block demo 01 "stuck: claimed after 2 continuations" --waits owner. ' +
  'Run it from any directory, with no commit: in Silent mode the status goes straight into the Workflow folder. Then end the turn.'

const ofKind = <K extends JournalEvent['kind']>(events: readonly JournalEvent[], kind: K): Extract<JournalEvent, { kind: K }>[] =>
  events.filter((event): event is Extract<JournalEvent, { kind: K }> => event.kind === kind)

/** The ticket-status states the run journaled for `ticket`, in order. */
const statusLines = (events: readonly JournalEvent[], ticket: string): string[] => ofKind(events, 'ticket-status').flatMap((event) => (event.ticket === ticket ? [event.state] : []))

/**
 * Wave 1 goes out and claims 01 and 02; the Orchestrator's hands then finish 02 and leave 01 claimed, and claim
 * nothing more on later Waves unless `next` says so. The run's first Session plays HELD: all of that happens while the
 * Wave 1 turn is still under way, and the turn ends (and the run starts to settle) only once the journal has 02 done.
 * How long the test takes over its writes therefore changes nothing in what the run sees after the turn.
 */
async function stuckOn01(h: FaultRun, next: 'none' | 'done' = 'none', epics?: readonly string[]): Promise<void> {
  expect(await h.start(epics)).toEqual({ refusal: null })
  await h.untilRun(1, () => statusLines(h.journal(1), '01').length === 1 && statusLines(h.journal(1), '02').length === 1, 'the claims of Wave 1')
  h.setMarks(next)
  h.setStatus(2, DONE)
  await h.untilRun(1, () => statusLines(h.journal(1), '02').length === 2, 'done of 02 in the journal')
  // The turn is still Wave 1's: nothing was continued or finished yet.
  expect(h.kinds(1).filter((kind) => kind === 'wave-started' || kind === 'ticket-continued' || kind === 'wave-finished')).toEqual(['wave-started'])
  h.releases.release(WAVE_1_TURN)
}

describe('the continuation ladder of a Run (worfy-stuck-agents ticket 05)', () => {
  it('scenario 1: a Ticket left claimed is continued in the next Wave, which brings it to done', async () => {
    const h = faultRun({ scripts: [HELD, SCRIPT], marks: 'claimed', settleMs: SETTLE_MS })
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
    // 01's claim reads from its worktree branch, so the set-aside message names the branch (worfy-polish 138).
    const h = faultRun({ scripts: [HELD, SCRIPT, SCRIPT, 'autopilot-fault-held'], marks: 'claimed', settleMs: SETTLE_MS, setAside: 'block', secondEpic: true, fromBranch: [
        { epic: EPIC, num: 1, branch: 'demo/01' },
        // Ticket 01 of the other Epic has a branch too: the message must not take it for the set-aside Ticket's.
        { epic: EPIC_B, num: 1, branch: 'demo-b/01' },
      ],
    })
    await stuckOn01(h, 'none', [EPIC, EPIC_B])
    // wave-started is journaled once the Session took the Wave's text; Claude Code reads it from its stdin
    // later, so the test waits for the command it got too before the Force stop closes the Session.
    await h.untilRun(
      1,
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
    expect(h.messages()).toContain(SET_ASIDE_01_BRANCH)
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
    const h = faultRun({ scripts: [HELD, SCRIPT], marks: 'claimed', settleMs: SETTLE_MS, setAside: 'ignore' })
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

  it('scenario 3, Silent mode: the set-aside message says to run the command from any directory with no commit (worfy-polish 138)', async () => {
    const h = faultRun({ scripts: [HELD, SCRIPT], marks: 'claimed', settleMs: SETTLE_MS, setAside: 'ignore', silent: true, fromBranch: [{ epic: EPIC, num: 1, branch: 'demo/01' }] })
    await stuckOn01(h)
    await h.stopped(1)

    expect(ofKind(h.journal(1), 'ticket-set-aside')).toMatchObject([{ ticket: '01', cause: 'wave-unfinished', attempts: 2 }])
    expect(h.messages().at(-1)).toBe(SET_ASIDE_01_SILENT)
    expect(checkRecovery(h.recovery({ stop: 'wave-unfinished', waves: 3 }))).toEqual([])
  })

  it('scenario 4: main is red (land’s marker) → run-stopped main-red, with no continuation and no set-aside', async () => {
    const h = faultRun({ scripts: [HELD, SCRIPT], marks: 'claimed', settleMs: SETTLE_MS, mainRed: true })
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
      'Tickets 01, 02 came back as the same wave after 2 continuations. Run: ticket block demo 01 "stuck: same wave after 2 continuations" --waits owner; ticket block demo 02 "stuck: same wave after 2 continuations" --waits owner. ' +
        `Run each in its Ticket's own worktree and ${COMMIT} Then end the turn.`,
    )
    expect(h.messages().find((text) => text.includes('Continuation 1 of 2'))).toContain('Continuation 1 of 2 for tickets 01, 02: came back as the same wave.')
    expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-progress' })
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1, WAVE_1])

    expect(checkRecovery(h.recovery({ stop: 'no-progress', waves: 3 }))).toEqual([])
  })
})

// A quiet turn (worfy-stuck-agents ticket 09; Fault scenario 7 of the Epic's spec): the Sessions watch their turns for
// quiet on the test's clock (faultRun's `quietHungMs`), the mark after QUIET_MARK_MS, and the run stops with turn-hung
// once the Orchestrator's turn has been quiet for QUIET_HUNG_MS. Nothing is interrupted: the same process goes on as
// the person's Session, with its turn and its background task (ADR-0050, "After any other stop").
describe('a quiet turn of the Orchestrator (worfy-stuck-agents ticket 09)', () => {
  /** The Session of the run's turn, once it runs. */
  const busySession = (h: FaultRun): Session | null => {
    const info = h.registry.list().find((each) => each.state === 'busy')
    return info === undefined ? null : h.registry.get(info.sessionId)
  }
  const pause = (): Promise<void> => new Promise((done) => setTimeout(done, ms(200)))

  it('scenario 7: a turn without a sign of life for 30 min → run-stopped turn-hung; no Interrupt, the same process, the task alive, the Session attended', async () => {
    const interrupt = vi.spyOn(Session.prototype, 'interrupt')
    const halt = vi.spyOn(Session.prototype, 'halt')
    try {
      // test/fixtures/agent-scripts/autopilot-quiet-turn.jsonl: the Wave's turn starts an implementer and then says nothing.
      const h = faultRun({ scripts: ['autopilot-quiet-turn'], marks: 'claimed', quietHungMs: QUIET_HUNG_MS })
      expect(await h.start()).toEqual({ refusal: null })
      await until(() => (busySession(h)?.backgroundTasks().length ?? 0) === 1 && h.kinds(1).includes('wave-started'), 'the quiet turn of Wave 1')
      const session = busySession(h)!

      h.clock.advance(QUIET_MARK_MS + 60_000)
      await until(() => session.controls().quietSince === START_MS, 'the quiet mark of the turn')
      // The limit of a hung turn counts from the start of the quiet, not from the mark.
      await until(() => h.clock.pending().some((timer) => timer.at === START_MS + QUIET_HUNG_MS), 'the limit of a hung turn')
      h.clock.advanceTo(START_MS + QUIET_HUNG_MS - 60_000)
      await pause()
      expect(h.state().status).toBe('running')
      expect(h.kinds(1)).not.toContain('run-stopped')

      h.clock.advanceTo(START_MS + QUIET_HUNG_MS)
      await h.stopped(1)
      const first = h.journal(1)
      expect(h.state()).toMatchObject({ status: 'stopped', reason: 'turn-hung', wave: 1 })
      expect(first.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'turn-hung', tasks: [{ id: 'task_impl_0001' }] })
      expect(first.at(-1)).toMatchObject({ kind: 'orchestrator-returned', tasks: [{ id: 'task_impl_0001' }] })

      // Nothing was interrupted, halted or started again: the run's one unattended process goes on as the person's Session.
      expect(interrupt).not.toHaveBeenCalled()
      expect(halt).not.toHaveBeenCalled()
      const unattended = h.queries().filter((query) => query.unattended)
      expect(unattended).toHaveLength(1)
      expect(unattended[0]!.calls.filter((call) => call.kind === 'close')).toEqual([])
      expect(h.registry.get(session.id)).toBe(session)
      expect(session.state).toBe('busy')
      expect(session.backgroundTasks().map((task) => task.taskId)).toEqual(['task_impl_0001'])
      expect(session.unattended).toBe(false)
      expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
      expect(h.kinds(1)).not.toContain('tasks-killed')

      // The turn was not interrupted: it ends by itself, in the person's Session.
      h.releases.release('turn')
      await until(() => session.state === 'idle', 'the end of the turn')

      expect(checkRecovery(h.recovery({ stop: 'turn-hung', waves: 1 }))).toEqual([])
    } finally {
      interrupt.mockRestore()
      halt.mockRestore()
    }
  })

  it('a hook that runs past the limit is no quiet: no turn-hung while it runs; the quiet counts from its end', async () => {
    // test/fixtures/agent-scripts/autopilot-quiet-hook.jsonl: the Wave's turn starts a hook that runs until the test ends it.
    const h = faultRun({ scripts: ['autopilot-quiet-hook'], marks: 'claimed', quietHungMs: QUIET_HUNG_MS })
    const deltas: string[] = []
    h.registry.observe((_sessionId, event) => {
      if (event.type === 'delta') deltas.push(event.text)
    })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => deltas.includes('The gate runs ') && busySession(h) !== null, 'the hook of the Wave turn')
    const session = busySession(h)!

    // Forty minutes of the hook: no quiet, no stop.
    h.clock.advance(QUIET_HUNG_MS + 10 * 60_000)
    await pause()
    expect(session.controls().quietSince).toBeNull()
    expect(h.state().status).toBe('running')
    expect(h.kinds(1)).not.toContain('run-stopped')

    // The hook ends: a sign of life, and the quiet counts from it.
    const ended = h.clock.now
    h.releases.release('hook')
    await until(() => deltas.includes('and ended'), 'the end of the hook')
    h.clock.advance(QUIET_MARK_MS + 60_000)
    await until(() => session.controls().quietSince === ended, 'the quiet mark after the hook')
    h.clock.advanceTo(ended + QUIET_HUNG_MS - 60_000)
    await pause()
    expect(h.state().status).toBe('running')
    h.clock.advanceTo(ended + QUIET_HUNG_MS)
    await h.stopped(1)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'turn-hung' })

    h.releases.release('turn')
    await until(() => session.state === 'idle', 'the end of the turn')
    expect(checkRecovery(h.recovery({ stop: 'turn-hung', waves: 1 }))).toEqual([])
  })

  it('the silence of a background implementer after the turn stays background-stalled, not turn-hung', async () => {
    // test/fixtures/agent-scripts/autopilot-background.jsonl: the Wave's turn ends with two implementers alive, which then say nothing.
    const h = faultRun({ scripts: ['autopilot-background'], marks: 'claimed', quietHungMs: QUIET_HUNG_MS, backgroundStallMs: 60 * 60_000 })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.kinds(1).includes('background-tasks') && h.registry.list().every((each) => each.state !== 'busy'), 'the end of the Wave turn with live tasks')

    h.clock.advance(QUIET_HUNG_MS + 60_000)
    await pause()
    expect(h.state().status).toBe('running')
    h.clock.advance(60 * 60_000)
    await h.stopped(1)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'background-stalled' })
    expect(checkRecovery(h.recovery({ stop: 'background-stalled', waves: 1 }))).toEqual([])
  })
})
