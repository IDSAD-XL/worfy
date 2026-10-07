// The Autopilot cycle (worfy-daily ticket 04, ADR-0024): from the state of one run and one event to
// the next state and what the run does next. Pure; src/main/autopilot/run.ts feeds it the events of
// the run's Orchestrator Session and fresh reads of the workflow model, and carries out its effects.
//
// A Wave is finished when the Orchestrator's turn ended with a `result` that is neither an error
// nor interrupted, the Session has no live background task and is idle (ADR-0029), and in a fresh
// read of the workflow model no Ticket of the Wave is in work (ADR-0024). Live background tasks
// keep the run in `tasks`: their task-notifications start turns of the Session, each of them a turn
// of the Wave whose result checks again. Without any task event for BACKGROUND_STALL_MS the run
// stops with `background-stalled`; with no task left and no turn within TASKS_GRACE_MS the Wave is
// checked without that turn. A Ticket still in work keeps the run settling: each workflow change
// checks again, a new turn of the Orchestrator waits for its own result, and after SETTLE_MS
// without either the run stops with `wave-unfinished`. After a finished Wave the next ready Wave
// is sent, unless there is none or it is the very Wave just finished (`no-progress`). With none
// ready, the run stops with `blocked-tickets` when blocked or status-less Tickets have all their
// blockers done (they would be the Wave if they were open; ADR-0033), else with `no-ready-wave`;
// the same holds at the start of the run.
//
// Waves are counted per run from 1: `wave` is the run's count, not the Wave number of the Epic's
// plan. The text the Orchestrator gets names the Wave's Tickets (ADR-0033).
//
// Stop by the user is graceful (worfy-week ticket 18, ADR-0051): no new Ticket, the ones in work
// finish. Before the Wave is sent, and once the Orchestrator's turn has ended with no task left
// (`settling`), the run stops at once with `user-stop`. While "Run wave" is on its way the run only
// notes it; during the turn and while tasks live it goes `stopping` (the phase stays, the
// `stopping` effect tells the run to say so to the Orchestrator). A stopping run sends no new Wave
// and waits for no Ticket file: the first turn end with the Session idle and no task alive stops it
// with `user-stop`, without `wave-finished`. `inWork` follows the Tickets of the Wave in work.
//
// Force stop (`user-force-stop`, worfy-week ticket 17, ADR-0050) names the Tickets of the Wave it
// interrupts in its `stopped` effect. A run started after it is given those Tickets (`start`,
// `resume`): the ones still in work count as ready, so the first Wave goes even when nothing else is.
import { resumedTickets } from '../actions/render-template'
import type { Ticket } from '../workflow/types'
import { readyWave } from '../workflow/waves'

/** Why a run ended; the `reason` of its `run-stopped` journal line. */
export const AUTOPILOT_STOP_REASONS = [
  'no-ready-wave',
  'blocked-tickets',
  'no-progress',
  'wave-unfinished',
  'session-error',
  'turn-error',
  'interrupted',
  'session-closed',
  'send-failed',
  'workflow-error',
  'limits-timeout',
  'background-stalled',
  'user-stop',
  'user-force-stop',
  'app-quit',
] as const
export type AutopilotStopReason = (typeof AUTOPILOT_STOP_REASONS)[number]

/** How long a run waits after the Orchestrator's turn for the Tickets of the Wave to leave work. */
export const SETTLE_MS = 10 * 60_000

/**
 * How long a run waits for its background tasks without any event of theirs before it stops with
 * `background-stalled` (ADR-0029): an implementer may wait for CI in one 10-minute Bash, and more
 * than once; a hung Subagent holds the run an hour at most.
 */
export const BACKGROUND_STALL_MS = 60 * 60_000

/** How long a run waits, after the last background task ended, for the turn its task-notification starts. */
export const TASKS_GRACE_MS = 2 * 60_000

type CycleTicket = Parameters<typeof readyWave>[0][number] & Pick<Ticket, 'state'>

export interface CycleState {
  epic: string
  /**
   * starting: nothing sent yet; sending: "Run wave" is being sent; turn: the Wave is sent and the
   * Orchestrator's turn runs; tasks: the turn ended with background tasks of the Session alive;
   * settling: the turn ended with Tickets of the Wave still in work; stopped: the run is over.
   */
  phase: 'starting' | 'sending' | 'turn' | 'tasks' | 'settling' | 'stopped'
  /** The run's count of Waves sent, from 1; 0 before the first. */
  wave: number
  /** Ticket numbers of the current Wave, as it was sent. */
  tickets: number[]
  reason: AutopilotStopReason | null
  /** A graceful Stop came: no new Wave; the run ends with the first turn end that leaves nothing alive. */
  stopping: boolean
  /**
   * While stopping: the Tickets of the current Wave in work by the last read of the workflow (while
   * "Run wave" is on its way, of the whole Epic: the Wave is not known yet). Empty otherwise.
   */
  inWork: number[]
}

export type CycleEvent =
  /**
   * The run begins; the Tickets of a fresh read of the workflow model, and the Tickets of the Wave
   * the last Stop of this Epic interrupted (`resume`): those still in work go into the first Wave.
   */
  | { type: 'start'; tickets: readonly CycleTicket[]; resume?: readonly number[] }
  /** "Run wave" went to the Orchestrator for these Tickets. */
  | { type: 'wave-sent'; tickets: number[] }
  /** "Run wave" could not be sent (the template fails, the Orchestrator is gone). */
  | { type: 'send-failed'; message: string }
  /** The Orchestrator started a turn. */
  | { type: 'busy' }
  /**
   * The Orchestrator's turn ended (`result`); the Tickets of a fresh read made after it, and the
   * Session as it is then: its live background tasks (not ambient), and whether it is idle (no
   * turn has started since).
   */
  | { type: 'turn-ended'; isError: boolean; interrupted: boolean; message: string | null; tickets: readonly CycleTicket[]; tasks: number; idle: boolean }
  /**
   * In `tasks`, the time ran out: BACKGROUND_STALL_MS without a task event while `tasks` live, or
   * TASKS_GRACE_MS after the last one ended without a turn. The Tickets of a fresh read.
   */
  | { type: 'tasks-timeout'; tasks: number; tickets: readonly CycleTicket[] }
  /** The workflow model changed (`workflow.changed`); the Tickets of a fresh read. */
  | { type: 'workflow'; tickets: readonly CycleTicket[] }
  /** SETTLE_MS passed since the run started settling. */
  | { type: 'settle-timeout' }
  /** The workflow model could not be read after the Orchestrator's turn. */
  | { type: 'workflow-error'; message: string }
  /** The Orchestrator Session went to `error`. */
  | { type: 'session-error'; message: string }
  /** The Orchestrator Session closed. */
  | { type: 'session-closed' }
  /** The user pressed Stop (graceful, worfy-week ticket 18); the Tickets of a fresh read. */
  | { type: 'graceful-stop'; tickets: readonly CycleTicket[] }
  /**
   * The user chose Force stop, the app quits, the wait for the Limits would pass its limit
   * (src/shared/autopilot/resume-at.ts, MAX_WAIT_MS), or the run ends a graceful Stop itself
   * (`user-stop`: its Wave still waited in the Session's queue).
   */
  | { type: 'stop'; reason: 'user-stop' | 'user-force-stop' | 'app-quit' | 'limits-timeout' }

export type CycleEffect =
  /** Send "Run wave" to the Orchestrator; answer with `wave-sent` or `send-failed`. */
  | { kind: 'send-wave' }
  | { kind: 'wave-started'; wave: number; tickets: number[] }
  | { kind: 'wave-finished'; wave: number; tickets: number[] }
  /** The Session failed or its turn ended with an error. */
  | { kind: 'session-error'; message: string }
  /**
   * A graceful Stop during the Wave's turn or its tasks: write `run-stopping` and tell the
   * Orchestrator to take no new Ticket (run.ts, STOP_TEXT). `inWork`: the Wave's Tickets in work.
   */
  | { kind: 'stopping'; wave: number; tickets: number[]; inWork: number[] }
  /**
   * The run is over: release keep-awake, give the Orchestrator back, write `run-stopped`. With
   * `blocked-tickets`, `tickets` are the Tickets it stopped on; with `user-force-stop`, the Tickets
   * of the Wave it interrupted (none before the first Wave is sent).
   */
  | { kind: 'stopped'; reason: AutopilotStopReason; tickets?: number[] }

export interface CycleStep {
  state: CycleState
  effects: CycleEffect[]
}

export function initialCycle(epic: string): CycleState {
  return { epic, phase: 'starting', wave: 0, tickets: [], reason: null, stopping: false, inWork: [] }
}

/** Which of `nums` are Tickets of the run's Epic in work in `tickets`. */
function inWorkOf(state: CycleState, tickets: readonly CycleTicket[], nums: readonly number[]): number[] {
  return nums.filter((num) => tickets.some((ticket) => ticket.epic === state.epic && ticket.num === num && ticket.state === 'work'))
}

/** While stopping, `inWork` from a fresh read; otherwise the state as it is. */
function followWork(state: CycleState, tickets: readonly CycleTicket[]): CycleState {
  return state.stopping ? { ...state, inWork: inWorkOf(state, tickets, state.tickets) } : state
}

/** The graceful Stop: at once where nothing is under way, else `stopping` (worfy-week ticket 18). */
function gracefulStop(state: CycleState, tickets: readonly CycleTicket[]): CycleStep {
  if (state.stopping) return stay(state)
  switch (state.phase) {
    case 'sending': {
      // The Wave is not known until "Run wave" answers: every Ticket of the Epic in work, cut to the Wave then.
      const epicInWork = tickets.filter((ticket) => ticket.epic === state.epic && ticket.state === 'work').map((ticket) => ticket.num)
      return stay({ ...state, stopping: true, inWork: epicInWork })
    }
    case 'turn':
    case 'tasks': {
      const inWork = inWorkOf(state, tickets, state.tickets)
      return { state: { ...state, stopping: true, inWork }, effects: [{ kind: 'stopping', wave: state.wave, tickets: [...state.tickets], inWork: [...inWork] }] }
    }
    default:
      // starting: the Wave has not gone; settling: the Orchestrator's turn is over and no task lives.
      return stop(state, 'user-stop')
  }
}

const stay = (state: CycleState): CycleStep => ({ state, effects: [] })

function stop(state: CycleState, reason: AutopilotStopReason, before: CycleEffect[] = [], tickets?: number[]): CycleStep {
  const stopped: CycleEffect = tickets === undefined ? { kind: 'stopped', reason } : { kind: 'stopped', reason, tickets }
  return { state: { ...state, phase: 'stopped', reason }, effects: [...before, stopped] }
}

function readyNums(state: CycleState, tickets: readonly CycleTicket[]): number[] {
  return readyWave(tickets, state.epic).ready.map((entry) => entry.num)
}

/** Nothing open is ready: `blocked-tickets` with the Tickets that would be, or `no-ready-wave`. */
function nothingReady(state: CycleState, tickets: readonly CycleTicket[], before: CycleEffect[] = []): CycleStep {
  const skipped = readyWave(tickets, state.epic).skipped.map((entry) => entry.num)
  return skipped.length > 0 ? stop(state, 'blocked-tickets', before, skipped) : stop(state, 'no-ready-wave', before)
}

const sameSet = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((num) => b.includes(num))

/** After the Orchestrator's turn: is the Wave finished, and what comes next. */
function evaluate(state: CycleState, tickets: readonly CycleTicket[]): CycleStep {
  // A graceful Stop: nothing is left running, and Tickets still in work are a person's now.
  if (state.stopping) return stop(state, 'user-stop')
  const inWork = state.tickets.filter((num) => tickets.some((ticket) => ticket.epic === state.epic && ticket.num === num && ticket.state === 'work'))
  if (inWork.length > 0) return stay({ ...state, phase: 'settling' })
  const finished: CycleEffect = { kind: 'wave-finished', wave: state.wave, tickets: state.tickets }
  const next = readyNums(state, tickets)
  if (next.length === 0) return nothingReady(state, tickets, [finished])
  if (sameSet(next, state.tickets)) return stop(state, 'no-progress', [finished])
  return { state: { ...state, phase: 'sending' }, effects: [finished, { kind: 'send-wave' }] }
}

/** The next state of a run after one event, and what the run does about it. */
export function step(state: CycleState, event: CycleEvent): CycleStep {
  if (state.phase === 'stopped') return stay(state)
  switch (event.type) {
    case 'stop':
      return event.reason === 'user-force-stop' && state.tickets.length > 0 ? stop(state, event.reason, [], [...state.tickets]) : stop(state, event.reason)
    case 'graceful-stop':
      return gracefulStop(state, event.tickets)
    case 'session-error':
      return stop(state, 'session-error', [{ kind: 'session-error', message: event.message }])
    case 'session-closed':
      return stop(state, 'session-closed')
    case 'start':
      if (state.phase !== 'starting') return stay(state)
      if (resumedTickets(event.tickets, state.epic, event.resume ?? []).length === 0 && readyNums(state, event.tickets).length === 0) return nothingReady(state, event.tickets)
      return { state: { ...state, phase: 'sending' }, effects: [{ kind: 'send-wave' }] }
    case 'wave-sent': {
      if (state.phase !== 'sending') return stay(state)
      const wave = state.wave + 1
      const tickets = [...event.tickets]
      const started: CycleEffect = { kind: 'wave-started', wave, tickets }
      if (!state.stopping) return { state: { ...state, phase: 'turn', wave, tickets }, effects: [started] }
      // Stopped while "Run wave" was on its way: the Wave has gone, so the run says Stop now.
      const inWork = state.inWork.filter((num) => tickets.includes(num))
      return { state: { ...state, phase: 'turn', wave, tickets, inWork }, effects: [started, { kind: 'stopping', wave, tickets: [...tickets], inWork: [...inWork] }] }
    }
    case 'send-failed':
      return state.phase === 'sending' ? stop(state, 'send-failed') : stay(state)
    case 'busy':
      return state.phase === 'settling' || state.phase === 'tasks' ? stay({ ...state, phase: 'turn' }) : stay(state)
    case 'turn-ended':
      if (state.phase !== 'turn' && state.phase !== 'settling' && state.phase !== 'tasks') return stay(state)
      if (event.interrupted) return stop(state, 'interrupted')
      if (event.isError) return stop(state, 'turn-error', [{ kind: 'session-error', message: event.message ?? 'The turn ended with an error' }])
      {
        const next = followWork(state, event.tickets)
        // A turn started since (a task-notification, a queued message): its own result decides.
        if (!event.idle) return stay({ ...next, phase: 'turn' })
        if (event.tasks > 0) return stay({ ...next, phase: 'tasks' })
        return evaluate(next, event.tickets)
      }
    case 'tasks-timeout':
      if (state.phase !== 'tasks') return stay(state)
      return event.tasks > 0 ? stop(state, 'background-stalled') : evaluate(followWork(state, event.tickets), event.tickets)
    case 'workflow':
      if (state.stopping) return state.phase === 'sending' ? stay(state) : stay(followWork(state, event.tickets))
      return state.phase === 'settling' ? evaluate(state, event.tickets) : stay(state)
    case 'settle-timeout':
      return state.phase === 'settling' ? stop(state, 'wave-unfinished') : stay(state)
    case 'workflow-error':
      return stop(state, 'workflow-error')
  }
}
