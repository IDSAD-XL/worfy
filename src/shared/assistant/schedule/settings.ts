// The settings of the Assistant's checks of sources (worfy-assistant ticket 04; owner's decision 5 of the
// spec): the work hours, and for each kind of check whether it is on, its interval and whether it sleeps
// outside work hours. They are app settings of this Machine (`assistantSchedule` in
// src/shared/settings/app-settings.ts): kept in app-settings.json, changed through the `appSettings`
// channels, which are `local`, so a Linked machine neither sees nor changes them.
//
// Each field counts only once chosen, as in `browserSleep`: a field not chosen takes its default, so a
// later change of a default reaches everyone who never chose. A change names only what it changes: other
// kinds and other fields stay. Work hours given replace the old ones whole. In the file each field is read
// on its own: one the schema refuses (a file edited by hand, a newer version's value) reads as not chosen.
import { z } from 'zod'
import { DEFAULT_WORK_HOURS, workHoursSchema, type WorkHours } from './work-hours'

/** The outside sources whose messages the Assistant reads; each has its duty (`source:<kind>`, src/shared/assistant/duties.ts). */
export const SOURCE_CHECK_KINDS = ['slack', 'jira'] as const
export type SourceCheckKind = (typeof SOURCE_CHECK_KINDS)[number]

/**
 * The kinds of checks of sources, in the order Settings shows them. A new source adds its kind here. `main-ci` reads
 * the CI of each Project's main branch for the duty «CI of the main branch is red» (worfy-assistant ticket 21).
 */
export const CHECK_KINDS = [...SOURCE_CHECK_KINDS, 'main-ci'] as const
export const checkKindSchema = z.enum(CHECK_KINDS)
export type CheckKind = z.output<typeof checkKindSchema>

/** The bounds of a check's interval, in whole minutes: from 5 minutes to a day. */
export const CHECK_INTERVAL_BOUNDS = Object.freeze({ min: 5, max: 24 * 60 })

export const checkIntervalSchema = z.number().int().min(CHECK_INTERVAL_BOUNDS.min).max(CHECK_INTERVAL_BOUNDS.max)

/** What the person chose for one kind of check: each field only once chosen. */
export const checkChoiceSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: checkIntervalSchema.optional(),
  sleepOutsideWorkHours: z.boolean().optional(),
})
export type CheckChoice = z.output<typeof checkChoiceSchema>

/** The settings of a kind of check in force. */
export type CheckSettings = { [K in keyof CheckChoice]-?: NonNullable<CheckChoice[K]> }

/**
 * The checks of a person who chose nothing. Slack about every 10 minutes and Jira once an hour (owner's
 * decision 5); each off until the person turns its source on (owner's decision 10: every outside source is
 * turned on on its own); both asleep outside work hours (decision 5: at night some checks sleep). The CI of the
 * main branch — decided without the owner (ticket 21, result section): every 10 minutes, so with the duty's
 * threshold of 30 minutes the item comes 30 to 40 minutes after the branch went red; off until turned on, as
 * GitHub is a source outside worfy; awake at night, as a red branch then holds up the agents working overnight.
 */
export const ASSISTANT_CHECK_DEFAULTS: Readonly<Record<CheckKind, Readonly<CheckSettings>>> = Object.freeze({
  slack: Object.freeze({ enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: true }),
  jira: Object.freeze({ enabled: false, intervalMinutes: 60, sleepOutsideWorkHours: true }),
  'main-ci': Object.freeze({ enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: false }),
})

/** The choices for the kinds of checks: a kind not chosen is absent. */
export const checkChoicesSchema = z.object({ slack: checkChoiceSchema.optional(), jira: checkChoiceSchema.optional(), 'main-ci': checkChoiceSchema.optional() }).strict()

/** What the person chose for the Assistant's checks; also the form of a change (`appSettings.set`). */
export const assistantScheduleChoiceSchema = z.object({ workHours: workHoursSchema.optional(), checks: checkChoicesSchema.optional() })
export type AssistantScheduleChoice = z.output<typeof assistantScheduleChoiceSchema>

/** What the settings in force are read from: the app settings, or any object with the field. */
export interface AssistantScheduleSettings {
  assistantSchedule?: AssistantScheduleChoice | undefined
}

const lenientCheck = z
  .object({
    enabled: checkChoiceSchema.shape.enabled.catch(undefined),
    intervalMinutes: checkChoiceSchema.shape.intervalMinutes.catch(undefined),
    sleepOutsideWorkHours: checkChoiceSchema.shape.sleepOutsideWorkHours.catch(undefined),
  })
  .optional()
  .catch(undefined)

/** `assistantSchedule` as app-settings.json is read: field by field, a refused one reads as not chosen. */
export const assistantScheduleFileSchema = z
  .object({
    workHours: workHoursSchema.optional().catch(undefined),
    checks: z.object({ slack: lenientCheck, jira: lenientCheck, 'main-ci': lenientCheck }).optional().catch(undefined),
  })
  .optional()
  .catch(undefined)

/** A check choice without the fields not chosen; undefined when none is. */
function tidyCheck(choice: CheckChoice | undefined): CheckChoice | undefined {
  if (choice === undefined) return undefined
  const kept: CheckChoice = {
    ...(choice.enabled === undefined ? {} : { enabled: choice.enabled }),
    ...(choice.intervalMinutes === undefined ? {} : { intervalMinutes: choice.intervalMinutes }),
    ...(choice.sleepOutsideWorkHours === undefined ? {} : { sleepOutsideWorkHours: choice.sleepOutsideWorkHours }),
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

function tidyWorkHours(hours: WorkHours): WorkHours {
  return { days: [...hours.days], windows: hours.windows.map((window) => ({ from: window.from, to: window.to })), ...(hours.timeZone === undefined ? {} : { timeZone: hours.timeZone }) }
}

/** A choice in the form the store keeps: fields in a fixed order, nothing not chosen; undefined when nothing is. */
export function tidyAssistantSchedule(choice: AssistantScheduleChoice | undefined): AssistantScheduleChoice | undefined {
  if (choice === undefined) return undefined
  const checks: NonNullable<AssistantScheduleChoice['checks']> = {}
  for (const kind of CHECK_KINDS) {
    const kept = tidyCheck(choice.checks?.[kind])
    if (kept !== undefined) checks[kind] = kept
  }
  const tidy: AssistantScheduleChoice = {
    ...(choice.workHours === undefined ? {} : { workHours: tidyWorkHours(choice.workHours) }),
    ...(Object.keys(checks).length === 0 ? {} : { checks }),
  }
  return Object.keys(tidy).length === 0 ? undefined : tidy
}

/** The choice after `patch`: each field the patch names, the others as they were. */
export function assistantScheduleAfter(current: AssistantScheduleChoice | undefined, patch: AssistantScheduleChoice | undefined): AssistantScheduleChoice | undefined {
  const checks: NonNullable<AssistantScheduleChoice['checks']> = {}
  for (const kind of CHECK_KINDS) {
    const before = current?.checks?.[kind]
    const change = patch?.checks?.[kind]
    if (before !== undefined || change !== undefined) checks[kind] = { ...before, ...tidyCheck(change) }
  }
  return tidyAssistantSchedule({ workHours: patch?.workHours ?? current?.workHours, checks })
}

/** Whether two choices are the same, whatever the order of their keys. */
export function sameAssistantSchedule(a: AssistantScheduleChoice | undefined, b: AssistantScheduleChoice | undefined): boolean {
  return JSON.stringify(tidyAssistantSchedule(a)) === JSON.stringify(tidyAssistantSchedule(b))
}

/** The `assistantSchedule` field of the app settings: absent while nothing is chosen. */
export function assistantScheduleField(choice: AssistantScheduleChoice | undefined): { assistantSchedule?: AssistantScheduleChoice } {
  const tidy = tidyAssistantSchedule(choice)
  return tidy === undefined ? {} : { assistantSchedule: tidy }
}

/** The work hours in force: the person's, else Monday to Friday 09:00–18:00 of the machine zone. */
export function workHoursOf(settings: AssistantScheduleSettings): WorkHours {
  return settings.assistantSchedule?.workHours ?? DEFAULT_WORK_HOURS
}

/** The settings of kind `kind` in force: each field the person chose, else its default. */
export function checkSettingsOf(settings: AssistantScheduleSettings, kind: CheckKind): CheckSettings {
  const chosen = settings.assistantSchedule?.checks?.[kind]
  const defaults = ASSISTANT_CHECK_DEFAULTS[kind]
  return {
    enabled: chosen?.enabled ?? defaults.enabled,
    intervalMinutes: chosen?.intervalMinutes ?? defaults.intervalMinutes,
    sleepOutsideWorkHours: chosen?.sleepOutsideWorkHours ?? defaults.sleepOutsideWorkHours,
  }
}
