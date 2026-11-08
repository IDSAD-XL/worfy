// What the Mind map of a Product Session topic draws, and where (Epic worfy-product-session, ticket 08):
// the graph built from the topic as main reads it (src/shared/ipc/product.ts) and its two layouts, the
// "Tree" (top to bottom, larger text) and the "Graph" (left to right). MindMap.tsx draws the answer.
//
// The root is the topic, the Tickets of its map hang from the root, and every node of mind-map.json hangs
// from its `from`: another node, a Ticket (`ticket:NN`) or the topic. That is a tree, and only its links
// go to the layout. `replaces` — the Decision a later Decision overturned — is a second, dashed arrow drawn
// over the tree: it never joins the layout, so it cannot make a cycle in it.
//
// The layout is ELK's (`mrtree` for the Tree, `layered` for the Graph), in the window's ELK Web Worker
// (../canvas/elk/client.ts); `layoutSync` answers until it has, and wherever there is no worker. Over
// either, `withFilePlaces` puts a node that carries `x` and `y` in the file where the file says (ticket 09
// writes them by hand).
import type { ElkNode } from 'elkjs/lib/elk-api'
import type { ProductTopicState } from '../../shared/ipc/product'
import type { DecisionStatus, MindMapNode, MindMapNodeKind } from '../../shared/product/mind-map'
import type { ElkEngine } from '../canvas/elk/layout'

export const MIND_MAP_VIEWS = ['tree', 'graph'] as const
export type MindMapView = (typeof MIND_MAP_VIEWS)[number]

/** The text size of a node in each view, px: the Tree's is larger (owner's decision 06). */
export const MIND_MAP_FONT: Readonly<Record<MindMapView, number>> = { tree: 15, graph: 12 }

/** The id of the root; `@` is in no node id and no `ticket:NN`. */
export const ROOT_ID = '@topic'

export type MapTicket = ProductTopicState['tickets'][number]
export type MapNodeKind = 'topic' | 'ticket' | MindMapNodeKind

export interface MapNode {
  id: string
  kind: MapNodeKind
  text: string
  /** The node it grew from; null for the root only. */
  parent: string | null
  /** Decision only. */
  status?: DecisionStatus | undefined
  /** The node of mind-map.json; none for the root and the Tickets. */
  source?: MindMapNode | undefined
  ticket?: MapTicket | undefined
}

export interface MapEdge {
  id: string
  /** `from`: the parent, `replaces`: the later Decision. */
  source: string
  target: string
  kind: 'from' | 'replaces'
}

export interface MapGraph {
  /** The root first, then each node after its parent. */
  nodes: MapNode[]
  edges: MapEdge[]
}

export interface Placed {
  x: number
  y: number
  width: number
  height: number
}

export type Placement = ReadonlyMap<string, Placed>

/** `ticket:02` — how a node's `from` names Ticket 2 (src/shared/product/mind-map.ts, TICKET_REF). */
export const ticketRef = (number: number): string => `ticket:${String(number).padStart(2, '0')}`

/**
 * The graph the topic draws. A node named by one of the topic's errors is left out: a file with an error
 * still draws its right nodes, and a node whose parent is not drawn hangs from the root. With
 * `hideRejected` a rejected Decision and its whole branch are left out; the file is not changed.
 */
export function buildMindMapGraph(topic: ProductTopicState, { hideRejected }: { hideRejected: boolean }): MapGraph {
  const broken = new Set(topic.errors.flatMap((error) => (error.id === null ? [] : [error.id])))
  const byId = new Map<string, MindMapNode>()
  for (const node of topic.nodes) if (!broken.has(node.id) && !byId.has(node.id)) byId.set(node.id, node)
  const tickets = new Map(topic.tickets.map((ticket) => [ticketRef(ticket.number), ticket]))

  // The parent of each node, as far as it is drawn; a chain that comes back to itself (a file main
  // could not check) hangs from the root where it closes.
  const parentOf = new Map<string, string>()
  for (const node of byId.values()) {
    const from = node.from
    parentOf.set(node.id, from !== null && (byId.has(from) || tickets.has(from)) ? from : ROOT_ID)
  }
  // Each chain is walked once: a node already settled leads to the root.
  const settled = new Set<string>()
  for (const id of byId.keys()) {
    const path = new Set<string>()
    let at = id
    while (byId.has(at) && !settled.has(at) && !path.has(at)) {
      path.add(at)
      at = parentOf.get(at)!
    }
    if (path.has(at)) parentOf.set(at, ROOT_ID)
    for (const each of path) settled.add(each)
  }

  // A node is hidden when it or a node above it is a rejected Decision; each node is decided once.
  const hidden = new Set<string>()
  if (hideRejected) {
    const decided = new Map<string, boolean>()
    for (const id of byId.keys()) {
      const path: string[] = []
      let at = id
      let hide = false
      while (byId.has(at)) {
        const known = decided.get(at)
        if (known !== undefined) {
          hide = known
          break
        }
        path.push(at)
        const node = byId.get(at)!
        if (node.kind === 'decision' && node.status === 'rejected') {
          hide = true
          break
        }
        at = parentOf.get(at)!
      }
      for (const each of path) {
        decided.set(each, hide)
        if (hide) hidden.add(each)
      }
    }
  }

  const children = new Map<string, string[]>()
  for (const [id, parent] of parentOf) {
    if (hidden.has(id)) continue
    const kids = children.get(parent)
    if (kids === undefined) children.set(parent, [id])
    else kids.push(id)
  }

  const nodes: MapNode[] = [{ id: ROOT_ID, kind: 'topic', text: topic.title ?? topic.name, parent: null }]
  for (const [ref, ticket] of tickets) nodes.push({ id: ref, kind: 'ticket', text: ticket.title ?? ref, parent: ROOT_ID, ticket })
  // Each node after its parent: the order the tree's layout and a reader expect.
  const queue = [ROOT_ID, ...tickets.keys()]
  for (let index = 0; index < queue.length; index += 1) {
    for (const id of children.get(queue[index]!) ?? []) {
      const source = byId.get(id)!
      nodes.push({ id, kind: source.kind, text: source.text, parent: queue[index]!, status: source.status, source })
      queue.push(id)
    }
  }

  const drawn = new Set(nodes.map((node) => node.id))
  const edges: MapEdge[] = nodes.flatMap((node) => (node.parent === null ? [] : [{ id: `from:${node.id}`, source: node.parent, target: node.id, kind: 'from' as const }]))
  for (const node of nodes) {
    const replaces = node.kind === 'decision' ? node.source?.replaces : undefined
    if (replaces !== undefined && drawn.has(replaces)) edges.push({ id: `replaces:${node.id}`, source: node.id, target: replaces, kind: 'replaces' })
  }
  return { nodes, edges }
}

const WIDTH: Readonly<Record<MindMapView, number>> = { tree: 220, graph: 180 }
const LINE = 1.35

/**
 * The room left and right of a node's text, in em of the node's font, as the prototype Card of the
 * Product Session has it (ticket 21): a slanted or pointed side (Question, Objection) keeps the text
 * further in than a straight one. `left` runs up to the icon; the icon and the gap after
 * it come on top (ICON_EM). MindMap.tsx pads the node with these, and nodeSize counts the lines with them.
 */
export const NODE_PAD: Readonly<Record<MapNodeKind, { left: number; right: number }>> = {
  topic: { left: 1.12, right: 1.12 },
  ticket: { left: 0.84, right: 1.2 },
  idea: { left: 0.84, right: 1.2 },
  question: { left: 1.16, right: 1.44 },
  objection: { left: 1.16, right: 1.44 },
  decision: { left: 0.64, right: 0.88 },
}

/** The icon's circle and the gap after it, em: a Ticket's number takes a wider badge; the topic has none. */
const ICON_EM: Readonly<Record<MapNodeKind, number>> = { topic: 0, ticket: 2.2, idea: 1.56, question: 1.56, objection: 1.56, decision: 1.56 }

/** The shape a node's kind is drawn with: the prototype tells the kinds apart by shape as well as by colour. */
export type NodeShape = 'topic' | 'ticket' | 'pill' | 'hexagon' | 'slant' | 'box'

export const SHAPE_OF: Readonly<Record<MapNodeKind, NodeShape>> = {
  topic: 'topic',
  ticket: 'ticket',
  idea: 'pill',
  question: 'hexagon',
  objection: 'slant',
  decision: 'box',
}

const round = (value: number): string => String(Math.round(value * 10) / 10)

function roundRect(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2)
  const [w, h, k] = [round(width), round(height), round(r)]
  return `M${k},0 H${round(width - r)} A${k},${k} 0 0 1 ${w},${k} V${round(height - r)} A${k},${k} 0 0 1 ${round(width - r)},${h} H${k} A${k},${k} 0 0 1 0,${round(height - r)} V${k} A${k},${k} 0 0 1 ${k},0 Z`
}

/**
 * The outline of a node of `kind` in a box of `width` by `height`, an SVG path from the box's top left
 * corner: an Idea a pill, a Question a hexagon with pointed ends, an Objection a slanted box, a Decision
 * a box with small corners, the topic and the Tickets boxes with large ones.
 */
export function nodeShape(kind: MapNodeKind, width: number, height: number): string {
  switch (SHAPE_OF[kind]) {
    case 'pill':
      return roundRect(width, height, Math.min(height / 2, 17))
    case 'hexagon': {
      const tip = Math.min(11, width / 4)
      return `M${round(tip)},0 H${round(width - tip)} L${round(width)},${round(height / 2)} L${round(width - tip)},${round(height)} H${round(tip)} L0,${round(height / 2)} Z`
    }
    case 'slant': {
      const lean = Math.min(10, width / 4)
      return `M${round(lean)},0 H${round(width)} L${round(width - lean)},${round(height)} H0 Z`
    }
    case 'topic':
      return roundRect(width, height, 10)
    case 'ticket':
      return roundRect(width, height, 8)
    case 'box':
      return roundRect(width, height, 3)
  }
}
/** A node shows at most this many lines of its text (mind-map.css clamps the rest). */
export const MAX_LINES = 3

/** The size of a node's box: the root and the Tickets are larger; the height follows the lines its text takes. */
export function nodeSize(node: MapNode, view: MindMapView): { width: number; height: number } {
  const big = node.kind === 'topic' || node.kind === 'ticket'
  const font = MIND_MAP_FONT[view] + (big ? 2 : 0)
  const width = WIDTH[view] + (big ? 40 : 0)
  // An average glyph is about 0.55 of the font size; the text has the node's width less its padding and icon.
  const inset = (NODE_PAD[node.kind].left + ICON_EM[node.kind] + NODE_PAD[node.kind].right) * font
  const perLine = Math.max(8, Math.floor((width - inset) / (font * 0.55)))
  const lines = Math.min(MAX_LINES, Math.max(1, Math.ceil(node.text.length / perLine)))
  return { width, height: Math.ceil(lines * font * LINE + 20) }
}

const GAP: Readonly<Record<MindMapView, { depth: number; across: number }>> = { tree: { depth: 56, across: 24 }, graph: { depth: 72, across: 14 } }

/** The layout's places, with each node the file places (`x`, `y`) where the file says. */
export function withFilePlaces(graph: MapGraph, placement: Placement): Placement {
  const placed = new Map(placement)
  for (const node of graph.nodes) {
    const place = placed.get(node.id)
    const { x, y } = node.source ?? {}
    if (place !== undefined && x !== undefined && y !== undefined) placed.set(node.id, { ...place, x, y })
  }
  return placed
}

/**
 * A tidy tree without ELK: each branch takes the room its leaves need across, a parent sits in the middle
 * of its children, and each depth is one row (Tree) or one column (Graph) as deep as its largest node.
 */
export function layoutSync(graph: MapGraph, view: MindMapView): Placement {
  const sizes = new Map(graph.nodes.map((node) => [node.id, nodeSize(node, view)]))
  const along = (id: string) => (view === 'tree' ? sizes.get(id)!.width : sizes.get(id)!.height)
  const deep = (id: string) => (view === 'tree' ? sizes.get(id)!.height : sizes.get(id)!.width)
  const children = new Map<string, string[]>()
  const depth = new Map<string, number>()
  for (const node of graph.nodes) {
    depth.set(node.id, node.parent === null ? 0 : depth.get(node.parent)! + 1)
    if (node.parent === null) continue
    const kids = children.get(node.parent)
    if (kids === undefined) children.set(node.parent, [node.id])
    else kids.push(node.id)
  }
  const { depth: depthGap, across } = GAP[view]
  const span = new Map<string, number>()
  for (const node of [...graph.nodes].reverse()) {
    const kids = children.get(node.id) ?? []
    const sum = kids.reduce((total, kid) => total + span.get(kid)!, 0) + across * Math.max(0, kids.length - 1)
    span.set(node.id, Math.max(along(node.id), sum))
  }
  const levels: number[] = []
  for (const node of graph.nodes) levels[depth.get(node.id)!] = Math.max(levels[depth.get(node.id)!] ?? 0, deep(node.id))
  const levelStart: number[] = []
  levels.forEach((size, index) => (levelStart[index] = index === 0 ? 0 : levelStart[index - 1]! + levels[index - 1]! + depthGap))

  // Parents come before their children in `graph.nodes`: each node is placed from the start its parent
  // gave it, and gives its children theirs — a loop, not a recursion, so a chain however deep fits.
  const placement = new Map<string, Placed>()
  const startOf = new Map<string, number>()
  for (const node of graph.nodes) {
    const id = node.id
    const { width, height } = sizes.get(id)!
    const middle = (startOf.get(id) ?? 0) + span.get(id)! / 2
    const level = levelStart[depth.get(id)!]!
    placement.set(id, view === 'tree' ? { x: middle - width / 2, y: level, width, height } : { x: level, y: middle - height / 2, width, height })
    const kids = children.get(id) ?? []
    const sum = kids.reduce((total, kid) => total + span.get(kid)!, 0) + across * Math.max(0, kids.length - 1)
    let at = middle - sum / 2
    for (const kid of kids) {
      startOf.set(kid, at)
      at += span.get(kid)! + across
    }
  }
  return placement
}

/** The ELK graph of a view: the nodes with their sizes and the `from` edges only — never `replaces`. */
export function elkGraph(graph: MapGraph, view: MindMapView): ElkNode {
  const { depth, across } = GAP[view]
  const layoutOptions: Record<string, string> =
    view === 'tree'
      ? { 'elk.algorithm': 'mrtree', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': String(across) }
      : {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': String(across),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(depth),
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        }
  return {
    id: 'mind-map',
    layoutOptions: { ...layoutOptions, 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
    children: graph.nodes.map((node) => ({ id: node.id, ...nodeSize(node, view) })),
    edges: graph.edges.filter((edge) => edge.kind === 'from').map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
}

/** The view's layout by ELK. */
export async function layoutElk(graph: MapGraph, view: MindMapView, elk: ElkEngine): Promise<Placement> {
  const answer = await elk.layout(elkGraph(graph, view))
  const placement = new Map<string, Placed>()
  for (const child of answer.children ?? []) {
    placement.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 })
  }
  return placement
}

/** What ELK's layout depends on: the view and each node's parent, kind and text length (its size); not the file's places. */
export function layoutKey(graph: MapGraph, view: MindMapView): string {
  return JSON.stringify([view, graph.nodes.map((node) => [node.id, node.parent, node.text.length, node.kind])])
}
