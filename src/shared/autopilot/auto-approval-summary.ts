// The morning summary of Auto-approval (worfy-auto-approve ticket 08; the spec on what the owner sees, item 3): the
// decisions of a Run counted by mode, for the block «Auto-approval» of Run history
// (src/renderer/flight-recorder/DetailPanel.tsx) and for the one line the Orchestrator's chat gets at the end
// of a Run (src/main/autopilot/run.ts). Pure: no Node, no DOM.
//
// - A decision is an `auto-approval` line of the Journal (src/shared/autopilot/journal.ts). Its mode is the one
//   the line names: a Run whose mode was switched has decisions of both.
// - On counts `allow`, `deny`, `park`, `hard-deny`; Shadow counts `would-allow`, `would-deny`, `would-park`
//   and its `hard-deny` (a hard deny stays `hard-deny` in Shadow). `park-answered` and `park-expired` end a
//   park counted already: they are in the list, not decisions of their own.
import type { AUTO_APPROVAL_LINE_MODES, AutoApprovalOutcome } from '../agent/auto-approval'

export type AutoApprovalLineMode = (typeof AUTO_APPROVAL_LINE_MODES)[number]

/** What a decision says, as far as counting goes: the mode it was judged in and its outcome. */
export interface Judged {
  mode: AutoApprovalLineMode
  outcome: AutoApprovalOutcome
}

/** The counters of On, in the order the screen and the chat name them. */
export const ON_COUNTERS = ['allow', 'deny', 'park', 'hard-deny'] as const
/** The counters of Shadow, in the order the screen and the chat name them. */
export const SHADOW_COUNTERS = ['would-allow', 'would-deny', 'would-park', 'hard-deny'] as const

export type OnCounts = Record<(typeof ON_COUNTERS)[number], number>
export type ShadowCounts = Record<(typeof SHADOW_COUNTERS)[number], number>

/** The counters of each mode; null for a mode the Run has no decision in. */
export interface AutoApprovalCounts {
  on: OnCounts | null
  shadow: ShadowCounts | null
}

/** Whether the line is a decision of its own in its mode, not the end of a park. */
const counted = (each: Judged): boolean => (each.mode === 'on' ? (ON_COUNTERS as readonly string[]) : (SHADOW_COUNTERS as readonly string[])).includes(each.outcome)

/** Whether the line is a decision of Shadow: what «Shadow: N decisions so far» counts over the Runs of a Project. */
export const isShadowDecision = (each: Judged): boolean => each.mode === 'shadow' && counted(each)

/** The counters of the decisions, by the mode each was judged in. */
export function autoApprovalCounts(decisions: readonly Judged[]): AutoApprovalCounts {
  let on: OnCounts | null = null
  let shadow: ShadowCounts | null = null
  for (const each of decisions) {
    if (!counted(each)) continue
    if (each.mode === 'on') {
      on ??= { allow: 0, deny: 0, park: 0, 'hard-deny': 0 }
      on[each.outcome as keyof OnCounts] += 1
    } else {
      shadow ??= { 'would-allow': 0, 'would-deny': 0, 'would-park': 0, 'hard-deny': 0 }
      shadow[each.outcome as keyof ShadowCounts] += 1
    }
  }
  return { on, shadow }
}

const hard = (count: number): string => (count === 0 ? '' : `, hard-denied ${count}`)

/**
 * The line of the Orchestrator's chat at the end of a Run: «Auto-approval: allowed 3, denied 1, parked 0» for
 * On, «Shadow: would allow 2, would deny 1, would park 0» for Shadow, a hard deny named only when there was one,
 * both (On first) after a switch of the mode. Null without a decision: the chat gets no line then.
 */
export function autoApprovalChatLine(decisions: readonly Judged[]): string | null {
  const { on, shadow } = autoApprovalCounts(decisions)
  const parts: string[] = []
  if (on !== null) parts.push(`Auto-approval: allowed ${on.allow}, denied ${on.deny}, parked ${on.park}${hard(on['hard-deny'])}`)
  if (shadow !== null) parts.push(`Shadow: would allow ${shadow['would-allow']}, would deny ${shadow['would-deny']}, would park ${shadow['would-park']}${hard(shadow['hard-deny'])}`)
  return parts.length === 0 ? null : parts.join(' · ')
}
