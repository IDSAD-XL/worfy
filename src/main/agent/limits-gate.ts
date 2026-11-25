// The Limits check before a call worfy starts by itself (ADR-0058, point 4): whether the known
// Limits let a call of a given kind go now. Pure: the state, the kind and the time come in, the
// verdict goes out. Terminal AI asks it for its features (src/main/terminal-ai/limits-gate.ts), the
// Assistant before a wake (src/main/assistant/budget/wake-gate.ts).
//
// - An `automatic` call stops while the 5-hour window is used above 80 %, or while any window that
//   is still in force says `allowed_warning` or `rejected`.
// - An `on-demand` call stops only on `rejected` of a window in force.
// - A window whose reset time has passed is not counted at all: neither its share nor its status.
// - A window without a reset time is counted for LIMITS_STATUS_TTL_MS after worfy received it: a
//   status left from long ago may belong to a window that no longer blocks
//   (src/main/autopilot/limits-wait.ts says the same of a stale `rejected`).
// - Unknown Limits let everything through.
import type { LimitWindowState, LimitsState } from '../../shared/agent/limits'

/** How long a window without a reset time is counted after it came. */
export const LIMITS_STATUS_TTL_MS = 60 * 60 * 1000

/** The share of the 5-hour window above which the automatic calls stop. */
export const AUTOMATIC_SHARE_LIMIT = 0.8

/** `automatic`: worfy starts the call by itself; `on-demand`: the user asked for it, or it cannot wait. */
export type LimitsCallKind = 'automatic' | 'on-demand'

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

function blocks(window: string, state: LimitWindowState, kind: LimitsCallKind): boolean {
  if (state.status === 'rejected') return true
  if (kind === 'on-demand') return false
  if (state.status === 'allowed_warning') return true
  return window === 'five_hour' && state.utilization !== null && state.utilization > AUTOMATIC_SHARE_LIMIT
}

/** Whether the Limits `state` let a call of `kind` go at `now` (milliseconds since the epoch). */
export function limitsCheck(state: LimitsState, kind: LimitsCallKind, now: number): LimitsVerdict {
  let verdict: LimitsVerdict = { ok: true }
  for (const [window, known] of Object.entries(state.windows)) {
    const until = inForceUntil(known, now)
    if (until === null || !blocks(window, known, kind)) continue
    if (verdict.ok || until > verdict.until) verdict = { ok: false, window, status: known.status, utilization: known.utilization, until }
  }
  return verdict
}
