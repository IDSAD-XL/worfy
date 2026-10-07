import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it } from 'vitest'
import { placeNear } from '../../src/shared/canvas/tools'
import { freePlace, NODE_GAP } from '../../src/shared/layout/free-place'
import type { Ticket } from '../../src/shared/workflow/types'
import {
  blockedReason,
  COLUMN_GAP,
  defaultCollapsed,
  EDGE_CORNER_RADIUS,
  FRAME_GAP,
  FRAME_PADDING,
  HEADER_CHROME_WIDTH,
  HEADER_HEIGHT,
  headerWidth,
  layoutEpic,
  MIN_FRAME_WIDTH,
  NAME_CHAR_WIDTH,
  orthogonalPath,
  progressOf,
  type Point,
  type Rect,
  ROW_GAP,
  routeKey,
  stackFrames,
  TICKET_HEIGHT,
  TICKET_WIDTH,
  type EpicLayout,
  ticketFile,
  ticketTitle,
  type PlacedTicket,
} from '../../src/renderer/canvas/epic-layout'
import { layoutEpicElk } from '../../src/renderer/canvas/elk/layout'

// ELK without a worker: the same layout code the app runs against the worker (ADR-0037).
const elk = new ELK()

/** A Ticket of epic `e` with the given number, state, blockers and files. */
function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'e',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [`src/t${num}.ts`],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

const blocked = (...nums: number[]): Partial<Ticket> => ({ blockedNums: nums, blockedRaw: nums.join(', ') })
const done: Partial<Ticket> = { state: 'done', statusRaw: 'done' }

/** The open frame of `tickets` as the app shows it once ELK answered. */
const laidOut = (tickets: readonly Ticket[], doneExpanded = false): Promise<EpicLayout> => layoutEpicElk({ tickets, doneExpanded }, elk)

function placed(layout: EpicLayout, num: number): PlacedTicket {
  const found = layout.tickets.find((t) => t.num === num)
  if (!found) throw new Error(`ticket ${num} is not shown`)
  return found
}

const sameColumn = (a: PlacedTicket['column'], b: PlacedTicket['column']) => JSON.stringify(a) === JSON.stringify(b)

/** Ticket numbers per column, in column order, as "label: nums" (by number: the order inside a column is ELK's). */
const columnsOf = (layout: EpicLayout): string[] =>
  layout.columns.map((column) => {
    const nums = layout.tickets
      .filter((t) => sameColumn(t.column, column.column))
      .map((t) => t.num)
      .sort((a, b) => a - b)
    return `${column.label}: ${nums.join(',')}`
  })

/**
 * Pairs of "Blocked by" Edges between the same two neighbouring columns whose ends come in the
 * opposite order: such two Edges cross between the columns, whatever their route.
 */
function crossings(layout: EpicLayout, tickets: readonly Ticket[]): number {
  const index = (num: number) => layout.columns.findIndex((c) => sameColumn(c.column, placed(layout, num).column))
  const edges = tickets.flatMap((t) => t.blockedNums.map((b) => [b, t.num] as const)).filter(([from, to]) => index(to) === index(from) + 1)
  let count = 0
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const [a, b] = edges[i]!
      const [c, d] = edges[j]!
      if (index(a) === index(c) && (placed(layout, a).y - placed(layout, c).y) * (placed(layout, b).y - placed(layout, d).y) < 0) count += 1
    }
  }
  return count
}

/** Whether a horizontal or vertical segment runs through the inside of a box (touching its border does not count). */
function through(a: Point, b: Point, box: Rect): boolean {
  const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
  const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
  if (a.y === b.y) return box.y < a.y && a.y < box.y + box.h && x1 < box.x + box.w && box.x < x2
  return box.x < a.x && a.x < box.x + box.w && y1 < box.y + box.h && box.y < y2
}

/** Every route of a layout: orthogonal, from the blocker's right handle to the blocked Ticket's left handle, through no Ticket and not through the done stack. */
function expectRoutesAroundTickets(layout: EpicLayout, tickets: readonly Ticket[]): number {
  const drawn = new Set(layout.tickets.map((t) => t.num))
  const boxes: (Rect & { num: number | null })[] = layout.tickets.map((t) => ({ num: t.num, x: t.x, y: t.y, w: TICKET_WIDTH, h: TICKET_HEIGHT }))
  if (layout.doneStack) boxes.push({ num: null, x: layout.doneStack.x, y: layout.doneStack.y, w: layout.doneStack.width, h: layout.doneStack.height })
  let count = 0
  for (const t of tickets) {
    for (const blocker of new Set(t.blockedNums)) {
      if (!drawn.has(t.num) || !drawn.has(blocker)) continue
      const route = layout.routes[routeKey(blocker, t.num)]
      expect(route, routeKey(blocker, t.num)).toBeDefined()
      const from = placed(layout, blocker)
      const to = placed(layout, t.num)
      expect(route![0]).toEqual({ x: from.x + TICKET_WIDTH, y: from.y + TICKET_HEIGHT / 2 })
      expect(route![route!.length - 1]).toEqual({ x: to.x, y: to.y + TICKET_HEIGHT / 2 })
      for (let i = 1; i < route!.length; i += 1) {
        const [a, b] = [route![i - 1]!, route![i]!]
        expect(a.x === b.x || a.y === b.y, `${routeKey(blocker, t.num)} segment ${i} is not orthogonal`).toBe(true)
        for (const box of boxes) expect(through(a, b, box), `${routeKey(blocker, t.num)} segment ${i} runs through ${box.num ?? 'the done stack'}`).toBe(false)
      }
      // Inside the frame.
      for (const point of route!) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(layout.width)
        expect(point.y).toBeLessThanOrEqual(layout.height)
      }
      count += 1
    }
  }
  return count
}

describe('layoutEpic by ELK', () => {
  // Six Tickets: by number, 02 → 04, 03 → 05 and 01 → 06 make two crossings between Level 1 and
  // Level 2; the order 06, 04, 05 makes none.
  const six = [ticket(1), ticket(2), ticket(3), ticket(4, blocked(2)), ticket(5, blocked(3)), ticket(6, blocked(1))]

  it('orders the Tickets in a column so that no Edges cross where an order without crossings exists', async () => {
    expect(crossings(layoutEpic({ tickets: six, collapsed: false, doneExpanded: false }), six)).toBe(2)
    const layout = await laidOut(six)
    expect(columnsOf(layout)).toEqual(['Level 1: 1,2,3', 'Level 2: 4,5,6'])
    expect(crossings(layout, six)).toBe(0)
  })

  it('routes every Edge orthogonally around the Tickets: past a Ticket of the middle column, in the open done stack, inside and back from "Needs attention"', async () => {
    // 01 → 03 skips Level 2, where 02 stands at the same height.
    const skip = [ticket(1), ticket(2, blocked(1)), ticket(3, blocked(1, 2))]
    const skipped = await laidOut(skip)
    expect(columnsOf(skipped)).toEqual(['Level 1: 1', 'Level 2: 2', 'Level 3: 3'])
    expect(expectRoutesAroundTickets(skipped, skip)).toBe(3)
    expect(skipped.routes[routeKey(1, 3)]!.length).toBeGreaterThan(2)

    const mixed = [
      ticket(1, done),
      ticket(2, { ...done, ...blocked(1) }),
      ticket(3, { ...done, ...blocked(1) }),
      ticket(4, blocked(2)),
      ticket(5, blocked(1, 4)),
      ticket(6, blocked(3, 4)),
      // "Needs attention": an unreadable line, and a cycle.
      ticket(7, { blockedRaw: 'after the release', blockedNums: [], blockedParsed: false }),
      ticket(8, blocked(9)),
      ticket(9, blocked(8, 4)),
      // Blocked by a Ticket in "Needs attention": keeps a level, its Edge goes back to the left.
      ticket(10, blocked(7, 4)),
    ]
    const open = await laidOut(mixed, true)
    expect(columnsOf(open)).toEqual(['Done: 1,2,3', 'Level 1: 4', 'Level 2: 5,6,10', 'Needs attention: 7,8,9'])
    expect(expectRoutesAroundTickets(open, mixed)).toBe(12)

    // The folded stack: no Edge starts at a done Ticket, none runs through the stack.
    const folded = await laidOut(mixed)
    expect(folded.doneStack).toMatchObject({ nums: [1, 2, 3], x: FRAME_PADDING })
    expect(expectRoutesAroundTickets(folded, mixed)).toBe(7)
  })

  it('keeps the columns: one x per column, left to right, no closer than the synchronous layout', async () => {
    const tickets = [ticket(1), ticket(2, blocked(1)), ticket(3, blocked(2)), ticket(4, blocked(1)), ticket(5, blocked(3, 4))]
    const layout = await laidOut(tickets)
    for (const t of layout.tickets) expect(t.x, `ticket ${t.num}`).toBe(layout.columns.find((c) => sameColumn(c.column, t.column))!.x)
    expect(layout.columns[0]!.x).toBe(FRAME_PADDING)
    layout.columns.slice(1).forEach((c, i) => expect(c.x - layout.columns[i]!.x).toBeGreaterThanOrEqual(TICKET_WIDTH + COLUMN_GAP))
    // Tickets of one column keep at least the row gap between them.
    for (const column of layout.columns) {
      const ys = layout.tickets.filter((t) => sameColumn(t.column, column.column)).map((t) => t.y).sort((a, b) => a - b)
      ys.slice(1).forEach((y, i) => expect(y - ys[i]!).toBeGreaterThanOrEqual(TICKET_HEIGHT + ROW_GAP))
    }
  })

  it('puts Tickets into columns by dependency level, counted over the Tickets that are not done', async () => {
    const tickets = [ticket(1), ticket(2, blocked(1)), ticket(3, blocked(2)), ticket(4, blocked(1)), ticket(5, blocked(3, 4))]
    const layout = await laidOut(tickets)
    expect(columnsOf(layout)).toEqual(['Level 1: 1', 'Level 2: 2,4', 'Level 3: 3', 'Level 4: 5'])
    expect(columnsOf(layoutEpic({ tickets, collapsed: false, doneExpanded: false }))).toEqual(columnsOf(layout))

    const withDone = tickets.map((t) => (t.num === 1 ? { ...t, ...done } : t))
    const next = await laidOut(withDone)
    // A done blocker no longer counts: 2 and 4 are on the first level now.
    expect(columnsOf(next)).toEqual(['Done: ', 'Level 1: 2,4', 'Level 2: 3', 'Level 3: 5'])
  })

  it('folds done Tickets into one stack that opens on request', async () => {
    const tickets = [ticket(1, done), ticket(2, done), ticket(3, blocked(1))]
    const folded = await laidOut(tickets)
    expect(folded.tickets.map((t) => t.num)).toEqual([3])
    expect(folded.doneStack).toMatchObject({ nums: [1, 2], x: FRAME_PADDING })
    expect(folded.columns[0]).toMatchObject({ column: { kind: 'done' }, label: 'Done', count: 2 })

    const open = await laidOut(tickets, true)
    expect(open.doneStack).toBeNull()
    expect(columnsOf(open)).toEqual(['Done: 1,2', 'Level 1: 3'])
  })

  it('moves Tickets with an unreadable "Blocked by", a blocker outside the Epic or a cycle to "Needs attention"', async () => {
    const tickets = [
      ticket(1),
      ticket(2, { blockedRaw: 'after the release', blockedNums: [], blockedParsed: false }),
      ticket(3, blocked(99)),
      ticket(4, blocked(5)),
      ticket(5, blocked(4)),
      // Its only blocker is in "Needs attention": the Ticket itself is fine and keeps a level.
      ticket(6, blocked(2, 1)),
    ]
    const layout = await laidOut(tickets)
    expect(columnsOf(layout)).toEqual(['Level 1: 1', 'Level 2: 6', 'Needs attention: 2,3,4,5'])
    expect(placed(layout, 2).attention).toEqual({ kind: 'unparsed', raw: 'after the release' })
    expect(placed(layout, 3).attention).toEqual({ kind: 'missing-blocker', missing: [99] })
    expect(placed(layout, 4).attention).toEqual({ kind: 'cycle', cycle: [4, 5] })
    expect(placed(layout, 1).attention).toBeNull()
  })

  it('does not count a cycle whose other members are done', async () => {
    const tickets = [ticket(1, { ...done, ...blocked(2) }), ticket(2, blocked(1))]
    const layout = await laidOut(tickets)
    expect(columnsOf(layout)).toEqual(['Done: ', 'Level 1: 2'])
    expect(placed(layout, 2).ready).toBe(true)
  })

  it('marks the ready Wave on its Tickets, not by their place', async () => {
    const tickets = [
      ticket(1, { state: 'work', statusRaw: 'claimed — 2026-10-05', files: ['src/shared.ts'] }),
      // Shares a file with the Ticket in work: waits, though nothing blocks it.
      ticket(2, { files: ['src/shared.ts'] }),
      ticket(3),
      ticket(4),
      ticket(5, blocked(3)),
    ]
    for (const layout of [await laidOut(tickets), layoutEpic({ tickets, collapsed: false, doneExpanded: false })]) {
      expect(columnsOf(layout)).toEqual(['Level 1: 1,2,3,4', 'Level 2: 5'])
      expect(layout.tickets.filter((t) => t.ready).map((t) => t.num)).toEqual([3, 4])
      expect(layout.readyCount).toBe(2)
    }
    // The synchronous layout keeps the number order: ready Tickets are not moved first.
    expect(layoutEpic({ tickets, collapsed: false, doneExpanded: false }).tickets.map((t) => t.num)).toEqual([1, 2, 3, 4, 5])
  })

  it('has no ready Tickets when nothing is ready', async () => {
    const layout = await laidOut([ticket(1, { state: 'work', statusRaw: 'claimed' })])
    expect(layout.readyCount).toBe(0)
  })

  it('makes the frame big enough for every Ticket and every route', async () => {
    const tickets = Array.from({ length: 30 }, (_, i) => ticket(i + 1, i % 3 ? blocked(i) : i > 6 ? blocked(i - 5) : {}))
    const layout = await laidOut(tickets)
    expect(layout.tickets).toHaveLength(30)
    for (const t of layout.tickets) {
      expect(t.x + TICKET_WIDTH + FRAME_PADDING).toBeLessThanOrEqual(layout.width)
      expect(t.y + TICKET_HEIGHT + FRAME_PADDING).toBeLessThanOrEqual(layout.height)
    }
    expectRoutesAroundTickets(layout, tickets)
  })

  // worfy-daily ticket 11: the header shows the Epic's whole name.
  it('widens a frame, open or collapsed, so the header holds the Epic name beside its other parts', async () => {
    const name = 'a-very-long-epic-name-for-the-sidebar-2026-10-06'
    const tickets = [ticket(1, { epic: name }), ticket(2, { epic: name, ...blocked(1) })]
    const wide = HEADER_CHROME_WIDTH + Math.ceil(name.length * NAME_CHAR_WIDTH)
    expect(headerWidth(name)).toBe(wide)
    expect(wide).toBeGreaterThan(MIN_FRAME_WIDTH)
    expect(layoutEpic({ tickets, collapsed: false, doneExpanded: false }).width).toBe(wide)
    expect((await laidOut(tickets)).width).toBe(wide)
    expect(layoutEpic({ tickets, collapsed: true, doneExpanded: false }).width).toBe(wide)
    // A frame without Tickets fits the name it is given; a short name keeps the minimal width.
    expect(layoutEpic({ tickets: [], collapsed: false, doneExpanded: false, name }).width).toBe(wide)
    expect(layoutEpic({ tickets: [], collapsed: false, doneExpanded: false }).width).toBe(MIN_FRAME_WIDTH)
    expect(layoutEpic({ tickets: [ticket(1, { epic: 'demo' })], collapsed: true, doneExpanded: false }).width).toBe(MIN_FRAME_WIDTH)
    // Columns wider than the header still decide.
    const many = Array.from({ length: 6 }, (_, i) => ticket(i + 1, { epic: name, ...(i ? blocked(i) : {}) }))
    expect(layoutEpic({ tickets: many, collapsed: false, doneExpanded: false }).width).toBe(FRAME_PADDING + 6 * TICKET_WIDTH + 5 * COLUMN_GAP + FRAME_PADDING)
    expect((await laidOut(many)).width).toBeGreaterThanOrEqual(FRAME_PADDING + 6 * TICKET_WIDTH + 5 * COLUMN_GAP + FRAME_PADDING)
  })

  it('shows only the header of a collapsed Epic', () => {
    const layout = layoutEpic({ tickets: [ticket(1), ticket(2, blocked(1))], collapsed: true, doneExpanded: false })
    expect(layout.tickets).toEqual([])
    expect(layout.doneStack).toBeNull()
    expect(layout.readyCount).toBe(0)
    expect(layout.height).toBe(HEADER_HEIGHT)
  })
})

describe('orthogonalPath', () => {
  /** The corners of a path: each `L a b Q cx cy x y` as the points it joins. */
  const corners = (path: string) =>
    [...path.matchAll(/L ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g)].map((m) => {
      const [enter, corner, leave] = [0, 2, 4].map((i) => ({ x: Number(m[i + 1]), y: Number(m[i + 2]) }))
      return { enter: enter!, corner: corner!, leave: leave! }
    })

  it('rounds each corner with at most the radius and at most half the shorter neighbouring segment', () => {
    // Segments of 40, 10, 100 and 6.
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 140, y: 10 },
      { x: 140, y: 16 },
    ]
    const path = orthogonalPath(points)
    expect(path.startsWith('M 0 0 ')).toBe(true)
    expect(path.endsWith('L 140 16')).toBe(true)
    const found = corners(path)
    expect(found.map((c) => c.corner)).toEqual(points.slice(1, -1))
    const radii = found.map(({ enter, corner, leave }) => {
      const into = Math.hypot(corner.x - enter.x, corner.y - enter.y)
      expect(Math.hypot(leave.x - corner.x, leave.y - corner.y)).toBeCloseTo(into)
      return into
    })
    // 40 and 10 → 5; 10 and 100 → 5; 100 and 6 → 3.
    expect(radii).toEqual([5, 5, 3])
    for (const r of radii) expect(r).toBeLessThanOrEqual(EDGE_CORNER_RADIUS)
    // Long segments get the full radius.
    expect(corners(orthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]))[0]!.enter).toEqual({ x: 100 - EDGE_CORNER_RADIUS, y: 0 })
  })

  it('drops repeated points and points in the middle of a straight run', () => {
    expect(orthogonalPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])).toBe('M 0 0 L 100 0')
    expect(orthogonalPath([])).toBe('')
  })
})


describe('defaultCollapsed', () => {
  it('folds an Epic whose every Ticket is done', () => {
    expect(defaultCollapsed([ticket(1, done), ticket(2, done)])).toBe(true)
    expect(defaultCollapsed([ticket(1, done), ticket(2)])).toBe(false)
    expect(defaultCollapsed([])).toBe(false)
  })
})

describe('stackFrames', () => {
  it('stacks frames top to bottom; a manual offset moves only its own frame', () => {
    const frames = [
      { epic: 'a', width: 520, height: 300 },
      // Down by less than the room to `c` minus the gap: the frame stays clear of `c` (ADR-0038).
      { epic: 'b', width: 520, height: 56, offset: { dx: 100, dy: 20 } },
      { epic: 'c', width: 520, height: 200 },
    ]
    const placed = stackFrames(frames)
    expect(placed.get('a')).toEqual({ x: 0, y: 0, auto: { x: 0, y: 0 } })
    expect(placed.get('b')).toEqual({ x: 100, y: 300 + FRAME_GAP + 20, auto: { x: 0, y: 300 + FRAME_GAP } })
    expect(placed.get('c')).toEqual({ x: 0, y: 300 + FRAME_GAP + 56 + FRAME_GAP, auto: { x: 0, y: 300 + FRAME_GAP + 56 + FRAME_GAP } })
  })

  // ADR-0032: the frames stand in a column of their own that no Node on the plane is in.
  const ORCHESTRATOR = { x: 40, y: 40, w: 360, h: 200 }
  const HANDOFF = { x: 40, y: 280, w: 360, h: 320 }
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('starts the column right of the Nodes that would be in it, not at (0, 0)', () => {
    const placed = stackFrames([{ epic: 'a', width: 800, height: 600 }], [ORCHESTRATOR, HANDOFF])
    expect(placed.get('a')!.auto).toEqual({ x: 40 + 360 + FRAME_GAP, y: 0 })
    // A Node right of the column, above it or far enough left leaves it at x = 0.
    expect(stackFrames([{ epic: 'a', width: 800, height: 600 }], [{ x: 800 + FRAME_GAP, y: 0, w: 100, h: 100 }]).get('a')!.auto).toEqual({ x: 0, y: 0 })
    expect(stackFrames([{ epic: 'a', width: 800, height: 600 }], [{ x: 0, y: -FRAME_GAP - 100, w: 100, h: 100 }]).get('a')!.auto).toEqual({ x: 0, y: 0 })
    expect(stackFrames([{ epic: 'a', width: 800, height: 600 }], [{ x: -100 - FRAME_GAP, y: 0, w: 100, h: 100 }]).get('a')!.auto).toEqual({ x: 0, y: 0 })
  })

  it('takes the first gap wide enough for the widest frame, left to right', () => {
    const narrow = { x: 300, y: 0, w: 100, h: 100 }
    const far = { x: 300 + 100 + FRAME_GAP + 520 + FRAME_GAP, y: 20, w: 100, h: 100 }
    // The gap between `narrow` and `far` fits a 520 frame exactly, not a 521 one.
    expect(stackFrames([{ epic: 'a', width: 520, height: 56 }], [narrow, far]).get('a')!.auto.x).toBe(300 + 100 + FRAME_GAP)
    const frames = [
      { epic: 'a', width: 300, height: 56 },
      { epic: 'b', width: 521, height: 56 },
    ]
    const placed = stackFrames(frames, [narrow, far])
    expect(placed.get('a')!.auto.x).toBe(far.x + far.w + FRAME_GAP)
    expect(placed.get('b')!.auto.x).toBe(far.x + far.w + FRAME_GAP)
  })

  it('is as tall as the stack: a Node far below the frames does not move the column', () => {
    const frames = [
      { epic: 'a', width: 800, height: 400 },
      { epic: 'b', width: 800, height: 56 },
    ]
    const stack = 400 + FRAME_GAP + 56
    // A Card at (500, 5000), in the column's x range, far below the stack.
    expect(stackFrames(frames, [ORCHESTRATOR, { x: 500, y: 5000, w: 420, h: 300 }]).get('a')!.auto.x).toBe(40 + 360 + FRAME_GAP)
    // Just below the stack's bottom plus the gap: still free; one unit higher: in the way.
    expect(stackFrames(frames, [ORCHESTRATOR, { x: 500, y: stack + FRAME_GAP, w: 420, h: 300 }]).get('a')!.auto.x).toBe(40 + 360 + FRAME_GAP)
    expect(stackFrames(frames, [ORCHESTRATOR, { x: 500, y: stack + FRAME_GAP - 1, w: 420, h: 300 }]).get('a')!.auto.x).toBe(500 + 420 + FRAME_GAP)
  })

  it('keeps room for the open done stack: opening it neither moves the column nor brings the frame onto a Node', () => {
    // Folded the frame is 400 tall, open 1000; a Node lies between the two, in the column's x range.
    const between = { x: 500, y: 700, w: 300, h: 100 }
    const nodes = [ORCHESTRATOR, between]
    const folded = stackFrames([{ epic: 'a', width: 800, height: 400, reserve: 1000 }, { epic: 'b', width: 800, height: 56 }], nodes)
    const open = stackFrames([{ epic: 'a', width: 800, height: 1000, reserve: 1000 }, { epic: 'b', width: 800, height: 56 }], nodes)
    expect(folded.get('a')!.auto.x).toBe(open.get('a')!.auto.x)
    for (const [epic, height] of [['a', 1000], ['b', 56]] as const) {
      const place = open.get(epic)!
      for (const node of nodes) expect(overlap({ x: place.x, y: place.y, w: 800, h: height }, node), `${epic} over ${JSON.stringify(node)}`).toBe(false)
    }
  })

  it('moves out of the way of a Card placed next to a Session by create_card without x/y', () => {
    const session = { x: 40, y: 40, w: 640, h: 480 }
    const before = stackFrames([{ epic: 'a', width: 800, height: 600 }], [session]).get('a')!
    const card = { ...placeNear([session], session, 420, 300), w: 420, h: 300 }
    // The Card lands where the column was …
    expect(overlap(card, { x: before.x, y: before.y, w: 800, h: 600 })).toBe(true)
    // … and the column goes right of it.
    const after = stackFrames([{ epic: 'a', width: 800, height: 600 }], [session, card]).get('a')!
    expect(overlap(card, { x: after.x, y: after.y, w: 800, h: 600 })).toBe(false)
    expect(overlap(session, { x: after.x, y: after.y, w: 800, h: 600 })).toBe(false)
  })

  // ADR-0038: a frame with an offset yields; the offset itself stays as saved.
  const crowds = (a: Rect, b: Rect) => a.x < b.x + b.w + NODE_GAP && b.x < a.x + a.w + NODE_GAP && a.y < b.y + b.h + NODE_GAP && b.y < a.y + a.h + NODE_GAP

  it('draws a frame whose offset puts it on a Card next to the Card, the Card where it is; the automatic place is unchanged', () => {
    const card = { x: 2000, y: 100, w: 360, h: 280 }
    // Without the Card the frame is drawn exactly at its offset: the column is at x = 0.
    const offset = { dx: 2000, dy: 100 }
    expect(stackFrames([{ epic: 'a', width: 520, height: 300, offset }]).get('a')).toEqual({ x: 2000, y: 100, auto: { x: 0, y: 0 } })
    const placed = stackFrames([{ epic: 'a', width: 520, height: 300, offset }], [card]).get('a')!
    expect(placed.auto).toEqual({ x: 0, y: 0 })
    expect(crowds({ x: placed.x, y: placed.y, w: 520, h: 300 }, card)).toBe(false)
    // The nearest clear place: just under the Card (100 + 280 + 16 - 100 = 296 down) is nearer than right of it (360 + 16 = 376).
    expect(placed).toMatchObject({ x: 2000, y: card.y + card.h + NODE_GAP })
    expect(placed).toEqual({ ...freePlace({ x: 2000, y: 100, w: 520, h: 300 }, [card]), auto: { x: 0, y: 0 } })
  })

  it('a frame with an offset keeps clear of the column and of the frames with an offset before it, in the order of their Layout Nodes', () => {
    const frames = [
      { epic: 'a', width: 520, height: 300 },
      // Both moved onto the same spot, over `a`; `c` has its Layout Node first, so `b` yields to it.
      { epic: 'b', width: 520, height: 100, offset: { dx: 50, dy: -300 - FRAME_GAP + 50 }, order: 7 },
      { epic: 'c', width: 520, height: 100, offset: { dx: 50, dy: -300 - FRAME_GAP - 100 - FRAME_GAP + 50 }, order: 3 },
    ]
    const placed = stackFrames(frames)
    const rect = (epic: string, h: number): Rect => ({ x: placed.get(epic)!.x, y: placed.get(epic)!.y, w: 520, h })
    expect(crowds(rect('b', 100), rect('a', 300))).toBe(false)
    expect(crowds(rect('c', 100), rect('a', 300))).toBe(false)
    expect(crowds(rect('b', 100), rect('c', 100))).toBe(false)
    // `a` (no offset) and `c` (first in the Layout) yield to nothing that comes after them.
    expect(placed.get('a')).toEqual({ x: 0, y: 0, auto: { x: 0, y: 0 } })
    expect(rect('c', 100)).toEqual({ ...freePlace({ x: 50, y: 50, w: 520, h: 100 }, [rect('a', 300)]), w: 520, h: 100 })
  })

  it('gives the same places when computed twice, and a frame placed where it was drawn does not move on', () => {
    const plane = [{ x: 600, y: 0, w: 300, h: 200 }, { x: 0, y: 900, w: 300, h: 200 }]
    const frames = [
      { epic: 'a', width: 520, height: 300 },
      { epic: 'b', width: 520, height: 300, offset: { dx: 600, dy: -300 - FRAME_GAP }, order: 1 },
      { epic: 'c', width: 520, height: 300, offset: { dx: 610, dy: -2 * (300 + FRAME_GAP) + 10 }, order: 2 },
    ]
    const first = stackFrames(frames, plane)
    expect(stackFrames(frames, plane)).toEqual(first)
    expect(stackFrames(frames.map((frame) => ({ ...frame })), [...plane])).toEqual(first)
  })
})

describe('progressOf', () => {
  it('counts states and splits 12 segments in proportion', () => {
    const tickets = [
      ...[1, 2, 3, 4, 5, 6].map((n) => ticket(n, done)),
      ticket(7, { state: 'work', statusRaw: 'claimed' }),
      ticket(8, { state: 'blocked', statusRaw: 'blocked — keys' }),
      ...[9, 10, 11, 12].map((n) => ticket(n)),
    ]
    const progress = progressOf(tickets)
    expect(progress).toMatchObject({ done: 6, working: 1, blocked: 1, open: 4, total: 12 })
    expect(progress.segments).toEqual([...Array(6).fill('done'), 'working', 'blocked', ...Array(4).fill('open')])

    const big = progressOf(Array.from({ length: 97 }, (_, i) => ticket(i + 1, i < 50 ? done : {})))
    expect(big.segments).toHaveLength(12)
    expect(big.segments.filter((s) => s === 'done')).toHaveLength(6)
    expect(progressOf([]).segments).toEqual(Array(12).fill('empty'))
  })
})

describe('Ticket text helpers', () => {
  it('takes the reason out of a blocked Status line', () => {
    expect(blockedReason('blocked — needs Stripe test keys')).toBe('needs Stripe test keys')
    expect(blockedReason('Blocked: waiting for the owner')).toBe('waiting for the owner')
    expect(blockedReason('blocked')).toBeNull()
    expect(blockedReason(null)).toBeNull()
  })

  it('drops the leading number from a title and names the Ticket file', () => {
    expect(ticketTitle({ num: 7, title: '07 — Rate-limit the bid endpoint' })).toBe('Rate-limit the bid endpoint')
    expect(ticketTitle({ num: 11, title: 'Эпик рамкой на Холсте' })).toBe('Эпик рамкой на Холсте')
    expect(ticketTitle({ num: 3, title: '03 —' })).toBe('03 —')
    expect(ticketFile('/r', { epic: 'worfy-mvp', num: 7, slug: 'движок-сессий' })).toBe('/r/.scratch/worfy-mvp/issues/07-движок-сессий.md')
    expect(ticketFile('/r', { epic: 'e', num: 123, slug: 's' })).toBe('/r/.scratch/e/issues/123-s.md')
  })
})
