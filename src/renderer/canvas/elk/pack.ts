// Rectangle packing by ELK for "Tidy up" (worfy-week/07, owner's decision 28): ELK's `rectpacking`
// puts rectangles in rows, in the order they are given, with a fixed gap between them. The ELK
// instance is passed in, as for the Epic frames (layout.ts): the app's runs in the Web Worker of
// client.ts, tests pass ELK without a worker (elkjs/lib/elk.bundled.js).
//
// The `SIMPLE` packing strategy keeps the input order as the reading order of the answer (top to
// bottom, then left to right), and so packing an answer again in its reading order gives the same
// answer: a second "Tidy up" finds nothing to move. ELK's default strategy compacts the rows by
// stacking rectangles inside a row, which reorders them and does not give the same answer twice.
import type { ElkNode } from 'elkjs/lib/elk-api'
import type { ElkEngine } from './layout'

export interface PackItem {
  id: string
  w: number
  h: number
}

export interface Packed {
  id: string
  /** The rectangle's top-left corner, relative to the packing's top-left corner. */
  x: number
  y: number
}

/** The ELK graph that packs `items`, in their order, `gap` apart. */
export function packGraph(items: readonly PackItem[], gap: number): ElkNode {
  return {
    id: 'tidy',
    layoutOptions: {
      'elk.algorithm': 'rectpacking',
      'elk.rectpacking.packing.strategy': 'SIMPLE',
      'elk.spacing.nodeNode': String(gap),
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children: items.map(({ id, w, h }) => ({ id, width: w, height: h })),
  }
}

/** Where ELK puts each of `items`, in the order of `items`. Rejects when ELK leaves one out. */
export async function packRects(items: readonly PackItem[], gap: number, elk: ElkEngine): Promise<Packed[]> {
  if (items.length === 0) return []
  const answer = await elk.layout(packGraph(items, gap))
  const at = new Map((answer.children ?? []).map((child) => [child.id, child]))
  return items.map(({ id }) => {
    const child = at.get(id)
    if (child === undefined || child.x === undefined || child.y === undefined) throw new Error(`ELK did not place ${id}`)
    return { id, x: child.x, y: child.y }
  })
}
