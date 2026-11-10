// The queued messages the user took out of a Session's queue in this window (the × of the queue chip,
// composer/Queue.tsx, and of a queued message in a Product Session's chat, QueuedMessages.tsx; both
// through removeQueuedMessage), after main confirmed it removed them before they were sent. The comments of a
// round of quotes (worfy-polish ticket 102) go back to the tray on this alone: a queue that empties
// otherwise (Autopilot's Start now keeps it aside for the person's Session, a relaunch hands it over)
// does not mean its messages will not be sent.

import { invoke } from '../ipc'

type Listener = (sessionId: string, text: string) => void

const listeners = new Set<Listener>()

/** Tells every listener that `text` left the queue of `sessionId` unsent, by the user's hand. */
export function queuedMessageRemoved(sessionId: string, text: string): void {
  for (const listener of [...listeners]) listener(sessionId, text)
}

/**
 * Asks main to take a queued message out before it is sent; once main says it did, tells the
 * listeners with the message's text as the queue lists it.
 */
export function removeQueuedMessage(sessionId: string, id: string, text: string): void {
  void invoke('agent.queueRemove', { sessionId, id }).then((result) => {
    if (!result.ok) console.error('agent.queueRemove failed:', result.error)
    else if (result.value.removed) queuedMessageRemoved(sessionId, text)
  })
}

/** Hears the queued messages the user removes; answers the call that stops it. */
export function onQueuedMessageRemoved(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
