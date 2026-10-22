/// <reference types="vite/client" />
// The registry of Node types. Each type is one file here, src/renderer/canvas/nodes/<Type>Node.tsx,
// that exports
//
//   export const kind = 'note'            // the `kind` of its Nodes in the Layout
//   export const defaultWidth = 220       // optional: size of a new Node of this kind
//   export const defaultHeight = 120
//   export const minimapColor = 'var(--border-strong)'  // optional: its colour on the minimap
//   export const kindColour: NodeKindColour = 'session'  // or instead: the kind colour (../kind-colours.ts)
//                                                         // of its band, icon and minimap
//   export default function NoteNode(props: CanvasNodeProps) { … }
//
// This file finds them itself (import.meta.glob), so adding a Node type never edits it or
// Canvas.tsx. A Node whose kind has no file is drawn by the placeholder (../UnknownNode.tsx).
import type { ComponentType } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import type { LayoutNode } from '../../../shared/layout/types'
import { isNodeKindColour, KIND } from '../kind-colours'

/** What a Node component gets in `data`: its entry in the Layout. */
export type CanvasNodeData = { node: LayoutNode }
export type CanvasFlowNode = Node<CanvasNodeData>
export type CanvasNodeProps = NodeProps<CanvasFlowNode>

export interface NodeType {
  kind: string
  Component: ComponentType<CanvasNodeProps>
  defaultWidth: number
  defaultHeight: number
  /** A CSS colour (a theme token) for its Nodes on the minimap; undefined: the minimap's default. */
  minimapColor?: string | undefined
}

/** Lower-case words joined by dashes; this keeps a kind from clashing with the placeholder's type name. */
const KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const FALLBACK_WIDTH = 240
const FALLBACK_HEIGHT = 140

/** React Flow's type name for a Node whose kind has no file. It cannot match KIND_PATTERN. */
export const UNKNOWN_NODE_TYPE = 'worfy:unknown'

/** A function or class, or one of React's wrapper objects (memo, forwardRef, lazy). */
function isComponentType(value: unknown): value is ComponentType<CanvasNodeProps> {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value)
}

function positiveOr(value: unknown, fallback: number, path: string, name: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${path}: \`${name}\` must be a positive number`)
  return value
}

function colorOrUndefined(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: \`minimapColor\` must be a CSS colour, e.g. 'var(--border-strong)'`)
  return value
}

/** The minimap colour of a type: its kind colour's band (kind-colours.ts), else its own `minimapColor`. */
function minimapColorOf(minimapColor: unknown, kindColour: unknown, path: string): string | undefined {
  if (kindColour === undefined) return colorOrUndefined(minimapColor, path)
  if (!isNodeKindColour(kindColour)) throw new Error(`${path}: \`kindColour\` must be one of ${Object.keys(KIND).join(', ')}`)
  if (minimapColor !== undefined) throw new Error(`${path}: a type with a \`kindColour\` takes its minimap colour from it; drop \`minimapColor\``)
  return KIND[kindColour].band
}

/**
 * Turns the result of an eager import.meta.glob into Node types by kind. A module without a
 * component or a valid `kind`, or two modules with the same kind, is a programming error and
 * throws when the canvas module is first imported, so it fails every e2e test instead of
 * silently drawing placeholders.
 */
export function collectNodeTypes(modules: Record<string, unknown>): Map<string, NodeType> {
  const types = new Map<string, NodeType>()
  const declaredIn = new Map<string, string>()
  for (const [path, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const { default: Component, kind, defaultWidth, defaultHeight, minimapColor, kindColour } = (module ?? {}) as Record<string, unknown>
    if (!isComponentType(Component)) throw new Error(`${path} must default-export the Node's React component`)
    if (typeof kind !== 'string' || !KIND_PATTERN.test(kind)) {
      throw new Error(`${path} must export a \`kind\` of lower-case words joined by dashes, e.g. export const kind = 'note'`)
    }
    const taken = declaredIn.get(kind)
    if (taken !== undefined) throw new Error(`${taken} and ${path} both declare kind '${kind}'`)
    declaredIn.set(kind, path)
    types.set(kind, {
      kind,
      Component,
      defaultWidth: positiveOr(defaultWidth, FALLBACK_WIDTH, path, 'defaultWidth'),
      defaultHeight: positiveOr(defaultHeight, FALLBACK_HEIGHT, path, 'defaultHeight'),
      minimapColor: minimapColorOf(minimapColor, kindColour, path),
    })
  }
  return types
}

/**
 * The accessible name of a Node's React Flow wrapper, the element Tab moves the focus to: the name
 * a node source gave it (`own`, e.g. "Ticket 05"), else its kind in words ('done-shelf' → "Done
 * shelf"), or "Unknown node: <kind>" for a kind this build has no file for.
 */
export function flowNodeLabel(kind: string, known: boolean, own?: string): string {
  if (own !== undefined) return own
  if (!known) return `Unknown node: ${kind}`
  const words = kind.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Every src/renderer/canvas/nodes/*Node.tsx of this build. */
export const nodeTypes = collectNodeTypes(import.meta.glob('./*Node.tsx', { eager: true }))
