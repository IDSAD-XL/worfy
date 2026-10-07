// The Canvas of the active Project: an endless plane with a dot grid, drawn by React Flow.
//
// The Layout comes from main (useLayout.ts) and changes only through operations sent to it.
// Dragging and resizing are optimistic: React Flow moves the Node locally at once, and the result
// is sent when the mouse is released. A Layout that arrives from main replaces the local Nodes,
// except the position and size of a Node still being dragged or resized.
//
// Node sources (extensions.ts) add Nodes computed from elsewhere — the Epic frames and Tickets
// from the workflow model. They are drawn after the Layout's Nodes; dropping one after a drag goes
// to its source, which saves what it needs in the Layout, instead of a `move` operation.
//
// Navigation: the wheel pans, ⌘ + wheel (and a pinch) zooms around the pointer, ⌘= / ⌘− zoom
// in and out, dragging with Space held or with the middle button pans, dragging on an empty spot
// selects. A double click on an empty spot creates a `note` Node.
//
// Every operation sent from here is recorded for ⌘Z / ⇧⌘Z (history.ts); the keys themselves, and
// Delete to the trash, are handled by overlays/SelectionToolbar.tsx.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type NodeTypes,
  type OnMoveEnd,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'
import { ZOOM_MAX, ZOOM_MIN, type Layout, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import { edgeSources, edgesOf, edgeTypes, nodeSources, overlays, type NodeSource } from './extensions'
import { nodeTypes as registeredNodeTypes, UNKNOWN_NODE_TYPE, type CanvasFlowNode } from './nodes'
import { UnknownNode } from './UnknownNode'
import { applyRecorded, grouped, type Group, type LayoutChannel } from './history'
import { applyLayoutOp, currentLayout, LayoutOpsContext, useLayout, type LayoutOps } from './useLayout'
// Every Node type is drawn inside the chrome (tags, the pinned frame); pinned Nodes are placed
// anew for every viewport (ticket 29).
import { withNodeChrome } from './withNodeChrome'
import { usePinnedPlacement } from './pinning'

const flowNodeTypes: NodeTypes = {
  ...Object.fromEntries([...registeredNodeTypes].map(([kind, type]) => [kind, withNodeChrome(type.Component)])),
  [UNKNOWN_NODE_TYPE]: withNodeChrome(UnknownNode),
}

/** The kind a double click creates. */
const NOTE_KIND = 'note'

/** Kinds whose Layout Nodes are a source's saved state and are not drawn themselves. */
const ownedKinds = new Set(nodeSources.flatMap(({ source }) => source.owns))

/**
 * Keeps the Node React Flow already has when nothing about it changed, so an unchanged Node is not
 * drawn again; otherwise keeps its selection and, during a gesture, its local geometry.
 */
function mergeFlowNode(next: CanvasFlowNode, before: CanvasFlowNode | undefined): CanvasFlowNode {
  if (before === undefined) return next
  const busy = before.dragging === true || before.resizing === true
  if (
    !busy &&
    before.data.node === next.data.node &&
    before.type === next.type &&
    before.parentId === next.parentId &&
    before.hidden === next.hidden &&
    before.position.x === next.position.x &&
    before.position.y === next.position.y &&
    before.width === next.width &&
    before.height === next.height
  ) {
    return before
  }
  return {
    ...next,
    position: busy ? before.position : next.position,
    width: busy ? before.width : next.width,
    height: busy ? before.height : next.height,
    selected: before.selected ?? false,
    dragging: before.dragging ?? false,
    resizing: before.resizing ?? false,
  }
}

/** React Flow Nodes for the Layout and the node sources; keeps selection, and the local geometry of a Node in a gesture. */
function toFlowNodes(layoutNodes: readonly LayoutNode[], derived: readonly CanvasFlowNode[], current: readonly CanvasFlowNode[]): CanvasFlowNode[] {
  const previous = new Map(current.map((node) => [node.id, node]))
  const own: CanvasFlowNode[] = layoutNodes
    .filter((node) => !ownedKinds.has(node.kind))
    .map((node) => ({
      id: node.id,
      type: registeredNodeTypes.has(node.kind) ? node.kind : UNKNOWN_NODE_TYPE,
      position: { x: node.x, y: node.y },
      width: node.w,
      height: node.h,
      hidden: node.hidden,
      deletable: !node.locked,
      selected: false,
      dragging: false,
      resizing: false,
      data: { node },
    }))
  const fromSources = derived.map((node) => ({
    ...node,
    type: node.type !== undefined && registeredNodeTypes.has(node.type) ? node.type : UNKNOWN_NODE_TYPE,
  }))
  return [...own, ...fromSources].map((node) => mergeFlowNode(node, previous.get(node.id)))
}

/** The Nodes of every node source, and which source each Node came from. */
interface SourceNodes {
  nodes: readonly CanvasFlowNode[]
  sourceOf: ReadonlyMap<string, NodeSource>
}

const sameLists = (a: readonly (readonly CanvasFlowNode[])[], b: readonly (readonly CanvasFlowNode[])[]) =>
  a.length === b.length && a.every((list, index) => list === b[index])

function useSourceNodes(projectId: string, layout: Layout): SourceNodes {
  const context = { projectId, layout }
  // nodeSources is fixed when the module loads, so every render calls the same hooks in the same order.
  const lists = nodeSources.map(({ source }) => source.useNodes(context))
  // The same object while every source returns the same array, so the Canvas rebuilds its Nodes
  // only when a source has new ones.
  const [combined, setCombined] = useState<{ lists: readonly (readonly CanvasFlowNode[])[]; value: SourceNodes }>()
  if (combined !== undefined && sameLists(combined.lists, lists)) return combined.value
  const sourceOf = new Map<string, NodeSource>()
  lists.forEach((list, index) => {
    for (const node of list) sourceOf.set(node.id, nodeSources[index]!.source)
  })
  const value = { nodes: lists.length === 1 ? lists[0]! : lists.flat(), sourceOf }
  setCombined({ lists, value })
  return value
}

interface FlowProps {
  projectId: string
  state: LayoutState
}

function Flow({ projectId, state }: FlowProps) {
  const flow = useReactFlow<CanvasFlowNode>()
  const wrapper = useRef<HTMLDivElement>(null)
  const derived = useSourceNodes(projectId, state.layout)
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(() => toFlowNodes(state.layout.nodes, derived.nodes, []))
  const [shown, setShown] = useState({ layout: state.layout, derived: derived.nodes })
  // The latest Layout and source Nodes for callbacks, which outlive the render they were made in.
  const latest = useRef({ layout: state.layout, derived })
  useEffect(() => {
    latest.current = { layout: state.layout, derived }
  }, [state.layout, derived])

  // A new Layout from main or new Nodes from a source: rebuild the Nodes during render, not in an
  // effect, so the screen never shows the old Layout for a frame.
  if (shown.layout !== state.layout || shown.derived !== derived.nodes) {
    setShown({ layout: state.layout, derived: derived.nodes })
    setNodes((current) => toFlowNodes(state.layout.nodes, derived.nodes, current))
  }

  const edges = useMemo(
    () => edgesOf(edgeSources, [...state.layout.nodes.filter((node) => !ownedKinds.has(node.kind)), ...derived.nodes.map((node) => node.data.node)]),
    [state.layout.nodes, derived.nodes],
  )

  const ops: LayoutOps = useMemo(() => {
    const channel: LayoutChannel = {
      send: (op) =>
        applyLayoutOp(projectId, op).then((error) => {
          // Refused: put the Nodes back where main has them.
          if (error !== undefined) {
            const { layout, derived } = latest.current
            setNodes((current) => toFlowNodes(layout.nodes, derived.nodes, current.map((node) => ({ ...node, dragging: false, resizing: false }))))
          }
          return error
        }),
      // main's latest answer, which applyLayoutOp() stores before it resolves: the next operation of
      // a gesture, and an undo, see what the previous one did.
      layout: () => currentLayout(projectId) ?? latest.current.layout,
    }
    return {
      // Every operation sent here is a user's gesture and is recorded for ⌘Z (history.ts, ticket 30).
      async apply(op: LayoutOpInput, group?: Group) {
        await applyRecorded(projectId, op, channel, group)
      },
    }
  }, [projectId])

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    // Removing goes through main only: Delete sends the selection to the trash (overlays/SelectionToolbar.tsx).
    setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== 'remove'), current))
  }, [])

  const onNodeDragStop: OnNodeDrag<CanvasFlowNode> = useCallback(
    (_event, _node, dragged) => {
      const { layout, derived } = latest.current
      const back = new Set<string>()
      const layoutNodes: CanvasFlowNode[] = []
      for (const node of dragged) {
        const source = derived.sourceOf.get(node.id)
        if (!source) layoutNodes.push(node)
        else if (source.moved({ projectId, layout }, node) !== true) back.add(node.id)
      }
      // One drag is one step of the history, however many Nodes it moved.
      void grouped(async (group) => {
        await Promise.all(layoutNodes.map((node) => ops.apply({ op: 'move', id: node.id, x: node.position.x, y: node.position.y }, group)))
      })
      // A Node whose source keeps no place for it goes back to where the source has it (ADR-0037).
      if (back.size > 0) {
        const at = new Map(derived.nodes.filter((node) => back.has(node.id)).map((node) => [node.id, node.position]))
        setNodes((current) => current.map((node) => (at.has(node.id) ? { ...node, position: at.get(node.id)!, dragging: false } : node)))
      }
    },
    [ops, projectId],
  )

  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => {
      const saved = latest.current.layout.viewport
      if (saved.x === viewport.x && saved.y === viewport.y && saved.zoom === viewport.zoom) return
      ops.apply({ op: 'setViewport', viewport })
    },
    [ops],
  )

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      // Only the empty plane: a double click inside a Node belongs to the Node.
      if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return
      const type = registeredNodeTypes.get(NOTE_KIND)
      if (!type) return
      const { x, y } = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      ops.apply({ op: 'create', node: { kind: NOTE_KIND, x, y, w: type.defaultWidth, h: type.defaultHeight, data: { text: '' } } })
    },
    [flow, ops],
  )

  // ⌘= / ⌘− zoom, while the Canvas view is the one on screen (the Session view hides it).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return
      if (wrapper.current === null || wrapper.current.offsetParent === null) return
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        void flow.zoomIn()
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        void flow.zoomOut()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flow])

  // Nodes pinned to the screen are placed anew for every viewport (pinning.ts).
  const shownNodes = usePinnedPlacement(nodes)

  return (
    <LayoutOpsContext.Provider value={ops}>
      <div ref={wrapper} className="w-canvas" data-testid="canvas" data-project-id={projectId} onDoubleClick={onDoubleClick}>
        <ReactFlow<CanvasFlowNode>
          nodes={shownNodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={onMoveEnd}
          defaultViewport={state.layout.viewport}
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode="Meta"
          panOnDrag={[1]}
          panActivationKeyCode="Space"
          selectionOnDrag
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          onlyRenderVisibleElements
          colorMode="system"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--canvas-dot)" bgColor="var(--canvas)" />
          {overlays.map(({ id, Component }) => (
            <Component key={id} />
          ))}
        </ReactFlow>
      </div>
    </LayoutOpsContext.Provider>
  )
}

function ProjectCanvas({ projectId }: { projectId: string }) {
  const { state, error } = useLayout(projectId)
  if (error !== undefined) {
    return (
      <div className="w-canvas-message" role="alert">
        The canvas could not be loaded: {error}
      </div>
    )
  }
  if (state === undefined) return null
  return (
    <ReactFlowProvider>
      <Flow projectId={projectId} state={state} />
    </ReactFlowProvider>
  )
}

export interface CanvasProps {
  /** The active Project; none shows a hint instead of a Canvas. */
  projectId: string | undefined
}

export function Canvas({ projectId }: CanvasProps) {
  if (projectId === undefined) {
    return <div className="w-canvas-message">Add a project to see its canvas.</div>
  }
  // A fresh React Flow per Project: its viewport and selection belong to that Project.
  return <ProjectCanvas key={projectId} projectId={projectId} />
}
