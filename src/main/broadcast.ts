// Sending to every window of the app: for what belongs to the app rather than to one window — the
// Orchestrator (agent/app-orchestrators.ts) and the Sessions of Session Nodes (agent/app-node-sessions.ts).
import { BrowserWindow, type WebContents } from 'electron'

/** Sends one event to every live window; a window that fails does not stop the others. */
export function toEveryWindow(send: (target: WebContents) => void): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    try {
      send(window.webContents)
    } catch (error) {
      console.warn('[main] could not send to a window', error)
    }
  }
}
