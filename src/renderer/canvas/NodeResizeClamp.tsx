// The one wrapper every Node type puts around React Flow's NodeResizer (worfy-week ticket 06,
// decision 23): a resize never ends on a neighbour. While the mouse is down Canvas.tsx stops each
// edge that ran into a neighbour NODE_GAP short of it; the resizer's end reports where the mouse
// was, so this wrapper stops that rectangle the same way (snapping.ts) before the Node sends its
// `resize`. main corrects the operation with the same function and answers with the same rectangle
// (ADR-0038).
//
// From the start of the resize to its end the wrapper also marks the React Flow root with
// RESIZING_ATTRIBUTE (worfy-week ticket 09). canvas.css turns mouse events off for every iframe on
// the Canvas while the mark is there: a Card's page is on another origin, so a pointer that falls
// onto its iframe would take the mouse events away from the window, and the resize would never end.
import { NodeResizer, useNodeId, useStoreApi, type NodeResizerProps, type OnResizeEnd, type OnResizeStart } from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
import { isParticipant } from '../../shared/layout/free-place'
import type { CanvasFlowNode } from './nodes'
import { resizeObstacles, stopEdges } from './snapping'

/** The attribute on the React Flow root while a Node is being resized; canvas.css keys on it. */
export const RESIZING_ATTRIBUTE = 'data-node-resizing'

export function NodeResizeClamp({ onResizeStart, onResizeEnd, ...props }: NodeResizerProps) {
  const id = useNodeId()
  const store = useStoreApi<CanvasFlowNode>()
  // The root this wrapper marked, so the mark comes off even if the Node goes away mid-resize.
  const marked = useRef<HTMLElement | null>(null)
  const unmark = useCallback(() => {
    marked.current?.removeAttribute(RESIZING_ATTRIBUTE)
    marked.current = null
  }, [])
  useEffect(() => unmark, [unmark])

  const onStart: OnResizeStart = useCallback(
    (event, params) => {
      const root = store.getState().domNode
      if (root !== null) {
        root.setAttribute(RESIZING_ATTRIBUTE, '')
        marked.current = root
      }
      onResizeStart?.(event, params)
    },
    [onResizeStart, store],
  )
  const onEnd: OnResizeEnd = useCallback(
    (event, params) => {
      unmark()
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
    [id, onResizeEnd, store, unmark],
  )
  return <NodeResizer {...props} onResizeStart={onStart} onResizeEnd={onEnd} />
}
