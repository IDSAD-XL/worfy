// The items of the attention core (worfy-assistant ticket 03; spec, implementation decisions, the attention core): what waits for the user
// in the Projects of this Machine, kept as items, not counters. main builds them (src/main/assistant/core/); the
// window and the Assistant read them later (tickets 09 and 14).
import { z } from 'zod'

/** Where an item came from: the seven sources the core follows in main. */
export const ATTENTION_SOURCES = ['session', 'ticket-waits', 'pr-inbox', 'workflow', 'autopilot', 'health', 'limits'] as const
export const attentionSourceSchema = z.enum(ATTENTION_SOURCES)
export type AttentionSource = z.infer<typeof attentionSourceSchema>

/**
 * What an item is about. The spec names PR, Ticket, Session, Run and a source's message; a Health check row
 * (`check`) and a Limits window (`limit`) are subjects of their own.
 */
export const attentionSubjectSchema = z.object({
  kind: z.enum(['pr', 'ticket', 'session', 'run', 'message', 'check', 'limit']),
  id: z.string().min(1),
  /** How the subject is named on screen. */
  label: z.string(),
})
export type AttentionSubject = z.infer<typeof attentionSubjectSchema>

/** new, seen, snoozed, dismissed (by the user), closed (the cause went away), stale (a newer word replaced it). */
export const ATTENTION_STATES = ['new', 'seen', 'snoozed', 'dismissed', 'closed', 'stale'] as const
export const attentionStateSchema = z.enum(ATTENTION_STATES)
export type AttentionState = z.infer<typeof attentionStateSchema>

/** The states in which an item still asks for something. */
export const OPEN_STATES: readonly AttentionState[] = ['new', 'seen', 'snoozed']

/** One event a source gives the core. */
export interface AttentionEvent {
  source: AttentionSource
  /** The event's id within its source; with `revision`, the key that drops a repeat. */
  id: string
  revision: string
  /** The Project's id; null for the Machine itself (Limits, a Health check row of no Project). */
  projectId: string | null
  subject: AttentionSubject
  /** What happened: `question`, `waits`, `run-stopped`, `limit-reached`… */
  kind: string
  /** One line for the list. */
  text: string
  /** When it happened, ms since the epoch; the core's clock when the source does not know. */
  at?: number
}

export const attentionItemSchema = z.object({
  id: z.string().min(1),
  source: attentionSourceSchema,
  projectId: z.string().nullable(),
  subject: attentionSubjectSchema,
  /** The kind of the latest event glued into the item. */
  kind: z.string(),
  text: z.string(),
  /** When its first event happened (the event's own time). */
  startedAt: z.number(),
  /** When the core last took an event into it, by the core's clock: an item that takes none for 14 days is dropped. */
  updatedAt: z.number(),
  /** The revision of the latest event glued into the item. */
  revision: z.string(),
  state: attentionStateSchema,
  /** The duty that raised the item (ticket 07); null until duties exist. */
  duty: z.string().nullable(),
  /** How many events are glued into it. */
  events: z.number().int().positive(),
  /** Set on an item that says «nothing happened»: the id of its condition. */
  condition: z.string().optional(),
})
export type AttentionItem = z.infer<typeof attentionItemSchema>
