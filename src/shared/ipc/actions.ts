// The `actions` domain (ticket 23): "Ship ticket" and "Run wave" from the Canvas. worfy starts the
// work with the same skills the terminal does and never writes a Ticket's status itself (ADR 0002):
// main reads the Project's action template, fills it in (src/shared/actions/render-template.ts)
// and sends the text — to a new Session in the Project's root, or to the Project's Orchestrator.
// Run by src/main/actions/launch.ts, handled in src/main/ipc/actions.ts (ADR-0006). "Open PR" needs
// no channel of its own: it is `shell.openExternal`.
import { z } from 'zod'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
import { invokeChannel } from './channels'

const projectId = z.string().min(1)

/**
 * Starts a new Session in the Project's root (as "New session" does) and sends it the rendered
 * "Ship ticket" template; the Session is bound to the Ticket. Refused, with the reason the button
 * shows, when the Ticket is not open, a blocker is not done, or the template is empty or fails.
 */
export const actionsShipTicket = invokeChannel(
  'actions.shipTicket',
  z.object({ projectId, epic: epicNameSchema, num: ticketNumSchema }),
  z.object({
    /** The new Session Node. */
    nodeId: z.string().min(1),
    /** The live Session's id for the `agent.*` channels (temporary until Claude Code reports its own). */
    sessionId: z.string().min(1),
    /** What was sent. */
    text: z.string().min(1),
  }),
)

/**
 * Sends the rendered "Run wave" template to the Project's Orchestrator — into its queue while a
 * turn runs — and binds the Orchestrator to the Epic. Refused when the Epic has no ready Wave or
 * the template is empty or fails.
 */
export const actionsRunWave = invokeChannel(
  'actions.runWave',
  z.object({ projectId, epic: epicNameSchema }),
  z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    /** `queued`: the Orchestrator was busy, the text waits in its queue (ticket 19). */
    delivery: z.enum(['sent', 'queued']),
  }),
)

declare module './channels' {
  interface IpcContract {
    'actions.shipTicket': typeof actionsShipTicket
    'actions.runWave': typeof actionsRunWave
  }
}
