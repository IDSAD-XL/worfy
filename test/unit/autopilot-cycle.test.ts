// The Autopilot cycle (worfy-daily ticket 04, ADR-0024): a pure function from the run's state and one
// event to the next state and what the run does next. When a Wave counts as finished, when the next
// one is sent, and every reason a run stops.
import { describe, expect, it } from 'vitest'
import { AUTOPILOT_STOP_REASONS, initialCycle, SETTLE_MS, step, type CycleEvent, type CycleState } from '../../src/shared/autopilot/cycle'
import { runWaveState } from '../../src/shared/actions/render-template'
import type { Ticket } from '../../src/shared/workflow/types'

const EPIC = 'demo'

const t = (num: number, state: Ticket['state'], blockedNums: number[] = [], epic = EPIC): Ticket => ({
  epic,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: blockedNums.length ? blockedNums.join(', ') : '—',
  blockedNums,
  blockedParsed: true,
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: null,
})

// Wave 1: 01 and 02; Wave 2: 03 (after 01 and 02).
const OPEN = [t(1, 'open'), t(2, 'open'), t(3, 'open', [1, 2])]
const WAVE1_DONE = [t(1, 'done'), t(2, 'done'), t(3, 'open', [1, 2])]
const ALL_DONE = [t(1, 'done'), t(2, 'done'), t(3, 'done', [1, 2])]

const ok = (tickets: Ticket[], tasks = 0, idle = true): CycleEvent => ({ type: 'turn-ended', isError: false, interrupted: false, message: null, tickets, tasks, idle })

/** Feeds events in order; answers the last state and every effect on the way. */
function run(events: CycleEvent[], from: CycleState = initialCycle(EPIC)) {
  let state = from
  const effects: unknown[] = []
  for (const event of events) {
    const next = step(state, event)
    state = next.state
    effects.push(...next.effects)
  }
  return { state, effects }
}

/** A run that has sent Wave 1 (01, 02) and waits for its turn to end. */
const inWave1 = () => run([{ type: 'start', tickets: OPEN }, { type: 'wave-sent', tickets: [1, 2] }]).state

describe('the Autopilot cycle', () => {
  it('starts in the starting phase, with no Wave yet', () => {
    expect(initialCycle(EPIC)).toEqual({ epic: EPIC, phase: 'starting', wave: 0, tickets: [], reason: null, stopping: false, inWork: [] })
  })

  it('sends the first Wave when the Epic has a ready one, and counts it once it is sent', () => {
    const started = run([{ type: 'start', tickets: OPEN }])
    expect(started.effects).toEqual([{ kind: 'send-wave' }])
    expect(started.state.phase).toBe('sending')
    const sent = run([{ type: 'wave-sent', tickets: [1, 2] }], started.state)
    expect(sent.effects).toEqual([{ kind: 'wave-started', wave: 1, tickets: [1, 2] }])
    expect(sent.state).toMatchObject({ phase: 'turn', wave: 1, tickets: [1, 2] })
  })

  it('stops at once with no-ready-wave when the Epic has nothing ready', () => {
    const { state, effects } = run([{ type: 'start', tickets: ALL_DONE }])
    expect(effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
    expect(state).toMatchObject({ phase: 'stopped', reason: 'no-ready-wave', wave: 0 })
  })

  it('after the result of Wave 1 with its Tickets done, sends the next Wave', () => {
    const { state, effects } = run([ok(WAVE1_DONE)], inWave1())
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'send-wave' }])
    expect(state.phase).toBe('sending')
    const next = run([{ type: 'wave-sent', tickets: [3] }], state)
    expect(next.effects).toEqual([{ kind: 'wave-started', wave: 2, tickets: [3] }])
  })

  it('the whole scenario: Wave 1, Wave 2, then no ready Wave', () => {
    const { state, effects } = run([
      { type: 'start', tickets: OPEN },
      { type: 'wave-sent', tickets: [1, 2] },
      ok(WAVE1_DONE),
      { type: 'wave-sent', tickets: [3] },
      ok(ALL_DONE),
    ])
    expect(effects).toEqual([
      { kind: 'send-wave' },
      { kind: 'wave-started', wave: 1, tickets: [1, 2] },
      { kind: 'wave-finished', wave: 1, tickets: [1, 2] },
      { kind: 'send-wave' },
      { kind: 'wave-started', wave: 2, tickets: [3] },
      { kind: 'wave-finished', wave: 2, tickets: [3] },
      { kind: 'stopped', reason: 'no-ready-wave' },
    ])
    expect(state).toMatchObject({ phase: 'stopped', reason: 'no-ready-wave', wave: 2 })
  })

  it('a Ticket of the Wave still in work keeps the Wave going; a later workflow change finishes it', () => {
    const settling = run([ok([t(1, 'done'), t(2, 'work'), t(3, 'open', [1, 2])])], inWave1())
    expect(settling.effects).toEqual([])
    expect(settling.state.phase).toBe('settling')
    // A change that still leaves 02 in work changes nothing.
    expect(run([{ type: 'workflow', tickets: [t(1, 'done'), t(2, 'work'), t(3, 'open', [1, 2])] }], settling.state).effects).toEqual([])
    const finished = run([{ type: 'workflow', tickets: WAVE1_DONE }], settling.state)
    expect(finished.effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'send-wave' }])
  })

  it('a new turn of the Orchestrator while settling waits for that turn; the settle time-out stops the run', () => {
    const settling = run([ok([t(1, 'done'), t(2, 'work'), t(3, 'open', [1, 2])])], inWave1()).state
    const busy = run([{ type: 'busy' }], settling)
    expect(busy.state.phase).toBe('turn')
    // While a turn runs, workflow changes do not finish the Wave: its result does.
    expect(run([{ type: 'workflow', tickets: WAVE1_DONE }], busy.state).effects).toEqual([])
    expect(run([{ type: 'settle-timeout' }], busy.state).effects).toEqual([])
    const timedOut = run([{ type: 'settle-timeout' }], settling)
    expect(timedOut.effects).toEqual([{ kind: 'stopped', reason: 'wave-unfinished' }])
    expect(SETTLE_MS).toBe(10 * 60_000)
  })

  it('workflow changes during the turn do not finish the Wave before its result', () => {
    expect(run([{ type: 'workflow', tickets: WAVE1_DONE }], inWave1()).effects).toEqual([])
  })

  it('Tickets of the Wave left open do not hold the end of the Wave', () => {
    const { effects } = run([ok([t(1, 'done'), t(2, 'open'), t(3, 'open', [1, 2])])], inWave1())
    expect(effects[0]).toEqual({ kind: 'wave-finished', wave: 1, tickets: [1, 2] })
    // 02 is ready again, and 03 is still blocked: the ready Wave is {02}, not the same as {01, 02}.
    expect(effects[1]).toEqual({ kind: 'send-wave' })
  })

  it('stops with no-progress when the ready Wave is the Wave just finished', () => {
    const { effects, state } = run([ok(OPEN)], inWave1())
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'stopped', reason: 'no-progress' }])
    expect(state.reason).toBe('no-progress')
  })

  it('a Session in error stops the run with session-error and its message', () => {
    const { effects, state } = run([{ type: 'session-error', message: 'Claude Code exited' }], inWave1())
    expect(effects).toEqual([{ kind: 'session-error', message: 'Claude Code exited' }, { kind: 'stopped', reason: 'session-error' }])
    expect(state).toMatchObject({ phase: 'stopped', reason: 'session-error' })
  })

  it('a turn that ends with an error stops with turn-error; an interrupted one with interrupted', () => {
    const failed = run([{ type: 'turn-ended', isError: true, interrupted: false, message: 'Not logged in', tickets: WAVE1_DONE, tasks: 0, idle: true }], inWave1())
    expect(failed.effects).toEqual([{ kind: 'session-error', message: 'Not logged in' }, { kind: 'stopped', reason: 'turn-error' }])
    const interrupted = run([{ type: 'turn-ended', isError: true, interrupted: true, message: null, tickets: WAVE1_DONE, tasks: 2, idle: true }], inWave1())
    expect(interrupted.effects).toEqual([{ kind: 'stopped', reason: 'interrupted' }])
  })

  it('the Session closing, a failed send, Stop and quitting each stop the run with their reason', () => {
    expect(run([{ type: 'session-closed' }], inWave1()).effects).toEqual([{ kind: 'stopped', reason: 'session-closed' }])
    const sending = run([{ type: 'start', tickets: OPEN }]).state
    expect(run([{ type: 'send-failed', message: 'No ready wave' }], sending).effects).toEqual([{ kind: 'stopped', reason: 'send-failed' }])
    // Force stop names the Tickets of the Wave it interrupts (worfy-week tickets 17, 18): the next run takes them first.
    expect(run([{ type: 'stop', reason: 'user-force-stop' }], inWave1()).effects).toEqual([{ kind: 'stopped', reason: 'user-force-stop', tickets: [1, 2] }])
    expect(run([{ type: 'stop', reason: 'user-force-stop' }], sending).effects).toEqual([{ kind: 'stopped', reason: 'user-force-stop' }])
    // A stop with user-stop (the run ends a graceful Stop itself) names none.
    expect(run([{ type: 'stop', reason: 'user-stop' }], inWave1()).effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
    expect(run([{ type: 'stop', reason: 'app-quit' }], inWave1()).effects).toEqual([{ kind: 'stopped', reason: 'app-quit' }])
    expect(run([{ type: 'workflow-error', message: 'epic-status failed' }], inWave1()).effects).toEqual([{ kind: 'stopped', reason: 'workflow-error' }])
  })

  it('a stopped run ignores every later event', () => {
    const stopped = run([{ type: 'stop', reason: 'user-stop' }], inWave1()).state
    for (const event of [
      ok(WAVE1_DONE),
      { type: 'session-error', message: 'x' },
      { type: 'stop', reason: 'app-quit' },
      { type: 'start', tickets: OPEN },
      { type: 'wave-sent', tickets: [3] },
    ] satisfies CycleEvent[]) {
      const next = step(stopped, event)
      expect(next.effects, JSON.stringify(event)).toEqual([])
      expect(next.state).toBe(stopped)
    }
  })

  it('reads only the Tickets of its own Epic', () => {
    const other = [t(1, 'open', [], 'other'), t(5, 'open', [], 'other')]
    const { effects } = run([{ type: 'start', tickets: [...ALL_DONE, ...other] }])
    expect(effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
  })

  it('background tasks alive at the end of a turn keep the Wave in phase tasks, whatever the Tickets say (ADR-0029)', () => {
    // The real run of 2026-10-06: the turn ended with four implementers in the background, before
    // any of them claimed a Ticket. Wave 1 is open, and the ready Wave is still Wave 1.
    const waiting = run([ok(OPEN, 4)], inWave1())
    expect(waiting.effects).toEqual([])
    expect(waiting.state).toMatchObject({ phase: 'tasks', wave: 1 })
    // Even with every Ticket done, live tasks hold the Wave.
    expect(run([ok(WAVE1_DONE, 1)], inWave1()).state.phase).toBe('tasks')
    // A workflow change does not judge the Wave while tasks live.
    expect(run([{ type: 'workflow', tickets: WAVE1_DONE }], waiting.state)).toEqual({ state: waiting.state, effects: [] })
  })

  it('a task-notification turn is a turn of the Wave: its result judges the Wave once no task lives', () => {
    const waiting = run([ok(OPEN, 2)], inWave1()).state
    const second = run([{ type: 'busy' }], waiting)
    expect(second.state.phase).toBe('turn')
    // One task left: still waiting.
    const one = run([ok(WAVE1_DONE, 1)], second.state)
    expect(one.state.phase).toBe('tasks')
    // The last task's turn ends with none left: the Wave is finished and Wave 2 goes out.
    const last = run([{ type: 'busy' }, ok(WAVE1_DONE, 0)], one.state)
    expect(last.effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'send-wave' }])
  })

  it('a turn end while the Session already runs another turn waits for that turn', () => {
    const next = run([ok(WAVE1_DONE, 0, false)], inWave1())
    expect(next.effects).toEqual([])
    expect(next.state.phase).toBe('turn')
  })

  it('in phase tasks, the timeout stops with background-stalled while tasks live, and judges the Wave once none does', () => {
    const waiting = run([ok(OPEN, 2)], inWave1()).state
    expect(run([{ type: 'tasks-timeout', tasks: 2, tickets: OPEN }], waiting).effects).toEqual([{ kind: 'stopped', reason: 'background-stalled' }])
    expect(run([{ type: 'tasks-timeout', tasks: 0, tickets: WAVE1_DONE }], waiting).effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'send-wave' }])
    // The same Wave ready again: no-progress, as after any turn.
    expect(run([{ type: 'tasks-timeout', tasks: 0, tickets: OPEN }], waiting).effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'stopped', reason: 'no-progress' }])
    // Outside phase tasks the timeout means nothing.
    expect(run([{ type: 'tasks-timeout', tasks: 2, tickets: OPEN }], inWave1()).effects).toEqual([])
    expect(AUTOPILOT_STOP_REASONS).toContain('background-stalled')
  })

  it('Stop and an error stop the run in phase tasks too', () => {
    const waiting = run([ok(OPEN, 2)], inWave1()).state
    expect(run([{ type: 'stop', reason: 'user-force-stop' }], waiting).effects).toEqual([{ kind: 'stopped', reason: 'user-force-stop', tickets: [1, 2] }])
    expect(run([{ type: 'session-error', message: 'x' }], waiting).state).toMatchObject({ phase: 'stopped', reason: 'session-error' })
  })

  it('stops at once with blocked-tickets and their numbers when only blocked or status-less Tickets have their blockers done (ticket 30)', () => {
    const { state, effects } = run([{ type: 'start', tickets: [t(1, 'done'), t(2, 'blocked', [1]), t(3, 'none'), t(4, 'blocked', [5]), t(5, 'work')] }])
    expect(effects).toEqual([{ kind: 'stopped', reason: 'blocked-tickets', tickets: [2, 3] }])
    expect(state).toMatchObject({ phase: 'stopped', reason: 'blocked-tickets', wave: 0 })
    expect(AUTOPILOT_STOP_REASONS).toContain('blocked-tickets')
  })

  it('after a Wave, stops with blocked-tickets when nothing open is ready but a blocked Ticket has its blockers done', () => {
    const { effects } = run([ok([t(1, 'done'), t(2, 'done'), t(3, 'blocked', [1, 2])])], inWave1())
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'stopped', reason: 'blocked-tickets', tickets: [3] }])
  })

  it('stops with no-ready-wave, not blocked-tickets, when a blocked Ticket still waits for a blocker', () => {
    expect(run([{ type: 'start', tickets: [t(1, 'work'), t(2, 'blocked', [1])] }]).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
    expect(run([ok([t(1, 'done'), t(2, 'done'), t(3, 'blocked', [4]), t(4, 'work')])], inWave1()).effects).toEqual([
      { kind: 'wave-finished', wave: 1, tickets: [1, 2] },
      { kind: 'stopped', reason: 'no-ready-wave' },
    ])
  })

  it('a blocked Ticket with its blockers done stays out of the next Wave, which goes on with the open ones', () => {
    const { effects } = run([ok([t(1, 'done'), t(2, 'done'), t(3, 'blocked', [1, 2]), t(4, 'open', [1])])], inWave1())
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [1, 2] }, { kind: 'send-wave' }])
  })

  it('starts with the Tickets an earlier Stop interrupted when they are still in work, even with nothing ready (worfy-week ticket 17)', () => {
    // 01 and 02 were the interrupted Wave: still claimed, so nothing is ready on its own.
    const inWork = [t(1, 'work'), t(2, 'work'), t(3, 'open', [1, 2])]
    expect(run([{ type: 'start', tickets: inWork }]).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
    const resumed = run([{ type: 'start', tickets: inWork, resume: [1] }])
    expect(resumed.effects).toEqual([{ kind: 'send-wave' }])
    expect(resumed.state.phase).toBe('sending')
    // A Ticket of the list that left work since, or one of another Epic, does not count.
    expect(run([{ type: 'start', tickets: [t(1, 'done'), t(2, 'done'), t(3, 'done', [1, 2])], resume: [1, 2] }]).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
    expect(run([{ type: 'start', tickets: [t(1, 'work', [], 'other'), t(2, 'work')], resume: [1] }]).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
  })

  it('ignores a turn end before any Wave was sent', () => {
    expect(run([ok(WAVE1_DONE)]).effects).toEqual([])
    const sending = run([{ type: 'start', tickets: OPEN }]).state
    expect(run([ok(WAVE1_DONE)], sending).effects).toEqual([])
  })
})

describe('the graceful Stop (worfy-week ticket 18)', () => {
  // 01 claimed, 02 still open: the Wave's turn has started one implementer so far.
  const ONE_IN_WORK = [t(1, 'work'), t(2, 'open'), t(3, 'open', [1, 2])]
  const graceful = (tickets: Ticket[] = ONE_IN_WORK): CycleEvent => ({ type: 'graceful-stop', tickets })

  it('before anything is sent, stops at once with user-stop', () => {
    const started = run([graceful(OPEN)])
    expect(started.effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
    expect(started.state).toMatchObject({ phase: 'stopped', reason: 'user-stop' })
  })

  it('while "Run wave" is on its way: no effect yet; once it is sent, the Wave starts and the run is stopping', () => {
    const sending = run([{ type: 'start', tickets: OPEN }]).state
    const flagged = run([graceful()], sending)
    expect(flagged.effects).toEqual([])
    expect(flagged.state).toMatchObject({ phase: 'sending', stopping: true })
    const sent = run([{ type: 'wave-sent', tickets: [1, 2] }], flagged.state)
    expect(sent.effects).toEqual([
      { kind: 'wave-started', wave: 1, tickets: [1, 2] },
      { kind: 'stopping', wave: 1, tickets: [1, 2], inWork: [1] },
    ])
    expect(sent.state).toMatchObject({ phase: 'turn', stopping: true, inWork: [1] })
  })

  it('during the turn and while tasks live: the stopping effect, the phase stays', () => {
    const turn = run([graceful()], inWave1())
    expect(turn.effects).toEqual([{ kind: 'stopping', wave: 1, tickets: [1, 2], inWork: [1] }])
    expect(turn.state).toMatchObject({ phase: 'turn', stopping: true, inWork: [1] })
    const waiting = run([ok(ONE_IN_WORK, 1)], inWave1()).state
    const tasks = run([graceful()], waiting)
    expect(tasks.effects).toEqual([{ kind: 'stopping', wave: 1, tickets: [1, 2], inWork: [1] }])
    expect(tasks.state).toMatchObject({ phase: 'tasks', stopping: true })
  })

  it('a second graceful Stop while stopping does nothing', () => {
    const stopping = run([graceful()], inWave1()).state
    expect(step(stopping, graceful())).toEqual({ state: stopping, effects: [] })
  })

  it('the next turn end, idle and with no task, stops with user-stop: no wave-finished, no send-wave, even with the next Wave ready', () => {
    const stopping = run([graceful()], inWave1()).state
    // Wave 1 done: Wave 2 (03) would be ready.
    const ended = run([ok(WAVE1_DONE)], stopping)
    expect(ended.effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
    // A Ticket left in work does not hold the run either: no settling while stopping.
    expect(run([ok(ONE_IN_WORK)], stopping).effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
  })

  it('while stopping, tasks still hold the run, a busy Session still waits, and the stall and errors act as before', () => {
    const stopping = run([graceful()], inWave1()).state
    const tasks = run([ok(ONE_IN_WORK, 2)], stopping)
    expect(tasks.effects).toEqual([])
    expect(tasks.state).toMatchObject({ phase: 'tasks', stopping: true })
    expect(run([ok(ONE_IN_WORK, 0, false)], stopping).state).toMatchObject({ phase: 'turn', stopping: true })
    expect(run([{ type: 'tasks-timeout', tasks: 2, tickets: ONE_IN_WORK }], tasks.state).effects).toEqual([{ kind: 'stopped', reason: 'background-stalled' }])
    expect(run([{ type: 'tasks-timeout', tasks: 0, tickets: WAVE1_DONE }], tasks.state).effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
    expect(run([{ type: 'turn-ended', isError: true, interrupted: true, message: null, tickets: OPEN, tasks: 0, idle: true }], stopping).effects).toEqual([{ kind: 'stopped', reason: 'interrupted' }])
    expect(run([{ type: 'stop', reason: 'app-quit' }], stopping).effects).toEqual([{ kind: 'stopped', reason: 'app-quit' }])
  })

  it('once the turn has ended with Tickets still in work (settling), stops at once with user-stop', () => {
    const settling = run([ok(ONE_IN_WORK)], inWave1()).state
    expect(settling.phase).toBe('settling')
    expect(run([graceful()], settling).effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
  })

  it('Force stop while stopping stops with user-force-stop and the Tickets of the Wave', () => {
    const stopping = run([graceful()], inWave1()).state
    expect(run([{ type: 'stop', reason: 'user-force-stop' }], stopping).effects).toEqual([{ kind: 'stopped', reason: 'user-force-stop', tickets: [1, 2] }])
  })

  it('while stopping, inWork follows the workflow, the turn ends and the tasks time-out', () => {
    const stopping = run([graceful()], inWave1()).state
    const both = run([{ type: 'workflow', tickets: [t(1, 'work'), t(2, 'work'), t(3, 'open', [1, 2])] }], stopping)
    expect(both.effects).toEqual([])
    expect(both.state).toMatchObject({ phase: 'turn', inWork: [1, 2] })
    const tasks = run([ok([t(1, 'done'), t(2, 'work'), t(3, 'open', [1, 2])], 1)], both.state)
    expect(tasks.state).toMatchObject({ phase: 'tasks', inWork: [2] })
    // A workflow change outside stopping keeps inWork empty.
    expect(run([{ type: 'workflow', tickets: ONE_IN_WORK }], inWave1()).state.inWork).toEqual([])
  })
})

// A run over named Tickets (worfy-flight-recorder ticket 21, ADR-0091): the Wave takes only the ready
// Tickets of the list, and the run ends with `tickets-done` once every one of them is done.
describe('the Autopilot cycle over named Tickets', () => {
  const TEMPLATE = '/worfy:epic-wave tickets {tickets} of epic {epic}'
  // 05, 06 and 07 are all ready: no blockers, no shared files.
  const READY3 = [t(5, 'open'), t(6, 'open'), t(7, 'open')]
  const named = (tickets: number[]) => initialCycle(EPIC, tickets)
  const wave = (from: CycleState, tickets: Ticket[], sent: number[]) => run([{ type: 'start', tickets }, { type: 'wave-sent', tickets: sent }], from).state

  it('the Wave of a run over 05 and 06 has only 05 and 06, without a list 05, 06 and 07', () => {
    const withList = runWaveState({ epic: EPIC, tickets: READY3, template: TEMPLATE, branch: null, autopilot: true, named: [5, 6] })
    expect(withList).toMatchObject({ enabled: true, tickets: [5, 6], text: `/worfy:epic-wave tickets 05, 06 of epic ${EPIC}` })
    expect(runWaveState({ epic: EPIC, tickets: READY3, template: TEMPLATE, branch: null, autopilot: true })).toMatchObject({ enabled: true, tickets: [5, 6, 7] })
  })

  it('keeps the list in its state; without one the state has none', () => {
    expect(named([6, 5])).toMatchObject({ epic: EPIC, phase: 'starting', named: [5, 6] })
    expect(initialCycle(EPIC)).not.toHaveProperty('named')
  })

  it('stops with tickets-done once 05 and 06 are done, though 07 is ready; without the list sends 07', () => {
    const after = [t(5, 'done'), t(6, 'done'), t(7, 'open')]
    const listed = run([ok(after)], wave(named([5, 6]), READY3, [5, 6]))
    expect(listed.effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [5, 6] }, { kind: 'stopped', reason: 'tickets-done' }])
    expect(listed.state).toMatchObject({ phase: 'stopped', reason: 'tickets-done' })
    expect(AUTOPILOT_STOP_REASONS).toContain('tickets-done')
    const whole = run([ok(after)], wave(initialCycle(EPIC), READY3, [5, 6, 7]))
    expect(whole.effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [5, 6, 7] }, { kind: 'send-wave' }])
  })

  it('a named Ticket done only in its unmerged branch is not done yet', () => {
    const inBranch = { ...t(6, 'done'), fromBranch: 'demo/06' }
    const { effects } = run([ok([t(5, 'done'), inBranch, t(7, 'open')])], wave(named([5, 6]), READY3, [5, 6]))
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [5, 6] }, { kind: 'stopped', reason: 'no-ready-wave' }])
  })

  it('stops at once with tickets-done when every named Ticket is done already', () => {
    expect(run([{ type: 'start', tickets: [t(5, 'done'), t(6, 'done'), t(7, 'open')] }], named([5, 6])).effects).toEqual([{ kind: 'stopped', reason: 'tickets-done' }])
  })

  it('a blocked named Ticket stops the run with blocked-tickets, as without a list', () => {
    const tickets = [t(5, 'open'), t(6, 'blocked'), t(7, 'open')]
    const after = [t(5, 'done'), t(6, 'blocked'), t(7, 'open')]
    const listed = run([ok(after)], wave(named([5, 6]), tickets, [5]))
    expect(listed.effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [5] }, { kind: 'stopped', reason: 'blocked-tickets', tickets: [6] }])
    expect(run([{ type: 'start', tickets }], named([6])).effects).toEqual([{ kind: 'stopped', reason: 'blocked-tickets', tickets: [6] }])
    // Without a list the same Ticket stops the run once nothing open is ready.
    expect(run([{ type: 'start', tickets: [t(5, 'done'), t(6, 'blocked'), t(7, 'done')] }]).effects).toEqual([{ kind: 'stopped', reason: 'blocked-tickets', tickets: [6] }])
  })

  it('a blocked Ticket outside the list does not stop the run, nor go into its Wave', () => {
    const tickets = [t(5, 'open'), t(6, 'blocked'), t(7, 'open')]
    expect(run([{ type: 'start', tickets }], named([5])).effects).toEqual([{ kind: 'send-wave' }])
    const { effects } = run([ok([t(5, 'done'), t(6, 'blocked'), t(7, 'open')])], wave(named([5]), tickets, [5]))
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [5] }, { kind: 'stopped', reason: 'tickets-done' }])
  })

  it('a named Ticket waiting for an open Ticket outside the list is not ready: no-ready-wave', () => {
    expect(run([{ type: 'start', tickets: [t(4, 'open'), t(6, 'open', [4])] }], named([6])).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
  })

  it('takes along only the interrupted Tickets of the list', () => {
    const inWork = [t(5, 'work'), t(6, 'work'), t(7, 'done')]
    expect(run([{ type: 'start', tickets: inWork, resume: [6] }], named([5])).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
    expect(run([{ type: 'start', tickets: inWork, resume: [5] }], named([5])).effects).toEqual([{ kind: 'send-wave' }])
  })

  it('keeps the no-progress rule: the same Wave ready again stops the run', () => {
    // 06 never left `open`: the Orchestrator did nothing with it.
    const { effects } = run([ok([t(5, 'open'), t(6, 'open'), t(7, 'open')])], wave(named([5, 6]), READY3, [5, 6]))
    expect(effects).toEqual([{ kind: 'wave-finished', wave: 1, tickets: [5, 6] }, { kind: 'stopped', reason: 'no-progress' }])
  })
})
