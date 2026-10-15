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
// than when it was pinned), it is shown moved in, and unpinning puts it where it is shown. It is
// also kept out of the minimap's corner while the minimap is shown (ticket worfy-daily/12), so it
// never sits under it.
//
// React Flow still draws a pinned Node, as one more Node of the plane: for every viewport,
// placePinned() moves it to the canvas point under its screen place and gives it its screen size
// in canvas units; NodeChrome.tsx scales its content back by 1/zoom.
//
// The toolbars of a selection (overlays/SelectionToolbar.tsx above it, overlays/FocusEntry.tsx
// below it) are drawn among the Nodes, not over all of them: React Flow's NodeToolbar puts them
// over the whole plane, so another Node's toolbar covered a pinned Node. usePlaneToolbar() places
// them in React Flow's viewport instead, under the pinned Nodes unless the selection has one.
// The selection toolbar keeps off the header of an Epic frame and its column labels: over a
// Ticket of the frame's top row it goes below the selection (clearToolbarPlacement()).
import { useMemo, type CSSProperties } from 'react'
import { useStore, type InternalNode, type ReactFlowState, type XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import type { LayoutNode, LayoutOpInput, Viewport } from '../../shared/layout/types'
import { TICKETS_TOP } from './epic-layout'

/** Pinned Nodes are drawn above the rest of the plane. */
export const PINNED_Z_INDEX = 1000
export const PINNED_CLASS = 'w-pinned'

/** The box at the bottom right of the Canvas that a pinned Node keeps out of: the minimap with its margins. */
export interface CornerSize {
  width: number
  height: number
}

const useMinimapCorner = create<{ corner: CornerSize | undefined }>(() => ({ corner: undefined }))

/** Told by the minimap (overlays/MiniMapOverlay.tsx): its corner while it is shown, undefined while it is hidden. */
export function setMinimapCorner(corner: CornerSize | undefined): void {
  if (useMinimapCorner.getState().corner !== corner) useMinimapCorner.setState({ corner })
}

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
  /** The minimap's corner at the bottom right while the minimap is shown. */
  minimap?: CornerSize | undefined
}

/** The Canvas size in React Flow's store, with the minimap's corner of this moment. */
export function canvasSizeOf(state: Pick<ReactFlowState, 'width' | 'height'>): CanvasSize {
  return { width: state.width, height: state.height, minimap: useMinimapCorner.getState().corner }
}

/** `at` moved so that `length` fits in [0, room]; unchanged while `room` is unknown (0). */
function clampAxis(at: number, length: number, room: number): number {
  if (!(room > 0)) return at
  return Math.min(Math.max(at, 0), Math.max(0, room - length))
}

/**
 * A screen rectangle inside the Canvas moved out of the corner box at its bottom right, the
 * shorter way of the two (left or up) that keeps it inside the Canvas; as it is when it does not
 * overlap the box (touching is not overlapping) or when neither way fits.
 */
function outOfCorner(point: XYPosition, w: number, h: number, size: CanvasSize, corner: CornerSize): XYPosition {
  const left = size.width - corner.width
  const top = size.height - corner.height
  if (point.x + w <= left || point.y + h <= top) return point
  const ways = [
    { at: { x: left - w, y: point.y }, distance: point.x + w - left, fits: left - w >= 0 },
    { at: { x: point.x, y: top - h }, distance: point.y + h - top, fits: top - h >= 0 },
  ].filter((way) => way.fits)
  ways.sort((a, b) => a.distance - b.distance)
  return ways[0]?.at ?? point
}

/**
 * A screen rectangle moved inside the Canvas, as far as it fits, and out of the minimap's corner;
 * as it is while the size is unknown.
 */
function insideCanvas(point: XYPosition, w: number, h: number, size: CanvasSize | undefined): XYPosition {
  if (size === undefined) return { x: point.x, y: point.y }
  const inside = { x: clampAxis(point.x, w, size.width), y: clampAxis(point.y, h, size.height) }
  if (size.minimap === undefined || !(size.width > 0) || !(size.height > 0)) return inside
  return outOfCorner(inside, w, h, size, size.minimap)
}

/** Where a pinned Node is shown on the screen: its saved place, moved inside the Canvas and out of the minimap's corner. */
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
  const minimap = useMinimapCorner((store) => store.corner)
  return useMemo(() => {
    if (key === '') return nodes
    const { viewport, size } = viewOfKey(key)
    return placePinned(nodes, viewport, { ...size, minimap })
  }, [nodes, key, minimap])
}

/** The current viewport and Canvas size while `pinned`, undefined otherwise (no re-render on pan for unpinned Nodes). */
export function usePinnedView(pinned: boolean): PinnedView | undefined {
  const key = useStore((state) => (pinned ? viewKey(state) : ''))
  const minimap = useMinimapCorner((store) => (pinned ? store.corner : undefined))
  return useMemo(() => {
    if (key === '') return undefined
    const view = viewOfKey(key)
    return { viewport: view.viewport, size: { ...view.size, minimap } }
  }, [key, minimap])
}

/** The side of the selection a toolbar is drawn on. */
export type ToolbarSide = 'top' | 'bottom'

/** What placing a selection's toolbar needs of one selected Node, as React Flow has it. */
export interface ToolbarNode {
  /** Its rectangle on the plane, in canvas units. */
  x: number
  y: number
  width: number
  height: number
  /** React Flow's z of it: its zIndex, plus 1000 while it is selected. */
  z: number
  pinned: boolean
}

/** A rectangle on the plane, in canvas units. */
export interface PlaneRect {
  x: number
  y: number
  width: number
  height: number
}

/** A toolbar's size on the screen, in pixels: it keeps that size whatever the zoom. */
export interface ToolbarSize {
  width: number
  height: number
}

/** Where a toolbar is drawn: the side of the selection and its distance from it, in screen pixels. */
export interface ToolbarPlacement {
  side: ToolbarSide
  offset: number
}

/** The bounds of the rectangles; null for none. */
function boundsOf(rects: readonly PlaneRect[]): { left: number; right: number; top: number; bottom: number } | null {
  if (rects.length === 0) return null
  return {
    left: Math.min(...rects.map((rect) => rect.x)),
    right: Math.max(...rects.map((rect) => rect.x + rect.width)),
    top: Math.min(...rects.map((rect) => rect.y)),
    bottom: Math.max(...rects.map((rect) => rect.y + rect.height)),
  }
}

/** The part of an Epic frame a toolbar must not cover: its header row and the column labels under it. */
export function epicHeaderBand(frame: PlaneRect): PlaneRect {
  return { ...frame, height: Math.min(frame.height, TICKETS_TOP) }
}

/** The rectangle on the plane a toolbar of `size` covers at `placement`, as planeToolbarStyle() draws it. */
export function toolbarRect(selection: readonly PlaneRect[], zoom: number, size: ToolbarSize, placement: ToolbarPlacement): PlaneRect | null {
  const bounds = boundsOf(selection)
  if (bounds === null || !(zoom > 0)) return null
  // The toolbar is not scaled: its screen size is that many canvas units divided by the zoom.
  const width = size.width / zoom
  const height = size.height / zoom
  const gap = placement.offset / zoom
  const y = placement.side === 'top' ? bounds.top - gap - height : bounds.bottom + gap
  return { x: (bounds.left + bounds.right) / 2 - width / 2, y, width, height }
}

const overlaps = (a: PlaneRect, b: PlaneRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * The side a selection's toolbar is drawn on so that it covers none of `keepOut` (the header bands
 * of the Epic frames, epicHeaderBand()): on top, `top` screen pixels away, when it covers none
 * there; below, `bottom` pixels away, when it covers one on top and none below; on top again when
 * it covers one on both sides.
 */
export function clearToolbarPlacement(
  selection: readonly PlaneRect[],
  keepOut: readonly PlaneRect[],
  zoom: number,
  size: ToolbarSize,
  top: number,
  bottom: number,
): ToolbarPlacement {
  const above: ToolbarPlacement = { side: 'top', offset: top }
  const below: ToolbarPlacement = { side: 'bottom', offset: bottom }
  const covers = (placement: ToolbarPlacement): boolean => {
    const rect = toolbarRect(selection, zoom, size, placement)
    return rect !== null && keepOut.some((band) => overlaps(rect, band))
  }
  if (!covers(above)) return above
  return covers(below) ? above : below
}

/**
 * The style of a selection's toolbar inside React Flow's viewport: centred on the side of the
 * selection's bounds, `offset` screen pixels away, at its screen size whatever the zoom. Its z is
 * just under the pinned Nodes when the selection has none (above the unselected Nodes of the
 * plane, which it is the only one to overlap: it stands outside the selection's bounds), and
 * above the selection when it has one. Null for an empty selection.
 */
export function planeToolbarStyle(nodes: readonly ToolbarNode[], zoom: number, side: ToolbarSide, offset: number): CSSProperties | null {
  const bounds = boundsOf(nodes)
  if (bounds === null || !(zoom > 0)) return null
  const { left, right, top, bottom } = bounds
  const x = (left + right) / 2
  const y = side === 'top' ? top - offset / zoom : bottom + offset / zoom
  const shift = side === 'top' ? '-100%' : '0%'
  const zIndex = nodes.some((node) => node.pinned) ? Math.max(...nodes.map((node) => node.z)) + 1 : PINNED_Z_INDEX - 1
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: '0 0',
    transform: `translate(${x}px, ${y}px) scale(${1 / zoom}) translate(-50%, ${shift})`,
    zIndex,
    // React Flow's viewport takes no pointer events; the toolbar does.
    pointerEvents: 'all',
  }
}

/** A selected Node as placing its toolbar needs it; null while React Flow has not measured it. */
function toolbarNodeOf(node: InternalNode): ToolbarNode | null {
  const width = node.measured.width ?? node.width
  const height = node.measured.height ?? node.height
  if (width === undefined || height === undefined) return null
  const data = node.internals.userNode.data as { node?: Pick<LayoutNode, 'pinned'> } | undefined
  const { x, y } = node.internals.positionAbsolute
  return { x, y, width, height, z: node.internals.z, pinned: data?.node?.pinned === true }
}

/** Chooses where a toolbar goes from the selected Nodes and the zoom, as clearToolbarPlacement() does. */
export type PlaceToolbar = (nodes: readonly ToolbarNode[], zoom: number) => ToolbarPlacement

/**
 * planeToolbarStyle() of the Nodes `ids` under the current viewport, for a toolbar drawn in React
 * Flow's ViewportPortal; null while none of them is there and measured. `side` is a fixed side,
 * `offset` screen pixels away, or a function that chooses the side and the offset.
 */
export function usePlaneToolbar(ids: readonly string[], side: ToolbarSide | PlaceToolbar, offset: number): CSSProperties | null {
  const key = useStore((state) => {
    const nodes = ids.flatMap((id) => {
      const node = state.nodeLookup.get(id)
      const placed = node === undefined ? null : toolbarNodeOf(node)
      return placed === null ? [] : [placed]
    })
    const zoom = state.transform[2]
    const placement = typeof side === 'function' ? side(nodes, zoom) : { side, offset }
    return JSON.stringify(planeToolbarStyle(nodes, zoom, placement.side, placement.offset))
  })
  return useMemo(() => JSON.parse(key) as CSSProperties | null, [key])
}
