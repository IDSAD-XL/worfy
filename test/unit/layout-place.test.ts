// Where main puts the Nodes it creates (src/main/layout/place.ts): one rule for the Orchestrator
// Node and the HANDOFF Node, which skips Nodes that take no room on the plane; and the spot near a
// given place that "Ship ticket" puts its Session on (worfy-daily ticket 28).
import { describe, expect, it } from 'vitest'
import { orchestratorPlace } from '../../src/main/agent/orchestrator'
import { placeDownFrom, placeNewNode } from '../../src/main/layout/place'
import type { LayoutNode } from '../../src/shared/layout/types'

const node = (x: number, y: number, w: number, h: number, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id: `${x}-${y}`,
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

const SIZE = { w: 360, h: 200 }

describe('placeNewNode', () => {
  it('takes the top-left spot when nothing on the plane overlaps it, otherwise goes under every Node', () => {
    expect(placeNewNode([], SIZE)).toStrictEqual({ x: 40, y: 40 })
    expect(placeNewNode([node(400, 40, 100, 100)], SIZE)).toStrictEqual({ x: 40, y: 40 })
    // Touching the spot's right edge is not overlapping it.
    expect(placeNewNode([node(400, 0, 100, 100)], SIZE)).toStrictEqual({ x: 40, y: 40 })
    expect(placeNewNode([node(399, 0, 100, 100)], SIZE)).toStrictEqual({ x: 399, y: 140 })
    expect(placeNewNode([node(120, 80, 220, 120), node(500, 300, 100, 50)], SIZE)).toStrictEqual({ x: 120, y: 390 })
  })

  it('does not count pinned, hidden, Epic frame, Ticket and Subagent Nodes, neither for the spot nor for the place under them', () => {
    const corner = { x: 40, y: 40, w: 100, h: 100 }
    const skipped: Partial<LayoutNode>[] = [{ pinned: true }, { hidden: true }, { kind: 'epic-frame' }, { kind: 'ticket' }, { kind: 'subagent' }, { kind: 'subagent-tree' }]
    for (const extra of skipped) {
      expect(placeNewNode([node(corner.x, corner.y, corner.w, corner.h, extra)], SIZE), JSON.stringify(extra)).toStrictEqual({ x: 40, y: 40 })
      // Under the Node that takes the spot, not under a skipped one lower down.
      expect(placeNewNode([node(100, 100, 100, 100), node(-500, 5000, 10, 10, extra)], SIZE), JSON.stringify(extra)).toStrictEqual({ x: 100, y: 240 })
    }
  })

  it('is the rule the Orchestrator Node is placed by', () => {
    expect(orchestratorPlace([node(40, 40, 1, 1, { kind: 'epic-frame' })])).toStrictEqual({ x: 40, y: 40 })
    expect(orchestratorPlace([node(40, 40, 1, 1, { pinned: true }), node(120, 80, 100, 100)])).toStrictEqual({ x: 120, y: 220 })
  })
})

describe('placeDownFrom', () => {
  const from = { x: 1000, y: 600 }
  const overlaps = (a: { x: number; y: number }, b: LayoutNode) => a.x < b.x + b.w && b.x < a.x + SIZE.w && a.y < b.y + b.h && b.y < a.y + SIZE.h

  it('takes the given spot when it is clear, however far the first clear spot of the plane is', () => {
    expect(placeDownFrom([], SIZE, from)).toStrictEqual(from)
    // The top-left spot is taken and the Nodes go far down: the spot near the given place is still clear.
    const nodes = [node(40, 40, 400, 3000), node(1000, 0, 360, 500)]
    expect(placeDownFrom(nodes, SIZE, from)).toStrictEqual(from)
    expect(placeNewNode(nodes, SIZE).y).toBeGreaterThan(3000)
  })

  it('goes down from the given height, never left or up, to the first spot that keeps the gap from every Node', () => {
    const nodes = [node(900, 500, 300, 200), node(1100, 760, 300, 300), node(1000, 1400, 50, 50), node(1500, 600, 100, 100)]
    const spot = placeDownFrom(nodes, SIZE, from)
    expect(spot).toStrictEqual({ x: 1000, y: 1100 })
    for (const each of nodes) expect(overlaps(spot, each), each.id).toBe(false)
    // A Node right under the spot within the gap pushes it below that Node too.
    expect(placeDownFrom([node(1000, 820, 100, 100)], SIZE, from)).toStrictEqual({ x: 1000, y: 960 })
    // A Node above, or one gap away to the side, does not.
    expect(placeDownFrom([node(1000, 300, 100, 260), node(1000 + SIZE.w + 40, 600, 100, 100)], SIZE, from)).toStrictEqual(from)
  })

  it('does not count pinned, hidden, Epic frame, Ticket and Subagent Nodes', () => {
    for (const extra of [{ pinned: true }, { hidden: true }, { kind: 'epic-frame' }, { kind: 'ticket' }, { kind: 'subagent' }, { kind: 'subagent-tree' }] as Partial<LayoutNode>[]) {
      expect(placeDownFrom([node(from.x, from.y, 100, 100, extra)], SIZE, from), JSON.stringify(extra)).toStrictEqual(from)
    }
  })
})
