// "Add project" asked for from outside the Projects section (worfy-onboarding ticket 07): "Connect…"
// of Getting started opens the same thing as "+" of Projects. The Projects section owns that flow —
// the Machine step, the folder picker, the connect dialog — and listens here; anything else asks.

type Listener = () => void

const listeners = new Set<Listener>()

/** Listens for requests of "Add project"; answers the function that stops listening. */
export function onAddProjectRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Asks for "Add project", as "+" of Projects does. False when nothing listens (no Projects section). */
export function requestAddProject(): boolean {
  for (const listener of [...listeners]) listener()
  return listeners.size > 0
}
