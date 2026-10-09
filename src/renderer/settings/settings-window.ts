// The state of the Settings window (SettingsDialog.tsx) outside React: whether it is open and
// which section it shows. The app menu's "Settings…" (`menu.command`) and the command palette open
// it through openSettings() without importing the window.
import { create } from 'zustand'
import { subscribe } from '../ipc'

export interface SettingsWindowState {
  open: boolean
  /** The id of the section shown (its file name without the extension); null — the first one. */
  section: string | null
}

export const useSettingsWindow = create<SettingsWindowState>(() => ({ open: false, section: null }))

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
 * Opens the window when the app menu says so (`menu.command`, src/main/menu.ts). Returns the
 * function that unsubscribes; without the preload bridge (a unit test of the shell) it subscribes
 * to nothing.
 */
export function followMenuCommands(): () => void {
  try {
    return subscribe('menu.command', (command) => {
      if (command === 'settings') openSettings()
    })
  } catch (error) {
    console.error('menu.command: cannot subscribe', error)
    return () => undefined
  }
}
