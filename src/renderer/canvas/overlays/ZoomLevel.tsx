// The marks of semantic zoom on the React Flow root (worfy-canvas ticket 06, zoom-level.ts): the
// level always, and the zoom at the far level, where the CSS of the far view scales titles and the
// Epic frame's header by its inverse to keep them at a constant screen size. Only this component
// follows every zoom step; it draws nothing. The zoom is left off the root at the other levels, so a
// zoom there restyles nothing.
import { useLayoutEffect } from 'react'
import { useStore } from '@xyflow/react'
import { useZoomLevel, ZOOM_LEVEL_ATTRIBUTE, ZOOM_VARIABLE } from '../zoom-level'

export const order = 5

export default function ZoomLevelMarks() {
  const root = useStore((state) => state.domNode)
  const level = useZoomLevel()
  // The zoom matters at the far level only; elsewhere the selector answers null and nothing follows the zoom.
  const farZoom = useStore((state) => (level === 'far' ? state.transform[2] : null))

  useLayoutEffect(() => {
    if (root === null) return
    root.setAttribute(ZOOM_LEVEL_ATTRIBUTE, level)
    return () => root.removeAttribute(ZOOM_LEVEL_ATTRIBUTE)
  }, [root, level])

  useLayoutEffect(() => {
    if (root === null || farZoom === null) return
    root.style.setProperty(ZOOM_VARIABLE, String(farZoom))
    return () => {
      root.style.removeProperty(ZOOM_VARIABLE)
    }
  }, [root, farZoom])

  return null
}
