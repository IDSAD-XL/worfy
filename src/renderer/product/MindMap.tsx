import {
  Background,
  BackgroundVariant,
  BaseEdge,
  getNodesBounds,
  getViewportForBounds,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { createContext, Fragment, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ProductLayoutInput, ProductTopicState } from '../../shared/ipc/product'
import { MIND_MAP_PLACED } from '../../shared/product/mind-map'
import { elkEngine } from '../canvas/elk/client'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { SegmentedControl } from '../theme/primitives'
import {
  buildMindMapGraph,
  cardPlace,
  graphEdgePath,
  layoutElk,
  layoutKey,
  layoutRadial,
  layoutSync,
  linesIn,
  MIND_MAP_FONT,
  NODE_PAD,
  nodeShape,
  nodeSize,
  setTextMeasure,
  SHAPE_OF,
  withFilePlaces,
  type MapEdge,
  type MapGraph,
  type MapNode,
  type MapNodeKind,
  type MindMapView,
  type Placed,
  type Placement,
  type ScreenBox,
  type TextMeasure,
} from './mind-map-layout'
import { hideMessage, quoteLabel, showMessage, useMindMapFocus } from './node-chips'
import './mind-map.css'

// The Mind map of a Product Session topic (Epic worfy-product-session, ticket 08), on React Flow as the
// Canvas is: the topic as the root, the Tickets of its map, the nodes of mind-map.json under them, arrows
// "grew from" and a dashed arrow for `replaces` (mind-map-layout.ts builds and lays them out). Above it
// the switch "Tree · Graph", «Hide rejected», «Move nodes», «Prettify», the zoom «−», percent, «+» and «Fit»;
// the wheel zooms and a drag of the background pans. A click on a node opens its card.
//
// By hand the owner only moves nodes and folds branches (ticket 09). Nodes move only while «Move nodes» is
// on (ticket 31): it is off each time the map opens, and a drag on a node then pans the map as a drag of
// the background does. «Prettify» drops the places moved by hand in the view shown and lays the map out
// again: the Tree's in the file, through `product.layout` with `clearPlaces`, after a short question (the
// map has no undo); the Graph's on the screen only. A node of mind-map.json dragged and
// let go in the Tree (in the Graph a drag moves the node until the next layout and writes nothing, ticket 26),
// and the fold mark of a node with children (or ArrowLeft and ArrowRight on the node), ask main
// to write its `x` and `y` or its `collapsed` through `product.layout`, the same writer as the advisor's
// tools; the screen writes no file and keeps the dragged place only until main's change comes back. What a
// node says is the advisor's: its card has no field to type in. A read-only screen (a Linked machine)
// moves and folds nothing. A chip under a chat message (NodeChips.tsx) selects a node here and brings it
// into view, or lights it; «Show in the chat» asks the Product Session's chat to scroll to the message.
//
// The view is kept per topic in this window's localStorage (in worfy's data folder, ADR-0005), as the
// Session view keeps «Hide tools» (../session/transcript-view.ts); «Hide rejected» lasts while the map is open.

export interface MindMapProps {
  projectId: string
  topic: ProductTopicState
  /** Scrolls the chat to a message (a transcript event uuid); without it a node's message shows as its id. */
  onShowMessage?: ((message: string) => void) | undefined
}

/**
 * The page's measure of a node's text for nodeSize (ticket 23): a canvas `measureText` in the node's font,
 * the page's UI font (tokens.css `--font-ui` on `body`). Null where the page has no canvas (jsdom).
 */
function canvasMeasure(): TextMeasure | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  if (context === null) return null
  const widths = new Map<string, number>()
  let family: string | null = null
  return (text, size, bold) => {
    family ??= getComputedStyle(document.body).fontFamily || 'sans-serif'
    const font = `${bold ? '600 ' : ''}${size}px ${family}`
    const key = `${font}\n${text}`
    let width = widths.get(key)
    if (width === undefined) {
      context.font = font
      width = context.measureText(text).width
      // shortcut: the cache only grows, as large as the node texts and their pieces this window measured; redo when one window opens topics of thousands of nodes.
      widths.set(key, width)
    }
    return width
  }
}

setTextMeasure(canvasMeasure())

const VIEW_PREFIX = 'worfy.mindMap.view:'
const viewKey = (projectId: string, name: string): string => `${VIEW_PREFIX}${projectId}:${name}`

function readView(key: string): MindMapView {
  try {
    return globalThis.localStorage?.getItem(key) === 'graph' ? 'graph' : 'tree'
  } catch {
    return 'tree'
  }
}

function writeView(key: string, view: MindMapView): void {
  try {
    if (view === 'tree') globalThis.localStorage.removeItem(key)
    else globalThis.localStorage.setItem(key, view)
  } catch (error) {
    console.error('[mind-map] could not keep the view', error)
  }
}

const VIEWS = [
  { value: 'tree', label: 'Tree' },
  { value: 'graph', label: 'Graph' },
] as const

const ZOOM_MIN = 0.1
const ZOOM_MAX = 2.5
const FIT = { padding: 0.12, maxZoom: 1.25 }

/** The viewport that fits the nodes' own boxes into a pane of this size. */
const fitting = (nodes: MindFlowNode[], width: number, height: number): Viewport =>
  getViewportForBounds(getNodesBounds(nodes), width, height, ZOOM_MIN, FIT.maxZoom, FIT.padding)

const KIND_LABEL: Readonly<Record<MapNode['kind'], string>> = {
  topic: 'Topic',
  ticket: 'Ticket',
  idea: 'Idea',
  question: 'Question',
  decision: 'Decision',
  objection: 'Objection',
}

function iconOf(node: MapNode): string {
  switch (node.kind) {
    case 'topic':
      return '◆'
    case 'ticket':
      return String(node.ticket?.number ?? '').padStart(2, '0')
    case 'idea':
      return '✦'
    case 'question':
      return '?'
    case 'objection':
      return '!'
    case 'decision':
      return node.status === 'rejected' ? '✕' : '✓'
  }
}

function kindLine(node: MapNode): string {
  if (node.kind === 'ticket' && node.ticket !== undefined) return `Ticket ${String(node.ticket.number).padStart(2, '0')}`
  if (node.kind === 'decision' && node.status !== undefined) return `Decision · ${node.status}`
  return KIND_LABEL[node.kind]
}

/** The fold of a node with children: whether its branch is folded, and how many nodes that hides. */
interface Fold {
  folded: boolean
  hidden: number
}

interface MindNodeData extends Record<string, unknown> {
  node: MapNode
  view: MindMapView
  /** A node of mind-map.json with children; null for any other. */
  fold: Fold | null
  /** A chip under a chat message, or the message under the pointer, points at it. */
  lit: boolean
}

type MindFlowNode = Node<MindNodeData, 'mind'>

interface NodeActions {
  /** Opens a node's card; the nodes call it on Enter and Space (a click goes through React Flow's onNodeClick). */
  open: (id: string) => void
  /** Folds or unfolds the branch under a node. */
  fold: (id: string, collapsed: boolean) => void
  /** Why nothing is written on this screen; null where the owner may move and fold. */
  readOnly: string | null
}

const Actions = createContext<NodeActions>({ open: () => undefined, fold: () => undefined, readOnly: null })

function FoldMark({ id, fold }: { id: string; fold: Fold }) {
  const actions = useContext(Actions)
  const label = fold.folded ? `Unfold the branch: ${fold.hidden} node${fold.hidden === 1 ? '' : 's'}` : 'Fold the branch'
  const { onClick, ...rest } = writeAction<MouseEvent<HTMLButtonElement>>(actions.readOnly, () => actions.fold(id, !fold.folded), label)
  return (
    <button
      type="button"
      // Not a second stop for Tab: the node is the one stop, and ArrowLeft or ArrowRight on it fold. `nodrag`:
      // pressing the mark does not start a drag of the node.
      tabIndex={-1}
      className="w-mind__fold nodrag nopan"
      aria-expanded={!fold.folded}
      aria-label={label}
      data-testid="mind-node-fold"
      {...rest}
      // The click is the mark's, not the node's: it opens no card.
      onClick={(event) => {
        event.stopPropagation()
        onClick(event)
      }}
    >
      {fold.folded ? `+${fold.hidden}` : '−'}
    </button>
  )
}

/**
 * The outline of a node as the prototype draws it: a shape by kind, filled with the kind's tint and
 * stroked in its colour (mind-map.css), behind the icon and the text. A folded branch shows a second
 * outline behind, as a stack.
 */
function NodeOutline({ kind, width, height, folded }: { kind: MapNodeKind; width: number; height: number; folded: boolean }) {
  const d = nodeShape(kind, width, height)
  return (
    <svg className="w-mind__shape" width={width} height={height} aria-hidden="true" data-shape={SHAPE_OF[kind]}>
      {folded ? <path className="w-mind__outline w-mind__outline--stack" d={d} transform="translate(4 4)" /> : null}
      <path className="w-mind__outline" d={d} />
    </svg>
  )
}

function MindNodeView({ data, selected, width, height }: NodeProps<MindFlowNode>) {
  const { node, view, fold, lit } = data
  const actions = useContext(Actions)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      actions.open(node.id)
      return
    }
    // As a tree view does: ArrowLeft folds the branch, ArrowRight unfolds it.
    if (fold === null || actions.readOnly !== null) return
    if ((event.key === 'ArrowLeft' && !fold.folded) || (event.key === 'ArrowRight' && fold.folded)) {
      event.preventDefault()
      actions.fold(node.id, !fold.folded)
    }
  }
  const big = node.kind === 'topic' || node.kind === 'ticket'
  const rejected = node.kind === 'decision' && node.status === 'rejected'
  const size = width !== undefined && height !== undefined ? { width, height } : nodeSize(node, view)
  const pad = NODE_PAD[node.kind]
  // The Tree grows left to right (ticket 21): "grew from" enters on the left and leaves on the right. The
  // Graph's arrows (GraphEdge) run between the borders and use these handles only to exist.
  const [target, source] = [Position.Left, Position.Right]
  const cross = [Position.Top, Position.Bottom]
  return (
    <div
      className={`w-mind__node w-mind__node--${node.kind}${rejected ? ' w-mind__node--rejected' : ''}${selected === true ? ' w-mind__node--selected' : ''}${lit ? ' w-mind__node--lit' : ''}`}
      data-testid="mind-node"
      data-id={node.id}
      data-kind={node.kind}
      data-status={node.status}
      data-lit={lit ? 'true' : undefined}
      data-folded={fold?.folded === true ? 'true' : undefined}
      style={{ fontSize: `${MIND_MAP_FONT[view] + (big ? 2 : 0)}px`, paddingLeft: `${pad.left}em`, paddingRight: `${pad.right}em` }}
      title={node.text}
      // The node itself is the stop for Tab (React Flow's wrapper is not focusable here, see flowNodes):
      // Enter or Space opens its card, and its name says the kind and the status.
      role="button"
      tabIndex={0}
      aria-label={`${kindLine(node)}: ${node.text}`}
      onKeyDown={onKeyDown}
    >
      <NodeOutline kind={node.kind} width={size.width} height={size.height} folded={fold?.folded === true} />
      <Handle type="target" position={target} isConnectable={false} className="w-mind__handle" />
      {/* The topic has no icon, as in the prototype: it is the one node of its kind. */}
      {node.kind === 'topic' ? null : (
        <span className="w-mind__icon" aria-hidden="true">
          {iconOf(node)}
        </span>
      )}
      {/* Clamped to the lines its box holds: a text the browser wraps wider than measured ends in an ellipsis inside the box. */}
      <span className="w-mind__text" style={{ WebkitLineClamp: linesIn(node, view, size.height) }}>
        {rejected ? <s>{node.text}</s> : node.text}
      </span>
      {fold !== null ? <FoldMark id={node.id} fold={fold} /> : null}
      <Handle type="source" position={source} isConnectable={false} className="w-mind__handle" />
      {cross.map((side) => (
        <Fragment key={side}>
          <Handle id={`replaces-out-${side}`} type="source" position={side} isConnectable={false} className="w-mind__handle" />
          <Handle id={`replaces-in-${side}`} type="target" position={side} isConnectable={false} className="w-mind__handle" />
        </Fragment>
      ))}
    </div>
  )
}

const nodeTypes: NodeTypes = { mind: MindNodeView }

/**
 * The handles of a node: "grew from" arrows leave the side towards the children and enter the side
 * towards the parent; `replaces` arrows run between the other two sides (`replaces-*`), so they do not
 * run along the tree's arrows. Given before React Flow measures the node, so the arrows are drawn on
 * the first frame.
 */
function handlesOf(width: number, height: number): NonNullable<Node['handles']> {
  const [top, bottom, left, right] = [
    { position: Position.Top, x: width / 2, y: 0 },
    { position: Position.Bottom, x: width / 2, y: height },
    { position: Position.Left, x: 0, y: height / 2 },
    { position: Position.Right, x: width, y: height / 2 },
  ]
  const [tree, cross] = [[left, right], [top, bottom]]
  return [
    { type: 'target', ...tree[0]! },
    { type: 'source', ...tree[1]! },
    ...cross.flatMap((side) => [
      { id: `replaces-out-${side.position}`, type: 'source' as const, ...side },
      { id: `replaces-in-${side.position}`, type: 'target' as const, ...side },
    ]),
  ]
}

/** The sides a `replaces` arrow joins: the ones of the two nodes that face each other across the tree. */
function replacesSides(from: Placed | undefined, to: Placed | undefined): { sourceHandle: string; targetHandle: string } {
  const [before, after] = [Position.Top, Position.Bottom]
  const forward = from !== undefined && to !== undefined && from.y <= to.y
  return forward ? { sourceHandle: `replaces-out-${after}`, targetHandle: `replaces-in-${before}` } : { sourceHandle: `replaces-out-${before}`, targetHandle: `replaces-in-${after}` }
}

interface Drawn {
  selected: string | null
  /** The ids of the nodes lit, joined by newlines (a string keeps the memo of the nodes). */
  lit: string
  folds: ReadonlyMap<string, Fold>
  /** Nodes of mind-map.json may be dragged. */
  movable: boolean
}

function flowNodes(graph: MapGraph, placement: Placement, view: MindMapView, { selected, lit, folds, movable }: Drawn): MindFlowNode[] {
  const litIds = new Set(lit === '' ? [] : lit.split('\n'))
  return graph.nodes.flatMap((node) => {
    const place = placement.get(node.id)
    if (place === undefined) return []
    return [
      {
        id: node.id,
        type: 'mind' as const,
        position: { x: place.x, y: place.y },
        width: place.width,
        height: place.height,
        handles: handlesOf(place.width, place.height),
        data: { node, view, fold: folds.get(node.id) ?? null, lit: litIds.has(node.id) },
        selected: node.id === selected,
        // The topic and the Tickets have no place in mind-map.json to write.
        draggable: movable && node.source !== undefined,
        connectable: false,
        focusable: false,
      },
    ]
  })
}

/**
 * The graph with the branches under a folded node left out (`collapsed` of mind-map.json), and the fold of
 * each node of the file that has children. Parents come first in `graph.nodes`, so one pass decides.
 */
function foldBranches(graph: MapGraph): { graph: MapGraph; folds: ReadonlyMap<string, Fold> } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const parents = new Set(graph.nodes.flatMap((node) => (node.parent === null ? [] : [node.parent])))
  // The folded node each hidden node is under, the highest one drawn.
  const foldOf = new Map<string, string>()
  const hidden = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.parent === null) continue
    const above = foldOf.get(node.parent) ?? (byId.get(node.parent)?.source?.collapsed === true ? node.parent : undefined)
    if (above === undefined) continue
    foldOf.set(node.id, above)
    hidden.set(above, (hidden.get(above) ?? 0) + 1)
  }
  const folds = new Map<string, Fold>()
  for (const node of graph.nodes) {
    if (node.source === undefined || !parents.has(node.id) || foldOf.has(node.id)) continue
    folds.set(node.id, { folded: node.source.collapsed === true, hidden: hidden.get(node.id) ?? 0 })
  }
  if (foldOf.size === 0) return { graph, folds }
  return {
    graph: { nodes: graph.nodes.filter((node) => !foldOf.has(node.id)), edges: graph.edges.filter((edge) => !foldOf.has(edge.source) && !foldOf.has(edge.target)) },
    folds,
  }
}

/**
 * Where node `id` of the topic is on screen: `folded` — the folded nodes above it, nearest first;
 * `shownAs` — the node itself when drawn, else the highest folded node above it when that one is drawn
 * (the branch it is in), else null. `all` is every node of the topic, `drawn` what the screen draws.
 * Null when the topic has no such node (gone, or named by one of its errors).
 */
function whereIs(all: MapGraph, drawn: MapGraph, id: string): { folded: string[]; shownAs: string | null } | null {
  const byId = new Map(all.nodes.map((node) => [node.id, node]))
  const node = byId.get(id)
  if (node === undefined) return null
  const folded: string[] = []
  for (let at = node.parent; at !== null; at = byId.get(at)?.parent ?? null) {
    if (byId.get(at)?.source?.collapsed === true) folded.push(at)
  }
  const isDrawn = (each: string | undefined): each is string => each !== undefined && drawn.nodes.some((candidate) => candidate.id === each)
  const top = folded.at(-1)
  return { folded, shownAs: isDrawn(id) ? id : isDrawn(top) ? top : null }
}

const NO_MOVES: ReadonlyMap<string, { x: number; y: number }> = new Map()

/** The places with the nodes being dragged, or let go and not yet written back, where the owner put them. */
function withDragged(placement: Placement, dragged: ReadonlyMap<string, { x: number; y: number }>): Placement {
  if (dragged.size === 0) return placement
  const placed = new Map(placement)
  for (const [id, at] of dragged) {
    const place = placed.get(id)
    if (place !== undefined) placed.set(id, { ...place, ...at })
  }
  return placed
}

/** The dragged places the file does not show yet: a node written back, or gone, leaves the list. */
function pendingDrags(dragged: ReadonlyMap<string, { x: number; y: number }>, topic: ProductTopicState): ReadonlyMap<string, { x: number; y: number }> {
  if (dragged.size === 0) return dragged
  const next = new Map<string, { x: number; y: number }>()
  for (const [id, at] of dragged) {
    const node = topic.nodes.find((each) => each.id === id)
    if (node !== undefined && (node.x !== at.x || node.y !== at.y)) next.set(id, at)
  }
  return next.size === dragged.size ? dragged : next
}

/** The arrowheads of the two kinds of arrow, drawn by Arrowheads; their colours are mind-map.css's. */
const arrowheadId = (flowId: string, kind: 'from' | 'replaces'): string => `w-mind-arrow-${kind}-${flowId}`

/** An arrow of the Graph (GraphEdge): its kind, which says its shape. */
type GraphFlowEdge = Edge<{ kind: MapEdge['kind'] }, 'graph'>

/**
 * An arrow of the Graph, drawn between the two nodes' borders where they are now (a node being dragged
 * too), not between handles: the radial layout puts a child on any side of its parent (ticket 26).
 */
function GraphEdge({ source, target, data, markerEnd }: EdgeProps<GraphFlowEdge>) {
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  if (from === undefined || to === undefined) return null
  const box = (node: NonNullable<typeof from>) => ({
    ...node.internals.positionAbsolute,
    width: node.measured.width ?? node.width ?? 0,
    height: node.measured.height ?? node.height ?? 0,
  })
  return <BaseEdge path={graphEdgePath(data?.kind ?? 'from', box(from), box(to))} markerEnd={markerEnd} />
}

const edgeTypes: EdgeTypes = { graph: GraphEdge }

function flowEdges(graph: MapGraph, placement: Placement, view: MindMapView, flowId: string): Edge[] {
  if (view === 'graph') {
    // Straight, as in the prototype's graph; `replaces` a red dashed curve to the Decision it overturned.
    return graph.edges.map(
      (edge): GraphFlowEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'graph',
        data: { kind: edge.kind },
        className: edge.kind === 'from' ? 'w-mind__edge' : 'w-mind__edge w-mind__edge--replaces',
        markerEnd: arrowheadId(flowId, edge.kind),
        focusable: false,
        ...(edge.kind === 'replaces' ? { zIndex: 1 } : {}),
      }),
    )
  }
  // Curves, as in the prototype's tree: "grew from" ends in a grey arrowhead at the child, `replaces` is red,
  // dashed and ends at the Decision it overturned.
  return graph.edges.map((edge) =>
    edge.kind === 'from'
      ? { id: edge.id, source: edge.source, target: edge.target, type: 'default', className: 'w-mind__edge', markerEnd: arrowheadId(flowId, 'from'), focusable: false }
      : {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...replacesSides(placement.get(edge.source), placement.get(edge.target)),
          type: 'default',
          // No text on the arrow: the legend names the red dashed one.
          className: 'w-mind__edge w-mind__edge--replaces',
          markerEnd: arrowheadId(flowId, 'replaces'),
          focusable: false,
          zIndex: 1,
        },
  )
}

/**
 * The prototype's background: the Canvas's colour and dots, 22 apart at 100 %. The grid follows the zoom,
 * the dots keep their size (React Flow would scale them, and a map zoomed out to fit lost them). An id of
 * its own: React Flow names the dots' pattern by its store, and the Canvas's pattern of the same name,
 * in a hidden view, would be the one drawn.
 */
function MapBackground({ flowId }: { flowId: string }) {
  const zoom = useStore((state) => state.transform[2])
  return <Background id={`w-mind-${flowId}`} variant={BackgroundVariant.Dots} gap={22} size={2 / zoom} color="var(--canvas-dot)" bgColor="var(--canvas)" />
}

/** The arrowheads the arrows end in (flowEdges names them); in an SVG of no size beside the flow. */
function Arrowheads({ flowId }: { flowId: string }) {
  return (
    <svg className="w-mind__defs" aria-hidden="true">
      <defs>
        {(['from', 'replaces'] as const).map((kind) => (
          <marker key={kind} id={arrowheadId(flowId, kind)} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className={`w-mind__arrowhead w-mind__arrowhead--${kind}`} d="M0,0.5 L7.5,4 L0,7.5 z" />
          </marker>
        ))}
      </defs>
    </svg>
  )
}

/**
 * ELK's places where it has them, and for a node it does not place (added since the inputs it laid out)
 * a place next to its parent: the parent's place plus the offset the synchronous layout gives the node
 * from its parent. Parents come first in `graph.nodes`, so a new branch follows its new parent.
 */
function mergedPlaces(graph: MapGraph, elk: Placement, sync: Placement): Placement {
  const placed = new Map<string, Placed>()
  for (const node of graph.nodes) {
    const own = elk.get(node.id)
    if (own !== undefined) {
      placed.set(node.id, own)
      continue
    }
    const mine = sync.get(node.id)!
    const parent = node.parent === null ? undefined : placed.get(node.parent)
    const parentSync = node.parent === null ? undefined : sync.get(node.parent)
    placed.set(node.id, parent === undefined || parentSync === undefined ? mine : { ...mine, x: parent.x + mine.x - parentSync.x, y: parent.y + mine.y - parentSync.y })
  }
  return placed
}

/**
 * Where the nodes go. The Graph: the radial layout, synchronous (ticket 26). The Tree: ELK's layout from the
 * window's worker (../canvas/elk/client.ts), the worker the Epic frames share, so one request of the map is
 * out at a time: when it answers, the newest inputs are sent, those between are skipped. The last answer of this view stays meanwhile, and a node it does not
 * place is drawn next to its parent (`mergedPlaces`). The synchronous layout draws before ELK's first
 * answer, without a worker, and after ELK failed. `byElk` — ELK's places are shown.
 */
function usePlacement(graph: MapGraph, view: MindMapView): { key: string; placement: Placement; byElk: boolean } {
  // Once per graph and view, not per drawing: the key strings every node's text.
  const key = useMemo(() => layoutKey(graph, view), [graph, view])
  // `placement` null: ELK failed on those inputs.
  const [answer, setAnswer] = useState<{ key: string; view: MindMapView; placement: Placement | null } | null>(null)
  // The newest inputs, the key of the last request sent, whether one is out, whether the map is still mounted.
  const latest = useRef<{ key: string; graph: MapGraph; view: MindMapView } | null>(null)
  const sent = useRef<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    latest.current = { key, graph, view }
    const elk = elkEngine()
    if (elk === null || view === 'graph') return
    const send = (): void => {
      const next = latest.current
      // Only the Tree goes to ELK: a switch to the Graph while a request is out sends nothing after it.
      if (!mounted.current || busy.current || next === null || next.view === 'graph' || sent.current === next.key) return
      busy.current = true
      sent.current = next.key
      layoutElk(next.graph, elk)
        .then(
          (placement) => (mounted.current ? setAnswer({ key: next.key, view: next.view, placement }) : undefined),
          (error: unknown) => {
            console.error('[mind-map] ELK could not lay out the Mind map', error)
            if (mounted.current) setAnswer({ key: next.key, view: next.view, placement: null })
          },
        )
        .finally(() => {
          busy.current = false
          send()
        })
    }
    send()
  }, [key, graph, view])
  // The Graph's places, once per layout key (ticket 26, review round 2): it runs on this thread, so a new
  // topic that changes no node's parent, text, kind or fold mark — a place written back, a status — lays
  // out nothing again, and the places keep their identity.
  const radial = useMemo(
    () => (view === 'graph' ? layoutRadial(graph) : null),
    // `key` stands for `graph` and `view`: the same nodes in a new graph get the same places.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  const elkPlaces = answer?.view === view ? answer.placement : null
  const placement = useMemo(() => {
    if (radial !== null) return radial
    const sync = layoutSync(graph, 'tree')
    return elkPlaces === null ? sync : mergedPlaces(graph, elkPlaces, sync)
  }, [radial, elkPlaces, graph])
  return { key, placement, byElk: elkPlaces !== null }
}

/** «−», «+» and «Fit»; `onMoved` hears whether the owner set the zoom by hand (true) or fitted the map (false). */
function ZoomControls({ onMoved, onFit }: { onMoved: (byHand: boolean) => void; onFit: () => void }) {
  const flow = useReactFlow()
  const zoom = useStore((store) => store.transform[2])
  return (
    <div className="w-mind__camera" role="group" aria-label="Zoom">
      <button
        type="button"
        className="w-mind__button"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => {
          onMoved(true)
          void flow.zoomOut({ duration: 0 })
        }}
      >
        −
      </button>
      <span className="w-mind__percent w-mono" data-testid="mind-map-zoom">
        {`${Math.round(zoom * 100)}%`}
      </span>
      <button
        type="button"
        className="w-mind__button"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => {
          onMoved(true)
          void flow.zoomIn({ duration: 0 })
        }}
      >
        +
      </button>
      <button
        type="button"
        className="w-mind__button"
        title="Fit every node into view"
        onClick={() => {
          onMoved(false)
          onFit()
        }}
      >
        Fit
      </button>
    </div>
  )
}

/** A legend row's sample: the node's shape in its kind's colours, or a piece of arrow. */
type LegendSample = { node: MapNodeKind; status?: 'rejected' } | { arrow: 'from' | 'replaces' }

const LEGEND: readonly { key: string; sample: LegendSample; label: string }[] = [
  { key: 'idea', sample: { node: 'idea' }, label: 'Idea — what could be done' },
  { key: 'question', sample: { node: 'question' }, label: 'Question — not decided' },
  { key: 'decision', sample: { node: 'decision' }, label: 'Decision accepted' },
  { key: 'rejected', sample: { node: 'decision', status: 'rejected' }, label: 'Decision rejected' },
  { key: 'objection', sample: { node: 'objection' }, label: 'Objection' },
  { key: 'from', sample: { arrow: 'from' }, label: 'Grew from' },
  { key: 'replaces', sample: { arrow: 'replaces' }, label: 'Replaces' },
]

function LegendSampleView({ sample }: { sample: LegendSample }) {
  return (
    <svg className="w-mind__legend-sample" viewBox="-2 -1 30 16" aria-hidden="true">
      {'arrow' in sample ? (
        <>
          <path className={`w-mind__legend-line w-mind__legend-line--${sample.arrow}`} d="M0,7 H22" />
          <path className={`w-mind__arrowhead w-mind__arrowhead--${sample.arrow}`} d="M21,3.5 L27,7 L21,10.5 z" />
        </>
      ) : (
        <>
          <path className="w-mind__outline" d={nodeShape(sample.node, 26, 14)} />
          {sample.status === 'rejected' ? <path className="w-mind__legend-strike" d="M5,7 H21" /> : null}
        </>
      )}
    </svg>
  )
}

function Legend() {
  const [open, setOpen] = useState(true)
  return (
    <div className="w-mind__legend" data-testid="mind-map-legend">
      <button type="button" className="w-mind__legend-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        Legend
        {open ? <span className="w-mind__legend-hint"> · click a node for details</span> : null}
      </button>
      {open ? (
        <ul className="w-mind__legend-list">
          {LEGEND.map(({ key, sample, label }) => (
            <li key={key} className={`w-mind__legend-item w-mind__legend-item--${key}`} data-legend={key}>
              <LegendSampleView sample={sample} />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * A node's message on its card: quoted as the prototype does — «#5 Advisor: “…”», the number a link to the
 * message — when the Project's chat has it loaded (ticket 24); else the link «Show in the chat».
 */
function MessageLink({ projectId, message, onShowMessage, label = 'Show the message in the chat' }: { projectId: string; message: string; onShowMessage: MindMapProps['onShowMessage']; label?: string }) {
  const quote = useMindMapFocus((state) => state.quotes[projectId]?.get(message))
  if (onShowMessage === undefined) return <span className="w-mono w-mind__muted">{message}</span>
  const link = (
    <button type="button" className="w-mind__link" aria-label={label} title={message} onClick={() => onShowMessage(message)}>
      {quote === undefined ? 'Show in the chat' : quoteLabel(quote)}
    </button>
  )
  if (quote === undefined) return link
  return (
    <>
      {link}: <span className="w-mind__quote">{`“${quote.text}”`}</span>
    </>
  )
}

/** One step of a Decision's history: its earlier states (`history`), then the state it is in now. */
interface DecisionStep {
  status: string
  reason: string
  message: string | undefined
  /** This step rejected a Decision that was not rejected before it: drawn red, as the prototype does. */
  overturn: boolean
}

/** Every step of a Decision with a history, oldest first; none for a node without one. */
function decisionSteps(source: MapNode['source']): DecisionStep[] {
  if (source?.history === undefined || source.history.length === 0 || source.status === undefined) return []
  const states = [...source.history, { status: source.status, reason: source.reason ?? '', message: source.message }]
  return states.map((state, index) => ({ status: state.status, reason: state.reason, message: state.message, overturn: index > 0 && state.status === 'rejected' && states[index - 1]!.status !== 'rejected' }))
}

/** The card's width where it cannot be measured (a test without layout); mind-map.css sets the same. */
const CARD_WIDTH = 300

function NodeCard({
  node,
  graph,
  place,
  pane,
  onPick,
  onClose,
  onShowMessage,
  projectId,
}: {
  projectId: string
  node: MapNode
  graph: MapGraph
  /** The node's place on the map; the card stands beside it on the screen. */
  place: Placed | undefined
  pane: { width: number; height: number }
  onPick: (id: string) => void
  onClose: () => void
  onShowMessage: MindMapProps['onShowMessage']
}) {
  const parent = node.parent === null ? undefined : graph.nodes.find((candidate) => candidate.id === node.parent)
  const source = node.source
  const rejected = node.status === 'rejected'
  const steps = decisionSteps(source)
  // The message the node appeared in: the first step's when it has a history; each later step's message changed it.
  const [first, ...changes] = steps
  const appeared = first === undefined ? source?.message : first.message
  // History names each step by its message's number in the chat, «step 5:», as the prototype does (ticket 25),
  // when the loaded chat has every step's message; else the list keeps its plain order «1.», «2.».
  const quotes = useMindMapFocus((state) => state.quotes[projectId])
  const stepNumbers = steps.map((step) => (step.message === undefined ? undefined : quotes?.get(step.message)?.number))
  const byMessage = stepNumbers.every((number) => number !== undefined)
  // The card's own size, read after it is drawn, places it: its height follows the node it shows.
  const own = useRef<HTMLElement>(null)
  const [size, setSize] = useState({ width: CARD_WIDTH, height: 0 })
  useLayoutEffect(() => {
    const element = own.current
    if (element === null) return
    const next = { width: element.offsetWidth || CARD_WIDTH, height: element.offsetHeight }
    if (next.width !== size.width || next.height !== size.height) setSize(next)
  }, [node, pane.width, pane.height, size.width, size.height])
  // The camera is read here, where only an open card follows it: the map itself is not drawn again for a move.
  const camera = useStore((state) => state.transform)
  const beside: ScreenBox | undefined =
    place === undefined ? undefined : { x: place.x * camera[2] + camera[0], y: place.y * camera[2] + camera[1], width: place.width * camera[2], height: place.height * camera[2] }
  const at = beside === undefined || pane.width <= 0 ? undefined : cardPlace(beside, pane, size)
  return (
    <section
      ref={own}
      className="w-mind__card"
      aria-label="Node"
      data-testid="mind-map-card"
      data-kind={node.kind}
      style={at === undefined ? undefined : { left: `${Math.round(at.left)}px`, top: `${Math.round(at.top)}px`, right: 'auto' }}
    >
      <header className="w-mind__card-head">
        {/* The kind as a bordered pill in the kind's colours, struck through for a rejected Decision (the prototype's). */}
        <span className={`w-mind__kind-pill w-mind__kind-pill--${rejected ? 'rejected' : node.kind}`} data-testid="mind-map-card-kind">
          {node.kind === 'topic' || node.kind === 'ticket' ? null : <span aria-hidden="true">{iconOf(node)}</span>}
          <span>{kindLine(node)}</span>
        </span>
        <button type="button" className="w-mind__card-close" aria-label="Close the card" title="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="w-mind__card-text">{node.status === 'rejected' ? <s>{node.text}</s> : node.text}</p>
      <dl className="w-mind__card-fields">
        {node.ticket !== undefined ? (
          <>
            <dt>Status</dt>
            <dd>{node.ticket.status}</dd>
            <dt>File</dt>
            <dd className="w-mono">{node.ticket.file}</dd>
          </>
        ) : null}
        {source?.reason !== undefined && source.reason !== '' ? (
          <>
            <dt>Reason</dt>
            <dd>{source.reason}</dd>
          </>
        ) : null}
        {source?.source !== undefined && source.source !== '' ? (
          <>
            <dt>Source</dt>
            <dd className="w-mono">{source.source}</dd>
          </>
        ) : null}
        {steps.length > 0 ? (
          <>
            <dt>History</dt>
            <dd>
              <ol className={byMessage ? 'w-mind__history w-mind__history--by-message' : 'w-mind__history'}>
                {steps.map((step, index) => (
                  <li key={index} className={step.overturn ? 'w-mind__history-step w-mind__history-step--overturn' : 'w-mind__history-step'} data-overturn={step.overturn ? 'true' : undefined}>
                    {`${byMessage ? `step ${stepNumbers[index]}: ` : ''}${step.status} — ${step.reason}`}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        ) : null}
        {parent !== undefined ? (
          <>
            <dt>Grew from</dt>
            <dd>
              <button type="button" className="w-mind__link" onClick={() => onPick(parent.id)}>
                {parent.text}
              </button>
            </dd>
          </>
        ) : null}
        {appeared !== undefined ? (
          <>
            <dt>Message</dt>
            <dd>
              <MessageLink projectId={projectId} message={appeared} onShowMessage={onShowMessage} />
            </dd>
          </>
        ) : null}
        {changes.map((step, index) =>
          step.message === undefined ? null : (
            <Fragment key={index}>
              <dt>Changed by</dt>
              <dd>
                <MessageLink projectId={projectId} message={step.message} onShowMessage={onShowMessage} label="Show the message that changed it in the chat" />
              </dd>
            </Fragment>
          ),
        )}
      </dl>
      {node.source !== undefined ? <p className="w-mind__card-hint">To change this node, ask the advisor in the chat.</p> : null}
    </section>
  )
}

function Errors({ errors }: { errors: ProductTopicState['errors'] }) {
  if (errors.length === 0) return null
  return (
    <div className="w-mind__errors" role="alert" data-testid="mind-map-errors">
      {errors.map((error, index) => (
        <p key={index} className="w-mind__error">
          <span className="w-mono">{error.file}</span>: {error.message}
        </p>
      ))}
    </div>
  )
}

/** «Move nodes»: an open hand. */
function HandIcon() {
  return (
    <svg className="w-mind__tool-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 8.5V3.5a1 1 0 0 1 2 0V7.5M7 7V2.5a1 1 0 0 1 2 0V7.5M9 7.5V3.5a1 1 0 0 1 2 0V8M11 8.5V5.5a1 1 0 0 1 2 0V10c0 2.5-2 4.5-4.5 4.5c-1.9 0-3.1-.9-4-2.4L2.3 9.3a1 1 0 0 1 1.6-1.2L5 9.5" />
    </svg>
  )
}

/** «Prettify»: two sparkles. */
function SparkleIcon() {
  return (
    <svg className="w-mind__tool-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 2l1.2 3.8 3.8 1.2-3.8 1.2-1.2 3.8-1.2-3.8L1.5 7l3.8-1.2z" />
      <path d="M12.5 9.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" />
    </svg>
  )
}

function MindMapFlow({ projectId, topic, onShowMessage }: MindMapProps) {
  const storeKey = viewKey(projectId, topic.name)
  const [chosen, setChosen] = useState<{ key: string; view: MindMapView }>(() => ({ key: storeKey, view: readView(storeKey) }))
  const view = chosen.key === storeKey ? chosen.view : readView(storeKey)
  const [hideRejected, setHideRejected] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const readOnly = useReadOnly()
  const whole = useMemo(() => buildMindMapGraph(topic, { hideRejected }), [topic, hideRejected])
  const { graph, folds } = useMemo(() => foldBranches(whole), [whole])
  const { key: layoutAt, placement, byElk } = usePlacement(graph, view)

  // The places the owner dragged nodes to, until the file shows them: checked again with each new topic.
  const [dragged, setDragged] = useState<ReadonlyMap<string, { x: number; y: number }>>(() => new Map())
  // «Prettify» in the Tree asked main to drop the file's places (ticket 31): until a new topic comes, the
  // screen draws the layout without them.
  const [cleared, setCleared] = useState(false)
  const [seenTopic, setSeenTopic] = useState(topic)
  if (seenTopic !== topic) {
    setSeenTopic(topic)
    setDragged(pendingDrags(dragged, topic))
    setCleared(false)
  }
  // «Move nodes» (ticket 31): off each time the map opens and whenever it shows another topic (back to the
  // first one too), so a drag on a node pans the map; never on a read-only screen. The question of
  // «Prettify» closes with another topic as well.
  const [moving, setMoving] = useState<{ key: string; on: boolean }>(() => ({ key: storeKey, on: false }))
  const [asking, setAsking] = useState(false)
  if (moving.key !== storeKey) {
    setMoving({ key: storeKey, on: false })
    setAsking(false)
  }
  const moveNodes = readOnly === null && moving.key === storeKey && moving.on
  // The places the owner dragged nodes to in the Graph (ticket 26, review round 2): for this layout only,
  // never written. A place in the file is the Tree's, which grows left to right from the topic; the Graph
  // lays out round the topic, so the Graph neither reads nor writes one. A new layout (another layout key)
  // or a switch of the view drops them.
  const [graphMoves, setGraphMoves] = useState<{ key: string; places: ReadonlyMap<string, { x: number; y: number }> }>(() => ({ key: '', places: new Map() }))
  const movedInGraph = graphMoves.key === layoutAt ? graphMoves.places : NO_MOVES
  const moveInGraph = (moves: readonly { id: string; at: { x: number; y: number } }[]): void =>
    setGraphMoves((was) => {
      const next = new Map(was.key === layoutAt ? was.places : NO_MOVES)
      for (const { id, at } of moves) next.set(id, at)
      return { key: layoutAt, places: next }
    })
  const [writeError, setWriteError] = useState<string | null>(null)

  // Every node of the topic, the rejected ones too: where a chip's node is when the screen hides it.
  const all = useMemo(() => (hideRejected ? buildMindMapGraph(topic, { hideRejected: false }) : whole), [hideRejected, topic, whole])
  const [pickNote, setPickNote] = useState<string | null>(null)

  // A chip under the pointer lights its node alone; else the message under the pointer lights the nodes of its chips (ticket 19).
  const lit = useMindMapFocus((state) => state.lit)
  const litMessage = useMindMapFocus((state) => state.litMessage)
  const litIds = [...new Set((lit !== null ? [lit] : litMessage).filter((ref) => ref.projectId === projectId && ref.topic === topic.name).flatMap((ref) => whereIs(all, graph, ref.id)?.shownAs ?? []))].join('\n')
  const chatOpen = useMindMapFocus((state) => (state.chats[projectId] ?? 0) > 0)
  const showInChat = onShowMessage ?? (chatOpen ? (message: string) => showMessage(projectId, message) : undefined)

  const shown = useMemo(
    () => (view === 'graph' ? withDragged(placement, movedInGraph) : withDragged(cleared ? placement : withFilePlaces(graph, placement), dragged)),
    [view, graph, placement, dragged, movedInGraph, cleared],
  )
  const nodes = useMemo(() => flowNodes(graph, shown, view, { selected: picked, lit: litIds, folds, movable: moveNodes }), [graph, shown, view, picked, litIds, folds, moveNodes])
  // The nodes with a place moved by hand in the view shown (ticket 31): in the Tree those the file places — of
  // every node of the topic, hidden ones too, as «Prettify» drops them all — and those dragged and not yet
  // back from main; in the Graph those moved since its last layout.
  const filePlaced = useMemo(() => topic.nodes.filter((node) => node.placed === MIND_MAP_PLACED && node.x !== undefined && node.y !== undefined).map((node) => node.id), [topic])
  const movedByHandCount = view === 'graph' ? movedInGraph.size : new Set([...(cleared ? [] : filePlaced), ...dragged.keys()]).size
  // An id of the arrowheads per map: two maps on one screen do not share them. useId's colons dropped.
  const flowId = useId().replace(/[^\w-]/g, '')
  const askId = `${flowId}-prettify-ask`
  const edges = useMemo(() => flowEdges(graph, shown, view, flowId), [graph, shown, view, flowId])
  const pickedNode = picked === null ? undefined : graph.nodes.find((node) => node.id === picked)
  // The card closed — its button, Escape, a click on the empty map, its node gone from the topic: the chat takes
  // the ring off its message, as the prototype's selectNode(null) does (ticket 25). A node picked in a folded
  // branch is not drawn until the branch unfolds; its card is waited for, not closed, so it counts as open.
  // A write only: the map reads nothing more.
  const cardOpen = picked !== null && all.nodes.some((node) => node.id === picked)
  const cardWasOpen = useRef(false)
  useEffect(() => {
    if (cardWasOpen.current && !cardOpen) hideMessage(projectId)
    cardWasOpen.current = cardOpen
  }, [cardOpen, projectId])
  const flow = useReactFlow()

  /** Asks main to write a node's place or fold; `undo` puts the screen back when it refuses. */
  const write = (change: Omit<ProductLayoutInput, 'projectId' | 'name'>, undo?: () => void): void => {
    if (readOnly !== null) return
    void invoke('product.layout', { projectId, name: topic.name, ...change }).then((result) => {
      if (result.ok) {
        setWriteError(null)
        return
      }
      console.error('[mind-map] product.layout failed:', result.error)
      setWriteError(result.error)
      undo?.()
    })
  }

  // The node being dragged now: React Flow's position changes count only for it and only until it is let
  // go, so a late one cannot bring back a place main refused.
  const dragging = useRef<string | null>(null)
  const onNodesChange = (changes: NodeChange<MindFlowNode>[]) => {
    const moves = changes.flatMap((change) =>
      change.type === 'position' && change.position !== undefined && change.dragging === true && change.id === dragging.current ? [{ id: change.id, at: change.position }] : [],
    )
    if (moves.length === 0) return
    if (view === 'graph') {
      moveInGraph(moves)
      return
    }
    setDragged((was) => {
      const next = new Map(was)
      for (const { id, at } of moves) next.set(id, { x: at.x, y: at.y })
      return next
    })
  }

  const onNodeDragStop = (_event: unknown, node: MindFlowNode) => {
    dragging.current = null
    // Whole pixels: the file stays readable, and the place written is the place the screen keeps.
    const at = { x: Math.round(node.position.x), y: Math.round(node.position.y) }
    if (view === 'graph') {
      moveInGraph([{ id: node.id, at }])
      return
    }
    setDragged((was) => new Map(was).set(node.id, at))
    write({ id: node.id, ...at }, () =>
      setDragged((was) => {
        const next = new Map(was)
        next.delete(node.id)
        return next
      }),
    )
  }

  // One value while the screen's write rights stay: a new one would draw every node again (they read it).
  const writeLatest = useRef(write)
  useEffect(() => {
    writeLatest.current = write
  })
  const actions = useMemo<NodeActions>(() => ({ open: setPicked, fold: (id, collapsed) => writeLatest.current({ id, collapsed }), readOnly }), [readOnly])

  // A chip's click (NodeChips.tsx): the node of this topic is selected and brought into view. A node the
  // screen hides is shown first: «Hide rejected» is turned off for it, and the folded branches above it
  // are unfolded through `product.layout`; the card opens once main's change draws it. A read-only screen
  // unfolds nothing: the folded node above it is selected instead, and the note says why.
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null)
  const reveal = (id: string, seq: number): void => {
    const at = whereIs(all, graph, id)
    if (at === null) {
      setPickNote('This node is no longer on the Mind map.')
      return
    }
    if (hideRejected && !whole.nodes.some((node) => node.id === id)) setHideRejected(false)
    const top = at.folded.at(-1)
    if (top !== undefined && readOnly !== null) {
      setPicked(top)
      setFocus({ id: top, seq })
      setPickNote('The node is in a folded branch under this one: this screen is read-only, so the branch stays folded.')
      return
    }
    setPickNote(null)
    for (const each of at.folded) write({ id: each, collapsed: false })
    setPicked(id)
    setFocus({ id, seq })
  }
  const revealLatest = useRef(reveal)
  useEffect(() => {
    revealLatest.current = reveal
  })
  useEffect(
    () =>
      useMindMapFocus.subscribe((state, before) => {
        const asked = state.picked
        if (asked === before.picked || asked === null || asked.projectId !== projectId || asked.topic !== topic.name) return
        revealLatest.current(asked.id, asked.seq)
      }),
    [projectId, topic.name],
  )
  const centered = useRef<number | null>(null)
  useEffect(() => {
    if (focus === null || centered.current === focus.seq) return
    const place = shown.get(focus.id)
    if (place === undefined) return
    centered.current = focus.seq
    void flow.setCenter(place.x + place.width / 2, place.y + place.height / 2, { zoom: flow.getZoom(), duration: 0 })
  }, [focus, shown, flow])

  // The owner zoomed or panned the map by hand (the wheel, a drag of the background, «+» or «−»): from then
  // on the map keeps the owner's view; «Fit» and a fit on another topic or view clear it.
  const movedByHand = useRef(false)

  // As in the prototype (ticket 23): when the map's area changes size — the window, the divider beside the
  // chat — the map is fitted again, so no column ends up cut off at the edge; not after the owner moved it.
  // React Flow's own size of the pane, the one fitView fits into.
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const paneWas = useRef<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (paneWidth <= 0 || paneHeight <= 0) return
    const was = paneWas.current
    paneWas.current = { width: paneWidth, height: paneHeight }
    if (was === null || (was.width === paneWidth && was.height === paneHeight) || movedByHand.current) return
    // At once, not through fitView: React Flow runs a fitView with its next change of the nodes, and a new size
    // of the pane alone changes none, so the fit waited for the next click on the map.
    const nodes = flow.getNodes()
    if (nodes.length === 0) return
    void flow.setViewport(getViewportForBounds(flow.getNodesBounds(nodes), paneWidth, paneHeight, ZOOM_MIN, FIT.maxZoom, FIT.padding), { duration: 0 })
  }, [paneWidth, paneHeight, flow])

  // The map is fitted when it opens on a topic or a view, and once more when ELK's layout replaces
  // the first one; a node added later leaves the camera where the reader put it («Fit» brings it in).
  // «Prettify» asks for a fit too (ticket 31), once the nodes it put back are drawn. None goes through
  // fitView: React Flow drops a node's measured size whenever the node object is rebuilt (a click on a node,
  // ELK's answer), and does not measure it again while its size stays the same, so fitView stays queued, and
  // the next node drawn, measured alone, pulls the camera to itself. The viewport comes from the nodes' own
  // boxes, as passed (React Flow's lookup may still hold a moved node's last place), as the fit on a new size above.
  const fitted = useRef<string | null>(null)
  const fitFor = `${topic.name}\n${view}\n${byElk}`
  const fitPending = useRef(false)
  const fitNodes = (): void => {
    if (paneWidth <= 0 || paneHeight <= 0 || nodes.length === 0) return
    void flow.setViewport(fitting(nodes, paneWidth, paneHeight), { duration: 0 })
  }
  useEffect(() => {
    if (fitted.current !== fitFor) {
      fitted.current = fitFor
      movedByHand.current = false
      fitPending.current = true
    }
    if (!fitPending.current || paneWidth <= 0 || paneHeight <= 0 || nodes.length === 0) return
    fitPending.current = false
    void flow.setViewport(fitting(nodes, paneWidth, paneHeight), { duration: 0 })
  }, [fitFor, nodes, paneWidth, paneHeight, flow])

  const pickedPlace = picked === null ? undefined : shown.get(picked)

  const choose = (next: MindMapView) => {
    setChosen({ key: storeKey, view: next })
    setGraphMoves({ key: '', places: NO_MOVES })
    setAsking(false)
    writeView(storeKey, next)
  }

  // «Prettify» (ticket 31): the Tree asks first, as the places in the file cannot be brought back; the Graph's
  // moves last until its next layout anyway, so it does not ask.
  const prettify = (): void => {
    closeAsk()
    if (view === 'graph') setGraphMoves({ key: '', places: NO_MOVES })
    else {
      // A refusal brings back the file's places and the drags still waiting for main, under any drag since.
      const waiting = dragged
      setDragged(new Map())
      setCleared(true)
      write({ clearPlaces: true }, () => {
        setCleared(false)
        setDragged((now) => new Map([...waiting, ...now]))
      })
    }
    // Fitted once the nodes are drawn at their new places (the effect below), as «Fit» fits them.
    movedByHand.current = false
    fitPending.current = true
  }
  // The focus around the question of «Prettify», as the done stack's Expand and Collapse keep it (worfy-week
  // ticket 15): the question takes it on its «Cancel»; when it closes, or «Prettify» in the Graph has dropped
  // the moves, it goes back to «Prettify», or to «Move nodes» when «Prettify» is now inactive.
  const prettifyButton = useRef<HTMLButtonElement>(null)
  const moveButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const focusNext = useRef<'cancel' | 'back' | null>(null)
  useEffect(() => {
    const next = focusNext.current
    if (next === null) return
    focusNext.current = null
    if (next === 'cancel') cancelButton.current?.focus()
    else {
      const back = prettifyButton.current
      ;(back !== null && !back.disabled ? back : moveButton.current)?.focus()
    }
  })
  const openAsk = (): void => {
    focusNext.current = 'cancel'
    setAsking(true)
  }
  const closeAsk = (): void => {
    focusNext.current = 'back'
    setAsking(false)
  }
  const prettifyTitle = readOnly ?? (movedByHandCount === 0 ? 'No node was moved by hand in this view' : 'Lay the map out again: drop the places nodes were moved to by hand in this view')

  const root = useRef<HTMLDivElement>(null)
  // Escape closes the card and puts the focus back on its node.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || picked === null) return
    event.stopPropagation()
    const id = picked
    setPicked(null)
    root.current?.querySelector<HTMLElement>(`[data-testid="mind-node"][data-id="${CSS.escape(id)}"]`)?.focus()
  }

  return (
    <div ref={root} className="w-mind" data-testid="mind-map" data-view={view} onKeyDown={onKeyDown}>
      <div className="w-mind__toolbar">
        <SegmentedControl label="View" options={VIEWS} value={view} onChange={choose} />
        <button type="button" className="w-mind__button w-mind__toggle" aria-pressed={hideRejected} title="Hide the rejected Decisions and their branches" onClick={() => setHideRejected((was) => !was)}>
          Hide rejected
        </button>
        <button
          type="button"
          className="w-mind__button w-mind__toggle w-mind__button--icon"
          ref={moveButton}
          aria-pressed={moveNodes}
          disabled={readOnly !== null}
          title={readOnly ?? (moveNodes ? 'Turn off so a drag on a node pans the map' : 'Turn on to drag nodes to new places. Off: a drag on a node pans the map')}
          onClick={() => setMoving({ key: storeKey, on: !moveNodes })}
          data-testid="mind-map-move-nodes"
        >
          <HandIcon />
          Move nodes
        </button>
        {asking && view === 'tree' && movedByHandCount > 0 && readOnly === null ? (
          <span
            className="w-mind__ask"
            role="group"
            aria-label="Prettify"
            aria-describedby={askId}
            data-testid="mind-map-prettify-ask"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              closeAsk()
            }}
          >
            <span id={askId} aria-live="polite">{`Drop ${movedByHandCount} moved place${movedByHandCount === 1 ? '' : 's'}?`}</span>
            <button type="button" className="w-mind__button" onClick={prettify}>
              Prettify
            </button>
            <button ref={cancelButton} type="button" className="w-mind__button" onClick={closeAsk}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            ref={prettifyButton}
            className="w-mind__button w-mind__button--icon"
            disabled={readOnly !== null || movedByHandCount === 0}
            title={prettifyTitle}
            onClick={() => (view === 'graph' ? prettify() : openAsk())}
            data-testid="mind-map-prettify"
          >
            <SparkleIcon />
            Prettify
          </button>
        )}
        <ZoomControls
          onMoved={(byHand) => {
            movedByHand.current = byHand
          }}
          onFit={fitNodes}
        />
      </div>
      <Errors errors={topic.errors} />
      {writeError !== null ? (
        <p className="w-mind__error w-mind__write-error" role="alert" data-testid="mind-map-write-error">
          {`Could not save the change: ${writeError}`}
        </p>
      ) : null}
      {pickNote !== null ? (
        <p className="w-mind__pick-note" role="status" data-testid="mind-map-pick-note">
          {pickNote}
        </p>
      ) : null}
      <div className="w-mind__flow">
        <Actions value={actions}>
          <ReactFlow<MindFlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => setPicked(node.id)}
            onPaneClick={() => {
              setPicked(null)
              setPickNote(null)
            }}
            // A move with an event is the owner's (the wheel, a drag of the background); fitView and setCenter have none.
            onMove={(event) => {
              if (event !== null) movedByHand.current = true
            }}
            onNodesChange={onNodesChange}
            onNodeDragStart={(_, node) => {
              dragging.current = node.id
            }}
            onNodeDragStop={onNodeDragStop}
            nodesDraggable={moveNodes}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={ZOOM_MIN}
            maxZoom={ZOOM_MAX}
            fitView
            fitViewOptions={FIT}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            colorMode="system"
            proOptions={{ hideAttribution: true }}
          >
            <MapBackground flowId={flowId} />
          </ReactFlow>
        </Actions>
        <Arrowheads flowId={flowId} />
        <Legend />
        {pickedNode !== undefined ? (
          <NodeCard
            node={pickedNode}
            graph={graph}
            place={pickedPlace}
            pane={{ width: paneWidth, height: paneHeight }}
            onPick={setPicked}
            onClose={() => setPicked(null)}
            onShowMessage={showInChat}
            projectId={projectId}
          />
        ) : null}
      </div>
    </div>
  )
}

/** The Mind map of one topic; the store of its camera is its own, apart from the Canvas's. */
export function MindMap(props: MindMapProps) {
  return (
    <ReactFlowProvider>
      <MindMapFlow {...props} />
    </ReactFlowProvider>
  )
}
