// The Canvas's React Flow store for a component that is also drawn outside a Canvas (a button of a
// Ticket or an Epic frame, a history popover).
import { useStoreApi } from '@xyflow/react'
import type { CanvasFlowNode } from './nodes'

/** The Canvas's React Flow store; null where the component is drawn outside a Canvas. */
export function useCanvasStore(): ReturnType<typeof useStoreApi<CanvasFlowNode>> | null {
  try {
    return useStoreApi<CanvasFlowNode>()
  } catch {
    return null
  }
}
