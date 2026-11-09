// What the Mind map of a Product Session topic draws, and where (Epic worfy-product-session, ticket 08):
// the graph built from the topic as main reads it (src/shared/ipc/product.ts) and its two layouts, the
// "Tree" (a tidy tree, larger text) and the "Graph" (radial). The Tree grows left to right, as the prototype's
// tree does (ticket 21): the root at the left, each child to the right of its parent. The Graph puts the root
// in the middle and its branches around it, as the prototype's graph does (ticket 26). MindMap.tsx draws the answer.
//
// The root is the topic, the Tickets of its map hang from the root, and every node of mind-map.json hangs
// from its `from`: another node, a Ticket (`ticket:NN`) or the topic. That is a tree, and only its links
// go to the layout. `replaces` — the Decision a later Decision overturned — is a second, dashed arrow drawn
// over the tree: it never joins the layout, so it cannot make a cycle in it.
//
// The Tree's layout is ELK's `mrtree`, in the window's ELK Web Worker (../canvas/elk/client.ts); `layoutSync`
// answers until it has, and wherever there is no worker. The Graph's is `layoutRadial`, the prototype's own
// algorithm, synchronous: ELK has nothing that keeps the root in the middle and the boxes apart at once. Over
// either, `withFilePlaces` puts a node that carries `x` and `y` in the file where the file says (ticket 09
// writes them by hand).
import type { ElkNode } from 'elkjs/lib/elk-api'
import type { ProductTopicState } from '../../shared/ipc/product'
import { MIND_MAP_PLACED, type DecisionStatus, type MindMapNode, type MindMapNodeKind } from '../../shared/product/mind-map'
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
  /** A node of mind-map.json with children drawn: it carries a fold mark beside its text (ticket 09). */
  branch?: boolean | undefined
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
      nodes.push({ id, kind: source.kind, text: source.text, parent: queue[index]!, status: source.status, source, branch: children.has(id) })
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
/** The room above and below a node's text, px: mind-map.css pads the node 9 px at the top and the bottom. */
const NODE_PAD_Y = 20

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
/**
 * A node shows at most this many lines of its text, as the prototype does (ticket 23); mind-map.css clamps a
 * longer text with an ellipsis, and the node's card and its tooltip show it whole.
 */
export const MAX_LINES = 4

/**
 * The room the fold mark of a branch takes beside the text (mind-map.css, .w-mind__fold), px: its widest
 * label, «+999» in the 12 px mono font with its padding and border. The gap before it comes on top, 0.52 em.
 */
const FOLD_PX = 40

/** The width of a node's text, px, in the node's font: `size` px, semibold when `bold` (the root and the Tickets). */
export type TextMeasure = (text: string, size: number, bold: boolean) => number

/** An estimate where nothing measures: an average glyph is about 0.55 of the font size. */
const estimate: TextMeasure = (text, size) => text.length * size * 0.55

let measureText: TextMeasure = estimate

/**
 * How nodeSize measures text: MindMap.tsx gives the page's canvas measure, so Cyrillic, which is wider than
 * Latin, gets its true width; null puts back the estimate (no canvas: a test without layout).
 */
export function setTextMeasure(measure: TextMeasure | null): void {
  measureText = measure ?? estimate
}

/**
 * The lines `text` takes in a box `room` px wide, as the browser wraps it: at the spaces, and a word longer
 * than the line anywhere (mind-map.css, `overflow-wrap: anywhere`). Counting stops past `most`.
 */
export function wrappedLines(text: string, room: number, measure: (text: string) => number, most = MAX_LINES): number {
  let lines = 1
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (word === '') continue
    const probe = line === '' ? word : `${line} ${word}`
    if (measure(probe) <= room) {
      line = probe
      continue
    }
    if (line !== '') lines += 1
    let rest = word
    while (lines <= most && rest.length > 1 && measure(rest) > room) {
      // The longest head of the word that fits, at least one glyph.
      let [fits, over] = [1, rest.length]
      while (over - fits > 1) {
        const middle = Math.floor((fits + over) / 2)
        if (measure(rest.slice(0, middle)) <= room) fits = middle
        else over = middle
      }
      rest = rest.slice(fits)
      lines += 1
    }
    line = rest
    if (lines > most) return lines
  }
  return lines
}

/**
 * The size of a node's box: the root and the Tickets are larger; the height follows the lines its text
 * takes, measured in its font (setTextMeasure) and at most MAX_LINES. The text
 * has the node's width less its padding, its icon and, on a branch, the fold mark. The text is wrapped 2 px
 * narrower than the box it gets, so a measure a hair off makes the box a line taller, never too short.
 */
export function nodeSize(node: MapNode, view: MindMapView): { width: number; height: number } {
  const big = node.kind === 'topic' || node.kind === 'ticket'
  const size = MIND_MAP_FONT[view] + (big ? 2 : 0)
  const width = WIDTH[view] + (big ? 40 : 0)
  const inset = (NODE_PAD[node.kind].left + ICON_EM[node.kind] + NODE_PAD[node.kind].right) * size + (node.branch === true ? FOLD_PX + 0.52 * size : 0)
  const lines = Math.min(MAX_LINES, wrappedLines(node.text, Math.max(size, width - inset - 2), (text) => measureText(text, size, big)))
  return { width, height: Math.ceil(lines * size * LINE + NODE_PAD_Y) }
}

/**
 * The lines of text a node's box of `height` px holds, the clamp MindMap.tsx gives its text: where the
 * browser wraps a text wider than measured, the last line that fits ends in an ellipsis instead of
 * running over the box's border.
 */
export function linesIn(node: MapNode, view: MindMapView, height: number): number {
  const size = MIND_MAP_FONT[view] + (node.kind === 'topic' || node.kind === 'ticket' ? 2 : 0)
  return Math.max(1, Math.min(MAX_LINES, Math.floor((height - NODE_PAD_Y) / (size * LINE) + 0.001)))
}

/** The Tree's room between two depths (columns) and between two nodes of one depth, px: the prototype's. */
const GAP = { depth: 48, across: 12 } as const

/**
 * The layout's places, with each node the file places (`x`, `y`) where the file says. A place written for
 * the earlier top-down Tree (no `placed`, MIND_MAP_PLACED) is ignored: the layout places that node.
 */
export function withFilePlaces(graph: MapGraph, placement: Placement): Placement {
  const placed = new Map(placement)
  for (const node of graph.nodes) {
    const place = placed.get(node.id)
    const { x, y, placed: forLayout } = node.source ?? {}
    if (place !== undefined && x !== undefined && y !== undefined && forLayout === MIND_MAP_PLACED) placed.set(node.id, { ...place, x, y })
  }
  return placed
}

/** The view's layout without ELK: the tidy tree for the Tree, the radial layout for the Graph. */
export function layoutSync(graph: MapGraph, view: MindMapView): Placement {
  return view === 'graph' ? layoutRadial(graph) : layoutTidy(graph)
}

/**
 * A tidy tree without ELK: each branch takes the room its leaves need across (down the screen), a parent
 * sits in the middle of its children, and each depth is one column as wide as its widest node.
 */
function layoutTidy(graph: MapGraph): Placement {
  const view = 'tree'
  const sizes = new Map(graph.nodes.map((node) => [node.id, nodeSize(node, view)]))
  const along = (id: string) => sizes.get(id)!.height
  const deep = (id: string) => sizes.get(id)!.width
  const children = new Map<string, string[]>()
  const depth = new Map<string, number>()
  for (const node of graph.nodes) {
    depth.set(node.id, node.parent === null ? 0 : depth.get(node.parent)! + 1)
    if (node.parent === null) continue
    const kids = children.get(node.parent)
    if (kids === undefined) children.set(node.parent, [node.id])
    else kids.push(node.id)
  }
  const { depth: depthGap, across } = GAP
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
    placement.set(id, { x: level, y: middle - height / 2, width, height })
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

/**
 * What ELK's Tree gets added to each node's width: `mrtree` spaces the columns as it spaces two nodes of a
 * column, and the prototype keeps its columns much further apart than its nodes. layoutElk takes it off again.
 */
const REACH = GAP.depth - GAP.across

/** The ELK graph of the Tree: the nodes with their sizes and the `from` edges only — never `replaces`. */
export function elkGraph(graph: MapGraph): ElkNode {
  return {
    id: 'mind-map',
    layoutOptions: { 'elk.algorithm': 'mrtree', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': String(GAP.across), 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
    children: graph.nodes.map((node) => {
      const size = nodeSize(node, 'tree')
      return { id: node.id, ...size, width: size.width + REACH }
    }),
    edges: graph.edges.filter((edge) => edge.kind === 'from').map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
}

/** The Tree's layout by ELK (the Graph's is `layoutRadial`, never ELK's). */
export async function layoutElk(graph: MapGraph, elk: ElkEngine): Promise<Placement> {
  const answer = await elk.layout(elkGraph(graph))
  const placement = new Map<string, Placed>()
  for (const child of answer.children ?? []) {
    placement.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: (child.width ?? 0) - REACH, height: child.height ?? 0 })
  }
  return placement
}

/**
 * The prototype's numbers for its graph (card-2dffdc46, `layoutGraph`): the seed's distance per depth across
 * and down, px (an ellipse, as the map is wider than tall); the length a "grew from" arrow is pulled to; the
 * room kept between two boxes; the rounds of pulling and pushing.
 */
const RADIAL = { across: 170, down: 105, spring: 120, margin: 12, rounds: 700 } as const
/**
 * Node-rounds a layout may take: it runs on the window's main thread, so its time is bounded whatever the
 * map's size. A map of up to 57 nodes gets the prototype's 700 rounds, a larger one fewer (150 nodes 266, 300
 * nodes 133, never under RADIAL_ROUNDS_MIN); the last pass keeps the boxes apart whatever the rounds left.
 * Measured on the owner's Mac (Node, nine runs each, under a load average of about 45, so the median is
 * mostly waiting for a core): 150 nodes 16 ms at best and 22 ms median, 300 nodes 19 and 47 ms, 1000 nodes
 * 25 and 45 ms, 3000 nodes 40 and 65 ms. MindMap.tsx runs it once per layout key, not per topic.
 */
const RADIAL_BUDGET = 40_000
const RADIAL_ROUNDS_MIN = 10
/** The room the last pass keeps between two boxes, px. */
const RADIAL_APART = 6

/**
 * The Graph as the prototype lays it out (ticket 26): the root in the middle; the leaves spread round it in
 * the order of the tree, each parent at the mean direction of its children, each depth one ring further out;
 * then rounds of springs on the "grew from" arrows and pushes between boxes that touch, the root never
 * moving. The prototype's pushes test every pair; here a grid of cells as large as the largest box finds the
 * pairs near enough to touch, so a large map stays quick. A last pass makes sure no two boxes overlap: in
 * the tree's order each node keeps its place or moves straight away from the root until it is clear of
 * those placed before it. No randomness: the same graph always gets the same places.
 */
export function layoutRadial(graph: MapGraph): Placement {
  const nodes = graph.nodes
  const count = nodes.length
  const placement = new Map<string, Placed>()
  if (count === 0) return placement
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const width = new Float64Array(count)
  const height = new Float64Array(count)
  const parent = new Int32Array(count).fill(-1)
  const depth = new Int32Array(count)
  const children: number[][] = nodes.map(() => [])
  nodes.forEach((node, index) => {
    const size = nodeSize(node, 'graph')
    width[index] = size.width
    height[index] = size.height
    const up = node.parent === null ? undefined : indexOf.get(node.parent)
    if (up === undefined || up >= index) return
    parent[index] = up
    depth[index] = depth[up]! + 1
    children[up]!.push(index)
  })

  // The seed. The leaves in the tree's order (depth first, a stack: a chain however deep fits), spread round
  // the circle from just past the left; a parent comes before its children in `nodes`, so going backwards
  // gives each parent the mean direction of its children.
  const angle = new Float64Array(count)
  const leaves: number[] = []
  const stack = [0]
  while (stack.length > 0) {
    const at = stack.pop()!
    const kids = children[at]!
    if (kids.length === 0) leaves.push(at)
    for (let kid = kids.length - 1; kid >= 0; kid -= 1) stack.push(kids[kid]!)
  }
  leaves.forEach((leaf, order) => (angle[leaf] = -Math.PI * 0.95 + (2 * Math.PI * (order + 0.5)) / leaves.length))
  for (let index = count - 1; index >= 0; index -= 1) {
    const kids = children[index]!
    if (kids.length === 0) continue
    let [sumX, sumY] = [0, 0]
    for (const kid of kids) {
      sumX += Math.cos(angle[kid]!)
      sumY += Math.sin(angle[kid]!)
    }
    angle[index] = Math.atan2(sumY, sumX)
  }
  // Each depth one ring further out, as in the prototype; where the nodes up to a depth need more room than
  // the ellipse inside its ring has, the ring goes out until they have it (a large map only: the prototype's
  // maps never fill one), so the rounds do not start with hundreds of boxes in one place, which makes them slow.
  const onRing: number[] = []
  let room = 0
  for (let index = 0; index < count; index += 1) {
    onRing[depth[index]!] = (onRing[depth[index]!] ?? 0) + 1
    room += (width[index]! + RADIAL.margin) * (height[index]! + RADIAL.margin)
  }
  const ring: number[] = [0]
  let inside = 1
  for (let at = 1; at < onRing.length; at += 1) {
    inside += onRing[at] ?? 0
    ring[at] = Math.max(ring[at - 1]! + 1, Math.sqrt((inside * room) / count / (Math.PI * RADIAL.across * RADIAL.down)))
  }
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let index = 1; index < count; index += 1) {
    x[index] = Math.cos(angle[index]!) * ring[depth[index]!]! * RADIAL.across
    y[index] = Math.sin(angle[index]!) * ring[depth[index]!]! * RADIAL.down
  }

  // The rounds. `cell` is at least the largest box and the margin: two boxes that touch lie in neighbouring cells.
  const cell = Math.max(width.reduce((most, each) => Math.max(most, each), 0), height.reduce((most, each) => Math.max(most, each), 0)) + RADIAL.margin
  const cellKey = (column: number, row: number): number => (column + 2 ** 20) * 2 ** 21 + (row + 2 ** 20)
  const rounds = Math.min(RADIAL.rounds, Math.max(RADIAL_ROUNDS_MIN, Math.floor(RADIAL_BUDGET / count)))
  for (let round = 0; round < rounds; round += 1) {
    const cool = 1 - round / rounds
    for (let index = 1; index < count; index += 1) {
      const up = parent[index]!
      if (up < 0) continue
      const dx = x[index]! - x[up]!
      const dy = y[index]! - y[up]!
      const distance = Math.sqrt(dx * dx + dy * dy) || 1
      const pull = (distance - RADIAL.spring) * 0.04 * cool
      const pullX = (dx / distance) * pull
      const pullY = (dy / distance) * pull
      if (up !== 0) {
        x[up] = x[up]! + pullX
        y[up] = y[up]! + pullY
      }
      x[index] = x[index]! - pullX
      y[index] = y[index]! - pullY
    }
    const columns = new Int32Array(count)
    const rows = new Int32Array(count)
    const grid = new Map<number, number[]>()
    for (let index = 0; index < count; index += 1) {
      columns[index] = Math.floor(x[index]! / cell)
      rows[index] = Math.floor(y[index]! / cell)
      const key = cellKey(columns[index]!, rows[index]!)
      const list = grid.get(key)
      if (list === undefined) grid.set(key, [index])
      else list.push(index)
    }
    const repel = round < rounds * 0.7
    for (let a = 0; a < count; a += 1) {
      for (let column = columns[a]! - 1; column <= columns[a]! + 1; column += 1) {
        for (let row = rows[a]! - 1; row <= rows[a]! + 1; row += 1) {
          const near = grid.get(cellKey(column, row))
          if (near === undefined) continue
          for (const b of near) {
            if (b <= a) continue
            const dx = x[b]! - x[a]!
            const dy = y[b]! - y[a]!
            const overX = (width[a]! + width[b]!) / 2 + RADIAL.margin - Math.abs(dx)
            const overY = (height[a]! + height[b]!) / 2 + RADIAL.margin - Math.abs(dy)
            // The root (index 0, always `a`) never moves: the other box takes the whole push.
            const share = a === 0 ? 0 : 0.5
            if (overX > 0 && overY > 0) {
              if (overX < overY * 1.6) {
                const push = (dx < 0 ? -1 : 1) * overX
                x[a] = x[a]! - push * share
                x[b] = x[b]! + push * (1 - share)
              } else {
                const push = (dy < 0 ? -1 : 1) * overY
                y[a] = y[a]! - push * share
                y[b] = y[b]! + push * (1 - share)
              }
            } else if (repel) {
              // A weak push between near boxes keeps the branches apart.
              const distance = Math.sqrt(dx * dx + dy * dy) || 1
              const push = (900 / (distance * distance)) * cool
              if (a !== 0) {
                x[a] = x[a]! - (dx / distance) * push
                y[a] = y[a]! - (dy / distance) * push
              }
              x[b] = x[b]! + (dx / distance) * push
              y[b] = y[b]! + (dy / distance) * push
            }
          }
        }
      }
    }
  }

  // The last pass: no two boxes overlap.
  const placed = new Map<number, number[]>()
  const blocker = (index: number): number | undefined => {
    const [column, row] = [Math.floor(x[index]! / cell), Math.floor(y[index]! / cell)]
    for (let atColumn = column - 1; atColumn <= column + 1; atColumn += 1) {
      for (let atRow = row - 1; atRow <= row + 1; atRow += 1) {
        for (const other of placed.get(cellKey(atColumn, atRow)) ?? []) {
          const apartX = (width[index]! + width[other]!) / 2 + RADIAL_APART - Math.abs(x[index]! - x[other]!)
          const apartY = (height[index]! + height[other]!) / 2 + RADIAL_APART - Math.abs(y[index]! - y[other]!)
          if (apartX > 0 && apartY > 0) return other
        }
      }
    }
    return undefined
  }
  for (let index = 0; index < count; index += 1) {
    const length = Math.hypot(x[index]!, y[index]!)
    const [awayX, awayY] = length === 0 ? [1, 0] : [x[index]! / length, y[index]! / length]
    // Along a straight line a box is left once and never met again: each step clears one more box.
    for (let other = blocker(index); other !== undefined; other = blocker(index)) {
      const clearX = (width[index]! + width[other]!) / 2 + RADIAL_APART
      const clearY = (height[index]! + height[other]!) / 2 + RADIAL_APART
      const stepX = awayX === 0 ? Infinity : (x[other]! + Math.sign(awayX) * clearX - x[index]!) / awayX
      const stepY = awayY === 0 ? Infinity : (y[other]! + Math.sign(awayY) * clearY - y[index]!) / awayY
      const step = Math.min(stepX, stepY) + 0.5
      x[index] = x[index]! + awayX * step
      y[index] = y[index]! + awayY * step
    }
    const key = cellKey(Math.floor(x[index]! / cell), Math.floor(y[index]! / cell))
    const list = placed.get(key)
    if (list === undefined) placed.set(key, [index])
    else list.push(index)
  }

  nodes.forEach((node, index) => placement.set(node.id, { x: x[index]! - width[index]! / 2, y: y[index]! - height[index]! / 2, width: width[index]!, height: height[index]! }))
  return placement
}

/** A point on the border of `box` (grown by `grow` px on each side), on the line from its middle towards `towards`. */
function borderPoint(box: ScreenBox, grow: number, towards: { x: number; y: number }): { x: number; y: number } {
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const [dx, dy] = [towards.x - middle.x, towards.y - middle.y]
  if (dx === 0 && dy === 0) return middle
  const reach = Math.min(dx === 0 ? Infinity : (box.width / 2 + grow) / Math.abs(dx), dy === 0 ? Infinity : (box.height / 2 + grow) / Math.abs(dy), 1)
  return { x: middle.x + dx * reach, y: middle.y + dy * reach }
}

const point = ({ x, y }: { x: number; y: number }): string => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`

/**
 * An arrow of the Graph, from box `from` to box `to`, as the prototype draws it (`edgePath`): "grew from" a
 * straight line from the parent's border to 4 px before the child's border, its arrowhead pointing at the
 * child; `replaces` a red dashed curve bowed to one side, so it does not run along the straight arrows.
 */
export function graphEdgePath(kind: MapEdge['kind'], from: ScreenBox, to: ScreenBox): string {
  const [start, end] = [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 }]
  if (kind === 'replaces') {
    const [dx, dy] = [end.x - start.x, end.y - start.y]
    const bend = { x: (start.x + end.x) / 2 - dy * 0.35 - 60, y: (start.y + end.y) / 2 + dx * 0.35 }
    return `M${point(borderPoint(from, 2, bend))} Q${point(bend)} ${point(borderPoint(to, 5, bend))}`
  }
  return `M${point(borderPoint(from, 0, end))} L${point(borderPoint(to, 4, start))}`
}

/** A box on the screen, px from the map's top left corner. */
export interface ScreenBox {
  x: number
  y: number
  width: number
  height: number
}

/** The room between a node and its card, and between the card and the map's edge, px (the prototype's). */
const CARD_GAP = 14
const CARD_EDGE = 8

/**
 * Where a node's card goes, as the prototype puts it (ticket 23): beside the node, to its right, its top a
 * little above the node's middle; to its left where the right has no room; under the node (or above it)
 * where neither side has; always inside the map of `pane` size, so it covers the node only when the map is
 * too small for both.
 */
export function cardPlace(node: ScreenBox, pane: { width: number; height: number }, card: { width: number; height: number }): { left: number; top: number } {
  const clamp = (value: number, room: number, size: number): number => Math.max(CARD_EDGE, Math.min(value, room - size - CARD_EDGE))
  const right = node.x + node.width + CARD_GAP
  const left = node.x - CARD_GAP - card.width
  if (right + card.width <= pane.width - CARD_EDGE || left >= CARD_EDGE) {
    const x = right + card.width <= pane.width - CARD_EDGE ? right : left
    return { left: clamp(x, pane.width, card.width), top: clamp(node.y + node.height / 2 - 30, pane.height, card.height) }
  }
  const below = node.y + node.height + CARD_GAP
  const above = node.y - CARD_GAP - card.height
  const y = below + card.height <= pane.height - CARD_EDGE || above < CARD_EDGE ? below : above
  return { left: clamp(node.x + node.width / 2 - card.width / 2, pane.width, card.width), top: clamp(y, pane.height, card.height) }
}

/**
 * What ELK's layout depends on: the view and each node's parent, kind, text and fold mark (its size, the
 * text measured glyph by glyph); not the file's places.
 */
export function layoutKey(graph: MapGraph, view: MindMapView): string {
  return JSON.stringify([view, graph.nodes.map((node) => [node.id, node.parent, node.text, node.kind, node.branch === true])])
}
