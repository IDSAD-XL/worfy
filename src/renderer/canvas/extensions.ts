/// <reference types="vite/client" />
// The Canvas's other extension points, found the same way as Node types (nodes/index.ts), so a
// later ticket adds a file instead of editing Canvas.tsx:
//
// - an edge source, src/renderer/canvas/edges/<name>.ts, default-exports a function that gets the
//   Layout's Nodes and returns React Flow edges between them (Subagent tree, Bindings…);
// - an overlay, src/renderer/canvas/overlays/<Name>.tsx, default-exports a component and exports a
//   numeric `order`, like a shell extension. Overlays are drawn inside React Flow, so they can use
//   its hooks and its <Panel> (zoom controls, minimap);
// - a node source, src/renderer/canvas/sources/<name>.ts, default-exports a NodeSource: Nodes that
//   are computed from something other than the Layout (the Epic frames and Tickets from the
//   workflow model) and are drawn next to the Layout's own Nodes. The Layout keeps only what the
//   user changed about them, in Nodes of the kinds the source `owns`;
// - an edge type, src/renderer/canvas/edge-types/<Name>Edge.tsx, exports `kind` (the `type` an edge
//   source gives its edges) and default-exports the component that draws such an edge
//   (RoutedEdge.tsx: the route ELK made for a "Blocked by" Edge, ADR-0037).
import type { Edge, EdgeTypes } from '@xyflow/react'
import type { Layout, LayoutNode } from '../../shared/layout/types'
import { collectExtensions, type ShellExtension } from '../shell/registry'
import { dropOperation, grouped, type Group } from './history'
import type { CanvasFlowNode } from './nodes'
import type { LayoutOps } from './useLayout'

export type EdgeSource = (nodes: readonly LayoutNode[]) => Edge[]

/** Lower-case words joined by dashes, like a Node kind. */
const EDGE_KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/**
 * Turns an eager import.meta.glob of edge types into React Flow's `edgeTypes`. A module without a
 * component or a valid `kind`, or two modules with one kind, throws when the module loads.
 */
export function collectEdgeTypes(modules: Record<string, unknown>): EdgeTypes {
  const types: EdgeTypes = {}
  const declaredIn = new Map<string, string>()
  for (const [path, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const { default: Component, kind } = (module ?? {}) as Record<string, unknown>
    if (typeof Component !== 'function' && (typeof Component !== 'object' || Component === null || !('$$typeof' in Component))) {
      throw new Error(`${path} must default-export the edge's React component`)
    }
    if (typeof kind !== 'string' || !EDGE_KIND_PATTERN.test(kind)) throw new Error(`${path} must export a \`kind\` of lower-case words joined by dashes, e.g. export const kind = 'routed'`)
    const taken = declaredIn.get(kind)
    if (taken !== undefined) throw new Error(`${taken} and ${path} both declare edge kind '${kind}'`)
    declaredIn.set(kind, path)
    types[kind] = Component as EdgeTypes[string]
  }
  return types
}

export const edgeTypes: EdgeTypes = collectEdgeTypes(import.meta.glob('./edge-types/*Edge.tsx', { eager: true }))

export interface EdgeSourceEntry {
  /** File name without the extension. */
  id: string
  source: EdgeSource
}

/** Turns an eager import.meta.glob of edge sources into a list sorted by file name; a module without a default function throws. */
export function collectEdgeSources(modules: Record<string, unknown>): EdgeSourceEntry[] {
  return Object.entries(modules)
    .map(([path, module]) => {
      const source = (module as { default?: unknown } | undefined)?.default
      if (typeof source !== 'function') throw new Error(`${path} must default-export a function (nodes) => Edge[]`)
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { id: name.replace(/\.[^.]+$/, ''), source: source as EdgeSource }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Edges of every source; a source that throws is logged and skipped, the rest still draw. */
export function edgesOf(sources: readonly EdgeSourceEntry[], nodes: readonly LayoutNode[]): Edge[] {
  return sources.flatMap(({ id, source }) => {
    try {
      return source(nodes)
    } catch (error) {
      console.error(`edge source ${id} threw`, error)
      return []
    }
  })
}

export const edgeSources: EdgeSourceEntry[] = collectEdgeSources(import.meta.glob('./edges/*.ts', { eager: true }))

export const overlays: ShellExtension[] = collectExtensions(import.meta.glob('./overlays/*.tsx', { eager: true }))

export interface NodeSourceContext {
  projectId: string
  layout: Layout
}

/**
 * What the Canvas gives a source to save a dropped Node with. The drop is the user's gesture, so
 * what the source saves goes through `ops` into `group` and is one ⌘Z step with the rest of the
 * drop (worfy-week ticket 08).
 */
export interface NodeDrop {
  ops: LayoutOps
  /** The drop's one step of the history (history.ts grouped()). */
  group: Group
}

/**
 * Nodes that the Layout does not hold. `useNodes` is a React hook: the Canvas calls every source's
 * hook on every render, inside React Flow's provider, so a source may use React Flow's hooks.
 * It must return the same array while nothing changed, and parents before their children.
 * Every Node it returns carries a LayoutNode in `data.node`, as Layout Nodes do, so Node
 * components and edge sources read both kinds the same way.
 */
export interface NodeSource {
  /**
   * Layout Nodes of these kinds are the source's saved state (offsets, collapsed flags): the
   * Canvas does not draw them, the source reads them from `layout`.
   */
  owns: readonly string[]
  useNodes(context: NodeSourceContext): readonly CanvasFlowNode[]
  /**
   * One of the source's Nodes was dragged and dropped; `node.position` is where it is now. True
   * when the source saved where it was dropped: the Node stays there until the source draws it
   * anew. A promise when the source saves it through `drop`: the Node stays there too, and the
   * drop's step of the history is complete when the promise settles. False or undefined when the
   * source keeps no place for it (a Subagent Node dragged to bind it, ADR-0037): the Canvas puts
   * the Node back where the source has it. The Canvas always gives `drop` (dropNodes() below); a
   * source that saves through it saves nothing without it.
   */
  moved(context: NodeSourceContext, node: CanvasFlowNode, drop?: NodeDrop): boolean | undefined | Promise<unknown>
}

/** What one drop of dragged Nodes is saved with. */
export interface DropContext extends NodeSourceContext {
  ops: LayoutOps
  /** The node source each source Node came from; a Node not in it is the Layout's own. */
  sourceOf: ReadonlyMap<string, NodeSource>
}

/**
 * Saves one drop of dragged Nodes as one step of the user's history (history.ts grouped()): the
 * Layout's own Nodes in one `move` or `moveMany` (dropOperation()), each source Node through its
 * source's `moved`, so one ⌘Z puts back a selection of Layout Nodes and Epic frames as a whole.
 * `back` is known at once: the source Nodes the Canvas puts back where their source has them.
 * `saved` settles when every part of the drop has been answered.
 */
export function dropNodes(context: DropContext, dragged: readonly CanvasFlowNode[]): { back: ReadonlySet<string>; saved: Promise<void> } {
  const back = new Set<string>()
  // grouped() runs the function at once up to its first await, so `back` is filled before it returns.
  const saved = grouped(async (group) => {
    const pending: Promise<unknown>[] = []
    const own: CanvasFlowNode[] = []
    for (const node of dragged) {
      const source = context.sourceOf.get(node.id)
      if (source === undefined) {
        own.push(node)
        continue
      }
      const kept = source.moved({ projectId: context.projectId, layout: context.layout }, node, { ops: context.ops, group })
      if (kept instanceof Promise) pending.push(kept)
      else if (kept !== true) back.add(node.id)
    }
    const op = dropOperation(own)
    if (op !== undefined) pending.push(context.ops.apply(op, group))
    await Promise.allSettled(pending)
  })
  return { back, saved }
}

export interface NodeSourceEntry {
  /** File name without the extension. */
  id: string
  source: NodeSource
}

function isNodeSource(value: unknown): value is NodeSource {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Partial<NodeSource>
  return Array.isArray(source.owns) && typeof source.useNodes === 'function' && typeof source.moved === 'function'
}

/** Turns an eager import.meta.glob of node sources into a list sorted by file name; a malformed module throws. */
export function collectNodeSources(modules: Record<string, unknown>): NodeSourceEntry[] {
  return Object.entries(modules)
    .map(([path, module]) => {
      const source = (module as { default?: unknown } | undefined)?.default
      if (!isNodeSource(source)) throw new Error(`${path} must default-export a NodeSource ({ owns, useNodes, moved })`)
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { id: name.replace(/\.[^.]+$/, ''), source }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const nodeSources: NodeSourceEntry[] = collectNodeSources(import.meta.glob('./sources/*.ts', { eager: true }))
