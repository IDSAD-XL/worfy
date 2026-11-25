// worfy-product-session ticket 34: Mind map nodes (src/renderer/product/mind-map-layout.ts) whose text fits in
// four lines in a slightly wider box were cut with «…», the fold mark of a branch taking a third of the text's
// room. Such a box now grows; only a text too long for any box is cut.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildMindMapGraph,
  MAX_LINES,
  MIND_MAP_FONT,
  MIND_MAP_VIEWS,
  NODE_PAD,
  nodeSize,
  setTextMeasure,
  wrappedLines,
  type MapNode,
} from '../../src/renderer/product/mind-map-layout'
import { fontLike, topic } from './mind-map-long-map'

beforeEach(() => setTextMeasure(fontLike))
afterEach(() => setTextMeasure(null))

describe('the Mind map node text (ticket 34)', () => {
  /** The lines the text takes in the room a node of `width` gives it (no margin), as the browser wraps it. */
  const linesAt = (node: MapNode, view: 'tree' | 'graph', width: number): number => {
    const size = MIND_MAP_FONT[view]
    const pad = NODE_PAD[node.kind]
    const room = width - (pad.left + pad.right + 1.56) * size - (node.branch === true ? 40 + 0.52 * size : 0)
    return wrappedLines(node.text, room, (part) => fontLike(part, size, false), MAX_LINES + 1)
  }

  it('cuts no node of the map short but the one too long for any box, in both views', () => {
    const graph = buildMindMapGraph(topic(), { hideRejected: false })
    for (const view of MIND_MAP_VIEWS) {
      const cut = graph.nodes
        .filter((node) => node.kind !== 'topic' && node.kind !== 'ticket')
        .filter((node) => linesAt(node, view, nodeSize(node, view).width) > MAX_LINES)
        .map((node) => node.id)
      expect(cut, view).toEqual(['very-long'])
    }
  })

  it('gives a text that needs more than four lines a wider box, and the box room for every line', () => {
    const graph = buildMindMapGraph(topic(), { hideRejected: false })
    const shortest = graph.nodes.find((node) => node.id === 'who')!
    const branch = graph.nodes.find((node) => node.id === 'root-idea')!
    expect(branch.branch).toBe(true)
    for (const view of MIND_MAP_VIEWS) {
      const size = MIND_MAP_FONT[view]
      const wide = nodeSize(branch, view)
      expect(wide.width, view).toBeGreaterThan(nodeSize(shortest, view).width)
      expect(linesAt(branch, view, wide.width) * size * 1.35 + 18, view).toBeLessThanOrEqual(wide.height)
    }
  })

  it('keeps the box of a text too long for any box as wide as the others, cut at four lines', () => {
    const graph = buildMindMapGraph(topic(), { hideRejected: false })
    const long = graph.nodes.find((node) => node.id === 'very-long')!
    const short = graph.nodes.find((node) => node.id === 'who')!
    for (const view of MIND_MAP_VIEWS) {
      expect(nodeSize(long, view).width, view).toBe(nodeSize(short, view).width)
      expect(nodeSize(long, view).height, view).toBe(Math.ceil(MAX_LINES * MIND_MAP_FONT[view] * 1.35 + 20))
    }
  })
})
