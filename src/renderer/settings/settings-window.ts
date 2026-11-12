// The state of the Settings window (SettingsDialog.tsx) outside React: whether it is open and
// which section it shows. The app menu's "Settings…" (`menu.command`) and the command palette open
// it through openSettings() without importing the window. The window is a modal Dialog of the kit
// (theme/kit/Dialog.tsx), which also keeps the rest of the app from the keyboard while it is open.
import { create } from 'zustand'
import { followMenuCommand } from '../menu-command'
import { LAYERS } from '../theme/layers'

export interface SettingsWindowState {
  open: boolean
  /** The id of the section shown (its file name without the extension); null — the first one. */
  section: string | null
}

export const useSettingsWindow = create<SettingsWindowState>(() => ({ open: false, section: null }))

/**
 * The z-index of the window's layer: the dialog layer of the scale (theme/layers.ts), the same as the
 * Keyboard shortcuts and the Guide. Focus mode's layer is drawn inside the main area of the window
 * shell, a stacking context of its own (focus.css), so the window opens above focus mode too and
 * leaves it as it was. A form a section opens over the window (the move form of the old Harness, the
 * Codex hooks step) is a window of the kit too: drawn inside this layer, above the window, and the top
 * of the kit's windows.
 */
export const SETTINGS_LAYER = LAYERS.dialog

/**
 * Opens the window on section `sectionId` (e.g. "GeneralSection"); an id no file has shows the
 * first section. Without an id a closed window opens on the first section and an open one stays
 * where it is.
 */
export function openSettings(sectionId?: string): void {
  const { open, section } = useSettingsWindow.getState()
  useSettingsWindow.setState({ open: true, section: sectionId ?? (open ? section : null) })
}

export function closeSettings(): void {
  useSettingsWindow.setState({ open: false })
}

/** Shows section `sectionId` in the open window. */
export function selectSection(sectionId: string): void {
  useSettingsWindow.setState({ section: sectionId })
}

/**
 * Opens the window when the app menu says so (`menu.command`, src/main/menu.ts), a "Settings…"
 * chosen before this subscribed included (src/renderer/menu-command.ts). Returns the function that
 * unsubscribes; without the preload bridge (a unit test of the shell) followMenuCommand subscribes
 * to nothing and shows no toast.
 */
export function followMenuCommands(): () => void {
  return followMenuCommand('settings', openSettings)
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The controls of `dialog` that Tab stops at, in order. The modal windows that are not on the kit yet
 * keep their focus with it (worfy-ui-kit tickets 05–07 move them onto the kit's Dialog).
 */
export function focusablesOf(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
}
