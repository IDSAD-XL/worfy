// Unknown side effects in the renderer (worfy-continuity ticket 07): the marks of main's Autopilot state
// (AutopilotState.unknownSideEffects) — the Tickets an Autopilot Run left to a person because a call of their
// implementer that may act outside the machine has no result — kept per Project for the Canvas, and their toast.
//
// - The frame's Autopilot action (canvas/actions/AutopilotAction.tsx) gives every state it takes to takeMarks; the
//   card of a Ticket (canvas/nodes/TicketNode.tsx) reads its mark with useUnknownSideEffects, and the layout
//   (canvas/sources/epics.ts) gives the marked cards their line with useSideEffectsMarks.
// - The toast says "Unknown side effects: `gh pr merge 41` may or may not have run (Ticket 01 of demo)", with "Checked,
//   include": `autopilot.include`, after which main's next state no longer names the mark and the Run, or the next
//   Run of the Epic, takes the Ticket along. A failure is an error toast with main's words.
import { create } from 'zustand'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import { failureReason } from '../../shared/ipc/channels'
import { invoke } from '../ipc'
import { showToast } from '../toast/toasts'

/** A mark of Unknown side effects of main's state. */
export type SideEffectsMark = NonNullable<AutopilotState['unknownSideEffects']>[number]

/** No mark in the Project. */
const NO_MARKS: readonly SideEffectsMark[] = []

/** The `data-testid` of the toast of Unknown side effects, and the start of its key. */
export const SIDE_EFFECTS_TOAST = 'autopilot-unknown-side-effects'

const useMarks = create<{ byProject: Readonly<Record<string, readonly SideEffectsMark[]>> }>(() => ({ byProject: {} }))

/** The marks of main's newest state of a Project (the caller drops an older state). */
export function takeMarks(state: Pick<AutopilotState, 'projectId' | 'unknownSideEffects'>): void {
  const marks = state.unknownSideEffects ?? NO_MARKS
  const known = useMarks.getState().byProject[state.projectId] ?? NO_MARKS
  if (JSON.stringify(known) === JSON.stringify(marks)) return
  useMarks.setState(({ byProject }) => ({ byProject: { ...byProject, [state.projectId]: marks } }))
}

/** The marks of the Project; none until main answered. */
export function useSideEffectsMarks(projectId: string): readonly SideEffectsMark[] {
  return useMarks((store) => store.byProject[projectId]) ?? NO_MARKS
}

/** The calls that left this Ticket to a person, or null when no mark names it. */
export function useUnknownSideEffects(projectId: string, epic: string, num: number): readonly string[] | null {
  return useSideEffectsMarks(projectId).find((mark) => mark.epic === epic && mark.ticket === num)?.actions ?? null
}

/** What the calls of a Ticket left to a person may have done: the tooltip of its mark. */
export const sideEffectsTitle = (actions: readonly string[]): string => `${actions.join('; ')} may or may not have run`

/** The text of the toast: the calls, then the Ticket. */
export const sideEffectsToastText = (mark: SideEffectsMark): string =>
  `Unknown side effects: ${mark.actions.map((action) => `\`${action}\``).join(', ')} may or may not have run (Ticket ${String(mark.ticket).padStart(2, '0')} of ${mark.epic})`

/** The key of a mark's toast. */
const markKey = (projectId: string, mark: Pick<SideEffectsMark, 'epic' | 'ticket'>): string => `${SIDE_EFFECTS_TOAST}:${projectId}:${mark.epic}/${mark.ticket}`

/** The marks whose toast this window has shown by itself: once each, until "Checked, include" takes the mark. */
const toasted = new Set<string>()

const errorToast = (projectId: string, text: string): void => void showToast({ kind: 'error', key: `${SIDE_EFFECTS_TOAST}:${projectId}:error`, testId: SIDE_EFFECTS_TOAST, projectId, text })

/** "Checked, include": main gives the Ticket back; its answer's marks are the Project's now. */
async function includeChecked(projectId: string, mark: SideEffectsMark): Promise<void> {
  const result = await invoke('autopilot.include', { projectId, epic: mark.epic, ticket: mark.ticket })
  if (!result.ok) {
    errorToast(projectId, failureReason('autopilot.include', result.error))
    return
  }
  takeMarks(result.value)
  const kept = result.value.unknownSideEffects?.some((each) => each.epic === mark.epic && each.ticket === mark.ticket) === true
  if (!kept) toasted.delete(markKey(projectId, mark))
  else if (result.value.message !== null) errorToast(projectId, result.value.message)
}

/** The toast of a mark, with "Checked, include": one per mark (its key), shown again on a click on the mark. */
export function showSideEffectsToast(projectId: string, mark: SideEffectsMark): void {
  showToast({
    kind: 'action',
    key: markKey(projectId, mark),
    testId: SIDE_EFFECTS_TOAST,
    projectId,
    text: sideEffectsToastText(mark),
    actions: [{ label: 'Checked, include', run: () => void includeChecked(projectId, mark) }],
  })
}

/** The toasts of `marks` this window has not shown yet: the frame of their Epic shows each once. */
export function toastNewMarks(projectId: string, marks: readonly SideEffectsMark[]): void {
  for (const mark of marks) {
    if (toasted.has(markKey(projectId, mark))) continue
    toasted.add(markKey(projectId, mark))
    showSideEffectsToast(projectId, mark)
  }
}
