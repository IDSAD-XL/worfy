// The rectangles a layout command moves (tidy.ts "Tidy up", arrange-by-epic.ts "Arrange by Epic"):
// a Node with its Subagent tree is one rectangle, and they go in reading order of their places now.
//
// Free of React and IPC: the unit tests read arrange-by-epic.ts, which uses it, under Node
// (tsconfig.test.node.json).
import { onThePlane } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'
import type { Rect } from './epic-layout'

/** Room between two tidied rectangles: three steps of the 8 px grid, more than the 16 px gap of ADR-0038. */
export const TIDY_GAP = 24

/** One rectangle of the packing: a Node, with its Subagent tree when it has one. */
export interface TidyItem {
  /** The Layout Node that moves. */
  id: string
  /** The rectangle around the Node and its tree, on the plane. */
  rect: Rect
  /** Where the Node's corner is inside `rect`. */
  dx: number
  dy: number
}

/**
 * The rectangles of these Nodes, in reading order of their places now (top to bottom, then left to
 * right): one per Layout Node on the plane, the Subagent tree's block (relative to its Session's
 * Node, as `treeBlock` gives it) inside its Session's rectangle.
 */
export function tidyItems(nodes: readonly LayoutNode[], trees: ReadonlyMap<string, Rect> = new Map()): TidyItem[] {
  const items = nodes.filter(onThePlane).map((node): TidyItem => {
    const tree = trees.get(node.id)
    if (tree === undefined || tree.w <= 0 || tree.h <= 0) return { id: node.id, rect: { x: node.x, y: node.y, w: node.w, h: node.h }, dx: 0, dy: 0 }
    const left = Math.min(0, tree.x)
    const top = Math.min(0, tree.y)
    const rect = { x: node.x + left, y: node.y + top, w: Math.max(node.w, tree.x + tree.w) - left, h: Math.max(node.h, tree.y + tree.h) - top }
    return { id: node.id, rect, dx: -left, dy: -top }
  })
  return items.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
