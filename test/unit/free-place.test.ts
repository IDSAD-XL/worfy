// Nodes never overlap (ADR-0038): the pure functions main corrects Layout operations with and the
// renderer makes the Derived Nodes yield with (src/shared/layout/free-place.ts).
import { describe, expect, it } from 'vitest'
import { crowds, freePlace, freeShift, isClear, NODE_GAP, removeOverlaps, stopResize, type Rect, type Shift } from '../../src/shared/layout/free-place'
import type { LayoutNode } from '../../src/shared/layout/types'

/** A Note dropped onto a Card; test/contract/layout-store.test.ts sends main the same move and expects the same place. */
const DROP_FIXTURE = { card: { x: 0, y: 0, w: 300, h: 200 }, note: { x: 40, y: 40, w: 220, h: 120 } }
/** Where the Note goes: under the Card (200 + 16 − 40 = 176 down) is nearer than right of it (300 + 16 − 40 = 276). */
const DROP_PLACE = { x: 40, y: 216 }

const node = (id: string, x: number, y: number, w = 100, h = 100, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  kind: 'note',
  x,
  y,
  w,
  h,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: {},
  ...extra,
})

/** How far apart two rectangles are along the axis they are separated on; negative when they overlap. */
const separation = (a: Rect, b: Rect): number => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))

/** A small deterministic random source, so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

/** The search without its shortcuts: every candidate shift, in the documented order, the first clear one. */
function slowShift(moving: readonly Rect[], obstacles: readonly Rect[]): Shift {
  const xs = new Set([0])
  const ys = new Set([0])
  for (const rect of moving)
    for (const other of obstacles) {
      xs.add(other.x - NODE_GAP - rect.w - rect.x).add(other.x + other.w + NODE_GAP - rect.x)
      ys.add(other.y - NODE_GAP - rect.h - rect.y).add(other.y + other.h + NODE_GAP - rect.y)
    }
  const all = [...xs].flatMap((dx) => [...ys].map((dy) => ({ dx, dy })))
  all.sort((a, b) => a.dx ** 2 + a.dy ** 2 - (b.dx ** 2 + b.dy ** 2) || Math.abs(a.dy) - Math.abs(b.dy) || b.dx - a.dx || b.dy - a.dy)
  return all.find((shift) => isClear(moving, obstacles, shift))!
}

describe('freePlace', () => {
  it('leaves a rectangle that keeps the gap where it is', () => {
    const card = { x: 0, y: 0, w: 300, h: 200 }
    expect(freePlace({ x: 300 + NODE_GAP, y: 0, w: 100, h: 100 }, [card])).toEqual({ x: 316, y: 0 })
    expect(freePlace({ x: 0, y: 200 + NODE_GAP, w: 100, h: 100 }, [card])).toEqual({ x: 0, y: 216 })
    expect(freePlace({ x: 5, y: 5, w: 10, h: 10 }, [])).toEqual({ x: 5, y: 5 })
  })

  it('puts a Note dropped onto a Card on the nearest clear place, NODE_GAP off it', () => {
    const place = freePlace(DROP_FIXTURE.note, [DROP_FIXTURE.card])
    expect(place).toEqual(DROP_PLACE)
    expect(separation({ ...DROP_FIXTURE.note, ...place }, DROP_FIXTURE.card)).toBe(NODE_GAP)
  })

  it('moves a rectangle that is clear of the others but closer than the gap', () => {
    const card = { x: 0, y: 0, w: 300, h: 200 }
    expect(freePlace({ x: 308, y: 0, w: 100, h: 100 }, [card])).toEqual({ x: 316, y: 0 })
  })

  it('breaks ties by a fixed order: less up or down, then right, then down', () => {
    const square = { x: 0, y: 0, w: 100, h: 100 }
    // Right, left, up and down are all 116 away: right wins.
    expect(freePlace(square, [square])).toEqual({ x: 116, y: 0 })
    // A wall right of the spot: left is as near as right was.
    expect(freePlace(square, [square, { x: 116, y: -500, w: 100, h: 1100 }])).toEqual({ x: -116, y: 0 })
    // Walls on both sides: down wins over up.
    expect(freePlace(square, [square, { x: 116, y: -50, w: 100, h: 200 }, { x: -216, y: -50, w: 100, h: 200 }])).toEqual({ x: 0, y: 116 })
  })

  it('gives the same answer whatever order the obstacles come in', () => {
    const next = random(7)
    for (let round = 0; round < 50; round += 1) {
      const obstacles = Array.from({ length: 12 }, () => ({ x: Math.round(next() * 800), y: Math.round(next() * 800), w: 40 + Math.round(next() * 200), h: 40 + Math.round(next() * 200) }))
      const rect = { x: Math.round(next() * 800), y: Math.round(next() * 800), w: 220, h: 120 }
      expect(freePlace(rect, [...obstacles].reverse())).toEqual(freePlace(rect, obstacles))
    }
  })

  it('finds the same place as the search over every candidate, and that place keeps the gap from every obstacle', () => {
    const next = random(42)
    for (let round = 0; round < 300; round += 1) {
      const obstacles = Array.from({ length: 1 + Math.floor(next() * 15) }, () => ({ x: Math.round(next() * 1000), y: Math.round(next() * 1000), w: 20 + Math.round(next() * 300), h: 20 + Math.round(next() * 300) }))
      const rect = { x: Math.round(next() * 1000), y: Math.round(next() * 1000), w: 20 + Math.round(next() * 300), h: 20 + Math.round(next() * 300) }
      const shift = freeShift([rect], obstacles)
      expect(shift, `round ${round}`).toEqual(slowShift([rect], obstacles))
      for (const other of obstacles) expect(separation({ ...rect, x: rect.x + shift.dx, y: rect.y + shift.dy }, other)).toBeGreaterThanOrEqual(NODE_GAP)
    }
  })
})

describe('freeShift of a group', () => {
  it('shifts the whole group off a Node outside it and keeps the Nodes where they are to each other', () => {
    const group = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 120, y: 0, w: 100, h: 100 },
    ]
    const card = { x: 180, y: 20, w: 100, h: 60 }
    const shift = freeShift(group, [card])
    expect(shift).toEqual(slowShift(group, [card]))
    expect(isClear(group, [card], shift)).toBe(true)
    // Each Node alone would go its own way; the group moves as one.
    expect(shift).toEqual({ dx: -56, dy: 0 })
  })

  it('does not move a group that is clear, however close its own Nodes are to each other', () => {
    const group = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
    ]
    expect(freeShift(group, [{ x: 400, y: 0, w: 100, h: 100 }])).toEqual({ dx: 0, dy: 0 })
  })

  it('matches the search over every candidate for random groups', () => {
    const next = random(3)
    for (let round = 0; round < 100; round += 1) {
      const obstacles = Array.from({ length: 1 + Math.floor(next() * 10) }, () => ({ x: Math.round(next() * 1000), y: Math.round(next() * 1000), w: 20 + Math.round(next() * 300), h: 20 + Math.round(next() * 300) }))
      const group = Array.from({ length: 2 + Math.floor(next() * 3) }, () => ({ x: Math.round(next() * 600), y: Math.round(next() * 600), w: 20 + Math.round(next() * 200), h: 20 + Math.round(next() * 200) }))
      expect(freeShift(group, obstacles), `round ${round}`).toEqual(slowShift(group, obstacles))
    }
  })
})

describe('stopResize', () => {
  const neighbour = { x: 500, y: 0, w: 200, h: 200 }

  it('leaves a resize that runs into nothing as it is', () => {
    const before = { x: 0, y: 0, w: 200, h: 200 }
    expect(stopResize(before, { x: 0, y: 0, w: 284, h: 300 }, [neighbour])).toEqual({ x: 0, y: 0, w: 284, h: 300 })
  })

  it('stops the right edge NODE_GAP short of a neighbour on the right; the left edge stays', () => {
    const before = { x: 0, y: 0, w: 200, h: 200 }
    expect(stopResize(before, { x: 0, y: 0, w: 900, h: 200 }, [neighbour])).toEqual({ x: 0, y: 0, w: 500 - NODE_GAP, h: 200 })
  })

  it('stops the left edge NODE_GAP short of a neighbour on the left; the right edge stays', () => {
    const left = { x: -400, y: 0, w: 200, h: 200 }
    const before = { x: 0, y: 0, w: 200, h: 200 }
    // Dragged from the left edge: x moves with the edge, the right edge stays at 200.
    const resized = stopResize(before, { x: -500, y: 0, w: 700, h: 200 }, [left])
    expect(resized).toEqual({ x: -200 + NODE_GAP, y: 0, w: 200 - (-200 + NODE_GAP), h: 200 })
    expect(resized.x + resized.w).toBe(200)
  })

  it('stops the edge that gives up less when a corner is dragged towards a Node diagonally', () => {
    const before = { x: 0, y: 0, w: 200, h: 200 }
    const corner = { x: 300, y: 260, w: 200, h: 200 }
    // Right edge would stop at 284 (gives up 116), bottom at 244 (gives up 156): the right edge stops.
    expect(stopResize(before, { x: 0, y: 0, w: 400, h: 400 }, [corner])).toEqual({ x: 0, y: 0, w: 284, h: 400 })
  })

  it('moves a resized Node that was not clear before to the nearest clear place as a whole', () => {
    const before = { x: 450, y: 0, w: 100, h: 100 }
    const after = { x: 450, y: 0, w: 120, h: 100 }
    expect(stopResize(before, after, [neighbour])).toEqual({ ...after, ...freePlace(after, [neighbour]) })
  })
})

describe('removeOverlaps', () => {
  it('moves the Node created later off the one created earlier; the earlier stays', () => {
    const a = node('a', 0, 0, 300, 200)
    const b = node('b', 40, 40, 220, 120)
    const { nodes, moves } = removeOverlaps([a, b])
    expect(nodes[0]).toBe(a)
    expect(nodes[1]).toMatchObject({ id: 'b', ...DROP_PLACE })
    expect(moves).toEqual([{ id: 'b', from: { x: 40, y: 40 }, to: DROP_PLACE }])
  })

  it('puts a moved Node where no later Node is either, so a Node that crowded nothing stays', () => {
    const a = node('a', 0, 0, 300, 200)
    const b = node('b', 40, 40, 220, 120)
    // Exactly NODE_GAP under `a`: clear of everything, where `b` alone would have gone.
    const c = node('c', 40, 216, 220, 120)
    const { nodes, moves } = removeOverlaps([a, b, c])
    expect(moves.map((move) => move.id)).toEqual(['b'])
    expect(nodes[2]).toBe(c)
    // Above `a` (176 up) is the nearest place clear of `a` and of `c`; right of `a` would be 276.
    expect(nodes[1]).toMatchObject({ x: 40, y: -16 - 120 })
    for (const [index, one] of nodes.entries()) for (const other of nodes.slice(index + 1)) expect(crowds(one, other)).toBe(false)
  })

  it('moves only the later Node of each crowded pair on a grid of 500 with every tenth Node dropped onto its neighbour', () => {
    const nodes = Array.from({ length: 500 }, (_, index) => {
      const dropped = index % 10 === 9
      return node(`n${index}`, (index % 25) * 260 - (dropped ? 200 : 0), Math.floor(index / 25) * 160 + (dropped ? 30 : 0), 220, 120)
    })
    const { nodes: after, moves } = removeOverlaps(nodes)
    // Each dropped Node overlaps the one before it, so at least it has to move; nothing else does.
    expect(moves.map((move) => move.id)).toEqual(nodes.filter((_, index) => index % 10 === 9).map((each) => each.id))
    for (const [index, one] of after.entries()) for (const other of after.slice(index + 1)) expect(crowds(one, other)).toBe(false)
  })

  it('changes nothing the second time', () => {
    const next = random(11)
    const nodes = Array.from({ length: 40 }, (_, index) => node(`n${index}`, Math.round(next() * 600), Math.round(next() * 600), 100 + Math.round(next() * 200), 80 + Math.round(next() * 150)))
    const once = removeOverlaps(nodes)
    expect(once.moves.length).toBeGreaterThan(0)
    for (const [index, a] of once.nodes.entries()) for (const b of once.nodes.slice(index + 1)) expect(crowds(a, b)).toBe(false)
    const twice = removeOverlaps(once.nodes)
    expect(twice.moves).toEqual([])
    expect(twice.nodes).toEqual(once.nodes)
  })

  it('neither moves nor goes around pinned, hidden and node-source Nodes', () => {
    const pinned = node('pinned', 0, 0, 300, 300, { pinned: true })
    const hidden = node('hidden', 0, 0, 300, 300, { hidden: true })
    const frame = node('epic:x', 0, 0, 1, 1, { kind: 'epic-frame' })
    const note = node('note', 10, 10)
    const hiddenToo = node('hidden-2', 10, 10, 100, 100, { hidden: true })
    const { nodes, moves } = removeOverlaps([pinned, hidden, frame, note, hiddenToo])
    expect(moves).toEqual([])
    expect(nodes).toEqual([pinned, hidden, frame, note, hiddenToo])
  })
})
