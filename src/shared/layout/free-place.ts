// Nodes never overlap (ADR-0038): where a Node, a group of Nodes or a resized edge goes so that it
// keeps NODE_GAP from every other Node on the plane. Pure functions over rectangles, no IPC and no
// React: main corrects every Layout operation with them (src/main/layout/store.ts), the read of a
// saved Layout removes its overlaps with them (src/main/layout/upgrade.ts), and the renderer makes
// the Derived Nodes yield with them (src/renderer/canvas/sources/epics.ts). The same input gives
// the same answer in main and in the renderer: ties between places at the same distance are broken
// by a fixed order (`better`), never by the order the candidates were found in.
import { onThePlane } from './derived'
import type { LayoutNode } from './types'

/** The room two Nodes on the plane keep between them, in canvas units (decision 25 of the owner). */
export const NODE_GAP = 16

/** A rectangle on the plane, in canvas units. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Shift {
  dx: number
  dy: number
}

/** Rounding slack: a rectangle placed exactly NODE_GAP off another is clear of it. */
const EPSILON = 1e-6

/**
 * Whether a Layout Node takes part: it is on the plane. A pinned Node is a layer over the screen,
 * a hidden one is not drawn, and a node source's Layout Node keeps an offset, not a place.
 */
export const isParticipant = onThePlane

/** True when `a` and `b` are closer than `gap` on both axes, that is, they overlap or nearly do. */
export const crowds = (a: Rect, b: Rect, gap: number = NODE_GAP): boolean =>
  a.x < b.x + b.w + gap - EPSILON && b.x < a.x + a.w + gap - EPSILON && a.y < b.y + b.h + gap - EPSILON && b.y < a.y + a.h + gap - EPSILON

const shifted = (rect: Rect, { dx, dy }: Shift): Rect => ({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h })

/** True when no rectangle of `moving`, shifted by `shift`, crowds a rectangle of `obstacles`. */
export function isClear(moving: readonly Rect[], obstacles: readonly Rect[], shift: Shift = { dx: 0, dy: 0 }, gap: number = NODE_GAP): boolean {
  for (const rect of moving) {
    const at = shifted(rect, shift)
    for (const other of obstacles) if (crowds(at, other, gap)) return false
  }
  return true
}

/** The order of two shifts: nearer first, then the one that moves less up or down, then the one more to the right, then the lower one. */
function better(a: Shift, b: Shift): boolean {
  const da = a.dx * a.dx + a.dy * a.dy
  const db = b.dx * b.dx + b.dy * b.dy
  if (da !== db) return da < db
  if (Math.abs(a.dy) !== Math.abs(b.dy)) return Math.abs(a.dy) < Math.abs(b.dy)
  if (a.dx !== b.dx) return a.dx > b.dx
  return a.dy > b.dy
}

/** The distinct values, nearest to zero first. */
const byDistance = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)

/**
 * The nearest shift that puts every rectangle of `moving` NODE_GAP clear of every rectangle of
 * `obstacles`, keeping the rectangles of `moving` where they are to each other. No shift when they
 * are clear already.
 *
 * The nearest clear place touches, with the gap, some obstacle's side on each axis it moved along:
 * the candidates on x are 0 and, for each moving rectangle and obstacle, the shifts that put the
 * rectangle just left or just right of the obstacle; the same on y. Every pair of candidates is a
 * candidate shift. The shift right of every obstacle is always clear, so the search starts with it
 * and only looks at nearer ones.
 */
export function freeShift(moving: readonly Rect[], obstacles: readonly Rect[], gap: number = NODE_GAP): Shift {
  const none = { dx: 0, dy: 0 }
  if (moving.length === 0 || obstacles.length === 0 || isClear(moving, obstacles, none, gap)) return none
  // Only obstacles within reach of the always clear shift can stop a nearer one.
  const left = Math.min(...moving.map((rect) => rect.x))
  const rightmost = Math.max(...obstacles.map((other) => other.x + other.w))
  let best: Shift = { dx: rightmost + gap - left, dy: 0 }
  const reach = best.dx
  const box = {
    x: Math.min(...moving.map((rect) => rect.x)) - reach - gap,
    y: Math.min(...moving.map((rect) => rect.y)) - reach - gap,
    right: Math.max(...moving.map((rect) => rect.x + rect.w)) + reach + gap,
    bottom: Math.max(...moving.map((rect) => rect.y + rect.h)) + reach + gap,
  }
  const near = obstacles.filter((other) => other.x < box.right && box.x < other.x + other.w && other.y < box.bottom && box.y < other.y + other.h)

  const xs: number[] = [0]
  const ys: number[] = [0]
  for (const rect of moving) {
    for (const other of near) {
      xs.push(other.x - gap - rect.w - rect.x, other.x + other.w + gap - rect.x)
      ys.push(other.y - gap - rect.h - rect.y, other.y + other.h + gap - rect.y)
    }
  }
  const sortedYs = byDistance(ys)
  for (const dx of byDistance(xs)) {
    const bestDistance = best.dx * best.dx + best.dy * best.dy
    if (dx * dx > bestDistance) break
    for (const dy of sortedYs) {
      const candidate = { dx, dy }
      if (dx * dx + dy * dy > best.dx * best.dx + best.dy * best.dy) break
      if (!better(candidate, best)) continue
      if (isClear(moving, near, candidate, gap)) best = candidate
    }
  }
  return best
}

/** The nearest place for `rect` where it keeps the gap from every rectangle of `obstacles`. */
export function freePlace(rect: Rect, obstacles: readonly Rect[], gap: number = NODE_GAP): { x: number; y: number } {
  const { dx, dy } = freeShift([rect], obstacles, gap)
  return { x: rect.x + dx, y: rect.y + dy }
}

/**
 * The rectangle a resize from `before` to `after` ends with: `after` when it is clear, otherwise
 * each edge that went out and ran into a neighbour stops `gap` short of it; the edges that did not
 * run into anything stay where `after` has them. When two edges could stop for one neighbour (a
 * corner dragged towards a Node diagonally), the one that gives up less stops. When `before` itself
 * was not clear, the resized rectangle goes to the nearest clear place as a whole.
 */
export function stopResize(before: Rect, after: Rect, obstacles: readonly Rect[], gap: number = NODE_GAP): Rect {
  if (isClear([after], obstacles, undefined, gap)) return after
  if (!isClear([before], obstacles, undefined, gap)) return { ...after, ...freePlace(after, obstacles, gap) }
  const edges = { left: after.x, top: after.y, right: after.x + after.w, bottom: after.y + after.h }
  const asRect = (): Rect => ({ x: edges.left, y: edges.top, w: edges.right - edges.left, h: edges.bottom - edges.top })
  for (let step = 0; step <= obstacles.length; step += 1) {
    const rect = asRect()
    const other = obstacles.find((each) => crowds(rect, each, gap))
    if (other === undefined) return rect
    // `before` was clear of `other`, so `other` lies past one of its sides that went out.
    const options: { edge: keyof typeof edges; to: number; gives: number }[] = []
    if (edges.right > before.x + before.w && other.x >= before.x + before.w + gap - EPSILON) {
      options.push({ edge: 'right', to: other.x - gap, gives: edges.right - (other.x - gap) })
    }
    if (edges.bottom > before.y + before.h && other.y >= before.y + before.h + gap - EPSILON) {
      options.push({ edge: 'bottom', to: other.y - gap, gives: edges.bottom - (other.y - gap) })
    }
    if (edges.left < before.x && other.x + other.w + gap <= before.x + EPSILON) {
      options.push({ edge: 'left', to: other.x + other.w + gap, gives: other.x + other.w + gap - edges.left })
    }
    if (edges.top < before.y && other.y + other.h + gap <= before.y + EPSILON) {
      options.push({ edge: 'top', to: other.y + other.h + gap, gives: other.y + other.h + gap - edges.top })
    }
    const option = options.reduce<(typeof options)[number] | undefined>((least, each) => (least === undefined || each.gives < least.gives ? each : least), undefined)
    if (option === undefined) return before
    edges[option.edge] = option.to
    if (edges.right <= edges.left || edges.bottom <= edges.top) return before
  }
  return isClear([asRect()], obstacles, undefined, gap) ? asRect() : before
}

/** A Node the read of a saved Layout moved off the Nodes before it. */
export interface NodeMove {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/**
 * The Layout's Nodes with their overlaps removed (decision 27 of the owner): the Nodes on the plane
 * are taken in the order of `nodes`, that is, the order they were created in. A Node moves only
 * when it is closer than the gap to where a Node taken before it ended up; it goes to its nearest
 * place clear of the earlier Nodes where they ended up and of the later Nodes where they are now,
 * so it never lands on a later Node that crowded nothing. The others stay; a later Node that
 * crowded only a Node that moved away stays too. Nodes off the plane are neither moved nor in the way.
 * Running it on its own answer moves nothing.
 */
export function removeOverlaps(nodes: readonly LayoutNode[], gap: number = NODE_GAP): { nodes: LayoutNode[]; moves: NodeMove[] } {
  const participants = nodes.filter(isParticipant)
  const placed: Rect[] = []
  const moves: NodeMove[] = []
  let taken = 0
  const result = nodes.map((node) => {
    if (!isParticipant(node)) return node
    taken += 1
    // Whether a Node moves depends only on the Nodes before it.
    if (isClear([node], placed, undefined, gap)) {
      placed.push(node)
      return node
    }
    const { dx, dy } = freeShift([node], [...placed, ...participants.slice(taken)], gap)
    const next = { ...node, x: node.x + dx, y: node.y + dy }
    moves.push({ id: node.id, from: { x: node.x, y: node.y }, to: { x: next.x, y: next.y } })
    placed.push(next)
    return next
  })
  return { nodes: result, moves }
}

/** The Layout Nodes on the plane but those in `skip`: what the Nodes in `skip` must keep clear of. */
export const obstaclesFor = (nodes: readonly LayoutNode[], skip: ReadonlySet<string>): LayoutNode[] => nodes.filter((node) => !skip.has(node.id) && isParticipant(node))
