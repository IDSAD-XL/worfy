// Whether a Node component is drawn in a tile of focus mode (FocusMode.tsx) rather than on the
// Canvas. A Node that shows more when it has the room reads it: the focused Ticket shows its whole
// file (canvas/nodes/TicketBody.tsx), its card on the Canvas stays compact.
//
// A Node whose content is drawn elsewhere — a Browser's page is the <webview> of the Browser layer
// on the Canvas, laid over the tile from under focus mode's layer (worfy-browser ticket 17) —
// declares its tile see-through (useSeeThroughTile): focus mode then lets that content show
// through the tile and hides the rest of what it covers (cover.ts). Focus mode never asks what kind
// of Node a tile holds.
import { createContext, useContext, useEffect } from 'react'

export const FocusTileContext = createContext(false)

/** True inside a tile of focus mode. */
export function useInFocusTile(): boolean {
  return useContext(FocusTileContext)
}

/** Sets whether the tile's Node shows through it; null outside a tile. */
export type SetSeeThrough = (seeThrough: boolean) => void

export const SeeThroughTileContext = createContext<SetSeeThrough | null>(null)

/** In a tile, makes the tile see-through while `seeThrough` holds; nothing on the Canvas. */
export function useSeeThroughTile(seeThrough: boolean): void {
  const set = useContext(SeeThroughTileContext)
  useEffect(() => {
    if (set === null || !seeThrough) return undefined
    set(true)
    return () => set(false)
  }, [set, seeThrough])
}
