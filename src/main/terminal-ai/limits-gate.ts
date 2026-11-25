// The Limits threshold of Terminal AI (ADR-0058, point 4; spec, "Decided without the owner", point 10):
// whether the known Limits let the assist process be asked for a feature now. The automatic features
// (Suggestion, Next command) are `automatic` calls of the shared Limits check, the on-demand ones
// (Command request, Fix) `on-demand` calls; the rules are in src/main/agent/limits-gate.ts.
import type { LimitsState } from '../../shared/agent/limits'
import { isAutomatic, type TerminalAiFeature } from '../../shared/terminal-ai/settings'
import { limitsCheck, type LimitsVerdict } from '../agent/limits-gate'

export { LIMITS_STATUS_TTL_MS } from '../agent/limits-gate'

/** Whether the Limits `state` let `feature` through at `now` (milliseconds since the epoch). */
export function limitsGate(state: LimitsState, feature: TerminalAiFeature, now: number): LimitsVerdict {
  return limitsCheck(state, isAutomatic(feature) ? 'automatic' : 'on-demand', now)
}
