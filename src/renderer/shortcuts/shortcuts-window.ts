// The state of the Keyboard shortcuts window (ShortcutsOverlay.tsx) outside React: whether it is
// open. Help ▸ Keyboard Shortcuts of the app menu (`menu.command`), the command palette and the keys
// of ShortcutsOverlay.tsx open it through openShortcuts() without importing the window.
//
// One modal window at a time. While the Settings window is open, "open the shortcuts" shows its
// Shortcuts section instead — the same list; when Settings opens over this window, this one closes.
//
// The window is modal: the guard at the end keeps the rest of the app from the keyboard while it is
// open. The app's shortcuts listen on `window` (⌘K, ⌘F, ⌘↩, Esc of focus mode, the Canvas's keys),
// some of them in the capture phase, so the guard sits there too, added when this file loads —
// before every listener a component adds.
import { create } from 'zustand'
import { followMenuCommand } from '../menu-command'
import { selectSection, useSettingsWindow } from '../settings/settings-window'

export interface ShortcutsWindowState {
  open: boolean
}

export const useShortcutsWindow = create<ShortcutsWindowState>(() => ({ open: false }))

/** Settings → Shortcuts: the id of the section is its file name (settings/ShortcutsSection.tsx). */
export const SHORTCUTS_SECTION_ID = 'ShortcutsSection'

/** Opens the window; with the Settings window on screen, shows its Shortcuts section instead. */
export function openShortcuts(): void {
  if (useSettingsWindow.getState().open) {
    selectSection(SHORTCUTS_SECTION_ID)
    return
  }
  useShortcutsWindow.setState({ open: true })
}

export function closeShortcuts(): void {
  useShortcutsWindow.setState({ open: false })
}

// Settings opened over this window (Cmd/Ctrl+, reaches the menu while this one is open): one modal.
useSettingsWindow.subscribe((state, previous) => {
  if (state.open && !previous.open) closeShortcuts()
})

/**
 * Opens the window when the app menu says so (`menu.command` `shortcuts`, src/main/menu.ts), one
 * chosen before this subscribed included (src/renderer/menu-command.ts).
 * Returns the function that unsubscribes; without the preload bridge (a unit test of the shell)
 * followMenuCommand subscribes to nothing and shows no toast.
 */
export function followShortcutsCommands(): () => void {
  return followMenuCommand('shortcuts', openShortcuts)
}

let dialogElement: HTMLElement | null = null

/** ShortcutsOverlay names its dialog element while it is on screen, and null when it leaves. */
export function setShortcutsDialogElement(element: HTMLElement | null): void {
  dialogElement = element
}

/** What Tab stops at inside the window, in order: the list (it scrolls with the arrows) and Close. */
const STOPS = '[data-shortcuts-stop]'

/**
 * The modal guard, on `window` in the capture phase. While the window is on screen no key reaches a
 * listener of the app: Esc closes the window and goes no further — focus mode under it stays —,
 * Tab goes round the window, and any other key keeps only what it does itself (scrolling the list,
 * pressing Close). The accelerators of the app menu still work: Electron hands them the presses
 * the page did not cancel.
 */
function guardKeys(event: KeyboardEvent): void {
  const dialog = dialogElement
  if (!useShortcutsWindow.getState().open || dialog === null || !dialog.isConnected) return
  event.stopImmediatePropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    closeShortcuts()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const stops = [...dialog.querySelectorAll<HTMLElement>(STOPS)]
    const at = stops.findIndex((stop) => stop === document.activeElement)
    const next = at === -1 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
    ;(stops[next] ?? dialog).focus()
  }
}

if (typeof window !== 'undefined') window.addEventListener('keydown', guardKeys, true)
