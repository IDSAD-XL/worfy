// A click on a live Session of a Project that is not open (the sidebar's Sessions under «All Projects»,
// worfy-polish ticket 99): that Project opens, and its Sessions section opens the Session once the Session's
// Node is on its Canvas. The request waits here between the two.
import { create } from 'zustand'

/**
 * How long such a request waits for the Project's Canvas to have the Session's Node. An older one is
 * dropped: coming back to that Project later must not open it.
 */
export const SESSION_REQUEST_MS = 15_000

export interface SessionRequest {
  projectId: string
  sessionId: string
  /** When it was made, in ms since the epoch. */
  at: number
}

export const useSessionRequest = create<{ request: SessionRequest | null }>(() => ({ request: null }))

/** Asks the Sessions section of Project `projectId` to open Session `sessionId` once that Project is open and the Node known. */
export function requestSession(projectId: string, sessionId: string): void {
  useSessionRequest.setState({ request: { projectId, sessionId, at: Date.now() } })
}

/** Drops the request: carried out, too old, or its Project could not be opened. */
export function clearSessionRequest(): void {
  useSessionRequest.setState({ request: null })
}

/** Whether a request made at `at` is still to be carried out at `now`. */
export const requestLive = (at: number, now: number): boolean => now - at <= SESSION_REQUEST_MS
