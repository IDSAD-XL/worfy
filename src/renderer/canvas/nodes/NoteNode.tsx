import { NodeResizer } from '@xyflow/react'
import type { CanvasNodeProps } from './index'
import { useLayoutOps } from '../useLayout'

// A plain text note. It is the debug Node type: a double click on an empty spot of the Canvas
// creates one, and tests use it to exercise the Layout.
export const kind = 'note'
export const defaultWidth = 220
export const defaultHeight = 120

export default function NoteNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const text = typeof data.node.data.text === 'string' ? data.node.data.text : ''

  return (
    <div className="w-node-surface w-note" data-testid="note-node" data-node-id={id}>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={64}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-note__header">Note</div>
      {/* Uncontrolled, keyed by the saved text: a change that arrives from main replaces it. */}
      <textarea
        key={text}
        className="w-note__text nodrag nowheel"
        aria-label="Note text"
        placeholder="Write a note…"
        defaultValue={text}
        onBlur={(event) => {
          if (event.target.value !== text) ops.apply({ op: 'patchData', id, data: { text: event.target.value } })
        }}
      />
    </div>
  )
}
