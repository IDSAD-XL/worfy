// Where a dragged agent Node drops for a manual Binding (ticket 16; canvas/overlays/BindingDrop.tsx):
// which Node shows an agent, and which Ticket or Epic frame is under a point of the Canvas. Pure,
// so the unit tests check it without React Flow.
import type { BindingTarget } from '../../shared/binding/resolve'
import type { BindingAgent } from '../../shared/ipc/bindings'
import { SOURCE_NODE_KINDS, SUBAGENT_KIND } from '../../shared/layout/derived'
import type { CanvasFlowNode } from '../canvas/nodes'
import type { SubagentNodeData } from '../canvas/sources/subagents'
import { BINDING_ANCHOR_KIND } from '../canvas/sources/workflow-bindings'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface DropCandidate {
  target: BindingTarget
  /** A Ticket is a better target than the frame around it. */
  kind: 'ticket' | 'epic'
  rect: Rect
}

const inside = (point: { x: number; y: number }, rect: Rect): boolean => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h

/** What a point of the Canvas drops on: a Ticket under it, else an Epic frame under it, else nothing. */
export function dropTargetAt(point: { x: number; y: number }, candidates: readonly DropCandidate[]): DropCandidate | null {
  return candidates.find((each) => each.kind === 'ticket' && inside(point, each.rect)) ?? candidates.find((each) => each.kind === 'epic' && inside(point, each.rect)) ?? null
}

/** The agent a Node shows, and how its place is saved; null for any other Node. */
export function agentOfNode(node: Pick<CanvasFlowNode, 'type' | 'data'>): { agent: BindingAgent; subagent: SubagentNodeData | null } | null {
  const data = node.data.node.data
  if (node.type === SUBAGENT_KIND) {
    const subagent = data as SubagentNodeData
    const agentId = subagent.variant === 'agent' ? subagent.agent?.agentId : null
    return typeof agentId === 'string' ? { agent: { sessionId: subagent.sessionId, agentId }, subagent } : null
  }
  const sessionId = data.sessionId
  if (typeof sessionId !== 'string' || sessionId === '' || node.type === BINDING_ANCHOR_KIND || SOURCE_NODE_KINDS.includes(node.data.node.kind)) return null
  return { agent: { sessionId, agentId: null }, subagent: null }
}

