// The Assistant's own settings of this Machine (worfy-assistant ticket 15; owner's decisions 7 and 10; story 34): whether
// it runs at all, and the daily limit of its automatic wakes. They are app settings of this Machine (`assistant` in
// src/shared/settings/app-settings.ts), kept in app-settings.json and changed through the `appSettings` channels, which
// are `local`: a Linked machine neither sees nor changes them. The work hours and the checks are `assistantSchedule`
// (src/shared/assistant/schedule/settings.ts).
//
// - `on` — off while not chosen, for a new user and for one who updated worfy alike (decision 10). Turned on, only the
//   internal duties work: every check of an outside source stays off until it is turned on by itself
//   (ASSISTANT_CHECK_DEFAULTS). Turned off, nothing of the Assistant runs: no wake, no closed list, no check of a source.
// - `dailyWakeLimit` — the automatic wakes a local day allows; ASSISTANT_DAILY_WAKE_LIMIT while not chosen.
//
// Each field counts only once chosen, as in `assistantSchedule`; in the file each field is read on its own, and one the
// schema refuses reads as not chosen.
import { z } from 'zod'
import { ASSISTANT_DAILY_WAKE_LIMIT } from './budget'

/** The bounds of the daily limit of automatic wakes. */
export const DAILY_WAKE_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 200 })

export const dailyWakeLimitSchema = z.number().int().min(DAILY_WAKE_LIMIT_BOUNDS.min).max(DAILY_WAKE_LIMIT_BOUNDS.max)

/** What the person chose; also the form of a change (`appSettings.set`): a field left out stays as it is. */
export const assistantChoiceSchema = z.object({ on: z.boolean().optional(), dailyWakeLimit: dailyWakeLimitSchema.optional() })
export type AssistantChoice = z.output<typeof assistantChoiceSchema>

/** What the settings in force are read from: the app settings, or any object with the field. */
export interface AssistantSettings {
  assistant?: AssistantChoice | undefined
}

/** `assistant` as app-settings.json is read: field by field, a refused one reads as not chosen. */
export const assistantFileSchema = z
  .object({ on: assistantChoiceSchema.shape.on.catch(undefined), dailyWakeLimit: assistantChoiceSchema.shape.dailyWakeLimit.catch(undefined) })
  .optional()
  .catch(undefined)

/** A choice in the form the store keeps: fields in a fixed order, nothing not chosen; undefined when nothing is. */
export function tidyAssistant(choice: AssistantChoice | undefined): AssistantChoice | undefined {
  if (choice === undefined) return undefined
  const tidy: AssistantChoice = {
    ...(choice.on === undefined ? {} : { on: choice.on }),
    ...(choice.dailyWakeLimit === undefined ? {} : { dailyWakeLimit: choice.dailyWakeLimit }),
  }
  return Object.keys(tidy).length === 0 ? undefined : tidy
}

/** The choice after `patch`: each field the patch names, the others as they were. */
export function assistantAfter(current: AssistantChoice | undefined, patch: AssistantChoice | undefined): AssistantChoice | undefined {
  return tidyAssistant({ on: patch?.on ?? current?.on, dailyWakeLimit: patch?.dailyWakeLimit ?? current?.dailyWakeLimit })
}

export function sameAssistant(a: AssistantChoice | undefined, b: AssistantChoice | undefined): boolean {
  return a?.on === b?.on && a?.dailyWakeLimit === b?.dailyWakeLimit
}

/** The `assistant` field of the app settings: absent while nothing is chosen. */
export function assistantField(choice: AssistantChoice | undefined): { assistant?: AssistantChoice } {
  const tidy = tidyAssistant(choice)
  return tidy === undefined ? {} : { assistant: tidy }
}

/** Whether the person turned the Assistant on; off while not chosen (decision 10). */
export function assistantOn(settings: AssistantSettings): boolean {
  return settings.assistant?.on ?? false
}

/** The daily limit of automatic wakes in force. */
export function dailyWakeLimitOf(settings: AssistantSettings): number {
  return settings.assistant?.dailyWakeLimit ?? ASSISTANT_DAILY_WAKE_LIMIT
}
