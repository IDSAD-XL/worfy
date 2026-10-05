/// <reference types="vite/client" />
import type { ComponentType } from 'react'

/**
 * A shell extension: one file under src/renderer/shell/sidebar/ (a sidebar section) or
 * src/renderer/shell/toolbar/ (a toolbar item). The file default-exports a component and exports
 * a numeric `order`; lower numbers come first. Adding a file is all it takes to add a part of the
 * shell: Sidebar.tsx and Toolbar.tsx find the files with import.meta.glob.
 */
export interface ShellExtension {
  /** File name without the extension, e.g. "ProjectsSection". */
  id: string
  order: number
  Component: ComponentType
}

function fileId(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Turns the result of an eager import.meta.glob into extensions sorted by `order`, then by file
 * name. A module without a component or a finite `order` is a programming error and throws, so
 * a forgotten export fails the first render (and every e2e test) instead of silently vanishing.
 */
export function collectExtensions(modules: Record<string, unknown>): ShellExtension[] {
  return Object.entries(modules)
    .map(([path, module]) => {
      const { default: Component, order } = (module ?? {}) as { default?: unknown; order?: unknown }
      if (typeof Component !== 'function') {
        throw new Error(`${path} must default-export a React component`)
      }
      if (typeof order !== 'number' || !Number.isFinite(order)) {
        throw new Error(`${path} must export a numeric \`order\``)
      }
      return { id: fileId(path), order, Component: Component as ComponentType }
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
