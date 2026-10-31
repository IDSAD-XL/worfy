// The app menu: Electron's default menu, item for item, plus worfy's own items: View ▸ Show Minimap
// (ticket 29) and "Settings…" (worfy-ui ticket 2). Setting a menu replaces the default one as a
// whole, so the default's roles are spelled out here; the app menu of macOS and File elsewhere are
// spelled out item for item, because "Settings…" goes inside them. src/main/index.ts installs the
// menu once the app is ready; what the View items switch lives in the `view` IPC domain
// (src/main/ipc/view.ts), and an item that needs the window's renderer sends it `menu.command`.
//
// View ▸ Actual size / Bigger / Smaller stand where Electron's zoom roles (resetZoom, zoomIn,
// zoomOut) stood and change the interface scale of the app settings by a tenth
// (src/main/settings/interface-scale.ts) instead of the zoom of one window. Their accelerators carry
// Alt: Cmd/Ctrl+= and Cmd/Ctrl+- zoom the Canvas (src/renderer/canvas/Canvas.tsx), and Cmd/Ctrl+0
// does nothing.
//
// View ▸ Toggle Sidebar (Cmd/Ctrl+B) hides and shows the sidebar of the window it is chosen for.
// The key is the item's accelerator, not a key handler of the page, so it works wherever the focus
// is: on the Canvas, in the Session view, in focus mode, in a text field. Which of the two saved
// answers changes — the normal view's or focus mode's — only that window knows, so the item sends
// it `menu.command` and the renderer does the rest (src/renderer/shell/sidebar-visibility.ts).
//
// A command for a window whose page does not follow it yet (the window is on screen before React has
// mounted) waits in main until the page says it does (`menu.ready`, src/main/ipc/menu.ts).
//
// Help ▸ Keyboard Shortcuts (Cmd/Ctrl+/) asks the window to open its Keyboard shortcuts window
// (src/renderer/shortcuts/ShortcutsOverlay.tsx). Help has the `help` role: on macOS it gets the
// system's search field. On Windows and Linux the item shows Ctrl+/ but does not take it: the
// renderer catches the key outside a Terminal Node, where it stays with the shell (worfy-ui ticket
// 11). Ctrl+B needs no such care: xterm.js cancels it in a terminal, and Electron hands the menu only
// the presses the page did not cancel.
//
// Help ▸ worfy Guide asks the window to open the worfy Guide, the short visual help
// (src/renderer/guide/, worfy-guide ticket 03, ADR-0090). It has no key of its own.
//
// Every accelerator comes from the registry of shortcuts (src/shared/shortcuts.ts), which the
// labels and the Keyboard shortcuts window of the renderer read too.
import { app, BrowserWindow, Menu, type BaseWindow, type MenuItem, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc/menu'
import { menuKeys, SHORTCUTS } from '../shared/shortcuts'
import { deliverMenuCommand } from './ipc/menu'
import { setViewState, viewState } from './ipc/view'
import { canGrow, canShrink, interfaceScale, resetInterfaceScale, stepInterfaceScale } from './settings/interface-scale'
import { appSettingsStore } from './settings/store'

/** The id of View ▸ Show Minimap, for tests that click it. */
export const MINIMAP_MENU_ITEM_ID = 'view.minimap'
/** The id of "Settings…" (Cmd/Ctrl+,), for tests that click it. */
export const SETTINGS_MENU_ITEM_ID = 'app.settings'
/** The ids of View ▸ Bigger, Smaller and Actual size, for tests that click them. */
export const SCALE_BIGGER_MENU_ITEM_ID = 'view.scale.bigger'
export const SCALE_SMALLER_MENU_ITEM_ID = 'view.scale.smaller'
export const SCALE_ACTUAL_MENU_ITEM_ID = 'view.scale.actual'
/** The id of View ▸ Toggle Sidebar (Cmd/Ctrl+B), for tests that click it. */
export const SIDEBAR_MENU_ITEM_ID = 'view.sidebar'
/** The id of Help ▸ Keyboard Shortcuts (Cmd/Ctrl+/), for tests that click it. */
export const SHORTCUTS_MENU_ITEM_ID = 'help.shortcuts'
/** The id of Help ▸ worfy Guide, for tests that click it. */
export const GUIDE_MENU_ITEM_ID = 'help.guide'

/**
 * Tells one window's renderer to carry out `command`: the window the item was clicked for, else the
 * focused one, else nobody. The window comes from the click handler: a test that clicks the item
 * without one would otherwise depend on which window has the focus. Until the window's page follows
 * the command, main holds it (deliverMenuCommand).
 */
export function sendMenuCommand(command: MenuCommand, window: BaseWindow | undefined): void {
  const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
  if (target === null || target.isDestroyed()) return
  deliverMenuCommand(target.webContents, command)
}

function settingsItem(platform: NodeJS.Platform): MenuItemConstructorOptions {
  return { id: SETTINGS_MENU_ITEM_ID, label: 'Settings…', ...menuKeys(SHORTCUTS.settings, platform), click: (_item, window) => sendMenuCommand('settings', window) }
}

/** The app menu of macOS: the items of Electron's appMenu role, with "Settings…" after About. */
function appMenu(platform: NodeJS.Platform): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settingsItem(platform),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }
}

/** File outside macOS: the item of Electron's fileMenu role (quit), with "Settings…" first. */
function fileMenu(platform: NodeJS.Platform): MenuItemConstructorOptions {
  return { label: 'File', submenu: [settingsItem(platform), { type: 'separator' }, { role: 'quit' }] }
}

/** Help with Electron's `help` role (the search field of macOS): worfy Guide, then Keyboard Shortcuts. */
function helpMenu(platform: NodeJS.Platform): MenuItemConstructorOptions {
  return {
    role: 'help',
    label: 'Help',
    submenu: [
      { id: GUIDE_MENU_ITEM_ID, label: 'worfy Guide', click: (_item, window) => sendMenuCommand('guide', window) },
      { type: 'separator' },
      {
        id: SHORTCUTS_MENU_ITEM_ID,
        label: 'Keyboard Shortcuts',
        ...menuKeys(SHORTCUTS.shortcuts, platform),
        click: (_item, window) => sendMenuCommand('shortcuts', window),
      },
    ],
  }
}

/**
 * The three items of the interface scale at `scale`. An item with no step left to make is disabled:
 * Bigger at the largest scale, Smaller at the smallest.
 */
function scaleItems(scale: number, platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    { id: SCALE_ACTUAL_MENU_ITEM_ID, label: 'Actual size', ...menuKeys(SHORTCUTS.scaleActual, platform), click: () => resetInterfaceScale() },
    { id: SCALE_BIGGER_MENU_ITEM_ID, label: 'Bigger', ...menuKeys(SHORTCUTS.scaleBigger, platform), enabled: canGrow(scale), click: () => stepInterfaceScale(1) },
    { id: SCALE_SMALLER_MENU_ITEM_ID, label: 'Smaller', ...menuKeys(SHORTCUTS.scaleSmaller, platform), enabled: canShrink(scale), click: () => stepInterfaceScale(-1) },
  ]
}

/** Enables and disables Bigger and Smaller of the installed menu for `scale`. */
function syncScaleItems(scale: number): void {
  const menu = Menu.getApplicationMenu()
  if (menu === null) return
  const bigger = menu.getMenuItemById(SCALE_BIGGER_MENU_ITEM_ID)
  if (bigger !== null) bigger.enabled = canGrow(scale)
  const smaller = menu.getMenuItemById(SCALE_SMALLER_MENU_ITEM_ID)
  if (smaller !== null) smaller.enabled = canShrink(scale)
}

export function menuTemplate(onMinimap: (item: MenuItem) => void, platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [appMenu(platform), { role: 'fileMenu' } as const] : [fileMenu(platform)]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        ...scaleItems(interfaceScale(), platform),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { id: SIDEBAR_MENU_ITEM_ID, label: 'Toggle Sidebar', ...menuKeys(SHORTCUTS.toggleSidebar, platform), click: (_item, window) => sendMenuCommand('toggleSidebar', window) },
        { id: MINIMAP_MENU_ITEM_ID, label: 'Show Minimap', type: 'checkbox', checked: viewState().minimap, click: onMinimap },
      ],
    },
    { role: 'windowMenu' },
    helpMenu(platform),
  ]
}

/** Sets the app menu; called once, after the app is ready. */
export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate((item) => setViewState({ minimap: item.checked }))))
  // The scale changes from the menu and from Settings → General alike.
  appSettingsStore().on('changed', (settings) => syncScaleItems(settings.interfaceScale))
}
