// The list «To» of the Changes screen (worfy-changes-view ticket 05; the spec's part on comments on lines): the Sessions the
// comments on lines of a Ticket's diff may go to, and the one they go to unless the user picks another.
//
// - A Session Node of worfy bound to the Ticket, by a stored Binding — manual, or the launch one "Ship ticket" wrote —
//   not in the Archive, with a session id: the choice ActionLauncher.ticketSession makes for the actions on a PR
//   (src/main/actions/launch.ts), without its limit of 24 hours (a comment is the user's own message, and the Session
//   resumes by its transcript when it runs no more) and of any Vendor (the actions on a PR send a Claude Code skill; a
//   comment is plain text that any agent takes).
// - The Project's Orchestrator, when the Layout has its Node: Wave implementers are its Subagents, and a message
//   cannot reach them (spec, Q2).
// - The default (Q2): the bound Session whose transcript's last record is the newest; without one, the Orchestrator.
//
// Reading only: the Layout, the stored Bindings, the transcripts' times and the live Sessions; nothing is started.
import type { BindingTarget } from '../../shared/binding/resolve'
import { isLaunchBinding, type ManualBinding } from '../../shared/ipc/bindings'
import { ORCHESTRATOR_KIND, readOrchestratorData } from '../../shared/ipc/orchestrator'
import { SESSION_NODE_KIND } from '../../shared/ipc/sessions'
import { isArchived, type LayoutNode } from '../../shared/layout/types'

/** A Session the comments may go to; `changesTargetSchema` of src/shared/ipc/changes.ts. */
export interface ChangesTarget {
  kind: 'session' | 'orchestrator'
  nodeId: string
  /** The Session's comments are kept under it (quoteKey); null when the Node has none yet. */
  sessionId: string | null
  title: string
  lastAt: number | null
}

export interface ChangesTargets {
  targets: ChangesTarget[]
  defaultNodeId: string | null
  autopilot: boolean
}

/** What the list reads of the app. */
export interface TargetsDeps {
  /** The Project's Layout Nodes. */
  nodes(projectId: string): readonly LayoutNode[]
  /** The Project's stored Bindings (bindings.json): manual ones and launch ones. */
  stored(projectId: string): readonly ManualBinding[]
  /** The time of the last record of each of these Sessions' transcripts, in ms; a Session without one is absent. */
  lastAt(projectId: string, sessionIds: readonly string[]): Promise<ReadonlyMap<string, number>>
  /**
   * The id the Session behind the Node runs under now, once its agent reported it (not a temporary `pending-…` one);
   * null when none runs. Its Session view keeps the comments under this id while it runs.
   */
  live(projectId: string, nodeId: string): string | null
  /** Autopilot runs in the Project now. */
  autopilot(projectId: string): boolean
}

/** The Ticket the comments are on. */
export interface TargetTicket {
  epic: string
  num: number
}

/** The stored Binding target of each Session: a manual Binding over a launch one, as the actions on a PR read them. */
function storedTargets(stored: readonly ManualBinding[]): Map<string, BindingTarget> {
  const sessions = stored.filter((binding) => (binding.agentId ?? null) === null)
  return new Map([...sessions.filter(isLaunchBinding), ...sessions.filter((binding) => !isLaunchBinding(binding))].map((binding) => [binding.sessionId, binding.target]))
}

const SHORT_ID = 8

/** The Session Nodes of worfy bound to the Ticket, not archived, each with the session id its Binding is stored under. */
export function boundSessions(nodes: readonly LayoutNode[], stored: readonly ManualBinding[], ticket: TargetTicket): { nodeId: string; sessionId: string }[] {
  const targets = storedTargets(stored)
  return nodes.flatMap((node) => {
    if (node.kind !== SESSION_NODE_KIND || node.data.origin !== 'worfy' || isArchived(node)) return []
    const sessionId = node.data.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') return []
    const target = targets.get(sessionId)
    if (target?.kind !== 'ticket' || target.epic !== ticket.epic || target.num !== ticket.num) return []
    return [{ nodeId: node.id, sessionId }]
  })
}

/** The Node the comments go to by default (Q2): the bound Session with the newest record, else the Orchestrator. */
export function defaultTarget(targets: readonly ChangesTarget[]): string | null {
  const sessions = targets.filter((each) => each.kind === 'session')
  if (sessions.length > 0) return [...sessions].sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1))[0]!.nodeId
  return targets.find((each) => each.kind === 'orchestrator')?.nodeId ?? null
}

/** The list «To» for the Ticket in the Project. */
export async function changesTargets(deps: TargetsDeps, projectId: string, ticket: TargetTicket): Promise<ChangesTargets> {
  const nodes = deps.nodes(projectId)
  const bound = boundSessions(nodes, deps.stored(projectId), ticket)
  const lastAt = bound.length === 0 ? new Map<string, number>() : await deps.lastAt(projectId, bound.map((each) => each.sessionId))
  const sessions: ChangesTarget[] = bound.map(({ nodeId, sessionId }) => ({
    kind: 'session',
    nodeId,
    sessionId: deps.live(projectId, nodeId) ?? sessionId,
    title: `Session ${sessionId.slice(0, SHORT_ID)}`,
    lastAt: lastAt.get(sessionId) ?? null,
  }))
  sessions.sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1))
  const orchestrator = nodes.find((node) => node.kind === ORCHESTRATOR_KIND && !isArchived(node))
  const targets = [...sessions]
  if (orchestrator !== undefined) {
    const saved = readOrchestratorData(orchestrator.data).sessionId ?? null
    targets.push({ kind: 'orchestrator', nodeId: orchestrator.id, sessionId: deps.live(projectId, orchestrator.id) ?? saved, title: 'Orchestrator', lastAt: null })
  }
  return { targets, defaultNodeId: defaultTarget(targets), autopilot: deps.autopilot(projectId) }
}
