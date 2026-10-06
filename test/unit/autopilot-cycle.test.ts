// The Autopilot cycle (worfy-daily ticket 04, ADR-0024): a pure function from the run's state and one
// event to the next state and what the run does next. When a Wave counts as finished, when the next
// one is sent, and every reason a run stops.
import { describe, expect, it } from 'vitest'
import { AUTOPILOT_STOP_REASONS, initialCycle, SETTLE_MS, step, type CycleEvent, type CycleState } from '../../src/shared/autopilot/cycle'
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
    expect(initialCycle(EPIC)).toEqual({ epic: EPIC, phase: 'starting', wave: 0, tickets: [], reason: null })
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
    expect(run([{ type: 'stop', reason: 'user-stop' }], waiting).effects).toEqual([{ kind: 'stopped', reason: 'user-stop' }])
    expect(run([{ type: 'session-error', message: 'x' }], waiting).state).toMatchObject({ phase: 'stopped', reason: 'session-error' })
  })

  it('ignores a turn end before any Wave was sent', () => {
    expect(run([ok(WAVE1_DONE)]).effects).toEqual([])
    const sending = run([{ type: 'start', tickets: OPEN }]).state
    expect(run([ok(WAVE1_DONE)], sending).effects).toEqual([])
  })
})
