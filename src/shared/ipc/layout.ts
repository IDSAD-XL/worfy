// The `layout` domain: a Project's Canvas Layout, written only by main (ADR-0003).
// Handled in src/main/ipc/layout.ts (ADR-0006).
import { z } from 'zod'
import { layoutOpSchema, layoutStateSchema } from '../layout/types'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

export const layoutGet = invokeChannel('layout.get', z.object({ projectId }), layoutStateSchema)

/**
 * Applies one operation and answers with the Layout after it. A refused operation (a locked Node
 * to remove, an id that is not there) comes back as {ok:false} with the reason.
 */
export const layoutApply = invokeChannel('layout.apply', z.object({ projectId, op: layoutOpSchema }), layoutStateSchema)

/** Sent to every window after any change of any Project's Layout, whoever made it. */
export const layoutChanged = eventChannel('layout.changed', layoutStateSchema)

declare module './channels' {
  interface IpcContract {
    'layout.get': typeof layoutGet
    'layout.apply': typeof layoutApply
    'layout.changed': typeof layoutChanged
  }
}
