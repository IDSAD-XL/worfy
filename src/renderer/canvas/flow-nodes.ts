/**
 * The React Flow Nodes the Canvas draws: the Layout's own Nodes and the Nodes of the node sources,
 * each with the name Tab focus reads on its wrapper. Without React, so a test builds them directly.
 */
import { isArchived, type LayoutNode } from '../../shared/layout/types'
import { SESSION_KIND, sessionTitleElementId } from '../claude-home/session-nodes'
import { nodeSources } from './extensions'
import { flowNodeLabel, nodeTypes as registeredNodeTypes, UNKNOWN_NODE_TYPE, type CanvasFlowNode } from './nodes'

/** Kinds whose Layout Nodes are a source's saved state and are not drawn themselves. */
export const ownedKinds = new Set(nodeSources.flatMap(({ source }) => source.owns))

/**
 * Keeps the Node React Flow already has when nothing about it changed, so an unchanged Node is not
 * drawn again; otherwise keeps its selection and, during a gesture, its local geometry.
 */
function mergeFlowNode(next: CanvasFlowNode, before: CanvasFlowNode | undefined): CanvasFlowNode {
  if (before === undefined) return next
  const busy = before.dragging === true || before.resizing === true
  if (
    !busy &&
    before.data.node === next.data.node &&
    before.type === next.type &&
    before.parentId === next.parentId &&
    before.hidden === next.hidden &&
    before.ariaLabel === next.ariaLabel &&
    before.domAttributes?.['aria-labelledby'] === next.domAttributes?.['aria-labelledby'] &&
    before.position.x === next.position.x &&
    before.position.y === next.position.y &&
    before.width === next.width &&
    before.height === next.height
  ) {
    return before
  }
  return {
    ...next,
    position: busy ? before.position : next.position,
    width: busy ? before.width : next.width,
    height: busy ? before.height : next.height,
    selected: before.selected ?? false,
    dragging: before.dragging ?? false,
    resizing: before.resizing ?? false,
  }
}

/** React Flow Nodes for the Layout and the node sources; keeps selection, and the local geometry of a Node in a gesture. */
export function toFlowNodes(layoutNodes: readonly LayoutNode[], derived: readonly CanvasFlowNode[], current: readonly CanvasFlowNode[]): CanvasFlowNode[] {
  const previous = new Map(current.map((node) => [node.id, node]))
  // An archived Node stays in the Layout but is not drawn (ADR-0076).
  const own: CanvasFlowNode[] = layoutNodes
    .filter((node) => !ownedKinds.has(node.kind) && !isArchived(node))
    .map((node) => ({
      id: node.id,
      type: registeredNodeTypes.has(node.kind) ? node.kind : UNKNOWN_NODE_TYPE,
      ariaLabel: flowNodeLabel(node.kind, registeredNodeTypes.has(node.kind)),
      // A Session is named by its title, which its Node reads; the kind word stays for a Node without one.
      ...(node.kind === SESSION_KIND ? { domAttributes: { 'aria-labelledby': sessionTitleElementId(node.id) } } : {}),
      position: { x: node.x, y: node.y },
      width: node.w,
      height: node.h,
      hidden: node.hidden,
      deletable: !node.locked,
      selected: false,
      dragging: false,
      resizing: false,
      data: { node },
    }))
  const fromSources = derived.map((node) => {
    const known = node.type !== undefined && registeredNodeTypes.has(node.type)
    return { ...node, type: known ? node.type : UNKNOWN_NODE_TYPE, ariaLabel: flowNodeLabel(node.data.node.kind, known, node.ariaLabel) }
  })
  return [...own, ...fromSources].map((node) => mergeFlowNode(node, previous.get(node.id)))
}
