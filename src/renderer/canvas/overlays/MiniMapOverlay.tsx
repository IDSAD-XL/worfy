// The minimap at the bottom right of the Canvas (ticket 29; docs/design/BRIEF.md, Screen 1).
// Nodes are painted by kind (minimap-paint.ts): the coloured kinds in their `kind-*` token
// (ADR-0077), a Subagent as an outline in it, the rest in a neutral grey. A click moves the
// viewport so that the clicked point is in the middle, dragging pans. View ▸ Show Minimap
// (src/main/menu.ts) hides and shows it. While it is shown, pinned Nodes keep out of its corner
// (pinning.ts, setMinimapCorner), and the first-Epic label (FirstEpic.tsx) sits above it. Its
// state and size are in minimap-view.ts.
import { useEffect } from 'react'
import { MiniMap, useReactFlow } from '@xyflow/react'
import { setMinimapCorner } from '../pinning'
import { minimapPaint } from './minimap-paint'
import { followViewMenu, MINIMAP_CORNER, useMinimapShown } from './minimap-view'
import './minimap.css'

export const order = 10

const paint = minimapPaint()

export default function MiniMapOverlay() {
  const flow = useReactFlow()
  const visible = useMinimapShown()
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
