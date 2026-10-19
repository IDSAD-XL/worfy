import { describe, expect, it } from 'vitest'
import { FRAME_GAP, frameColumnX, stackFrames } from '../../src/renderer/canvas/epic-layout'
import { sessionSpot, spotInputs, stripKeepOut, type DrawnNode, type SpotStrip } from '../../src/renderer/canvas/session-spot'
import { EPIC_FRAME_KIND, TICKET_KIND, epicNodeId, ticketNodeId } from '../../src/shared/layout/derived'
import { freePlace } from '../../src/shared/layout/free-place'

// Where a new Session with a Binding goes (worfy-canvas ticket 11): right of the whole strip of
// Epic frames (ADR-0075), at the height of its Ticket or of its Epic frame's header.

/** A frame as React Flow holds it: drawn at `at`, its automatic place `auto`. */
const frameNode = (epic: string, auto: { x: number; y: number }, size: { w: number; h: number }, at = auto): DrawnNode & { id: string } => ({
    id: epicNodeId(epic),
    type: EPIC_FRAME_KIND,
    width: size.w,
    height: size.h,
    internals: { positionAbsolute: at },
    data: { node: { data: { epic: { epic }, auto } } },
})

const ticketNode = (epic: string, num: number, at: { x: number; y: number }): DrawnNode & { id: string } => ({
    id: ticketNodeId(epic, num),
    type: TICKET_KIND,
    width: 220,
    height: 80,
    internals: { positionAbsolute: at },
    data: { node: { data: { ticket: { epic, num } } } },
})

/** Three frames of different widths in a strip of K = 3, placed by stackFrames as the Canvas places them. */
function threeColumns() {
  const sizes = { wide: { w: 600, h: 400 }, narrow: { w: 300, h: 500 }, last: { w: 250, h: 300 } }
  const places = stackFrames(
    Object.entries(sizes).map(([epic, size]) => ({ epic, width: size.w, height: size.h })),
    [],
    3,
  )
  const nodes = Object.entries(sizes).map(([epic, size]) => frameNode(epic, places.get(epic)!.auto, size))
  const left = places.get('wide')!.auto.x
  return { sizes, places, nodes, stripRight: left + 3 * 600 + 2 * FRAME_GAP }
}

describe('the spot of a new Session with a Binding', () => {
  const strip: SpotStrip = { x: 100, right: 900, top: 0, bottom: 1200 }
  const frames = [
    { epic: 'alpha', y: 0, tickets: new Map([[7, 140.4]]) },
    { epic: 'beta', y: 520, tickets: new Map<number, number>() },
  ]

  it('stands right of the strip at its Ticket’s height for a Binding to a Ticket', () => {
    expect(sessionSpot({ kind: 'ticket', epic: 'alpha', num: 7 }, frames, strip)).toEqual({ x: 900 + FRAME_GAP, y: 140 })
  })

  it('stands right of the strip at the top of its frame’s header for a Binding to an Epic', () => {
    expect(sessionSpot({ kind: 'epic', epic: 'beta' }, frames, strip)).toEqual({ x: 900 + FRAME_GAP, y: 520 })
  })

  it('is right of the whole strip with K = 3, not right of the bound frame', () => {
    const { places, nodes, stripRight } = threeColumns()
    const { frames: drawn, strip: found } = spotInputs(nodes)
    expect(found?.right).toBe(stripRight)
    // The narrow frame stands in the middle column: right of it is the third column.
    const spot = sessionSpot({ kind: 'epic', epic: 'narrow' }, drawn, found)
    expect(spot).toEqual({ x: stripRight + FRAME_GAP, y: places.get('narrow')!.auto.y })
    // The last column's frame is narrower than the column: the strip still ends at the column's edge.
    const last = places.get('last')!.auto.x + 250
    expect(spot!.x).toBeGreaterThan(last + FRAME_GAP)
  })

  it('takes the heights as drawn: a frame moved by hand and its Tickets', () => {
    const nodes = [frameNode('alpha', { x: 0, y: 0 }, { w: 500, h: 400 }, { x: 30, y: 260 }), ticketNode('alpha', 3, { x: 60, y: 380 })]
    const { frames: drawn, strip: found } = spotInputs(nodes)
    expect(found).toEqual({ x: 0, right: 500, top: 0, bottom: 400 })
    expect(sessionSpot({ kind: 'epic', epic: 'alpha' }, drawn, found)).toEqual({ x: 500 + FRAME_GAP, y: 260 })
    expect(sessionSpot({ kind: 'ticket', epic: 'alpha', num: 3 }, drawn, found)).toEqual({ x: 500 + FRAME_GAP, y: 380 })
  })

  it('is undefined without a Binding', () => {
    expect(sessionSpot(null, frames, strip)).toBeUndefined()
    expect(sessionSpot(undefined, frames, strip)).toBeUndefined()
  })

  it('is undefined for an Epic whose frame is not in the strip: on the Done shelf, or not drawn yet', () => {
    // The Done shelf shows a finished Epic as a chip; its frame is not one of the strip's frames.
    expect(sessionSpot({ kind: 'epic', epic: 'shelved' }, frames, strip)).toBeUndefined()
    expect(sessionSpot({ kind: 'ticket', epic: 'shelved', num: 1 }, frames, strip)).toBeUndefined()
  })

  it('is undefined for a Ticket its frame does not show, and without a strip', () => {
    expect(sessionSpot({ kind: 'ticket', epic: 'beta', num: 4 }, frames, strip)).toBeUndefined()
    expect(spotInputs([]).strip).toBeUndefined()
    expect(sessionSpot({ kind: 'epic', epic: 'alpha' }, [], undefined)).toBeUndefined()
  })
})

describe('the strip as an obstacle', () => {
  it('keeps a Node placed from the spot where the strip does not move away from it', () => {
    const { nodes, stripRight } = threeColumns()
    const { strip } = spotInputs(nodes)
    const keepOut = stripKeepOut(strip!)
    const width = strip!.right - strip!.x
    // A Session Node already stands at the spot: the next one, asked for the same height, does not go left into the strip's band.
    const first = { x: stripRight + FRAME_GAP, y: 0, w: 300, h: 120 }
    const second = freePlace({ ...first }, [first, keepOut])
    for (const rect of [first, { ...first, ...second }]) expect(frameColumnX(width, strip!.bottom, [rect])).toBe(strip!.x)
  })

  it('keeps FRAME_GAP, not only NODE_GAP, from the strip when the way right is shut', () => {
    const { nodes, stripRight } = threeColumns()
    const { strip } = spotInputs(nodes)
    const width = strip!.right - strip!.x
    // A Node right of the spot reaches far up and down: the nearest clear place is past a corner of the strip.
    const wall = { x: stripRight + FRAME_GAP, y: -10_000, w: 5000, h: 20_000 }
    const asked = { x: stripRight + FRAME_GAP, y: 0, w: 300, h: 120 }
    const place = freePlace(asked, [wall, stripKeepOut(strip!)])
    expect(frameColumnX(width, strip!.bottom, [wall, { ...asked, ...place }])).toBe(frameColumnX(width, strip!.bottom, [wall]))
  })
})
