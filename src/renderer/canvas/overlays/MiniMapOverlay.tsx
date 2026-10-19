// The minimap at the bottom right of the Canvas (ticket 29; docs/design/BRIEF.md, Screen 1).
// Nodes are painted by kind (minimap-paint.ts): the coloured kinds in their `kind-*` token
// (ADR-0077), a Subagent as an outline in it, the rest in a neutral grey. A click moves the
// viewport so that the clicked point is in the middle, dragging pans. View ▸ Show Minimap
// (src/main/menu.ts) hides and shows it. While it is shown, pinned Nodes keep out of its corner
// (pinning.ts, setMinimapCorner).
import { useEffect } from 'react'
import { MiniMap, useReactFlow } from '@xyflow/react'
import { create } from 'zustand'
import { invoke, subscribe } from '../../ipc'
import { setMinimapCorner } from '../pinning'
import { minimapPaint } from './minimap-paint'
import './minimap.css'

export const order = 10

const paint = minimapPaint()

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

/** The minimap's drawing, in screen pixels: React Flow's defaults, which this overlay keeps. */
const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
/** Its border on each side (minimap.css) and React Flow's margin around a panel (.react-flow__panel). */
const MINIMAP_BORDER = 1
const PANEL_MARGIN = 15

/**
 * The corner a pinned Node keeps out of (pinning.ts): the minimap, the margin between it and the
 * Canvas's edges, and as much again between it and the Node.
 */
const MINIMAP_CORNER = {
  width: PANEL_MARGIN + MINIMAP_WIDTH + 2 * MINIMAP_BORDER + PANEL_MARGIN,
  height: PANEL_MARGIN + MINIMAP_HEIGHT + 2 * MINIMAP_BORDER + PANEL_MARGIN,
} as const

export default function MiniMapOverlay() {
  const flow = useReactFlow()
  const visible = useMinimapStore((store) => store.visible)
  useEffect(followViewMenu, [])
  // The minimap's visibility is one for every Canvas, so the corner is not cleared on unmount.
  useEffect(() => setMinimapCorner(visible ? MINIMAP_CORNER : undefined), [visible])
  if (!visible) return null
  return (
    <MiniMap
      className="w-minimap"
      position="bottom-right"
      ariaLabel="Minimap"
      pannable
      nodeColor={paint.fill}
      nodeStrokeColor={paint.stroke}
      nodeBorderRadius={4}
      nodeClassName={paint.className}
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
