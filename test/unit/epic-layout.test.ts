import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/shared/workflow/types'
import {
  blockedReason,
  COLUMN_GAP,
  defaultCollapsed,
  FRAME_GAP,
  FRAME_PADDING,
  HEADER_HEIGHT,
  layoutEpic,
  progressOf,
  stackFrames,
  TICKET_HEIGHT,
  TICKET_WIDTH,
  type EpicLayout,
  ticketFile,
  ticketTitle,
  type PlacedTicket,
} from '../../src/renderer/canvas/epic-layout'

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

function placed(layout: EpicLayout, num: number): PlacedTicket {
  const found = layout.tickets.find((t) => t.num === num)
  if (!found) throw new Error(`ticket ${num} is not shown`)
  return found
}

/** Ticket numbers per column, in column order, as "label: nums". */
const columnsOf = (layout: EpicLayout): string[] =>
  layout.columns.map((column) => {
    const nums = layout.tickets
      .filter((t) => JSON.stringify(t.column) === JSON.stringify(column.column))
      .sort((a, b) => a.auto.y - b.auto.y)
      .map((t) => t.num)
    return `${column.label}: ${nums.join(',')}`
  })

describe('layoutEpic', () => {
  it('keeps a manual offset from the automatic place when a neighbour changes and the layout is computed again', () => {
    const offsets = new Map([[3, { dx: 40, dy: -10 }]])
    const before = [ticket(1), ticket(2), ticket(3, blocked(1)), ticket(4, blocked(1))]
    const first = layoutEpic({ tickets: before, collapsed: false, doneExpanded: false, offsets })
    const three = placed(first, 3)
    expect(three.x).toBe(three.auto.x + 40)
    expect(three.y).toBe(three.auto.y - 10)

    // A neighbour is done now: the Done column appears and every column moves right.
    const after = before.map((t) => (t.num === 1 ? { ...t, ...done } : t))
    const second = layoutEpic({ tickets: after, collapsed: false, doneExpanded: false, offsets })
    const moved = placed(second, 3)
    expect(moved.auto).not.toEqual(three.auto)
    expect(moved.x).toBe(moved.auto.x + 40)
    expect(moved.y).toBe(moved.auto.y - 10)
    // Tickets without an offset sit exactly at their automatic place.
    expect(placed(second, 4).x).toBe(placed(second, 4).auto.x)
  })

  it('puts Tickets into columns by dependency level, counted over the Tickets that are not done', () => {
    const tickets = [ticket(1), ticket(2, blocked(1)), ticket(3, blocked(2)), ticket(4, blocked(1)), ticket(5, blocked(3, 4))]
    const layout = layoutEpic({ tickets, collapsed: false, doneExpanded: false })
    expect(columnsOf(layout)).toEqual(['Level 1: 1', 'Level 2: 2,4', 'Level 3: 3', 'Level 4: 5'])
    // Columns go left to right, a ticket width plus a gap apart.
    expect(layout.columns.map((c) => c.x)).toEqual([0, 1, 2, 3].map((i) => FRAME_PADDING + i * (TICKET_WIDTH + COLUMN_GAP)))

    const withDone = tickets.map((t) => (t.num === 1 ? { ...t, ...done } : t))
    const next = layoutEpic({ tickets: withDone, collapsed: false, doneExpanded: false })
    // A done blocker no longer counts: 2 and 4 are on the first level now.
    expect(columnsOf(next)).toEqual(['Done: ', 'Level 1: 2,4', 'Level 2: 3', 'Level 3: 5'])
  })

  it('folds done Tickets into one stack that opens on request', () => {
    const tickets = [ticket(1, done), ticket(2, done), ticket(3, blocked(1))]
    const folded = layoutEpic({ tickets, collapsed: false, doneExpanded: false })
    expect(folded.tickets.map((t) => t.num)).toEqual([3])
    expect(folded.doneStack).toMatchObject({ nums: [1, 2], x: FRAME_PADDING })
    expect(folded.columns[0]).toMatchObject({ column: { kind: 'done' }, label: 'Done', count: 2 })

    const open = layoutEpic({ tickets, collapsed: false, doneExpanded: true })
    expect(open.doneStack).toBeNull()
    expect(columnsOf(open)).toEqual(['Done: 1,2', 'Level 1: 3'])
  })

  it('moves Tickets with an unreadable "Blocked by", a blocker outside the Epic or a cycle to "Needs attention"', () => {
    const tickets = [
      ticket(1),
      ticket(2, { blockedRaw: 'after the release', blockedNums: [], blockedParsed: false }),
      ticket(3, blocked(99)),
      ticket(4, blocked(5)),
      ticket(5, blocked(4)),
      // Its only blocker is in "Needs attention": the Ticket itself is fine and keeps a level.
      ticket(6, blocked(2, 1)),
    ]
    const layout = layoutEpic({ tickets, collapsed: false, doneExpanded: false })
    expect(columnsOf(layout)).toEqual(['Level 1: 1', 'Level 2: 6', 'Needs attention: 2,3,4,5'])
    expect(placed(layout, 2).attention).toEqual({ kind: 'unparsed', raw: 'after the release' })
    expect(placed(layout, 3).attention).toEqual({ kind: 'missing-blocker', missing: [99] })
    expect(placed(layout, 4).attention).toEqual({ kind: 'cycle', cycle: [4, 5] })
    expect(placed(layout, 1).attention).toBeNull()
  })

  it('does not count a cycle whose other members are done', () => {
    const tickets = [ticket(1, { ...done, ...blocked(2) }), ticket(2, blocked(1))]
    const layout = layoutEpic({ tickets, collapsed: false, doneExpanded: false })
    expect(columnsOf(layout)).toEqual(['Done: ', 'Level 1: 2'])
    expect(placed(layout, 2).ready).toBe(true)
  })

  it('frames the ready Wave: its Tickets come first in the first level column', () => {
    const tickets = [
      ticket(1, { state: 'work', statusRaw: 'claimed — 2026-10-05', files: ['src/shared.ts'] }),
      // Shares a file with the Ticket in work: waits, though nothing blocks it.
      ticket(2, { files: ['src/shared.ts'] }),
      ticket(3),
      ticket(4),
      ticket(5, blocked(3)),
    ]
    const layout = layoutEpic({ tickets, collapsed: false, doneExpanded: false })
    expect(columnsOf(layout)).toEqual(['Level 1: 3,4,1,2', 'Level 2: 5'])
    expect(layout.tickets.filter((t) => t.ready).map((t) => t.num)).toEqual([3, 4])
    const box = layout.readyWave
    expect(box?.count).toBe(2)
    for (const num of [3, 4]) {
      const t = placed(layout, num)
      expect(t.auto.x).toBeGreaterThan(box!.x)
      expect(t.auto.y).toBeGreaterThan(box!.y)
      expect(t.auto.x + TICKET_WIDTH).toBeLessThan(box!.x + box!.width)
      expect(t.auto.y + TICKET_HEIGHT).toBeLessThan(box!.y + box!.height)
    }
    const outside = placed(layout, 1)
    expect(outside.auto.y).toBeGreaterThan(box!.y + box!.height)
  })

  it('has no ready Wave when nothing is ready', () => {
    const layout = layoutEpic({ tickets: [ticket(1, { state: 'work', statusRaw: 'claimed' })], collapsed: false, doneExpanded: false })
    expect(layout.readyWave).toBeNull()
  })

  it('makes the frame big enough for every Ticket at its automatic place', () => {
    const tickets = Array.from({ length: 30 }, (_, i) => ticket(i + 1, i % 3 ? blocked(i) : {}))
    const offsets = new Map([[7, { dx: 5000, dy: 5000 }]])
    const layout = layoutEpic({ tickets, collapsed: false, doneExpanded: false, offsets })
    for (const t of layout.tickets) {
      expect(t.auto.x + TICKET_WIDTH + FRAME_PADDING).toBeLessThanOrEqual(layout.width)
      expect(t.auto.y + TICKET_HEIGHT + FRAME_PADDING).toBeLessThanOrEqual(layout.height)
    }
    // A manual offset does not grow the frame.
    expect(layout.width).toBe(layoutEpic({ tickets, collapsed: false, doneExpanded: false }).width)
  })

  it('shows only the header of a collapsed Epic', () => {
    const layout = layoutEpic({ tickets: [ticket(1), ticket(2, blocked(1))], collapsed: true, doneExpanded: false })
    expect(layout.tickets).toEqual([])
    expect(layout.doneStack).toBeNull()
    expect(layout.readyWave).toBeNull()
    expect(layout.height).toBe(HEADER_HEIGHT)
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
      { epic: 'a', height: 300 },
      { epic: 'b', height: 56, offset: { dx: 100, dy: 40 } },
      { epic: 'c', height: 200 },
    ]
    const placed = stackFrames(frames)
    expect(placed.get('a')).toEqual({ x: 0, y: 0, auto: { x: 0, y: 0 } })
    expect(placed.get('b')).toEqual({ x: 100, y: 300 + FRAME_GAP + 40, auto: { x: 0, y: 300 + FRAME_GAP } })
    expect(placed.get('c')).toEqual({ x: 0, y: 300 + FRAME_GAP + 56 + FRAME_GAP, auto: { x: 0, y: 300 + FRAME_GAP + 56 + FRAME_GAP } })
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
