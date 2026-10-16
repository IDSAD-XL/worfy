// The `orchestrator` domain: the one main Session of each Project (CONTEXT.md, «Оркестратор»)
// and its Node on the Canvas. Run by src/main/agent/orchestrator.ts, handled in
// src/main/ipc/orchestrator.ts (ADR-0006).
//
// The Node's `data` in the Layout keeps only what nothing else records (ADR-0010): the SDK session
// id the Session resumes after a restart and the cost summed over the Claude Code processes that
// ran it. The model, effort and permission mode the user picked (ticket 19) are kept outside the
// Layout, in src/main/agent/session-settings.ts.
// The rest of what the Node shows is not stored by worfy (ADR 0002, ADR 0005): the model and the
// last status block are read from the Session's transcript when the Orchestrator opens and then
// follow the live Session; the state is the live Session's. main keeps that view in memory and
// sends it on `orchestrator.changed`. The Session's events also go to every window on
// `agent.event`, and the `agent.*` channels take its Session id like any other.
import { z } from 'zod'
import { sessionState } from '../agent/events'
import { eventChannel, invokeChannel } from './channels'

/** The `kind` of the Orchestrator's Node in the Layout. */
export const ORCHESTRATOR_KIND = 'orchestrator'
/** Size of a new Orchestrator Node. */
export const ORCHESTRATOR_WIDTH = 360
export const ORCHESTRATOR_HEIGHT = 200

/** The `data` of the Orchestrator's Node, as main writes it. Every key may be missing in an older file. */
export const orchestratorDataSchema = z.object({
  /**
   * The SDK session id, once Claude Code has reported it; the Session resumes it after a restart.
   * null: the saved one could not be resumed (its transcript is gone), so the next start is new.
   */
  sessionId: z.string().min(1).nullable().optional(),
  /** What the Session has cost so far, over every Claude Code process that ran it, in USD. */
  costUsd: z.number().nonnegative().optional(),
})
export type OrchestratorData = z.output<typeof orchestratorDataSchema>

/**
 * The Orchestrator fields of a Node's data that pass the schema. A damaged field is dropped
 * rather than the whole object, so a bad cost never costs the saved session id. Keys that are
 * not in the schema are not returned.
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
const nodeId = z.string().min(1)

/** What the Orchestrator's Node shows, as main has it now. */
export const orchestratorViewSchema = z.object({
  projectId,
  /** The Orchestrator's Node in the Project's Layout. */
  nodeId,
  /**
   * The live Session's id for the `agent.*` channels: temporary until Claude Code reports its own.
   * null while no Session runs yet.
   */
  sessionId: z.string().min(1).nullable(),
  state: sessionState,
  /** Why the Session is in `error`. */
  error: z.string().nullable(),
  /** The model of the Orchestrator's last answer: from the transcript, then from system/init. */
  model: z.string().nullable(),
  /** What the Session has cost so far, in USD. */
  costUsd: z.number().nonnegative(),
  /** The last status block (src/shared/agent/status-block.ts), verbatim; null until there is one. */
  statusBlock: z.string().nullable(),
  /** Grows with every change of any view in this run of the app: of two views, the larger is newer. */
  version: z.number().int().nonnegative(),
})
export type OrchestratorView = z.output<typeof orchestratorViewSchema>

/**
 * Makes sure the Project has its Orchestrator Node and a live Session behind it, and answers its
 * view. Main also does this by itself whenever a Project becomes active; calling it again for a
 * running Orchestrator changes nothing.
 */
export const orchestratorOpen = invokeChannel('orchestrator.open', z.object({ projectId }), orchestratorViewSchema, 'project', 'write')

/** The view of the Orchestrator behind a Node; null when main has none for it (yet). Starts nothing. */
export const orchestratorView = invokeChannel('orchestrator.view', z.object({ nodeId }), z.object({ view: orchestratorViewSchema.nullable() }), 'project', 'read')

/**
 * "New conversation": the Orchestrator's current Session goes to the history and a new one becomes
 * the Project's Orchestrator. Refused while a turn runs. Answers the new view.
 */
export const orchestratorNewConversation = invokeChannel('orchestrator.newConversation', z.object({ projectId }), orchestratorViewSchema, 'project', 'write')

/** A view changed; sent to every window. */
export const orchestratorChanged = eventChannel('orchestrator.changed', orchestratorViewSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'orchestrator.open': typeof orchestratorOpen
    'orchestrator.view': typeof orchestratorView
    'orchestrator.newConversation': typeof orchestratorNewConversation
    'orchestrator.changed': typeof orchestratorChanged
  }
}
