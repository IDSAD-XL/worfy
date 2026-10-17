// The model picker's rows and how a settings change is merged into a Session's settings (session.ts).
import { EFFORT_LEVELS, isSelectableModel, type EffortChoice, type ModelOption, type SessionSettings, type SettingsChange } from '../../../shared/agent/settings'
import type { ModelInfoLike } from './types'

/** The row of the SDK's default model. */
const DEFAULT_MODEL_VALUE = 'default'

const isEffort = (level: string): level is EffortChoice => (EFFORT_LEVELS as readonly string[]).includes(level)

/** What a Session that names no model is started on when the user's own model is a haiku. */
export const USER_MODEL_FALLBACK = 'sonnet'

/** supportedModels() rows as the model picker lists them; models below sonnet are left out. */
export function modelOptions(models: readonly ModelInfoLike[]): ModelOption[] {
  const selectable = models.filter((model) => isSelectableModel(model.value) && isSelectableModel(model.displayName ?? model.value))
  return selectable.map((model) => ({
    value: model.value === DEFAULT_MODEL_VALUE ? null : model.value,
    displayName: model.displayName ?? model.value,
    efforts: model.supportsEffort === false ? [] : (model.supportedEffortLevels ?? []).filter(isEffort),
  }))
}

export function mergeSettings(settings: SessionSettings, change: SettingsChange): SessionSettings {
  return {
    model: change.model !== undefined ? change.model : settings.model,
    effort: change.effort !== undefined ? change.effort : settings.effort,
    permissionMode: change.permissionMode ?? settings.permissionMode,
  }
}
