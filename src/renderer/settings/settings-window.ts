// The state of the Settings window (SettingsDialog.tsx) outside React: whether it is open and
// which section it shows. The app menu's "Settings…" (`menu.command`) and the command palette open
// it through openSettings() without importing the window.
//
// The window is modal, and this file also keeps the rest of the app from the keyboard while it is
// open (the listeners at the end): the app's shortcuts listen on `window` (⌘K, ⌘F, ⌘↩, Esc of focus
// mode, the Canvas's keys), where a handler on the dialog itself cannot stop them.
import { create } from 'zustand'
import { subscribe } from '../ipc'

export interface SettingsWindowState {
  open: boolean
  /** The id of the section shown (its file name without the extension); null — the first one. */
  section: string | null
}

export const useSettingsWindow = create<SettingsWindowState>(() => ({ open: false, section: null }))

/** The z-index of the window's backdrop: above every other dialog of the app (90–101). */
export const SETTINGS_LAYER = 110

/**
 * Focus mode covers the whole window in a layer above this one (focus.css, z-index 1000), so the
 * Settings window would open unseen under it. Which of the two goes on top is decided with focus
 * mode's own layer; until then the window does not open while focus mode is on screen.
 */
function focusModeOnScreen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('.w-focus') !== null
}

/**
 * Opens the window on section `sectionId` (e.g. "GeneralSection"); an id no file has shows the
 * first section. Without an id a closed window opens on the first section and an open one stays
 * where it is. While focus mode is on screen it does nothing.
 */
export function openSettings(sectionId?: string): void {
  if (focusModeOnScreen()) return
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

// The modal guard. While the window is on screen:
// - a key pressed with the focus outside it (on the page, after the focused element went away)
//   reaches nothing behind: Esc closes the window, Tab brings the focus into it;
// - a ⌘/Ctrl shortcut pressed inside it reaches no listener of the app; the key's own default
//   (copy, paste, undo in a field) still happens, and so do the accelerators of the app menu;
// - any other key pressed inside it goes to the window's own controls and stops at `document`,
//   before the listeners on `window`;
// - the focus cannot move to anything behind it (a dialog that opened under it).
// A layer drawn above the window (the open list of a Select, a dialog a section opens) keeps its
// keys and its focus.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The controls of `dialog` that Tab stops at, in order. */
export function focusablesOf(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

let dialogElement: HTMLElement | null = null
let lastFocused: HTMLElement | null = null

/** SettingsDialog names its dialog element while it is on screen, and null when it leaves. */
export function setSettingsDialogElement(element: HTMLElement | null): void {
  dialogElement = element
  lastFocused = null
}

function activeDialog(): HTMLElement | null {
  return useSettingsWindow.getState().open && dialogElement !== null && dialogElement.isConnected ? dialogElement : null
}

/** The z-index of the layer `element` is in: of its ancestor right under `body`; NaN without one. */
function layerOf(element: Element): number {
  let layer = element
  while (layer.parentElement !== null && layer.parentElement !== document.body) layer = layer.parentElement
  if (layer.parentElement !== document.body) return Number.NaN
  return Number.parseInt(getComputedStyle(layer).zIndex, 10)
}

const isAbove = (target: EventTarget | null): boolean => target instanceof Element && layerOf(target) > SETTINGS_LAYER

/** On `window`, capture phase, added when this file loads: before every listener a component adds. */
function guardKeys(event: KeyboardEvent): void {
  const dialog = activeDialog()
  if (dialog === null) return
  const target = event.target
  if (target instanceof Node && dialog.contains(target)) {
    // Some of the app's shortcuts listen in the capture phase on `window` (⌘↩ of focus mode), so
    // they are stopped here; only propagation stops, not what the key itself does.
    if (event.metaKey || event.ctrlKey) event.stopImmediatePropagation()
    return
  }
  if (isAbove(target)) return
  event.stopImmediatePropagation()
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSettings()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const focusable = focusablesOf(dialog)
    ;((event.shiftKey ? focusable.at(-1) : focusable[0]) ?? dialog).focus()
  }
}

/** On `document`, bubble phase, added when this file loads: before the listeners on `window`. */
function stopKeysAtDocument(event: KeyboardEvent): void {
  if (activeDialog() === null || isAbove(event.target)) return
  event.stopImmediatePropagation()
}

/** Takes the focus back when something behind the window got it. */
function keepFocus(event: FocusEvent): void {
  const dialog = activeDialog()
  if (dialog === null) return
  const target = event.target
  if (target instanceof HTMLElement && dialog.contains(target)) {
    lastFocused = target
    return
  }
  if (isAbove(target)) return
  const back = lastFocused !== null && dialog.contains(lastFocused) ? lastFocused : (focusablesOf(dialog)[0] ?? dialog)
  back.focus()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('keydown', guardKeys, true)
  document.addEventListener('keydown', stopKeysAtDocument)
  document.addEventListener('focusin', keepFocus)
}
