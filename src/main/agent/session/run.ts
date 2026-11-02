// One process of a Session's agent (session.ts) and how a settings change reaches it.
import type { SessionSettings } from '../../../shared/agent/settings'
import type { SessionHandle, SessionMessage } from '../../vendors/session'

export const STDERR_KEEP = 20

/** One process of the agent and what belongs to it; replaced when a crashed Session is resumed. */
export interface Run {
  /** The agent's handle, once its driver has started it; null while the start runs. */
  handle: SessionHandle | null
  /** Messages sent while the start runs: they go to the handle as soon as it is there. */
  waiting: SessionMessage[]
  stderr: string[]
  /** The settings this process runs with: those it started with, then each change that succeeded. */
  applied: SessionSettings
}

/**
 * Brings a live process to `to`, one call per changed setting, model first, effort last. `run.applied`
 * keeps the Session's own settings: a `null` model or effort goes to the driver as it is, and the
 * driver turns it into the Vendor's default (Claude: the user's own).
 */
export async function pushSettings(run: Run, handle: SessionHandle, to: SessionSettings): Promise<void> {
  if (run.applied.model !== to.model) {
    await handle.setModel(to.model)
    run.applied = { ...run.applied, model: to.model }
  }
  if (run.applied.permissionMode !== to.permissionMode) {
    await handle.setPermissionPreset(to.permissionMode)
    run.applied = { ...run.applied, permissionMode: to.permissionMode }
  }
  if (run.applied.effort !== to.effort) {
    await handle.setEffort(to.effort)
    run.applied = { ...run.applied, effort: to.effort }
  }
}
