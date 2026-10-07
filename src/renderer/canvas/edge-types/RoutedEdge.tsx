import { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { orthogonalPath, placeRoute, type Point } from '../epic-layout'

// An Edge drawn along a route laid out for it — the "Blocked by" Edges inside an Epic frame, whose
// routes ELK makes (ADR-0037). The route's points are relative to the frame; they are shifted to
// where React Flow draws the source handle, so a dragged frame carries its routes along without a
// new layout. Straight segments are joined by rounded corners (`orthogonalPath`). An Edge whose
// route is not known yet (before ELK's first answer for the Epic) is drawn as React Flow's default
// curve between the two handles.
export const kind = 'routed'

/** What an edge of this type carries in `data`, besides its source's own fields. */
export interface RoutedEdgeData {
  [key: string]: unknown
  /** Relative to the frame, from the source's side to the target's; absent: no route yet. */
  route?: readonly Point[] | undefined
}

function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style, interactionWidth }: EdgeProps) {
  const route = (data as RoutedEdgeData | undefined)?.route
  const routed = route !== undefined && route.length >= 2
  const path = routed
    ? orthogonalPath(placeRoute(route, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }))
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0]
  return (
    <>
      <path id={id} d={path} fill="none" className="react-flow__edge-path" style={style} markerEnd={markerEnd} data-routed={routed ? 'true' : 'false'} />
      {interactionWidth ? <path d={path} fill="none" strokeOpacity={0} strokeWidth={interactionWidth} className="react-flow__edge-interaction" /> : null}
    </>
  )
}

export default memo(RoutedEdge)
