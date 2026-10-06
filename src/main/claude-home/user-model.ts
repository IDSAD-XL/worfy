// The model the user set for Claude Code: the `model` field of <claudeHome>/settings.json
// (worfy-daily ticket 07). A Session that names no model runs on it, as the SDK takes it from
// there; session.ts reads it only to keep that model at sonnet or larger. Nothing here writes
// anywhere (ADR 0005).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeHome } from '../storage/paths'

/** Reads the user's model; null when it cannot be told. */
export type UserModelReader = () => string | null

/** The user's model, or null when settings.json is missing, unreadable, not JSON, or has no model. */
export function readUserModel(home: string = claudeHome()): string | null {
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
  if (typeof parsed !== 'object' || parsed === null) return null
  const model = (parsed as Record<string, unknown>).model
  return typeof model === 'string' && model.trim() !== '' ? model : null
}
