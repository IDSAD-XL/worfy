// Sending to every client of the app (src/main/clients.ts): the open windows and the clients
// without a window. For what belongs to the app rather than to one window — the Layout, the
// Project list, the Orchestrator (agent/app-orchestrators.ts), the Sessions of Session Nodes
// (agent/app-node-sessions.ts), Autopilot and the rest of the `*.changed` events.
import { BrowserWindow } from 'electron'
import { ClientRegistry, type Client } from './clients'

/** The webContents of every live window. */
function liveWindows(): Client[] {
  const live: Client[] = []
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    // Optional: the fake windows of contract tests carry a webContents with `send` alone.
    if (window.webContents.isDestroyed?.() === true) continue
    live.push(window.webContents)
  }
  return live
}

/** The app's clients. */
export const clients = new ClientRegistry(liveWindows)

/** Adds a client without a window; it leaves the app's clients when it emits `destroyed`. */
export function addClient(client: Client): void {
  clients.add(client)
}

/** Sends one event to every live client, windows and clients without a window; a client that fails does not stop the others. */
export function toEveryWindow(send: (target: Client) => void): void {
  clients.broadcast(send)
}
