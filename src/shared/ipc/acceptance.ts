// The `acceptance` domain (worfy-acceptance ticket 01): the checks that wait for the owner in every Project of the
// Machine, in one answer and in groups — the manual items of the Tickets' done sections that have no `[x]` and are not
// verified, and the Tickets blocked with `Waits: owner` that have none. main keeps one service for all of it
// (src/main/acceptance/service.ts) over the workflow hub, which watches the Ticket files; the renderer only draws
// what it is sent. Read-only (ADR-0002, ADR-0005); the main process side is src/main/ipc/acceptance.ts.
import { z } from 'zod'
import { evidenceItemSchema, ticketStateSchema } from '../workflow/types'
import { eventChannel, invokeChannel } from './channels'

/**
 * The groups, in the order the owner sees them (spec, "Groups"):
 *   ready   — Ready to check: the item waits and its change can be looked at (merged, or the Ticket waits for the owner);
 *   update  — Update first: the same, but the Stable copy is older than the change (the row's `stable` line says so);
 *   waits   — Waits for you: a Ticket blocked with `Waits: owner` and no item waiting: a decision, not a check;
 *   failed  — Failed: a manual item whose last Evidence line is `fail`;
 *   work    — In work: the item waits, and the change is not merged;
 *   older   — Older: items of Tickets closed more than 14 days ago (spec Q1).
 */
export const ACCEPTANCE_GROUPS = ['ready', 'update', 'waits', 'failed', 'work', 'older'] as const
export const acceptanceGroupNameSchema = z.enum(ACCEPTANCE_GROUPS)
export type AcceptanceGroupName = z.infer<typeof acceptanceGroupNameSchema>

/** A decision the owner sent that no `owner-check` line in the checkout records yet (src/main/acceptance/sent-store.ts). */
export const acceptanceSentSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  /** When it was sent (ISO). */
  at: z.iso.datetime(),
  /** `sent`: waits for the line; `not-recorded`: 24 hours have passed without it ("Not recorded yet", Send again). */
  state: z.enum(['sent', 'not-recorded']),
})
export type AcceptanceSent = z.infer<typeof acceptanceSentSchema>

/**
 * The Stable copy line of an item (worfy-acceptance ticket 02, src/main/acceptance/stable-line.ts), for a Ticket of
 * Ready to check or Update first. In a Project whose repository is worfy's own:
 *   in          — the merge is in the Stable copy: "In your Stable copy 0.4.N — the change is there since 0.4.M";
 *   out         — it is not yet: "Not in your Stable copy yet: it runs 0.4.K, the change is in 0.4.M"; the item is in Update first;
 *   not-checked — no answer: a commit not in the checkout (worfy never fetches), no Stable copy, or GitHub refused.
 * Any other Project has no Stable copy: `merged` ("merged #N") or `not-merged`.
 */
export const acceptanceStableSchema = z.object({
  state: z.enum(['in', 'out', 'not-checked', 'merged', 'not-merged']),
  /** The line as the view shows it. */
  text: z.string(),
  /**
   * Only for `out`: `available` — an Available update has the change, the view offers Update worfy; `waits-ci` — none
   * has it yet, the view says MAIN_WAITS_FOR_CI; `no-update-check` — this copy does not check for updates (a dev run:
   * Update is on only in the Stable copy), so it cannot know, and the view says NO_UPDATE_CHECK; `update-not-here` — the
   * Available update's commit is not in this checkout, so whether it has the change is not known (UPDATE_NOT_HERE).
   * Null for the other states.
   */
  update: z.enum(['available', 'waits-ci', 'no-update-check', 'update-not-here']).nullable(),
})
export type AcceptanceStable = z.infer<typeof acceptanceStableSchema>

/** What Update first says of an item whose change no Available update has yet. */
export const MAIN_WAITS_FOR_CI = '`main` waits for a green CI'

/** What Update first says in a copy that does not check for updates: whether one is there is not known here. */
export const NO_UPDATE_CHECK = 'This copy does not check for updates: update from your Stable copy'

/** What Update first says when the Available update's commit is not in this checkout (worfy never fetches). */
export const UPDATE_NOT_HERE = "The update's commit is not in this checkout: fetch to check"

/** The Ticket a row belongs to, and its Project. */
export const acceptanceTicketSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string(),
  epic: z.string().min(1),
  num: z.number().int().nonnegative(),
  title: z.string(),
  state: ticketStateSchema,
  /** The `PR: #N` line; null without one. */
  pr: z.number().int().positive().nullable(),
  /** The `Blocked reason:` line; null without one. */
  blockedReason: z.string().nullable(),
})
export type AcceptanceTicket = z.infer<typeof acceptanceTicketSchema>

export const acceptanceItemRowSchema = z.object({
  kind: z.literal('item'),
  ticket: acceptanceTicketSchema,
  /** The manual item that waits, with its Evidence lines and state. */
  item: evidenceItemSchema,
  /** The items of the Ticket that are not manual: what the agents and the Orchestrator prepared. */
  prepared: z.array(evidenceItemSchema),
  /** The decision sent and not recorded yet; null when none is. */
  sent: acceptanceSentSchema.nullable(),
  /** The Stable copy line of the item in Ready to check and Update first; null in the other groups, and while not known yet. */
  stable: acceptanceStableSchema.nullable(),
})

export const acceptanceTicketRowSchema = z.object({
  kind: z.literal('ticket'),
  ticket: acceptanceTicketSchema,
})

export const acceptanceRowSchema = z.discriminatedUnion('kind', [acceptanceItemRowSchema, acceptanceTicketRowSchema])
export type AcceptanceRow = z.infer<typeof acceptanceRowSchema>
export type AcceptanceItemRow = z.infer<typeof acceptanceItemRowSchema>

/** One group with its rows, by Project (in the order of the Project list), Epic, Ticket number and item number. */
export const acceptanceGroupSchema = z.object({ group: acceptanceGroupNameSchema, rows: z.array(acceptanceRowSchema) })
export type AcceptanceGroup = z.infer<typeof acceptanceGroupSchema>

export const acceptanceStateSchema = z.object({
  /** Every group of ACCEPTANCE_GROUPS, in that order, an empty one too; its count is the number of its rows. */
  groups: z.array(acceptanceGroupSchema),
})
export type AcceptanceState = z.infer<typeof acceptanceStateSchema>

/**
 * The queue of every Project of the Machine, and from now on `acceptance.changed` to the calling window whenever it
 * changes, until the window is gone. No Project in the request: the view is over every Project, as `projectPulse.get`.
 */
export const acceptanceGet = invokeChannel('acceptance.get', z.void(), acceptanceStateSchema, 'project', 'read')

/** The whole queue again, after a change of any Project's Tickets or of a Sent mark. */
export const acceptanceChanged = eventChannel('acceptance.changed', acceptanceStateSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'acceptance.get': typeof acceptanceGet
    'acceptance.changed': typeof acceptanceChanged
  }
}
