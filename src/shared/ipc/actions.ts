// The `actions` domain (ticket 23): "Ship ticket" and "Run wave" from the Canvas. worfy starts the
// work with the same skills the terminal does and never writes a Ticket's status itself (ADR 0002):
// main reads the Project's action template, fills it in (src/shared/actions/render-template.ts)
// and sends the text — to a new Session in the Project's root, or to the Project's Orchestrator.
// Run by src/main/actions/launch.ts, handled in src/main/ipc/actions.ts (ADR-0006). "Open PR" needs
// no channel of its own: it is `shell.openExternal`.
import { z } from 'zod'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

const canvasSpot = z.object({ x: z.number().finite(), y: z.number().finite() })

/**
 * Starts a new Session in the Project's root (as "New session" does) and sends it the rendered
 * "Ship ticket" template; the Session is bound to the Ticket. Refused, with the reason the button
 * shows, when the Ticket is not open, a Session launched for it is still live, a blocker is not
 * done, or the template is empty or fails.
 *
 * `near` (worfy-daily ticket 28): the top-left corner the Session Node may not go left of or above,
 * in canvas units. Only the renderer knows where the Epic frames and the Ticket are drawn
 * (ADR-0032), so it sends the spot right of the frames' column, one FRAME_GAP off its right edge, at
 * the Ticket's height; main puts the Node on the first clear spot there, from that height down.
 * Without it the Node goes where every new Node goes.
 */
export const actionsShipTicket = invokeChannel(
  'actions.shipTicket',
  z.object({ projectId, epic: epicNameSchema, num: ticketNumSchema, near: canvasSpot.optional() }),
  z.object({
    /** The new Session Node. */
    nodeId: z.string().min(1),
    /** The live Session's id for the `agent.*` channels (temporary until Claude Code reports its own). */
    sessionId: z.string().min(1),
    /** What was sent. */
    text: z.string().min(1),
  }),
  'project',
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
  'project',
)

/**
 * The Tickets of a Project that "Ship ticket" has a live Session for. Main keeps them from the
 * launch until that Session closes: the Ticket stays open until the launched agent runs
 * `ticket claim`, and a second launch meanwhile would put two agents on one Ticket. `revision`
 * grows with every change of any Project; a client keeps the snapshot with the highest one.
 */
const launchesSchema = z.object({
  projectId,
  revision: z.number().int().nonnegative(),
  tickets: z.array(z.object({ epic: epicNameSchema, num: ticketNumSchema })),
})
export type LaunchesSnapshot = z.infer<typeof launchesSchema>

export const actionsLaunches = invokeChannel('actions.launches', z.object({ projectId }), launchesSchema, 'project')

/** Sent to every window whenever a Project's launched Tickets change. */
export const actionsLaunchesChanged = eventChannel('actions.launches.changed', launchesSchema, 'project')

declare module './channels' {
  interface IpcContract {
    'actions.shipTicket': typeof actionsShipTicket
    'actions.runWave': typeof actionsRunWave
    'actions.launches': typeof actionsLaunches
    'actions.launches.changed': typeof actionsLaunchesChanged
  }
}
