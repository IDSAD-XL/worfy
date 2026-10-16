// Whether the window's screen is read-only (worfy-link ticket 25, ADR-0066), for the code that sends
// rather than draws: the undo history and the trash (canvas/history.ts), the Layout operations
// (canvas/useLayout.ts), the Bindings, a Card's writes. Without the DOM, so that history.ts stays
// in the node test project. useProjects.ts, which follows the Linked machines, gives the answer as
// it loads; before that, and in a window on this Machine, the answer is null.

let answer: () => string | null = () => null

/** The read-only hint ("<Machine> gives this Machine read-only access"), or null when the screen may write. */
export function readOnlyNow(): string | null {
  return answer()
}

/** How readOnlyNow() answers; set by useProjects.ts. */
export function answerReadOnly(next: () => string | null): void {
  answer = next
}
