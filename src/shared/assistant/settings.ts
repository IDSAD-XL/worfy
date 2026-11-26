// The Assistant's own settings of this Machine (worfy-assistant tickets 15 and 25; owner's decisions 7, 10 and 17; story
// 34): whether it runs at all, since when, the daily limit of its automatic wakes and how it may notify. They are app
// settings of this Machine (`assistant` in src/shared/settings/app-settings.ts), kept in app-settings.json and changed
// through the `appSettings` channels, which are `local`: a Linked machine neither sees nor changes them. The work hours
// and the checks are `assistantSchedule` (src/shared/assistant/schedule/settings.ts).
//
// - `on` — off while not chosen, for a new user and for one who updated worfy alike (decision 10). Turned on, only the
//   internal duties work: every check of an outside source stays off until it is turned on by itself
//   (ASSISTANT_CHECK_DEFAULTS). Turned off, nothing of the Assistant runs: no wake, no closed list, no check of a source.
// - `onSince` — when the person turned it on (ms since the epoch), for «On since …» (ticket 25). Only main writes it: the
//   store stamps it when `on` turns true and drops it when `on` turns false (assistantAfter); a patch cannot carry it.
//   An Assistant turned on before ticket 25 has none.
// - `dailyWakeLimit` — the automatic wakes a local day allows; ASSISTANT_DAILY_WAKE_LIMIT while not chosen.
// - `inWindow` — the speech card next to the Assistant's icon (ticket 25): `batched` (urgent and batched, the default),
//   `urgent` (urgent only) or `none` (no card: the number on the icon and the list stay).
// - `systemNotices` — the system notification «worfy Assistant» (ticket 14) while worfy is not in front; on while not
//   chosen. On, it is what decision 17 says: urgent items only, only in work hours. Off, none at all.
//
// Each field counts only once chosen, as in `assistantSchedule`; in the file each field is read on its own, and one the
// schema refuses reads as not chosen.
import { z } from 'zod'
import { ASSISTANT_DAILY_WAKE_LIMIT } from './budget'

/** The bounds of the daily limit of automatic wakes. */
export const DAILY_WAKE_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 200 })

export const dailyWakeLimitSchema = z.number().int().min(DAILY_WAKE_LIMIT_BOUNDS.min).max(DAILY_WAKE_LIMIT_BOUNDS.max)

/** What the speech card in the window tells of: urgent and batched items, urgent ones only, or none. */
export const IN_WINDOW_NOTICES = ['batched', 'urgent', 'none'] as const
export const inWindowSchema = z.enum(IN_WINDOW_NOTICES)
export type InWindowNotices = z.output<typeof inWindowSchema>

/** What the person chose; also the form of a change (`appSettings.set`): a field left out stays as it is. */
export const assistantChoiceSchema = z.object({
  on: z.boolean().optional(),
  dailyWakeLimit: dailyWakeLimitSchema.optional(),
  inWindow: inWindowSchema.optional(),
  systemNotices: z.boolean().optional(),
})
export type AssistantChoice = z.output<typeof assistantChoiceSchema>

/** What the store keeps: the choice and the time main stamped when the person turned the Assistant on. */
export const assistantStateSchema = assistantChoiceSchema.extend({ onSince: z.number().int().nonnegative().optional() })
export type AssistantState = z.output<typeof assistantStateSchema>

/** What the settings in force are read from: the app settings, or any object with the field. */
export interface AssistantSettings {
  assistant?: AssistantState | undefined
}

/** `assistant` as app-settings.json is read: field by field, a refused one reads as not chosen. */
export const assistantFileSchema = z
  .object({
    on: assistantStateSchema.shape.on.catch(undefined),
    onSince: assistantStateSchema.shape.onSince.catch(undefined),
    dailyWakeLimit: assistantStateSchema.shape.dailyWakeLimit.catch(undefined),
    inWindow: assistantStateSchema.shape.inWindow.catch(undefined),
    systemNotices: assistantStateSchema.shape.systemNotices.catch(undefined),
  })
  .optional()
  .catch(undefined)

/** A state in the form the store keeps: fields in a fixed order, nothing not chosen; undefined when nothing is. */
export function tidyAssistant(state: AssistantState | undefined): AssistantState | undefined {
  if (state === undefined) return undefined
  const tidy: AssistantState = {
    ...(state.on === undefined ? {} : { on: state.on }),
    // A time without the switch on means nothing: «On since …» is of a switch that is on.
    ...(state.onSince === undefined || state.on !== true ? {} : { onSince: state.onSince }),
    ...(state.dailyWakeLimit === undefined ? {} : { dailyWakeLimit: state.dailyWakeLimit }),
    ...(state.inWindow === undefined ? {} : { inWindow: state.inWindow }),
    ...(state.systemNotices === undefined ? {} : { systemNotices: state.systemNotices }),
  }
  return Object.keys(tidy).length === 0 ? undefined : tidy
}

/**
 * The state after `patch`: each field the patch names, the others as they were. `now` is the time the switch turns on:
 * `onSince` is stamped when `on` goes from off to on, kept while it stays on, and dropped when it goes off. A patch's own
 * `onSince` is never taken — the patch schema has no such field, and this reads only the switch.
 */
export function assistantAfter(current: AssistantState | undefined, patch: AssistantChoice | undefined, now: number): AssistantState | undefined {
  const on = patch?.on ?? current?.on
  const turnedOn = on === true && current?.on !== true
  return tidyAssistant({
    on,
    onSince: turnedOn ? now : current?.onSince,
    dailyWakeLimit: patch?.dailyWakeLimit ?? current?.dailyWakeLimit,
    inWindow: patch?.inWindow ?? current?.inWindow,
    systemNotices: patch?.systemNotices ?? current?.systemNotices,
  })
}

export function sameAssistant(a: AssistantState | undefined, b: AssistantState | undefined): boolean {
  return a?.on === b?.on && a?.onSince === b?.onSince && a?.dailyWakeLimit === b?.dailyWakeLimit && a?.inWindow === b?.inWindow && a?.systemNotices === b?.systemNotices
}

/** The `assistant` field of the app settings: absent while nothing is chosen. */
export function assistantField(state: AssistantState | undefined): { assistant?: AssistantState } {
  const tidy = tidyAssistant(state)
  return tidy === undefined ? {} : { assistant: tidy }
}

/** Whether the person turned the Assistant on; off while not chosen (decision 10). */
export function assistantOn(settings: AssistantSettings): boolean {
  return settings.assistant?.on ?? false
}

/** When the person turned the Assistant on; null while it is off, or when it was turned on before the time was kept. */
export function assistantOnSince(settings: AssistantSettings): number | null {
  return settings.assistant?.on === true ? (settings.assistant.onSince ?? null) : null
}

/** The daily limit of automatic wakes in force. */
export function dailyWakeLimitOf(settings: AssistantSettings): number {
  return settings.assistant?.dailyWakeLimit ?? ASSISTANT_DAILY_WAKE_LIMIT
}

/** What the speech card tells of: urgent and batched items while not chosen. */
export function inWindowOf(settings: AssistantSettings): InWindowNotices {
  return settings.assistant?.inWindow ?? 'batched'
}

/** Whether the system notification «worfy Assistant» may show: on while not chosen. */
export function systemNoticesOf(settings: AssistantSettings): boolean {
  return settings.assistant?.systemNotices ?? true
}
