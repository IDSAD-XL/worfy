// A quiet turn (worfy-stuck-agents ticket 03): how long a Session's turn has gone without a sign of life.
//
// A sign of life is any event of the Session's agent, hidden ones included: a hook that starts, runs or
// ends, and thinking tokens (the `alive` event of src/shared/agent/events.ts), besides every event the
// transcript shows. Some work sends no events and is still no quiet: an open permission request (the
// turn waits for a person), a hook between its start and its end (the gate in TaskCompleted runs up to
// 900 s), the output file of a live background task that keeps growing (src/main/autopilot/task-output.ts),
// the output of the gate of the Session's worktree (`.run-<tag>-<pid>.out`, harness/hooks/gate.mjs), and
// an e2e lock whose holder runs. Main reads those (src/main/agent/session/quiet-signs.ts); this module only
// judges them, so the rule is tested without a clock or a file.
//
// The word is `quiet`, not `silent`: Silent mode is another term (CONTEXT.md).
import type { SessionState } from './events'

/**
 * After how long without a sign of life a turn is marked quiet: 10 minutes, as SETTLE_MS of Autopilot
 * (decided without the owner, item 7 of the Epic's spec; confirmed 2026-11-17). Tickets 04 and 06 take it.
 */
export const QUIET_MARK_MS = 10 * 60_000

/** What tells a quiet turn from a working one. Times are in ms since the epoch. */
export interface QuietFacts {
  state: SessionState
  /** The last sign of life of the Session's agent, or the start of the turn when it gave none since. */
  lastSignAt: number
  /** Hook runs that started and have not ended. */
  openHooks: number
  /** The latest change of an output file of a live background task of the Session; null when none is known. */
  taskOutputAt: number | null
  /** The latest change of an output file of a gate running in the Session's worktree; null when there is none. */
  gateOutputAt: number | null
  /** The e2e lock is held, and its holder runs. */
  e2eLockHeld: boolean
}

/**
 * How long, in ms, the turn has gone without a sign of life at `now`. Zero when the Session runs no turn
 * (`busy`), waits for a person (`needs_permission`), runs a hook, holds a live e2e lock, or an output file
 * — of a live background task, or of the gate of its worktree — changed within `thresholdMs`. Otherwise
 * counted from the latest of the last sign of life and those changes.
 */
export function quietFor(now: number, facts: QuietFacts, thresholdMs: number = QUIET_MARK_MS): number {
  if (facts.state !== 'busy' || facts.openHooks > 0 || facts.e2eLockHeld) return 0
  const outside = [facts.taskOutputAt, facts.gateOutputAt].filter((at): at is number => at !== null)
  if (outside.some((at) => now - at < thresholdMs)) return 0
  return Math.max(0, now - Math.max(facts.lastSignAt, ...outside))
}

/** When the quiet of the turn began, once it has lasted `thresholdMs`; null before, and when there is none. */
export function quietSince(now: number, facts: QuietFacts, thresholdMs: number = QUIET_MARK_MS): number | null {
  const quiet = quietFor(now, facts, thresholdMs)
  return quiet > 0 && quiet >= thresholdMs ? now - quiet : null
}
