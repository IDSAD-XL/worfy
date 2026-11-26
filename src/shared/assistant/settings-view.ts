// What Settings → Assistant shows besides the app settings (worfy-assistant tickets 15 and 25; stories 14, 15 and 17–20,
// 34, 35): whether the Assistant runs now; each duty with the mode of each action, its Projects, its counters and its
// pause; the rules its dislikes wrote; each check of a source with its failures in a row (ticket 22) and its next time;
// the automatic wakes of today; and the details of its usage — tokens by source, by wake and for the conversation, for
// the day and the week, and its share of each Limits window, always an estimate. main builds it
// (src/main/assistant/settings/panel.ts) from the duties, the scheduler of checks and the usage ledger; the section draws
// it (src/renderer/settings/AssistantSection.tsx). The work hours, the checks' own switches and intervals, the switch of
// the Assistant and the daily limit are app settings: the section reads them there.
import { z } from 'zod'
import { DUTY_ACTIONS, dutyActionModeSchema, dutyCountersSchema } from './duties'
import { checkKindSchema } from './schedule/settings'

export const settingsActionSchema = z.object({
  action: z.enum(DUTY_ACTIONS),
  mode: dutyActionModeSchema,
  /** The modes this action may have (DUTY_ACTION_ALLOWED_MODES): the others are not offered. */
  allowed: z.array(dutyActionModeSchema),
})

export const settingsDutySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The Project of a rule of a Project; null for a built-in duty. */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** The sources its trigger covers, in words. */
  sources: z.array(z.string()),
  /**
   * The Projects of this Machine whose items it shows (ticket 25): `all`, or their ids. Null when its scope is not by
   * Project — a rule of a Project, the morning summary, a check of an outside source — and the section offers no choice.
   */
  projects: z.union([z.literal('all'), z.array(z.string())]).nullable(),
  enabled: z.boolean(),
  thresholdMinutes: z.number().nullable(),
  actions: z.array(settingsActionSchema),
  counters: dutyCountersSchema,
  paused: z.object({ at: z.number(), by: z.enum(['ignored', 'disliked']) }).nullable(),
})
export type SettingsDuty = z.output<typeof settingsDutySchema>

export const settingsCheckSchema = z.object({
  kind: checkKindSchema,
  /** Runs that failed in a row (ticket 22); 0 when the last one succeeded or none ran. */
  failures: z.number().int().nonnegative(),
  /** When it goes next, in ms; null while it is off, or the Assistant is. */
  nextAt: z.number().nullable(),
  running: z.boolean(),
})
export type SettingsCheck = z.output<typeof settingsCheckSchema>

/**
 * Why a Check now started nothing (CheckScheduler.whyNotNow): the check does not run on this Mac (its duty or source is
 * not there), the checks are stopped or the Mac sleeps, the Assistant or the check is turned off, or it runs already.
 */
export const CHECK_NOW_REFUSALS = ['not-registered', 'stopped', 'asleep', 'assistant-off', 'check-off', 'running'] as const
export const checkNowRefusalSchema = z.enum(CHECK_NOW_REFUSALS)
export type CheckNowRefusal = z.output<typeof checkNowRefusalSchema>

export const tokenCountSchema = z.object({ tokens: z.number().nonnegative(), calls: z.number().int().nonnegative() })
export type TokenCount = z.output<typeof tokenCountSchema>

export const usagePeriodViewSchema = z.object({
  from: z.number(),
  total: tokenCountSchema,
  /** The checks of sources, by source. */
  sources: z.array(tokenCountSchema.extend({ source: z.string() })),
  wakes: z.object({
    count: z.number().int().nonnegative(),
    total: tokenCountSchema,
    /** Each automatic wake of the period, newest first. */
    byWake: z.array(z.object({ id: z.string(), at: z.number(), urgent: z.boolean(), tokens: z.number().nonnegative() })),
  }),
  conversation: tokenCountSchema,
})
export type UsagePeriodView = z.output<typeof usagePeriodViewSchema>

export const assistantSettingsViewSchema = z.object({
  /** Whether the Assistant runs now: the switch may be on while its start did not take. */
  running: z.boolean(),
  duties: z.array(settingsDutySchema),
  /** The Projects of this Machine a duty may cover (ticket 25); a Linked machine's are not among them. */
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  /** How many ignored proposals or dislikes in a row pause a duty. */
  pauseAfter: z.number().int().positive(),
  /** The rules the user's dislikes wrote, oldest first. */
  rules: z.array(z.object({ id: z.string(), text: z.string(), duty: z.string(), createdAt: z.number() })),
  checks: z.array(settingsCheckSchema),
  /** The automatic wakes since the local midnight. */
  wakesToday: z.number().int().nonnegative(),
  usage: z.object({
    day: usagePeriodViewSchema,
    week: usagePeriodViewSchema,
    /** The Assistant's share of each Limits window in force, in percent: an estimate, never a measure. */
    shares: z.array(z.object({ window: z.string(), utilization: z.number().nonnegative(), share: z.number().nonnegative() })),
    estimate: z.literal(true),
  }),
})
export type AssistantSettingsView = z.output<typeof assistantSettingsViewSchema>
