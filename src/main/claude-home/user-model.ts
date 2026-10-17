// The model and effort the user set for Claude Code: the `model` and `effortLevel` fields of
// <claudeHome>/settings.json (worfy-daily tickets 07 and 23). A Session that names no model starts on
// the user's model, as the SDK takes it from there; session.ts reads it to keep that model at sonnet
// or larger, and to go back to it on "Default" (setModel with no model would give Claude Code's own
// default instead). The effort is passed by session.ts itself: Claude Code takes a top-level
// `effortLevel` of the user's settings only for the models it lists as older ones, so on a newer
// model a Session that names no effort would run at that model's default. The `autoCompactWindow`
// there (worfy-polish ticket 29) wins over worfy's own default window: app-registry.ts reads it at
// every start of a Session's Claude Code, Settings → Sessions names it. Nothing here writes
// anywhere (ADR 0005).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { effortSchema, type EffortChoice } from '../../shared/agent/settings'
import { claudeHome } from '../storage/paths'

/** Reads the user's model; null when it cannot be told. */
export type UserModelReader = () => string | null

/** Reads the user's effort; null when it cannot be told. */
export type UserEffortReader = () => EffortChoice | null

/** The fields of settings.json, or null when it is missing, unreadable, not JSON or not an object. */
function readUserSettings(home: string): Record<string, unknown> | null {
  let text: string
  try {
    text = readFileSync(join(home, 'settings.json'), 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
}

/** The user's model, or null when settings.json is missing, unreadable, not JSON, or has no model. */
export function readUserModel(home: string = claudeHome()): string | null {
  const model = readUserSettings(home)?.model
  return typeof model === 'string' && model.trim() !== '' ? model : null
}

/** The user's effortLevel, or null when settings.json has none that worfy knows. */
export function readUserEffort(home: string = claudeHome()): EffortChoice | null {
  const parsed = effortSchema.safeParse(readUserSettings(home)?.effortLevel)
  return parsed.success ? parsed.data : null
}

/**
 * The user's autocompact window in tokens: a whole positive `autoCompactWindow` of settings.json;
 * null for anything else ("auto", a string, no field, no file). Claude Code's per-model
 * `modelSettings` windows are not read.
 */
export function readUserAutoCompactWindow(home: string = claudeHome()): number | null {
  const window = readUserSettings(home)?.autoCompactWindow
  return typeof window === 'number' && Number.isSafeInteger(window) && window > 0 ? window : null
}
