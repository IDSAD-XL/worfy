import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ProductTopicState } from '../../shared/ipc/product'
import { elkEngine } from '../canvas/elk/client'
import { SegmentedControl } from '../theme/primitives'
import {
  buildMindMapGraph,
  layoutElk,
  layoutKey,
  layoutSync,
  MIND_MAP_FONT,
  withFilePlaces,
  type MapGraph,
  type MapNode,
  type MindMapView,
  type Placed,
  type Placement,
} from './mind-map-layout'
import './mind-map.css'

// The Mind map of a Product Session topic (Epic worfy-product-session, ticket 08), on React Flow as the
// Canvas is: the topic as the root, the Tickets of its map, the nodes of mind-map.json under them, arrows
// "grew from" and a dashed arrow for `replaces` (mind-map-layout.ts builds and lays them out). Above it
// the switch "Tree · Graph", «Hide rejected», the zoom «−», percent, «+» and «Fit»; the wheel zooms and a
// drag of the background pans. A click on a node opens its card. Nothing here writes: moving nodes and
// folding branches by hand is ticket 09.
//
// The view is kept per topic in this window's localStorage (in worfy's data folder, ADR-0005), as the
// Session view keeps «Hide tools» (../session/transcript-view.ts); «Hide rejected» lasts while the map is open.

export interface MindMapProps {
  projectId: string
  topic: ProductTopicState
  /** Scrolls the chat to a message (a transcript event uuid); without it a node's message shows as its id. */
  onShowMessage?: ((message: string) => void) | undefined
}

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

interface MindNodeData extends Record<string, unknown> {
  node: MapNode
  view: MindMapView
}

type MindFlowNode = Node<MindNodeData, 'mind'>

function MindNodeView({ data, selected }: NodeProps<MindFlowNode>) {
  const { node, view } = data
  const big = node.kind === 'topic' || node.kind === 'ticket'
  const rejected = node.kind === 'decision' && node.status === 'rejected'
  const [target, source] = view === 'tree' ? [Position.Top, Position.Bottom] : [Position.Left, Position.Right]
  const cross = view === 'tree' ? [Position.Left, Position.Right] : [Position.Top, Position.Bottom]
  return (
    <div
      className={`w-mind__node w-mind__node--${node.kind}${rejected ? ' w-mind__node--rejected' : ''}${selected === true ? ' w-mind__node--selected' : ''}`}
      data-testid="mind-node"
      data-id={node.id}
      data-kind={node.kind}
      data-status={node.status}
      style={{ fontSize: `${MIND_MAP_FONT[view] + (big ? 2 : 0)}px` }}
      title={node.text}
    >
      <Handle type="target" position={target} isConnectable={false} className="w-mind__handle" />
      <span className="w-mind__icon" aria-hidden="true">
        {iconOf(node)}
      </span>
      <span className="w-mind__text">{rejected ? <s>{node.text}</s> : node.text}</span>
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
function handlesOf(view: MindMapView, width: number, height: number): NonNullable<Node['handles']> {
  const [top, bottom, left, right] = [
    { position: Position.Top, x: width / 2, y: 0 },
    { position: Position.Bottom, x: width / 2, y: height },
    { position: Position.Left, x: 0, y: height / 2 },
    { position: Position.Right, x: width, y: height / 2 },
  ]
  const [tree, cross] = view === 'tree' ? [[top, bottom], [left, right]] : [[left, right], [top, bottom]]
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
function replacesSides(view: MindMapView, from: Placed | undefined, to: Placed | undefined): { sourceHandle: string; targetHandle: string } {
  const [before, after] = view === 'tree' ? [Position.Left, Position.Right] : [Position.Top, Position.Bottom]
  const forward = from !== undefined && to !== undefined && (view === 'tree' ? from.x <= to.x : from.y <= to.y)
  return forward ? { sourceHandle: `replaces-out-${after}`, targetHandle: `replaces-in-${before}` } : { sourceHandle: `replaces-out-${before}`, targetHandle: `replaces-in-${after}` }
}

function flowNodes(graph: MapGraph, placement: Placement, view: MindMapView, selected: string | null): MindFlowNode[] {
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
        handles: handlesOf(view, place.width, place.height),
        data: { node, view },
        selected: node.id === selected,
        draggable: false,
        connectable: false,
      },
    ]
  })
}

function flowEdges(graph: MapGraph, placement: Placement, view: MindMapView): Edge[] {
  // An arrow to a node that waits for its place waits with it.
  return graph.edges.filter((edge) => placement.has(edge.source) && placement.has(edge.target)).map((edge) =>
    edge.kind === 'from'
      ? { id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep', className: 'w-mind__edge', focusable: false }
      : {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...replacesSides(view, placement.get(edge.source), placement.get(edge.target)),
          // No text on the arrow: the legend names the dashed one.
          className: 'w-mind__edge w-mind__edge--replaces',
          markerEnd: { type: MarkerType.ArrowClosed },
          focusable: false,
          zIndex: 1,
        },
  )
}

/**
 * Where the nodes go: ELK's layout from the window's worker once it has answered for these inputs; while
 * a newer request is out, the last answer of this view (a node it does not place waits for the new one),
 * as the Epic frames keep theirs (../canvas/elk/client.ts); the synchronous layout before ELK's first
 * answer, without a worker, and after ELK failed. `byElk` — ELK's places are shown.
 */
function usePlacement(graph: MapGraph, view: MindMapView): { placement: Placement; byElk: boolean } {
  const key = layoutKey(graph, view)
  // `placement` null: ELK failed on these inputs.
  const [answer, setAnswer] = useState<{ key: string; view: MindMapView; placement: Placement | null } | null>(null)
  // The inputs of the last request, and those the map wants now: an answer for older inputs is dropped,
  // and a new topic object with the same inputs asks nothing.
  const requested = useRef<string | null>(null)
  const wanted = useRef(key)
  useEffect(() => {
    wanted.current = key
    if (requested.current === key) return
    const elk = elkEngine()
    if (elk === null) return
    requested.current = key
    layoutElk(graph, view, elk).then(
      (placement) => {
        if (wanted.current === key) setAnswer({ key, view, placement })
      },
      (error: unknown) => {
        console.error('[mind-map] ELK could not lay out the Mind map', error)
        if (wanted.current === key) setAnswer({ key, view, placement: null })
      },
    )
  }, [key, graph, view])
  // An answer of this view for other inputs means the request for these is out: the effect sends one
  // for every new key while the window has ELK.
  const elkPlaces = answer?.view === view ? answer.placement : null
  const placement = useMemo(() => elkPlaces ?? layoutSync(graph, view), [elkPlaces, graph, view])
  return { placement, byElk: elkPlaces !== null }
}

function ZoomControls() {
  const flow = useReactFlow()
  const zoom = useStore((store) => store.transform[2])
  return (
    <div className="w-mind__zoom" role="group" aria-label="Zoom">
      <button type="button" className="w-mind__button" aria-label="Zoom out" title="Zoom out" onClick={() => void flow.zoomOut({ duration: 0 })}>
        −
      </button>
      <span className="w-mind__percent w-mono" data-testid="mind-map-zoom">
        {`${Math.round(zoom * 100)}%`}
      </span>
      <button type="button" className="w-mind__button" aria-label="Zoom in" title="Zoom in" onClick={() => void flow.zoomIn({ duration: 0 })}>
        +
      </button>
      <button type="button" className="w-mind__button" title="Fit every node into view" onClick={() => void flow.fitView({ ...FIT, duration: 0 })}>
        Fit
      </button>
    </div>
  )
}

function Legend() {
  const [open, setOpen] = useState(true)
  const items: [string, string, string][] = [
    ['idea', '✦', 'Idea'],
    ['question', '?', 'Question'],
    ['decision', '✓', 'Decision accepted'],
    ['rejected', '✕', 'Decision rejected'],
    ['objection', '!', 'Objection'],
  ]
  return (
    <div className="w-mind__legend" data-testid="mind-map-legend">
      <button type="button" className="w-mind__legend-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        Legend
      </button>
      {open ? (
        <ul className="w-mind__legend-list">
          {items.map(([kind, icon, label]) => (
            <li key={kind} className={`w-mind__legend-item w-mind__legend-item--${kind}`}>
              <span className="w-mind__icon" aria-hidden="true">
                {icon}
              </span>
              {label}
            </li>
          ))}
          <li className="w-mind__legend-item w-mind__legend-item--replaces">
            <span className="w-mind__legend-dash" aria-hidden="true" />
            Replaces
          </li>
        </ul>
      ) : null}
    </div>
  )
}

function MessageLink({ message, onShowMessage }: { message: string; onShowMessage: MindMapProps['onShowMessage'] }) {
  if (onShowMessage === undefined) return <span className="w-mono w-mind__muted">{message}</span>
  return (
    <button type="button" className="w-mind__link" aria-label="Show the message in the chat" title={message} onClick={() => onShowMessage(message)}>
      Show in the chat
    </button>
  )
}

function NodeCard({ node, graph, onPick, onClose, onShowMessage }: { node: MapNode; graph: MapGraph; onPick: (id: string) => void; onClose: () => void; onShowMessage: MindMapProps['onShowMessage'] }) {
  const parent = node.parent === null ? undefined : graph.nodes.find((candidate) => candidate.id === node.parent)
  const source = node.source
  return (
    <section className="w-mind__card" aria-label="Node" data-testid="mind-map-card" data-kind={node.kind}>
      <header className="w-mind__card-head">
        <span className={`w-mind__icon w-mind__icon--${node.status === 'rejected' ? 'rejected' : node.kind}`} aria-hidden="true">
          {iconOf(node)}
        </span>
        <span className="w-mind__card-kind">{kindLine(node)}</span>
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
        {source?.history !== undefined && source.history.length > 0 ? (
          <>
            <dt>History</dt>
            <dd>
              <ol className="w-mind__history">
                {source.history.map((entry, index) => (
                  <li key={index}>
                    <span>{`${entry.status} — ${entry.reason}`}</span>
                    {entry.message !== undefined ? <MessageLink message={entry.message} onShowMessage={onShowMessage} /> : null}
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
        {source?.message !== undefined ? (
          <>
            <dt>Message</dt>
            <dd>
              <MessageLink message={source.message} onShowMessage={onShowMessage} />
            </dd>
          </>
        ) : null}
      </dl>
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

function MindMapFlow({ projectId, topic, onShowMessage }: MindMapProps) {
  const storeKey = viewKey(projectId, topic.name)
  const [chosen, setChosen] = useState<{ key: string; view: MindMapView }>(() => ({ key: storeKey, view: readView(storeKey) }))
  const view = chosen.key === storeKey ? chosen.view : readView(storeKey)
  const [hideRejected, setHideRejected] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const graph = useMemo(() => buildMindMapGraph(topic, { hideRejected }), [topic, hideRejected])
  const { placement, byElk } = usePlacement(graph, view)
  const shown = useMemo(() => withFilePlaces(graph, placement), [graph, placement])
  const nodes = useMemo(() => flowNodes(graph, shown, view, picked), [graph, shown, view, picked])
  const edges = useMemo(() => flowEdges(graph, shown, view), [graph, shown, view])
  const pickedNode = picked === null ? undefined : graph.nodes.find((node) => node.id === picked)
  const flow = useReactFlow()

  // The map is fitted when it opens on a topic or a view, and once more when ELK's layout replaces
  // the first one; a node added later leaves the camera where the reader put it («Fit» brings it in).
  const fitted = useRef<string | null>(null)
  const fitFor = `${topic.name}\n${view}\n${byElk}`
  useEffect(() => {
    if (fitted.current === fitFor) return
    fitted.current = fitFor
    void flow.fitView({ ...FIT, duration: 0 })
  }, [fitFor, flow])

  const choose = (next: MindMapView) => {
    setChosen({ key: storeKey, view: next })
    writeView(storeKey, next)
  }

  return (
    <div className="w-mind" data-testid="mind-map" data-view={view}>
      <div className="w-mind__toolbar">
        <SegmentedControl label="View" options={VIEWS} value={view} onChange={choose} />
        <button type="button" className="w-mind__button w-mind__toggle" aria-pressed={hideRejected} title="Hide the rejected Decisions and their branches" onClick={() => setHideRejected((was) => !was)}>
          Hide rejected
        </button>
        <ZoomControls />
      </div>
      <Errors errors={topic.errors} />
      <div className="w-mind__flow">
        <ReactFlow<MindFlowNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setPicked(node.id)}
          onPaneClick={() => setPicked(null)}
          nodesDraggable={false}
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
        />
        <Legend />
        {pickedNode !== undefined ? <NodeCard node={pickedNode} graph={graph} onPick={setPicked} onClose={() => setPicked(null)} onShowMessage={onShowMessage} /> : null}
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
