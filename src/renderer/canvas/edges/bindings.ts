// Binding lines (ticket 16): a dashed line from each bound agent — a Session, the Orchestrator, a
// Subagent — to what it is bound to: its Ticket, or its Epic's frame (also for a Ticket the frame
// does not show). Both ends are anchors from sources/workflow-bindings.ts, which also decides where
// a line ends; a line is drawn only when both ends are on the Canvas.
//
// The line of a working agent (a live Session, a running Subagent) is always drawn; another's only
// while the agent's Node or its target's Node is hovered or selected (worfy-week ticket 05), or
// while both are in the lit Family of a hovered or selected Node (worfy-canvas ticket 03). The
// line is orthogonal with rounded corners (edge-types/StepEdge.tsx).
import type { Edge } from '@xyflow/react'
import { bindingReason, bindingTargetLabel } from '../../../shared/binding/resolve'
import type { LayoutNode } from '../../../shared/layout/types'
import { kind as STEP_EDGE, type StepEdgeData } from '../edge-types/StepEdge'
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
      type: STEP_EDGE,
      className: binding.source === 'manual' ? 'w-edge-binding w-edge-binding--manual' : 'w-edge-binding',
      style: { stroke: 'var(--accent)', strokeWidth: 1.25, strokeDasharray: '5 4' },
      selectable: false,
      focusable: false,
      deletable: false,
      ariaLabel: `bound to ${bindingTargetLabel(binding.target)} · ${bindingReason(binding)}`,
      data: {
        kind: 'binding',
        target: binding.target,
        source: binding.source,
        live: data.live,
        ...(data.live ? {} : { showWith: [data.agentNodeId, data.targetNodeId] }),
      } satisfies StepEdgeData,
    })
  }
  return edges
}
