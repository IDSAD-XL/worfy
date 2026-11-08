// The graph and the layouts of the Mind map (src/renderer/product/mind-map-layout.ts, worfy-product-session
// ticket 08): `replaces` never joins the tree the layout gets, so it makes no cycle there; a node of a
// broken file, or one on a cycle main could not check, hangs from the root; «Hide rejected» leaves out a
// rejected Decision with its branch; 150 nodes are laid out by ELK (without its worker, as the Canvas's
// tests run it) in both views with no two boxes overlapping. WORFY_MIND_MAP_TIMING=1 prints the times.
import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it } from 'vitest'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import {
  buildMindMapGraph,
  elkGraph,
  layoutElk,
  layoutSync,
  MIND_MAP_VIEWS,
  ROOT_ID,
  withFilePlaces,
  type MapGraph,
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

  it('puts a node the file places at its x and y over the layout', () => {
    const graph = buildMindMapGraph(topic([{ id: 'here', kind: 'idea', text: 'Here', from: null, x: 10, y: -20 }]), { hideRejected: false })
    const placed = withFilePlaces(graph, layoutSync(graph, 'tree'))
    expect(placed.get('here')).toMatchObject({ x: 10, y: -20 })
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
