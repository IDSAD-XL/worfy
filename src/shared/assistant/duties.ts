// The duties of the Assistant (worfy-assistant ticket 07; spec, implementation decisions, duties; owner's decisions 3, 8
// and 14): what raises an item of the attention core, over which Projects and sources, the mode of each of its actions,
// its counters and its pause. The built-in duties are general only: they lean on what any Project has — a Session, a
// Run, the CI of the main branch, a PR. The process of one Project is a rule in that Project's settings
// (projectRuleSchema), never a duty of the code. main keeps the duties (src/main/assistant/duties/); the window and the
// Assistant read them later (tickets 09, 14 and 15).
import { z } from 'zod'
import { attentionSourceSchema, type AttentionItem } from './attention'
import { SOURCE_CHECK_KINDS, type SourceCheckKind } from './schedule/settings'

/**
 * The mode of an action of a duty (story 15): `self` — the Assistant does it and writes the journal line;
 * `pre-approved` — it does it only within a «yes» the user gave in advance; `ask` — it asks first; `hand-over` — it
 * gives the item to the user and does nothing.
 */
export const DUTY_ACTION_MODES = ['self', 'pre-approved', 'ask', 'hand-over'] as const
export const dutyActionModeSchema = z.enum(DUTY_ACTION_MODES)
export type DutyActionMode = z.infer<typeof dutyActionModeSchema>

/**
 * The actions a duty may have. `wake-orchestrator` and `continue-session` are the closed list of main (ticket 08);
 * `fix-session` proposes a Session that fixes the red CI of the main branch; `open` opens the item's subject;
 * `summary` writes the morning summary.
 */
export const DUTY_ACTIONS = ['open', 'wake-orchestrator', 'continue-session', 'fix-session', 'summary'] as const
export type DutyAction = (typeof DUTY_ACTIONS)[number]

/** The counters of a duty (story 19). */
export const DUTY_COUNTERS = ['shown', 'accepted', 'declined', 'ignored', 'liked', 'disliked'] as const
export type DutyCounter = (typeof DUTY_COUNTERS)[number]
export const dutyCountersSchema = z.object(Object.fromEntries(DUTY_COUNTERS.map((name) => [name, z.number().int().nonnegative()])) as Record<DutyCounter, z.ZodNumber>)
export type DutyCounters = Record<DutyCounter, number>

/**
 * How many ignored proposals or dislikes of a duty in a row pause it, unless the user chose another number: 5.
 * Decided without the owner (ticket 07, result section).
 */
export const DEFAULT_PAUSE_AFTER = 5

/** What starts a rule of a Project: a background task of one of its Sessions whose description holds `task` ended, or an item. */
export const projectRuleWhenSchema = z.union([
  z.object({ task: z.string().min(1) }).strict(),
  z.object({ item: z.object({ source: attentionSourceSchema.optional(), kind: z.string().min(1).optional(), text: z.string().min(1).optional() }).strict() }).strict(),
])
export type ProjectRuleWhen = z.infer<typeof projectRuleWhenSchema>

/**
 * A rule of a Project (story 36), kept in its settings (`assistantRules`): after `when`, nothing on the same subject
 * for `quietMinutes` — the Session whose task ended, the subject of the item — raises an item with `title` as its text.
 * «land finished, and the Orchestrator sleeps» is `{ when: { task: 'land' }, quietMinutes: 10 }`. Texts compare
 * without case.
 */
export const projectRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  title: z.string().min(1).max(200),
  when: projectRuleWhenSchema,
  quietMinutes: z.number().int().min(1).max(24 * 60),
  /** Absent or true: the rule acts. */
  enabled: z.boolean().optional(),
})
export type ProjectRule = z.infer<typeof projectRuleSchema>

/**
 * A rule the Assistant drew from a dislike (story 17): the items of `duty` of this source and kind in this Project are
 * no longer shown. The user sees it by its `text` and deletes it (tickets 14 and 15).
 */
export const memoryRuleSchema = z.object({
  id: z.string().min(1),
  duty: z.string().min(1),
  projectId: z.string().nullable(),
  source: z.string(),
  kind: z.string(),
  text: z.string(),
  createdAt: z.number(),
  /** The item whose dislike made it. */
  from: z.string(),
})
export type MemoryRule = z.infer<typeof memoryRuleSchema>

/** What raises the items of a duty. */
export type DutyTrigger =
  /** Items of these sources; of these kinds only, when `kinds` is given. */
  | { kind: 'items'; match: readonly { source: string; kinds?: readonly string[] }[] }
  /** The morning: the summary of the night (the waking is ticket 06). */
  | { kind: 'morning' }
  /** A rule of a Project. */
  | { kind: 'rule'; when: ProjectRuleWhen; quietMinutes: number }

/** A duty as the code defines it, before the user's choices. */
export interface DutyDefinition {
  id: string
  title: string
  trigger: DutyTrigger
  /** Its actions, each with its mode by default. */
  actions: Readonly<Partial<Record<DutyAction, DutyActionMode>>>
  /**
   * «Work stands» and «waits for the user»: how long a Session stays silent or waits for an answer before it is shown;
   * «CI of the main branch is red»: how long the branch stays red. The user changes it (ticket 15).
   */
  thresholdMinutes?: number
}

export const sourceDutyId = (kind: SourceCheckKind): string => `source:${kind}`
export const projectRuleDutyId = (projectId: string, ruleId: string): string => `rule:${projectId}/${ruleId}`

/**
 * The built-in duties. Thresholds by default — decided without the owner (ticket 07, result section): a Session silent
 * or waiting for an answer 15 minutes (the measure of the attention core, SESSION_WAIT_MS), the main branch red 30
 * minutes. A run of a Session, Autopilot or the Limits that stopped is work that stands; what asks the user — a
 * question, a permission, a Ticket, a PR, a Health check row — waits for them.
 */
export const BUILTIN_DUTIES: readonly DutyDefinition[] = Object.freeze([
  {
    id: 'work-stalled',
    title: 'Work stands',
    trigger: {
      kind: 'items',
      match: [{ source: 'session', kinds: ['quiet', 'waiting', 'error'] }, { source: 'autopilot' }, { source: 'workflow' }, { source: 'limits' }],
    },
    actions: { open: 'hand-over', 'wake-orchestrator': 'ask', 'continue-session': 'ask' },
    thresholdMinutes: 15,
  },
  {
    id: 'main-ci-red',
    title: 'CI of the main branch is red',
    trigger: { kind: 'items', match: [{ source: 'ci' }] },
    actions: { 'fix-session': 'ask', open: 'hand-over' },
    thresholdMinutes: 30,
  },
  {
    id: 'waits-for-user',
    title: 'Waits for you',
    trigger: { kind: 'items', match: [{ source: 'session', kinds: ['question', 'permission'] }, { source: 'ticket-waits' }, { source: 'pr-inbox' }, { source: 'health' }] },
    actions: { open: 'hand-over' },
    thresholdMinutes: 15,
  },
  { id: 'morning-summary', title: 'Morning summary', trigger: { kind: 'morning' }, actions: { summary: 'self' } },
  ...SOURCE_CHECK_KINDS.map((kind): DutyDefinition => ({ id: sourceDutyId(kind), title: `${kind[0]!.toUpperCase()}${kind.slice(1)}`, trigger: { kind: 'items', match: [{ source: kind }] }, actions: { open: 'hand-over' } })),
])

/** The sources a trigger covers. */
export function triggerSources(trigger: DutyTrigger): string[] {
  if (trigger.kind === 'items') return trigger.match.map((each) => each.source)
  if (trigger.kind === 'rule') return 'task' in trigger.when ? ['session'] : [trigger.when.item.source ?? 'any']
  return []
}

/** A duty with the user's choices, its counters and its pause, as main shows it. */
export interface DutyStatus {
  id: string
  title: string
  /** The Project of a rule of a Project; null for a built-in duty. */
  projectId: string | null
  trigger: DutyTrigger
  scope: { projects: 'all' | readonly string[]; sources: readonly string[] }
  modes: Partial<Record<DutyAction, DutyActionMode>>
  thresholdMinutes: number | null
  enabled: boolean
  counters: DutyCounters
  /** Since when the duty is paused, and by what run; null while it is not. */
  paused: { at: number; by: 'ignored' | 'disliked' } | null
}

/** One action an item proposes, its mode and the exact text main gives it. */
export interface DutyProposal {
  action: DutyAction
  mode: DutyActionMode
  text: string
}

export interface ShownItem {
  item: AttentionItem
  duty: string
  proposals: DutyProposal[]
}

/** What the duties show now, and the state of each. */
export interface DutyLook {
  duties: DutyStatus[]
  shown: ShownItem[]
}
