// The `layout` domain: a Project's Canvas Layout, written only by main (ADR-0003).
// Handled in src/main/ipc/layout.ts (ADR-0006).
import { z } from 'zod'
import { layoutOpSchema, layoutStateSchema } from '../layout/types'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

/**
 * The screen a change comes from (src/renderer/canvas/screen.ts): a window of worfy with a Canvas,
 * here or on a Linked machine. Only the Canvas's recorded gestures and their undo and redo send
 * it; main, agents and the renderer's automatic writers change the Layout without one.
 */
export const screenIdSchema = z.string().min(1).max(100)

export const layoutGet = invokeChannel('layout.get', z.object({ projectId }), layoutStateSchema, 'project', 'read')

/**
 * Applies one operation and answers with the Layout after it. A refused operation (a locked Node
 * to remove, an id that is not there) comes back as {ok:false} with the reason.
 */
export const layoutApply = invokeChannel('layout.apply', z.object({ projectId, op: layoutOpSchema, screen: screenIdSchema.optional() }), layoutStateSchema, 'project', 'write')

/**
 * One change of a Project's Layout as every window hears of it: the Layout after it, the operation
 * that made it and the screen that sent the operation, null when it came without one (main, an
 * agent, an automatic writer). The undo history uses the last two (worfy-link ticket 07).
 */
export const layoutChangeSchema = layoutStateSchema.extend({ screen: screenIdSchema.nullable(), op: layoutOpSchema })
export type LayoutChangeEvent = z.output<typeof layoutChangeSchema>

/** Sent to every window after any change of any Project's Layout, whoever made it. */
export const layoutChanged = eventChannel('layout.changed', layoutChangeSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'layout.get': typeof layoutGet
    'layout.apply': typeof layoutApply
    'layout.changed': typeof layoutChanged
  }
}
