// The `notify` domain (ticket 21): main shows a macOS notification when a Session finished its
// turn or waits for a permission answer while no worfy window has focus (src/main/notify.ts). A
// click on it raises the window (or opens one) and main keeps the note until that window's
// renderer takes it (`notify.pending`); the renderer opens that Session
// (src/renderer/canvas/overlays/NotificationTarget.tsx). `notify.open` carries no Session: it only
// tells a mounted overlay to take the note now. An overlay that is not mounted yet misses it and
// takes the note when it mounts, so a signal lost to a loading page loses nothing.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

export const notifyOpenSchema = z.object({
  /** A Session worfy runs (its id for `agent.*` or its SDK id), or a Session from the registry under ~/.claude. */
  sessionId: z.string().min(1),
  /** The Project root of a Session from the registry; null for a Session worfy runs. */
  projectRoot: z.string().min(1).nullable(),
})
export type NotifyOpen = z.output<typeof notifyOpenSchema>

/** Sent to the window a click on a notification raised: take the note with `notify.pending` now. */
export const notifyOpen = eventChannel('notify.open', z.object({}))

/** The note a click left for the window it opened, taken once; null when there is none. */
export const notifyPending = invokeChannel('notify.pending', z.void(), z.object({ note: notifyOpenSchema.nullable() }))

declare module './channels' {
  interface IpcContract {
    'notify.open': typeof notifyOpen
    'notify.pending': typeof notifyPending
  }
}
