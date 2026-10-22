// The Family of a Node (worfy-canvas ticket 03, CONTEXT.md): the Node and what is tied to it by a
// Binding and by the Subagent tree. Hovering or selecting a Node of a Family draws the Binding lines
// within the Family (edge-focus.ts) and dims no other Node (worfy-canvas ticket 17); "Show family"
// fits the camera to it (overlays/SelectionToolbar.tsx). Nothing here moves a Node or writes anything.
//
//   Ticket     → it, its Epic frame, the agents bound to it with their Subagents
//   Session    → it, its Subagents, its Browsers, its Ticket and that Ticket's Epic frame (or its Epic frame)
//   Subagent   → its Session's Family, and what the Subagent is bound to itself
//   Browser    → its Session's Family (worfy-browser ticket 06, ADR-0078 item 13), and the Ticket
//                it was opened for with that Ticket's Epic frame (`ticket`, worfy-browser ticket 08)
//   Epic frame → it, its Tickets, the agents bound to the Epic or to its Tickets with their Subagents
//
// "An agent with its Subagents": a bound Session brings its whole Subagent tree; a Subagent bound
// by itself (a wave's implementer) brings only itself and its Session, not its siblings. A bound
// Session also brings the Browsers it opened (`openedBy` of the Browser Node,
// src/main/mcp/browser-server.ts); a Browser the user opened has no `openedBy` and no Family. A
// Browser a Session opened for a Ticket (`ticket` of the Node: in Autopilot the Orchestrator's
// Session opens it for the Ticket its implementer checks) is in that Ticket's Family too, and so in
// its Epic frame's.
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
  /** Each Browser Node a Session opened, with that Session's Node and the Ticket it was opened for. Absent — none. */
  browsers?: readonly { nodeId: string; sessionNodeId: string; ticket?: { epic: string; num: number } | undefined }[]
}

/**
 * BROWSER_KIND of nodes/browser-frame.ts, which this file does not import: the unit tests read this
 * file under Node with a fixed file list (tsconfig.test.node.json), as for FAMILY_ANCHOR_KIND.
 */
const BROWSER_KIND = 'browser'

export const NO_LINKS: FamilyLinks = { epics: [], tickets: [], sessions: [], subagents: [], bindings: [], browsers: [] }

/** FamilyLinks as lookups by Node id, so a Family costs its own size, not the Canvas's. */
interface FamilyIndex {
  /** Epic frame Node id → Epic. */
  epicOfFrame: ReadonlyMap<string, string>
  /** Ticket Node id → its Epic. */
  epicOfTicket: ReadonlyMap<string, string>
  /** Epic → its Ticket Node ids. */
  ticketsOf: ReadonlyMap<string, readonly string[]>
  sessions: ReadonlySet<string>
  /** Subagent Node id → its Session Node id. */
  sessionOf: ReadonlyMap<string, string>
  /** Session Node id → its Subagent Node ids. */
  subagentsOf: ReadonlyMap<string, readonly string[]>
  /** Browser Node id → the Node of the Session that opened it. */
  openerOf: ReadonlyMap<string, string>
  /** Session Node id → the Browser Nodes it opened. */
  browsersOf: ReadonlyMap<string, readonly string[]>
  /** Ticket Node id → the Browser Nodes opened for it. */
  browsersOfTicket: ReadonlyMap<string, readonly string[]>
  /** Browser Node id → the Ticket it was opened for. */
  ticketOfBrowser: ReadonlyMap<string, { epic: string; num: number }>
  /** Epic → the agents bound to it or to one of its Tickets. */
  agentsOfEpic: ReadonlyMap<string, readonly string[]>
  /** Ticket Node id → the agents bound to it. */
  agentsOfTicket: ReadonlyMap<string, readonly string[]>
  /** Agent Node id → what it is bound to. */
  targetsOf: ReadonlyMap<string, readonly BindingTarget[]>
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** One index per links object: the store and the toolbar keep the same object while nothing changed. */
const indexes = new WeakMap<FamilyLinks, FamilyIndex>()

function indexOf(links: FamilyLinks): FamilyIndex {
  const known = indexes.get(links)
  if (known) return known
  const ticketsOf = new Map<string, string[]>()
  const subagentsOf = new Map<string, string[]>()
  const agentsOfEpic = new Map<string, string[]>()
  const agentsOfTicket = new Map<string, string[]>()
  const targetsOf = new Map<string, BindingTarget[]>()
  const browsersOf = new Map<string, string[]>()
  const browsersOfTicket = new Map<string, string[]>()
  const ticketOfBrowser = new Map<string, { epic: string; num: number }>()
  for (const { epic, num } of links.tickets) push(ticketsOf, epic, ticketNodeId(epic, num))
  for (const { nodeId, sessionNodeId, ticket } of links.browsers ?? []) {
    push(browsersOf, sessionNodeId, nodeId)
    if (ticket === undefined) continue
    push(browsersOfTicket, ticketNodeId(ticket.epic, ticket.num), nodeId)
    ticketOfBrowser.set(nodeId, ticket)
  }
  for (const { nodeId, sessionNodeId } of links.subagents) push(subagentsOf, sessionNodeId, nodeId)
  for (const { agentNodeId, target } of links.bindings) {
    push(agentsOfEpic, target.epic, agentNodeId)
    if (target.kind === 'ticket') push(agentsOfTicket, ticketNodeId(target.epic, target.num), agentNodeId)
    push(targetsOf, agentNodeId, target)
  }
  const index: FamilyIndex = {
    epicOfFrame: new Map(links.epics.map((epic) => [epicNodeId(epic), epic])),
    epicOfTicket: new Map(links.tickets.map(({ epic, num }) => [ticketNodeId(epic, num), epic])),
    ticketsOf,
    sessions: new Set(links.sessions),
    sessionOf: new Map(links.subagents.map(({ nodeId, sessionNodeId }) => [nodeId, sessionNodeId])),
    subagentsOf,
    openerOf: new Map((links.browsers ?? []).map(({ nodeId, sessionNodeId }) => [nodeId, sessionNodeId])),
    browsersOf,
    browsersOfTicket,
    ticketOfBrowser,
    agentsOfEpic,
    agentsOfTicket,
    targetsOf,
  }
  indexes.set(links, index)
  return index
}

/** The Family of `nodeId`, the Node included; null when the Node has no relative on the Canvas. */
export function familyOf(nodeId: string, links: FamilyLinks): ReadonlySet<string> | null {
  const index = indexOf(links)
  const family = new Set<string>([nodeId])
  const addSession = (session: string) => {
    family.add(session)
    for (const subagent of index.subagentsOf.get(session) ?? []) family.add(subagent)
    for (const browser of index.browsersOf.get(session) ?? []) family.add(browser)
  }
  /** A bound agent: a Session with its tree, a Subagent with its Session. */
  const addAgent = (agentNodeId: string) => {
    const session = index.sessionOf.get(agentNodeId)
    if (session === undefined) addSession(agentNodeId)
    else family.add(agentNodeId).add(session)
  }
  const addTargets = (agentNodeId: string) => {
    for (const target of index.targetsOf.get(agentNodeId) ?? []) {
      if (target.kind === 'ticket') family.add(ticketNodeId(target.epic, target.num))
      family.add(epicNodeId(target.epic))
    }
  }

  const epic = index.epicOfFrame.get(nodeId)
  const ticketEpic = index.epicOfTicket.get(nodeId)
  if (epic !== undefined) {
    for (const ticket of index.ticketsOf.get(epic) ?? []) {
      family.add(ticket)
      for (const browser of index.browsersOfTicket.get(ticket) ?? []) family.add(browser)
    }
    for (const agent of index.agentsOfEpic.get(epic) ?? []) addAgent(agent)
  } else if (ticketEpic !== undefined) {
    family.add(epicNodeId(ticketEpic))
    for (const agent of index.agentsOfTicket.get(nodeId) ?? []) addAgent(agent)
    for (const browser of index.browsersOfTicket.get(nodeId) ?? []) family.add(browser)
  } else {
    const session = index.sessionOf.get(nodeId) ?? index.openerOf.get(nodeId) ?? (index.sessions.has(nodeId) ? nodeId : undefined)
    if (session === undefined) return null
    addSession(session)
    addTargets(session)
    if (nodeId !== session) addTargets(nodeId)
    const ticket = index.ticketOfBrowser.get(nodeId)
    if (ticket !== undefined) family.add(ticketNodeId(ticket.epic, ticket.num)).add(epicNodeId(ticket.epic))
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
  const links = { epics: [] as string[], tickets: [] as { epic: string; num: number }[], sessions: [] as string[], subagents: [] as { nodeId: string; sessionNodeId: string }[], bindings: [] as { agentNodeId: string; target: BindingTarget }[], browsers: [] as { nodeId: string; sessionNodeId: string; ticket?: { epic: string; num: number } }[] }
  /** The Session Node of each Session, by its id: the first Node that shows it. */
  const sessionNodes = new Map<string, string>()
  const opened: { nodeId: string; sessionId: string; ticket?: { epic: string; num: number } }[] = []
  for (const node of nodes) {
    const data = layoutData(node)
    if (node.type === BROWSER_KIND) {
      const ticket = data.ticket as { epic?: unknown; num?: unknown } | undefined
      const forTicket = typeof ticket?.epic === 'string' && typeof ticket.num === 'number' ? { ticket: { epic: ticket.epic, num: ticket.num } } : {}
      if (typeof data.openedBy === 'string' && data.openedBy !== '') opened.push({ nodeId: node.id, sessionId: data.openedBy, ...forTicket })
    } else if (node.type === EPIC_FRAME_KIND) {
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
      if (!sessionNodes.has(data.sessionId)) sessionNodes.set(data.sessionId, node.id)
    }
  }
  // A Browser whose Session has no Node on the Canvas has no Family.
  for (const { nodeId, sessionId, ticket } of opened) {
    const sessionNodeId = sessionNodes.get(sessionId)
    if (sessionNodeId !== undefined) links.browsers.push({ nodeId, sessionNodeId, ...(ticket === undefined ? {} : { ticket }) })
  }
  return links
}
