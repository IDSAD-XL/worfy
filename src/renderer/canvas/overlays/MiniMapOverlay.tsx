// The minimap at the bottom right of the Canvas (ticket 29; docs/design/BRIEF.md, Screen 1).
// Nodes are drawn in the colour their Node type declares (a theme token, `minimapColor` in
// nodes/index.ts): the coloured kinds in their `kind-*` token (ADR-0077), a Subagent as an outline
// in it, the rest in a neutral grey. A click moves the viewport so that the clicked point is in
// the middle, dragging pans. View ▸ Show Minimap (src/main/menu.ts) hides and shows it. While it is shown, pinned
// Nodes keep out of its corner (pinning.ts, setMinimapCorner).
import { useEffect } from 'react'
import { MiniMap, useReactFlow, type Node } from '@xyflow/react'
import { create } from 'zustand'
import { invoke, subscribe } from '../../ipc'
import { nodeTypes, type CanvasFlowNode } from '../nodes'
import { setMinimapCorner } from '../pinning'
import './minimap.css'

export const order = 10

/** The colour of a Node whose type declares none (nodes/index.ts, `minimapColor`), or whose kind has no type. */
const NODE_COLOR_DEFAULT = 'var(--text-muted)'

/** Kinds drawn as an outline in their colour, with no fill (ADR-0077: a Subagent has its Session's colour, outline only). */
const OUTLINED_KINDS: ReadonlySet<string> = new Set(['subagent'])
const NO_COLOR = 'transparent'

/** The Node's kind in the Layout (React Flow's type is the placeholder's for unknown kinds). */
const kindOf = (node: Node): string => (node as CanvasFlowNode).data.node.kind

/** The colour of a Node's kind: its Node type's. */
function kindColor(node: Node): string {
  return nodeTypes.get(kindOf(node))?.minimapColor ?? NODE_COLOR_DEFAULT
}

/** The fill of a Node on the minimap: its kind's colour, none for an outlined kind. */
function minimapColor(node: Node): string {
  return OUTLINED_KINDS.has(kindOf(node)) ? NO_COLOR : kindColor(node)
}

/** The outline of a Node on the minimap: its kind's colour for an outlined kind, none for the rest. */
function minimapStrokeColor(node: Node): string {
  return OUTLINED_KINDS.has(kindOf(node)) ? kindColor(node) : NO_COLOR
}

/** A pinned Node is not on the plane; it is left off the minimap. An outlined kind gets its stroke width (minimap.css). */
function minimapClass(node: Node): string {
  const classes = []
  if ((node as CanvasFlowNode).data.node.pinned) classes.push('w-minimap-node--pinned')
  if (OUTLINED_KINDS.has(kindOf(node))) classes.push('w-minimap-node--outline')
  return classes.join(' ')
}

const useMinimapStore = create<{ visible: boolean }>(() => ({ visible: true }))
let followed = false

/** Takes the View menu's state once and follows it; one subscription serves every Canvas. */
function followViewMenu(): void {
  if (followed) return
  followed = true
  try {
    subscribe('view.changed', ({ minimap }) => useMinimapStore.setState({ visible: minimap }))
  } catch (error) {
    console.error('view.changed: cannot subscribe', error)
  }
  void invoke('view.get').then((result) => {
    if (result.ok) useMinimapStore.setState({ visible: result.value.minimap })
    else console.error('view.get failed:', result.error)
  })
}

/** The minimap's drawing, in screen pixels: React Flow's defaults, which this overlay keeps. */
const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
/** Its border on each side (minimap.css) and React Flow's margin around a panel (.react-flow__panel). */
const MINIMAP_BORDER = 1
const PANEL_MARGIN = 15

/**
 * The corner a pinned Node keeps out of (pinning.ts): the minimap, the margin between it and the
 * Canvas's edges, and as much again between it and the Node.
 */
const MINIMAP_CORNER = {
  width: PANEL_MARGIN + MINIMAP_WIDTH + 2 * MINIMAP_BORDER + PANEL_MARGIN,
  height: PANEL_MARGIN + MINIMAP_HEIGHT + 2 * MINIMAP_BORDER + PANEL_MARGIN,
} as const

export default function MiniMapOverlay() {
  const flow = useReactFlow()
  const visible = useMinimapStore((store) => store.visible)
  useEffect(followViewMenu, [])
  // The minimap's visibility is one for every Canvas, so the corner is not cleared on unmount.
  useEffect(() => setMinimapCorner(visible ? MINIMAP_CORNER : undefined), [visible])
  if (!visible) return null
  return (
    <MiniMap
      className="w-minimap"
      position="bottom-right"
      ariaLabel="Minimap"
      pannable
      nodeColor={minimapColor}
      nodeStrokeColor={minimapStrokeColor}
      nodeBorderRadius={4}
      nodeClassName={minimapClass}
      bgColor="var(--surface)"
      maskColor="color-mix(in srgb, var(--canvas) 55%, transparent)"
      maskStrokeColor="var(--accent)"
      maskStrokeWidth={1}
      onClick={(_event, point) => {
        void flow.setCenter(point.x, point.y, { zoom: flow.getZoom() })
      }}
    />
  )
}
