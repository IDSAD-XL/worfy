// The `notify` domain (ticket 21): main shows a macOS notification when a Session finished its
// turn or waits for a permission answer while no worfy window has focus (src/main/notify.ts). A
// click on it raises the window and sends `notify.open`, and the renderer opens that Session
// (src/renderer/canvas/overlays/NotificationTarget.tsx).
import { z } from 'zod'
import { eventChannel } from './channels'

export const notifyOpenSchema = z.object({
  /** A Session worfy runs (its id for `agent.*` or its SDK id), or a Session from the registry under ~/.claude. */
  sessionId: z.string().min(1),
  /** The Project root of a Session from the registry; null for a Session worfy runs. */
  projectRoot: z.string().min(1).nullable(),
})
export type NotifyOpen = z.output<typeof notifyOpenSchema>

/** Sent to the window a click on a notification raised: open this Session. */
export const notifyOpen = eventChannel('notify.open', notifyOpenSchema)

declare module './channels' {
  interface IpcContract {
    'notify.open': typeof notifyOpen
  }
}
