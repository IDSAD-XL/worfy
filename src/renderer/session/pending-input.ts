// A ready text for the input field of a Session, by the id of its Node (worfy-onboarding ticket 07).
// Getting started opens the demo's Orchestrator with a question or a command ready in its field; the
// user reads it and sends it, or not (decision 4 of the onboarding spec: Getting started never sends
// a message to an agent itself).
//
// MessageInput takes the text of its Node as soon as there is one — when it opens, or later while it
// is open — and puts it in only when the field is empty. Taken is gone either way: the text is put in
// once at most and never replaces what the user typed, then or later.
//
// Ticket 14: what became of the text a step offered, by the id of its Node (`fields`), so Getting
// started knows where to put its ring (getting-started/highlight.ts). setPendingInput() makes it
// `offered`. MessageInput writes the rest with markField(): `ready` once it has taken the text — put
// in, or the field kept what the user had there (an edit of an earlier offer); `offered` again when
// the field is emptied; `sent` after any send from the field while offered or ready, whatever text it
// sent, until a step offers a text again. So a turn the field started never leaves the ring on the
// step's button, which would ask for the same turn a second time.
import { create } from 'zustand'

/** Offered by a step and not in the field (`offered`), in the field (`ready`), or sent from it (`sent`). */
export type FieldPhase = 'offered' | 'ready' | 'sent'

export interface PendingInputState {
  /** The ready text of each Node that has one, not yet taken by its field. */
  texts: Readonly<Record<string, string>>
  /** What became of the ready text each field took. */
  fields: Readonly<Record<string, FieldPhase>>
}

export const usePendingInput = create<PendingInputState>(() => ({ texts: {}, fields: {} }))

/** Leaves `text` for the input field of Node `nodeId`, `offered`; a text left before and not taken is replaced. */
export function setPendingInput(nodeId: string, text: string): void {
  usePendingInput.setState((state) => ({ texts: { ...state.texts, [nodeId]: text }, fields: { ...state.fields, [nodeId]: 'offered' } }))
}

/** Records what became of the offered text in the field of Node `nodeId`. */
export function markField(nodeId: string, phase: FieldPhase): void {
  if (usePendingInput.getState().fields[nodeId] === phase) return
  usePendingInput.setState((state) => ({ fields: { ...state.fields, [nodeId]: phase } }))
}

/** Takes the ready text of Node `nodeId`: answers it and forgets it; undefined when there is none. */
export function takePendingInput(nodeId: string): string | undefined {
  const text = usePendingInput.getState().texts[nodeId]
  if (text === undefined) return undefined
  usePendingInput.setState((state) => {
    const texts = { ...state.texts }
    delete texts[nodeId]
    return { texts }
  })
  return text
}
