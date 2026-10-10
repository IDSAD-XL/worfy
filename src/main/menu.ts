// The app menu: Electron's default menu, item for item, plus worfy's own items: View ▸ Show Minimap
// (ticket 29) and "Settings…" (worfy-ui ticket 2). Setting a menu replaces the default one as a
// whole, so the default's roles are spelled out here; the app menu of macOS and File elsewhere are
// spelled out item for item, because "Settings…" goes inside them. src/main/index.ts installs the
// menu once the app is ready; what the View items switch lives in the `view` IPC domain
// (src/main/ipc/view.ts), and an item that needs the window's renderer sends it `menu.command`.
import { app, BrowserWindow, Menu, type BaseWindow, type MenuItem, type MenuItemConstructorOptions } from 'electron'
import { menuCommand, type MenuCommand } from '../shared/ipc/menu'
import { emit } from './ipc/index'
import { setViewState, viewState } from './ipc/view'

/** The id of View ▸ Show Minimap, for tests that click it. */
export const MINIMAP_MENU_ITEM_ID = 'view.minimap'
/** The id of "Settings…" (Cmd/Ctrl+,), for tests that click it. */
export const SETTINGS_MENU_ITEM_ID = 'app.settings'

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
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { id: MINIMAP_MENU_ITEM_ID, label: 'Show Minimap', type: 'checkbox', checked: viewState().minimap, click: onMinimap },
      ],
    },
    { role: 'windowMenu' },
  ]
}

/** Sets the app menu; called once, after the app is ready. */
export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate((item) => setViewState({ minimap: item.checked }))))
}
