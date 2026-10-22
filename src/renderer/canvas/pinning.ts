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
// The selection toolbar takes the first place around the selection that covers nothing it must
// keep off — the header of an Epic frame with its column labels, the other Nodes, the Focus
// button: on top, beside on the right, beside on the left, or below the Focus button
// (clearToolbarPlacement()). Pinned Nodes are out of that rule on both ends: a pinned selection
// keeps its toolbar on top, and the toolbar of a selection on the plane does not avoid a pinned
// Node, which is drawn above it.
import { useCallback, useMemo, useRef, type CSSProperties } from 'react'
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
export type ToolbarSide = 'top' | 'right' | 'left' | 'bottom'

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

/**
 * Where a toolbar is drawn: the side of the selection and its distance from it, in screen pixels.
 * On top and below it is centred on the selection; beside it, level with the selection's top edge.
 */
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
  switch (placement.side) {
    case 'top':
      return { x: (bounds.left + bounds.right) / 2 - width / 2, y: bounds.top - gap - height, width, height }
    case 'bottom':
      return { x: (bounds.left + bounds.right) / 2 - width / 2, y: bounds.bottom + gap, width, height }
    case 'right':
      return { x: bounds.right + gap, y: bounds.top, width, height }
    case 'left':
      return { x: bounds.left - gap - width, y: bounds.top, width, height }
  }
}

/** The area two rectangles share; 0 when they only touch or are apart. */
function overlapArea(a: PlaneRect, b: PlaneRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/** What a selection's toolbar keeps off, on the plane. */
export interface ToolbarKeepOut {
  /** The header bands of the Epic frames (epicHeaderBand()). */
  bands: readonly PlaneRect[]
  /** The other visible Nodes: not selected, not pinned (drawn above the toolbar), not an Epic frame (its header band stands for it). */
  nodes: readonly PlaneRect[]
  /** The Focus button below the selection (overlays/FocusEntry.tsx): its screen size and distance from the selection. */
  focus: { size: ToolbarSize; offset: number } | null
}

/** Screen pixels between the selection and its toolbar: on top, beside it, and below (under the Focus button). */
export interface ToolbarOffsets {
  top: number
  side: number
  bottom: number
}

/** The places a selection's toolbar may take, in the order it tries them. */
export function toolbarCandidates(offsets: ToolbarOffsets): ToolbarPlacement[] {
  return [
    { side: 'top', offset: offsets.top },
    { side: 'right', offset: offsets.side },
    { side: 'left', offset: offsets.side },
    { side: 'bottom', offset: offsets.bottom },
  ]
}

/**
 * Where a selection's toolbar is drawn: the first of toolbarCandidates() — on top, on the right,
 * on the left, below the Focus button — that covers none of `keepOut`. The toolbar keeps its
 * screen size whatever the zoom, so at a low zoom it is taller in canvas units and reaches further.
 *
 * When every place covers something (a Ticket in the middle of an Epic frame's grid: the columns
 * stand 24 px apart, the rows 12 px, and the toolbar is about 200 px wide), it takes the place
 * that covers the least of the frame headers and the Focus button, and among those the least of
 * the other Nodes, by area; the earlier place on a tie.
 *
 * A selection with a pinned Node gets the first place whatever is there: it stays at its place on
 * the screen while the plane under it pans, so the toolbar would change sides as the Canvas moves,
 * and its toolbar is drawn above every Node of the plane (planeToolbarStyle()).
 */
export function clearToolbarPlacement(
  selection: readonly (PlaneRect & { pinned?: boolean })[],
  keepOut: ToolbarKeepOut,
  zoom: number,
  size: ToolbarSize,
  offsets: ToolbarOffsets,
): ToolbarPlacement {
  const candidates = toolbarCandidates(offsets)
  if (selection.some((rect) => rect.pinned === true)) return candidates[0]!
  const focus = keepOut.focus === null ? null : toolbarRect(selection, zoom, keepOut.focus.size, { side: 'bottom', offset: keepOut.focus.offset })
  const chrome = focus === null ? keepOut.bands : [...keepOut.bands, focus]
  let best = candidates[0]!
  let bestCost: [number, number] | null = null
  for (const placement of candidates) {
    const rect = toolbarRect(selection, zoom, size, placement)
    if (rect === null) return placement
    const sum = (zones: readonly PlaneRect[]): number => zones.reduce((total, zone) => total + overlapArea(rect, zone), 0)
    const cost: [number, number] = [sum(chrome), sum(keepOut.nodes)]
    if (cost[0] === 0 && cost[1] === 0) return placement
    if (bestCost === null || cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] < bestCost[1])) {
      best = placement
      bestCost = cost
    }
  }
  return best
}

/**
 * The style of a selection's toolbar inside React Flow's viewport: on the side of the selection's
 * bounds, `offset` screen pixels away — centred on top and below, level with the top edge on the
 * right and on the left (as toolbarRect()) — at its screen size whatever the zoom. Its z is
 * just under the pinned Nodes when the selection has none (above the unselected Nodes of the
 * plane, which it is the only one to overlap: it stands outside the selection's bounds), and
 * above the selection when it has one. Null for an empty selection.
 */
export function planeToolbarStyle(nodes: readonly ToolbarNode[], zoom: number, side: ToolbarSide, offset: number): CSSProperties | null {
  const bounds = boundsOf(nodes)
  if (bounds === null || !(zoom > 0)) return null
  const { left, right, top, bottom } = bounds
  const gap = offset / zoom
  const [x, y, shift] =
    side === 'top'
      ? [(left + right) / 2, top - gap, '-50%, -100%']
      : side === 'bottom'
        ? [(left + right) / 2, bottom + gap, '-50%, 0%']
        : side === 'right'
          ? [right + gap, top, '0%, 0%']
          : [left - gap, top, '-100%, 0%']
  const zIndex = nodes.some((node) => node.pinned) ? Math.max(...nodes.map((node) => node.z)) + 1 : PINNED_Z_INDEX - 1
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: '0 0',
    transform: `translate(${x}px, ${y}px) scale(${1 / zoom}) translate(${shift})`,
    zIndex,
    // React Flow's viewport takes no pointer events; the toolbar does.
    pointerEvents: 'all',
  }
}

/** Screen pixels between the selection and the Focus button below it (overlays/FocusEntry.tsx). */
export const FOCUS_ENTRY_OFFSET = 12
/**
 * The Focus button's size on the screen until FocusEntry.tsx has measured it: "Focus ⌘↩" in a
 * --row-height (28 px) button is about 80 px wide on macOS; the width has some slack for the font.
 */
export const FOCUS_ENTRY_SIZE: ToolbarSize = { width: 96, height: 28 }

/**
 * The Focus button's size on the screen as last measured (useFocusEntryMeasure()), for keeping the
 * selection toolbar off it; FOCUS_ENTRY_SIZE until then. Not a constant: the label differs by
 * platform ("Focus ⌘↩" on macOS, "Focus Ctrl+Enter" elsewhere) and by the font the system has, so
 * on Windows the button came out 104.5 px wide against a fixed 96. Kept when the button goes away
 * with the selection: the next selection's button has the same label.
 */
export const useFocusEntrySize = create<ToolbarSize>(() => FOCUS_ENTRY_SIZE)

/**
 * A ref callback for the Focus button that keeps useFocusEntrySize at its border box, rounded up to
 * whole pixels so a fractional width (104.5) is never kept off short. The layout size ignores the
 * button's scale(1 / zoom), which cancels the viewport's zoom: screen pixels. A zero size (the
 * button not laid out) leaves the last one.
 */
export function useFocusEntryMeasure(): (element: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null)
  return useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (element === null || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.borderBoxSize?.[0]
      const width = Math.ceil(box?.inlineSize ?? element.offsetWidth)
      const height = Math.ceil(box?.blockSize ?? element.offsetHeight)
      if (!(width > 0 && height > 0)) return
      const old = useFocusEntrySize.getState()
      if (old.width !== width || old.height !== height) useFocusEntrySize.setState({ width, height }, true)
    })
    observer.current.observe(element)
  }, [])
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
