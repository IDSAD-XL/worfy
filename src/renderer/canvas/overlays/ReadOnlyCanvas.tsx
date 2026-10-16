// The Canvas of a Linked machine that shares its Projects with this Machine read-only (worfy-link
// ticket 25, ADR-0066): it can be looked at, panned and zoomed, and nothing on it changes.
//
// - Nodes do not move: Canvas.tsx gives React Flow `nodesDraggable` from the same level (worfy-link
//   ticket 26). React Flow 12 gives each Node its drag handler and `draggable` class from that prop,
//   not from its store; a value written into the store from here only stopped the drag from moving
//   a plain Node, and a Node with its own `draggable: true` (a Subagent) still moved. Panning and
//   zooming stay.
// - The React Flow root carries READ_ONLY_ATTRIBUTE; projects/read-only.css keys the plain cursor on it.
// - The notice at the top centre says why, with the same words as every inactive action.
//
// The resize handles (NodeResizeClamp.tsx), the Terminal (NodeChrome.tsx) and every operation sent
// (useLayout.ts sendLayoutOp, history.ts) are stopped where they are made; this overlay is the look.
import { useEffect, type CSSProperties } from 'react'
import { Panel, useStore } from '@xyflow/react'
import { useReadOnly } from '../../projects/useProjects'

export const order = 45

/** The attribute on the React Flow root while the Canvas is read-only. */
export const READ_ONLY_ATTRIBUTE = 'data-canvas-read-only'

const NOTICE: CSSProperties = {
  maxWidth: 'min(640px, calc(100vw - 48px))',
  marginTop: 'var(--space-2)',
  padding: 'var(--space-1) var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-button)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-control)',
  color: 'var(--text-secondary)',
  font: 'var(--text-12) / 18px var(--font-ui)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  pointerEvents: 'none',
}

export default function ReadOnlyCanvas() {
  const hint = useReadOnly()
  const root = useStore((state) => state.domNode)
  const readOnly = hint !== null

  useEffect(() => {
    if (!readOnly) return
    root?.setAttribute(READ_ONLY_ATTRIBUTE, '')
    return () => root?.removeAttribute(READ_ONLY_ATTRIBUTE)
  }, [readOnly, root])

  if (hint === null) return null
  return (
    <Panel position="top-center" className="nodrag nopan nowheel">
      <div role="status" data-testid="canvas-read-only" style={NOTICE}>
        {hint}
      </div>
    </Panel>
  )
}
