// The app menu and its View items that switch parts of the window (ticket 29: Show Minimap).
// The state is kept in memory for the running app; every window hears about a change.
import { app, BrowserWindow, Menu, type MenuItem, type MenuItemConstructorOptions } from 'electron'
import { viewChanged, viewGet, type ViewState } from '../../shared/ipc/view'
import { defineHandler, emit, type HandlerModule } from './index'

/** The id of View ▸ Show Minimap, for tests that click it. */
export const MINIMAP_MENU_ITEM_ID = 'view.minimap'

const state: ViewState = { minimap: true }

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) emit(window.webContents, viewChanged, state)
  }
}

/**
 * Electron's default macOS menu, item for item, with Show Minimap at the end of View. Setting a
 * menu replaces the default one as a whole, so the default's roles are spelled out here.
 */
export function menuTemplate(onMinimap: (item: MenuItem) => void): MenuItemConstructorOptions[] {
  return [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
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
        { id: MINIMAP_MENU_ITEM_ID, label: 'Show Minimap', type: 'checkbox', checked: state.minimap, click: onMinimap },
      ],
    },
    { role: 'windowMenu' },
  ]
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate((item) => {
        state.minimap = item.checked
        broadcast()
      }),
    ),
  )
})

export default [defineHandler(viewGet, () => state)] satisfies HandlerModule
