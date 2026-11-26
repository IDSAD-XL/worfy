// What the window shows of the Assistant (worfy-assistant ticket 14; spec, implementation decisions, UI; stories 1, 2, 16,
// 21–23, 35, 38 and 39): the section of the rail — what waits, with the reason, the source and the duty of each item;
// the proposals with Dismiss, Snooze, Open and Prepare; like and dislike on every message; the journal; the summary;
// the conversation; the line of usage — and the Assistant's own notifications. main builds the view
// (src/main/assistant/window/view.ts) from the attention core, the duties, the proposals, the journal of actions and the
// usage ledger; the window draws it (src/renderer/assistant/) and changes nothing itself: every click goes back to main.
import { z } from 'zod'
import { attentionSourceSchema, attentionStateSchema, attentionSubjectSchema, type AttentionItem } from './attention'

/**
 * Where Open takes the user: a Session on the Canvas, the Pull requests view on a PR, the Pipeline board of a Project, a
 * page of a source (a Slack message, a Jira issue, a CI run), the Health check, or the Project itself.
 */
export const openTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), projectId: z.string(), nodeId: z.string() }),
  z.object({ kind: z.literal('pr'), projectId: z.string(), repo: z.string(), number: z.number().int().positive() }),
  z.object({ kind: z.literal('pipeline'), projectId: z.string() }),
  z.object({ kind: z.literal('project'), projectId: z.string() }),
  z.object({ kind: z.literal('url'), url: z.string() }),
  z.object({ kind: z.literal('health') }),
])
export type OpenTarget = z.output<typeof openTargetSchema>

export const RATINGS = ['like', 'dislike'] as const
export const ratingSchema = z.enum(RATINGS)
export type Rating = z.output<typeof ratingSchema>

/**
 * Prepare: the Session the user may start, in a Project of this Machine, with exactly this text — the Assistant's
 * (a proposal of `worfy-app`) or worfy's own (the fix of a red main branch, a text of the duty). Nothing starts it but the
 * user's Start (ADR-0114, boundary 3).
 */
export const prepareViewSchema = z.object({ projectId: z.string(), text: z.string(), by: z.enum(['assistant', 'worfy']) })
export type PrepareView = z.output<typeof prepareViewSchema>

export const windowItemSchema = z.object({
  /** The core's id of the item. */
  id: z.string(),
  /** The item's one line. */
  title: z.string(),
  /** Why it matters: the «why» of the Assistant's proposal for it; null without one. */
  why: z.string().nullable(),
  source: attentionSourceSchema,
  /** The source in words: «Session», «Slack», «CI of the main branch»… */
  sourceLabel: z.string(),
  subject: attentionSubjectSchema,
  kind: z.string(),
  projectId: z.string().nullable(),
  /** The Project's name; null for the Machine's own item or a Project no longer in the list. */
  projectName: z.string().nullable(),
  /** The duty that raised it. */
  duty: z.object({ id: z.string(), title: z.string() }).nullable(),
  urgent: z.boolean(),
  state: attentionStateSchema,
  startedAt: z.number(),
  lastAt: z.number(),
  /** Written by another person (an outside source): the Assistant reads it as data, and the window marks it so. */
  outside: z.object({ author: z.string(), at: z.string(), url: z.string() }).nullable(),
  /** The Assistant's open proposal for the item; null without one. */
  proposalId: z.string().nullable(),
  prepare: prepareViewSchema.nullable(),
  open: openTargetSchema.nullable(),
  rating: ratingSchema.nullable(),
  /** When it is snoozed: until when (ms), or null for «until something changes». */
  snoozedUntil: z.number().nullable().optional(),
})
export type WindowItem = z.output<typeof windowItemSchema>

/** A proposal of the Assistant that answers no item shown now (one the user asked for in the conversation). */
export const windowProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  prepare: prepareViewSchema.nullable(),
  createdAt: z.number(),
  rating: ratingSchema.nullable(),
})
export type WindowProposal = z.output<typeof windowProposalSchema>

/** Who did what a line of the journal tells: main by itself (no model), the Assistant, the user. */
export const JOURNAL_ACTORS = ['worfy', 'assistant', 'you'] as const

export const journalRowSchema = z.object({
  id: z.string(),
  at: z.number(),
  by: z.enum(JOURNAL_ACTORS),
  /** What was done, in words. */
  text: z.string(),
  outcome: z.enum(['done', 'refused', 'escalated']),
  /** The item that caused it: its id, its line, and whether it still waits (a click shows it). */
  cause: z.object({ itemId: z.string(), text: z.string(), open: z.boolean() }),
  duty: z.string().nullable(),
  rating: ratingSchema.nullable(),
})
export type JournalRow = z.output<typeof journalRowSchema>

/** Why a message of the Assistant came: the user wrote, or one of its wakes (urgent, a batch, the morning). */
export const MESSAGE_REASONS = ['user', 'urgent', 'batch', 'morning'] as const

export const conversationMessageSchema = z.object({
  id: z.string(),
  at: z.number(),
  who: z.enum(['you', 'assistant']),
  text: z.string(),
  /** `pending`: the Assistant has not answered yet; `failed`: it did not answer. */
  state: z.enum(['done', 'pending', 'failed']),
  reason: z.enum(MESSAGE_REASONS),
  rating: ratingSchema.nullable(),
})
export type ConversationMessage = z.output<typeof conversationMessageSchema>

/**
 * The summary: worfy's own count of the last SUMMARY_HOURS over every Project of this Machine, without the model, and the
 * Assistant's last morning message when it wrote one.
 */
export const summaryViewSchema = z.object({
  id: z.string(),
  since: z.number(),
  /** Items that came in the period. */
  came: z.number().int().nonnegative(),
  /** Actions of the closed list done by worfy or the Assistant in the period. */
  done: z.number().int().nonnegative(),
  /** Autopilot runs that stopped in the period. */
  stopped: z.number().int().nonnegative(),
  /** Items that wait for the user now. */
  waiting: z.number().int().nonnegative(),
  projects: z.array(z.object({ projectId: z.string().nullable(), name: z.string(), came: z.number(), waiting: z.number(), urgent: z.number() })),
  /** The items to take first: urgent first, then the oldest. */
  first: z.array(z.string()),
  morning: z.object({ at: z.number(), text: z.string() }).nullable(),
  rating: ratingSchema.nullable(),
})
export type SummaryView = z.output<typeof summaryViewSchema>

/** How many hours back the summary looks. */
export const SUMMARY_HOURS = 16

/**
 * What the Assistant spent (ticket 05): tokens today and this week, and its share of each Limits window, always an
 * estimate (worfy sees only the whole percentage of a window).
 */
export const usageViewSchema = z.object({
  today: z.number().nonnegative(),
  week: z.number().nonnegative(),
  /** Percent of the window, 0..100; null when the window is not known. */
  fiveHour: z.number().nonnegative().nullable(),
  sevenDay: z.number().nonnegative().nullable(),
  estimate: z.literal(true),
})
export type UsageView = z.output<typeof usageViewSchema>

/** The choices of Snooze: an hour, three hours, the next work hours, or until something changes on the item. */
export const SNOOZE_CHOICES = ['hour', 'three-hours', 'next-work-hours', 'change'] as const
export const snoozeChoiceSchema = z.enum(SNOOZE_CHOICES)
export type SnoozeChoice = z.output<typeof snoozeChoiceSchema>

export const assistantViewSchema = z.object({
  /** Whether the Assistant runs on this Machine: off, it neither wakes nor notifies, and the conversation waits. */
  on: z.boolean(),
  projects: z.number().int().nonnegative(),
  /** What waits now, urgent first, then the newest. */
  items: z.array(windowItemSchema),
  snoozed: z.array(windowItemSchema),
  /** Items the user's dislikes hide, with the rule that hides each. */
  hidden: z.array(z.object({ item: windowItemSchema, rule: z.object({ id: z.string(), text: z.string() }) })),
  proposals: z.array(windowProposalSchema),
  /** Newest first. */
  journal: z.array(journalRowSchema),
  /** Oldest first. */
  conversation: z.array(conversationMessageSchema),
  summary: summaryViewSchema,
  usage: usageViewSchema,
  /** The work hours now: inside them or not. */
  workHours: z.boolean(),
})
export type AssistantView = z.output<typeof assistantViewSchema>

/** The item kinds that are urgent by themselves: an Autopilot run that stopped (as the decision to wake reads them, ticket 06). */
const URGENT_KINDS: ReadonlySet<string> = new Set(['run-stopped'])

/** Urgent: a run that stopped, or a message an outside source's check marked urgent. */
export function isUrgentItem(item: Pick<AttentionItem, 'kind' | 'message'>): boolean {
  return URGENT_KINDS.has(item.kind) || item.message?.urgent === true
}

/** The source of an item in words. */
export const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  session: 'Session',
  'ticket-waits': 'Ticket',
  'pr-inbox': 'Pull requests',
  workflow: 'Workflow',
  autopilot: 'Autopilot',
  health: 'Health check',
  limits: 'Limits',
  ci: 'CI of the main branch',
  rule: 'Rule of the Project',
  slack: 'Slack',
  jira: 'Jira',
})

/** The title of a notification of the Assistant outside the window (spec, UI): never a Project's or a Session's name. */
export const ASSISTANT_NOTE_TITLE = 'worfy Assistant'
