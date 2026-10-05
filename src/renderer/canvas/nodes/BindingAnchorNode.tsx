import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { BindingAnchorData, BINDING_ANCHOR_KIND } from '../sources/workflow-bindings'
import type { CanvasNodeProps } from './index'

// An invisible point a Binding line starts or ends at (ticket 16; sources/workflow-bindings.ts):
// at the left edge of a bound agent's Node, at the right edge of a Ticket, or at the top edge of an
// Epic's frame. It draws nothing and takes no pointer events, so the Node under it stays clickable.

export const kind = 'binding-anchor' satisfies typeof BINDING_ANCHOR_KIND
export const defaultWidth = 1
export const defaultHeight = 1

const handle = { width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, background: 'transparent', opacity: 0, pointerEvents: 'none' } as const

function BindingAnchorNode({ data }: CanvasNodeProps) {
  const anchor = data.node.data as BindingAnchorData
  return (
    <div style={{ width: 1, height: 1, pointerEvents: 'none' }} aria-hidden="true">
      {anchor.variant === 'agent' ? <Handle type="source" position={Position.Left} isConnectable={false} style={handle} /> : null}
      {anchor.variant === 'ticket' ? <Handle type="target" position={Position.Right} isConnectable={false} style={handle} /> : null}
      {anchor.variant === 'epic' ? <Handle type="target" position={Position.Top} isConnectable={false} style={handle} /> : null}
    </div>
  )
}

export default memo(BindingAnchorNode)
