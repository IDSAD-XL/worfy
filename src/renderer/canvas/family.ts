// The Family of a Node (worfy-canvas ticket 03, CONTEXT.md): the Node and what is tied to it by a
// Binding and by the Subagent tree. Hovering or selecting a Node of a Family keeps the Family bright
// and dims the other Nodes (edge-focus.ts, NodeChrome.tsx); "Show family" fits the camera to it
// (overlays/SelectionToolbar.tsx). Nothing here moves a Node or writes anything.
//
//   Ticket     → it, its Epic frame, the agents bound to it with their Subagents
//   Session    → it, its Subagents, its Ticket and that Ticket's Epic frame (or its Epic frame)
//   Subagent   → its Session's Family, and what the Subagent is bound to itself
//   Epic frame → it, its Tickets, the agents bound to the Epic or to its Tickets with their Subagents
//
// "An agent with its Subagents": a bound Session brings its whole Subagent tree; a Subagent bound
// by itself (a wave's implementer) brings only itself and its Session, not its siblings.
import type { BindingTarget } from '../../shared/binding/resolve'
import { EPIC_FRAME_KIND, epicNodeId, SOURCE_NODE_KINDS, SUBAGENT_KIND, TICKET_KIND, ticketNodeId } from '../../shared/layout/derived'

/**
 * BINDING_ANCHOR_KIND of sources/workflow-bindings.ts, which this file does not import: that module
 * brings React and the renderer's stores, and the unit tests read this file under Node
 * (tsconfig.test.node.json). test/unit/edge-focus.test.tsx checks the two are equal.
 */
export const FAMILY_ANCHOR_KIND = 'binding-anchor'

/** What the Canvas shows now that a Family is made of. */
export interface FamilyLinks {
  /** The Epics with a frame. */
  epics: readonly string[]
  /** The Tickets with a Node. */
  tickets: readonly { epic: string; num: number }[]
  /** The Session Nodes (the Orchestrator's too). */
  sessions: readonly string[]
  /** Each Subagent Node with the Session Node it hangs from (sources/subagents.ts). */
  subagents: readonly { nodeId: string; sessionNodeId: string }[]
  /** Each bound agent's Node — a Session's or a Subagent's — with what it is bound to. */
  bindings: readonly { agentNodeId: string; target: BindingTarget }[]
}

export const NO_LINKS: FamilyLinks = { epics: [], tickets: [], sessions: [], subagents: [], bindings: [] }

/** The Family of `nodeId`, the Node included; null when the Node has no relative on the Canvas. */
export function familyOf(nodeId: string, links: FamilyLinks): ReadonlySet<string> | null {
  const sessionOf = new Map(links.subagents.map(({ nodeId: id, sessionNodeId }) => [id, sessionNodeId]))
  const family = new Set<string>([nodeId])
  const addSession = (session: string) => {
    family.add(session)
    for (const subagent of links.subagents) if (subagent.sessionNodeId === session) family.add(subagent.nodeId)
  }
  /** A bound agent: a Session with its tree, a Subagent with its Session. */
  const addAgent = (agentNodeId: string) => {
    const session = sessionOf.get(agentNodeId)
    if (session === undefined) addSession(agentNodeId)
    else family.add(agentNodeId).add(session)
  }
  const addTarget = (target: BindingTarget) => {
    if (target.kind === 'ticket') family.add(ticketNodeId(target.epic, target.num))
    family.add(epicNodeId(target.epic))
  }

  const epic = links.epics.find((name) => epicNodeId(name) === nodeId)
  const ticket = links.tickets.find(({ epic: name, num }) => ticketNodeId(name, num) === nodeId)
  if (epic !== undefined) {
    for (const each of links.tickets) if (each.epic === epic) family.add(ticketNodeId(each.epic, each.num))
    for (const { agentNodeId, target } of links.bindings) if (target.epic === epic) addAgent(agentNodeId)
  } else if (ticket !== undefined) {
    family.add(epicNodeId(ticket.epic))
    for (const { agentNodeId, target } of links.bindings) if (target.kind === 'ticket' && target.epic === ticket.epic && target.num === ticket.num) addAgent(agentNodeId)
  } else {
    const session = sessionOf.get(nodeId) ?? (links.sessions.includes(nodeId) ? nodeId : undefined)
    if (session === undefined) return null
    addSession(session)
    for (const { agentNodeId, target } of links.bindings) if (agentNodeId === session || agentNodeId === nodeId) addTarget(target)
  }
  return family.size > 1 ? family : null
}

/** A React Flow Node as far as familyLinksOf reads it: the Layout entry the Canvas keeps in `data.node`. */
interface FlowNodeLike {
  id: string
  type?: string | undefined
  data: unknown
}

const layoutData = (node: FlowNodeLike): Record<string, unknown> => {
  const data = (node.data as { node?: { data?: unknown } } | undefined)?.node?.data
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
}

/** The links of a Family, read from the Nodes React Flow has now (a Node of each source carries its facts in `data.node.data`). */
export function familyLinksOf(nodes: Iterable<FlowNodeLike>): FamilyLinks {
  const links = { epics: [] as string[], tickets: [] as { epic: string; num: number }[], sessions: [] as string[], subagents: [] as { nodeId: string; sessionNodeId: string }[], bindings: [] as { agentNodeId: string; target: BindingTarget }[] }
  for (const node of nodes) {
    const data = layoutData(node)
    if (node.type === EPIC_FRAME_KIND) {
      const epic = (data.epic as { epic?: unknown } | undefined)?.epic
      if (typeof epic === 'string') links.epics.push(epic)
    } else if (node.type === TICKET_KIND) {
      const ticket = data.ticket as { epic?: unknown; num?: unknown } | undefined
      if (typeof ticket?.epic === 'string' && typeof ticket.num === 'number') links.tickets.push({ epic: ticket.epic, num: ticket.num })
    } else if (node.type === SUBAGENT_KIND) {
      if (typeof data.sessionNodeId === 'string') links.subagents.push({ nodeId: node.id, sessionNodeId: data.sessionNodeId })
    } else if (node.type === FAMILY_ANCHOR_KIND) {
      const target = (data.binding as { target?: BindingTarget } | undefined)?.target
      if (data.variant === 'agent' && typeof data.agentNodeId === 'string' && target !== undefined) links.bindings.push({ agentNodeId: data.agentNodeId, target })
    } else if (typeof data.sessionId === 'string' && data.sessionId !== '' && !SOURCE_NODE_KINDS.includes(node.type ?? '')) {
      links.sessions.push(node.id)
    }
  }
  return links
}
