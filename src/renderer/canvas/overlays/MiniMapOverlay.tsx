// The minimap at the bottom right of the Canvas (ticket 29; docs/design/BRIEF.md, Screen 1).
// Nodes are drawn in the colour their Node type declares (a theme token, `minimapColor` in
// nodes/index.ts); a click moves the viewport so that the clicked point is in the middle, dragging
// pans. View ▸ Show Minimap (src/main/menu.ts) hides and shows it.
import { useEffect } from 'react'
import { MiniMap, useReactFlow, type Node } from '@xyflow/react'
import { create } from 'zustand'
import { invoke, subscribe } from '../../ipc'
import { nodeTypes, type CanvasFlowNode } from '../nodes'
import './minimap.css'

export const order = 10

/** The colour of a Node whose type declares none (nodes/index.ts, `minimapColor`), or whose kind has no type. */
const NODE_COLOR_DEFAULT = 'var(--text-muted)'

/** The minimap colour of a Node: its Node type's, by its kind in the Layout (React Flow's type is the placeholder's for unknown kinds). */
function minimapColor(node: Node): string {
  const kind = (node as CanvasFlowNode).data.node.kind
  return nodeTypes.get(kind)?.minimapColor ?? NODE_COLOR_DEFAULT
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
