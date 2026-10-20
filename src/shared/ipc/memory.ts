// The `memory` domain: how much memory worfy's own processes use (src/shared/memory.ts). A window
// that shows the figure opens it and then receives `memory.changed` about every 5 s until it closes
// it or is gone; main samples only while some window has it open and the `memoryIndicator` setting
// is on (src/main/diagnostics/memory.ts). Every channel is `local`: the figure is of this Machine's
// own app, and a Linked machine never reaches it.
import { z } from 'zod'
import { memoryUsageSchema } from '../memory'
import { eventChannel, invokeChannel } from './channels'

/** Starts the samples for the calling window; answers the latest one, null while there is none. */
export const memoryOpen = invokeChannel('memory.open', z.void(), memoryUsageSchema.nullable(), 'local')

/** Stops the samples for the calling window: it no longer shows the figure. */
export const memoryClose = invokeChannel('memory.close', z.void(), z.void(), 'local')

/** A new sample. */
export const memoryChanged = eventChannel('memory.changed', memoryUsageSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'memory.open': typeof memoryOpen
    'memory.close': typeof memoryClose
    'memory.changed': typeof memoryChanged
  }
}
