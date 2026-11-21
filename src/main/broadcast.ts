// Sending to every client of the app (src/main/clients.ts): the open windows and the clients
// without a window. For what belongs to the app rather than to one window — the Layout, the
// Project list, the Orchestrator (agent/app-orchestrators.ts), the Sessions of Session Nodes
// (agent/app-node-sessions.ts), Autopilot and the rest of the `*.changed` events. An Integration's sign-in
// window is not one of them: its page is a service's (src/main/sign-in-windows.ts), and no event of worfy goes
// into that process (appWindowContents, which the link's and the Linked machines' events use too).
import { BrowserWindow } from 'electron'
import { ClientRegistry, type Client } from './clients'
import { appWindows } from './sign-in-windows'

/** The webContents of every live window of worfy's own: not an Integration's sign-in window. */
export function appWindowContents(): Client[] {
  const live: Client[] = []
  for (const window of appWindows(BrowserWindow.getAllWindows())) {
    if (window.isDestroyed()) continue
    // Optional: the fake windows of contract tests carry a webContents with `send` alone.
    if (window.webContents.isDestroyed?.() === true) continue
    live.push(window.webContents)
  }
  return live
}

/** The app's clients. */
export const clients = new ClientRegistry(appWindowContents)

/** Adds a client without a window; it leaves the app's clients when it emits `destroyed`. */
export function addClient(client: Client): void {
  clients.add(client)
}

/** Sends one event to every live client, windows and clients without a window; a client that fails does not stop the others. */
export function toEveryWindow(send: (target: Client) => void): void {
  clients.broadcast(send)
}
