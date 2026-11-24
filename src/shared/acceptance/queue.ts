// The Acceptance queue (worfy-acceptance ticket 01; spec, "One rule of waiting for the owner" and "Groups"): which
// checks wait for the owner in the workflow models of every Project of the Machine, and in which group each is shown.
// Pure functions: no Node, no DOM. main runs them over the workflow hub's models (src/main/acceptance/service.ts).
//
// - A manual item waits for the owner while it has no `[x]` and is not verified (EvidenceItem, types.ts).
// - A Ticket waits for the owner by itself when it is blocked and Autopilot's Epic queue says so (`ownersOwn`,
//   the one rule, shared): `blocked` with `Waits: owner`. A Ticket with no status, which Autopilot also leaves to
//   the owner, is not an acceptance here.
// - "Merged" is read from the model alone, with no gh or git: the model is read from the Project's main branch
//   (ADR-0107), so a Ticket `done` there, and not done only in its worktree branch, has its change merged. A Ticket
//   done without a PR (Silent mode, `local-green`) reads the same.
import { ownersOwn } from '../autopilot/epic-queue'
import type { AcceptanceGroup, AcceptanceGroupName, AcceptanceRow, AcceptanceSent, AcceptanceStable, AcceptanceTicket } from '../ipc/acceptance'
import { ACCEPTANCE_GROUPS } from '../ipc/acceptance'
import type { EvidenceItem, Ticket, WorkflowModel } from '../workflow/types'
import { doneOnlyInBranch } from '../workflow/waves'

/** Items of Tickets closed more than this many days ago go to Older (spec Q1). */
export const OLDER_AFTER_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/** One Project of the Machine with its workflow model, in the order of the Project list. */
export interface QueueProject {
  projectId: string
  name: string
  model: Pick<WorkflowModel, 'tickets'>
}

export interface QueueOptions {
  /** Now, in ms since the epoch: the Older threshold is measured from it. */
  now: number
  /**
   * The Stable copy line of a Ticket whose items are in Ready to check or Update first (src/main/acceptance/stable-line.ts),
   * asked only for those and once per Ticket: `out` puts its items in Update first; any other line, or null (not known
   * yet), leaves them in Ready to check. The rows of the other groups carry no line.
   */
  stable?: (projectId: string, ticket: Ticket) => AcceptanceStable | null
  /** The decision sent for an item and not recorded yet (src/main/acceptance/sent-store.ts); none by default. */
  sent?: (projectId: string, ticket: Ticket, item: EvidenceItem) => AcceptanceSent | null
}

/** A manual item without `[x]` that is not verified: a check that waits for the owner. A failed one waits too. */
export const itemWaitsForOwner = (item: Pick<EvidenceItem, 'manual' | 'checked' | 'state'>): boolean => item.manual && !item.checked && item.state !== 'verified'

/** The Status time of a Ticket in ms (`2026-10-17T09:41Z`, or a date alone for a migrated one); null when it does not read. */
function statusTime(at: string | null | undefined): number | null {
  if (!at) return null
  const time = Date.parse(at)
  return Number.isNaN(time) ? null : time
}

/**
 * A blocked Ticket that waits for the owner by itself: Autopilot's rule (`ownersOwn`), which also counts a Ticket with
 * no status; the spec's Waits for you and an acceptance Ticket are only `blocked` with `Waits: owner`.
 */
const blockedOnOwner = (ticket: Ticket): boolean => ticket.state === 'blocked' && ownersOwn(ticket)

/** A Ticket done in the checkout: its change is merged. */
const merged = (ticket: Ticket): boolean => ticket.state === 'done' && !doneOnlyInBranch(ticket)

/** The group of an item that waits; `stable` gives its Ticket's Stable copy line, asked only for the last choice. */
function groupOf(ticket: Ticket, item: EvidenceItem, now: number, stable: () => AcceptanceStable | null): AcceptanceGroupName {
  if (item.state === 'failed') return 'failed'
  if (!merged(ticket) && !blockedOnOwner(ticket)) return 'work'
  if (merged(ticket)) {
    const closed = statusTime(ticket.statusAt)
    if (closed !== null && now - closed > OLDER_AFTER_DAYS * DAY_MS) return 'older'
  }
  return stable()?.state === 'out' ? 'update' : 'ready'
}

const ticketOf = (project: QueueProject, ticket: Ticket): AcceptanceTicket => ({
  projectId: project.projectId,
  projectName: project.name,
  epic: ticket.epic,
  num: ticket.num,
  title: ticket.title,
  state: ticket.state,
  pr: ticket.pr ?? null,
  blockedReason: ticket.blockedReason ?? null,
})

/**
 * The queue of `projects`: every group of ACCEPTANCE_GROUPS in that order, an empty one too. Inside a group the rows
 * go by Project (in the order given), Epic, Ticket number and item number; a Ticket of Waits for you is one row.
 */
export function acceptanceQueue(projects: readonly QueueProject[], options: QueueOptions): AcceptanceGroup[] {
  const rows = new Map<AcceptanceGroupName, { order: [number, string, number, number]; row: AcceptanceRow }[]>(ACCEPTANCE_GROUPS.map((group) => [group, []]))
  projects.forEach((project, at) => {
    for (const ticket of project.model.tickets) {
      const items = ticket.evidence ?? []
      const waiting = items.filter(itemWaitsForOwner)
      if (waiting.length === 0) {
        if (blockedOnOwner(ticket)) rows.get('waits')!.push({ order: [at, ticket.epic, ticket.num, 0], row: { kind: 'ticket', ticket: ticketOf(project, ticket) } })
        continue
      }
      const prepared = items.filter((item) => !item.manual)
      let line: AcceptanceStable | null | undefined
      const stable = (): AcceptanceStable | null => (line === undefined ? (line = options.stable?.(project.projectId, ticket) ?? null) : line)
      for (const item of waiting) {
        const group = groupOf(ticket, item, options.now, stable)
        const row: AcceptanceRow = {
          kind: 'item',
          ticket: ticketOf(project, ticket),
          item,
          prepared,
          sent: options.sent?.(project.projectId, ticket, item) ?? null,
          stable: group === 'ready' || group === 'update' ? stable() : null,
        }
        rows.get(group)!.push({ order: [at, ticket.epic, ticket.num, item.index], row })
      }
    }
  })
  const byOrder = (a: { order: [number, string, number, number] }, b: { order: [number, string, number, number] }): number =>
    a.order[0] - b.order[0] || (a.order[1] < b.order[1] ? -1 : a.order[1] > b.order[1] ? 1 : 0) || a.order[2] - b.order[2] || a.order[3] - b.order[3]
  return ACCEPTANCE_GROUPS.map((group) => ({ group, rows: rows.get(group)!.sort(byOrder).map(({ row }) => row) }))
}
