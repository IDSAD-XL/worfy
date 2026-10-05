/// <reference types="vite/client" />
// Items of the input field's bottom bar (MessageInput.tsx), between the hint and the send button.
// Each item is one file here, src/renderer/session/composer/<Name>.tsx, that exports
//
//   export const order = 10
//   export default function QueuedChip(props: ComposerItemProps) { … }
//
// and this file finds them itself (import.meta.glob). The queue and model picker (ticket 19) and
// attachments (ticket 20) can arrive as items without editing MessageInput.tsx.
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

export interface ComposerItem {
  id: string
  order: number
  Component: ComponentType<ComposerItemProps>
}

export function collectComposerItems(modules: Record<string, unknown>): ComposerItem[] {
  return collectExtensions(modules).map(({ id, order, Component }) => ({ id, order, Component: Component as ComponentType<ComposerItemProps> }))
}

/** Every src/renderer/session/composer/*.tsx of this build. */
export const composerItems = collectComposerItems(import.meta.glob('./*.tsx', { eager: true }))
