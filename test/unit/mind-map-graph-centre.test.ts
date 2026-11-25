// worfy-product-session ticket 35: the radial Graph of the Mind map (src/renderer/product/mind-map-layout.ts) left
// the topic high on a map whose branches all hung below it (26 % from the top, 7 of 11 nodes under it). The topic
// belongs in the middle, and no arrow may run over a node on the way.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import { buildMindMapGraph, graphEdgePath, layoutRadial, ROOT_ID, setTextMeasure, type Placement } from '../../src/renderer/product/mind-map-layout'
import { fontLike, inside, LONG_MAP, middle, pathPoints, topic } from './mind-map-long-map'

beforeEach(() => setTextMeasure(fontLike))
afterEach(() => setTextMeasure(null))

describe('the radial Graph keeps the topic in the middle (ticket 35)', () => {
  /** Where the topic's middle lies in the box round all nodes, 0 to 1 each way, and how many nodes lie on each side of it. */
  function balance(placement: Placement) {
    const boxes = [...placement.values()]
    const root = middle(placement.get(ROOT_ID)!)
    const [left, right] = [Math.min(...boxes.map((box) => box.x)), Math.max(...boxes.map((box) => box.x + box.width))]
    const [top, bottom] = [Math.min(...boxes.map((box) => box.y)), Math.max(...boxes.map((box) => box.y + box.height))]
    const others = [...placement.entries()].filter(([id]) => id !== ROOT_ID).map(([, box]) => middle(box))
    return {
      across: (root.x - left) / (right - left),
      down: (root.y - top) / (bottom - top),
      above: others.filter((at) => at.y < root.y).length,
      below: others.filter((at) => at.y > root.y).length,
      leftOf: others.filter((at) => at.x < root.x).length,
      rightOf: others.filter((at) => at.x > root.x).length,
    }
  }

  it('puts the topic near the middle of the map both ways, with nodes on all four sides, when one branch holds most nodes', () => {
    for (const hideRejected of [false, true]) {
      const at = balance(layoutRadial(buildMindMapGraph(topic(), { hideRejected })))
      expect(at.across, `across, hideRejected ${hideRejected}`).toBeGreaterThan(0.4)
      expect(at.across, `across, hideRejected ${hideRejected}`).toBeLessThan(0.6)
      expect(at.down, `down, hideRejected ${hideRejected}`).toBeGreaterThan(0.4)
      expect(at.down, `down, hideRejected ${hideRejected}`).toBeLessThan(0.6)
      // Not 7 of 10 on one side: each side holds at least a third of the nodes that are above or below.
      expect(Math.min(at.above, at.below), JSON.stringify(at)).toBeGreaterThanOrEqual(Math.ceil((at.above + at.below) / 3))
      expect(Math.min(at.leftOf, at.rightOf), JSON.stringify(at)).toBeGreaterThanOrEqual(Math.ceil((at.leftOf + at.rightOf) / 3))
    }
  })

  it('lets no "grew from" arrow run over another node, on this map and on one with more branches', () => {
    const more: MindMapNode[] = [
      ...LONG_MAP,
      { id: 'price', kind: 'question', text: 'What does a team pay for the second seat?', from: null },
      { id: 'price-flat', kind: 'idea', text: 'One flat price per team', from: 'price' },
      { id: 'price-seat', kind: 'decision', text: 'A price per seat, the first one free', from: 'price', status: 'accepted', reason: 'small teams start alone' },
      { id: 'onboarding', kind: 'idea', text: 'A guided first topic for a new owner', from: null },
      { id: 'onboarding-risk', kind: 'objection', text: 'A guide nobody reads is worse than none', from: 'onboarding', source: 'docs/design/BRIEF.md' },
    ]
    for (const [name, nodes, hideRejected] of [['this map', LONG_MAP, false], ['hidden rejected', LONG_MAP, true], ['more branches', more, false]] as const) {
      const graph = buildMindMapGraph({ ...topic(), nodes }, { hideRejected })
      const placement = layoutRadial(graph)
      const over: string[] = []
      for (const edge of graph.edges.filter((each) => each.kind === 'from')) {
        const points = pathPoints(graphEdgePath('from', placement.get(edge.source)!, placement.get(edge.target)!))
        for (const [id, box] of placement) if (id !== edge.source && id !== edge.target && points.some((point) => inside(point, box))) over.push(`${edge.id} over ${id}`)
      }
      expect(over, name).toEqual([])
      if (name === 'more branches') {
        const at = balance(placement)
        expect(at.across).toBeGreaterThan(0.4)
        expect(at.across).toBeLessThan(0.6)
        expect(at.down).toBeGreaterThan(0.4)
        expect(at.down).toBeLessThan(0.6)
      }
    }
  })

  it('bows the red `replaces` curve to the side, and as far, that runs over the fewest other nodes', () => {
    const [later, overturned] = [
      { x: 0, y: 200, width: 180, height: 80 },
      { x: 60, y: -200, width: 180, height: 80 },
    ]
    // The prototype's bend lies on the topic's side here: the curve crossed the topic's box.
    const topicBox = { x: 130, y: 35, width: 120, height: 30 }
    const prototypes = pathPoints(graphEdgePath('replaces', later, overturned))
    expect(prototypes.some((point) => inside(point, topicBox))).toBe(true)
    const points = pathPoints(graphEdgePath('replaces', later, overturned, [topicBox]))
    expect(points.filter((point) => inside(point, topicBox))).toEqual([])
    // Still the curve between the same two boxes.
    expect(graphEdgePath('replaces', later, overturned, [topicBox])).toMatch(/^M[-\d.]+,[-\d.]+ Q[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/)
    // A node on the far side, or a node on each side, keeps the prototype's bend.
    const far = { x: -400, y: 0, width: 220, height: 40 }
    expect(graphEdgePath('replaces', later, overturned, [far])).toBe(graphEdgePath('replaces', later, overturned))
    // On the map: the curve from the accepted Decision `split` to the Decision it overturned does not run over the
    // topic, and over no more nodes than the prototype's bend would.
    const graph = buildMindMapGraph(topic(), { hideRejected: false })
    const placement = layoutRadial(graph)
    const others = [...placement.entries()].filter(([id]) => id !== 'split' && id !== 'harness-first')
    const crossed = (d: string) => others.filter(([, box]) => pathPoints(d).some((point) => inside(point, box))).map(([id]) => id)
    const [later2, overturned2] = [placement.get('split')!, placement.get('harness-first')!]
    const chosen = crossed(graphEdgePath('replaces', later2, overturned2, others.map(([, box]) => box)))
    expect(chosen).not.toContain(ROOT_ID)
    expect(chosen.length).toBeLessThanOrEqual(crossed(graphEdgePath('replaces', later2, overturned2)).length)
  })

  it('leaves a single branch from the topic as the prototype lays it out, a line that never crosses itself', () => {
    const chain: MindMapNode[] = Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, kind: 'idea', text: `Шаг ${index} одной ветки`, from: index === 0 ? null : `n${index - 1}` }))
    const graph = buildMindMapGraph({ ...topic(), tickets: [], nodes: chain }, { hideRejected: false })
    const placement = layoutRadial(graph)
    for (const edge of graph.edges) {
      const points = pathPoints(graphEdgePath('from', placement.get(edge.source)!, placement.get(edge.target)!))
      for (const [id, box] of placement) if (id !== edge.source && id !== edge.target) expect(points.some((point) => inside(point, box)), `${edge.id} over ${id}`).toBe(false)
    }
    // Each step further from the topic than the one before.
    const distance = (id: string) => Math.hypot(middle(placement.get(id)!).x - middle(placement.get(ROOT_ID)!).x, middle(placement.get(id)!).y - middle(placement.get(ROOT_ID)!).y)
    for (let index = 1; index < chain.length; index += 1) expect(distance(`n${index}`)).toBeGreaterThan(distance(`n${index - 1}`))
  })
})
