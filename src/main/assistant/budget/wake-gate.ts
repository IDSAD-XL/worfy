// The check before every automatic wake of the Assistant (spec worfy-assistant, the decision on
// waking; owner's decision 13, story 34). Pure: the Limits, the kind of the wake, the wakes of
// the day and the time come in, the verdict goes out. worfy-assistant ticket 06 asks it before a
// wake; a message of the user wakes the Assistant without it.
//
// - The Limits: the check Terminal AI uses (src/main/agent/limits-gate.ts). A non-urgent wake is an
//   `automatic` call: it waits while the 5-hour window is used above 80 % or a window warns. An
//   urgent one (work stands, a Run stopped) is an `on-demand` call: only `rejected` holds it, since
//   waiting for a softer limit would hide what stands.
// - The daily limit: at most `limit` automatic wakes, urgent ones included, per local day; the
//   count starts anew at the local midnight. It guards against a loop of wakes as much as against
//   the cost.
// - When both hold the wake, the Limits are named: their pause is the one that needs no new day.
import type { LimitsState } from '../../../shared/agent/limits'
import { ASSISTANT_DAILY_WAKE_LIMIT, nextLocalMidnight } from '../../../shared/assistant/budget'
import { limitsCheck } from '../../agent/limits-gate'

export type WakeVerdict =
  | { ok: true }
  | { ok: false; reason: 'limits'; window: string; status: string | null; utilization: number | null; until: number }
  | { ok: false; reason: 'daily-limit'; wakes: number; limit: number; until: number }

export interface WakeCheck {
  limits: LimitsState
  urgent: boolean
  /** The automatic wakes since the local midnight (AssistantUsageLedger.automaticWakesToday). */
  wakesToday: number
  /** The daily limit; ASSISTANT_DAILY_WAKE_LIMIT by default. */
  limit?: number
  /** Milliseconds since the epoch. */
  now: number
}

/** Whether an automatic wake may go at `now`; `until` says when a held one may go by itself. */
export function assistantWakeGate({ limits, urgent, wakesToday, limit = ASSISTANT_DAILY_WAKE_LIMIT, now }: WakeCheck): WakeVerdict {
  const verdict = limitsCheck(limits, urgent ? 'on-demand' : 'automatic', now)
  if (!verdict.ok) return { ...verdict, reason: 'limits' }
  if (wakesToday >= limit) return { ok: false, reason: 'daily-limit', wakes: wakesToday, limit, until: nextLocalMidnight(now) }
  return { ok: true }
}
