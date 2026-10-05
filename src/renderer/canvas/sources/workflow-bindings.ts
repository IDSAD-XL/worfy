// The Bindings of the agents on the Canvas (ticket 16) as invisible anchor Nodes, between which
// edges/bindings.ts draws a dashed line from each bound agent to its Ticket or to its Epic's frame.
// Neither a Session Node nor an Epic frame has a handle of its own, and a Ticket's handles face the
// blocking arrows, so the lines start and end at anchors — the way the Subagent tree's lines start
// at the Session's anchor (sources/subagents.ts):
//
//   binding-anchor:<agent Node id>        child of a bound Session's (or the Orchestrator's) or
//                                         Subagent's Node, at its left edge; carries the Binding
//                                         and the id of the anchor the line ends at
//   binding-anchor:ticket:<epic>/<NN>     child of a Ticket, at its right edge
//   binding-anchor:epic:<epic>            child of an Epic's frame, at its top edge: a line to an
//                                         Epic ends here, and so does one to a Ticket the frame
//                                         hides (a folded done stack, a collapsed frame)
//
// None of these Nodes is a Layout Node: they are computed from the manual Bindings, the signals in
// the transcripts and the workflow model (binding/store.ts). React Flow needs a parent before its
// children, and node sources are drawn in the order of their file names: this file's name sorts
// after epics.ts and subagents.ts, whose Nodes these anchors hang from.
import { useMemo } from 'react'
import { useStore } from '@xyflow/react'
import { bindingWorkflowOf, type Binding } from '../../../shared/binding/resolve'
import { agentKey } from '../../../shared/ipc/bindings'
import { epicNodeId, SOURCE_NODE_KINDS, SUBAGENT_KIND, ticketNodeId } from '../../../shared/layout/derived'
import type { Layout, LayoutNode } from '../../../shared/layout/types'
import { resolveAgentBindings, useManualBindings, useSessionSignals } from '../../binding/store'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { TICKET_WIDTH } from '../epic-layout'
import type { NodeSource, NodeSourceContext } from '../extensions'
import type { CanvasFlowNode } from '../nodes'

export const BINDING_ANCHOR_KIND = 'binding-anchor'
/** Where on an agent's Node, and on a Ticket's right edge, a line starts or ends (their header row). */
const SESSION_ANCHOR_Y = 18
const SUBAGENT_ANCHOR_Y = 13
const TICKET_ANCHOR_Y = 18
/** Where on a frame's top edge a line ends. */
const EPIC_ANCHOR_X = 24

export const agentAnchorId = (agentNodeId: string): string => `binding-anchor:${agentNodeId}`
export const ticketAnchorId = (epic: string, num: number): string => `binding-anchor:ticket:${epic}/${num}`
export const epicAnchorId = (epic: string): string => `binding-anchor:epic:${epic}`

/** What an anchor carries in `data.node.data`. */
export type BindingAnchorData =
  | {
      [key: string]: unknown
      /** A line starts here: at a bound agent's Node. */
      variant: 'agent'
      projectId: string
      sessionId: string
      /** Null for the Session itself. */
      agentId: string | null
      agentNodeId: string
      binding: Binding
      /** The anchor the line ends at: on the Ticket, or on its Epic's frame when the frame hides the Ticket. */
      targetId: string
    }
  | { [key: string]: unknown; variant: 'ticket'; projectId: string; epic: string; num: number }
  | { [key: string]: unknown; variant: 'epic'; projectId: string; epic: string }

/** Layout Nodes that show a Session and can be bound: on the plane (not pinned or hidden), naming a Session; one per Session. */
export function agentNodes(layout: Layout): LayoutNode[] {
  const seen = new Set<string>()
  return layout.nodes.filter((node) => {
    const sessionId = node.data.sessionId
    if (typeof sessionId !== 'string' || sessionId === '' || node.hidden || node.pinned || SOURCE_NODE_KINDS.includes(node.kind) || seen.has(sessionId)) return false
    seen.add(sessionId)
    return true
  })
}

/** A Subagent's Node on the Canvas (sources/subagents.ts). */
export interface PresentSubagent {
  nodeId: string
  sessionId: string
  agentId: string
}

function anchor(id: string, parentId: string, x: number, y: number, data: BindingAnchorData): CanvasFlowNode {
  return {
    id,
    type: BINDING_ANCHOR_KIND,
    parentId,
    position: { x, y },
    width: 1,
    height: 1,
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    connectable: false,
    data: { node: { id, kind: BINDING_ANCHOR_KIND, x, y, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data } },
  }
}

export interface BuildInput {
  projectId: string
  layout: Layout
  /** resolveAgentBindings(), by agentKey. */
  bindings: ReadonlyMap<string, Binding>
  /** Epics that have a frame on the Canvas (the workflow model's). */
  epics: ReadonlySet<string>
  /** Ticket Node ids on the Canvas now (a folded done stack or a collapsed frame hides some). */
  tickets: ReadonlySet<string>
  /** Subagent Nodes on the Canvas now. */
  subagents: readonly PresentSubagent[]
}

/** The anchors for one Project's bound agents and their targets; agents whose target is not on the Canvas get none. */
export function buildBindingAnchors({ projectId, layout, bindings, epics, tickets, subagents }: BuildInput): CanvasFlowNode[] {
  const agents: CanvasFlowNode[] = []
  const targets = new Map<string, CanvasFlowNode>()
  /** The anchor a line to `binding` ends at, made once per target; null when neither the Ticket nor its frame is shown. */
  const targetOf = (binding: Binding): string | null => {
    const { target } = binding
    if (target.kind === 'ticket' && tickets.has(ticketNodeId(target.epic, target.num))) {
      const id = ticketAnchorId(target.epic, target.num)
      if (!targets.has(id)) targets.set(id, anchor(id, ticketNodeId(target.epic, target.num), TICKET_WIDTH, TICKET_ANCHOR_Y, { variant: 'ticket', projectId, epic: target.epic, num: target.num }))
      return id
    }
    if (!epics.has(target.epic)) return null
    const id = epicAnchorId(target.epic)
    if (!targets.has(id)) targets.set(id, anchor(id, epicNodeId(target.epic), EPIC_ANCHOR_X, 0, { variant: 'epic', projectId, epic: target.epic }))
    return id
  }
  const add = (agentNodeId: string, sessionId: string, agentId: string | null, y: number) => {
    const binding = bindings.get(agentKey(sessionId, agentId))
    const targetId = binding ? targetOf(binding) : null
    if (!binding || targetId === null) return
    agents.push(anchor(agentAnchorId(agentNodeId), agentNodeId, 0, y, { variant: 'agent', projectId, sessionId, agentId, agentNodeId, binding, targetId }))
  }
  for (const node of agentNodes(layout)) add(node.id, node.data.sessionId as string, null, SESSION_ANCHOR_Y)
  for (const subagent of subagents) add(subagent.nodeId, subagent.sessionId, subagent.agentId, SUBAGENT_ANCHOR_Y)
  // Targets first: a line's two ends are both known by the time React Flow reads the agents.
  return [...[...targets.values()].sort((a, b) => a.id.localeCompare(b.id)), ...agents]
}

const EMPTY: readonly CanvasFlowNode[] = []
const last = new Map<string, { signature: string; nodes: readonly CanvasFlowNode[] }>()

/** "<nodeId>\t<sessionId>\t<agentId>" per Subagent Node on the Canvas, one per line; a string so the selector result compares by value. */
function presentSubagents(nodeLookup: ReadonlyMap<string, { type?: string | undefined; data: Record<string, unknown> }>): string {
  const lines: string[] = []
  for (const [id, node] of nodeLookup) {
    if (node.type !== SUBAGENT_KIND) continue
    const data = ((node.data as Partial<CanvasFlowNode['data']>).node?.data ?? {}) as { variant?: unknown; sessionId?: unknown; agent?: { agentId?: unknown } | null }
    if (data.variant === 'agent' && typeof data.sessionId === 'string' && typeof data.agent?.agentId === 'string') lines.push(`${id}\t${data.sessionId}\t${data.agent.agentId}`)
  }
  return lines.join('\n')
}

function useBindingAnchors({ projectId, layout }: NodeSourceContext): readonly CanvasFlowNode[] {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const { live } = useClaudeHome(root)
  const { model } = useWorkflow(root)
  const manual = useManualBindings(projectId)
  const sessionIds = useMemo(() => agentNodes(layout).map((node) => node.data.sessionId as string), [layout])
  const liveIds = useMemo(() => (live ?? []).map((session) => session.sessionId), [live])
  const signals = useSessionSignals(root, sessionIds, liveIds)
  const bindings = useMemo(() => resolveAgentBindings({ sessionIds, signals, manual, workflow: bindingWorkflowOf(model) }), [sessionIds, signals, manual, model])
  // Which of the bound targets' Ticket Nodes and which Subagent Nodes React Flow has now: they come
  // from the other node sources, which do not depend on these anchors.
  const wantedTickets = [...new Set([...bindings.values()].flatMap(({ target }) => (target.kind === 'ticket' ? [ticketNodeId(target.epic, target.num)] : [])))].sort()
  const ticketsShown = useStore((state) => wantedTickets.filter((id) => state.nodeLookup.has(id)).join('\n'))
  const anySubagent = [...bindings.keys()].some((key) => key.includes('/'))
  const subagentsShown = useStore((state) => (anySubagent ? presentSubagents(state.nodeLookup) : ''))
  return useMemo(() => {
    const epics = new Set(model?.error === null ? [...model.epics.map((epic) => epic.epic), ...model.tickets.map((ticket) => ticket.epic)] : [])
    const tickets = new Set(ticketsShown === '' ? [] : ticketsShown.split('\n'))
    const subagents = subagentsShown === '' ? [] : subagentsShown.split('\n').map((line) => {
      const [nodeId, sessionId, agentId] = line.split('\t') as [string, string, string]
      return { nodeId, sessionId, agentId }
    })
    const nodes = buildBindingAnchors({ projectId, layout, bindings, epics, tickets, subagents })
    if (nodes.length === 0) {
      last.delete(projectId)
      return EMPTY
    }
    // The same array while nothing about the anchors changed, so the Canvas does not rebuild its Nodes.
    const signature = JSON.stringify(nodes.map((node) => [node.id, node.parentId, node.position, node.data.node.data]))
    const before = last.get(projectId)
    if (before && before.signature === signature) return before.nodes
    last.set(projectId, { signature, nodes })
    return nodes
  }, [projectId, layout, model, bindings, ticketsShown, subagentsShown])
}

// `binding-anchor` is owned though the Layout never holds one: a stray Layout Node of that kind is not drawn.
const source: NodeSource = { owns: [BINDING_ANCHOR_KIND], useNodes: useBindingAnchors, moved: () => undefined }
export default source
