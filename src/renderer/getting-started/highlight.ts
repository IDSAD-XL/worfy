// The highlight of the element to press next in Getting started (worfy-onboarding ticket 14; owner's
// decisions Q15–Q17 of 2026-10-31): a ring of the accent colour with a soft pulse around one element,
// with no dimming; it blocks nothing and changes neither the focus nor the Tab order.
//
// highlightTarget() chooses the one target, or none, from the state: the step's button in the panel,
// "Check again" of First run while step 1 is current and First run is open, and the Send button of the
// demo Orchestrator's field while the ready text of step 3 or 4 lies in it. Once that text is sent,
// no ring until main marks the step: a ring on the step's button would call for preparing the text and
// sending the turn a second time. A target that is not on screen gives way to the step's button, which
// opens the place it is in (Q16); there are no arrows at the window's edge.
//
// The panel (GettingStartedPanel.tsx, useHighlightRing) puts `data-getting-started-ring` on exactly
// one element that carries `data-getting-started-target`, and keeps it there as the state and the DOM
// change; highlight.css draws the ring on the element itself, so the ring lives in the target's own
// layer. This file reads no DOM: the unit test drives it with a table.
import { GETTING_STARTED_STEPS, type GettingStartedSnapshot, type GettingStartedStep } from '../../shared/ipc/getting-started'

export type HighlightTarget = { kind: 'step'; step: GettingStartedStep } | { kind: 'check-again' } | { kind: 'send'; nodeId: string }

/** The input field of the demo's Orchestrator that a step's button filled, and what became of its ready text. */
export interface PreparedField {
  step: GettingStartedStep
  nodeId: string
  /** As session/pending-input.ts records it: offered and not in the field, in the field, or sent from it. */
  phase: 'offered' | 'ready' | 'sent'
}

export interface HighlightInput {
  snapshot: GettingStartedSnapshot | null
  /** The panel is expanded: not its pill. */
  expanded: boolean
  firstRunOpen: boolean
  /** "Create demo project" is running. */
  creating: boolean
  field: PreparedField | null
  /** Whether the target is on screen: in the DOM, not disabled and not inside something hidden. */
  onScreen: (target: HighlightTarget) => boolean
}

/** The first step main has not marked; null once all six are. */
export function currentStep(snapshot: GettingStartedSnapshot): GettingStartedStep | null {
  return GETTING_STARTED_STEPS.find((step) => snapshot.steps[step] === undefined) ?? null
}

/** The one target the ring goes on now, or null for none. */
export function highlightTarget({ snapshot, expanded, firstRunOpen, creating, field, onScreen }: HighlightInput): HighlightTarget | null {
  // Only while the panel shows expanded (Q17): not its pill, not after Skip, not before it was ever shown.
  if (snapshot === null || snapshot.section !== 'shown' || !expanded) return null
  const step = currentStep(snapshot)
  if (step === null) return null
  const button: HighlightTarget = { kind: 'step', step }
  let wanted: HighlightTarget
  switch (step) {
    case '1':
      wanted = firstRunOpen ? { kind: 'check-again' } : button
      break
    case '2':
      if (creating) return null
      wanted = button
      break
    case '3':
    case '4': {
      const ours = field !== null && field.step === step ? field : null
      if (ours?.phase === 'sent') return null
      wanted = ours?.phase === 'ready' ? { kind: 'send', nodeId: ours.nodeId } : button
      break
    }
    default:
      return null
  }
  if (onScreen(wanted)) return wanted
  if (wanted.kind !== 'step' && onScreen(button)) return button
  return null
}

/** The attribute that puts the ring on an element (highlight.css); one element at most carries it. */
export const RING_ATTRIBUTE = 'data-getting-started-ring'

/**
 * The value of `data-getting-started-target` on the element of `target`: the step buttons of the
 * panel, "Check again" of First run (shell/FirstRunChecks.tsx), and Send (session/MessageInput.tsx),
 * which carries its Node in `data-getting-started-node` as well.
 */
export function targetValue(target: HighlightTarget): string {
  return target.kind === 'step' ? `step-${target.step}` : target.kind
}

/** The CSS selector of the elements of `target`; `escape` makes a Node id safe in it (CSS.escape in the window). */
export function targetSelector(target: HighlightTarget, escape: (value: string) => string): string {
  const own = `[data-getting-started-target="${targetValue(target)}"]`
  // "Check again" of First run, not the one of Settings → Health.
  if (target.kind === 'check-again') return `[data-testid="first-run"] ${own}`
  return target.kind === 'send' ? `${own}[data-getting-started-node="${escape(target.nodeId)}"]` : own
}
