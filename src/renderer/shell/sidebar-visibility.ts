// Whether the sidebar is shown. The app settings keep two answers (src/shared/settings/app-settings.ts):
// `sidebar.visible.normal` for the normal view and `sidebar.visible.focus` for focus mode. The one
// that counts is the one of what the window shows now (focus/focus-state.ts), and a switch writes
// that one alone: hiding the sidebar in focus mode leaves it shown on the Canvas. Like every app
// setting they outlive the window and are the same in every window of this Machine.
//
// Three things switch it, all through the same function: the button of the toolbar, the same button
// in the focus mode bar, and View ▸ Toggle Sidebar of the app menu (Cmd/Ctrl+B), which reaches the
// window as `menu.command`.
import { createElement, useCallback, type ReactElement } from 'react'
import { create } from 'zustand'
import type { WorfyBridge } from '../../shared/ipc/channels'
import { focusModeActive, useFocusState } from '../focus/focus-state'
import { followMenuCommand } from '../menu-command'
import { SHORTCUTS } from '../../shared/shortcuts'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import { ariaKeys, label } from '../shortcuts/match'

/** Which of the two saved answers counts: the one of focus mode while it is on screen. */
export type SidebarMode = 'normal' | 'focus'

/**
 * What the last switch asked for, per mode, while its write is on its way to main or was refused;
 * null — the settings decide. It is shown at once, so two quick presses undo each other without
 * waiting for main, and a refusal (app-settings.json cannot be written) does not leave the switch dead.
 */
const useAsked = create<Record<SidebarMode, boolean | null>>(() => ({ normal: null, focus: null }))
/** How many switches each mode has had: the answer to an earlier one does not undo a later one. */
const asks: Record<SidebarMode, number> = { normal: 0, focus: 0 }

export function sidebarMode(): SidebarMode {
  return focusModeActive() ? 'focus' : 'normal'
}

function ask(mode: SidebarMode, visible: boolean): void {
  const mine = ++asks[mode]
  useAsked.setState({ [mode]: visible })
  // No main to save it in (a unit test of the shell): the switch works in this window only.
  if ((globalThis as { worfy?: WorfyBridge }).worfy === undefined) return
  void setAppSettings({ sidebar: { visible: { [mode]: visible } } }).then((refused) => {
    // The answer to an earlier switch: a later one decides.
    if (mine !== asks[mode]) return
    // Saved: the settings say it now, and a switch made in another window is followed again.
    if (refused === undefined) useAsked.setState({ [mode]: null })
    else console.error(`appSettings.set failed, the sidebar stays ${visible ? 'shown' : 'hidden'} in this window only:`, refused)
  })
}

export interface SidebarVisibility {
  /** Whether the sidebar is shown in what the window shows now. */
  visible: boolean
  /** Hides or shows it there, and saves that. */
  toggle: () => void
}

export function useSidebarVisibility(): SidebarVisibility {
  const mode: SidebarMode = useFocusState((state) => state.active) ? 'focus' : 'normal'
  const saved = useAppSettings((settings) => settings.sidebar.visible)
  const asked = useAsked((state) => state[mode])
  // The mode and the last switch are read when the switch is made, not when this was rendered: a
  // second press may come before the render of the first.
  const toggle = useCallback(() => {
    const now = sidebarMode()
    ask(now, !(useAsked.getState()[now] ?? saved[now]))
  }, [saved])
  return { visible: asked ?? saved[mode], toggle }
}

/**
 * Calls `toggle` when the app menu says so (`menu.command` with `toggleSidebar`, src/main/menu.ts):
 * main sends it to the one window the item was chosen for, and holds it until this subscribed
 * (src/renderer/menu-command.ts). Returns the function that unsubscribes;
 * without the preload bridge (a unit test of the shell) it subscribes to nothing.
 */
export function followSidebarCommand(toggle: () => void): () => void {
  if ((globalThis as { worfy?: WorfyBridge }).worfy === undefined) return () => undefined
  return followMenuCommand('toggleSidebar', toggle)
}

export interface SidebarToggleProps {
  visible: boolean
  onToggle: () => void
  className: string
}

/** Marks the button for the shell, which gives it the focus when the sidebar goes away with the focus in it. */
export const SIDEBAR_TOGGLE_SELECTOR = '[data-sidebar-toggle]'

/** The button that hides and shows the sidebar: the same in the toolbar and in the focus mode bar. */
export function SidebarToggle({ visible, onToggle, className }: SidebarToggleProps): ReactElement {
  const name = visible ? 'Hide sidebar' : 'Show sidebar'
  return createElement(
    'button',
    {
      type: 'button',
      className,
      'aria-label': name,
      'aria-pressed': visible,
      // ⌘B on macOS, Ctrl+B elsewhere: the accelerator of View ▸ Toggle Sidebar (src/main/menu.ts).
      'aria-keyshortcuts': ariaKeys(SHORTCUTS.toggleSidebar),
      title: `${name} (${label(SHORTCUTS.toggleSidebar)})`,
      'data-sidebar-toggle': '',
      onClick: onToggle,
    },
    createElement(
      'svg',
      { width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      createElement('rect', { x: 1.75, y: 2.75, width: 12.5, height: 10.5, rx: 2 }),
      createElement('path', { d: 'M6 2.75v10.5' }),
    ),
  )
}
