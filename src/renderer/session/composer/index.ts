/// <reference types="vite/client" />
// Items of the input field's bottom bar (MessageInput.tsx), between the hint and the send button.
// Each item is one file here, src/renderer/session/composer/<Name>.tsx, that exports
//
//   export const order = 10
//   export default function QueuedChip(props: ComposerItemProps) { … }
//
// and this file finds them itself (import.meta.glob). The queue and model picker (ticket 19) and
// attachments (ticket 20) can arrive as items without editing MessageInput.tsx.
//
// The bar has two lines (worfy-throughput ticket 60): the hint line (attach, the hints, then the
// items that say `export const line = 'hint'` — the context meter and the queue — and Interrupt),
// and the controls line (every other item, left to right, then «Return to send» and Send).
import type { ComponentType } from 'react'
import { collectExtensions } from '../../shell/registry'

export interface ComposerItemProps {
  /** The live Session's id; null while none runs. */
  sessionId: string | null
  /** The Session is running a turn. */
  busy: boolean
  /** The text in the field, and a way to replace it. */
  text: string
  setText: (text: string) => void
}

/** The line of the bar an item stands on: the hint's, or the controls' (the default). */
export type ComposerLine = 'hint' | 'controls'

export interface ComposerItem {
  id: string
  order: number
  line: ComposerLine
  Component: ComponentType<ComposerItemProps>
}

/** The file name without its extension, as collectExtensions names an item. */
const idOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '')

export function collectComposerItems(modules: Record<string, unknown>): ComposerItem[] {
  const lines = new Map(Object.entries(modules).map(([path, module]) => [idOf(path), (module as { line?: unknown } | undefined)?.line === 'hint' ? 'hint' : 'controls'] as const))
  return collectExtensions(modules).map(({ id, order, Component }) => ({ id, order, line: lines.get(id) ?? 'controls', Component: Component as ComponentType<ComposerItemProps> }))
}

/** Every src/renderer/session/composer/*.tsx of this build. */
export const composerItems = collectComposerItems(import.meta.glob('./*.tsx', { eager: true }))
