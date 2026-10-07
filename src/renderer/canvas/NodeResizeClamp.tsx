// The one wrapper every Node type puts around React Flow's NodeResizer (worfy-week ticket 06,
// decision 23): a resize never ends on a neighbour. While the mouse is down Canvas.tsx stops each
// edge that ran into a neighbour NODE_GAP short of it; the resizer's end reports where the mouse
// was, so this wrapper stops that rectangle the same way (snapping.ts) before the Node sends its
// `resize`. main corrects the operation with the same function and answers with the same rectangle
// (ADR-0038).
import { NodeResizer, useNodeId, useStoreApi, type NodeResizerProps, type OnResizeEnd } from '@xyflow/react'
import { useCallback } from 'react'
import { isParticipant } from '../../shared/layout/free-place'
import type { CanvasFlowNode } from './nodes'
import { resizeObstacles, stopEdges } from './snapping'

export function NodeResizeClamp({ onResizeEnd, ...props }: NodeResizerProps) {
  const id = useNodeId()
  const store = useStoreApi<CanvasFlowNode>()
  const onEnd: OnResizeEnd = useCallback(
    (event, params) => {
      if (onResizeEnd === undefined) return
      const nodes = store.getState().nodes
      const self = nodes.find((node) => node.id === id)
      if (self === undefined || !isParticipant(self.data.node)) {
        onResizeEnd(event, params)
        return
      }
      const before = self.data.node
      const after = { x: params.x, y: params.y, w: params.width, h: params.height }
      const rect = stopEdges(before, after, resizeObstacles(nodes.map((node) => node.data.node), self.id))
      onResizeEnd(event, { ...params, x: rect.x, y: rect.y, width: rect.w, height: rect.h })
    },
    [id, onResizeEnd, store],
  )
  return <NodeResizer {...props} onResizeEnd={onEnd} />
}
