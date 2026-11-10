// The queued messages the user took out of a Session's queue in this window (the queue's ×,
// composer/Queue.tsx), after main confirmed it removed them before they were sent. The comments of a
// round of quotes (worfy-polish ticket 102) go back to the tray on this alone: a queue that empties
// otherwise (Autopilot's Start now keeps it aside for the person's Session, a relaunch hands it over)
// does not mean its messages will not be sent.

type Listener = (sessionId: string, text: string) => void

const listeners = new Set<Listener>()

/** Tells every listener that `text` left the queue of `sessionId` unsent, by the user's hand. */
export function queuedMessageRemoved(sessionId: string, text: string): void {
  for (const listener of [...listeners]) listener(sessionId, text)
}

/** Hears the queued messages the user removes; answers the call that stops it. */
export function onQueuedMessageRemoved(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
