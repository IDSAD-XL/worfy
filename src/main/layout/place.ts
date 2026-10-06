// Where main puts a Node it creates by itself (the Orchestrator Node, the HANDOFF Node, a new
// Session Node): one rule for every such Node, so they agree about which spot of the plane is taken.
import { onThePlane } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'

/** Distance from the plane's origin to the top-left spot, and between a new Node and the ones above it. */
export const PLACE_GAP = 40

/**
 * The place for a new Node of `size`: the top-left spot when no Node on the plane overlaps it,
 * otherwise under every Node on the plane, so it covers none of them and is in view with the
 * default viewport. Epic frames are not counted: their column moves out of the new Node's way
 * (ADR-0032).
 */
export function placeNewNode(nodes: readonly LayoutNode[], size: { w: number; h: number }): { x: number; y: number } {
  const placed = nodes.filter(onThePlane)
  const spot = { x: PLACE_GAP, y: PLACE_GAP }
  const covers = (node: LayoutNode) => node.x < spot.x + size.w && spot.x < node.x + node.w && node.y < spot.y + size.h && spot.y < node.y + node.h
  if (!placed.some(covers)) return spot
  return { x: Math.min(...placed.map((node) => node.x)), y: Math.max(...placed.map((node) => node.y + node.h)) + PLACE_GAP }
}

/**
 * The place for a new Node of `size` whose top-left corner may not be left of or above `from`:
 * at `from.x`, on the first height from `from.y` down where it keeps PLACE_GAP from every Node on
 * the plane. Candidates are `from.y` and the bottom of each Node plus the gap; the lowest one is
 * always clear. "Ship ticket" puts its Session here (worfy-daily ticket 28): the renderer sends the
 * spot right of the Epic frames' column at the Ticket's height, so the Session stays outside the
 * column's band and the column does not move (ADR-0032).
 */
export function placeDownFrom(nodes: readonly LayoutNode[], size: { w: number; h: number }, from: { x: number; y: number }): { x: number; y: number } {
  const placed = nodes.filter(onThePlane)
  const { x } = from
  const covers = (y: number) => (node: LayoutNode) =>
    node.x < x + size.w + PLACE_GAP && x - PLACE_GAP < node.x + node.w && node.y < y + size.h + PLACE_GAP && y - PLACE_GAP < node.y + node.h
  const heights = [from.y, ...placed.map((node) => node.y + node.h + PLACE_GAP).filter((y) => y > from.y)].sort((a, b) => a - b)
  return { x, y: heights.find((y) => !placed.some(covers(y))) ?? from.y }
}
