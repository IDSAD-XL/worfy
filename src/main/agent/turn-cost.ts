// The cost of every turn worfy runs other than the Assistant's own (worfy-assistant ticket 27), for the Assistant's
// estimate of its share of a Limits window: the usage ledger splits the window's use by what the Assistant's calls
// cost against what every other turn cost (limitsShare, src/shared/assistant/budget.ts). One sink takes it all; the
// app points it at the ledger at its start (src/main/index.ts, ledgerTurnCostSink). Before that, and in a test that
// sets none, nothing is noted anywhere.
//
// Who reports here:
// - every Session of the app's registry (Orchestrator, Session Nodes, Autopilot's Sessions, Product Sessions), through
//   one observer of the registry (turnCostObserver, attached in src/main/agent/app-registry.ts): each `result` as the
//   running total of its conversation, and each new id a Session takes;
// - the requests outside the registry, each one Claude Code process of one turn, through noteOneTurnResult: the
//   one-shots (readOneShot, src/main/vendors/claude/one-shot.ts), the narrator (src/main/vendors/claude/narrator.ts)
//   and Terminal AI (src/main/terminal-ai/assist.ts, whose spare process serves one request and is closed).
// The Assistant's own Session and its checks of sources run outside both, and the ledger's noteCall alone notes them.
//
// Claude Code's `total_cost_usd` is the running total of the conversation: it grows with each turn, and a process that
// resumes the conversation restores it from the transcript (its `cost-state` records) rather than starting from zero.
// So a turn's cost is the rise of that total since the last result of the same conversation (costSinceLast), whichever
// process, Session or start of worfy the last one came in; the ledger keeps the last total of each conversation in its
// file for that. A figure smaller than the last one comes from a process that restored nothing (a fork, a lost
// record) and counts from zero. A Codex Session's result costs 0 (src/main/vendors/codex/session.ts): nothing is noted.
import type { AgentEvent } from '../../shared/agent/events'

/** Where the cost of the turns that are not the Assistant's goes. */
export interface TurnCostSink {
  /** One turn of a process that runs one turn only, at `costUsd`. */
  turn(costUsd: number): void
  /** The latest `result` of conversation `conversationId` reports `totalUsd` so far. */
  conversationTotal(conversationId: string, totalUsd: number): void
  /** A Session's conversation goes on under the id `to` in the same process. */
  renamed(from: string, to: string): void
}

/**
 * The cost of the turn whose `result` reports `total`, after a last total of `last` for the same conversation (none:
 * its first result seen). A smaller figure than the last one comes from a process that restored nothing: from zero.
 */
export function costSinceLast(last: number | undefined, total: number): number {
  return last === undefined || total < last ? total : total - last
}

let sink: TurnCostSink | null = null

/** Where the cost of each other turn goes from now on; null: nowhere. */
export function setTurnCostSink(next: TurnCostSink | null): void {
  sink = next
}

/** Gives the sink one note. A sink that throws (an unwritable ledger) is logged: it never fails the turn that reported. */
function tell(note: (to: TurnCostSink) => void): void {
  if (sink === null) return
  try {
    note(sink)
  } catch (error) {
    console.warn('[agent] the cost of a turn was not noted', error)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A message of a Claude Code process that runs one turn only: its `result` carries the cost of that turn, as the
 * process ran no other. Any other message, and a turn that cost nothing, notes nothing.
 */
export function noteOneTurnResult(message: unknown): void {
  if (!isRecord(message) || message.type !== 'result' || typeof message.total_cost_usd !== 'number') return
  const costUsd = message.total_cost_usd
  if (costUsd > 0) tell((to) => to.turn(costUsd))
}

/** The observer of a SessionRegistry that reports each `result` of its Sessions as its conversation's total. */
export function turnCostObserver(): (sessionId: string, event: AgentEvent) => void {
  return (sessionId, event) => {
    // A Claude Session's id is its conversation's (the SDK session id) from its first init on: `renamed` brings it
    // there before the first result, and again whenever the conversation goes on under a new id.
    if (event.type === 'result' && event.costUsd > 0) tell((to) => to.conversationTotal(sessionId, event.costUsd))
    else if (event.type === 'renamed') tell((to) => to.renamed(event.from, sessionId))
  }
}
