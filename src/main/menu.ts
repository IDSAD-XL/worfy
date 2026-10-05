// The app menu: Electron's default macOS menu, item for item, plus the View items that switch
// parts of the window (ticket 29: Show Minimap). Setting a menu replaces the default one as a
// whole, so the default's roles are spelled out here. src/main/index.ts installs it once the app
// is ready; what the View items switch lives in the `view` IPC domain (src/main/ipc/view.ts).
import { Menu, type MenuItem, type MenuItemConstructorOptions } from 'electron'
import { setViewState, viewState } from './ipc/view'

/** The id of View ▸ Show Minimap, for tests that click it. */
export const MINIMAP_MENU_ITEM_ID = 'view.minimap'

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
