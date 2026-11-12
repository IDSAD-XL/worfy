// The state of the worfy Guide outside React (worfy-guide ticket 03, ADR-0090): whether it is open,
// which Topic it shows, and what the build says about itself. Part of the app's first chunk, and
// small on purpose: the Guide's window, its texts and its diagrams are a chunk of their own that
// loads on the first opening (GuideHost.tsx).
//
// The Guide opens from Help ▸ worfy Guide (`menu.command` `guide`), from the Command palette (a
// row for the Guide and one per Topic), from Getting started and from First run (ticket 09). Nothing
// opens it by itself: no timer, no first start, no update.
//
// One modal window at a time: opening the Guide closes the Keyboard shortcuts and the Settings
// window, and either of them opening closes the Guide.
//
// The window is a modal Dialog of the kit (theme/kit/Dialog.tsx): while the Guide is on screen, Esc
// closes it and goes no further, Tab goes round its controls, and no other key reaches a shortcut of
// the app.
import { create } from 'zustand'
import { followMenuCommand } from '../menu-command'
import { hasPreloadBridge, invoke } from '../ipc'
import { closeSettings, useSettingsWindow } from '../settings/settings-window'
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
