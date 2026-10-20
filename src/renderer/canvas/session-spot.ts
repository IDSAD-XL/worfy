// Where a new Session with a Binding goes: right of the strip of Epic frames, at the height of its
// Ticket or of its Epic's frame header (worfy-canvas ticket 11). "Ship ticket" sends this spot to
// main with its launch (actions/TicketActions.tsx); a Session started outside worfy gets its Node
// on the first clear place from it (claude-home/session-nodes.ts). A Node already on the Canvas is
// never moved here: a Binding that shows up later leaves it where it stands.
//
// The spot is right of the whole strip, not of the bound frame: inside a strip of K columns the
// next column stands right of a frame, and a Node there would push the whole strip aside
// (frameColumnX keeps FRAME_GAP from every Node in the strip's band, ADR-0032, ADR-0075).
import type { BindingTarget } from '../../shared/binding/resolve'
import { DONE_SHELF_KIND, EPIC_FRAME_KIND, TICKET_KIND } from '../../shared/layout/derived'
import { NODE_GAP, type Rect } from '../../shared/layout/free-place'
import { FRAME_GAP, placeStrip } from './epic-layout'

/** An Epic frame of the strip, as drawn. */
export interface SpotFrame {
  epic: string
  /** The top of the frame's header, as drawn (with the user's offset). */
  y: number
  /** The top of each Ticket Node the frame shows, as drawn, by number. */
  tickets: ReadonlyMap<number, number>
}

/**
 * The strip of Epic frames with the done shelf under it: the room frameColumnX keeps free for them,
 * without the frames' manual offsets.
 */
export interface SpotStrip {
  x: number
  /** The right edge of the last column (its left edge plus the widest frame: every column is that wide), or of a wider shelf. */
  right: number
  top: number
  /** The bottom of the tallest column, each frame with its done stack open, or of the done shelf under it. */
  bottom: number
}

/**
 * The spot for a new Session bound to `binding`: FRAME_GAP right of the strip, at the top of the
 * bound Ticket (a Ticket Binding) or of the Epic frame's header (an Epic Binding). Undefined when
 * there is no Binding, no strip, or the Epic has no frame in the strip (its frame is on the Done
 * shelf, or the workflow model is not read yet), or a bound Ticket is not drawn; the Node then goes
 * where every other new Node goes.
 */
export function sessionSpot(binding: BindingTarget | null | undefined, frames: readonly SpotFrame[], strip: SpotStrip | undefined): { x: number; y: number } | undefined {
  if (binding == null || strip === undefined) return undefined
  const frame = frames.find((each) => each.epic === binding.epic)
  if (frame === undefined) return undefined
  const y = binding.kind === 'ticket' ? frame.tickets.get(binding.num) : frame.y
  if (y === undefined) return undefined
  return { x: Math.ceil(strip.right + FRAME_GAP), y: Math.round(y) }
}

/**
 * What spotInputs reads of a Node in React Flow's `nodeLookup` (an InternalNode of the Canvas):
 * an Epic frame's data carries its Epic and its automatic place (sources/epics.ts, EpicFrameData),
 * a Ticket's its Ticket (TicketNodeData). Written out here so this module stays free of React.
 */
export interface DrawnNode {
  type?: string | undefined
  width?: number | null | undefined
  height?: number | null | undefined
  internals: { positionAbsolute: { x: number; y: number } }
  data: { node?: { data?: Record<string, unknown> } }
}

interface DrawnFrame {
  epic: { epic: string }
  auto: { x: number; y: number }
}

interface DrawnTicket {
  ticket: { epic: string; num: number }
}

/** What spotInputs finds on the Canvas. */
export interface SpotInputs {
  frames: SpotFrame[]
  /** No frames: no strip. */
  strip: SpotStrip | undefined
  /** The frames the user moved off their automatic places, as drawn: they yield to a new Node (ADR-0038), so it keeps off them. */
  moved: Rect[]
}

/**
 * The frames and the strip as React Flow draws them now. The strip's columns start at the frames'
 * automatic places (`auto`). Its size is the one placeStrip gives the same frames, K and done shelf
 * (epic-layout.ts), so a Node kept off it never stands where frameColumnX would move the strip
 * away: each column as wide as the widest frame, each frame as tall as the strip keeps it
 * (`reserves`, by Epic: with its done stack open; without one, as drawn), the shelf FRAME_GAP under
 * the tallest column. No frames: no strip.
 */
export function spotInputs(nodes: Iterable<DrawnNode>, reserves?: ReadonlyMap<string, number>): SpotInputs {
  const frames = new Map<string, { epic: string; y: number; tickets: Map<number, number> }>()
  const strip: { epic: string; auto: { x: number; y: number }; width: number; height: number }[] = []
  const tickets: { epic: string; num: number; y: number }[] = []
  const moved: Rect[] = []
  let shelf = { w: 0, h: 0 }
  for (const node of nodes) {
    if (node.type === EPIC_FRAME_KIND) {
      const data = node.data.node?.data as DrawnFrame | undefined
      if (data === undefined) continue
      const width = node.width ?? 0
      const height = node.height ?? 0
      const at = node.internals.positionAbsolute
      strip.push({ epic: data.epic.epic, auto: data.auto, width, height })
      if (at.x !== data.auto.x || at.y !== data.auto.y) moved.push({ x: at.x, y: at.y, w: width, h: height })
      frames.set(data.epic.epic, { epic: data.epic.epic, y: at.y, tickets: new Map() })
    } else if (node.type === TICKET_KIND) {
      const data = node.data.node?.data as DrawnTicket | undefined
      if (data === undefined) continue
      const { ticket } = data
      tickets.push({ epic: ticket.epic, num: ticket.num, y: node.internals.positionAbsolute.y })
    } else if (node.type === DONE_SHELF_KIND) shelf = { w: node.width ?? 0, h: node.height ?? 0 }
  }
  for (const ticket of tickets) frames.get(ticket.epic)?.tickets.set(ticket.num, ticket.y)
  return { frames: [...frames.values()], strip: stripOf(strip, shelf, reserves), moved }
}

/**
 * The strip of these frames, from where they stand. Frame i of the strip's order stands in column
 * i mod K, so the columns (by `auto.x`) read row by row give an order with the same columns.
 */
function stripOf(
  frames: readonly { epic: string; auto: { x: number; y: number }; width: number; height: number }[],
  shelf: { w: number; h: number },
  reserves: ReadonlyMap<string, number> | undefined,
): SpotStrip | undefined {
  if (frames.length === 0) return undefined
  const lefts = [...new Set(frames.map((frame) => frame.auto.x))].sort((a, b) => a - b)
  const columns = lefts.map((x) => frames.filter((frame) => frame.auto.x === x).sort((a, b) => a.auto.y - b.auto.y))
  const rows = Math.max(...columns.map((column) => column.length))
  const rowMajor = Array.from({ length: rows }, (_, row) => columns.flatMap((column) => (column[row] === undefined ? [] : [column[row]!]))).flat()
  const placed = placeStrip(
    rowMajor.map((frame) => ({ epic: frame.epic, width: frame.width, height: frame.height, reserve: reserves?.get(frame.epic) })),
    [],
    columns.length,
    shelf.h,
    shelf.w,
  )
  const left = lefts[0]!
  const top = Math.min(...frames.map((frame) => frame.auto.y))
  const shelved = shelf.h > 0
  // placeStrip puts the shelf FRAME_GAP under the tallest column, frames or not.
  const bottom = shelved ? placed.shelf.y + shelf.h : placed.shelf.y - FRAME_GAP
  return { x: left, right: left + Math.max(placed.width, shelved ? shelf.w : 0), top, bottom: top + bottom }
}

/**
 * The strip's band as an obstacle for a Node placed with freePlace (which keeps NODE_GAP): grown
 * by FRAME_GAP - NODE_GAP on every side, so the Node keeps the FRAME_GAP the strip keeps from
 * every Node (frameColumnX) and the strip does not move away from it.
 */
export function stripKeepOut(strip: SpotStrip): Rect {
  const grow = FRAME_GAP - NODE_GAP
  return { x: strip.x - grow, y: strip.top - grow, w: strip.right - strip.x + 2 * grow, h: strip.bottom - strip.top + 2 * grow }
}

/** Everything a Node placed from a spot keeps clear of besides the Layout's Nodes: the strip's band and the frames moved off it. */
export function spotKeepOut({ strip, moved }: SpotInputs): Rect[] {
  return strip === undefined ? [] : [stripKeepOut(strip), ...moved]
}
