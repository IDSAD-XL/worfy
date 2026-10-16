// The Nodes of the Canvas as the read-only screen of a Linked machine draws them (worfy-link ticket
// 26, ADR-0066). Canvas.tsx gives React Flow `nodesDraggable` from the read-only level, but a Node
// whose own `draggable` is true drags whatever that prop says (a Subagent's, sources/subagents.ts).
import type { CanvasFlowNode } from './nodes'

/**
 * A Node whose own `draggable` is true gets false; the rest are left as they are. `readOnly` null
 * (the Project can be changed): the same array.
 */
export function lockedForReadOnly(nodes: CanvasFlowNode[], readOnly: string | null): CanvasFlowNode[] {
  if (readOnly === null) return nodes
  return nodes.map((node) => (node.draggable === true ? { ...node, draggable: false } : node))
}
