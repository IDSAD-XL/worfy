// Pinning a Node to the screen (ticket 29). A pinned Node stays at its place on the screen while
// the Canvas pans and zooms, and keeps its size on the screen.
//
// The Layout keeps it simple: while `pinned` is true, the Node's x and y are screen coordinates
// of the Canvas (pixels from its top-left corner) instead of canvas units. Pinning converts the
// Node's canvas position to the screen point it is drawn at; unpinning converts the screen point
// back to the canvas point under it at that moment. Both go to main as one `pin` operation, so the
// flag and the position never disagree in layout.json.
//
// React Flow still draws a pinned Node, as one more Node of the plane: for every viewport,
// placePinned() moves it to the canvas point under its screen place and gives it its screen size
// in canvas units; NodeChrome.tsx scales its content back by 1/zoom.
import { useMemo } from 'react'
import { useStore, type XYPosition } from '@xyflow/react'
import type { LayoutNode, LayoutOpInput, Viewport } from '../../shared/layout/types'

/** Pinned Nodes are drawn above the rest of the plane. */
export const PINNED_Z_INDEX = 1000
export const PINNED_CLASS = 'w-pinned'

/** The screen point (relative to the Canvas) where a canvas point is drawn. */
export function canvasToScreen(point: XYPosition, viewport: Viewport): XYPosition {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }
}

/** The canvas point under a screen point (relative to the Canvas). */
export function screenToCanvas(point: XYPosition, viewport: Viewport): XYPosition {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }
}

export type PinOp = Extract<LayoutOpInput, { op: 'pin' }>

/** Pins an unpinned Node where the screen shows it now. */
export function pinOp(node: LayoutNode, viewport: Viewport): PinOp {
  const { x, y } = canvasToScreen(node, viewport)
  return { op: 'pin', id: node.id, pinned: true, x, y }
}

/** Puts a pinned Node on the canvas under its place on the screen. */
export function unpinOp(node: LayoutNode, viewport: Viewport): PinOp {
  const { x, y } = screenToCanvas(node, viewport)
  return { op: 'pin', id: node.id, pinned: false, x, y }
}

/** The part of a React Flow Node that placing touches. */
export interface PlaceableNode {
  position: XYPosition
  width?: number | undefined
  height?: number | undefined
  draggable?: boolean | undefined
  zIndex?: number | undefined
  className?: string | undefined
  data: { node: LayoutNode }
}

/**
 * The Nodes as React Flow should draw them under `viewport`: each pinned one at the canvas point
 * under its screen place, with its screen size in canvas units, above the others and not
 * draggable (it is moved by unpinning, dragging and pinning again). Unpinned Nodes are returned
 * as they are, and with nothing pinned the same array comes back.
 */
export function placePinned<T extends PlaceableNode>(nodes: T[], viewport: Viewport): T[] {
  if (!nodes.some((node) => node.data.node.pinned)) return nodes
  return nodes.map((node) => {
    const { pinned, w, h } = node.data.node
    if (!pinned) return node
    return {
      ...node,
      position: screenToCanvas(node.data.node, viewport),
      width: w / viewport.zoom,
      height: h / viewport.zoom,
      draggable: false,
      zIndex: PINNED_Z_INDEX,
      className: node.className === undefined ? PINNED_CLASS : `${node.className} ${PINNED_CLASS}`,
    }
  })
}

const viewportKey = (transform: readonly [number, number, number]): string => transform.join(' ')

function viewportOfKey(key: string): Viewport {
  const [x = 0, y = 0, zoom = 1] = key.split(' ').map(Number)
  return { x, y, zoom }
}

/**
 * placePinned() under the current viewport, inside a React Flow. Follows the viewport only while
 * some Node is pinned: otherwise panning does not re-render the caller.
 */
export function usePinnedPlacement<T extends PlaceableNode>(nodes: T[]): T[] {
  const anyPinned = nodes.some((node) => node.data.node.pinned)
  const key = useStore((state) => (anyPinned ? viewportKey(state.transform) : ''))
  return useMemo(() => (key === '' ? nodes : placePinned(nodes, viewportOfKey(key))), [nodes, key])
}

/** The current viewport while `pinned`, undefined otherwise (no re-render on pan for unpinned Nodes). */
export function usePinnedViewport(pinned: boolean): Viewport | undefined {
  const key = useStore((state) => (pinned ? viewportKey(state.transform) : ''))
  return key === '' ? undefined : viewportOfKey(key)
}
