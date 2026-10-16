/// <reference types="vite/client" />
// The right rail of the Session view. Each block is one file here, src/renderer/session/rail/<Name>.tsx,
// that exports
//
//   export const order = 20                                    // lower numbers come first
//   export default function Binding(props: RailBlockProps) { … }   // null when it has nothing to show
//
// This file finds them itself (import.meta.glob), so adding a block never edits it or
// SessionView.tsx. The blocks are the Binding and the Subagent tree; the Limits are not one of
// them, they live in the toolbar only.
import type { ComponentType } from 'react'
import { collectExtensions } from '../../shell/registry'

/** What every rail block gets: the Session the view shows. */
export interface RailBlockProps {
  projectId: string
  /** The Session's Node on the Canvas. */
  nodeId: string
  /** The live Session's id for the `agent.*` channels; null while none runs, and for a Session started outside worfy. */
  sessionId: string | null
  /**
   * The id Claude Code gave the Session, which names its files under ~/.claude (transcript,
   * Subagents): the live Session's id once Claude Code has named it, or the id of a Session
   * started outside worfy. Null while unknown.
   */
  claudeSessionId?: string | null | undefined
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
