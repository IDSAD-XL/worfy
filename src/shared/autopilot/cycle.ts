// The Autopilot cycle (worfy-daily ticket 04, ADR-0024): from the state of one run and one event to
// the next state and what the run does next. Pure; src/main/autopilot/run.ts feeds it the events of
// the run's Orchestrator Session and fresh reads of the workflow model, and carries out its effects.
//
// A Wave is finished when the Orchestrator's turn ended with a `result` that is neither an error
// nor interrupted, and in a fresh read of the workflow model no Ticket of the Wave is in work. A
// Ticket still in work keeps the run settling: each workflow change checks again, a new turn of the
// Orchestrator waits for its own result, and after SETTLE_MS without either the run stops with
// `wave-unfinished`. After a finished Wave the next ready Wave is sent, unless there is none
// (`no-ready-wave`) or it is the very Wave just finished (`no-progress`).
//
// Waves are counted per run from 1: `wave` is the run's count, not the Wave number of the Epic's
// plan (that one goes into the text the Orchestrator gets, through the Project's template).
import type { Ticket } from '../workflow/types'
import { readyWave } from '../workflow/waves'

/** Why a run ended; the `reason` of its `run-stopped` journal line. */
export const AUTOPILOT_STOP_REASONS = [
  'no-ready-wave',
  'no-progress',
  'wave-unfinished',
  'session-error',
  'turn-error',
  'interrupted',
  'session-closed',
  'send-failed',
  'user-stop',
  'app-quit',
] as const
export type AutopilotStopReason = (typeof AUTOPILOT_STOP_REASONS)[number]

/** How long a run waits after the Orchestrator's turn for the Tickets of the Wave to leave work. */
export const SETTLE_MS = 10 * 60_000

type CycleTicket = Parameters<typeof readyWave>[0][number] & Pick<Ticket, 'state'>

export interface CycleState {
  epic: string
  /**
   * starting: nothing sent yet; sending: "Run wave" is being sent; turn: the Wave is sent and the
   * Orchestrator's turn runs; settling: the turn ended with Tickets of the Wave still in work;
   * stopped: the run is over.
   */
  phase: 'starting' | 'sending' | 'turn' | 'settling' | 'stopped'
  /** The run's count of Waves sent, from 1; 0 before the first. */
  wave: number
  /** Ticket numbers of the current Wave, as it was sent. */
  tickets: number[]
  reason: AutopilotStopReason | null
}

export type CycleEvent =
  /** The run begins; the Tickets of a fresh read of the workflow model. */
  | { type: 'start'; tickets: readonly CycleTicket[] }
  /** "Run wave" went to the Orchestrator for these Tickets. */
  | { type: 'wave-sent'; tickets: number[] }
  /** "Run wave" could not be sent (the template fails, the Orchestrator is gone). */
  | { type: 'send-failed'; message: string }
  /** The Orchestrator started a turn. */
  | { type: 'busy' }
  /** The Orchestrator's turn ended (`result`); the Tickets of a fresh read made after it. */
  | { type: 'turn-ended'; isError: boolean; interrupted: boolean; message: string | null; tickets: readonly CycleTicket[] }
  /** The workflow model changed (`workflow.changed`); the Tickets of a fresh read. */
  | { type: 'workflow'; tickets: readonly CycleTicket[] }
  /** SETTLE_MS passed since the run started settling. */
  | { type: 'settle-timeout' }
  /** The Orchestrator Session went to `error`. */
  | { type: 'session-error'; message: string }
  /** The Orchestrator Session closed. */
  | { type: 'session-closed' }
  /** The user pressed Stop, or the app quits. */
  | { type: 'stop'; reason: 'user-stop' | 'app-quit' }

export type CycleEffect =
  /** Send "Run wave" to the Orchestrator; answer with `wave-sent` or `send-failed`. */
  | { kind: 'send-wave' }
  | { kind: 'wave-started'; wave: number; tickets: number[] }
  | { kind: 'wave-finished'; wave: number; tickets: number[] }
  /** The Session failed or its turn ended with an error. */
  | { kind: 'session-error'; message: string }
  /** The run is over: release keep-awake, give the Orchestrator back, write `run-stopped`. */
  | { kind: 'stopped'; reason: AutopilotStopReason }

export interface CycleStep {
  state: CycleState
  effects: CycleEffect[]
}

export function initialCycle(epic: string): CycleState {
  return { epic, phase: 'starting', wave: 0, tickets: [], reason: null }
}

const stay = (state: CycleState): CycleStep => ({ state, effects: [] })

function stop(state: CycleState, reason: AutopilotStopReason, before: CycleEffect[] = []): CycleStep {
  return { state: { ...state, phase: 'stopped', reason }, effects: [...before, { kind: 'stopped', reason }] }
}

function readyNums(state: CycleState, tickets: readonly CycleTicket[]): number[] {
  return readyWave(tickets, state.epic).ready.map((entry) => entry.num)
}

const sameSet = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((num) => b.includes(num))

/** After the Orchestrator's turn: is the Wave finished, and what comes next. */
function evaluate(state: CycleState, tickets: readonly CycleTicket[]): CycleStep {
  const inWork = state.tickets.filter((num) => tickets.some((ticket) => ticket.epic === state.epic && ticket.num === num && ticket.state === 'work'))
  if (inWork.length > 0) return stay({ ...state, phase: 'settling' })
  const finished: CycleEffect = { kind: 'wave-finished', wave: state.wave, tickets: state.tickets }
  const next = readyNums(state, tickets)
  if (next.length === 0) return stop(state, 'no-ready-wave', [finished])
  if (sameSet(next, state.tickets)) return stop(state, 'no-progress', [finished])
  return { state: { ...state, phase: 'sending' }, effects: [finished, { kind: 'send-wave' }] }
}

/** The next state of a run after one event, and what the run does about it. */
export function step(state: CycleState, event: CycleEvent): CycleStep {
  if (state.phase === 'stopped') return stay(state)
  switch (event.type) {
    case 'stop':
      return stop(state, event.reason)
    case 'session-error':
      return stop(state, 'session-error', [{ kind: 'session-error', message: event.message }])
    case 'session-closed':
      return stop(state, 'session-closed')
    case 'start':
      if (state.phase !== 'starting') return stay(state)
      if (readyNums(state, event.tickets).length === 0) return stop(state, 'no-ready-wave')
      return { state: { ...state, phase: 'sending' }, effects: [{ kind: 'send-wave' }] }
    case 'wave-sent': {
      if (state.phase !== 'sending') return stay(state)
      const wave = state.wave + 1
      const tickets = [...event.tickets]
      return { state: { ...state, phase: 'turn', wave, tickets }, effects: [{ kind: 'wave-started', wave, tickets }] }
    }
    case 'send-failed':
      return state.phase === 'sending' ? stop(state, 'send-failed') : stay(state)
    case 'busy':
      return state.phase === 'settling' ? stay({ ...state, phase: 'turn' }) : stay(state)
    case 'turn-ended':
      if (state.phase !== 'turn' && state.phase !== 'settling') return stay(state)
      if (event.interrupted) return stop(state, 'interrupted')
      if (event.isError) return stop(state, 'turn-error', [{ kind: 'session-error', message: event.message ?? 'The turn ended with an error' }])
      return evaluate(state, event.tickets)
    case 'workflow':
      return state.phase === 'settling' ? evaluate(state, event.tickets) : stay(state)
    case 'settle-timeout':
      return state.phase === 'settling' ? stop(state, 'wave-unfinished') : stay(state)
  }
}
