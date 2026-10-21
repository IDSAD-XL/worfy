// Semantic zoom (worfy-canvas ticket 06; docs/design/F-SPEC.md, "Zoom levels"): a Node is drawn in
// one of three views by the Canvas zoom.
//
// - `full` (zoom >= 0.6): the Node as it is.
// - `compact` (0.3 <= zoom < 0.6): the Node's header alone, with its title and status chip.
// - `far` (zoom < 0.3): a block in the colour of its kind with a large title at a constant screen
//   size; an Epic frame keeps a header of constant screen size, its Tickets are blocks without text.
//
// overlays/ZoomLevel.tsx marks the React Flow root with the level (ZOOM_LEVEL_ATTRIBUTE) and, at the
// far level, with the zoom (ZOOM_VARIABLE) for the inverse scale; node-chrome.css and epic-frame.css
// draw the compact and far views from those marks and from the parts each Node type marks in its
// own component: `data-node-header` on its header row, a direct child of its `.w-node-surface`
// (the part the compact view keeps), and `data-node-title` on the title in it (the part the far
// view keeps, enlarged). A Node type that marks neither stays `full`. The Node type keeps drawing its own
// header, with its live title and status, and stays mounted: a Terminal goes on running below
// the compact view. A pinned Node keeps its screen size and is always `full`.
//
// A component that draws something different by level reads useZoomLevel(): it follows the level,
// not the zoom, so a pan or a zoom within one level does not draw it again (React Flow's
// "contextual zoom" pattern).
import { useStore, type ReactFlowState } from '@xyflow/react'

export type ZoomLevel = 'full' | 'compact' | 'far'

/** From this zoom up a Node is drawn in full. */
export const FULL_ZOOM_MIN = 0.6
/** From this zoom up to FULL_ZOOM_MIN a Node is its header alone; below it, a far block. */
export const COMPACT_ZOOM_MIN = 0.3

/** The attribute on the React Flow root that carries the level. */
export const ZOOM_LEVEL_ATTRIBUTE = 'data-zoom-level'
/** The CSS variable on the React Flow root that carries the zoom, set at the far level only. */
export const ZOOM_VARIABLE = '--w-zoom'

export function zoomLevelOf(zoom: number): ZoomLevel {
  if (zoom >= FULL_ZOOM_MIN) return 'full'
  return zoom >= COMPACT_ZOOM_MIN ? 'compact' : 'far'
}

const levelOf = (state: ReactFlowState): ZoomLevel => zoomLevelOf(state.transform[2])

/** The Canvas's zoom level; the component is drawn again only when the level changes. */
export function useZoomLevel(): ZoomLevel {
  return useStore(levelOf)
}
