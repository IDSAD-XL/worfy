// A request to center the Canvas on a Session's Node, from the sidebar's Sessions section. The
// Canvas side (overlays/SessionNodes.tsx) is inside React Flow and carries it out; `seq` makes a
// repeated click a new request.
import { create } from 'zustand'

export interface FocusRequest {
  projectId: string
  nodeId: string
  seq: number
}

export const useSessionFocus = create<{ request: FocusRequest | null }>(() => ({ request: null }))

export function focusSessionNode(projectId: string, nodeId: string): void {
  useSessionFocus.setState(({ request }) => ({ request: { projectId, nodeId, seq: (request?.seq ?? 0) + 1 } }))
}
