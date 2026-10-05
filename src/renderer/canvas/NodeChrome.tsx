// What the Canvas draws around every Node type's own component (ticket 29): the Node's tags in
// its header, and, for a Node pinned to the screen, the frame that keeps it at its screen size.
// Node type files (nodes/<Type>Node.tsx) know nothing of either.
import type { ComponentType } from 'react'
import type { CanvasNodeProps } from './nodes'
import { pinnedScreenPoint, screenToCanvas, usePinnedView } from './pinning'
import './node-chrome.css'

function TagStrip({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="w-node-tags" aria-label="Tags" data-testid="node-tags">
      {tags.map((tag) => (
        <li key={tag} className="w-node-tag">
          {tag}
        </li>
      ))}
    </ul>
  )
}

/**
 * A pinned Node's content at its screen size. React Flow gives the Node its screen size in canvas
 * units (pinning.ts); the frame is the Layout size and is scaled by 1/zoom. The frame also places
 * itself from the viewport of this very render, so it does not trail by a frame while the Canvas
 * pans: React Flow takes the Node's new position one render later.
 */
function PinnedFrame({ props, Component }: { props: CanvasNodeProps; Component: ComponentType<CanvasNodeProps> }) {
  const { node } = props.data
  const view = usePinnedView(true)
  const zoom = view?.viewport.zoom ?? 1
  const target = view ? screenToCanvas(pinnedScreenPoint(node, view.size), view.viewport) : { x: props.positionAbsoluteX, y: props.positionAbsoluteY }
  const dx = target.x - props.positionAbsoluteX
  const dy = target.y - props.positionAbsoluteY
  return (
    <div
      className="w-pinned-frame"
      data-testid="pinned-frame"
      style={{ width: node.w, height: node.h, transform: `translate(${dx}px, ${dy}px) scale(${1 / zoom})` }}
    >
      <Component {...props} />
      <TagStrip tags={node.tags} />
    </div>
  )
}

export interface NodeChromeProps extends CanvasNodeProps {
  /** The Node type's own component. */
  Component: ComponentType<CanvasNodeProps>
}

/** A Node type's own component with the Canvas's chrome around it (withNodeChrome.ts wraps every type in it). */
export function NodeChrome({ Component, ...props }: NodeChromeProps) {
  const { node } = props.data
  if (node.pinned) return <PinnedFrame props={props} Component={Component} />
  return (
    <>
      <Component {...props} />
      <TagStrip tags={node.tags} />
    </>
  )
}
