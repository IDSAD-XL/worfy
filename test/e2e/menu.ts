import type { ElectronApplication } from '@playwright/test'

/**
 * Clicks the app menu's item `id` (the ids are exported by src/main/menu.ts, e.g.
 * SETTINGS_MENU_ITEM_ID = 'app.settings') the way a real click does: with the app's first window
 * as the window it was clicked for. Playwright cannot press menu accelerators, and `item.click()`
 * without a window would leave the handler to the focused window, which an e2e run does not
 * guarantee. Throws when the menu has no such item.
 */
export async function clickMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`the app menu has no item ${itemId}`)
    // The first window the app opened: ids grow with every window.
    const [first] = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)
    if (!first) throw new Error('the app has no window')
    item.click(undefined, first)
  }, id)
}
