/// <reference types="vite/client" />
// Transcript rows for event types the transcript itself does not draw. Each is one file here,
// src/renderer/session/rows/<Name>.tsx, that exports
//
//   export const eventType = 'permission_request'      // the `type` of the events it draws
//   export default function PermissionRequest(props: TranscriptRowProps) { … }
//
// and this file finds them itself (import.meta.glob): a new kind of row (permission requests,
// ticket 21) never edits Transcript.tsx. A row file wins over the transcript's own drawing of
// the same event type.
import type { ComponentType } from 'react'
import type { AgentEvent } from '../../../shared/agent/events'

export interface TranscriptRowProps {
  event: AgentEvent
  /** The Session the event belongs to; null for a transcript read from a file. */
  sessionId: string | null
  projectId: string | undefined
}

function isComponentType(value: unknown): value is ComponentType<TranscriptRowProps> {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value)
}

/**
 * Turns the result of an eager import.meta.glob into row components by event type. A file
 * without a component or an `eventType`, or two files for one type, throw when the transcript is
 * first imported.
 */
export function collectRowTypes(modules: Record<string, unknown>): Map<string, ComponentType<TranscriptRowProps>> {
  const rows = new Map<string, ComponentType<TranscriptRowProps>>()
  const declaredIn = new Map<string, string>()
  for (const [path, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const { default: Component, eventType } = (module ?? {}) as Record<string, unknown>
    if (!isComponentType(Component)) throw new Error(`${path} must default-export the row's React component`)
    if (typeof eventType !== 'string' || eventType === '') throw new Error(`${path} must export the \`eventType\` it draws`)
    const taken = declaredIn.get(eventType)
    if (taken !== undefined) throw new Error(`${taken} and ${path} both draw '${eventType}'`)
    declaredIn.set(eventType, path)
    rows.set(eventType, Component)
  }
  return rows
}

/** Every src/renderer/session/rows/*.tsx of this build. */
export const rowTypes = collectRowTypes(import.meta.glob('./*.tsx', { eager: true }))
