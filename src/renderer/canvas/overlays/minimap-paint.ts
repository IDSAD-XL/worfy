// How the minimap paints a Node (MiniMapOverlay.tsx): by its kind, in the colour its Node type
// declares (`minimapColor` in nodes/index.ts). The coloured kinds use their `kind-*` token
// (ADR-0077); an outlined kind is drawn as an outline in that colour, with no fill.
import type { Node } from '@xyflow/react'
import { nodeTypes, type CanvasFlowNode, type NodeType } from '../nodes'

/** The colour of a Node whose type declares none (nodes/index.ts, `minimapColor`), or whose kind has no type. */
export const NODE_COLOR_DEFAULT = 'var(--text-muted)'

/** Kinds drawn as an outline in their colour, with no fill (ADR-0077: a Subagent has its Session's colour, outline only). */
export const OUTLINED_KINDS: ReadonlySet<string> = new Set(['subagent'])
export const NO_COLOR = 'transparent'

/** The class an outlined kind's rectangle gets; minimap.css gives it its stroke width. */
export const OUTLINE_CLASS = 'w-minimap-node--outline'
/** The class of a pinned Node's rectangle: a pinned Node is not on the plane, minimap.css hides it. */
export const PINNED_CLASS = 'w-minimap-node--pinned'

export interface MinimapPaint {
  fill(node: Node): string
  stroke(node: Node): string
  className(node: Node): string
}

/** The Node's kind in the Layout (React Flow's type is the placeholder's for unknown kinds). */
const kindOf = (node: Node): string => (node as CanvasFlowNode).data.node.kind

/** The minimap's paint over a registry of Node types; the app's own registry by default. */
export function minimapPaint(types: ReadonlyMap<string, Pick<NodeType, 'minimapColor'>> = nodeTypes): MinimapPaint {
  const kindColor = (node: Node): string => types.get(kindOf(node))?.minimapColor ?? NODE_COLOR_DEFAULT
  const outlined = (node: Node): boolean => OUTLINED_KINDS.has(kindOf(node))
  return {
    fill: (node) => (outlined(node) ? NO_COLOR : kindColor(node)),
    stroke: (node) => (outlined(node) ? kindColor(node) : NO_COLOR),
    className(node) {
      const classes: string[] = []
      if ((node as CanvasFlowNode).data.node.pinned) classes.push(PINNED_CLASS)
      if (outlined(node)) classes.push(OUTLINE_CLASS)
      return classes.join(' ')
    },
  }
}
