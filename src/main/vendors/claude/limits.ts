// The limits part of the Claude driver. Claude Code's windows are kept as LimitsState
// (src/main/agent/limits.ts), fed by rate_limit_event, the statusline and the Limits probe
// (src/main/agent/limits-usage.ts); the Limits panel, Autopilot and Terminal AI read that state.
import { PartNotWired } from '../driver'
import type { LimitsPart } from '../limits'

export const claudeLimits: LimitsPart = {
  // shortcut: rejects, as LimitWindow comes from the stored state only with worfy-multi-vendor
  // ticket 11 (limitWindows); ticket 15 answers it through the Limits probe and limitWindows.
  read: () => Promise.reject(new PartNotWired('claude', 'limits.read', 'worfy-multi-vendor ticket 15')),
}
