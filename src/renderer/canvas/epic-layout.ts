// Where an Epic frame and its Tickets sit on the Canvas. Pure functions over the workflow model:
// no React, no IPC, nothing stored. The Layout keeps only the frame's offset from the place
// computed here and whether the frame is collapsed (ADR-0011, ADR-0037); the Tickets inside a
// frame are never moved by hand.
//
// Inside a frame: the header, then columns. "Done" comes first (one folded stack unless opened),
// then one column per dependency level, then "Needs attention" for Tickets whose blocking cannot
// be read. Levels count only Tickets that are not done: a done blocker no longer holds anything.
//
// The order inside the columns and the routes of the "Blocked by" Edges come from ELK in a Web
// Worker (elk/layout.ts, ADR-0037). `layoutEpic` here is the synchronous layout an Epic gets until
// ELK's first answer: Tickets by number, Edges without a route.
import { freePlace, NODE_GAP } from '../../shared/layout/free-place'
import type { Ticket } from '../../shared/workflow/types'
import { readyWave, ticketLevels } from '../../shared/workflow/waves'

export const TICKET_WIDTH = 204
/**
 * Lines of a Ticket's title before it is cut with "…"; the whole title is the title row's tooltip.
 * epic-frame.css clamps `.w-ticket__title` to the same number.
 */
export const TICKET_TITLE_LINES = 3
/**
 * Room for every row of a Ticket Node (epic-frame.css), so none is squeezed or cut: 1 px borders
 * (2) + padding (16) + number and state (18) + the title (TICKET_TITLE_LINES × 17) + the blockers
 * line or blocked reason (19) + badges (16) and actions (20) on two rows when one does not hold
 * both (4 between them) + the gaps between the four rows (3 × 4) = 158, rounded up.
 */
export const TICKET_HEIGHT = 160
export const COLUMN_GAP = 24
export const ROW_GAP = 12
export const FRAME_PADDING = 16
/** The frame's header row; a collapsed frame is exactly this tall. */
export const HEADER_HEIGHT = 56
/** Column labels sit between the header and the first Ticket. */
export const COLUMN_HEADER_HEIGHT = 36
export const DONE_STACK_HEIGHT = 120
/** Space between two frames: one under another in a column, and between the columns of the strip. */
export const FRAME_GAP = 48
/** A frame with no Tickets or a collapsed one is still this wide, so the header fits. */
export const MIN_FRAME_WIDTH = 520
/**
 * The frame header's parts beside its title at their widest: padding, the Epic tag, the progress
 * bar and count, "Run wave", "Autopilot", the collapse button and the gaps (453 px in the built
 * app on 2026-10-06), with some slack.
 */
export const HEADER_CHROME_WIDTH = 470
/** One character of the Epic's name in the header: 18 px monospace, 0.6 em. */
export const NAME_CHAR_WIDTH = 11
export const PROGRESS_SEGMENTS = 12
/** The largest radius of a rounded corner of an Edge's route. */
export const EDGE_CORNER_RADIUS = 8

export const TICKETS_TOP = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT

export interface Offset {
  dx: number
  dy: number
}

export interface Point {
  x: number
  y: number
}

export type TicketColumn = { kind: 'done' } | { kind: 'level'; level: number } | { kind: 'attention' }

/** Why a Ticket is in "Needs attention". */
export type AttentionReason =
  | { kind: 'unparsed'; raw: string | null }
  | { kind: 'missing-blocker'; missing: number[] }
  | { kind: 'cycle'; cycle: number[] }

export interface PlacedTicket {
  num: number
  column: TicketColumn
  /** Where the Ticket is drawn, relative to the frame's top-left corner. */
  x: number
  y: number
  /** In the ready Wave of the Epic. */
  ready: boolean
  attention: AttentionReason | null
}

export interface ColumnPlacement {
  column: TicketColumn
  label: string
  /** Tickets in the column, the folded done ones included. */
  count: number
  x: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface EpicLayout {
  width: number
  height: number
  collapsed: boolean
  columns: ColumnPlacement[]
  /** The Tickets drawn as Nodes; folded done Tickets and every Ticket of a collapsed frame are not. */
  tickets: PlacedTicket[]
  /** The folded done Tickets; null when there are none or the stack is open. */
  doneStack: (Box & { nums: number[] }) | null
  /** How many of the drawn Tickets are in the ready Wave ("Ready wave · N"). */
  readyCount: number
  /**
   * The route of each drawn "Blocked by" Edge, by `routeKey(blocker, blocked)`: points relative to
   * the frame's top-left corner, from the blocker's right side to the blocked Ticket's left side,
   * every segment horizontal or vertical. An Edge without a route is drawn straight between the
   * two Tickets (the synchronous layout before ELK's answer).
   */
  routes: Readonly<Record<string, readonly Point[]>>
}

/** What the layout reads of a Ticket. */
export type LayoutTicket = Pick<Ticket, 'epic' | 'num' | 'state' | 'blockedRaw' | 'blockedNums' | 'blockedParsed' | 'files' | 'filesListed'>

export interface EpicLayoutInput {
  /** The Tickets of one Epic. */
  tickets: readonly LayoutTicket[]
  collapsed: boolean
  /** The done stack is opened into a column of Tickets. */
  doneExpanded: boolean
  /** The Epic's name, which the header shows whole (`headerWidth`); defaults to its Tickets' Epic. */
  name?: string | undefined
}

export const routeKey = (blocker: number, blocked: number): string => `${blocker}->${blocked}`

const byNum = (a: { num: number }, b: { num: number }) => a.num - b.num

/**
 * Level and attention of each Ticket that is not done. A Ticket's own defect — an unreadable
 * "Blocked by", a blocker that is not in the Epic, a cycle among Tickets not done — sends it to
 * "Needs attention"; a Ticket blocked only by such Tickets keeps a level and ignores them.
 */
function placeOpenTickets(tickets: readonly LayoutTicket[]): Map<number, { level: number } | { attention: AttentionReason }> {
  const all = new Set(tickets.map((t) => t.num))
  const remaining = tickets.filter((t) => t.state !== 'done')
  const remainingNums = new Set(remaining.map((t) => t.num))

  const own = new Map<number, AttentionReason>()
  for (const t of remaining) {
    if (!t.blockedParsed && t.blockedRaw !== null) own.set(t.num, { kind: 'unparsed', raw: t.blockedRaw })
    else {
      const missing = t.blockedNums.filter((blocker) => !all.has(blocker))
      if (missing.length) own.set(t.num, { kind: 'missing-blocker', missing })
    }
  }

  // Edges among the Tickets that are not done and have no defect of their own; a cycle among them
  // is found by the same graph code that counts Waves.
  const deps = (t: LayoutTicket) => t.blockedNums.filter((blocker) => remainingNums.has(blocker) && !own.has(blocker))
  const graph = remaining
    .filter((t) => !own.has(t.num))
    .map((t) => ({ ...t, blockedNums: deps(t), blockedParsed: true, blockedRaw: null }))
  for (const [num, level] of ticketLevels(graph, graph[0]?.epic)) {
    if (level.kind === 'cycle') own.set(num, { kind: 'cycle', cycle: level.cycle })
  }

  const byNumber = new Map(remaining.map((t) => [t.num, t]))
  const levels = new Map<number, number>()
  const levelOf = (num: number): number => {
    const known = levels.get(num)
    if (known !== undefined) return known
    // Cycle members are in `own`, so this recursion never meets a cycle.
    const blockers = deps(byNumber.get(num)!).filter((blocker) => !own.has(blocker))
    const level = blockers.reduce((max, blocker) => Math.max(max, levelOf(blocker) + 1), 0)
    levels.set(num, level)
    return level
  }

  const result = new Map<number, { level: number } | { attention: AttentionReason }>()
  for (const t of remaining) {
    const attention = own.get(t.num)
    result.set(t.num, attention ? { attention } : { level: levelOf(t.num) })
  }
  return result
}

export interface EpicColumn {
  column: TicketColumn
  label: string
  /** By number. */
  tickets: LayoutTicket[]
}

export interface EpicColumns {
  columns: EpicColumn[]
  /** Numbers of the Tickets in the ready Wave. */
  ready: ReadonlySet<number>
  /** Why each Ticket in "Needs attention" is there. */
  attention: ReadonlyMap<number, AttentionReason>
}

/** The columns of a frame and the Tickets in each, by number; the same for every layout of the frame. */
export function epicColumns(tickets: readonly LayoutTicket[]): EpicColumns {
  const sorted = [...tickets].sort(byNum)
  const places = placeOpenTickets(sorted)
  const ready = new Set(readyWave(sorted, sorted[0]?.epic).ready.map((entry) => entry.num))
  const attention = new Map<number, AttentionReason>()
  for (const [num, place] of places) if ('attention' in place) attention.set(num, place.attention)

  const columns: EpicColumn[] = []
  const doneTickets = sorted.filter((t) => t.state === 'done')
  if (doneTickets.length) columns.push({ column: { kind: 'done' }, label: 'Done', tickets: doneTickets })
  let maxLevel = -1
  for (const place of places.values()) if ('level' in place) maxLevel = Math.max(maxLevel, place.level)
  for (let level = 0; level <= maxLevel; level += 1) {
    const inLevel = sorted.filter((t) => {
      const place = places.get(t.num)
      return place !== undefined && 'level' in place && place.level === level
    })
    columns.push({ column: { kind: 'level', level }, label: `Level ${level + 1}`, tickets: inLevel })
  }
  const inAttention = sorted.filter((t) => attention.has(t.num))
  if (inAttention.length) columns.push({ column: { kind: 'attention' }, label: 'Needs attention', tickets: inAttention })
  return { columns, ready, attention }
}

/** Every "Blocked by" Edge between two drawn Tickets, once per pair, as `blockingEdges` draws them. */
export function blockingPairs(tickets: readonly LayoutTicket[], drawn: ReadonlySet<number>): { blocker: number; blocked: number }[] {
  const pairs: { blocker: number; blocked: number }[] = []
  for (const t of [...tickets].sort(byNum)) {
    if (!drawn.has(t.num)) continue
    for (const blocker of new Set(t.blockedNums)) if (blocker !== t.num && drawn.has(blocker)) pairs.push({ blocker, blocked: t.num })
  }
  return pairs
}

const columnX = (index: number) => FRAME_PADDING + index * (TICKET_WIDTH + COLUMN_GAP)
/** A frame at least this wide shows the Epic's whole name in its header, beside the header's other parts. */
export const headerWidth = (name: string) => (name ? HEADER_CHROME_WIDTH + Math.ceil(name.length * NAME_CHAR_WIDTH) : 0)
const rowY = (index: number) => TICKETS_TOP + index * (TICKET_HEIGHT + ROW_GAP)

/** The frame's width: its columns' or the header's, at least MIN_FRAME_WIDTH. */
export const frameWidth = (contentWidth: number, name: string): number => Math.max(MIN_FRAME_WIDTH, contentWidth, headerWidth(name))

/** The layout of a collapsed frame, or of a frame without Tickets: its header and column labels only. */
export function headerOnly(columns: EpicColumns, collapsed: boolean, name: string): EpicLayout {
  const placedColumns = columns.columns.map((c, index) => ({ column: c.column, label: c.label, count: c.tickets.length, x: columnX(index) }))
  const contentWidth = columns.columns.length ? columnX(columns.columns.length - 1) + TICKET_WIDTH + FRAME_PADDING : 0
  const width = frameWidth(contentWidth, name)
  const height = collapsed ? HEADER_HEIGHT : TICKETS_TOP + FRAME_PADDING
  return { width, height, collapsed, columns: placedColumns, tickets: [], doneStack: null, readyCount: 0, routes: {} }
}

/**
 * The synchronous layout: Tickets by number in rows, Edges without a route. An Epic shows it until
 * ELK's first answer (ADR-0037); a collapsed frame and one without Tickets always show it.
 */
export function layoutEpic({ tickets, collapsed, doneExpanded, name }: EpicLayoutInput): EpicLayout {
  const columns = epicColumns(tickets)
  const epicName = name ?? columns.columns[0]?.tickets[0]?.epic ?? ''
  const shell = headerOnly(columns, collapsed, epicName)
  if (collapsed || !columns.columns.length) return shell

  const placed: PlacedTicket[] = []
  let doneStack: EpicLayout['doneStack'] = null
  let bottom = TICKETS_TOP
  columns.columns.forEach((c, index) => {
    const x = columnX(index)
    if (c.column.kind === 'done' && !doneExpanded) {
      doneStack = { x, y: TICKETS_TOP, width: TICKET_WIDTH, height: DONE_STACK_HEIGHT, nums: c.tickets.map((t) => t.num) }
      bottom = Math.max(bottom, TICKETS_TOP + DONE_STACK_HEIGHT)
      return
    }
    c.tickets.forEach((t, row) => {
      const y = rowY(row)
      placed.push({ num: t.num, column: c.column, x, y, ready: columns.ready.has(t.num), attention: columns.attention.get(t.num) ?? null })
      bottom = Math.max(bottom, y + TICKET_HEIGHT)
    })
  })

  return {
    ...shell,
    height: bottom + FRAME_PADDING,
    tickets: placed,
    doneStack,
    readyCount: placed.filter((t) => t.ready).length,
  }
}

/**
 * A route made relative to its frame, moved to where React Flow draws its ends: shifted so that it
 * starts at `source`, then its last point put on `target` (and the point before it moved along, so
 * the last segment stays horizontal or vertical). Moving the frame moves the route without
 * another layout; the handles' few pixels of difference from the Tickets' sides are absorbed by
 * the last segment.
 */
export function placeRoute(points: readonly Point[], source: Point, target: Point): Point[] {
  if (points.length < 2) return [source, target]
  const dx = source.x - points[0]!.x
  const dy = source.y - points[0]!.y
  const moved = points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  const last = moved[moved.length - 1]!
  const before = moved[moved.length - 2]!
  if (moved.length > 2 && before.y === last.y) before.y = target.y
  else if (moved.length > 2 && before.x === last.x) before.x = target.x
  moved[moved.length - 1] = { ...target }
  // A straight route whose ends no longer line up gets an elbow halfway rather than a slant.
  if (moved.length === 2 && source.x !== target.x && source.y !== target.y) {
    const middle = (source.x + target.x) / 2
    return [moved[0]!, { x: middle, y: source.y }, { x: middle, y: target.y }, moved[1]!]
  }
  return moved
}

/**
 * The SVG path of an orthogonal route: straight segments joined by rounded corners. A corner's
 * radius is at most `radius` and at most half of the shorter of its two segments, so two corners
 * on one segment never overlap. Repeated points and points in the middle of a straight run are
 * dropped first.
 */
export function orthogonalPath(points: readonly Point[], radius = EDGE_CORNER_RADIUS): string {
  const clean: Point[] = []
  for (const point of points) {
    const last = clean[clean.length - 1]
    if (last && last.x === point.x && last.y === point.y) continue
    const before = clean[clean.length - 2]
    // Three points in one line: the middle one is not a corner.
    if (before && last && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) clean[clean.length - 1] = point
    else clean.push(point)
  }
  const fmt = (n: number) => String(Math.round(n * 100) / 100)
  const at = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`
  if (clean.length === 0) return ''
  let path = `M ${at(clean[0]!)}`
  for (let i = 1; i < clean.length - 1; i += 1) {
    const prev = clean[i - 1]!
    const corner = clean[i]!
    const next = clean[i + 1]!
    const into = Math.hypot(corner.x - prev.x, corner.y - prev.y)
    const out = Math.hypot(next.x - corner.x, next.y - corner.y)
    const r = Math.min(radius, into / 2, out / 2)
    const enter = { x: corner.x - ((corner.x - prev.x) / into) * r, y: corner.y - ((corner.y - prev.y) / into) * r }
    const leave = { x: corner.x + ((next.x - corner.x) / out) * r, y: corner.y + ((next.y - corner.y) / out) * r }
    path += ` L ${at(enter)} Q ${at(corner)} ${at(leave)}`
  }
  if (clean.length > 1) path += ` L ${at(clean[clean.length - 1]!)}`
  return path
}

/** An Epic whose every Ticket is done starts collapsed, unless the user opened it. */
export function defaultCollapsed(tickets: readonly Pick<Ticket, 'state'>[]): boolean {
  return tickets.length > 0 && tickets.every((t) => t.state === 'done')
}

export interface PlacedFrame {
  x: number
  y: number
  /** The automatic place, without the manual offset. */
  auto: { x: number; y: number }
}

/** A Node on the plane, in canvas units. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The left edge of the frames' strip (ADR-0032, point 1; ADR-0075, point 2): the first x from 0
 * rightwards where a strip `width` wide (all its columns with the gaps between them), from y = 0
 * down to `bottom`, keeps FRAME_GAP from every Node on the plane on every side. Candidates are 0
 * and the right edge of each Node plus the gap; the rightmost one is always free.
 */
export function frameColumnX(width: number, bottom: number, plane: readonly Rect[]): number {
  const blocks = (x: number) => (node: Rect) =>
    node.y < bottom + FRAME_GAP && -FRAME_GAP < node.y + node.h && node.x < x + width + FRAME_GAP && x - FRAME_GAP < node.x + node.w
  const candidates = [0, ...plane.map((node) => node.x + node.w + FRAME_GAP).filter((x) => x > 0)].sort((a, b) => a - b)
  return candidates.find((x) => !plane.some(blocks(x))) ?? 0
}

export interface StackedFrame {
  epic: string
  width: number
  height: number
  /**
   * The height the strip keeps free for the frame: its height with the done stack open. Opening
   * or folding the done stack then neither moves the strip nor brings the frame onto a Node.
   * Defaults to `height`.
   */
  reserve?: number
  offset?: Offset
  /**
   * Where the frame's `epic-frame` Node is in the Layout: frames with an offset yield to each other
   * in this order (ADR-0038). Frames without it come after, in the given order.
   */
  order?: number
}

/**
 * The frames in a strip of `columns` columns (ADR-0075, point 1), in the given order: frame `i`
 * goes to column `i mod K`, and inside a column the frames lie one under another from y = 0 with
 * FRAME_GAP between them. Every column is as wide as the widest frame, FRAME_GAP apart, so a frame
 * that grows moves only the frames below it in its own column. K is at most the number of frames;
 * one column is the single column of ADR-0032. The strip stands where no Node on the plane is
 * (`frameColumnX`), as tall as its tallest column of reserved heights. A Node lower than that does
 * not move the strip. A manual offset moves its own frame only: the frames below keep their
 * automatic place, and the strip is found without the offsets. The window's size is no input: every
 * screen gets the same places.
 *
 * A frame with an offset yields (ADR-0038): when its place, the automatic one plus the offset,
 * comes closer than NODE_GAP to a Node on the plane, a frame of the strip or a frame with an
 * offset before it (`order`), the frame is drawn at the nearest clear place instead. The offset
 * itself is not changed; `auto` stays the automatic place. Each frame yields only to what comes
 * before it, so the answer for the same input is always the same.
 */
export function stackFrames(frames: readonly StackedFrame[], plane: readonly Rect[] = [], columns = 1): Map<string, PlacedFrame> {
  return placeStrip(frames, plane, columns).frames
}

/** The strip placed on the plane: its frames, and where the done shelf under it stands. */
export interface PlacedStrip {
  frames: Map<string, PlacedFrame>
  /** The strip's width: K columns with the gaps between them (0 without frames). */
  width: number
  /** The shelf's top-left corner: the strip's left edge, FRAME_GAP under its tallest column (0 without frames). */
  shelf: { x: number; y: number }
}

/**
 * stackFrames, with the done shelf (ADR-0075, point 5) under the strip: a shelf `shelfHeight` tall
 * stands at the strip's left edge, FRAME_GAP under the tallest column of reserved heights, and the
 * strip's place is found for the frames and the shelf together, so no Node on the plane is under
 * the shelf either. A frame with an offset yields to the shelf as to the frames of the strip. A
 * shelf height of 0 is no shelf: the strip is placed as stackFrames places it.
 */
export function placeStrip(frames: readonly StackedFrame[], plane: readonly Rect[] = [], columns = 1, shelfHeight = 0, shelfWidth = 0): PlacedStrip {
  const result = new Map<string, PlacedFrame>()
  const k = Math.max(1, Math.min(Math.floor(columns) || 1, frames.length || 1))
  const columnWidth = Math.max(0, ...frames.map((frame) => frame.width))
  const reserved = Array<number>(k).fill(0)
  frames.forEach((frame, index) => {
    reserved[index % k]! += (index >= k ? FRAME_GAP : 0) + Math.max(frame.height, frame.reserve ?? frame.height)
  })
  const stripWidth = frames.length === 0 ? 0 : k * columnWidth + (k - 1) * FRAME_GAP
  const tallest = Math.max(0, ...reserved)
  const shelfTop = frames.length === 0 ? 0 : tallest + FRAME_GAP
  const shelved = shelfHeight > 0
  const x = frameColumnX(Math.max(stripWidth, shelved ? shelfWidth : 0), shelved ? shelfTop + shelfHeight : tallest, plane)
  const taken: Rect[] = [...plane]
  if (shelved) taken.push({ x, y: shelfTop, w: shelfWidth, h: shelfHeight })
  const moved: { frame: StackedFrame; index: number; auto: { x: number; y: number } }[] = []
  const tops = Array<number>(k).fill(0)
  for (const [index, frame] of frames.entries()) {
    const column = index % k
    const auto = { x: x + column * (columnWidth + FRAME_GAP), y: tops[column]! }
    const dx = frame.offset?.dx ?? 0
    const dy = frame.offset?.dy ?? 0
    if (dx === 0 && dy === 0) {
      result.set(frame.epic, { x: auto.x, y: auto.y, auto })
      taken.push({ x: auto.x, y: auto.y, w: frame.width, h: frame.height })
    } else moved.push({ frame, index, auto })
    tops[column] = auto.y + frame.height + FRAME_GAP
  }
  moved.sort((a, b) => (a.frame.order ?? Infinity) - (b.frame.order ?? Infinity) || a.index - b.index)
  for (const { frame, auto } of moved) {
    const wanted = { x: auto.x + frame.offset!.dx, y: auto.y + frame.offset!.dy, w: frame.width, h: frame.height }
    const place = freePlace(wanted, taken, NODE_GAP)
    result.set(frame.epic, { x: place.x, y: place.y, auto })
    taken.push({ ...wanted, ...place })
  }
  return { frames: result, width: stripWidth, shelf: { x, y: shelfTop } }
}

// ── the done shelf (ADR-0075, point 5) ──────────────────────────────────────

/** Padding inside the shelf, around its label row and its chips. */
export const SHELF_PADDING = 12
/** The shelf's label row ("Done" and the number of Epics) above the chips. */
export const SHELF_LABEL_HEIGHT = 24
export const SHELF_CHIP_HEIGHT = 24
/** Between two chips of a row, and between two rows. */
export const SHELF_CHIP_GAP = 8
/** A shelf is at least this wide, like a frame: when every Epic is on it, the strip has no width. */
export const SHELF_MIN_WIDTH = MIN_FRAME_WIDTH
/**
 * One character of a chip's text: 12 px monospace, 0.6 em. The chip's parts beside the text: 1 px
 * borders (2), padding (2 × 8), the check icon (12) and the gaps after it and between the name and
 * the count (2 × 6), with 4 px of slack.
 */
export const SHELF_CHAR_WIDTH = 7.2
export const SHELF_CHIP_CHROME = 2 + 16 + 12 + 12 + 4

/** What the shelf shows of a done Epic. */
export interface ShelfEntry {
  epic: string
  done: number
  total: number
}

export interface PlacedChip extends ShelfEntry {
  /** Where the chip is drawn, relative to the shelf's top-left corner. */
  x: number
  y: number
  w: number
}

export interface ShelfLayout {
  width: number
  height: number
  chips: PlacedChip[]
}

/** The width of a chip "✓ <epic> N/N": its text in monospace and its chrome, never wider than `limit`. */
export function shelfChipWidth(entry: ShelfEntry, limit = Number.POSITIVE_INFINITY): number {
  const chars = entry.epic.length + `${entry.done}/${entry.total}`.length
  return Math.min(limit, Math.ceil(SHELF_CHIP_CHROME + chars * SHELF_CHAR_WIDTH))
}

/**
 * The shelf as wide as the strip (at least SHELF_MIN_WIDTH), its chips in the given order, left to
 * right, a new row when the next chip does not fit in the width. A chip wider than the shelf takes
 * a row of its own and is cut to the shelf's width (its text ends with an ellipsis). No entries: no
 * shelf, 0 × 0.
 */
export function layoutShelf(entries: readonly ShelfEntry[], stripWidth: number): ShelfLayout {
  if (entries.length === 0) return { width: 0, height: 0, chips: [] }
  const width = Math.max(SHELF_MIN_WIDTH, stripWidth)
  const inner = width - 2 * SHELF_PADDING
  const top = SHELF_PADDING + SHELF_LABEL_HEIGHT
  const chips: PlacedChip[] = []
  let x = SHELF_PADDING
  let row = 0
  for (const entry of entries) {
    const w = shelfChipWidth(entry, inner)
    // The first chip of a row always fits: it is at most `inner` wide.
    if (x + w > SHELF_PADDING + inner) {
      row += 1
      x = SHELF_PADDING
    }
    chips.push({ ...entry, x, y: top + row * (SHELF_CHIP_HEIGHT + SHELF_CHIP_GAP), w })
    x += w + SHELF_CHIP_GAP
  }
  const rows = row + 1
  return { width, height: top + rows * SHELF_CHIP_HEIGHT + row * SHELF_CHIP_GAP + SHELF_PADDING, chips }
}

/**
 * True for an Epic that goes to the done shelf instead of the strip (ADR-0075, point 5): it has
 * Tickets, every one of them is done, and its frame is collapsed — by the user, or by default
 * (defaultCollapsed). An open frame of a done Epic stays in the strip.
 */
export function onDoneShelf(tickets: readonly Pick<Ticket, 'state'>[], collapsed: boolean): boolean {
  return collapsed && tickets.length > 0 && tickets.every((t) => t.state === 'done')
}

export type SegmentState = 'done' | 'working' | 'blocked' | 'open' | 'empty'

export interface Progress {
  done: number
  working: number
  blocked: number
  open: number
  total: number
  /** PROGRESS_SEGMENTS segments, done first, then working, blocked and open. */
  segments: SegmentState[]
}

/** Counts by state and the 12-segment progress bar (largest remainder, so the segments add up). */
export function progressOf(tickets: readonly Pick<Ticket, 'state'>[]): Progress {
  const counts = { done: 0, working: 0, blocked: 0, open: 0 }
  for (const t of tickets) {
    if (t.state === 'done') counts.done += 1
    else if (t.state === 'work') counts.working += 1
    else if (t.state === 'blocked') counts.blocked += 1
    else counts.open += 1
  }
  const total = tickets.length
  if (!total) return { ...counts, total, segments: Array<SegmentState>(PROGRESS_SEGMENTS).fill('empty') }

  const order = ['done', 'working', 'blocked', 'open'] as const
  const exact = order.map((state) => (counts[state] * PROGRESS_SEGMENTS) / total)
  const whole = exact.map(Math.floor)
  let left = PROGRESS_SEGMENTS - whole.reduce((a, b) => a + b, 0)
  const byRemainder = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of byRemainder) {
    if (left <= 0) break
    whole[index]! += 1
    left -= 1
  }
  const segments = order.flatMap((state, index) => Array<SegmentState>(whole[index]!).fill(state))
  return { ...counts, total, segments }
}

/** The title without the number it usually starts with ("07 — Rate-limit bids" → "Rate-limit bids"); the number is shown apart. */
export function ticketTitle(ticket: Pick<Ticket, 'num' | 'title'>): string {
  const stripped = ticket.title.replace(new RegExp(`^\\s*0*${ticket.num}\\s*[—–:.-]\\s*`), '').trim()
  return stripped || ticket.title
}
