// The state of the Keyboard shortcuts window (ShortcutsOverlay.tsx) outside React: whether it is
// open. Help ▸ Keyboard Shortcuts of the app menu (`menu.command`), the command palette and the keys
// of ShortcutsOverlay.tsx open it through openShortcuts() without importing the window.
//
// One modal window at a time. While the Settings window is open, "open the shortcuts" shows its
// Shortcuts section instead — the same list; when Settings opens over this window, this one closes.
//
// The window is a modal Dialog of the kit (theme/kit/Dialog.tsx), which also keeps the rest of the
// app from the keyboard while it is open.
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
