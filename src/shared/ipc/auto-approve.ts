// The `autoApproval` domain (worfy-auto-approve ticket 06): the Auto-approval switch in the bar under
// the Orchestrator's input field (src/renderer/session/modes/auto-approval.ts). The mode of a
// Project — Off, Shadow or On — is a setting of this Machine in app-settings.json of worfy's data
// folder (`autoApproval` of src/shared/settings/app-settings.ts), not a field of the Profile: an agent
// rewrites a Profile with a plain command, and the mode decides whether worfy answers the agent's
// permission requests (spec of the Epic, "decided without the owner", item 3; "security", item 5).
// The read and the write are `project` channels (worfy-retry ticket 13): a window that shows a Linked
// machine reads and sets the mode of that Machine's Project through the link, and the mode is written in
// app-settings.json of that Machine. Reading is `read`, open with read-only access; setting is `write`,
// open only with full access. A change reaches every client of that Machine as `autoApproval.changed`.
// A window is not the only caller a channel can have, though: while worfy runs with a debugging port
// open, any local process can script the window. Then only Off is in force and only Off can be set
// (debugAccess() of src/main/settings/store.ts) — on the Machine of the Project by its own handler, and on
// a Machine whose window calls a Linked machine by its `linked.invoke` (src/main/ipc/linked.ts), which
// lets only Off out; `autoApproval.blockedHere` tells that window why.
import { z } from 'zod'
import { autoApprovalModeSchema, autoApprovalProjectIdSchema } from '../settings/app-settings'
import { eventChannel, invokeChannel } from './channels'

/** The mode of a Project as the switch shows it. */
export const autoApprovalStateSchema = z.object({
  /** The mode in force: `saved`, or Off while `blocked`. */
  mode: autoApprovalModeSchema,
  /** The mode written in app-settings.json. */
  saved: autoApprovalModeSchema,
  /**
   * Why only Off can be in force and be set in this run of worfy: it runs with a debugging port or the
   * Node inspector open, so any local process could call this channel as the window does. null — nothing.
   */
  blocked: z.string().nullable(),
})
export type AutoApprovalState = z.infer<typeof autoApprovalStateSchema>

/** The mode of Project `projectId`: Off while it has none. Writes nothing. */
export const autoApprovalRead = invokeChannel('autoApproval.read', z.object({ projectId: autoApprovalProjectIdSchema }), autoApprovalStateSchema, 'project', 'read')

/** Sets the mode of Project `projectId`: the click of the switch. Shadow and On are refused while `blocked`. Answers the state after it. */
export const autoApprovalSet = invokeChannel(
  'autoApproval.set',
  z.object({ projectId: autoApprovalProjectIdSchema, mode: autoApprovalModeSchema }),
  autoApprovalStateSchema,
  'project',
  'write',
)

/** Sent to every client of the Project's Machine when a write changed the saved mode, so an open menu shows it at once. */
export const autoApprovalChanged = eventChannel('autoApproval.changed', z.object({ projectId: autoApprovalProjectIdSchema, state: autoApprovalStateSchema }), 'project', 'read')

/**
 * Why a window of this Machine cannot set Shadow or On on a Linked machine: this run of worfy has a
 * debugging port or the Node inspector open (debugAccess()); null — nothing. `local`: it is this
 * Machine's own run, asked by a window that shows a Linked machine.
 */
export const autoApprovalBlockedHere = invokeChannel('autoApproval.blockedHere', z.void(), z.object({ blocked: z.string().nullable() }), 'local')

/** Why Shadow and On are refused while `blocked`: the text of both Machines' refusals. */
export const autoApprovalDebugRefusal = (blocked: string): string => `Auto-approval stays off: ${blocked}, so any program on this Machine could call this channel`

declare module './channels' {
  interface IpcContract {
    'autoApproval.read': typeof autoApprovalRead
    'autoApproval.set': typeof autoApprovalSet
    'autoApproval.changed': typeof autoApprovalChanged
    'autoApproval.blockedHere': typeof autoApprovalBlockedHere
  }
}
