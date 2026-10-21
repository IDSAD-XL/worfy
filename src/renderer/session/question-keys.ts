// The keys of the question card (QuestionCard.tsx, worfy-ui ticket 17), apart from the component so
// tests can call them.

/**
 * Whether Enter pressed on `target` moves through the card (next question, or submit): only on an
 * option or in the "Other" field. Any other button of the card keeps Enter as its own press.
 */
export function answersWithEnter(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.classList.contains('w-question__option') || target.classList.contains('w-question__other-input'))
}
