// Where a Node is on the Canvas, for ⌘F and the palette's Go to (CanvasFind.tsx): kept apart from
// the component so a test can call it with a fake React Flow instance.
import type { ReactFlowInstance } from '@xyflow/react'
import { DONE_SHELF_ID } from '../../shared/layout/derived'
import type { CanvasFlowNode } from '../canvas/nodes'
import { shelfChipRect } from '../canvas/sources/epics'

type Flow = ReactFlowInstance<CanvasFlowNode>

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A Node's place on the Canvas, inside its parent or not; undefined when React Flow does not show
 * it. An Epic on the done shelf has no frame: `epic:<epic>` is its chip there (worfy-canvas ticket 02).
 */
export function rectOf(flow: Pick<Flow, 'getInternalNode'>, id: string): Rect | undefined {
  const node = flow.getInternalNode(id)
  if (!node || node.hidden === true) {
    const shelf = flow.getInternalNode(DONE_SHELF_ID)
    return shelf === undefined || shelf.hidden === true ? undefined : shelfChipRect(id, { ...shelf.internals.positionAbsolute, data: shelf.data })
  }
  const { x, y } = node.internals.positionAbsolute
  return { x, y, w: node.width ?? node.measured.width ?? 0, h: node.height ?? node.measured.height ?? 0 }
}
