/// <reference types="vite/client" />
// Two slots on the Canvas's workflow Nodes, filled by later tickets one file at a time:
//
// - badges, src/renderer/canvas/badges/<Name>.tsx — small status marks on a Ticket or a Session
//   (gate, PR, CI: ticket 17; a pending permission: ticket 21);
// - actions, src/renderer/canvas/actions/<Name>.tsx — buttons on a Ticket or an Epic frame
//   ("Ship ticket", "Run wave", "Open PR": ticket 23).
//
// A slot module default-exports a component that gets the subject (the Ticket or the Epic it is
// drawn on) and exports a numeric `order`; lower numbers come first. The component decides itself
// whether it has anything to show for that subject and returns null otherwise. Nothing here or in
// the Node files changes when a module is added.
import type { ComponentType } from 'react'
import type { Epic, Ticket } from '../../../shared/workflow/types'
import { collectExtensions } from '../../shell/registry'

/** What a badge or an action is drawn on. A Session Node (nodes/SessionNode.tsx) draws badges only. */
export type SlotSubject =
  | { kind: 'ticket'; projectId: string; root: string; ticket: Ticket }
  | { kind: 'session'; projectId: string; root: string; sessionId: string }
  | { kind: 'epic'; projectId: string; root: string; epic: Epic; tickets: readonly Ticket[] }

export interface SlotProps {
  subject: SlotSubject
}

export interface SlotItem {
  /** File name without the extension. */
  id: string
  order: number
  Component: ComponentType<SlotProps>
}

/**
 * Turns an eager import.meta.glob of slot modules into items sorted by `order`, then by file
 * name. A module without a component or a numeric `order` throws when the canvas loads.
 */
export function collectSlot(modules: Record<string, unknown>): SlotItem[] {
  return collectExtensions(modules) as unknown as SlotItem[]
}

export const badges: SlotItem[] = collectSlot(import.meta.glob(['./*.tsx'], { eager: true }))

export const actions: SlotItem[] = collectSlot(import.meta.glob(['../actions/*.tsx'], { eager: true }))
