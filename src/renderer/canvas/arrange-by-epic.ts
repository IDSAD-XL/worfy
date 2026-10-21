// "Arrange by Epic" (worfy-canvas ticket 12, owner's decisions 9 and 10): the Sessions on the plane
// line up in one column right of the strip of Epic frames, each Epic's Sessions — bound to the Epic
// or to one of its Tickets — from the height of its frame's header down (the rule of sessionSpot,
// session-spot.ts), the Sessions without a Binding in a cluster "Unbound" under the others. A
// Session bound to an Epic without a frame in the strip (its frame is on the done shelf) has no
// frame to stand at and goes to "Unbound" too.
//
// Only by the command, as one `moveMany` (one step of ⌘Z, arrange-by-epic-command.ts); main checks
// it like any operation (ADR-0038). It overrides the user's own places but for the Nodes the user
// asked to keep: a pinned Session (not on the plane) and one with Keep (ADR-0076) stay where they
// are. The Orchestrator, Cards, Notes, Terminals and HANDOFF are not Sessions and never move.
//
// How: a Session and its Subagent tree are one rectangle, as in "Tidy up" (tidy.ts, tidyItems); the
// rectangles of a cluster go one under another in reading order of their places now, ARRANGE_GAP
// apart, and the clusters CLUSTER_GAP apart: a cluster starts at its frame's height or under the
// cluster above, whichever is lower, so clusters never overlap. A rectangle that would crowd a Node
// that stays (or a frame the user moved) goes down past it. The column stands FRAME_GAP right of
// the strip where the strip will be once the Sessions have left its band (frameColumnX keeps the
// strip clear of the Nodes on the plane), so a Session that held the strip off to the right does
// not leave the column far from the frames. A second command on the result finds every Session in
// its place and sends nothing.
//
// Free of React and IPC: the unit tests read it under Node (tsconfig.test.node.json).
import { SESSION_NODE_KIND } from '../../shared/ipc/sessions'
import { onThePlane } from '../../shared/layout/derived'
import { crowds, NODE_GAP, type Rect } from '../../shared/layout/free-place'
import type { LayoutNode, LayoutOpInput } from '../../shared/layout/types'
import { FRAME_GAP, frameColumnX } from './epic-layout'
import type { SpotInputs } from './session-spot'

/** Room between two Sessions of a cluster: the gap "Tidy up" leaves (TIDY_GAP). */
export const ARRANGE_GAP = 24
/** Room between two clusters: the gap between two frames of the strip. */
export const CLUSTER_GAP = FRAME_GAP

export interface ArrangeInput {
  /** The Project's Layout Nodes. */
  nodes: readonly LayoutNode[]
  /** The Epic each bound Session Node is bound to, directly or through one of its Tickets, by Node id. */
  epics: ReadonlyMap<string, string>
  /** The frames, the strip and the frames moved off it, as the Canvas draws them now (spotInputs). */
  drawn: SpotInputs
  /** The block of each Session's Subagent tree, relative to its Node, by the Session's Node id (tidy.ts, naturalTreeBlocks). */
  trees?: ReadonlyMap<string, Rect>
}

interface Item {
  id: string
  /** The Session's Node with its tree. */
  rect: Rect
  /** Where the Node's corner is inside `rect`. */
  dx: number
  dy: number
}

/** The rectangle around a Session's Node and its tree, as tidyItems makes it (tidy.ts). */
function itemOf(node: LayoutNode, tree: Rect | undefined): Item {
  if (tree === undefined || tree.w <= 0 || tree.h <= 0) return { id: node.id, rect: { x: node.x, y: node.y, w: node.w, h: node.h }, dx: 0, dy: 0 }
  const left = Math.min(0, tree.x)
  const top = Math.min(0, tree.y)
  return { id: node.id, rect: { x: node.x + left, y: node.y + top, w: Math.max(node.w, tree.x + tree.w) - left, h: Math.max(node.h, tree.y + tree.h) - top }, dx: -left, dy: -top }
}

/** The first top from `y` down at which a rectangle `w` × `h` at `x` crowds none of `obstacles`. */
function clearFrom(x: number, y: number, w: number, h: number, obstacles: readonly Rect[]): number {
  let top = y
  for (;;) {
    const at = { x, y: top, w, h }
    const blocking = obstacles.filter((obstacle) => crowds(at, obstacle))
    if (blocking.length === 0) return top
    top = Math.ceil(Math.max(...blocking.map((obstacle) => obstacle.y + obstacle.h + NODE_GAP)))
  }
}

/**
 * The operation "Arrange by Epic" sends: one `moveMany` with the new place of every Session that is
 * not in it, or undefined when there is no strip of Epic frames, no Session to move, or every one
 * stands in its place already.
 */
export function arrangeByEpic({ nodes, epics, drawn, trees = new Map() }: ArrangeInput): LayoutOpInput | undefined {
  const { strip } = drawn
  if (strip === undefined) return undefined
  const moving = nodes.filter((node) => node.kind === SESSION_NODE_KIND && onThePlane(node) && node.keep !== true)
  if (moving.length === 0) return undefined
  const movingIds = new Set(moving.map((node) => node.id))

  // What stays on the plane: the Nodes and the trees of the Sessions that do not move.
  const staying: Rect[] = []
  for (const node of nodes) {
    if (movingIds.has(node.id) || !onThePlane(node)) continue
    staying.push({ x: node.x, y: node.y, w: node.w, h: node.h })
    const tree = trees.get(node.id)
    if (tree !== undefined && tree.w > 0 && tree.h > 0) staying.push({ x: node.x + tree.x, y: node.y + tree.y, w: tree.w, h: tree.h })
  }
  // Where the strip goes once the Sessions have left: the frames move with it, the column too.
  const width = strip.right - strip.x
  const stripX = frameColumnX(width, strip.bottom, staying)
  const shift = stripX - strip.x
  const column = Math.ceil(stripX + width + FRAME_GAP)
  const obstacles = [...staying, ...drawn.moved.map((frame) => ({ ...frame, x: frame.x + shift }))]

  const items = moving
    .map((node) => itemOf(node, trees.get(node.id)))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const frameOf = new Map(drawn.frames.map((frame, index) => [frame.epic, { y: frame.y, index }]))
  const clusters = new Map<string, Item[]>()
  const unbound: Item[] = []
  for (const item of items) {
    const epic = epics.get(item.id)
    if (epic === undefined || !frameOf.has(epic)) unbound.push(item)
    else clusters.set(epic, [...(clusters.get(epic) ?? []), item])
  }
  const ordered = [...clusters.entries()]
    .map(([epic, members]) => ({ top: Math.round(frameOf.get(epic)!.y), index: frameOf.get(epic)!.index, members }))
    .sort((a, b) => a.top - b.top || a.index - b.index)

  const places = new Map<string, { x: number; y: number }>()
  /** Lays a cluster's rectangles one under another from `top`; returns the bottom of the last one. */
  const lay = (members: readonly Item[], top: number): number => {
    let y = top
    let bottom = top
    for (const item of members) {
      const at = clearFrom(column, y, item.rect.w, item.rect.h, obstacles)
      places.set(item.id, { x: Math.round(column + item.dx), y: Math.round(at + item.dy) })
      bottom = at + item.rect.h
      y = bottom + ARRANGE_GAP
    }
    return bottom
  }
  let next: number | undefined
  for (const { top, members } of ordered) next = lay(members, Math.max(top, next ?? -Infinity)) + CLUSTER_GAP
  if (unbound.length > 0) lay(unbound, next ?? Math.round(strip.top))

  const byId = new Map(moving.map((node) => [node.id, node]))
  const moves = [...places].flatMap(([id, place]) => (byId.get(id)?.x === place.x && byId.get(id)?.y === place.y ? [] : [{ id, ...place }]))
  return moves.length === 0 ? undefined : { op: 'moveMany', moves }
}
