// The graph and the layouts of the Mind map (src/renderer/product/mind-map-layout.ts, worfy-product-session
// ticket 08): `replaces` never joins the tree the layout gets, so it makes no cycle there; a node of a
// broken file, or one on a cycle main could not check, hangs from the root; «Hide rejected» leaves out a
// rejected Decision with its branch; 150 nodes are laid out by ELK (without its worker, as the Canvas's
// tests run it) in both views with no two boxes overlapping. WORFY_MIND_MAP_TIMING=1 prints the times.
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import {
  buildMindMapGraph,
  cardPlace,
  elkGraph,
  layoutElk,
  layoutSync,
  linesIn,
  MAX_LINES,
  MIND_MAP_FONT,
  MIND_MAP_VIEWS,
  nodeShape,
  nodeSize,
  ROOT_ID,
  setTextMeasure,
  withFilePlaces,
  wrappedLines,
  type MapGraph,
  type MapNode,
  type Placement,
} from '../../src/renderer/product/mind-map-layout'

const elk = new ELK()

const topic = (nodes: MindMapNode[], patch: Partial<ProductTopicState> = {}): ProductTopicState => ({
  name: 'demo',
  folder: '/demo/docs/product/demo',
  title: 'Demo',
  sections: [],
  tickets: [{ number: 1, slug: 'one', file: '01-one.md', title: 'One', status: 'open' }],
  nodes,
  errors: [],
  ...patch,
})

const decision = (id: string, from: string | null, status: 'accepted' | 'rejected', replaces?: string): MindMapNode => ({
  id,
  kind: 'decision',
  text: `Decision ${id}`,
  from,
  status,
  reason: 'because',
  ...(replaces === undefined ? {} : { replaces }),
})

/** Every node but the root has one incoming edge, and its chain of parents ends at the root. */
function expectTree(graph: MapGraph, edges: { sources: string[]; targets: string[] }[]): void {
  const parent = new Map<string, string>()
  for (const edge of edges) {
    expect(parent.has(edge.targets[0]!)).toBe(false)
    parent.set(edge.targets[0]!, edge.sources[0]!)
  }
  for (const node of graph.nodes) {
    if (node.id === ROOT_ID) {
      expect(parent.has(ROOT_ID)).toBe(false)
      continue
    }
    const seen = new Set<string>()
    let at = node.id
    while (at !== ROOT_ID) {
      expect(seen.has(at)).toBe(false)
      seen.add(at)
      at = parent.get(at)!
      expect(at).toBeDefined()
    }
  }
}

function expectNoOverlap(placement: Placement): void {
  const boxes = [...placement.values()]
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const [p, q] = [boxes[a]!, boxes[b]!]
      const apart = p.x + p.width <= q.x + 0.5 || q.x + q.width <= p.x + 0.5 || p.y + p.height <= q.y + 0.5 || q.y + q.height <= p.y + 0.5
      expect(apart, `${JSON.stringify(p)} overlaps ${JSON.stringify(q)}`).toBe(true)
    }
  }
}

describe('buildMindMapGraph', () => {
  it('draws `replaces` as an edge of its own and keeps it out of the tree the layout gets, in both views', async () => {
    // "late" grew from "early" and overturned it: with `replaces` in the tree that would be a cycle.
    const graph = buildMindMapGraph(topic([decision('early', 'ticket:01', 'rejected'), decision('late', 'early', 'accepted', 'early')]), { hideRejected: false })
    expect(graph.edges.filter((edge) => edge.kind === 'replaces')).toEqual([{ id: 'replaces:late', source: 'late', target: 'early', kind: 'replaces' }])
    for (const view of MIND_MAP_VIEWS) {
      const input = elkGraph(graph, view)
      expect(input.edges!.map((edge) => edge.id).sort()).toEqual(['from:early', 'from:late', 'from:ticket:01'])
      expectTree(graph, input.edges!)
      const placement = await layoutElk(graph, view, elk)
      expect([...placement.keys()].sort()).toEqual([ROOT_ID, 'early', 'late', 'ticket:01'].sort())
    }
  })

  it('hangs from the root a node whose parent is not drawn, and breaks a cycle through `from` a file main could not check', () => {
    const nodes: MindMapNode[] = [
      { id: 'lost', kind: 'idea', text: 'From a node that has an error', from: 'broken' },
      { id: 'broken', kind: 'idea', text: 'Named by an error', from: null },
      { id: 'a', kind: 'idea', text: 'A', from: 'b' },
      { id: 'b', kind: 'idea', text: 'B', from: 'a' },
      { id: 'orphan', kind: 'question', text: 'From a Ticket the map does not have', from: 'ticket:09' },
    ]
    const graph = buildMindMapGraph(topic(nodes, { errors: [{ file: 'mind-map.json', id: 'broken', message: 'node "broken": wrong' }] }), { hideRejected: false })
    const parentOf = new Map(graph.nodes.map((node) => [node.id, node.parent]))
    expect(parentOf.has('broken')).toBe(false)
    expect(parentOf.get('lost')).toBe(ROOT_ID)
    expect(parentOf.get('orphan')).toBe(ROOT_ID)
    // The cycle a → b → a is cut at one of them: it hangs from the root, the other from it.
    const [top, under] = parentOf.get('a') === ROOT_ID ? ['a', 'b'] : ['b', 'a']
    expect(parentOf.get(top)).toBe(ROOT_ID)
    expect(parentOf.get(under)).toBe(top)
    expectTree(graph, elkGraph(graph, 'tree').edges!)
  })

  it('«Hide rejected» leaves out a rejected Decision and everything that grew from it, and keeps the rest', () => {
    const nodes: MindMapNode[] = [
      decision('no', 'ticket:01', 'rejected'),
      { id: 'under-no', kind: 'idea', text: 'Under no', from: 'no' },
      { id: 'deeper', kind: 'objection', text: 'Deeper', from: 'under-no', source: 'a fact' },
      decision('yes', 'ticket:01', 'accepted', 'no'),
    ]
    const shown = buildMindMapGraph(topic(nodes), { hideRejected: true })
    expect(shown.nodes.map((node) => node.id)).toEqual([ROOT_ID, 'ticket:01', 'yes'])
    // The arrow to a hidden Decision goes with it.
    expect(shown.edges.some((edge) => edge.kind === 'replaces')).toBe(false)
    expect(buildMindMapGraph(topic(nodes), { hideRejected: false }).nodes).toHaveLength(6)
  })

  it('builds and lays out synchronously a chain 4000 nodes deep, with a rejected Decision at its top hidden with all of it', () => {
    const nodes: MindMapNode[] = [decision('n0', null, 'rejected')]
    for (let index = 1; index < 4000; index += 1) nodes.push({ id: `n${index}`, kind: 'idea', text: `Step ${index}`, from: `n${index - 1}` })
    const graph = buildMindMapGraph(topic(nodes), { hideRejected: false })
    for (const view of MIND_MAP_VIEWS) expect(layoutSync(graph, view).size).toBe(4002)
    expect(buildMindMapGraph(topic(nodes), { hideRejected: true }).nodes.map((node) => node.id)).toEqual([ROOT_ID, 'ticket:01'])
  })

  it('puts a node the file places at its x and y over the layout', () => {
    const graph = buildMindMapGraph(topic([{ id: 'here', kind: 'idea', text: 'Here', from: null, x: 10, y: -20, placed: 2 }]), { hideRejected: false })
    const placed = withFilePlaces(graph, layoutSync(graph, 'tree'))
    expect(placed.get('here')).toMatchObject({ x: 10, y: -20 })
  })

  it('ignores a place written for the earlier top-down Tree (no `placed`): the layout places that node (ticket 21)', () => {
    const graph = buildMindMapGraph(topic([{ id: 'old', kind: 'idea', text: 'Old', from: null, x: 10, y: -20 }]), { hideRejected: false })
    const layout = layoutSync(graph, 'tree')
    expect(withFilePlaces(graph, layout).get('old')).toEqual(layout.get('old'))
  })
})

/** A topic of `count` nodes under ten Tickets, of every kind, with a `replaces` now and then. */
function bigTopic(count: number): ProductTopicState {
  const kinds = ['idea', 'question', 'decision', 'objection'] as const
  const nodes: MindMapNode[] = []
  const decisions: string[] = []
  for (let index = 0; index < count; index += 1) {
    const id = `n${index}`
    const kind = kinds[index % kinds.length]!
    // The first thirty under the Tickets, the rest under an earlier node: a tree several levels deep.
    const from = index < 30 ? `ticket:${String((index % 10) + 1).padStart(2, '0')}` : `n${(index * 7) % index}`
    const text = `Node ${index}: ${'a few words '.repeat((index % 5) + 1)}`.trim()
    if (kind === 'decision') {
      const replaces = decisions.length > 0 && index % 3 === 0 ? decisions[decisions.length - 1] : undefined
      nodes.push({ ...decision(id, from, index % 8 === 2 ? 'rejected' : 'accepted', replaces), text })
      decisions.push(id)
    } else nodes.push({ id, kind, text, from, ...(kind === 'objection' ? { source: 'docs/roadmap.md' } : {}) })
  }
  const tickets = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, slug: `t${index + 1}`, file: `${String(index + 1).padStart(2, '0')}-t.md`, title: `Ticket ${index + 1}`, status: 'open' as const }))
  return topic(nodes, { tickets })
}

describe('150 nodes', () => {
  it('are laid out by ELK in both views, every node placed and no two boxes overlapping', async () => {
    const graph = buildMindMapGraph(bigTopic(150), { hideRejected: false })
    expect(graph.nodes).toHaveLength(161)
    for (const view of MIND_MAP_VIEWS) {
      const started = performance.now()
      const placement = await layoutElk(graph, view, elk)
      const elkMs = performance.now() - started
      const syncStarted = performance.now()
      const sync = layoutSync(graph, view)
      const syncMs = performance.now() - syncStarted
      expect(placement.size).toBe(161)
      expect(sync.size).toBe(161)
      expectNoOverlap(placement)
      expectNoOverlap(sync)
      if (process.env['WORFY_MIND_MAP_TIMING'] === '1') console.info(`[mind-map] 150 nodes, ${view}: ELK ${elkMs.toFixed(1)} ms, synchronous ${syncMs.toFixed(1)} ms`)
    }
  })
})

describe('nodeShape', () => {
  it('draws a Question with pointed ends, an Objection slanted and an Idea as a pill, all inside the box', () => {
    expect(nodeShape('question', 200, 40)).toBe('M11,0 H189 L200,20 L189,40 H11 L0,20 Z')
    expect(nodeShape('objection', 200, 40)).toBe('M10,0 H200 L190,40 H0 Z')
    // A pill: the corners as round as the box is high, up to 17.
    expect(nodeShape('idea', 200, 30)).toMatch(/^M15,0 H185 A15,15 /)
    expect(nodeShape('idea', 200, 60)).toMatch(/^M17,0 H183 A17,17 /)
    expect(nodeShape('decision', 200, 40)).toMatch(/^M3,0 /)
    expect(nodeShape('topic', 200, 40)).toMatch(/^M10,0 /)
    for (const kind of ['topic', 'ticket', 'idea', 'question', 'decision', 'objection'] as const) {
      const numbers = nodeShape(kind, 200, 40).match(/-?[\d.]+/g)!.map(Number)
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...numbers)).toBeLessThanOrEqual(200)
    }
  })
})

describe('ELK’s Tree (ticket 21)', () => {
  it('grows left to right with the columns 48 px apart, and gives every node back at its own size', async () => {
    const graph = buildMindMapGraph(bigTopic(40), { hideRejected: false })
    const placement = await layoutElk(graph, 'tree', elk)
    for (const node of graph.nodes) {
      const place = placement.get(node.id)!
      // The width ELK got for the column gap is taken off again: the box is the node's own.
      expect({ width: place.width, height: place.height }).toEqual(nodeSize(node, 'tree'))
      if (node.parent === null) continue
      const parent = placement.get(node.parent)!
      expect(place.x).toBeGreaterThanOrEqual(parent.x + parent.width + 48)
    }
  })
})

// A node's text inside its box (ticket 23): the box's height follows the lines the text takes when measured
// glyph by glyph, as the page's canvas measures it, not an average glyph that Cyrillic outgrows.
describe('Mind map node text', () => {
  /**
   * A measure close to the UI font's: a Cyrillic letter wider than a Latin one (about 0.66 em against
   * 0.52 em), a space narrow. The estimate of 0.55 em for every glyph undercounts Cyrillic.
   */
  const fontLike = (text: string, size: number, bold: boolean): number =>
    [...text].reduce((width, glyph) => width + (glyph === ' ' ? 0.27 : /[\u0400-\u04ff]/.test(glyph) ? 0.66 : 0.52) * size * (bold ? 1.05 : 1), 0)
  afterEach(() => setTextMeasure(null))

  const node = (text: string, patch: Partial<MapNode> = {}): MapNode => ({ id: 'n', kind: 'decision', text, parent: ROOT_ID, status: 'accepted', ...patch })
  /** The lines the browser takes for the text in the room the node really gives it (no margin). */
  const room = (kind: MapNode['kind'], view: 'tree' | 'graph', branch = false): number => {
    const size = MIND_MAP_FONT[view]
    const pad = { decision: [0.64, 0.88], idea: [0.84, 1.2], question: [1.16, 1.44], objection: [1.16, 1.44] }[kind as 'decision']!
    // The icon's circle (1.37 em at 0.76) and the gap after it (0.52 em); on a branch the fold mark (40 px) and its gap.
    return (view === 'tree' ? 220 : 180) - (pad[0]! + pad[1]! + 1.56) * size - (branch ? 40 + 0.52 * size : 0)
  }

  const texts = [
    'Mind map 60 / чат 40, граф двигается',
    'Файл в docs/product/, правит tool агента',
    'Советник: предлагает, спорит, пишет черновики Epic-ов; принимает владелец',
    'The advisor proposes, argues and drafts Epics; the owner accepts or rejects each one',
    'Проверить советника в интерфейсе потом',
    'Ок',
  ]

  it('gives a long Russian or English text a box that holds every line it takes, up to MAX_LINES', () => {
    setTextMeasure(fontLike)
    for (const view of MIND_MAP_VIEWS) {
      for (const text of texts) {
        for (const branch of [false, true]) {
          const shown = node(text, { branch })
          const { height } = nodeSize(shown, view)
          const size = MIND_MAP_FONT[view]
          const needs = Math.min(MAX_LINES, wrappedLines(text, room('decision', view, branch), (part) => fontLike(part, size, false)))
          // Every line the text takes, at the node's line height, and the 18 px of padding fit the box.
          expect(needs * size * 1.35 + 18, `${view} «${text}»`).toBeLessThanOrEqual(height)
          // The clamp MindMap.tsx gives the text lets that many lines through, and no more than the box holds.
          expect(linesIn(shown, view, height), `${view} «${text}»`).toBeGreaterThanOrEqual(needs)
          expect(linesIn(shown, view, height) * size * 1.35 + 18).toBeLessThanOrEqual(height)
        }
      }
    }
  })

  it('makes a Russian text a line taller than the average-glyph estimate did, where Cyrillic is wider', () => {
    const text = 'Проверить советника в интерфейсе потом'
    const estimated = nodeSize(node(text), 'tree').height
    setTextMeasure(fontLike)
    expect(nodeSize(node(text), 'tree').height).toBeGreaterThan(estimated)
  })

  it('keeps room for the fold mark of a branch, so its text wraps sooner', () => {
    setTextMeasure(fontLike)
    const text = 'Файл в docs/product/, правит tool агента'
    expect(nodeSize(node(text, { branch: true }), 'tree').height).toBeGreaterThan(nodeSize(node(text), 'tree').height)
    // buildMindMapGraph marks a node of the file that has children drawn.
    const graph = buildMindMapGraph(topic([decision('parent', null, 'accepted'), decision('child', 'parent', 'accepted')]), { hideRejected: false })
    expect(graph.nodes.find((each) => each.id === 'parent')!.branch).toBe(true)
    expect(graph.nodes.find((each) => each.id === 'child')!.branch).toBe(false)
  })

  it('wraps at the spaces and breaks a word longer than the line anywhere, as `overflow-wrap: anywhere` does', () => {
    const glyphs = (part: string): number => part.length * 10
    expect(wrappedLines('aaa bbb ccc', 75, glyphs)).toBe(2)
    expect(wrappedLines('aaa bbb ccc', 115, glyphs)).toBe(1)
    expect(wrappedLines('x'.repeat(25), 100, glyphs)).toBe(3)
    expect(wrappedLines('aa ' + 'x'.repeat(25), 100, glyphs)).toBe(4)
    // Counting stops past the most lines a node shows.
    expect(wrappedLines('x'.repeat(5000), 100, glyphs)).toBe(MAX_LINES + 1)
    expect(wrappedLines('', 100, glyphs)).toBe(1)
  })
})

// Where the node card goes (ticket 23): beside its node, as the prototype puts it, inside the map.
describe('Mind map node card place', () => {
  const pane = { width: 1000, height: 700 }
  const card = { width: 300, height: 260 }
  const overlaps = (a: { x: number; y: number; width: number; height: number }, at: { left: number; top: number }): boolean =>
    at.left < a.x + a.width && at.left + card.width > a.x && at.top < a.y + a.height && at.top + card.height > a.y

  it('stands to the right of the node, its top a little above the node’s middle', () => {
    const node = { x: 100, y: 200, width: 200, height: 60 }
    expect(cardPlace(node, pane, card)).toEqual({ left: 314, top: 200 })
  })

  it('goes to the left of a node near the right edge, and under a node where neither side has room', () => {
    const right = { x: 750, y: 300, width: 200, height: 60 }
    const atRight = cardPlace(right, pane, card)
    expect(atRight.left).toBe(750 - 14 - 300)
    expect(overlaps(right, atRight)).toBe(false)
    const narrow = { width: 500, height: 700 }
    const middle = { x: 150, y: 100, width: 200, height: 60 }
    const under = cardPlace(middle, narrow, card)
    expect(under.top).toBe(100 + 60 + 14)
    expect(overlaps(middle, under)).toBe(false)
    expect(under.left).toBeGreaterThanOrEqual(8)
    expect(under.left + card.width).toBeLessThanOrEqual(narrow.width - 8)
    // Near the bottom, above the node instead.
    const low = { x: 150, y: 560, width: 200, height: 60 }
    const above = cardPlace(low, narrow, card)
    expect(above.top).toBe(560 - 14 - 260)
    expect(overlaps(low, above)).toBe(false)
  })

  it('keeps the card inside the map, 8 px from its edges, wherever the node is', () => {
    for (const node of [
      { x: 100, y: -40, width: 200, height: 60 },
      { x: 100, y: 680, width: 200, height: 60 },
      { x: -300, y: 300, width: 200, height: 60 },
      { x: 1200, y: 300, width: 200, height: 60 },
    ]) {
      const at = cardPlace(node, pane, card)
      expect(at.left).toBeGreaterThanOrEqual(8)
      expect(at.left + card.width).toBeLessThanOrEqual(pane.width - 8)
      expect(at.top).toBeGreaterThanOrEqual(8)
      expect(at.top + card.height).toBeLessThanOrEqual(pane.height - 8)
    }
  })
})
