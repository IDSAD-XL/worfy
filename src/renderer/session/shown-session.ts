import { useEffect } from 'react'
import { create } from 'zustand'

// Which live Session the Session view of this window shows (worfy-ui ticket 17). The view itself
// picks it — a Node's Session or the Orchestrator (SessionView.tsx) — and writes it here, so code
// outside React (question-toast.ts) can tell whether a Session is on screen without reading the DOM.
// Whether the Session view is the view shown is navigation.ts's `view`, not this store.

export const useShownSession = create<{ sessionId: string | null }>(() => ({ sessionId: null }))

/** Records `sessionId` as the one the Session view shows while the calling component is mounted. */
export function useShowSession(sessionId: string | null): void {
  useEffect(() => {
    useShownSession.setState({ sessionId })
    return () => {
      // A panel that mounted after this one owns the store now; leave its Session in place.
      if (useShownSession.getState().sessionId === sessionId) useShownSession.setState({ sessionId: null })
    }
  }, [sessionId])
}
