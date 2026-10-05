// The `view` domain: what the app's View menu shows or hides in the window. The menu lives in
// main (src/main/ipc/view.ts); the renderer asks for the state once and follows its changes.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

export const viewStateSchema = z.object({
  /** View ▸ Show Minimap: the minimap at the bottom right of the Canvas (ticket 29). */
  minimap: z.boolean(),
})
export type ViewState = z.output<typeof viewStateSchema>

export const viewGet = invokeChannel('view.get', z.void(), viewStateSchema)

/** Sent to every window when an item of the View menu is switched. */
export const viewChanged = eventChannel('view.changed', viewStateSchema)

declare module './channels' {
  interface IpcContract {
    'view.get': typeof viewGet
    'view.changed': typeof viewChanged
  }
}
