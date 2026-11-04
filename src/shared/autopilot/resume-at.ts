// When an Autopilot run continues after its Orchestrator was refused by the Limits (worfy-daily
// ticket 05). Pure: src/main/autopilot/limits-wait.ts gives it the hit, the Limits state of
// limits.json and the clock, and waits for the answer.
//
// How Claude Code reports the hit (2.1.289, Agent SDK 0.3.289; the ticket's result section): a
// `rate_limit_event` with `status: "rejected"`, the window in `rateLimitType` and `resetsAt` in Unix
// seconds; then a synthetic assistant message with `error: "rate_limit"` ("You've hit your limit ·
// resets …") and a `result` with `is_error: true` and the same text. The event may come without
// `resetsAt`, and its shape has changed before (src/shared/agent/limits.ts): the time is then taken
// from limits.json, and when no time is known at all the run tries again after RECHECK_MS.
//
// How Codex reports it (worfy-multi-vendor tickets 03, 21 and 38, decision 09): a turn error with
// `codexErrorInfo: "usageLimitExceeded"`, which the driver turns into `limit_reached`. With a window
// used up and its `resetsAt` (`reason: 'window'`) the run waits for that window as for Claude's; with
// none (`reason: 'quota'`: the plan does not include Codex, or a quota ran out) nothing resets, and
// the run stops with `vendor-quota` instead of waiting (the plan `quota`). When the wait is over, the
// run reads the Vendor's windows again (account/rateLimits/read) and waits once more while one of
// them is still used up (stillUsedUp).
import type { LimitsState, LimitWindow } from '../agent/limits'

/** Added to a reset time: the reset is the server's, and a message sent on the second may still be refused. */
export const RESUME_MARGIN_MS = 2 * 60_000

/**
 * With no reset time known, the run tries again this often. Each try is one message to the
 * Orchestrator; while the Limits still refuse, it costs nothing but a refused request.
 */
export const RECHECK_MS = 30 * 60_000

/**
 * The longest a run waits for the Limits, counted from the first refusal of a wait. Claude Code
 * itself gives up waiting for a reset more than 24 hours out (a refusal of the 7-day window can be
 * days away): the run stops then, with the reason, rather than keep the Mac awake for days.
 */
export const MAX_WAIT_MS = 24 * 60 * 60_000

/** Times below this are Unix seconds, above it milliseconds (1e11 s is the year 5138; 1e11 ms is 1973). */
const SECONDS_BELOW = 1e11

/** A reset time in milliseconds, from Unix seconds (what Claude Code sends) or milliseconds. */
export function toMs(time: number): number {
  return time < SECONDS_BELOW ? time * 1000 : time
}

/** What the run learnt of a refusal: the window and its reset time as the Session reported them. */
export interface LimitsHit {
  /** `five_hour`, `seven_day`, …; null when not reported. */
  window: string | null
  /** The reset time as reported (Unix seconds or milliseconds); null when not reported. */
  resetsAt: number | null
  /**
   * The Vendor refused without a window that resets (`limit_reached` with `reason: 'quota'`, Codex):
   * waiting does not help. Absent for a window that resets, and for every refusal of Claude.
   */
  quota?: true
}

export type ResumePlan =
  /** Continue at `at`: `resetsAt` (ms) of the window, plus RESUME_MARGIN_MS. */
  | { kind: 'at'; at: number; resetsAt: number }
  /** No reset time is known: try again at `at`. */
  | { kind: 'recheck'; at: number }
  /** Waiting would pass MAX_WAIT_MS: stop the run with `reason`. */
  | { kind: 'give-up'; reason: string }
  /** The Vendor refused by a quota, nothing to wait for: stop the run with `vendor-quota` at once. */
  | { kind: 'quota' }

export interface ResumeInput {
  hit: LimitsHit
  /** The Limits state of limits.json (resetsAt in Unix seconds there). */
  limits: LimitsState
  /** Now, in milliseconds. */
  now: number
  /** When the wait began: the first refusal not followed by a turn that went through. */
  since: number
}

/**
 * The reset time from limits.json, when the hit had none: the hit's window, or else the latest of
 * the windows whose last status was `rejected`. Only times still ahead count.
 */
function resetFromLimits(limits: LimitsState, window: string | null, now: number): number | null {
  const ahead = (time: number | null | undefined): number | null => (time === null || time === undefined || toMs(time) <= now ? null : toMs(time))
  if (window !== null) {
    const known = ahead(limits.windows[window]?.resetsAt)
    if (known !== null) return known
  }
  const rejected = Object.values(limits.windows)
    .filter((state) => state.status === 'rejected')
    .map((state) => ahead(state.resetsAt))
    .filter((time): time is number => time !== null)
  return rejected.length === 0 ? null : Math.max(...rejected)
}

/** When the run continues after `hit`. */
export function resumeAt({ hit, limits, now, since }: ResumeInput): ResumePlan {
  if (hit.quota === true) return { kind: 'quota' }
  const deadline = since + MAX_WAIT_MS
  if (now >= deadline) return { kind: 'give-up', reason: `Waited for the Limits since ${new Date(since).toISOString()}, longer than ${MAX_WAIT_MS / 3_600_000} h` }
  const reported = hit.resetsAt === null ? null : toMs(hit.resetsAt)
  const resetsAt = reported !== null && reported > now ? reported : resetFromLimits(limits, hit.window, now)
  if (resetsAt === null) return { kind: 'recheck', at: Math.min(now + RECHECK_MS, deadline) }
  const at = resetsAt + RESUME_MARGIN_MS
  if (at > deadline) return { kind: 'give-up', reason: `The Limits reset at ${new Date(resetsAt).toISOString()}, more than ${MAX_WAIT_MS / 3_600_000} h after the wait began` }
  return { kind: 'at', at, resetsAt }
}

/**
 * The window of a Vendor's fresh read (`windows`, its account/rateLimits/read) that still refuses
 * at `now`: used up (`usedPercent` 100 or more, or the state `reached`) with its reset still ahead;
 * of several, the one that resets last. Null when none does: the run goes on.
 */
export function stillUsedUp(windows: readonly LimitWindow[], now: number): LimitsHit | null {
  let last: LimitWindow | null = null
  for (const window of windows) {
    const usedUp = (window.usedPercent !== null && window.usedPercent >= 100) || window.state === 'reached'
    if (!usedUp || window.resetsAt === null || toMs(window.resetsAt) <= now) continue
    if (last === null || window.resetsAt > (last.resetsAt as number)) last = window
  }
  return last === null ? null : { window: last.id, resetsAt: last.resetsAt }
}

/**
 * Whether the error text of a turn says the Limits refused it ("You've hit your limit · resets
 * 3pm", "usage limit reached"): the fallback for a refusal whose `rate_limit_event` did not parse.
 */
export function isLimitsMessage(text: string | null): boolean {
  if (text === null) return false
  return /hit your [\w' -]*limit|usage limit|limit reached|rate[ _-]?limit/i.test(text)
}
