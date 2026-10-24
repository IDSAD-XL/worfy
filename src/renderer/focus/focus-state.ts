// What the window shell and focus mode (FocusMode.tsx) know of each other, outside React:
// - `slot` — the element focus mode draws its layer in. The shell (shell/AppShell.tsx) names its
//   main area, so the layer covers the toolbar and the view and leaves the sidebar alone. Without a
//   shell (a unit test of FocusMode) there is none, and the layer goes into <body>;
// - `active` — whether focus mode is on screen in this window. The sidebar is shown or hidden apart
//   for the two (shell/sidebar-visibility.ts);
// - `request` — the last request to open focus mode on given Nodes, from a Node itself (a double
//   click on a Ticket card). The way in (canvas/overlays/FocusEntry.tsx) carries it out; `seq`
//   makes a repeat a new request.
// Nothing here is saved or sent to main.
import { create } from 'zustand'

export interface FocusRequest {
  ids: readonly string[]
  seq: number
}

export interface FocusState {
  slot: HTMLElement | null
  active: boolean
  request: FocusRequest | null
}

export const useFocusState = create<FocusState>(() => ({ slot: null, active: false, request: null }))

/**
 * The attribute focus mode puts on what its layer covers instead of `inert` while a tile shows a
 * Browser (FocusMode.tsx, worfy-browser ticket 17); focus.css hides what carries it. The shell asks
 * for it as for `inert`: neither takes the focus.
 */
export const COVERED_ATTRIBUTE = 'data-focus-covered'

/** Asks the Canvas on screen to open focus mode on these Nodes, as the Focus button opens it on the selection. */
export function requestFocus(ids: readonly string[]): void {
  if (ids.length === 0) return
  useFocusState.setState((state) => ({ request: { ids: [...ids], seq: (state.request?.seq ?? 0) + 1 } }))
}

/** The shell names its main area while it is on screen, and null when it leaves. */
export function setFocusSlot(slot: HTMLElement | null): void {
  if (useFocusState.getState().slot !== slot) useFocusState.setState({ slot })
}

/** Focus mode says when its layer comes on screen and when it leaves. */
export function setFocusActive(active: boolean): void {
  if (useFocusState.getState().active !== active) useFocusState.setState({ active })
}

export function focusModeActive(): boolean {
  return useFocusState.getState().active
}
