// Whether a Node component is drawn in a tile of focus mode (FocusMode.tsx) rather than on the
// Canvas. A Node that shows more when it has the room reads it: the focused Ticket shows its whole
// file (canvas/nodes/TicketBody.tsx), its card on the Canvas stays compact.
import { createContext, useContext } from 'react'

export const FocusTileContext = createContext(false)

/** True inside a tile of focus mode. */
export function useInFocusTile(): boolean {
  return useContext(FocusTileContext)
}
