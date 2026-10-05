// The `workflow` domain: the Epics and Tickets of a Project, read through epic-status
// (ADR-0002), and the stream of changes to them.
import { z } from 'zod'
import { workflowDeltaSchema, workflowModelSchema } from '../workflow/types'
import { eventChannel, invokeChannel } from './channels'

/** A Project is named by the absolute path of its repository root. */
const projectRoot = z.object({ root: z.string().min(1).startsWith('/', 'root must be an absolute path') })

/**
 * Reads the Project's workflow model and starts sending `workflow.changed` to the calling window
 * until `workflow.close` (or until the window is gone).
 */
export const workflowOpen = invokeChannel('workflow.open', projectRoot, workflowModelSchema)

/** Stops `workflow.changed` for this Project in the calling window. `closed` is false if it was not open. */
export const workflowClose = invokeChannel('workflow.close', projectRoot, z.object({ closed: z.boolean() }))

/** Only the Epics and Tickets that changed since the previous read, plus removals. */
export const workflowChanged = eventChannel('workflow.changed', workflowDeltaSchema)

declare module './channels' {
  interface IpcContract {
    'workflow.open': typeof workflowOpen
    'workflow.close': typeof workflowClose
    'workflow.changed': typeof workflowChanged
  }
}
