// Following one command of the app menu (`menu.command`, src/main/menu.ts) in this window. The
// subscription comes first, then `menu.ready` tells main that this page follows the command: main
// holds the commands chosen before that (the window can be on screen before React has mounted) and
// sends them on that call (src/main/ipc/menu.ts). The order matters: a command main sends after the
// call finds the listener in place.
import type { WorfyBridge } from '../shared/ipc/channels'
import type { MenuCommand } from '../shared/ipc/menu'
import { invoke, showSubscribeError, subscribe } from './ipc'

/**
 * Calls `run` each time the app menu sends this window `command`, the ones main held included.
 * Returns the function that unsubscribes. Without the preload bridge (a unit test of the shell) it
 * subscribes to nothing, calls nothing and shows no toast; a subscription that fails with the
 * bridge in place shows the error toast of the other subscribers (showSubscribeError).
 */
export function followMenuCommand(command: MenuCommand, run: () => void): () => void {
  if ((globalThis as { worfy?: WorfyBridge }).worfy === undefined) return () => undefined
  let unsubscribe: () => void
  try {
    unsubscribe = subscribe('menu.command', (sent) => {
      if (sent === command) run()
    })
  } catch (error) {
    showSubscribeError('menu.command', error)
    return () => undefined
  }
  void invoke('menu.ready', command).then((result) => {
    if (!result.ok) console.error(`menu.ready: main does not send '${command}' to this window: ${result.error}`)
  })
  return unsubscribe
}
