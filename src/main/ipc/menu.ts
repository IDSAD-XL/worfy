// Handlers of the `menu` domain (src/shared/ipc/menu.ts), and the delivery of `menu.command` to one
// window (src/main/menu.ts sends through deliverMenuCommand).
//
// A window may be on screen before React has mounted the page: src/main/window.ts shows it at
// 'ready-to-show', and the components that follow the menu subscribe in effects, after the first
// render. A command sent into that gap had no listener in the renderer and was lost: "Settings…"
// chosen right after the window appeared did nothing (worfy-windows ticket 96). So main sends a
// command only once the page has said, with `menu.ready`, that it follows that command; until then
// it holds the command and sends it on that call.
//
// What is held is bounded, so a command never fires long after it was chosen:
// - a held command older than HELD_FOR_MS when the page becomes ready is dropped, with a warning;
// - at most HELD_AT_MOST commands per window, the oldest dropped first;
// - when a new document of the main frame commits ('did-navigate': View ▸ Reload, a dev server
//   reload), what is held and what the old page said it follows are dropped: the new page
//   subscribes and says so again. The reset waits for the commit, not the start of the navigation:
//   a navigation that never commits (a download, a 204, a refused URL) leaves the old page up, and
//   it keeps getting its commands. A `menu.ready` of the old page sent during a reload arrives
//   before the commit, so the commit clears it too;
// - a destroyed window gets nothing.
//
// The order of delivery is kept within one command, not across commands: held commands go out
// when the page becomes ready for their kind, so a held `toggleSidebar` may arrive after a
// `settings` chosen later, when the page said it follows `settings` first.
import { clientOf, type Client } from '../clients'
import { menuCommand, menuReady, type MenuCommand } from '../../shared/ipc/menu'
import { defineHandler, emit, type HandlerModule } from './index'

/** How long a command chosen before the page was ready may wait for it. */
export const HELD_FOR_MS = 10_000
/** How many commands one window may hold at once. */
export const HELD_AT_MOST = 8

/** A window's webContents: a client that also reports the documents its main frame commits. */
export type MenuTarget = Client & {
  on?(event: 'did-navigate', listener: () => void): unknown
}

interface TargetState {
  /**
   * The commands the page of the current document said it follows.
   * shortcut: an unsubscribed follower still counts as ready, redo with a `menu.unready` call when one can unmount before its page unloads.
   * Until then a command sent while its follower is unmounted is lost. Today all three followers
   * live in the app shell for the whole life of the page; an error boundary that replaced the shell
   * while the page stays up would unmount all three and make this real.
   */
  readonly ready: Set<MenuCommand>
  /** The commands chosen before the page followed them, oldest first, with the time they were chosen. */
  held: { command: MenuCommand; at: number }[]
}

const states = new WeakMap<MenuTarget, TargetState>()

/** The state of `target`, made on first use; a new document of the main frame starts it anew. */
function stateOf(target: MenuTarget): TargetState {
  let state = states.get(target)
  if (state === undefined) {
    const fresh: TargetState = { ready: new Set(), held: [] }
    state = fresh
    states.set(target, fresh)
    // Main frame only, and never for a navigation inside the document ('did-navigate-in-page').
    target.on?.('did-navigate', () => {
      fresh.ready.clear()
      fresh.held = []
    })
  }
  return state
}

/** Sends `command` to the page of `target` now if it follows it, else holds it until it does. */
export function deliverMenuCommand(target: MenuTarget, command: MenuCommand): void {
  if (target.isDestroyed()) return
  const state = stateOf(target)
  if (state.ready.has(command)) {
    emit(target, menuCommand, command)
    return
  }
  // performance.now(): a jump of the system clock does not change how long a command waited.
  state.held = [...state.held, { command, at: performance.now() }].slice(-HELD_AT_MOST)
}

/** The page of `target` follows `command` from now on: it gets the held ones of that kind, in order. */
export function menuCommandReady(target: MenuTarget, command: MenuCommand): void {
  if (target.isDestroyed()) return
  const state = stateOf(target)
  state.ready.add(command)
  const now = performance.now()
  const mine = state.held.filter((entry) => entry.command === command)
  state.held = state.held.filter((entry) => entry.command !== command)
  for (const entry of mine) {
    if (now - entry.at <= HELD_FOR_MS) emit(target, menuCommand, entry.command)
    else console.warn(`[menu] '${entry.command}' for window ${String(target.id)} dropped: the page was not ready within ${HELD_FOR_MS} ms`)
  }
}

export default [
  defineHandler(menuReady, (command, { event }) => {
    const target = clientOf(event)
    if (target !== undefined) menuCommandReady(target as MenuTarget, command)
  }),
] satisfies HandlerModule
