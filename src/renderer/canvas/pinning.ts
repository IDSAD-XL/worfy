// Pinning a Node to the screen (ticket 29). A pinned Node stays at its place on the screen while
// the Canvas pans and zooms, and keeps its size on the screen.
//
// The Layout keeps it simple: while `pinned` is true, the Node's x, y, w and h are pixels of the
// Canvas on the screen (x and y from its top-left corner) instead of canvas units. Pinning converts
// the Node's canvas rectangle to the screen rectangle it is drawn in; unpinning converts the screen
// rectangle back to the canvas rectangle under it at that moment, so neither moves nor resizes the
// Node on the screen. Both go to main as one `pin` operation, so the flag and the geometry never
// disagree in layout.json; main refuses `move` and `resize` for a pinned Node.
//
// A pinned Node is shown inside the Canvas: when its saved place sticks out (the window is smaller
// than when it was pinned), it is shown moved in, and unpinning puts it where it is shown.
//
// React Flow still draws a pinned Node, as one more Node of the plane: for every viewport,
// placePinned() moves it to the canvas point under its screen place and gives it its screen size
// in canvas units; NodeChrome.tsx scales its content back by 1/zoom.
import { useMemo } from 'react'
import { useStore, type ReactFlowState, type XYPosition } from '@xyflow/react'
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

/** The size of the Canvas on the screen; 0 while it is not measured yet. */
export interface CanvasSize {
  width: number
  height: number
}

/** `at` moved so that `length` fits in [0, room]; unchanged while `room` is unknown (0). */
function clampAxis(at: number, length: number, room: number): number {
  if (!(room > 0)) return at
  return Math.min(Math.max(at, 0), Math.max(0, room - length))
}

/** A screen rectangle moved inside the Canvas, as far as it fits; as it is while the size is unknown. */
function insideCanvas(point: XYPosition, w: number, h: number, size: CanvasSize | undefined): XYPosition {
  if (size === undefined) return { x: point.x, y: point.y }
  return { x: clampAxis(point.x, w, size.width), y: clampAxis(point.y, h, size.height) }
}

/** Where a pinned Node is shown on the screen: its saved place, moved inside the Canvas when it sticks out. */
export function pinnedScreenPoint(node: Pick<LayoutNode, 'x' | 'y' | 'w' | 'h'>, size: CanvasSize | undefined): XYPosition {
  return insideCanvas(node, node.w, node.h, size)
}

/** Pins an unpinned Node where the screen shows it now, at the size it is shown. */
export function pinOp(node: LayoutNode, viewport: Viewport, size?: CanvasSize): PinOp {
  const w = node.w * viewport.zoom
  const h = node.h * viewport.zoom
  const { x, y } = insideCanvas(canvasToScreen(node, viewport), w, h, size)
  return { op: 'pin', id: node.id, pinned: true, x, y, w, h }
}

/** Puts a pinned Node on the canvas under where it is shown, at the canvas size it is shown at. */
export function unpinOp(node: LayoutNode, viewport: Viewport, size?: CanvasSize): PinOp {
  const { x, y } = screenToCanvas(pinnedScreenPoint(node, size), viewport)
  return { op: 'pin', id: node.id, pinned: false, x, y, w: node.w / viewport.zoom, h: node.h / viewport.zoom }
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
 * under its screen place (moved inside a Canvas of `size`), with its screen size in canvas units,
 * above the others and not draggable (it is moved by unpinning, dragging and pinning again).
 * Unpinned Nodes are returned as they are, and with nothing pinned the same array comes back.
 */
export function placePinned<T extends PlaceableNode>(nodes: T[], viewport: Viewport, size?: CanvasSize): T[] {
  if (!nodes.some((node) => node.data.node.pinned)) return nodes
  return nodes.map((node) => {
    const { pinned, w, h } = node.data.node
    if (!pinned) return node
    return {
      ...node,
      position: screenToCanvas(pinnedScreenPoint(node.data.node, size), viewport),
      width: w / viewport.zoom,
      height: h / viewport.zoom,
      draggable: false,
      zIndex: PINNED_Z_INDEX,
      className: node.className === undefined ? PINNED_CLASS : `${node.className} ${PINNED_CLASS}`,
    }
  })
}

/** The viewport and the Canvas size of a render, as pinned Nodes are placed by them. */
export interface PinnedView {
  viewport: Viewport
  size: CanvasSize
}

/** One string for the store's viewport and size, so a selector returns an equal value until either changes. */
const viewKey = ({ transform, width, height }: ReactFlowState): string => [...transform, width, height].join(' ')

function viewOfKey(key: string): PinnedView {
  const [x = 0, y = 0, zoom = 1, width = 0, height = 0] = key.split(' ').map(Number)
  return { viewport: { x, y, zoom }, size: { width, height } }
}

/**
 * placePinned() under the current viewport and Canvas size, inside a React Flow. Follows them only
 * while some Node is pinned: otherwise panning does not re-render the caller.
 */
export function usePinnedPlacement<T extends PlaceableNode>(nodes: T[]): T[] {
  const anyPinned = nodes.some((node) => node.data.node.pinned)
  const key = useStore((state) => (anyPinned ? viewKey(state) : ''))
  return useMemo(() => {
    if (key === '') return nodes
    const { viewport, size } = viewOfKey(key)
    return placePinned(nodes, viewport, size)
  }, [nodes, key])
}

/** The current viewport and Canvas size while `pinned`, undefined otherwise (no re-render on pan for unpinned Nodes). */
export function usePinnedView(pinned: boolean): PinnedView | undefined {
  const key = useStore((state) => (pinned ? viewKey(state) : ''))
  return key === '' ? undefined : viewOfKey(key)
}
