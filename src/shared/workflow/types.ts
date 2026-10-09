// The workflow model of a Project: its Epics and Tickets as `epic-status --json` reports them,
// plus the two things that script does not carry: the files listed under a Ticket's
// "Где в коде" section and the Epic's title from spec.md (ADR-0002: worfy reads the workflow,
// it never owns it). In Silent mode both come from the Workflow folder (ADR-0042).
import { z } from 'zod'

/** Ticket state as epic-status classifies the raw `Status:` value. */
export const ticketStateSchema = z.enum(['open', 'work', 'blocked', 'done', 'none'])
export type TicketState = z.infer<typeof ticketStateSchema>

/** One Epic in `epic-status --json`. */
export const epicStatusEpicSchema = z.object({
  epic: z.string().min(1),
  hasSpec: z.boolean(),
  hasMap: z.boolean(),
})

/** One Ticket in `epic-status --json`. */
export const epicStatusTicketSchema = z.object({
  epic: z.string().min(1),
  num: z.number().int().nonnegative(),
  slug: z.string(),
  title: z.string(),
  statusRaw: z.string().nullable(),
  state: ticketStateSchema,
  blockedRaw: z.string().nullable(),
  blockedNums: z.array(z.number().int().nonnegative()),
  blockedParsed: z.boolean(),
  /**
   * The Ticket's `Branch:` line (worfy-harness ticket 22): the branch it is worked in. In Silent mode
   * the branch is named by the change, so only this line ties it to the Ticket; null or absent
   * without the line, absent from a Harness before Silent mode.
   */
  branch: z.string().nullable().optional(),
  /** The Ticket's `Repo:` line: the repository of a Project over several repositories (ADR-0045). */
  repo: z.string().nullable().optional(),
})

/** The whole answer of `epic-status --json [--ref <branch>]`. Unknown keys are dropped. */
export const epicStatusSchema = z.object({
  ref: z.string(),
  epics: z.array(epicStatusEpicSchema),
  tickets: z.array(epicStatusTicketSchema),
})
export type EpicStatusSnapshot = z.infer<typeof epicStatusSchema>

export const epicSchema = epicStatusEpicSchema.extend({
  /** The H1 of the Epic's spec.md, without the leading `#`; null when there is no spec or no H1. */
  title: z.string().nullable(),
})
export type Epic = z.infer<typeof epicSchema>

export const ticketSchema = epicStatusTicketSchema.extend({
  /** Paths in backticks from the list items of the "Где в коде" section, in file order. */
  files: z.array(z.string()),
  /** False when the Ticket has no "Где в коде" section at all ("files not listed"). */
  filesListed: z.boolean(),
  /**
   * Set when `state` and `statusRaw` come from a worktree branch rather than the Project's
   * checkout: the Ticket was claimed in that branch and the change has not reached the checkout.
   */
  fromBranch: z.string().nullable(),
})
export type Ticket = z.infer<typeof ticketSchema>

/** Why the model is empty. `message` is shown in the UI as is. */
export const workflowErrorSchema = z.object({
  code: z.enum(['not-found', 'failed', 'invalid-output']),
  message: z.string(),
})
export type WorkflowError = z.infer<typeof workflowErrorSchema>

/** A worktree branch whose snapshot could not be read; the checkout's values stand for its Ticket. */
export const branchErrorSchema = z.object({ branch: z.string(), message: z.string() })
export type BranchError = z.infer<typeof branchErrorSchema>

export const workflowModelSchema = z.object({
  /** Absolute path of the Project root: its repository, or the folder above its repositories (ADR-0045). */
  root: z.string(),
  epics: z.array(epicSchema),
  tickets: z.array(ticketSchema),
  /** Null when the read succeeded; otherwise the model is empty and this says why. */
  error: workflowErrorSchema.nullable(),
  branchErrors: z.array(branchErrorSchema),
})
export type WorkflowModel = z.infer<typeof workflowModelSchema>

/** What changed between two reads of one Project; only these Epics and Tickets are sent. */
export const workflowDeltaSchema = z.object({
  root: z.string(),
  epics: z.array(epicSchema),
  tickets: z.array(ticketSchema),
  removedEpics: z.array(z.string()),
  removedTickets: z.array(z.object({ epic: z.string(), num: z.number().int().nonnegative() })),
  error: workflowErrorSchema.nullable(),
  branchErrors: z.array(branchErrorSchema),
})
export type WorkflowDelta = z.infer<typeof workflowDeltaSchema>

/** The key that identifies a Ticket across reads: Epic name and number. */
export const ticketKey = (ticket: { epic: string; num: number }): string => `${ticket.epic}/${ticket.num}`

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Compares two reads of one Project. Returns null when nothing changed. */
export function diffModels(previous: WorkflowModel | null, next: WorkflowModel): WorkflowDelta | null {
  const oldEpics = new Map((previous?.epics ?? []).map((epic) => [epic.epic, epic]))
  const newEpics = new Set(next.epics.map((epic) => epic.epic))
  const oldTickets = new Map((previous?.tickets ?? []).map((ticket) => [ticketKey(ticket), ticket]))
  const newTickets = new Set(next.tickets.map(ticketKey))

  const epics = next.epics.filter((epic) => !same(oldEpics.get(epic.epic), epic))
  const tickets = next.tickets.filter((ticket) => !same(oldTickets.get(ticketKey(ticket)), ticket))
  const removedEpics = [...oldEpics.keys()].filter((name) => !newEpics.has(name))
  const removedTickets = [...oldTickets.entries()]
    .filter(([key]) => !newTickets.has(key))
    .map(([, ticket]) => ({ epic: ticket.epic, num: ticket.num }))
  const errorChanged = !same(previous?.error ?? null, next.error)
  const branchErrorsChanged = !same(previous?.branchErrors ?? [], next.branchErrors)

  const nothing = !epics.length && !tickets.length && !removedEpics.length && !removedTickets.length
  if (nothing && !errorChanged && !branchErrorsChanged && previous !== null) return null
  return { root: next.root, epics, tickets, removedEpics, removedTickets, error: next.error, branchErrors: next.branchErrors }
}
