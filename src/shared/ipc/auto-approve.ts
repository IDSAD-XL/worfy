// The `autoApproval` domain (worfy-auto-approve ticket 06): the Auto-approval switch in the bar under
// the Orchestrator's input field (src/renderer/session/composer/AutoApprove.tsx). The mode of a
// Project — Off, Shadow or On — is a setting of this Machine in app-settings.json of worfy's data
// folder (`autoApproval` of src/shared/settings/app-settings.ts), not a field of the Profile: an agent
// rewrites a Profile with a plain command, and the mode decides whether worfy answers the agent's
// permission requests (spec of the Epic, "decided without the owner", item 3; "security", item 5).
// Both channels are `local`: the mode is read and written only by a window of the Machine the
// Project lives on, never from a Linked machine. A window is not the only caller a `local` channel can
// have, though: while worfy runs with a debugging port open, any local process can script the window.
// Then only Off is in force and only Off can be set (debugAccess() of src/main/settings/store.ts).
import { z } from 'zod'
import { autoApprovalModeSchema, autoApprovalProjectIdSchema } from '../settings/app-settings'
import { invokeChannel } from './channels'

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
export const autoApprovalRead = invokeChannel('autoApproval.read', z.object({ projectId: autoApprovalProjectIdSchema }), autoApprovalStateSchema, 'local')

/** Sets the mode of Project `projectId`: the click of the switch. Shadow and On are refused while `blocked`. Answers the state after it. */
export const autoApprovalSet = invokeChannel('autoApproval.set', z.object({ projectId: autoApprovalProjectIdSchema, mode: autoApprovalModeSchema }), autoApprovalStateSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'autoApproval.read': typeof autoApprovalRead
    'autoApproval.set': typeof autoApprovalSet
  }
}
