// A ready text for the input field of a Session, by the id of its Node (worfy-onboarding ticket 07).
// Getting started opens the demo's Orchestrator with a question or a command ready in its field; the
// user reads it and sends it, or not (decision 4 of the onboarding spec: Getting started never sends
// a message to an agent itself).
//
// MessageInput takes the text of its Node as soon as there is one — when it opens, or later while it
// is open — and puts it in only when the field is empty. Taken is gone either way: the text is put in
// once at most and never replaces what the user typed, then or later.
//
// Ticket 14: what became of a ready text once taken, by the id of its Node (`fields`), so Getting
// started knows where to put its ring (getting-started/highlight.ts): `ready` while it lies in the
// field, `sent` once the field sent it. MessageInput writes it with markField(): `ready` when it puts
// the text in (or finds it there already), nothing when the field is emptied without sending, `sent`
// when it sends. A new ready text for the Node starts again from nothing.
import { create } from 'zustand'

/** A ready text in the field (`ready`), or sent from it (`sent`). */
export type FieldPhase = 'ready' | 'sent'

export interface PendingInputState {
  /** The ready text of each Node that has one, not yet taken by its field. */
  texts: Readonly<Record<string, string>>
  /** What became of the ready text each field took. */
  fields: Readonly<Record<string, FieldPhase>>
}

export const usePendingInput = create<PendingInputState>(() => ({ texts: {}, fields: {} }))

/** Leaves `text` for the input field of Node `nodeId`; a text left before and not taken is replaced. */
export function setPendingInput(nodeId: string, text: string): void {
  usePendingInput.setState((state) => {
    const fields = { ...state.fields }
    delete fields[nodeId]
    return { texts: { ...state.texts, [nodeId]: text }, fields }
  })
}

/** Records what became of the ready text in the field of Node `nodeId`; null forgets it. */
export function markField(nodeId: string, phase: FieldPhase | null): void {
  if ((usePendingInput.getState().fields[nodeId] ?? null) === phase) return
  usePendingInput.setState((state) => {
    const fields = { ...state.fields }
    if (phase === null) delete fields[nodeId]
    else fields[nodeId] = phase
    return { fields }
  })
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
