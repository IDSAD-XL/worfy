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

export interface SessionRefusal {
  projectId: string
  /** Why the Session was not opened, as the section says it. */
  text: string
}

export const useSessionRequest = create<{ request: SessionRequest | null; refusal: SessionRefusal | null }>(() => ({ request: null, refusal: null }))

/** Asks the Sessions section of Project `projectId` to open Session `sessionId` once that Project is open and the Node known. */
export function requestSession(projectId: string, sessionId: string): void {
  useSessionRequest.setState({ request: { projectId, sessionId, at: Date.now() }, refusal: null })
}

/**
 * Drops the request: carried out, too old, or its Project could not be opened. With `refusal`, the Sessions
 * section of that Project says why it did not open the Session (as on a read-only screen).
 */
export function clearSessionRequest(refusal: SessionRefusal | null = null): void {
  useSessionRequest.setState({ request: null, refusal })
}

/** Forgets the reason a Session was not opened: the user did something else since. */
export function forgetSessionRefusal(): void {
  if (useSessionRequest.getState().refusal !== null) useSessionRequest.setState({ refusal: null })
}

/** Whether a request made at `at` is still to be carried out at `now`. */
export const requestLive = (at: number, now: number): boolean => now - at <= SESSION_REQUEST_MS
