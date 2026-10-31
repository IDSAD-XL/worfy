// The state of the worfy Guide outside React (worfy-guide ticket 03, ADR-0090): whether it is open,
// which Topic it shows, and what the build says about itself. Part of the app's first chunk, and
// small on purpose: the Guide's window, its texts and its diagrams are a chunk of their own that
// loads on the first opening (GuideHost.tsx).
//
// The Guide opens from Help ▸ worfy Guide (`menu.command` `guide`), from the Command palette (a
// row for the Guide and one per Topic) and, later, from Getting started and First run. Nothing
// opens it by itself: no timer, no first start, no update.
//
// One modal window at a time: opening the Guide closes the Keyboard shortcuts and the Settings
// window, and either of them opening closes the Guide.
//
// The window is modal. The guard below sits on `window` in the capture phase and on `document`,
// added when this file loads — before every listener a component adds, as the Settings window's
// (settings/settings-window.ts): while the Guide is on screen, Esc closes it and goes no further,
// Tab goes round its controls, and no other key reaches a shortcut of the app.
import { create } from 'zustand'
import { followMenuCommand } from '../menu-command'
import { hasPreloadBridge, invoke } from '../ipc'
import { closeSettings, focusablesOf, useSettingsWindow } from '../settings/settings-window'
import { closeShortcuts, useShortcutsWindow } from '../shortcuts/shortcuts-window'

export interface GuideBuild {
  /** The build version (`app.version`), for the commit of the GitHub links; null until main answers. */
  version: string | null
  /** Whether this is a packaged build; null until main answers, read as packaged (registry.ts). */
  packaged: boolean | null
}

export interface GuideState {
  open: boolean
  /** The Topic on screen; null — the first one shown. */
  topic: string | null
  build: GuideBuild
}

export const useGuide = create<GuideState>(() => ({ open: false, topic: null, build: { version: null, packaged: null } }))

/** Opens the Guide, at `topic` when given, else where it was. */
export function openGuide(topic?: string): void {
  closeShortcuts()
  closeSettings()
  useGuide.setState(topic === undefined ? { open: true } : { open: true, topic })
}

export function closeGuide(): void {
  useGuide.setState({ open: false })
}

/** Shows `topic` in the open Guide. */
export function selectGuideTopic(topic: string): void {
  useGuide.setState({ topic })
}

// Another modal window opened over the Guide: one modal.
useSettingsWindow.subscribe((state, previous) => {
  if (state.open && !previous.open) closeGuide()
})
useShortcutsWindow.subscribe((state, previous) => {
  if (state.open && !previous.open) closeGuide()
})

let buildAsked = false

/** Asks main once for the build version and whether the build is packaged. */
function askBuild(): void {
  if (buildAsked || !hasPreloadBridge()) return
  buildAsked = true
  void invoke('app.version').then((result) => {
    if (result.ok) useGuide.setState({ build: { version: result.value.version, packaged: result.value.packaged } })
    else console.error('app.version failed:', result.error)
  })
}

/**
 * Opens the Guide when the app menu says so (`menu.command` `guide`), one chosen before this
 * subscribed included, and asks main what the build is. Returns the function that unsubscribes;
 * without the preload bridge (a unit test of the shell) it does nothing.
 */
export function followGuideCommands(): () => void {
  askBuild()
  return followMenuCommand('guide', () => openGuide())
}

let dialogElement: HTMLElement | null = null

/** The Guide's window names its dialog element while it is on screen, and null when it leaves. */
export function setGuideDialogElement(element: HTMLElement | null): void {
  dialogElement = element
}

function activeDialog(): HTMLElement | null {
  return useGuide.getState().open && dialogElement !== null && dialogElement.isConnected ? dialogElement : null
}

/** On `window`, capture phase: Esc closes, Tab goes round, and the app's shortcuts with ⌘ or Ctrl stay quiet. */
function guardKeys(event: KeyboardEvent): void {
  const dialog = activeDialog()
  if (dialog === null) return
  const inside = event.target instanceof Node && dialog.contains(event.target)
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeGuide()
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    event.stopImmediatePropagation()
    const stops = focusablesOf(dialog)
    const at = inside ? stops.indexOf(event.target as HTMLElement) : -1
    const next = at === -1 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
    ;(stops[next] ?? dialog).focus()
    return
  }
  // A key outside the window, or one with ⌘ or Ctrl, reaches no listener of the app. The menu's
  // accelerators still work: Electron hands them the presses the page did not cancel.
  if (!inside || event.metaKey || event.ctrlKey) event.stopImmediatePropagation()
}

/** On `document`, bubble phase: a key pressed in the window stops before the listeners on `window`. */
function stopKeysAtDocument(event: KeyboardEvent): void {
  if (activeDialog() !== null) event.stopImmediatePropagation()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('keydown', guardKeys, true)
  document.addEventListener('keydown', stopKeysAtDocument)
}
