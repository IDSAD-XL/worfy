// The `menu` domain: an item of the app menu (src/main/menu.ts) that needs the window's renderer
// tells that one window, and the renderer carries the command out. `local`: the menu belongs to
// the machine whose screen shows it, so the command never goes to a Linked machine.
//
// The window can be on screen before React has mounted the page that follows the commands
// (src/main/window.ts shows it at 'ready-to-show'). Main therefore holds a command until the page
// says, with `menu.ready`, that it follows that command (src/main/ipc/menu.ts), so a menu item
// chosen right after the window appears is carried out rather than lost.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/**
 * What a menu item asks the window for. `settings` opens the Settings window; `toggleSidebar` hides
 * or shows the sidebar in what the window shows now, the normal view or focus mode; `shortcuts`
 * opens the Keyboard shortcuts window (Help ▸ Keyboard Shortcuts); `guide` opens the worfy Guide
 * (Help ▸ worfy Guide, worfy-guide ticket 03).
 */
export const MENU_COMMANDS = ['settings', 'toggleSidebar', 'shortcuts', 'guide'] as const
export const menuCommandSchema = z.enum(MENU_COMMANDS)
export type MenuCommand = z.output<typeof menuCommandSchema>

/** Sent to one window: the one the menu item was clicked for, else the focused one. */
export const menuCommand = eventChannel('menu.command', menuCommandSchema, 'local')

/**
 * The page of the calling window now follows `menu.command` with this command: main sends it the
 * commands of that kind it held, and from now on sends them at once. Called after subscribing.
 */
export const menuReady = invokeChannel('menu.ready', menuCommandSchema, z.void(), 'local')

declare module './channels' {
  interface IpcContract {
    'menu.command': typeof menuCommand
    'menu.ready': typeof menuReady
  }
}
