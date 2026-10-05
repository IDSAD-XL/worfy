/// <reference types="vite/client" />
// The right rail of the Session view. Each block is one file here, src/renderer/session/rail/<Name>.tsx,
// that exports
//
//   export const order = 20                                    // lower numbers come first
//   export default function Binding(props: RailBlockProps) { … }   // null when it has nothing to show
//
// This file finds them itself (import.meta.glob), so adding a block never edits it or
// SessionView.tsx. Tickets 15 (subagent tree), 16 (binding) and 22 (limits) add theirs; until
// then the rail is empty and the Session view does not draw it.
import type { ComponentType } from 'react'
import { collectExtensions } from '../../shell/registry'

/** What every rail block gets: the Session the view shows. */
export interface RailBlockProps {
  projectId: string
  /** The Session's Node on the Canvas. */
  nodeId: string
  /** The live Session's id for the `agent.*` channels; null while none runs. */
  sessionId: string | null
}

export interface RailBlock {
  /** File name without the extension, e.g. "Binding". */
  id: string
  order: number
  Component: ComponentType<RailBlockProps>
}

/**
 * Turns the result of an eager import.meta.glob into blocks sorted by `order`, then by file name.
 * A file without a component or a numeric `order` throws when the Session view is first imported,
 * so it fails every e2e test instead of silently vanishing (shell/registry.ts).
 */
export function collectRailBlocks(modules: Record<string, unknown>): RailBlock[] {
  return collectExtensions(modules).map(({ id, order, Component }) => ({ id, order, Component: Component as ComponentType<RailBlockProps> }))
}

/** Every src/renderer/session/rail/*.tsx of this build. */
export const railBlocks = collectRailBlocks(import.meta.glob('./*.tsx', { eager: true }))
