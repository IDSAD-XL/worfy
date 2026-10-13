// The interface scale in main: `interfaceScale` of the app settings (src/main/settings/store.ts) as
// the zoom of every window, and the steps the View menu makes (src/main/menu.ts). One scale for the
// Machine: every window has it, and everything in a window grows with it — text, Canvas, Terminal,
// Cards.
//
// A window starts with the scale in its webPreferences and gets it again after every load of its
// page (src/main/window.ts calls followInterfaceScale): Chromium keeps a zoom of its own per origin
// in worfy's data folder and puts it on a page as it loads, and app-settings.json is the one that
// counts.
import { BrowserWindow } from 'electron'
import { clampScale, INTERFACE_SCALE_DEFAULT, INTERFACE_SCALE_MAX, INTERFACE_SCALE_MIN, INTERFACE_SCALE_STEP } from '../../shared/settings/app-settings'
import { appSettingsStore } from './store'

/** The interface scale of this Machine, 0.8–1.5. */
export function interfaceScale(): number {
  return appSettingsStore().get().interfaceScale
}

function zoom(window: BrowserWindow, scale: number): void {
  if (window.isDestroyed()) return
  window.webContents.setZoomFactor(scale)
}

/** The scale the windows were last given, once the first window is followed. */
let given: number | undefined

/**
 * Keeps the zoom of `window` at the interface scale: after every load of its page, and — with every
 * other window of the app — when the scale changes. The scale of the first paint is the window's
 * own `webPreferences.zoomFactor`.
 */
export function followInterfaceScale(window: BrowserWindow): void {
  window.webContents.on('did-finish-load', () => zoom(window, interfaceScale()))
  if (given !== undefined) return
  given = interfaceScale()
  // One listener for the app, not one per window: a closed window leaves nothing behind.
  appSettingsStore().on('changed', (settings) => {
    // The other settings (the sidebar) change far more often than the scale.
    if (settings.interfaceScale === given) return
    given = settings.interfaceScale
    for (const open of BrowserWindow.getAllWindows()) zoom(open, settings.interfaceScale)
  })
}

/** Whether `scale` is below the largest one: View ▸ Bigger has a step to make. */
export function canGrow(scale: number): boolean {
  return clampScale(scale) < INTERFACE_SCALE_MAX
}

/** Whether `scale` is above the smallest one: View ▸ Smaller has a step to make. */
export function canShrink(scale: number): boolean {
  return clampScale(scale) > INTERFACE_SCALE_MIN
}

/**
 * Writes a scale to the app settings; the store brings it into range and tells the windows. A menu
 * click has nobody to report a failed write to, and an error thrown from it would put up Electron's
 * error dialog, so the failure is logged and the scale stays.
 */
function setInterfaceScale(scale: number): void {
  try {
    appSettingsStore().set({ interfaceScale: scale })
  } catch (error) {
    console.warn(`worfy: the interface scale could not be saved and stays as it was: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * One step of a tenth up (1) or down (-1). The store rounds the sum to a whole tenth and keeps it
 * in range (clampScale), so a step at an end of the range changes nothing.
 */
export function stepInterfaceScale(direction: 1 | -1): void {
  setInterfaceScale(interfaceScale() + direction * INTERFACE_SCALE_STEP)
}

/** Back to 100 %. */
export function resetInterfaceScale(): void {
  setInterfaceScale(INTERFACE_SCALE_DEFAULT)
}
