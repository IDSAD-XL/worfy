// The minimap's state and size (MiniMapOverlay.tsx), apart from its component so that what sits
// next to it (the first-Epic label, FirstEpic.tsx) reads them too. View ▸ Show Minimap
// (src/main/menu.ts) hides and shows it.
import { create } from 'zustand'
import { invoke, subscribe } from '../../ipc'

const useMinimapStore = create<{ visible: boolean }>(() => ({ visible: true }))
let followed = false

/** Takes the View menu's state once and follows it; one subscription serves every Canvas. */
export function followViewMenu(): void {
  if (followed) return
  followed = true
  try {
    subscribe('view.changed', ({ minimap }) => useMinimapStore.setState({ visible: minimap }))
  } catch (error) {
    console.error('view.changed: cannot subscribe', error)
  }
  void invoke('view.get').then((result) => {
    if (result.ok) useMinimapStore.setState({ visible: result.value.minimap })
    else console.error('view.get failed:', result.error)
  })
}

/** Whether the minimap is shown (View ▸ Show Minimap). */
export function useMinimapShown(): boolean {
  return useMinimapStore((store) => store.visible)
}

/** The minimap's drawing, in screen pixels: React Flow's defaults, which MiniMapOverlay.tsx keeps. */
const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
/** Its border on each side (minimap.css) and React Flow's margin around a panel (.react-flow__panel). */
const MINIMAP_BORDER = 1
export const PANEL_MARGIN = 15
/** The minimap on the screen with its border, for what sits next to it. */
export const MINIMAP_BOX = { width: MINIMAP_WIDTH + 2 * MINIMAP_BORDER, height: MINIMAP_HEIGHT + 2 * MINIMAP_BORDER } as const

/**
 * The corner a pinned Node keeps out of (pinning.ts): the minimap, the margin between it and the
 * Canvas's edges, and as much again between it and the Node.
 */
export const MINIMAP_CORNER = {
  width: PANEL_MARGIN + MINIMAP_BOX.width + PANEL_MARGIN,
  height: PANEL_MARGIN + MINIMAP_BOX.height + PANEL_MARGIN,
} as const
