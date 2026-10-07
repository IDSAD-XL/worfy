import { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { useEdgeLit } from '../edge-focus'
import { orthogonalPath, placeRoute, type Point } from '../epic-layout'

// An Edge drawn along a route laid out for it — the "Blocked by" Edges inside an Epic frame, whose
// routes ELK makes (ADR-0037). The route's points are relative to the frame; they are shifted to
// where React Flow draws the source handle, so a dragged frame carries its routes along without a
// new layout. Straight segments are joined by rounded corners (`orthogonalPath`). An Edge whose
// route is not known yet (before ELK's first answer for the Epic) is drawn as React Flow's default
// curve between the two handles.
//
// The Edge is pale until it is on the chain of a hovered or selected Node (edge-focus.ts); then it
// is lit, with an arrowhead of its own in the lit colour. One whose `idle` is 'hidden' (from a done
// blocker) is drawn only while lit (worfy-week ticket 05).
export const kind = 'routed'

/** What an edge of this type carries in `data`, besides its source's own fields. */
export interface RoutedEdgeData {
  [key: string]: unknown
  /** Relative to the frame, from the source's side to the target's; absent: no route yet. */
  route?: readonly Point[] | undefined
  /** How the Edge looks while it is not lit: pale (the default) or not drawn at all. */
  idle?: 'pale' | 'hidden' | undefined
}

/** A marker id made of the Edge id; an Edge id may hold `:`, `/` and `>`. */
const litArrowId = (id: string): string => `w-edge-arrow-lit-${id.replace(/[^\w-]/g, '_')}`

function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style, interactionWidth }: EdgeProps) {
  const lit = useEdgeLit(id)
  const { route, idle } = (data ?? {}) as RoutedEdgeData
  if (!lit && idle === 'hidden') return null
  const routed = route !== undefined && route.length >= 2
  const path = routed
    ? orthogonalPath(placeRoute(route, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }))
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0]
  // React Flow's markers have one fixed colour each; a lit Edge points with an arrowhead coloured by CSS.
  const arrow = lit && markerEnd !== undefined ? litArrowId(id) : null
  return (
    <>
      {arrow !== null ? (
        <defs>
          <marker id={arrow} className="w-edge-arrow" markerWidth="14" markerHeight="14" viewBox="-10 -10 20 20" orient="auto-start-reverse" refX="0" refY="0">
            <polyline className="w-edge-arrow--lit" strokeLinecap="round" strokeLinejoin="round" points="-5,-4 0,0 -5,4 -5,-4" />
          </marker>
        </defs>
      ) : null}
      <path
        id={id}
        d={path}
        fill="none"
        className={lit ? 'react-flow__edge-path w-edge-path--lit' : 'react-flow__edge-path w-edge-path--pale'}
        style={style}
        markerEnd={arrow !== null ? `url('#${arrow}')` : markerEnd}
        data-routed={routed ? 'true' : 'false'}
        data-focus={lit ? 'lit' : 'pale'}
      />
      {interactionWidth ? <path d={path} fill="none" strokeOpacity={0} strokeWidth={interactionWidth} className="react-flow__edge-interaction" /> : null}
    </>
  )
}

export default memo(RoutedEdge)
