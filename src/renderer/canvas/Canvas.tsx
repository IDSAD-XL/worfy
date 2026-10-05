// The Canvas of the active Project: an endless plane with a dot grid, drawn by React Flow.
//
// The Layout comes from main (useLayout.ts) and changes only through operations sent to it.
// Dragging and resizing are optimistic: React Flow moves the Node locally at once, and the result
// is sent when the mouse is released. A Layout that arrives from main replaces the local Nodes,
// except the position and size of a Node still being dragged or resized.
//
// Navigation: the wheel pans, ⌘ + wheel (and a pinch) zooms around the pointer, ⌘= / ⌘− zoom
// in and out, dragging with Space held or with the middle button pans, dragging on an empty spot
// selects. A double click on an empty spot creates a `note` Node.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent } from 'react'
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
import { ZOOM_MAX, ZOOM_MIN, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import { edgeSources, edgesOf, overlays } from './extensions'
import { NodeChrome } from './NodeChrome'
import { nodeTypes as registeredNodeTypes, UNKNOWN_NODE_TYPE, type CanvasFlowNode, type CanvasNodeProps } from './nodes'
import { usePinnedPlacement } from './pinning'
import { UnknownNode } from './UnknownNode'
import { applyLayoutOp, LayoutOpsContext, useLayout, type LayoutOps } from './useLayout'

/** A Node type's component inside the chrome every Node gets: tags, the pinned frame (NodeChrome.tsx). */
const withNodeChrome = (Component: ComponentType<CanvasNodeProps>) =>
  function Chromed(props: CanvasNodeProps) {
    return <NodeChrome {...props} Component={Component} />
  }

const flowNodeTypes: NodeTypes = {
  ...Object.fromEntries([...registeredNodeTypes].map(([kind, type]) => [kind, withNodeChrome(type.Component)])),
  [UNKNOWN_NODE_TYPE]: withNodeChrome(UnknownNode),
}

/** The kind a double click creates. */
const NOTE_KIND = 'note'

/** React Flow Nodes for the Layout; keeps selection, and the local geometry of a Node in a gesture. */
function toFlowNodes(layoutNodes: readonly LayoutNode[], current: readonly CanvasFlowNode[]): CanvasFlowNode[] {
  const previous = new Map(current.map((node) => [node.id, node]))
  return layoutNodes.map((node) => {
    const before = previous.get(node.id)
    const busy = before !== undefined && (before.dragging === true || before.resizing === true)
    return {
      id: node.id,
      type: registeredNodeTypes.has(node.kind) ? node.kind : UNKNOWN_NODE_TYPE,
      position: busy ? before.position : { x: node.x, y: node.y },
      width: busy ? before.width : node.w,
      height: busy ? before.height : node.h,
      hidden: node.hidden,
      deletable: !node.locked,
      selected: before?.selected ?? false,
      dragging: before?.dragging ?? false,
      resizing: before?.resizing ?? false,
      data: { node },
    }
  })
}

interface FlowProps {
  projectId: string
  state: LayoutState
}

function Flow({ projectId, state }: FlowProps) {
  const flow = useReactFlow<CanvasFlowNode>()
  const wrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(() => toFlowNodes(state.layout.nodes, []))
  const [shownLayout, setShownLayout] = useState(state.layout)
  // The latest Layout for callbacks, which outlive the render they were made in.
  const latest = useRef(state.layout)
  useEffect(() => {
    latest.current = state.layout
  }, [state.layout])

  // A new Layout from main: rebuild the Nodes during render, not in an effect, so the screen never
  // shows the old Layout for a frame.
  if (shownLayout !== state.layout) {
    setShownLayout(state.layout)
    setNodes((current) => toFlowNodes(state.layout.nodes, current))
  }

  const edges = useMemo(() => edgesOf(edgeSources, state.layout.nodes), [state.layout.nodes])
  // Nodes pinned to the screen are placed anew for every viewport (pinning.ts).
  const shownNodes = usePinnedPlacement(nodes)

  const ops: LayoutOps = useMemo(
    () => ({
      apply(op: LayoutOpInput) {
        return applyLayoutOp(projectId, op).then((error) => {
          // Refused: put the Nodes back where main has them.
          if (error !== undefined) setNodes((current) => toFlowNodes(latest.current.nodes, current.map((node) => ({ ...node, dragging: false, resizing: false }))))
        })
      },
    }),
    [projectId],
  )

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    // Removing goes through main only (and the trash of ticket 30); keyboard delete is off anyway.
    setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== 'remove'), current))
  }, [])

  const onNodeDragStop: OnNodeDrag<CanvasFlowNode> = useCallback(
    (_event, _node, dragged) => {
      for (const node of dragged) ops.apply({ op: 'move', id: node.id, x: node.position.x, y: node.position.y })
    },
    [ops],
  )

  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => {
      const saved = latest.current.viewport
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

  return (
    <LayoutOpsContext.Provider value={ops}>
      <div ref={wrapper} className="w-canvas" data-testid="canvas" data-project-id={projectId} onDoubleClick={onDoubleClick}>
        <ReactFlow<CanvasFlowNode>
          nodes={shownNodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
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
