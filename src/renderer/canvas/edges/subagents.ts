// The lines of each Session's Subagent tree (ticket 15): from the Session's Node (its anchor at
// the Node's right edge) to each of its Subagents, from a Subagent to each Subagent it started,
// and to the "N done" row of each parent. The Nodes and who is whose parent come from
// sources/subagents.ts; a line is drawn only when both ends are on the Canvas.
import type { Edge } from '@xyflow/react'
import type { LayoutNode } from '../../../shared/layout/types'
import { SUBAGENT_KIND, type SubagentNodeData } from '../sources/subagents'

const dataOf = (node: LayoutNode): SubagentNodeData | undefined => {
  if (node.kind !== SUBAGENT_KIND) return undefined
  const data = node.data as Partial<SubagentNodeData>
  return typeof data.variant === 'string' && typeof data.sessionId === 'string' ? (data as SubagentNodeData) : undefined
}

export default function subagentEdges(nodes: readonly LayoutNode[]): Edge[] {
  const present = new Set(nodes.map((node) => node.id))
  const edges: Edge[] = []
  for (const node of nodes) {
    const data = dataOf(node)
    if (!data || data.variant === 'anchor' || data.parentNodeId === null || !present.has(data.parentNodeId)) continue
    const running = data.agent?.status === 'running'
    edges.push({
      id: `subagent-edge:${node.id}`,
      source: data.parentNodeId,
      target: node.id,
      type: 'smoothstep',
      className: running ? 'w-edge-subagent w-edge-subagent--running' : 'w-edge-subagent',
      style: { stroke: running ? 'var(--text-muted)' : 'var(--border-strong)', strokeWidth: 1 },
      selectable: false,
      focusable: false,
      deletable: false,
      data: { kind: 'subagent', sessionId: data.sessionId, key: data.key },
    })
  }
  return edges
}
