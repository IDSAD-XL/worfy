// What the user picks for a Session under its input field (ticket 19): the model, the effort and
// the permission mode. main applies them to the live Session (src/main/agent/session.ts) and to
// every Claude Code process started for it later; the Orchestrator keeps them in worfy's data folder
// (src/main/agent/session-settings.ts) so a restart resumes with the same picks.
import { z } from 'zod'

/** The permission modes worfy offers, in the order the picker lists them; bypassPermissions is the default. */
export const PERMISSION_MODES = ['bypassPermissions', 'acceptEdits', 'default', 'plan'] as const
export const permissionModeSchema = z.enum(PERMISSION_MODES)
export type PermissionModeChoice = z.infer<typeof permissionModeSchema>

/** The effort levels the SDK takes (EffortLevel of SDK 0.3.289, ticket 06 question 6). */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const effortSchema = z.enum(EFFORT_LEVELS)
export type EffortChoice = z.infer<typeof effortSchema>

export const sessionSettingsSchema = z.object({
  /** A model id or alias for setModel(); null: Claude Code's default model. */
  model: z.string().min(1).nullable(),
  /**
   * The effort level worfy asked for; null: the model's default. Claude Code does not report the
   * level it applies (no `effort` in system/init, ticket 06), so this is what was asked, not a fact.
   */
  effort: effortSchema.nullable(),
  permissionMode: permissionModeSchema,
})
export type SessionSettings = z.output<typeof sessionSettingsSchema>

/** A change of some of the settings. */
export const settingsChangeSchema = sessionSettingsSchema.partial()
export type SettingsChange = z.output<typeof settingsChangeSchema>

export const DEFAULT_SETTINGS: SessionSettings = { model: null, effort: null, permissionMode: 'bypassPermissions' }

/**
 * Whether a Session may run on this model (worfy-daily ticket 07): sonnet or larger, so nothing of
 * the haiku family. Takes a model value or alias (`haiku`, `claude-haiku-4-5-20251001`) as well as
 * the name the SDK shows for it (`Haiku 4.5`).
 */
export function isSelectableModel(model: string): boolean {
  return !/haiku/i.test(model)
}

/**
 * The settings with a model a Session may no longer run on (a haiku picked by an older build)
 * replaced by the default model; its effort goes back to the default with it, as it does when the
 * user switches to a model whose efforts do not include the picked one.
 */
export function withSelectableModel(settings: SessionSettings): SessionSettings {
  return settings.model !== null && !isSelectableModel(settings.model) ? { ...settings, model: null, effort: null } : settings
}

/** One row of the model picker. */
export const modelOptionSchema = z.object({
  /** What setModel() takes; null for Claude Code's default model. */
  value: z.string().min(1).nullable(),
  displayName: z.string(),
  /** The effort levels the model takes; empty when it takes none. */
  efforts: z.array(effortSchema),
})
export type ModelOption = z.output<typeof modelOptionSchema>

/**
 * The settings fields of stored data (src/main/agent/session-settings.ts) that pass the schema, over the defaults: a
 * damaged field falls back to its default rather than losing the others.
 */
export function readSettings(value: unknown): SessionSettings {
  const read: SessionSettings = { ...DEFAULT_SETTINGS }
  if (typeof value !== 'object' || value === null) return read
  const record = value as Record<string, unknown>
  const model = sessionSettingsSchema.shape.model.safeParse(record.model)
  if (model.success) read.model = model.data
  const effort = sessionSettingsSchema.shape.effort.safeParse(record.effort)
  if (effort.success) read.effort = effort.data
  const mode = sessionSettingsSchema.shape.permissionMode.safeParse(record.permissionMode)
  if (mode.success) read.permissionMode = mode.data
  return read
}

export function sameSettings(a: SessionSettings, b: SessionSettings): boolean {
  return a.model === b.model && a.effort === b.effort && a.permissionMode === b.permissionMode
}
