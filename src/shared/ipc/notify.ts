// The `notify` domain (ticket 21): main shows a macOS notification when a Session finished its
// turn or waits for a permission answer while no worfy window has focus (src/main/notify.ts). A
// click on it raises the window and sends `notify.open`, and the renderer opens that Session
// (src/renderer/canvas/overlays/NotificationTarget.tsx). When no window was open, the click opens
// a new one and main keeps the note until that window's renderer asks for it (`notify.pending`):
// an event sent before the renderer subscribes would be lost.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

export const notifyOpenSchema = z.object({
  /** A Session worfy runs (its id for `agent.*` or its SDK id), or a Session from the registry under ~/.claude. */
  sessionId: z.string().min(1),
  /** The Project root of a Session from the registry; null for a Session worfy runs. */
  projectRoot: z.string().min(1).nullable(),
})
export type NotifyOpen = z.output<typeof notifyOpenSchema>

/** Sent to the window a click on a notification raised: open this Session. */
export const notifyOpen = eventChannel('notify.open', notifyOpenSchema)

/** The note a click left for the window it opened, taken once; null when there is none. */
export const notifyPending = invokeChannel('notify.pending', z.void(), z.object({ note: notifyOpenSchema.nullable() }))

declare module './channels' {
  interface IpcContract {
    'notify.open': typeof notifyOpen
    'notify.pending': typeof notifyPending
  }
}
