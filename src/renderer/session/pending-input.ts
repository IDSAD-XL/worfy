// A ready text for the input field of a Session, by the id of its Node (worfy-onboarding ticket 07).
// Getting started opens the demo's Orchestrator with a question or a command ready in its field; the
// user reads it and sends it, or not (decision 4 of the onboarding spec: Getting started never sends
// a message to an agent itself).
//
// MessageInput takes the text of its Node as soon as there is one — when it opens, or later while it
// is open — and puts it in only when the field is empty. Taken is gone either way: the text is put in
// once at most and never replaces what the user typed, then or later.
import { create } from 'zustand'

export interface PendingInputState {
  /** The ready text of each Node that has one, not yet taken by its field. */
  texts: Readonly<Record<string, string>>
}

export const usePendingInput = create<PendingInputState>(() => ({ texts: {} }))

/** Leaves `text` for the input field of Node `nodeId`; a text left before and not taken is replaced. */
export function setPendingInput(nodeId: string, text: string): void {
  usePendingInput.setState((state) => ({ texts: { ...state.texts, [nodeId]: text } }))
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
