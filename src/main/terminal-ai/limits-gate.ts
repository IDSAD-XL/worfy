// The Limits threshold of Terminal AI (ADR-0058, point 4; spec, "Decided without the owner", point 10):
// whether the known Limits let the assist process be asked for a feature now. Pure: the state, the
// feature and the time come in, the verdict goes out.
//
// - The automatic features (Suggestion, Next command) stop while the 5-hour window is used above
//   80 %, or while any window that is still in force says `allowed_warning` or `rejected`.
// - The on-demand features (Command request, Fix) stop only on `rejected` of a window in force.
// - A window whose reset time has passed is not counted at all: neither its share nor its status.
// - A window without a reset time is counted for LIMITS_STATUS_TTL_MS after worfy received it: a
//   status left from long ago may belong to a window that no longer blocks
//   (src/main/autopilot/limits-wait.ts says the same of a stale `rejected`).
// - Unknown Limits let everything through.
import type { LimitWindowState, LimitsState } from '../../shared/agent/limits'
import { isAutomatic, type TerminalAiFeature } from '../../shared/terminal-ai/settings'

/** How long a window without a reset time is counted after it came. */
export const LIMITS_STATUS_TTL_MS = 60 * 60 * 1000

/** The share of the 5-hour window above which the automatic features stop. */
export const AUTOMATIC_SHARE_LIMIT = 0.8

export type LimitsVerdict =
  | { ok: true }
  | {
      ok: false
      /** The window that holds the pause the longest. */
      window: string
      status: string | null
      utilization: number | null
      /** When the pause lifts by itself, in milliseconds since the epoch: the window's reset, or the end of its TTL. */
      until: number
    }

/** Until when `state` is counted at `now`; null when it is not counted any more. */
function inForceUntil(state: LimitWindowState, now: number): number | null {
  const until = state.resetsAt !== null ? state.resetsAt * 1000 : state.receivedAt + LIMITS_STATUS_TTL_MS
  return until > now ? until : null
}

function blocks(window: string, state: LimitWindowState, feature: TerminalAiFeature): boolean {
  if (state.status === 'rejected') return true
  if (!isAutomatic(feature)) return false
  if (state.status === 'allowed_warning') return true
  return window === 'five_hour' && state.utilization !== null && state.utilization > AUTOMATIC_SHARE_LIMIT
}

/** Whether the Limits `state` let `feature` through at `now` (milliseconds since the epoch). */
export function limitsGate(state: LimitsState, feature: TerminalAiFeature, now: number): LimitsVerdict {
  let verdict: LimitsVerdict = { ok: true }
  for (const [window, known] of Object.entries(state.windows)) {
    const until = inForceUntil(known, now)
    if (until === null || !blocks(window, known, feature)) continue
    if (verdict.ok || until > verdict.until) verdict = { ok: false, window, status: known.status, utilization: known.utilization, until }
  }
  return verdict
}
