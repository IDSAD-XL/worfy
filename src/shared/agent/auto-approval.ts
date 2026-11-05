// The words of an approval policy's decision as every layer names them (worfy-auto-approve ticket 04): the
// Session's `auto_approval` event (events.ts) and the Autopilot journal's `auto-approval` line
// (src/shared/autopilot/journal.ts) take them from here, so the agent's events do not depend on the
// journal's format.

/** What the policy did with a permission request (the last two: worfy-auto-approve ticket 07). */
export const AUTO_APPROVAL_OUTCOMES = ['allow', 'deny', 'park', 'hard-deny', 'would-allow', 'would-deny', 'would-park', 'park-answered', 'park-expired'] as const
export type AutoApprovalOutcome = (typeof AUTO_APPROVAL_OUTCOMES)[number]

/** The modes of Auto-approval a decision is told in; Off tells none. */
export const AUTO_APPROVAL_LINE_MODES = ['shadow', 'on'] as const
