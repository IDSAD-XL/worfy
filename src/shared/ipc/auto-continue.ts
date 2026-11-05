// The `autoContinue` domain (worfy-retry ticket 02): the Auto-continue item of the Modes menu under the
// Orchestrator's input field (src/renderer/session/modes/auto-continue.ts). Whether Auto-continue is on
// for a Project is a setting of this Machine in app-settings.json of worfy's data folder (`autoContinue`
// of src/shared/settings/app-settings.ts), as Auto-approval is: off by default, on only for the Projects
// the person turned it on for. The retry of the Orchestrator's turn (tickets 04–06) reads it in main with
// autoContinueOn() of src/main/settings/store.ts. The channels are `project` (worfy-retry ticket 13):
// a window that shows a Linked machine reads and sets the setting of that Machine's Project through the
// link, and it is written in app-settings.json of that Machine. Reading and the change event are `read`,
// open with read-only access; setting is `write`, open only with full access.
import { z } from 'zod'
import { autoApprovalProjectIdSchema } from '../settings/app-settings'
import { eventChannel, invokeChannel } from './channels'

/** The setting of a Project as the item shows it. */
export const autoContinueStateSchema = z.object({ on: z.boolean() })
export type AutoContinueState = z.infer<typeof autoContinueStateSchema>

/** Whether Auto-continue is on for Project `projectId`: off while it has no entry. Writes nothing. */
export const autoContinueRead = invokeChannel('autoContinue.read', z.object({ projectId: autoApprovalProjectIdSchema }), autoContinueStateSchema, 'project', 'read')

/** Turns Auto-continue of Project `projectId` on or off: the click of the item. Answers the setting after it. */
export const autoContinueSet = invokeChannel('autoContinue.set', z.object({ projectId: autoApprovalProjectIdSchema, on: z.boolean() }), autoContinueStateSchema, 'project', 'write')

/**
 * Sent to every client of the Project's Machine — its windows and the Linked machines with access — when
 * the setting of a Project changes, so an open menu shows it at once.
 */
export const autoContinueChanged = eventChannel('autoContinue.changed', z.object({ projectId: autoApprovalProjectIdSchema, on: z.boolean() }), 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'autoContinue.read': typeof autoContinueRead
    'autoContinue.set': typeof autoContinueSet
    'autoContinue.changed': typeof autoContinueChanged
  }
}
