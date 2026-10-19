import { memo } from 'react'
import { getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { useAnyFocused } from '../edge-focus'
import { EDGE_CORNER_RADIUS } from '../epic-layout'

// An Edge of straight horizontal and vertical segments with rounded corners, of the same radius as
// the "Blocked by" Edges (edge-types/RoutedEdge.tsx): the Binding lines (edges/bindings.ts) and the
// Subagent tree's lines (edges/subagents.ts). Unlike a "Blocked by" Edge it has no route laid out
// for it: React Flow's step path between the two handles.
//
// An Edge may ask to be drawn only while one of `showWith` is hovered or selected, or while all of
// them are in the lit Family of a hovered or selected Node (edge-focus.ts, worfy-canvas ticket 03):
// the Binding line of an agent that is not working now (worfy-week ticket 05). Without `showWith`
// it is always drawn.
export const kind = 'rounded-step'

/** What an edge of this type carries in `data`, besides its source's own fields. */
export interface StepEdgeData {
  [key: string]: unknown
  /** Node ids; the Edge is drawn only while one of them is hovered or selected, or all of them are in the lit Family. Absent: always drawn. */
  showWith?: readonly string[] | undefined
}

function StepEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style, interactionWidth }: EdgeProps) {
  const showWith = (data as StepEdgeData | undefined)?.showWith
  const focused = useAnyFocused(showWith)
  if (showWith !== undefined && !focused) return null
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: EDGE_CORNER_RADIUS })
  return (
    <>
      <path id={id} d={path} fill="none" className="react-flow__edge-path" style={style} markerEnd={markerEnd} data-shape="orthogonal" />
      {interactionWidth ? <path d={path} fill="none" strokeOpacity={0} strokeWidth={interactionWidth} className="react-flow__edge-interaction" /> : null}
    </>
  )
}

export default memo(StepEdge)
