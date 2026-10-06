// Where an Epic frame and its Tickets sit on the Canvas. Pure functions over the workflow model:
// no React, no IPC, nothing stored. The Layout keeps only what the user changed by hand — a
// frame's or a Ticket's offset from the place computed here, and whether a frame is collapsed —
// so a recomputed place (a Ticket done, a blocker added) keeps the user's shift.
//
// Inside a frame: the header, then columns. "Done" comes first (one folded stack unless opened),
// then one column per dependency level, then "Needs attention" for Tickets whose blocking cannot
// be read. Levels count only Tickets that are not done: a done blocker no longer holds anything.
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
/** Vertical space between two frames. */
export const FRAME_GAP = 48
/** The ready-Wave box reaches this far around its Tickets. */
export const READY_MARGIN = 6
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

const TICKETS_TOP = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT

export interface Offset {
  dx: number
  dy: number
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
  /** The automatic place, relative to the frame's top-left corner. */
  auto: { x: number; y: number }
  /** Where the Ticket is drawn: the automatic place plus the manual offset. */
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
  /** Around the Tickets of the ready Wave; null when none is ready. */
  readyWave: (Box & { count: number }) | null
}

/** What the layout reads of a Ticket. */
export type LayoutTicket = Pick<Ticket, 'epic' | 'num' | 'state' | 'blockedRaw' | 'blockedNums' | 'blockedParsed' | 'files' | 'filesListed'>

export interface EpicLayoutInput {
  /** The Tickets of one Epic. */
  tickets: readonly LayoutTicket[]
  collapsed: boolean
  /** The done stack is opened into a column of Tickets. */
  doneExpanded: boolean
  /** Manual offsets by Ticket number. */
  offsets?: ReadonlyMap<number, Offset>
  /** The Epic's name, which the header shows whole (`headerWidth`); defaults to its Tickets' Epic. */
  name?: string
}

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

const columnX = (index: number) => FRAME_PADDING + index * (TICKET_WIDTH + COLUMN_GAP)
/** A frame at least this wide shows the Epic's whole name in its header, beside the header's other parts. */
export const headerWidth = (name: string) => (name ? HEADER_CHROME_WIDTH + Math.ceil(name.length * NAME_CHAR_WIDTH) : 0)
const rowY = (index: number) => TICKETS_TOP + index * (TICKET_HEIGHT + ROW_GAP)

export function layoutEpic({ tickets, collapsed, doneExpanded, offsets, name }: EpicLayoutInput): EpicLayout {
  const sorted = [...tickets].sort(byNum)
  const doneTickets = sorted.filter((t) => t.state === 'done')
  const places = placeOpenTickets(sorted)
  const ready = new Set(readyWave(sorted, sorted[0]?.epic).ready.map((entry) => entry.num))

  const columns: { column: TicketColumn; label: string; tickets: LayoutTicket[] }[] = []
  if (doneTickets.length) columns.push({ column: { kind: 'done' }, label: 'Done', tickets: doneTickets })
  let maxLevel = -1
  for (const place of places.values()) if ('level' in place) maxLevel = Math.max(maxLevel, place.level)
  for (let level = 0; level <= maxLevel; level += 1) {
    const inLevel = sorted.filter((t) => {
      const place = places.get(t.num)
      return place !== undefined && 'level' in place && place.level === level
    })
    // The ready Wave first, so one box can hold it.
    inLevel.sort((a, b) => Number(ready.has(b.num)) - Number(ready.has(a.num)) || a.num - b.num)
    columns.push({ column: { kind: 'level', level }, label: `Level ${level + 1}`, tickets: inLevel })
  }
  const attention = sorted.filter((t) => {
    const place = places.get(t.num)
    return place !== undefined && 'attention' in place
  })
  if (attention.length) columns.push({ column: { kind: 'attention' }, label: 'Needs attention', tickets: attention })

  const placedColumns = columns.map((c, index) => ({ column: c.column, label: c.label, count: c.tickets.length, x: columnX(index) }))
  const contentWidth = columns.length ? columnX(columns.length - 1) + TICKET_WIDTH + FRAME_PADDING : 0
  const width = Math.max(MIN_FRAME_WIDTH, contentWidth, headerWidth(name ?? sorted[0]?.epic ?? ''))

  if (collapsed) return { width, height: HEADER_HEIGHT, collapsed, columns: placedColumns, tickets: [], doneStack: null, readyWave: null }

  const placed: PlacedTicket[] = []
  let doneStack: EpicLayout['doneStack'] = null
  let bottom = TICKETS_TOP
  columns.forEach((c, index) => {
    const x = columnX(index)
    if (c.column.kind === 'done' && !doneExpanded) {
      doneStack = { x, y: TICKETS_TOP, width: TICKET_WIDTH, height: DONE_STACK_HEIGHT, nums: c.tickets.map((t) => t.num) }
      bottom = Math.max(bottom, TICKETS_TOP + DONE_STACK_HEIGHT)
      return
    }
    c.tickets.forEach((t, row) => {
      const auto = { x, y: rowY(row) }
      const offset = offsets?.get(t.num)
      const place = places.get(t.num)
      placed.push({
        num: t.num,
        column: c.column,
        auto,
        x: auto.x + (offset?.dx ?? 0),
        y: auto.y + (offset?.dy ?? 0),
        ready: ready.has(t.num),
        attention: place && 'attention' in place ? place.attention : null,
      })
      bottom = Math.max(bottom, auto.y + TICKET_HEIGHT)
    })
  })

  const readyPlaced = placed.filter((t) => t.ready)
  let readyBox: EpicLayout['readyWave'] = null
  if (readyPlaced.length) {
    const top = Math.min(...readyPlaced.map((t) => t.auto.y))
    const end = Math.max(...readyPlaced.map((t) => t.auto.y + TICKET_HEIGHT))
    const left = readyPlaced[0]!.auto.x
    readyBox = {
      x: left - READY_MARGIN,
      y: top - READY_MARGIN,
      width: TICKET_WIDTH + 2 * READY_MARGIN,
      height: end - top + 2 * READY_MARGIN,
      count: readyPlaced.length,
    }
  }

  const height = columns.length ? bottom + FRAME_PADDING : TICKETS_TOP + FRAME_PADDING
  return { width, height, collapsed, columns: placedColumns, tickets: placed, doneStack, readyWave: readyBox }
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
 * The left edge of the frames' column (ADR-0032): the first x from 0 rightwards where a strip as
 * wide as the widest frame, from y = 0 down to `bottom`, keeps FRAME_GAP from every Node on the
 * plane on every side. Candidates are 0 and the right edge of each Node plus the gap; the rightmost
 * one is always free.
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
   * The height the column keeps free for the frame: its height with the done stack open. Opening
   * or folding the done stack then neither moves the column nor brings the frame onto a Node.
   * Defaults to `height`.
   */
  reserve?: number
  offset?: Offset
}

/**
 * Frames one under another, in the given order, from y = 0, in a column that no Node on the plane
 * is in (`frameColumnX`), as tall as the frames' reserved heights. A Node lower than that does not
 * move the column. A manual offset moves its own frame only: the frames below keep their automatic
 * place, and the column is found without the offsets.
 */
export function stackFrames(frames: readonly StackedFrame[], plane: readonly Rect[] = []): Map<string, PlacedFrame> {
  const result = new Map<string, PlacedFrame>()
  const bottom = frames.reduce((sum, frame, index) => sum + (index ? FRAME_GAP : 0) + Math.max(frame.height, frame.reserve ?? frame.height), 0)
  const x = frameColumnX(Math.max(0, ...frames.map((frame) => frame.width)), bottom, plane)
  let y = 0
  for (const frame of frames) {
    const auto = { x, y }
    result.set(frame.epic, { x: auto.x + (frame.offset?.dx ?? 0), y: auto.y + (frame.offset?.dy ?? 0), auto })
    y += frame.height + FRAME_GAP
  }
  return result
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

/** The reason after `blocked` in a raw Status line: "blocked — needs keys" → "needs keys"; null when there is none. */
export function blockedReason(statusRaw: string | null): string | null {
  if (statusRaw === null) return null
  const rest = statusRaw
    .replace(/^\s*blocked\b/i, '')
    .replace(/^[\s—–:,;-]+/, '')
    .trim()
  return rest || null
}

/**
 * The Ticket's file, `<root>/.scratch/<epic>/issues/<NN>-<slug>.md`. The workflow model does not
 * carry the path; the number is written with at least two digits, as the Tickets of every
 * Project worfy knows are named.
 */
export function ticketFile(root: string, ticket: Pick<Ticket, 'epic' | 'num' | 'slug'>): string {
  return `${root}/.scratch/${ticket.epic}/issues/${String(ticket.num).padStart(2, '0')}-${ticket.slug}.md`
}

/** The title without the number it usually starts with ("07 — Rate-limit bids" → "Rate-limit bids"); the number is shown apart. */
export function ticketTitle(ticket: Pick<Ticket, 'num' | 'title'>): string {
  const stripped = ticket.title.replace(new RegExp(`^\\s*0*${ticket.num}\\s*[—–:.-]\\s*`), '').trim()
  return stripped || ticket.title
}
