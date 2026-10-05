// Binding lines (ticket 16): a dashed line from each bound agent — a Session, the Orchestrator, a
// Subagent — to what it is bound to: its Ticket, or its Epic's frame (also for a Ticket the frame
// does not show). Both ends are anchors from sources/workflow-bindings.ts, which also decides where
// a line ends; a line is drawn only when both ends are on the Canvas.
import type { Edge } from '@xyflow/react'
import { bindingReason, bindingTargetLabel } from '../../../shared/binding/resolve'
import type { LayoutNode } from '../../../shared/layout/types'
import { BINDING_ANCHOR_KIND, type BindingAnchorData } from '../sources/workflow-bindings'

export default function bindingEdges(nodes: readonly LayoutNode[]): Edge[] {
  const present = new Set(nodes.map((node) => node.id))
  const edges: Edge[] = []
  for (const node of nodes) {
    if (node.kind !== BINDING_ANCHOR_KIND) continue
    const data = node.data as BindingAnchorData
    if (data.variant !== 'agent' || !present.has(data.targetId)) continue
    const { binding } = data
    edges.push({
      id: `binding:${data.agentNodeId}`,
      source: node.id,
      target: data.targetId,
      className: binding.source === 'manual' ? 'w-edge-binding w-edge-binding--manual' : 'w-edge-binding',
      style: { stroke: 'var(--accent)', strokeWidth: 1.25, strokeDasharray: '5 4' },
      selectable: false,
      focusable: false,
      deletable: false,
      ariaLabel: `bound to ${bindingTargetLabel(binding.target)} · ${bindingReason(binding)}`,
      data: { kind: 'binding', target: binding.target, source: binding.source },
    })
  }
  return edges
}
