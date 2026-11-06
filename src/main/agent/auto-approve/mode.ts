// What both Vendor drivers do with the Auto-approval mode of an unattended Session (worfy-auto-approve tickets 04
// and 05): read it at each request, Off when it cannot be read; and the outcome Shadow reports for a decision.
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import type { Decision } from './policy'

/** What Shadow reports for an outcome: what would have been done; a hard deny is one in any mode. */
export const SHADOW_OUTCOME = { allow: 'would-allow', deny: 'would-deny', park: 'would-park', 'hard-deny': 'hard-deny' } as const satisfies Record<Decision['outcome'], string>

/** The outcome a decision is reported with in `mode`. */
export function reportedOutcome(mode: Exclude<AutoApprovalMode, 'off'>, outcome: Decision['outcome']): (typeof SHADOW_OUTCOME)[Decision['outcome']] | Decision['outcome'] {
  return mode === 'shadow' ? SHADOW_OUTCOME[outcome] : outcome
}

/** The mode of `approval` now; Off without one, and when reading it fails (`who` names the driver in the warning). */
export function approvalMode(approval: { mode(): AutoApprovalMode } | undefined, who: string): AutoApprovalMode {
  if (approval === undefined) return 'off'
  try {
    return approval.mode()
  } catch (error) {
    console.warn(`[${who}] could not read the Auto-approval mode, the request is answered as at Off`, error)
    return 'off'
  }
}
