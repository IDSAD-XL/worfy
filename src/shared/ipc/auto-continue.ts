// The `autoContinue` domain (worfy-retry ticket 02): the Auto-continue item of the Modes menu under the
// Orchestrator's input field (src/renderer/session/modes/auto-continue.ts). Whether Auto-continue is on
// for a Project is a setting of this Machine in app-settings.json of worfy's data folder (`autoContinue`
// of src/shared/settings/app-settings.ts), as Auto-approval is: off by default, on only for the Projects
// the person turned it on for. The retry of the Orchestrator's turn (tickets 04–06) reads it in main with
// autoContinueOn() of src/main/settings/store.ts. Every channel is `local`: the setting is read and
// written only by a window of the Machine the Project lives on, never from a Linked machine (until
// ticket 13 opens it through the link).
import { z } from 'zod'
import { autoApprovalProjectIdSchema } from '../settings/app-settings'
import { eventChannel, invokeChannel } from './channels'

/** The setting of a Project as the item shows it. */
export const autoContinueStateSchema = z.object({ on: z.boolean() })
export type AutoContinueState = z.infer<typeof autoContinueStateSchema>

/** Whether Auto-continue is on for Project `projectId`: off while it has no entry. Writes nothing. */
export const autoContinueRead = invokeChannel('autoContinue.read', z.object({ projectId: autoApprovalProjectIdSchema }), autoContinueStateSchema, 'local')

/** Turns Auto-continue of Project `projectId` on or off: the click of the item. Answers the setting after it. */
export const autoContinueSet = invokeChannel('autoContinue.set', z.object({ projectId: autoApprovalProjectIdSchema, on: z.boolean() }), autoContinueStateSchema, 'local')

/** Sent to every window of this Machine when the setting of a Project changes, so an open menu shows it at once. */
export const autoContinueChanged = eventChannel('autoContinue.changed', z.object({ projectId: autoApprovalProjectIdSchema, on: z.boolean() }), 'local')

declare module './channels' {
  interface IpcContract {
    'autoContinue.read': typeof autoContinueRead
    'autoContinue.set': typeof autoContinueSet
    'autoContinue.changed': typeof autoContinueChanged
  }
}
