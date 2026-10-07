// Snapping while a Node is dragged or resized (worfy-week ticket 06; decisions 18, 22 and 23 of the
// owner). Pure functions over rectangles in canvas units, plus the store the guides overlay reads.
//
// A drag goes through two steps, in this order:
//
// 1. Snapping proposes a place. On each axis the dragged Node's corner goes to the nearest of:
//    an alignment guide — its left edge, centre or right edge (top, centre, bottom on y) closer than
//    SNAP_PX screen pixels to the same line of a neighbour; an equal gap — its gap to the neighbour
//    next to it in its row (or column) closer than SNAP_PX to a gap between two other neighbours of
//    that row; otherwise the GRID. With ⌘ held there is no snapping at all.
// 2. The proposed place goes through the rule "Nodes never overlap" (ADR-0038) with the very function
//    main corrects the operation with (src/shared/layout/free-place.ts). Where that moves the Node,
//    a dashed outline shows where it will land, and the drop sends that place: main computes the
//    same place from it, so the outline promises nothing main will undo.
//
// A resize stops each edge NODE_GAP short of a neighbour while the mouse is still down, with the
// function main stops it with (stopResize).
import { create } from 'zustand'
import { freePlace, freeShift, obstaclesFor, stopResize, type Rect } from '../../shared/layout/free-place'
import type { LayoutNode } from '../../shared/layout/types'

/** The grid a dragged Node's top-left corner snaps to, in canvas units. */
export const GRID = 8

/** How close a line or a gap must be to snap, in screen pixels: at zoom 0.5 that is 12 canvas units. */
export const SNAP_PX = 6

/** Two values closer than this are the same line. */
const SAME = 1e-6

export type Axis = 'x' | 'y'

/** An alignment guide: a 1 px line at `at` on `axis` (on x, a vertical line), from `from` to `to` across. */
export interface Guide {
  axis: Axis
  at: number
  from: number
  to: number
}

/** A gap shown as equal to another: from `from` to `to` on `axis`, drawn at `at` across. */
export interface GapMark {
  axis: Axis
  from: number
  to: number
  at: number
}

export interface Snap {
  /** Where the rectangle's top-left corner goes. */
  x: number
  y: number
  guides: Guide[]
  gaps: GapMark[]
}

export const snapToGrid = (value: number): number => Math.round(value / GRID) * GRID

/** A rectangle seen along one axis: its start and size there, and its start and size across. */
interface Span {
  start: number
  size: number
  cross: number
  crossSize: number
}

const along = (rect: Rect, axis: Axis): Span =>
  axis === 'x' ? { start: rect.x, size: rect.w, cross: rect.y, crossSize: rect.h } : { start: rect.y, size: rect.h, cross: rect.x, crossSize: rect.w }

/** The three lines of a span: its start, centre and end. */
const linesOf = (span: Span): [number, number, number] => [span.start, span.start + span.size / 2, span.start + span.size]

const end = (span: Span): number => span.start + span.size

/** True when the two spans overlap across the axis: they are in one row (on x) or one column (on y). */
const sameRow = (a: Span, b: Span): boolean => a.cross < b.cross + b.crossSize && b.cross < a.cross + a.crossSize

/** The neighbours of the row next to `moving` on each side: the one before it with the furthest end, the one after it with the nearest start. */
function rowNeighbours(moving: Span, row: readonly Span[]): { before: Span | undefined; after: Span | undefined } {
  const centre = moving.start + moving.size / 2
  let before: Span | undefined
  let after: Span | undefined
  for (const span of row) {
    if (span.start + span.size / 2 < centre) {
      if (before === undefined || end(span) > end(before)) before = span
    } else if (after === undefined || span.start < after.start) after = span
  }
  return { before, after }
}

/** The gaps between neighbours of a row that follow each other on the axis, start order. */
function rowGaps(row: readonly Span[]): { from: Span; to: Span; size: number }[] {
  const sorted = [...row].sort((a, b) => a.start - b.start || end(a) - end(b))
  const gaps: { from: Span; to: Span; size: number }[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1]!
    const to = sorted[index]!
    if (to.start >= end(from) - SAME) gaps.push({ from, to, size: to.start - end(from) })
  }
  return gaps
}

/** The middle of the overlap of two spans across the axis: where a gap mark between them is drawn. */
const crossMiddle = (a: Span, b: Span): number => (Math.max(a.cross, b.cross) + Math.min(a.cross + a.crossSize, b.cross + b.crossSize)) / 2

/**
 * The shift on one axis that snaps `moving` to a guide or an equal gap closer than `threshold`, the
 * nearest one; a guide wins a tie. Undefined when nothing is that close.
 */
function snapShift(moving: Span, neighbours: readonly Span[], threshold: number): number | undefined {
  let best: number | undefined
  const consider = (shift: number) => {
    if (Math.abs(shift) < threshold && (best === undefined || Math.abs(shift) < Math.abs(best))) best = shift
  }
  const lines = linesOf(moving)
  for (const other of neighbours) {
    const theirs = linesOf(other)
    for (let index = 0; index < 3; index += 1) consider(theirs[index]! - lines[index]!)
  }
  const row = neighbours.filter((other) => sameRow(moving, other))
  const gaps = rowGaps(row)
  const { before, after } = rowNeighbours(moving, row)
  for (const gap of gaps) {
    if (gap.size <= 0) continue
    if (before !== undefined) consider(end(before) + gap.size - moving.start)
    if (after !== undefined) consider(after.start - gap.size - end(moving))
  }
  return best
}

/** The guides through `moving` where one of its lines is one of a neighbour's: one line per place, across both. */
function guidesOn(axis: Axis, moving: Span, neighbours: readonly Span[]): Guide[] {
  const lines = linesOf(moving)
  const byPlace = new Map<number, Guide>()
  for (const other of neighbours) {
    const theirs = linesOf(other)
    for (let index = 0; index < 3; index += 1) {
      if (Math.abs(theirs[index]! - lines[index]!) >= SAME) continue
      const at = lines[index]!
      const from = Math.min(moving.cross, other.cross)
      const to = Math.max(moving.cross + moving.crossSize, other.cross + other.crossSize)
      const guide = byPlace.get(at)
      byPlace.set(at, guide === undefined ? { axis, at, from, to } : { ...guide, from: Math.min(guide.from, from), to: Math.max(guide.to, to) })
    }
  }
  return [...byPlace.values()]
}

/** The gaps of the row equal to the gap between `moving` and the neighbour next to it, and that gap. */
function gapsOn(axis: Axis, moving: Span, neighbours: readonly Span[]): GapMark[] {
  const row = neighbours.filter((other) => sameRow(moving, other))
  const gaps = rowGaps(row).filter((gap) => gap.size > 0)
  const { before, after } = rowNeighbours(moving, row)
  const marks: GapMark[] = []
  const seen = new Set<string>()
  const mark = (from: Span, to: Span) => {
    const key = `${end(from)}:${to.start}:${crossMiddle(from, to)}`
    if (seen.has(key)) return
    seen.add(key)
    marks.push({ axis, from: end(from), to: to.start, at: crossMiddle(from, to) })
  }
  const sides: [Span, Span][] = []
  if (before !== undefined && moving.start > end(before)) sides.push([before, moving])
  if (after !== undefined && after.start > end(moving)) sides.push([moving, after])
  for (const [from, to] of sides) {
    const size = to.start - end(from)
    const equal = gaps.filter((gap) => Math.abs(gap.size - size) < SAME)
    if (equal.length === 0) continue
    mark(from, to)
    for (const gap of equal) mark(gap.from, gap.to)
  }
  return marks
}

/**
 * Where a rectangle dragged to `rect` snaps among `neighbours` at `zoom`: alignment guides and equal
 * gaps closer than SNAP_PX screen pixels, the grid otherwise, on each axis on its own. `free` (⌘
 * held) turns snapping off: the rectangle stays where it is, with no guides.
 */
export function snapRect(rect: Rect, neighbours: readonly Rect[], zoom: number, free = false): Snap {
  if (free) return { x: rect.x, y: rect.y, guides: [], gaps: [] }
  const threshold = SNAP_PX / zoom
  const place = { x: rect.x, y: rect.y }
  for (const axis of ['x', 'y'] as const) {
    const shift = snapShift(along(rect, axis), neighbours.map((other) => along(other, axis)), threshold)
    place[axis] = shift === undefined ? snapToGrid(rect[axis]) : rect[axis] + shift
  }
  const snapped = { ...rect, ...place }
  const guides: Guide[] = []
  const gaps: GapMark[] = []
  for (const axis of ['x', 'y'] as const) {
    const moving = along(snapped, axis)
    const others = neighbours.map((other) => along(other, axis))
    guides.push(...guidesOn(axis, moving, others))
    gaps.push(...gapsOn(axis, moving, others))
  }
  return { ...place, guides, gaps }
}

// ── a whole drag ────────────────────────────────────────────────────────────

/** A dragged Node at the place the mouse has put it. */
export interface Dragged {
  id: string
  rect: Rect
  /** A Layout Node, which main places; otherwise an Epic frame, which yields to everything (ADR-0038). */
  layout: boolean
}

export interface DragInput {
  /** The Node under the mouse: the group snaps by it. */
  lead: string
  dragged: readonly Dragged[]
  /** The Nodes on screen the lead snaps to. */
  neighbours: readonly Rect[]
  /** What main keeps a moved Layout Node clear of: every other Layout Node on the plane. */
  layoutObstacles: readonly Rect[]
  /** What an Epic frame keeps clear of: everything else on the plane. */
  planeObstacles: readonly Rect[]
  zoom: number
  /** ⌘ held: no snapping; the Nodes still never overlap. */
  free: boolean
}

export interface DragPlan {
  /** Where each dragged Node is shown while the mouse is down: the snapped place. */
  snapped: Map<string, { x: number; y: number }>
  /** Where each dragged Node lands on the drop: what is sent, and what main answers. */
  landing: Map<string, { x: number; y: number }>
  guides: Guide[]
  gaps: GapMark[]
  /** The rectangles where the Nodes land when that is not where they were snapped to; empty otherwise. */
  outline: Rect[]
}

/**
 * The snapped place and the landing place of every dragged Node. The group moves by the shift that
 * snaps the lead. Its Layout Nodes then move as one off every other Layout Node — freeShift, as main
 * corrects a `move` and a `moveMany` — and each Epic frame to its nearest place clear of everything
 * else, the Layout Nodes where they land included, as the frames' source places it (freePlace).
 */
export function planDrag(input: DragInput): DragPlan {
  const lead = input.dragged.find((each) => each.id === input.lead) ?? input.dragged[0]
  const empty: DragPlan = { snapped: new Map(), landing: new Map(), guides: [], gaps: [], outline: [] }
  if (lead === undefined) return empty
  const snap = snapRect(lead.rect, input.neighbours, input.zoom, input.free)
  const dx = snap.x - lead.rect.x
  const dy = snap.y - lead.rect.y
  const snapped = new Map(input.dragged.map((each) => [each.id, { x: each.rect.x + dx, y: each.rect.y + dy }]))
  const at = (each: Dragged): Rect => ({ ...each.rect, ...snapped.get(each.id)! })

  const group = input.dragged.filter((each) => each.layout)
  const shift = freeShift(group.map(at), input.layoutObstacles)
  const landing = new Map<string, { x: number; y: number }>()
  const landed: Rect[] = []
  for (const each of group) {
    const rect = at(each)
    const place = { x: rect.x + shift.dx, y: rect.y + shift.dy }
    landing.set(each.id, place)
    landed.push({ ...rect, ...place })
  }
  for (const each of input.dragged) {
    if (each.layout) continue
    const rect = at(each)
    const place = freePlace(rect, [...input.planeObstacles, ...landed])
    landing.set(each.id, place)
    landed.push({ ...rect, ...place })
  }
  const moved = input.dragged.some((each) => {
    const from = snapped.get(each.id)!
    const to = landing.get(each.id)!
    return from.x !== to.x || from.y !== to.y
  })
  return { snapped, landing, guides: snap.guides, gaps: snap.gaps, outline: moved ? landed : [] }
}

// ── resizing ────────────────────────────────────────────────────────────────

/** What a resized Layout Node keeps clear of: every other Layout Node on the plane, as main has them. */
export const resizeObstacles = (nodes: readonly LayoutNode[], id: string): Rect[] => obstaclesFor(nodes, new Set([id]))

/** The rectangle a resize from `before` to `after` shows and sends: each edge that ran into a neighbour stops NODE_GAP short of it. */
export const stopEdges = (before: Rect, after: Rect, obstacles: readonly Rect[]): Rect => stopResize(before, after, obstacles)

// ── what the overlay draws ──────────────────────────────────────────────────

export interface SnapGuidesState {
  guides: readonly Guide[]
  gaps: readonly GapMark[]
  outline: readonly Rect[]
}

const NOTHING: SnapGuidesState = { guides: [], gaps: [], outline: [] }

/** What overlays/SnapGuides.tsx draws: the guides, the gap marks and the landing outline of the drag going on. */
export const useSnapGuides = create<SnapGuidesState>(() => NOTHING)

export function showSnapGuides(plan: Pick<DragPlan, 'guides' | 'gaps' | 'outline'>): void {
  const { guides, gaps, outline } = plan
  const now = useSnapGuides.getState()
  // An empty state stays the same object, so a drag far from everything draws nothing again.
  if (guides.length === 0 && gaps.length === 0 && outline.length === 0) {
    if (now !== NOTHING) useSnapGuides.setState(NOTHING, true)
    return
  }
  useSnapGuides.setState({ guides, gaps, outline }, true)
}

/** The drop: the guides go out. */
export function clearSnapGuides(): void {
  if (useSnapGuides.getState() !== NOTHING) useSnapGuides.setState(NOTHING, true)
}
