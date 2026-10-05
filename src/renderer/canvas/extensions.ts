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
//   user changed about them, in Nodes of the kinds the source `owns`.
import type { Edge } from '@xyflow/react'
import type { Layout, LayoutNode } from '../../shared/layout/types'
import { collectExtensions, type ShellExtension } from '../shell/registry'
import type { CanvasFlowNode } from './nodes'

export type EdgeSource = (nodes: readonly LayoutNode[]) => Edge[]

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
  /** One of the source's Nodes was dragged and dropped; `node.position` is where it is now. */
  moved(context: NodeSourceContext, node: CanvasFlowNode): void
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
