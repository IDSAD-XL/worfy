// The Canvas of the active Project: an endless plane with a dot grid, drawn by React Flow.
//
// The Layout comes from main (useLayout.ts) and changes only through operations sent to it.
// Dragging and resizing are optimistic: React Flow moves the Node locally at once, and the result
// is sent when the mouse is released. A Layout that arrives from main replaces the local Nodes,
// except the position and size of a Node still being dragged or resized.
//
// Node sources (extensions.ts) add Nodes computed from elsewhere — the Epic frames and Tickets
// from the workflow model. They are drawn after the Layout's Nodes; dropping one after a drag goes
// to its source, which saves what it needs in the Layout, instead of a `move` operation — through
// the same LayoutOps, into the drop's one ⌘Z step (extensions.ts dropNodes()).
//
// Navigation: the wheel pans, ⌘ + wheel (and a pinch) zooms around the pointer, ⌘= / ⌘− zoom
// in and out, dragging with Space held or with the middle button pans, dragging on an empty spot
// selects. A double click on an empty spot creates a `note` Node.
//
// The camera is this screen's own, not part of the Layout (worfy-link ticket 06): the Canvas opens
// at the camera main saved for this machine (`viewport.get`), and the end of every pan or zoom
// saves it (`viewport.set`). No other window hears of it, and the Layout does not change.
//
// Every operation sent from here is recorded for ⌘Z / ⇧⌘Z (history.ts); the keys themselves, and
// Delete to the trash, are handled by overlays/SelectionToolbar.tsx.
//
// Snapping (snapping.ts, worfy-week ticket 06): while a Layout Node or an Epic frame is dragged, it
// is shown at its snapped place — grid, alignment guides, equal gaps; none with ⌘ held — and the
// overlay draws the guides and, when the rule "Nodes never overlap" moves it off that place, the
// outline of where it lands. The drop sends the landing place, which main answers with unchanged
// (ADR-0038). A resize stops each edge short of a neighbour while the mouse is still down.
//
// The active Node (worfy-week ticket 16): a plain click on a Node makes it active while it stays
// selected; a click on the empty plane, a press anywhere outside it and Esc (except in a Terminal,
// whose shell needs Esc) end that. Only the active Node's content takes the wheel — before, the
// wheel over any Node moves the Canvas (wheel-router.ts) — and only the active Card's page takes
// the mouse (canvas.css).
//
// On the read-only screen of a Linked machine (worfy-link tickets 25 and 26, ADR-0066) no Node
// drags: `nodesDraggable` follows the level, and a Node that asks to be dragged on its own (a
// Subagent's) is held too (read-only-nodes.ts). Panning and zooming stay; overlays/ReadOnlyCanvas.tsx
// draws the notice.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type NodeChange,
  type NodeTypes,
  type OnMoveEnd,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'
import { EPIC_FRAME_KIND, SUBAGENT_KIND } from '../../shared/layout/derived'
import { isParticipant, obstaclesFor, type Rect } from '../../shared/layout/free-place'
import { isArchived, ZOOM_MAX, ZOOM_MIN, type Layout, type LayoutNode, type LayoutOpInput, type LayoutState, type Viewport } from '../../shared/layout/types'
import { SHORTCUTS } from '../../shared/shortcuts'
import { invoke, windowMachine } from '../ipc'
import { isMac } from '../platform'
import { useReadOnly } from '../projects/useProjects'
import { held, matches } from '../shortcuts/match'
import { dropNodes, edgeSources, edgesOf, edgeTypes, nodeSources, overlays, type NodeSource } from './extensions'
import { flowNodeLabel, nodeTypes as registeredNodeTypes, UNKNOWN_NODE_TYPE, type CanvasFlowNode } from './nodes'
import { UnknownNode } from './UnknownNode'
import { applyRecorded, type Group, type LayoutChannel, type RecordOptions } from './history'
import { lockedForReadOnly } from './read-only-nodes'
import { currentLayout, LayoutOpsContext, screenChannel, useLayout, type LayoutOps } from './useLayout'
// Every Node type is drawn inside the chrome (tags, the pinned frame); pinned Nodes are placed
// anew for every viewport (ticket 29).
import { withNodeChrome } from './withNodeChrome'
import { usePinnedPlacement } from './pinning'
import { clearSnapGuides, planDrag, resizeObstacles, showSnapGuides, stopEdges, type Dragged, type DragPlan } from './snapping'
import { routeWheels } from './wheel-router'

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
    before.ariaLabel === next.ariaLabel &&
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
  // An archived Node stays in the Layout but is not drawn (ADR-0076).
  const own: CanvasFlowNode[] = layoutNodes
    .filter((node) => !ownedKinds.has(node.kind) && !isArchived(node))
    .map((node) => ({
      id: node.id,
      type: registeredNodeTypes.has(node.kind) ? node.kind : UNKNOWN_NODE_TYPE,
      ariaLabel: flowNodeLabel(node.kind, registeredNodeTypes.has(node.kind)),
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
  const fromSources = derived.map((node) => {
    const known = node.type !== undefined && registeredNodeTypes.has(node.type)
    return { ...node, type: known ? node.type : UNKNOWN_NODE_TYPE, ariaLabel: flowNodeLabel(node.data.node.kind, known, node.ariaLabel) }
  })
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

/** What a drag snaps against; found once when the drag starts, since nothing else moves meanwhile. */
interface DragScene {
  /** The Layout Nodes and Epic frames that are not dragged: what the lead snaps to when they are on screen. */
  neighbours: Rect[]
  /** Every other Layout Node on the plane, as main has them: what main keeps a moved Layout Node clear of. */
  layoutObstacles: Rect[]
  /** Everything else on the plane, Subagent Nodes too: what an Epic frame keeps clear of. */
  planeObstacles: Rect[]
}

/** A resize going on: where the Node was before it, where the mouse has put it, and what it stops at. */
interface ResizeSession {
  before: Rect
  raw: Rect
  obstacles: Rect[]
}

const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The class of the active Node's element; canvas.css draws it and lets an active Card's page take the mouse. */
const ACTIVE_NODE_CLASS = 'w-node--active'

const withActiveClass = (node: CanvasFlowNode): CanvasFlowNode => ({
  ...node,
  className: node.className === undefined ? ACTIVE_NODE_CLASS : `${node.className} ${ACTIVE_NODE_CLASS}`,
})

interface FlowProps {
  projectId: string
  state: LayoutState
  /** The camera the Canvas opens at: this machine's saved one (`viewport.get`). */
  opening: Viewport
}

function Flow({ projectId, state, opening }: FlowProps) {
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  const wrapper = useRef<HTMLDivElement>(null)
  const dragScene = useRef<DragScene | null>(null)
  const resizes = useRef(new Map<string, ResizeSession>())
  // The active Node (worfy-week ticket 16): the one a plain click chose, as long as it stays
  // selected — any way React Flow takes the selection away ends it too. The ref serves the
  // listeners, which outlive the render they were made in.
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const activate = useCallback((id: string | null) => {
    activeRef.current = id
    setActiveNodeId(id)
  }, [])
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
    // Made at the first gesture, not during the render: its callbacks read `latest`.
    let channel: LayoutChannel | undefined
    const channelNow = () =>
      (channel ??= screenChannel(projectId, {
        // Refused: put the Nodes back where main has them.
        onRefused: () => {
          const { layout, derived } = latest.current
          setNodes((current) => toFlowNodes(layout.nodes, derived.nodes, current.map((node) => ({ ...node, dragging: false, resizing: false }))))
        },
        fallback: () => latest.current.layout,
      }))
    return {
      // Every operation sent here is a user's gesture and is recorded for ⌘Z (history.ts, ticket 30).
      async apply(op: LayoutOpInput, group?: Group, options?: RecordOptions) {
        await applyRecorded(projectId, op, channelNow(), group, options)
      },
    }
  }, [projectId])

  /**
   * A resize step of a Layout Node, with each edge that ran into a neighbour stopped NODE_GAP short
   * of it (decision 23): React Flow's resizer reports where the mouse put the Node, a position
   * change for the left and top edges and a size change; both are replaced by the stopped
   * rectangle. The resizer's own end goes through NodeResizeClamp.tsx, which stops it the same way.
   */
  const stopResizes = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]): NodeChange<CanvasFlowNode>[] => {
      const sizing = changes.filter((change) => change.type === 'dimensions' && change.resizing !== undefined && change.dimensions !== undefined)
      if (sizing.length === 0) return changes
      const stopped = new Map<string, Rect>()
      for (const change of sizing) {
        if (change.type !== 'dimensions' || change.dimensions === undefined) continue
        const node = flow.getNode(change.id)
        if (node === undefined || latest.current.derived.sourceOf.has(node.id) || !isParticipant(node.data.node)) continue
        let session = resizes.current.get(node.id)
        if (session === undefined) {
          const { x, y, w, h } = node.data.node
          const layout = currentLayout(projectId) ?? latest.current.layout
          session = { before: { x, y, w, h }, raw: { x: node.position.x, y: node.position.y, w, h }, obstacles: resizeObstacles(layout.nodes, node.id) }
          resizes.current.set(node.id, session)
        }
        const moved = changes.find((each) => each.type === 'position' && each.id === node.id && each.position !== undefined)
        if (moved?.type === 'position' && moved.position) session.raw = { ...session.raw, x: moved.position.x, y: moved.position.y }
        session.raw = { ...session.raw, w: change.dimensions.width, h: change.dimensions.height }
        stopped.set(node.id, stopEdges(session.before, session.raw, session.obstacles))
        if (change.resizing === false) resizes.current.delete(node.id)
      }
      if (stopped.size === 0) return changes
      const out: NodeChange<CanvasFlowNode>[] = []
      for (const change of changes) {
        const rect = change.type === 'add' ? undefined : stopped.get(change.id)
        if (rect === undefined) out.push(change)
        else if (change.type === 'dimensions' && change.resizing !== undefined) {
          out.push({ id: change.id, type: 'position', position: { x: rect.x, y: rect.y } })
          out.push({ ...change, dimensions: { width: rect.w, height: rect.h } })
        } else if (change.type !== 'position') out.push(change)
      }
      return out
    },
    [flow, projectId],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      // Removing goes through main only: Delete sends the selection to the trash (overlays/SelectionToolbar.tsx).
      const kept = stopResizes(changes.filter((change) => change.type !== 'remove'))
      setNodes((current) => applyNodeChanges(kept, current))
      // The active Node unselected ends its activity for good: selected again some other way (a
      // rectangle, the keyboard), it is not active.
      const active = activeRef.current
      if (active !== null && changes.some((change) => change.type === 'select' && change.id === active && !change.selected)) activate(null)
    },
    [stopResizes, activate],
  )

  /**
   * Where the dragged Nodes are shown and where they land (snapping.ts). Undefined when the Node
   * under the mouse does not snap: only a Layout Node on the plane and an Epic frame do (decision 18).
   */
  const planFor = useCallback(
    (lead: CanvasFlowNode, dragged: readonly CanvasFlowNode[], free: boolean): DragPlan | undefined => {
      const { derived } = latest.current
      const snaps = (node: CanvasFlowNode): boolean => (derived.sourceOf.has(node.id) ? node.type === EPIC_FRAME_KIND : isParticipant(node.data.node))
      if (!snaps(lead)) return undefined
      const moving = dragged.filter(snaps)
      const ids = new Set(moving.map((node) => node.id))
      const layout = currentLayout(projectId) ?? latest.current.layout
      if (dragScene.current === null) {
        const all = flow.getNodes()
        const byId = new Map(all.map((node) => [node.id, node]))
        const neighbours: Rect[] = []
        const planeObstacles: Rect[] = []
        for (const node of all) {
          if (ids.has(node.id) || node.hidden === true) continue
          const fromSource = derived.sourceOf.has(node.id)
          if (fromSource && node.type === SUBAGENT_KIND) {
            // A Subagent Node sits inside its Session's tree: its place is relative to the Session.
            const parent = node.parentId === undefined ? undefined : byId.get(node.parentId)
            const w = node.width ?? 0
            const h = node.height ?? 0
            if (parent !== undefined && w > 1 && h > 1) planeObstacles.push({ x: parent.position.x + node.position.x, y: parent.position.y + node.position.y, w, h })
            continue
          }
          if (fromSource ? node.type !== EPIC_FRAME_KIND : !isParticipant(node.data.node)) continue
          const rect = { x: node.position.x, y: node.position.y, w: node.width ?? node.data.node.w, h: node.height ?? node.data.node.h }
          neighbours.push(rect)
          planeObstacles.push(rect)
        }
        dragScene.current = { neighbours, layoutObstacles: obstaclesFor(layout.nodes, ids), planeObstacles }
      }
      const scene = dragScene.current
      const { width, height, transform } = store.getState()
      const [tx, ty, zoom] = transform
      const screen = { x: -tx / zoom, y: -ty / zoom, w: width / zoom, h: height / zoom }
      const input: Dragged[] = moving.map((node) => {
        const own = !derived.sourceOf.has(node.id)
        const w = own ? node.data.node.w : (node.width ?? 0)
        const h = own ? node.data.node.h : (node.height ?? 0)
        return { id: node.id, rect: { x: node.position.x, y: node.position.y, w, h }, layout: own }
      })
      return planDrag({
        lead: lead.id,
        dragged: input,
        neighbours: scene.neighbours.filter((rect) => intersects(rect, screen)),
        layoutObstacles: scene.layoutObstacles,
        planeObstacles: scene.planeObstacles,
        zoom,
        free,
      })
    },
    [flow, projectId, store],
  )

  const onNodeDragStart: OnNodeDrag<CanvasFlowNode> = useCallback(() => {
    dragScene.current = null
  }, [])

  const onNodeDrag: OnNodeDrag<CanvasFlowNode> = useCallback(
    (event, node, dragged) => {
      const plan = planFor(node, dragged, held(event, SHORTCUTS.dragFree))
      if (plan === undefined) return
      showSnapGuides(plan)
      if (dragged.every((each) => !plan.snapped.has(each.id) || (plan.snapped.get(each.id)!.x === each.position.x && plan.snapped.get(each.id)!.y === each.position.y))) return
      setNodes((current) => current.map((each) => (plan.snapped.has(each.id) ? { ...each, position: plan.snapped.get(each.id)! } : each)))
    },
    [planFor],
  )

  const onNodeDragStop: OnNodeDrag<CanvasFlowNode> = useCallback(
    (event, lead, released) => {
      const plan = planFor(lead, released, held(event, SHORTCUTS.dragFree))
      dragScene.current = null
      clearSnapGuides()
      // Every dropped Node at its landing place: the place the outline showed.
      const dragged = released.map((node) => (plan?.landing.has(node.id) ? { ...node, position: plan.landing.get(node.id)! } : node))
      if (plan !== undefined) {
        setNodes((current) => current.map((each) => (plan.landing.has(each.id) ? { ...each, position: plan.landing.get(each.id)! } : each)))
      }
      const { layout, derived } = latest.current
      // One ⌘Z step for the whole drop, the Epic frames in it too (worfy-week ticket 08).
      const { back } = dropNodes({ projectId, layout, ops, sourceOf: derived.sourceOf }, dragged)
      // A Node whose source keeps no place for it goes back to where the source has it (ADR-0037).
      if (back.size > 0) {
        const at = new Map(derived.nodes.filter((node) => back.has(node.id)).map((node) => [node.id, node.position]))
        setNodes((current) => current.map((node) => (at.has(node.id) ? { ...node, position: at.get(node.id)!, dragging: false } : node)))
      }
    },
    [ops, planFor, projectId],
  )

  // The camera this screen last saved; a move that ends where it started (a click on the plane) saves nothing.
  const savedCamera = useRef(opening)
  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => {
      const saved = savedCamera.current
      if (saved.x === viewport.x && saved.y === viewport.y && saved.zoom === viewport.zoom) return
      savedCamera.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
      void invoke('viewport.set', { projectId, viewport: savedCamera.current, ...onMachine() }).then((result) => {
        if (!result.ok) console.error('viewport.set failed:', result.error)
      })
    },
    [projectId],
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
      // On Windows Ctrl+_ in a Terminal Node is the shell's undo (readline), not a zoom (`shellKeeps`).
      const zoomIn = matches(event, SHORTCUTS.canvasZoomIn)
      if (!zoomIn && !matches(event, SHORTCUTS.canvasZoomOut)) return
      if (wrapper.current === null || wrapper.current.offsetParent === null) return
      event.preventDefault()
      void (zoomIn ? flow.zoomIn() : flow.zoomOut())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flow])

  // A plain click activates: a click with a modifier adds to the selection instead, and a drag or
  // a selection rectangle ends without a click.
  const onNodeClick = useCallback(
    (event: ReactMouseEvent, node: CanvasFlowNode) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      activate(node.id)
    },
    [activate],
  )
  const onPaneClick = useCallback(() => activate(null), [activate])

  // A press outside the active Node, or Esc nobody else took, ends the activity. Esc inside a
  // Terminal belongs to its shell. A press inside a Card's page never reaches this window, and it
  // is inside the active Node anyway.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const active = activeRef.current
      if (active === null) return
      const node = event.target instanceof Element ? event.target.closest('.react-flow__node') : null
      if (node?.getAttribute('data-id') === active) return
      activate(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || activeRef.current === null) return
      if (event.target instanceof Element && event.target.closest('.w-terminal') !== null) return
      activate(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activate])

  // The wheel over a Node goes to the Canvas unless the Node is active (wheel-router.ts).
  useEffect(() => {
    const root = wrapper.current
    if (root === null) return
    return routeWheels(root, (element) => {
      const id = element.getAttribute('data-id')
      return id !== null && id === activeRef.current && flow.getNode(id)?.selected === true
    })
  }, [flow])

  // Nodes pinned to the screen are placed anew for every viewport (pinning.ts).
  const pinnedNodes = usePinnedPlacement(nodes)
  const readOnly = useReadOnly()
  // Only the active Node's object is replaced, so a drag does not redraw every Node on each frame.
  const shownNodes = useMemo(
    () =>
      lockedForReadOnly(
        activeNodeId === null ? pinnedNodes : pinnedNodes.map((node) => (node.id === activeNodeId && node.selected === true ? withActiveClass(node) : node)),
        readOnly,
      ),
    [pinnedNodes, activeNodeId, readOnly],
  )

  return (
    <LayoutOpsContext.Provider value={ops}>
      <div ref={wrapper} className="w-canvas" data-testid="canvas" data-project-id={projectId} onDoubleClick={onDoubleClick}>
        <ReactFlow<CanvasFlowNode>
          nodes={shownNodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable={readOnly === null}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={onMoveEnd}
          defaultViewport={opening}
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode={isMac() ? 'Meta' : 'Control'}
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

/**
 * The camera this screen opens the Project's Canvas at (worfy-link ticket 06): main's saved one for
 * this machine, or the Layout's old `viewport` while there is none. Undefined until main answers;
 * when it cannot, the Canvas opens at the Layout's `viewport`, as before there was a camera apart.
 */
function useOpeningCamera(projectId: string, layout: Layout | undefined): Viewport | undefined {
  const [answer, setAnswer] = useState<{ viewport: Viewport | null } | { failed: true }>()
  useEffect(() => {
    let active = true
    void invoke('viewport.get', { projectId, ...onMachine() }).then((result) => {
      if (!active) return
      if (result.ok) setAnswer({ viewport: result.value })
      else {
        console.error('viewport.get failed:', result.error)
        setAnswer({ failed: true })
      }
    })
    return () => {
      active = false
    }
  }, [projectId])
  if (answer === undefined) return undefined
  // null: a Project of a Linked machine with no camera saved here yet.
  return ('viewport' in answer ? answer.viewport : null) ?? layout?.viewport
}

/**
 * The camera is this machine's state (`viewport.*` are `local`), kept apart for each Machine whose
 * Project the window shows: one folder on two Machines is two Projects with one id (worfy-link 09).
 */
function onMachine(): { machine?: string } {
  const machine = windowMachine()
  return machine === null ? {} : { machine }
}

function ProjectCanvas({ projectId }: { projectId: string }) {
  const { state, error } = useLayout(projectId)
  // React Flow takes the camera only when it mounts: the Canvas waits for both answers.
  const opening = useOpeningCamera(projectId, state?.layout)
  if (error !== undefined) {
    return (
      <div className="w-canvas-message" role="alert">
        The canvas could not be loaded: {error}
      </div>
    )
  }
  if (state === undefined || opening === undefined) return null
  return (
    <ReactFlowProvider>
      <Flow projectId={projectId} state={state} opening={opening} />
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
