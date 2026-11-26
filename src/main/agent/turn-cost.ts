// The cost of every turn worfy runs other than the Assistant's own (worfy-assistant ticket 27), for the Assistant's
// estimate of its share of a Limits window: the usage ledger splits the window's use by what the Assistant's calls
// cost against what every other turn cost (limitsShare, src/shared/assistant/budget.ts). One sink takes every such
// cost; the app points it at the ledger's noteOtherTurn at its start (src/main/index.ts). Before that, and in a test
// that sets none, nothing is noted anywhere.
//
// Who reports here, each turn once:
// - every Session of the app's registry (Orchestrator, Session Nodes, Autopilot's Sessions, Product Sessions), through
//   one observer of the registry (turnCostObserver, attached in src/main/agent/app-registry.ts);
// - the requests outside the registry, each one Claude Code process of one turn, through noteOneTurnResult: the
//   one-shots (readOneShot, src/main/vendors/claude/one-shot.ts), the narrator (src/main/vendors/claude/narrator.ts)
//   and Terminal AI (src/main/terminal-ai/assist.ts, whose spare process serves one request and is closed).
// The Assistant's own Session and its checks of sources run outside both, and the ledger's noteCall alone notes them.
//
// Claude Code's `total_cost_usd` grows with each turn of one process and starts from zero in a new one (CostCounter,
// src/main/agent/orchestrator.ts). So the observer notes the difference from the last `result` of the same Session's
// process. A Session reports `starting` before each new process it starts and `error` when its process dies, and the
// observer forgets the last figure then; a figure smaller than the last one also counts from zero, as in CostCounter.
// A Codex Session's result costs 0 (src/main/vendors/codex/session.ts): nothing is noted for it.
import type { AgentEvent } from '../../shared/agent/events'

/** Takes the cost in USD of one turn that is not the Assistant's. */
export type TurnCostSink = (costUsd: number) => void

let sink: TurnCostSink | null = null

/** Where the cost of each other turn goes from now on; null: nowhere. */
export function setTurnCostSink(next: TurnCostSink | null): void {
  sink = next
}

/** One turn cost `costUsd`. A sink that throws (an unwritable ledger) is logged: it never fails the turn that reported. */
export function noteTurnCost(costUsd: number): void {
  if (sink === null || !(costUsd > 0)) return
  try {
    sink(costUsd)
  } catch (error) {
    console.warn('[agent] the cost of a turn was not noted', error)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A message of a Claude Code process that runs one turn only: its `result` carries the cost of that turn, as the
 * process ran no other. Any other message notes nothing.
 */
export function noteOneTurnResult(message: unknown): void {
  if (!isRecord(message) || message.type !== 'result' || typeof message.total_cost_usd !== 'number') return
  noteTurnCost(message.total_cost_usd)
}

/** The observer of a SessionRegistry that notes the cost of each turn of each of its Sessions once, to `note`. */
export function turnCostObserver(note: TurnCostSink = noteTurnCost): (sessionId: string, event: AgentEvent) => void {
  // The last `result` figure of each Session's current process.
  const last = new Map<string, number>()
  return (sessionId, event) => {
    switch (event.type) {
      case 'result': {
        const before = last.get(sessionId) ?? 0
        // A smaller figure than the last one can only come from a new process, which counts from zero.
        const turn = event.costUsd < before ? event.costUsd : event.costUsd - before
        last.set(sessionId, event.costUsd)
        if (turn > 0) note(turn)
        break
      }
      case 'renamed': {
        // The Session goes on under its Vendor session's id, in the same process.
        const before = last.get(event.from)
        last.delete(event.from)
        if (before !== undefined) last.set(sessionId, before)
        break
      }
      case 'state':
        // A new process starts (`starting`), or the process is gone: the next result counts from zero.
        if (event.state === 'starting' || event.state === 'error' || event.state === 'closed') last.delete(sessionId)
        break
      default:
        break
    }
  }
}
