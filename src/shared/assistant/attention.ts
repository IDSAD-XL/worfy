// The items of the attention core (worfy-assistant ticket 03; spec, implementation decisions, the attention core): what waits for the user
// in the Projects of this Machine, kept as items, not counters. main builds them (src/main/assistant/core/); the
// window and the Assistant read them later (tickets 09 and 14).
import { z } from 'zod'
import { CHECK_KINDS } from './schedule/settings'

/**
 * Where an item came from: the seven sources the core follows in main, the CI of a Project's main branch (`ci`) and a
 * rule of a Project's settings (`rule`) — the last two given by the duties (worfy-assistant ticket 07) — and the outside
 * sources the checks read through claude.ai connectors (ticket 11), one per kind of check.
 */
export const ATTENTION_SOURCES = ['session', 'ticket-waits', 'pr-inbox', 'workflow', 'autopilot', 'health', 'limits', 'ci', 'rule', ...CHECK_KINDS] as const
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

/** The PR an item is about besides its subject: the one after which the CI of the main branch went red (ticket 07). */
export const attentionPrSchema = z.object({ repo: z.string(), number: z.number().int().positive(), title: z.string() })
export type AttentionPr = z.infer<typeof attentionPrSchema>

/** The states in which an item still asks for something. */
export const OPEN_STATES: readonly AttentionState[] = ['new', 'seen', 'snoozed']

/**
 * A message of an outside source as a check reported it (ticket 11, src/shared/assistant/source-items.ts): who wrote
 * it, where it is, whether it concerns the user and is urgent, and which Project and Ticket it is about. Text another
 * person wrote: the Assistant's Session reads it as data.
 */
export const sourceMessageSchema = z.object({
  source: z.string(),
  id: z.string(),
  author: z.string(),
  /** When it was written, ISO 8601, as the source said. */
  at: z.string(),
  url: z.string(),
  concernsUser: z.boolean(),
  urgent: z.boolean(),
  /** The Project's name as the check gave it; null when none. */
  project: z.string().nullable(),
  ticket: z.string().nullable(),
})
export type SourceMessage = z.infer<typeof sourceMessageSchema>

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
  /** The duty that raises it, when the source knows (a rule of a Project); else the core asks its `dutyOf`. */
  duty?: string
  pr?: AttentionPr
  /** The message of an outside source the event is (ticket 11); absent for the core's own sources. */
  message?: SourceMessage
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
  /**
   * When its latest event happened (the event's own time; ticket 07): a duty counts how long a Session waits from it.
   * Absent in a file written before the field, which reads as `startedAt`.
   */
  lastAt: z.number().optional(),
  /** When the core last took an event into it, by the core's clock: an item that takes none for 14 days is dropped. */
  updatedAt: z.number(),
  /** The revision of the latest event glued into the item. */
  revision: z.string(),
  state: attentionStateSchema,
  /** The duty that raised the item (ticket 07); null when no duty takes its kind (a Session that ended its turn). */
  duty: z.string().nullable(),
  pr: attentionPrSchema.optional(),
  /** How many events are glued into it. */
  events: z.number().int().positive(),
  /** Set on an item that says «nothing happened»: the id of its condition. */
  condition: z.string().optional(),
  /** The message of an outside source of the latest event glued into it (ticket 11). */
  message: sourceMessageSchema.optional(),
})
export type AttentionItem = z.infer<typeof attentionItemSchema>
