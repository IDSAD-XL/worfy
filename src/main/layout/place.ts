// Where main puts a Node it creates by itself (the Orchestrator Node, the HANDOFF Node): one rule
// for every such Node, so they agree about which spot of the plane is taken.
import { SOURCE_NODE_KINDS } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'

/** Distance from the plane's origin to the top-left spot, and between a new Node and the ones above it. */
export const PLACE_GAP = 40

/**
 * Nodes that take room on the plane. Epic frame and Ticket Nodes keep an offset, not a place
 * (shared/layout/derived.ts); a pinned Node keeps screen pixels, not plane coordinates; a hidden
 * Node is not drawn.
 */
function onThePlane(node: LayoutNode): boolean {
  return !node.pinned && !node.hidden && !SOURCE_NODE_KINDS.includes(node.kind)
}

/**
 * The place for a new Node of `size`: the top-left spot when no Node on the plane overlaps it,
 * otherwise under every Node on the plane, so it covers none of them and is in view with the
 * default viewport.
 */
export function placeNewNode(nodes: readonly LayoutNode[], size: { w: number; h: number }): { x: number; y: number } {
  const placed = nodes.filter(onThePlane)
  const spot = { x: PLACE_GAP, y: PLACE_GAP }
  const covers = (node: LayoutNode) => node.x < spot.x + size.w && spot.x < node.x + node.w && node.y < spot.y + size.h && spot.y < node.y + node.h
  if (!placed.some(covers)) return spot
  return { x: Math.min(...placed.map((node) => node.x)), y: Math.max(...placed.map((node) => node.y + node.h)) + PLACE_GAP }
}
