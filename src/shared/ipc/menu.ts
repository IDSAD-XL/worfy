// The `menu` domain: an item of the app menu (src/main/menu.ts) that needs the window's renderer
// tells that one window, and the renderer carries the command out. `local`: the menu belongs to
// the machine whose screen shows it, so the command never goes to a Linked machine.
import { z } from 'zod'
import { eventChannel } from './channels'

/**
 * What a menu item asks the window for. `settings` opens the Settings window; `toggleSidebar` hides
 * or shows the sidebar in what the window shows now, the normal view or focus mode.
 */
export const MENU_COMMANDS = ['settings', 'toggleSidebar'] as const
export const menuCommandSchema = z.enum(MENU_COMMANDS)
export type MenuCommand = z.output<typeof menuCommandSchema>

/** Sent to one window: the one the menu item was clicked for, else the focused one. */
export const menuCommand = eventChannel('menu.command', menuCommandSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'menu.command': typeof menuCommand
  }
}
