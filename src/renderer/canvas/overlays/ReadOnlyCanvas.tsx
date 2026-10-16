// The Canvas of a Linked machine that shares its Projects with this Machine read-only (worfy-link
// ticket 25, ADR-0066): it can be looked at, panned and zoomed, and nothing on it changes.
//
// - Nodes do not move: React Flow's store gets `nodesDraggable: false` while the screen is
//   read-only. A drag then picks up no Node, so nothing moves and nothing has to jump back; panning
//   and zooming stay. Canvas.tsx sets no `nodesDraggable` of its own, so React Flow never puts its
//   prop back over this one.
// - The React Flow root carries READ_ONLY_ATTRIBUTE; projects/read-only.css keys the plain cursor on it.
// - The notice at the top centre says why, with the same words as every inactive action.
//
// The resize handles (NodeResizeClamp.tsx), the Terminal (NodeChrome.tsx) and every operation sent
// (useLayout.ts sendLayoutOp, history.ts) are stopped where they are made; this overlay is the look.
import { useEffect, type CSSProperties } from 'react'
import { Panel, useStore, useStoreApi } from '@xyflow/react'
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
  const store = useStoreApi()
  const root = useStore((state) => state.domNode)
  const readOnly = hint !== null

  useEffect(() => {
    if (!readOnly) return
    store.setState({ nodesDraggable: false })
    root?.setAttribute(READ_ONLY_ATTRIBUTE, '')
    return () => {
      store.setState({ nodesDraggable: true })
      root?.removeAttribute(READ_ONLY_ATTRIBUTE)
    }
  }, [readOnly, root, store])

  if (hint === null) return null
  return (
    <Panel position="top-center" className="nodrag nopan nowheel">
      <div role="status" data-testid="canvas-read-only" style={NOTICE}>
        {hint}
      </div>
    </Panel>
  )
}
