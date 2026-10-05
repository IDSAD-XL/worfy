/// <reference types="vite/client" />
// The Canvas's other extension points, found the same way as Node types (nodes/index.ts), so a
// later ticket adds a file instead of editing Canvas.tsx:
//
// - an edge source, src/renderer/canvas/edges/<name>.ts, default-exports a function that gets the
//   Layout's Nodes and returns React Flow edges between them (Subagent tree, Bindings…);
// - an overlay, src/renderer/canvas/overlays/<Name>.tsx, default-exports a component and exports a
//   numeric `order`, like a shell extension. Overlays are drawn inside React Flow, so they can use
//   its hooks and its <Panel> (zoom controls, minimap).
import type { Edge } from '@xyflow/react'
import type { LayoutNode } from '../../shared/layout/types'
import { collectExtensions, type ShellExtension } from '../shell/registry'

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
