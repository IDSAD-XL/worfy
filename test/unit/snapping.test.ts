// Snapping while a Node is dragged or resized (worfy-week ticket 06, src/renderer/canvas/snapping.ts):
// the grid, alignment guides, equal gaps, ⌘, the threshold at a zoom, and the landing place that
// main's correction gives back unchanged (ADR-0038).
import { describe, expect, it } from 'vitest'
import { freePlace, isClear, NODE_GAP, type Rect } from '../../src/shared/layout/free-place'
import { GRID, planDrag, snapRect, stopEdges, type DragInput } from '../../src/renderer/canvas/snapping'

describe('the grid', () => {
  it('puts the top-left corner on multiples of 8 when no neighbour is near: (13, 21) goes to (16, 24)', () => {
    expect(GRID).toBe(8)
    expect(snapRect({ x: 13, y: 21, w: 220, h: 120 }, [], 1)).toEqual({ x: 16, y: 24, guides: [], gaps: [] })
    expect(snapRect({ x: -13, y: 3, w: 220, h: 120 }, [], 1)).toMatchObject({ x: -16, y: 0 })
  })
})

describe('alignment guides', () => {
  // On x the neighbour is far below, so nothing snaps on y but the grid; on y it is far to the right.
  const below: Rect = { x: 0, y: 400, w: 200, h: 100 }
  const right: Rect = { x: 400, y: 0, w: 100, h: 200 }
  // The dragged rectangle is 120 wide (on x) or 120 high (on y): only one of its lines can be near.
  const cases = [
    { line: 'left edge', axis: 'x', neighbour: below, snapsTo: 0, guideAt: 0 },
    { line: 'right edge', axis: 'x', neighbour: below, snapsTo: 80, guideAt: 200 },
    { line: 'centre', axis: 'x', neighbour: below, snapsTo: 40, guideAt: 100 },
    { line: 'top edge', axis: 'y', neighbour: right, snapsTo: 0, guideAt: 0 },
    { line: 'bottom edge', axis: 'y', neighbour: right, snapsTo: 80, guideAt: 200 },
    { line: 'centre', axis: 'y', neighbour: right, snapsTo: 40, guideAt: 100 },
  ] as const
  const rectAt = (axis: 'x' | 'y', at: number): Rect => (axis === 'x' ? { x: at, y: 0, w: 120, h: 100 } : { x: 0, y: at, w: 100, h: 120 })

  it.each(cases)('$axis, $line: 5 px from the same line of a neighbour at zoom 1 — sticks, with a guide', ({ axis, neighbour, snapsTo, guideAt }) => {
    const snap = snapRect(rectAt(axis, snapsTo + 5), [neighbour], 1)
    expect(snap[axis]).toBe(snapsTo)
    expect(snap.guides).toEqual([expect.objectContaining({ axis, at: guideAt })])
  })

  it.each(cases)('$axis, $line: 7 px away at zoom 1 — no guide, the grid', ({ axis, neighbour, snapsTo }) => {
    const snap = snapRect(rectAt(axis, snapsTo + 7), [neighbour], 1)
    expect(snap[axis]).toBe(Math.round((snapsTo + 7) / 8) * 8)
    expect(snap.guides).toEqual([])
  })

  it('also sticks from the other side', () => {
    expect(snapRect(rectAt('x', -5), [below], 1)).toMatchObject({ x: 0, guides: [expect.objectContaining({ axis: 'x', at: 0 })] })
  })

  it('at zoom 0.5 the threshold is 12 canvas units: 11 away sticks, 13 away goes to the grid', () => {
    expect(snapRect(rectAt('x', 11), [below], 0.5)).toMatchObject({ x: 0, guides: [expect.objectContaining({ at: 0 })] })
    expect(snapRect(rectAt('x', 13), [below], 0.5)).toMatchObject({ x: 16, guides: [] })
    // At zoom 2 the same 6 px are 3 units.
    expect(snapRect(rectAt('x', 4), [below], 2)).toMatchObject({ x: 8, guides: [] })
  })

  it('draws the guide through both Nodes', () => {
    const snap = snapRect(rectAt('x', 5), [below], 1)
    expect(snap.guides).toEqual([{ axis: 'x', at: 0, from: 0, to: 500 }])
  })

  it('takes the nearest line when several are close', () => {
    const near: Rect = { x: 3, y: 400, w: 120, h: 100 }
    // Left edges 5 apart, left 2 apart from `near`: `near` wins, with its own guide at 3.
    const snap = snapRect(rectAt('x', 5), [below, near], 1)
    expect(snap.x).toBe(3)
    expect(snap.guides.map((guide) => guide.at)).toContain(3)
  })
})

describe('equal gaps', () => {
  const a: Rect = { x: 0, y: 0, w: 100, h: 100 }
  const b: Rect = { x: 140, y: 0, w: 100, h: 100 }

  it('a row of three with gaps 40 and 44: the dragged Node goes to the gap of 40, both gaps marked', () => {
    const snap = snapRect({ x: 284, y: 0, w: 100, h: 100 }, [a, b], 1)
    expect(snap.x).toBe(280)
    expect(snap.gaps).toEqual(
      expect.arrayContaining([
        { axis: 'x', from: 240, to: 280, at: 50 },
        { axis: 'x', from: 100, to: 140, at: 50 },
      ]),
    )
    expect(snap.gaps).toHaveLength(2)
  })

  it('works before the row too, and in a column', () => {
    expect(snapRect({ x: -144, y: 0, w: 100, h: 100 }, [a, b], 1).x).toBe(-140)
    const top: Rect = { x: 0, y: 0, w: 100, h: 100 }
    const middle: Rect = { x: 0, y: 140, w: 100, h: 100 }
    const snap = snapRect({ x: 0, y: 283, w: 100, h: 100 }, [top, middle], 1)
    expect(snap.y).toBe(280)
    expect(snap.gaps.filter((gap) => gap.axis === 'y')).toHaveLength(2)
  })

  it('a gap 7 px off is not snapped to', () => {
    const snap = snapRect({ x: 287, y: 0, w: 100, h: 100 }, [a, b], 1)
    expect(snap.x).toBe(288)
    expect(snap.gaps).toEqual([])
  })

  it('a Node out of the row does not count', () => {
    const elsewhere: Rect = { x: 140, y: 500, w: 100, h: 100 }
    expect(snapRect({ x: 284, y: 0, w: 100, h: 100 }, [a, elsewhere], 1)).toMatchObject({ x: 288, gaps: [] })
  })
})

describe('⌘ held', () => {
  it('a Note at (13, 21) stays at (13, 21), with no guides even next to a neighbour', () => {
    expect(snapRect({ x: 13, y: 21, w: 220, h: 120 }, [{ x: 10, y: 400, w: 220, h: 120 }], 1, true)).toEqual({ x: 13, y: 21, guides: [], gaps: [] })
  })
})

describe('the landing place', () => {
  // The fixture of ticket 04 (test/unit/free-place.test.ts, test/contract/layout-store.test.ts): a
  // Note dropped onto a Card; main moves it to (40, 216).
  const card: Rect = { x: 0, y: 0, w: 300, h: 200 }
  const note: Rect = { x: 40, y: 40, w: 220, h: 120 }
  const input = (extra: Partial<DragInput> = {}): DragInput => ({
    lead: 'note',
    dragged: [{ id: 'note', rect: note, layout: true }],
    neighbours: [card],
    layoutObstacles: [card],
    planeObstacles: [card],
    zoom: 1,
    free: false,
    ...extra,
  })

  it('is the place main\'s correction gives the snapped place: the outline shows it, and main keeps it', () => {
    const plan = planDrag(input())
    expect(plan.snapped.get('note')).toEqual({ x: 40, y: 40 })
    expect(plan.landing.get('note')).toEqual({ x: 40, y: 216 })
    expect(plan.outline).toEqual([{ x: 40, y: 216, w: 220, h: 120 }])
    // What main does with the move (src/main/layout/store.ts: freePlace over the other Nodes).
    expect(freePlace({ ...note, ...plan.snapped.get('note')! }, [card])).toEqual(plan.landing.get('note'))
    expect(freePlace({ ...note, ...plan.landing.get('note')! }, [card])).toEqual(plan.landing.get('note'))
    // The centres line up on x.
    expect(plan.guides).toContainEqual(expect.objectContaining({ axis: 'x', at: 150 }))
  })

  it('has no outline where the snapped place is clear', () => {
    const plan = planDrag(input({ dragged: [{ id: 'note', rect: { ...note, x: 400, y: 13 }, layout: true }] }))
    expect(plan.landing.get('note')).toEqual(plan.snapped.get('note'))
    expect(plan.outline).toEqual([])
  })

  it('keeps the rule with ⌘ held: no snapping, but the Note still lands clear', () => {
    const plan = planDrag(input({ free: true, dragged: [{ id: 'note', rect: { ...note, x: 41, y: 43 }, layout: true }] }))
    expect(plan.snapped.get('note')).toEqual({ x: 41, y: 43 })
    expect(plan.guides).toEqual([])
    expect(isClear([{ ...note, ...plan.landing.get('note')! }], [card])).toBe(true)
  })

  it('moves a group by the lead\'s shift, and lands it as one, the outline around every Node of it', () => {
    const other: Rect = { x: 400, y: 13, w: 100, h: 100 }
    const plan = planDrag(
      input({
        lead: 'b',
        dragged: [
          { id: 'a', rect: { x: 5, y: 5, w: 100, h: 100 }, layout: true },
          { id: 'b', rect: { x: 203, y: 21, w: 100, h: 100 }, layout: true },
        ],
        neighbours: [other],
        layoutObstacles: [other],
        planeObstacles: [other],
      }),
    )
    // b snaps to (200, 24) — the grid on x, other's top edge is 8 away — so a moves by (−3, 3).
    expect(plan.snapped.get('b')).toEqual({ x: 200, y: 24 })
    expect(plan.snapped.get('a')).toEqual({ x: 2, y: 8 })
    // b at 200..300 is 100 from other: clear, so the group lands where it was snapped.
    expect(plan.outline).toEqual([])
  })

  it('an Epic frame lands clear of everything on the plane, the Layout Nodes where they land too', () => {
    const plan = planDrag(input({ lead: 'epic:e', dragged: [{ id: 'epic:e', rect: { x: 100, y: 100, w: 300, h: 300 }, layout: false }], layoutObstacles: [] }))
    const landing = plan.landing.get('epic:e')!
    expect(isClear([{ x: landing.x, y: landing.y, w: 300, h: 300 }], [card])).toBe(true)
    expect(plan.outline).toHaveLength(1)
  })
})

describe('a resize', () => {
  it('stops the edge NODE_GAP short of the neighbour it runs into', () => {
    const before: Rect = { x: 0, y: 0, w: 200, h: 100 }
    const neighbour: Rect = { x: 300, y: 0, w: 200, h: 100 }
    expect(stopEdges(before, { x: 0, y: 0, w: 400, h: 100 }, [neighbour])).toEqual({ x: 0, y: 0, w: 300 - NODE_GAP, h: 100 })
    expect(stopEdges(before, { x: 0, y: 0, w: 250, h: 100 }, [neighbour])).toEqual({ x: 0, y: 0, w: 250, h: 100 })
  })
})
