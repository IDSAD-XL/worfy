// Unknown side effects (worfy-continuity ticket 16): the calls that reached, or may have reached, outside a Session
// cut off by a restart of worfy and that have no result — a `git push` or a `gh pr merge` that may or may not have
// run. Found for the Session itself and for each of its Interrupted Subagents (ADR-0085), each Subagent with the
// Ticket of its Binding, so the continuation after a restart (tickets 05 and 06) leaves those Tickets to a person.
//
// One rule with Auto-continue's `in-flight` refusal (continue-plan.ts, retryDecision): externalActions classifies
// the calls — no second copy of the classification here — and a call without its `tool_result` is in flight. A
// script (`node <file>`) reads as local there and so stays unseen here too (spec, risk 9).
//
// Pure and read-only: it decides nothing (continue or not is tickets 05 and 06, the mark and the toast ticket 07)
// and writes nothing. The caller reads the files: the Session's record in `live-sessions.json` (ticket 03), the
// events of its own thread, and the lines of each Interrupted Subagent's own transcript.
import type { AgentEvent } from './events'
import { externalActions, type ExternalAction } from './continue-plan'
import type { LiveSession } from './live-sessions'
import { resolveBinding, type BindingTarget, type BindingWorkflow, type TicketRef } from '../binding/resolve'
import { emptySignalState, extendSignals } from '../binding/signals'
import { parseTranscriptLines } from '../transcript/parse'

/** A Subagent of the Session that ended with an earlier process of it (status `interrupted`, ADR-0085). */
export interface InterruptedSubagent {
  agentId: string
  /**
   * The lines of its own transcript (`subagents/agent-<agentId>.jsonl`, or the file of a workflow script's agent)
   * in file order. The last one may be torn: a line that is not JSON is skipped.
   */
  lines: readonly string[]
  /** Its manual Binding from `bindings.json`, when the user dropped it on a Ticket or an Epic. */
  manual?: BindingTarget | null | undefined
  /** What worfy started it for, from `bindings.json`. */
  launch?: BindingTarget | null | undefined
}

export interface UnknownSideEffectsInput {
  /** The Session's record in `live-sessions.json`. */
  session: LiveSession
  /**
   * The events of the Session's own thread: from its transcript (for Claude Code, mainThreadEvents of its lines)
   * or its Vendor's history. Every call here without a result counts; pass the turn that was cut off to leave
   * older turns out.
   */
  events: readonly AgentEvent[]
  /** Its Interrupted Subagents, nested ones included, each with its own transcript. */
  subagents: readonly InterruptedSubagent[]
  /** What the workflow model says, for the Bindings; undefined while there is none. */
  workflow: BindingWorkflow | undefined
}

/** The calls of one Interrupted Subagent without a result, and the Ticket it is bound to. */
export interface SubagentSideEffects {
  agentId: string
  /** The Ticket of its Binding; null when it has no Binding or is bound to an Epic. */
  ticket: TicketRef | null
  calls: ExternalAction[]
}

export interface UnknownSideEffects {
  /** The Session's Node, from its record. */
  nodeId: string
  /** The Session's own calls without a result, in call order. */
  session: ExternalAction[]
  /** The Interrupted Subagents that have such calls, in the order given; one without any is left out. */
  subagents: SubagentSideEffects[]
}

/** The external and unclassified calls without a result of the Session and of each of its Interrupted Subagents. */
export function unknownSideEffects({ session, events, subagents, workflow }: UnknownSideEffectsInput): UnknownSideEffects {
  const found: SubagentSideEffects[] = []
  for (const subagent of subagents) {
    const calls = inFlight(subagentEvents(subagent.lines))
    if (calls.length > 0) found.push({ agentId: subagent.agentId, ticket: ticketOf(subagent, workflow), calls })
  }
  return { nodeId: session.nodeId, session: inFlight(events), subagents: found }
}

/** The calls externalActions reports that have no result: the ones retryDecision refuses as `in-flight`. */
function inFlight(events: readonly AgentEvent[]): ExternalAction[] {
  return externalActions(events).filter((action) => !action.done)
}

/**
 * The events of a Subagent's own transcript. Every record there is the Subagent's (`isSidechain`), so none is
 * dropped as the Session's reader drops a Subagent's records (mainThreadEvents); its calls carry no
 * `parentToolUseId`, so externalActions counts them as its own.
 */
function subagentEvents(lines: readonly string[]): AgentEvent[] {
  return parseTranscriptLines(lines).map((entry) => entry.event)
}

/** The Ticket of the Subagent's Binding, resolved the way the renderer resolves it (src/renderer/binding/store.ts). */
function ticketOf(subagent: InterruptedSubagent, workflow: BindingWorkflow | undefined): TicketRef | null {
  const signals = extendSignals(emptySignalState(), subagent.lines, { subagent: true }).signals
  const binding = resolveBinding({ manual: subagent.manual, launch: subagent.launch, signals, subagent: true }, workflow)
  return binding?.target.kind === 'ticket' ? { epic: binding.target.epic, num: binding.target.num } : null
}
