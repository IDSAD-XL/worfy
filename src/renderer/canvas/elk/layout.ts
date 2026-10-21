// The layout of an open Epic frame by ELK (ADR-0037): the frame's columns go to ELK's layered
// algorithm as partitions, so a Ticket's column is its dependency level and not one of ELK's
// layers; ELK orders the Tickets inside each column so that fewer Edges cross, and routes the
// "Blocked by" Edges orthogonally through the corridors between the columns, around the Tickets.
//
// ELK gets only the Edges that go forward between the columns of open Tickets. The Done column is
// one block for ELK of the folded stack's size whether the stack is folded or open, with no Edges
// (ADR-0039): ELK gets the same graph for both, so opening the stack moves no open Ticket. An Edge
// from a done blocker would make ELK pull the blocked Ticket down to its blocker's height, and a
// block as tall as the open column changes where ELK puts the Tickets beside it. An Edge from a done Ticket, one inside a column (done → done
// in the open stack, a cycle in "Needs attention") and one back to an earlier column (from "Needs
// attention" to a level) are routed here, also orthogonally and around the Tickets: see `ownRoute`.
//
// The ELK instance is passed in: the app's runs in a Web Worker (client.ts), tests pass ELK
// without a worker (elkjs/lib/elk.bundled.js). Building the graph and reading the answer are
// cheap and run where the caller is.
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import {
  blockingPairs,
  cardHeights,
  COLUMN_GAP,
  DONE_STACK_HEIGHT,
  epicColumns,
  FRAME_PADDING,
  frameWidth,
  headerOnly,
  routeKey,
  ROW_GAP,
  stackTops,
  TICKET_WIDTH,
  TICKETS_TOP,
  type CardContext,
  type EpicLayout,
  type LayoutTicket,
  type PlacedTicket,
  type Point,
} from '../epic-layout'

/** What this module needs of ELK: elkjs's `layout`. */
export interface ElkEngine {
  layout(graph: ElkNode): Promise<ElkNode>
}

export interface ElkEpicInput {
  tickets: readonly LayoutTicket[]
  doneExpanded: boolean
  name?: string | undefined
  /** What the cards' heights depend on beyond the Tickets (`cardHeights`). */
  cards?: CardContext | undefined
}

/** How far from a Ticket's side a route turns into the corridor. */
const CORRIDOR_STEP = 8
const DONE_STACK_ID = 'done-stack'

const nodeId = (num: number) => `t${num}`
const inPort = (num: number) => `t${num}:in`
const outPort = (num: number) => `t${num}:out`

const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.partitioning.activate': 'true',
  // One graph, not one per connected component: components laid out apart would each start their
  // partitions at the left edge, and a Ticket without Edges would leave its column.
  'elk.separateConnectedComponents': 'false',
  // Gaps no smaller than the synchronous layout's; ELK widens a corridor when its Edges need room.
  'elk.layered.spacing.nodeNodeBetweenLayers': String(COLUMN_GAP),
  'elk.spacing.nodeNode': String(ROW_GAP),
  'elk.spacing.edgeNode': String(ROW_GAP),
  'elk.spacing.edgeEdge': '8',
  'elk.layered.spacing.edgeNodeBetweenLayers': String(CORRIDOR_STEP),
  'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
  'elk.padding': `[top=${TICKETS_TOP},left=${FRAME_PADDING},bottom=${FRAME_PADDING},right=${FRAME_PADDING}]`,
}

/**
 * The ELK graph of an open frame: one node per open Ticket in its column's partition, the Done
 * column as one block of the folded stack's size (open or not: the frame's height holds the open
 * column, see `layoutEpicElk`), and the forward Edges between open Tickets. `own` are the Edges
 * routed here instead; `heights` the height of each card (`cardHeights`), its ELK node's height.
 */
export function elkGraph({ tickets, doneExpanded, cards }: ElkEpicInput): { graph: ElkNode; own: { blocker: number; blocked: number }[]; heights: Map<number, number> } {
  const epic = epicColumns(tickets)
  const { columns } = epic
  // Each card as tall as what it shows (ticket-card.ts): ELK keeps them apart by their own heights.
  const heights = cardHeights(tickets, epic, cards)
  const columnOf = new Map<number, number>()
  const doneNums = new Set<number>()
  const children: ElkNode[] = []
  columns.forEach((c, index) => {
    const partition = { 'elk.partitioning.partition': String(index) }
    if (c.column.kind === 'done') {
      children.push({ id: DONE_STACK_ID, width: TICKET_WIDTH, height: DONE_STACK_HEIGHT, layoutOptions: partition })
      if (!doneExpanded) return
      for (const t of c.tickets) {
        columnOf.set(t.num, index)
        doneNums.add(t.num)
      }
      return
    }
    for (const t of c.tickets) {
      columnOf.set(t.num, index)
      const height = heights.get(t.num)!
      children.push({
        id: nodeId(t.num),
        width: TICKET_WIDTH,
        height,
        layoutOptions: { ...partition, 'elk.portConstraints': 'FIXED_POS' },
        // The handles of TicketNode.tsx: the middle of the left side (in) and of the right side (out).
        ports: [
          { id: inPort(t.num), x: 0, y: height / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } },
          { id: outPort(t.num), x: TICKET_WIDTH, y: height / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } },
        ],
      })
    }
  })
  const edges: ElkExtendedEdge[] = []
  const own: { blocker: number; blocked: number }[] = []
  for (const pair of blockingPairs(tickets, new Set(columnOf.keys()))) {
    if (!doneNums.has(pair.blocker) && columnOf.get(pair.blocker)! < columnOf.get(pair.blocked)!) {
      edges.push({ id: routeKey(pair.blocker, pair.blocked), sources: [outPort(pair.blocker)], targets: [inPort(pair.blocked)] })
    } else own.push(pair)
  }
  return { graph: { id: 'frame', layoutOptions: LAYOUT_OPTIONS, children, edges }, own, heights }
}

const pointsOf = (edge: ElkExtendedEdge): Point[] =>
  (edge.sections ?? []).flatMap((section, index) => [...(index === 0 ? [section.startPoint] : []), ...(section.bendPoints ?? []), section.endPoint]).map(({ x, y }) => ({ x, y }))

/**
 * The height at which an Edge from `start` to `end`, a later column, crosses the columns between
 * them: the free height nearest to a straight line, so that it runs through no Ticket of those
 * columns. Free heights are the ends' own heights, the gaps between and around those Tickets, and
 * `below` every Ticket.
 */
function forwardAcross(start: Point, end: Point, placed: readonly PlacedTicket[], below: number): number {
  const between = placed.filter((t) => t.x > start.x && t.x < end.x)
  const clear = (y: number) => between.every((t) => y <= t.y || y >= t.y + t.height)
  const candidates = [end.y, start.y, ...between.flatMap((t) => [t.y - ROW_GAP / 2, t.y + t.height + ROW_GAP / 2])].filter(
    (y) => y > TICKETS_TOP - ROW_GAP && y < below && clear(y),
  )
  const cost = (y: number) => Math.abs(y - start.y) + Math.abs(y - end.y)
  return candidates.reduce((best, y) => (cost(y) < cost(best) ? y : best), below)
}

/**
 * The route of an Edge ELK does not get, around every Ticket: out of the blocker's right side into
 * the corridor right of its column, then across to the corridor left of the blocked Ticket's
 * column, and into its left side. Inside one column it crosses through the gap next to the
 * blocked Ticket, on the blocker's side; back to an earlier column it runs under every Ticket
 * (`below`); forward, from a done blocker, it crosses the columns between at a free height
 * (`forwardAcross`).
 */
function ownRoute(from: PlacedTicket, to: PlacedTicket, sameColumn: boolean, column: readonly PlacedTicket[], placed: readonly PlacedTicket[], below: number): Point[] {
  const start = { x: from.x + TICKET_WIDTH, y: from.y + from.height / 2 }
  const end = { x: to.x, y: to.y + to.height / 2 }
  let across = below
  if (!sameColumn && from.x < to.x) across = forwardAcross(start, end, placed, below)
  else if (sameColumn) {
    const above = from.y < to.y
    const neighbour = above
      ? column.filter((t) => t.y < to.y).reduce<PlacedTicket | null>((best, t) => (best === null || t.y > best.y ? t : best), null)
      : column.filter((t) => t.y > to.y).reduce<PlacedTicket | null>((best, t) => (best === null || t.y < best.y ? t : best), null)
    // `from` itself is on that side, so the neighbour always exists.
    across = above ? (neighbour!.y + neighbour!.height + to.y) / 2 : (to.y + to.height + neighbour!.y) / 2
  }
  const points = [
    start,
    { x: start.x + CORRIDOR_STEP, y: start.y },
    { x: start.x + CORRIDOR_STEP, y: across },
    { x: end.x - CORRIDOR_STEP, y: across },
    { x: end.x - CORRIDOR_STEP, y: end.y },
    end,
  ]
  // A forward Edge whose free height is one of its ends' runs straight there: drop the repeats.
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y)
}

/**
 * The layout of an open frame with at least one column, by ELK. A collapsed frame or one without
 * Tickets needs no ELK: `layoutEpic` gives it.
 */
export async function layoutEpicElk(input: ElkEpicInput, elk: ElkEngine): Promise<EpicLayout> {
  const columns = epicColumns(input.tickets)
  const name = input.name ?? columns.columns[0]?.tickets[0]?.epic ?? ''
  const shell = headerOnly(columns, false, name)
  if (!columns.columns.length) return shell

  const { graph, own, heights } = elkGraph(input)
  const answer = await elk.layout(graph)
  const at = new Map((answer.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]))

  // A column's x is where ELK put its partition; every node of a partition shares it.
  const xs = columns.columns.map((c) => {
    const id = c.column.kind === 'done' ? DONE_STACK_ID : nodeId(c.tickets[0]!.num)
    return at.get(id)?.x ?? 0
  })
  const placed: PlacedTicket[] = []
  let doneStack: EpicLayout['doneStack'] = null
  let bottom = TICKETS_TOP
  columns.columns.forEach((c, index) => {
    if (c.column.kind === 'done' && !input.doneExpanded) {
      const stack = at.get(DONE_STACK_ID) ?? { x: xs[index]!, y: TICKETS_TOP }
      doneStack = { x: stack.x, y: stack.y, width: TICKET_WIDTH, height: DONE_STACK_HEIGHT, nums: c.tickets.map((t) => t.num) }
      bottom = Math.max(bottom, stack.y + DONE_STACK_HEIGHT)
      return
    }
    if (c.column.kind === 'done') {
      // The open stack: its Tickets from the top of the column down, by number (ADR-0039). The block
      // ELK placed only holds the column's x: ELK may put it lower, beside the Tickets it lines up.
      const tops = stackTops(c.tickets.map((t) => heights.get(t.num)!))
      c.tickets.forEach((t, row) => {
        const y = tops[row]!
        const height = heights.get(t.num)!
        placed.push({ num: t.num, column: c.column, x: xs[index]!, y, height, ready: columns.ready.has(t.num), attention: columns.attention.get(t.num) ?? null })
        bottom = Math.max(bottom, y + height)
      })
      return
    }
    for (const t of c.tickets) {
      const where = at.get(nodeId(t.num)) ?? { x: xs[index]!, y: TICKETS_TOP }
      // A column split over two of ELK's layers would draw a Ticket off its column, and the routes
      // made here assume one x per column: refuse the answer, the frame keeps its places.
      if (where.x !== xs[index]) throw new Error(`ELK put the Tickets of column "${c.label}" at more than one x`)
      const height = heights.get(t.num)!
      placed.push({ num: t.num, column: c.column, x: where.x, y: where.y, height, ready: columns.ready.has(t.num), attention: columns.attention.get(t.num) ?? null })
      bottom = Math.max(bottom, where.y + height)
    }
  })

  const routes: Record<string, readonly Point[]> = {}
  for (const edge of answer.edges ?? []) {
    const points = pointsOf(edge)
    if (points.length >= 2) routes[edge.id] = points
  }
  const byNum = new Map(placed.map((t) => [t.num, t]))
  const columnOf = (t: PlacedTicket) => JSON.stringify(t.column)
  const below = bottom + ROW_GAP
  let usesBelow = false
  for (const { blocker, blocked } of own) {
    const from = byNum.get(blocker)!
    const to = byNum.get(blocked)!
    const sameColumn = columnOf(from) === columnOf(to)
    const route = ownRoute(from, to, sameColumn, placed.filter((t) => columnOf(t) === columnOf(to)), placed, below)
    if (route.some((p) => p.y === below)) usesBelow = true
    routes[routeKey(blocker, blocked)] = route
  }

  const height = Math.max(answer.height ?? 0, bottom + FRAME_PADDING, usesBelow ? below + FRAME_PADDING : 0)
  return {
    width: frameWidth(Math.max(answer.width ?? 0, xs[xs.length - 1]! + TICKET_WIDTH + FRAME_PADDING), name),
    height,
    collapsed: false,
    columns: shell.columns.map((c, index) => ({ ...c, x: xs[index]! })),
    tickets: placed,
    doneStack,
    readyCount: placed.filter((t) => t.ready).length,
    routes,
  }
}
