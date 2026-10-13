// What the window shell and focus mode (FocusMode.tsx) know of each other, outside React:
// - `slot` — the element focus mode draws its layer in. The shell (shell/AppShell.tsx) names its
//   main area, so the layer covers the toolbar and the view and leaves the sidebar alone. Without a
//   shell (a unit test of FocusMode) there is none, and the layer goes into <body>;
// - `active` — whether focus mode is on screen in this window. The sidebar is shown or hidden apart
//   for the two (shell/sidebar-visibility.ts).
// Nothing here is saved or sent to main.
import { create } from 'zustand'

export interface FocusState {
  slot: HTMLElement | null
  active: boolean
}

export const useFocusState = create<FocusState>(() => ({ slot: null, active: false }))

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
