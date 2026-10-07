// The layout of an open Epic frame by ELK (ADR-0037): the frame's columns go to ELK's layered
// algorithm as partitions, so a Ticket's column is its dependency level and not one of ELK's
// layers; ELK orders the Tickets inside each column so that fewer Edges cross, and routes the
// "Blocked by" Edges orthogonally through the corridors between the columns, around the Tickets.
//
// ELK gets only the Edges that go forward, from one column to a later one. An Edge inside one
// column (done → done in the open stack, a cycle in "Needs attention") or back to an earlier
// column (from "Needs attention" to a level) is routed here, also orthogonally and around the
// Tickets: see `ownRoute`.
//
// The ELK instance is passed in: the app's runs in a Web Worker (client.ts), tests pass ELK
// without a worker (elkjs/lib/elk.bundled.js). Building the graph and reading the answer are
// cheap and run where the caller is.
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import {
  blockingPairs,
  COLUMN_GAP,
  DONE_STACK_HEIGHT,
  epicColumns,
  FRAME_PADDING,
  frameWidth,
  headerOnly,
  routeKey,
  ROW_GAP,
  TICKET_HEIGHT,
  TICKET_WIDTH,
  TICKETS_TOP,
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

/** The ELK graph of an open frame: one node per drawn Ticket (or the folded done stack) in its column's partition, and the forward Edges. */
export function elkGraph({ tickets, doneExpanded }: ElkEpicInput): { graph: ElkNode; own: { blocker: number; blocked: number }[] } {
  const { columns } = epicColumns(tickets)
  const columnOf = new Map<number, number>()
  const children: ElkNode[] = []
  columns.forEach((c, index) => {
    const partition = { 'elk.partitioning.partition': String(index) }
    if (c.column.kind === 'done' && !doneExpanded) {
      children.push({ id: DONE_STACK_ID, width: TICKET_WIDTH, height: DONE_STACK_HEIGHT, layoutOptions: partition })
      return
    }
    for (const t of c.tickets) {
      columnOf.set(t.num, index)
      children.push({
        id: nodeId(t.num),
        width: TICKET_WIDTH,
        height: TICKET_HEIGHT,
        layoutOptions: { ...partition, 'elk.portConstraints': 'FIXED_POS' },
        // The handles of TicketNode.tsx: the middle of the left side (in) and of the right side (out).
        ports: [
          { id: inPort(t.num), x: 0, y: TICKET_HEIGHT / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } },
          { id: outPort(t.num), x: TICKET_WIDTH, y: TICKET_HEIGHT / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } },
        ],
      })
    }
  })
  const edges: ElkExtendedEdge[] = []
  const own: { blocker: number; blocked: number }[] = []
  for (const pair of blockingPairs(tickets, new Set(columnOf.keys()))) {
    if (columnOf.get(pair.blocker)! < columnOf.get(pair.blocked)!) {
      edges.push({ id: routeKey(pair.blocker, pair.blocked), sources: [outPort(pair.blocker)], targets: [inPort(pair.blocked)] })
    } else own.push(pair)
  }
  return { graph: { id: 'frame', layoutOptions: LAYOUT_OPTIONS, children, edges }, own }
}

const pointsOf = (edge: ElkExtendedEdge): Point[] =>
  (edge.sections ?? []).flatMap((section, index) => [...(index === 0 ? [section.startPoint] : []), ...(section.bendPoints ?? []), section.endPoint]).map(({ x, y }) => ({ x, y }))

/**
 * The route of an Edge ELK does not get, around every Ticket: out of the blocker's right side into
 * the corridor right of its column, then across to the corridor left of the blocked Ticket's
 * column, and into its left side. Inside one column it crosses through the gap next to the
 * blocked Ticket, on the blocker's side; back to an earlier column it runs under every Ticket
 * (`below`).
 */
function ownRoute(from: PlacedTicket, to: PlacedTicket, sameColumn: boolean, column: readonly PlacedTicket[], below: number): Point[] {
  const start = { x: from.x + TICKET_WIDTH, y: from.y + TICKET_HEIGHT / 2 }
  const end = { x: to.x, y: to.y + TICKET_HEIGHT / 2 }
  let across = below
  if (sameColumn) {
    const above = from.y < to.y
    const neighbour = above
      ? column.filter((t) => t.y < to.y).reduce<PlacedTicket | null>((best, t) => (best === null || t.y > best.y ? t : best), null)
      : column.filter((t) => t.y > to.y).reduce<PlacedTicket | null>((best, t) => (best === null || t.y < best.y ? t : best), null)
    // `from` itself is on that side, so the neighbour always exists.
    across = above ? (neighbour!.y + TICKET_HEIGHT + to.y) / 2 : (to.y + TICKET_HEIGHT + neighbour!.y) / 2
  }
  return [
    start,
    { x: start.x + CORRIDOR_STEP, y: start.y },
    { x: start.x + CORRIDOR_STEP, y: across },
    { x: end.x - CORRIDOR_STEP, y: across },
    { x: end.x - CORRIDOR_STEP, y: end.y },
    end,
  ]
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

  const { graph, own } = elkGraph(input)
  const answer = await elk.layout(graph)
  const at = new Map((answer.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]))

  // A column's x is where ELK put its partition; every node of a partition shares it.
  const xs = columns.columns.map((c) => {
    const id = c.column.kind === 'done' && !input.doneExpanded ? DONE_STACK_ID : nodeId(c.tickets[0]!.num)
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
    for (const t of c.tickets) {
      const where = at.get(nodeId(t.num)) ?? { x: xs[index]!, y: TICKETS_TOP }
      // A column split over two of ELK's layers would draw a Ticket off its column, and the routes
      // made here assume one x per column: refuse the answer, the frame keeps its places.
      if (where.x !== xs[index]) throw new Error(`ELK put the Tickets of column "${c.label}" at more than one x`)
      placed.push({ num: t.num, column: c.column, x: where.x, y: where.y, ready: columns.ready.has(t.num), attention: columns.attention.get(t.num) ?? null })
      bottom = Math.max(bottom, where.y + TICKET_HEIGHT)
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
    if (!sameColumn) usesBelow = true
    routes[routeKey(blocker, blocked)] = ownRoute(from, to, sameColumn, placed.filter((t) => columnOf(t) === columnOf(to)), below)
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
