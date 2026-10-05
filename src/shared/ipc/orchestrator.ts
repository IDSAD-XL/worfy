// The `orchestrator` domain: the one main Session of each Project (CONTEXT.md, «Оркестратор»)
// and its Node on the Canvas. Run by src/main/agent/orchestrator.ts, handled in
// src/main/ipc/orchestrator.ts (ADR-0006).
//
// What the Node shows lives in the Node's `data` in the Layout, written by main only (ADR-0003):
// the renderer reads it like any other Layout change, and the SDK session id kept there is what
// the Session resumes after a restart. The Session's events also go to every window on
// `agent.event`, and the `agent.*` channels take its Session id like any other.
import { z } from 'zod'
import { sessionState } from '../agent/events'
import { invokeChannel } from './channels'

/** The `kind` of the Orchestrator's Node in the Layout. */
export const ORCHESTRATOR_KIND = 'orchestrator'

/** The `data` of the Orchestrator's Node, as main writes it. Every key may be missing in an older file. */
export const orchestratorDataSchema = z.object({
  /** The SDK session id, once Claude Code has reported it; the Session resumes it after a restart. */
  sessionId: z.string().min(1).optional(),
  state: sessionState.optional(),
  /** Why the Session is in `error`. */
  error: z.string().nullable().optional(),
  /** The model of the last turn, from system/init. */
  model: z.string().nullable().optional(),
  /** What the Session has cost so far, over every Claude Code process that ran it, in USD. */
  costUsd: z.number().nonnegative().optional(),
  /** The last status block (src/shared/agent/status-block.ts), verbatim; null until there is one. */
  statusBlock: z.string().nullable().optional(),
})
export type OrchestratorData = z.output<typeof orchestratorDataSchema>

/**
 * The Orchestrator fields of a Node's data that pass the schema. A damaged field is dropped
 * rather than the whole object, so a bad cost never costs the saved session id.
 */
export function readOrchestratorData(data: Record<string, unknown>): OrchestratorData {
  const read: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(orchestratorDataSchema.shape)) {
    const parsed = schema.safeParse(data[key])
    if (parsed.success && parsed.data !== undefined) read[key] = parsed.data
  }
  return read as OrchestratorData
}

const projectId = z.string().min(1)

export const orchestratorInfoSchema = z.object({
  projectId,
  /** The Orchestrator's Node in the Project's Layout. */
  nodeId: z.string().min(1),
  /** The live Session's id for the `agent.*` channels: temporary until Claude Code reports its own. */
  sessionId: z.string().min(1),
  state: sessionState,
})
export type OrchestratorInfo = z.output<typeof orchestratorInfoSchema>

/**
 * Makes sure the Project has its Orchestrator Node and a live Session behind it, and answers
 * both. Main also does this by itself whenever a Project becomes active; calling it again for a
 * running Orchestrator changes nothing.
 */
export const orchestratorOpen = invokeChannel('orchestrator.open', z.object({ projectId }), orchestratorInfoSchema)

declare module './channels' {
  interface IpcContract {
    'orchestrator.open': typeof orchestratorOpen
  }
}
