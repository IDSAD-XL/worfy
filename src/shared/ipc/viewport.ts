// The `viewport` domain: the camera of a Project's Canvas on this machine's screens (worfy-link
// ticket 06). It is not part of the Layout: each machine keeps its own, in its own data folder, and
// a pan changes nothing other screens see. Handled in src/main/ipc/viewport.ts (ADR-0006).
//
// No event: another screen has no use for this one's camera. Both channels are state of the
// machine the screen runs on, not of a Project's machine, so a Linked machine is not given them.
import { z } from 'zod'
import { viewportSchema } from '../layout/types'
import { invokeChannel } from './channels'

const projectId = z.string().min(1)

/**
 * The saved camera of the Project's Canvas; while there is none, the `viewport` of the Project's
 * layout.json, so the first opening after an update shows the Canvas where it was.
 */
export const viewportGet = invokeChannel('viewport.get', z.object({ projectId }), viewportSchema, 'local')

/** Saves the camera of the Project's Canvas, as the screen has it when a pan or zoom ends. */
export const viewportSet = invokeChannel('viewport.set', z.object({ projectId, viewport: viewportSchema }), z.void(), 'local')

declare module './channels' {
  interface IpcContract {
    'viewport.get': typeof viewportGet
    'viewport.set': typeof viewportSet
  }
}
