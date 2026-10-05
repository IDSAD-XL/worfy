// The minimap at the bottom right of the Canvas (ticket 29; docs/design/BRIEF.md, Screen 1).
// Nodes are drawn in their type's colour from the theme tokens; a click moves the viewport so
// that the clicked point is in the middle, dragging pans. View ▸ Show Minimap (src/main/ipc/view.ts)
// hides and shows it.
import { useEffect } from 'react'
import { MiniMap, useReactFlow, type Node } from '@xyflow/react'
import { create } from 'zustand'
import { invoke, subscribe } from '../../ipc'
import type { CanvasFlowNode } from '../nodes'
import './minimap.css'

export const order = 10

/** Theme token of each Node kind's colour on the minimap; other kinds get NODE_COLOR_DEFAULT. */
const NODE_COLORS: Readonly<Record<string, string>> = {
  note: 'var(--border-strong)',
  orchestrator: 'var(--working-dot)',
  session: 'var(--primary)',
  subagent: 'var(--working-text)',
  'epic-frame': 'var(--accent)',
  ticket: 'var(--ready-dot)',
  handoff: 'var(--blocked-ring)',
  card: 'var(--blocked-text)',
  terminal: 'var(--terminal-bg)',
}
const NODE_COLOR_DEFAULT = 'var(--text-muted)'

/** The minimap colour of a Node: by its kind in the Layout (React Flow's type is the placeholder's for unknown kinds). */
function minimapColor(node: Node): string {
  const kind = (node as CanvasFlowNode).data.node.kind
  return NODE_COLORS[kind] ?? NODE_COLOR_DEFAULT
}

/** A pinned Node is not on the plane; it is left off the minimap. */
function minimapClass(node: Node): string {
  return (node as CanvasFlowNode).data.node.pinned ? 'w-minimap-node--pinned' : ''
}

const useMinimapStore = create<{ visible: boolean }>(() => ({ visible: true }))
let followed = false

/** Takes the View menu's state once and follows it; one subscription serves every Canvas. */
function followViewMenu(): void {
  if (followed) return
  followed = true
  try {
    subscribe('view.changed', ({ minimap }) => useMinimapStore.setState({ visible: minimap }))
  } catch (error) {
    console.error('view.changed: cannot subscribe', error)
  }
  void invoke('view.get').then((result) => {
    if (result.ok) useMinimapStore.setState({ visible: result.value.minimap })
    else console.error('view.get failed:', result.error)
  })
}

export default function MiniMapOverlay() {
  const flow = useReactFlow()
  const visible = useMinimapStore((store) => store.visible)
  useEffect(followViewMenu, [])
  if (!visible) return null
  return (
    <MiniMap
      className="w-minimap"
      position="bottom-right"
      ariaLabel="Minimap"
      pannable
      nodeColor={minimapColor}
      nodeStrokeWidth={0}
      nodeBorderRadius={4}
      nodeClassName={minimapClass}
      bgColor="var(--surface)"
      maskColor="color-mix(in srgb, var(--canvas) 55%, transparent)"
      maskStrokeColor="var(--accent)"
      maskStrokeWidth={1}
      onClick={(_event, point) => {
        void flow.setCenter(point.x, point.y, { zoom: flow.getZoom() })
      }}
    />
  )
}
