// One live query of a Session (session.ts) and how a settings change reaches it.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionSettings } from '../../../shared/agent/settings'
import type { InputQueue } from './input-queue'
import type { QueryHandle } from './types'

export const STDERR_KEEP = 20

/** One live query and what belongs to it; replaced when a crashed Session is resumed. */
export interface Run {
  query: QueryHandle | null
  input: InputQueue<SDKUserMessage>
  stderr: string[]
  /** The settings this query runs with: those it started with, then each control call that succeeded. */
  applied: SessionSettings
}

/**
 * Brings a live query to `to`, one control call per changed setting. `run.applied` keeps the
 * Session's own settings; `request` turns them into what the calls ask for (Session.controlSettings):
 * a `null` model or effort becomes the user's own.
 */
export async function pushSettings(run: Run, query: QueryHandle, to: SessionSettings, request: (settings: SessionSettings) => SessionSettings): Promise<void> {
  const changed = run.applied.model !== to.model || run.applied.effort !== to.effort
  const asked = changed ? request(to) : to
  if (run.applied.model !== to.model) {
    await query.setModel(asked.model ?? undefined)
    run.applied = { ...run.applied, model: to.model }
  }
  if (run.applied.permissionMode !== to.permissionMode) {
    await query.setPermissionMode(to.permissionMode)
    run.applied = { ...run.applied, permissionMode: to.permissionMode }
  }
  if (run.applied.effort !== to.effort) {
    await query.applyFlagSettings({ effortLevel: asked.effort })
    run.applied = { ...run.applied, effort: to.effort }
  }
}
