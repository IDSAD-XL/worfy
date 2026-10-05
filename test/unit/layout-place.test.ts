// Where main puts the Nodes it creates (src/main/layout/place.ts): one rule for the Orchestrator
// Node and the HANDOFF Node, which skips Nodes that take no room on the plane.
import { describe, expect, it } from 'vitest'
import { orchestratorPlace } from '../../src/main/agent/orchestrator'
import { placeNewNode } from '../../src/main/layout/place'
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
