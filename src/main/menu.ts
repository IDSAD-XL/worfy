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
import { app, BrowserWindow, Menu, type BaseWindow, type MenuItem, type MenuItemConstructorOptions } from 'electron'
import { menuCommand, type MenuCommand } from '../shared/ipc/menu'
import { emit } from './ipc/index'
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

/**
 * Tells one window's renderer to carry out `command`: the window the item was clicked for, else the
 * focused one, else nobody. The window comes from the click handler: a test that clicks the item
 * without one would otherwise depend on which window has the focus.
 */
export function sendMenuCommand(command: MenuCommand, window: BaseWindow | undefined): void {
  const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
  if (target === null || target.isDestroyed()) return
  emit(target.webContents, menuCommand, command)
}

function settingsItem(): MenuItemConstructorOptions {
  return { id: SETTINGS_MENU_ITEM_ID, label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: (_item, window) => sendMenuCommand('settings', window) }
}

/** The app menu of macOS: the items of Electron's appMenu role, with "Settings…" after About. */
function appMenu(): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settingsItem(),
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
function fileMenu(): MenuItemConstructorOptions {
  return { label: 'File', submenu: [settingsItem(), { type: 'separator' }, { role: 'quit' }] }
}

/**
 * The three items of the interface scale at `scale`. An item with no step left to make is disabled:
 * Bigger at the largest scale, Smaller at the smallest.
 */
function scaleItems(scale: number): MenuItemConstructorOptions[] {
  return [
    { id: SCALE_ACTUAL_MENU_ITEM_ID, label: 'Actual size', accelerator: 'CmdOrCtrl+Alt+0', click: () => resetInterfaceScale() },
    { id: SCALE_BIGGER_MENU_ITEM_ID, label: 'Bigger', accelerator: 'CmdOrCtrl+Alt+=', enabled: canGrow(scale), click: () => stepInterfaceScale(1) },
    { id: SCALE_SMALLER_MENU_ITEM_ID, label: 'Smaller', accelerator: 'CmdOrCtrl+Alt+-', enabled: canShrink(scale), click: () => stepInterfaceScale(-1) },
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
    ...(platform === 'darwin' ? [appMenu(), { role: 'fileMenu' } as const] : [fileMenu()]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        ...scaleItems(interfaceScale()),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { id: SIDEBAR_MENU_ITEM_ID, label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: (_item, window) => sendMenuCommand('toggleSidebar', window) },
        { id: MINIMAP_MENU_ITEM_ID, label: 'Show Minimap', type: 'checkbox', checked: viewState().minimap, click: onMinimap },
      ],
    },
    { role: 'windowMenu' },
  ]
}

/** Sets the app menu; called once, after the app is ready. */
export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate((item) => setViewState({ minimap: item.checked }))))
  // The scale changes from the menu and from Settings → General alike.
  appSettingsStore().on('changed', (settings) => syncScaleItems(settings.interfaceScale))
}
