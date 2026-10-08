// The `linked` domain (worfy-link ticket 09; ADR-0052, ADR-0053): how a window of this Machine
// works with the Projects of a Linked machine. Handled in src/main/ipc/linked.ts.
//
// The renderer never talks to a Linked machine itself. A call meant for Linked machine M goes to
// this Machine's main as `linked.invoke {machine, channel, input}`, and main passes it on over the
// link connection (src/main/link/remote-calls.ts); M's events come back as `linked.event`. Which
// channels go to M is decided by their access mark (src/shared/ipc/channels.ts): `project` and
// `desktop` channels; `local` and `link` ones stay on this Machine.
//
// Every channel here is `local`: they are this Machine's screen talking to its own main, and a
// Linked machine never calls them. The renderer learns a Linked machine's id and nothing else of
// it: no token, certificate or address appears in this contract.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** What a channel answered on the Linked machine, as `invoke` resolves on this one. */
export const linkedResultSchema = z.union([z.object({ ok: z.literal(true), value: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })])

const channelName = z.string().min(1).max(200)

/**
 * Calls `channel` on Linked machine `machine`. Only `project` and `desktop` channels go; anything
 * else, a Machine that is not linked or not reachable answers `{ok:false}` inside the value.
 */
export const linkedInvoke = invokeChannel('linked.invoke', z.object({ machine: z.uuid(), channel: channelName, input: z.unknown() }), linkedResultSchema, 'local')

/** An event of Linked machine `machine` on its channel `channel` (a `project` channel there). */
export const linkedEvent = eventChannel('linked.event', z.object({ machine: z.uuid(), channel: channelName, payload: z.unknown() }), 'local')

/** What this Machine knows of a Linked machine beyond the link state (src/shared/ipc/link.ts). */
export const linkedMachineSchema = z.object({
  id: z.uuid(),
  /** A connection to it is open. */
  online: z.boolean(),
  /** Whether it lets Linked machines work with its Projects; `unknown` until it said so. */
  sharing: z.enum(['yes', 'no', 'unknown']),
  /**
   * Changes whenever what a window sees of the Machine starts afresh: another connection carries
   * the calls (what the old one subscribed to is gone), or sharing came back on. A window showing
   * this Machine loads again then.
   */
  epoch: z.number().int().nonnegative(),
})
export type LinkedMachineInfo = z.output<typeof linkedMachineSchema>

export const linkedStateSchema = z.object({
  /** Grows with every change in main; a window keeps the state with the highest revision. */
  revision: z.number().int().nonnegative(),
  machines: z.array(linkedMachineSchema),
})
export type LinkedState = z.output<typeof linkedStateSchema>

export const linkedState = invokeChannel('linked.state', z.void(), linkedStateSchema, 'local')

/** Sent to this Machine's windows after any change of the state. */
export const linkedChanged = eventChannel('linked.changed', linkedStateSchema, 'local')

/**
 * The calling window shows Project `projectId` of Linked machine `machine` (null: none any more).
 * The Linked machine then keeps that Project's Orchestrator and documents open, as it does for its
 * own active Project, while some window shows it (`projects.hold` there).
 */
export const linkedOpen = invokeChannel(
  'linked.open',
  z.object({ machine: z.uuid(), projectId: z.string().min(1).nullable() }),
  z.object({ projectId: z.string().nullable() }),
  'local',
)

declare module './channels' {
  interface IpcContract {
    'linked.invoke': typeof linkedInvoke
    'linked.event': typeof linkedEvent
    'linked.state': typeof linkedState
    'linked.changed': typeof linkedChanged
    'linked.open': typeof linkedOpen
  }
}
