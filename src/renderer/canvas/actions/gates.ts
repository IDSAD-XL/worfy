// When "Run wave" and "Ship ticket" (ticket 23) are shown and whether they can run now, and whether "Fix checks",
// "Resolve conflicts" and "Address comments" (worfy-pr-follow ticket 01) can run on a pull request. The buttons
// on the Canvas (EpicActions.tsx, TicketActions.tsx), in Pull requests and the rows of the command palette (ticket 31)
// all ask here, so they never disagree; main checks the same conditions again on a click.
import { prFollowState, runWaveState, shipTicketState, type ActionState, type WaveState } from '../../../shared/actions/render-template'
import type { PrInboxRow } from '../../../shared/ipc/pr-inbox'
import type { PrFollowAction } from '../../../shared/projects/action-templates'
import type { Ticket } from '../../../shared/workflow/types'
import { usePrInbox } from '../../pr-inbox/usePrInbox'
import { useProjects, useReadOnly } from '../../projects/useProjects'
import { useLaunched } from './launches'
import { useActionTemplates } from './templates'

const READING: Extract<ActionState, { enabled: false }> = { enabled: false, reason: 'Reading the Project settings…' }

/** An Epic whose Tickets are all done has no "Run wave". */
export function hasRunWave(epic: string, tickets: readonly Pick<Ticket, 'epic' | 'state'>[]): boolean {
  const mine = tickets.filter((ticket) => ticket.epic === epic)
  return !(mine.length > 0 && mine.every((ticket) => ticket.state === 'done'))
}

/** A Ticket in work or done has no "Ship ticket": there is nothing to ship. */
export function hasShipTicket(ticket: Pick<Ticket, 'state'>): boolean {
  return ticket.state !== 'work' && ticket.state !== 'done'
}

function useBranch(projectId: string): string | null {
  return useProjects()?.projects.find((project) => project.id === projectId)?.branch ?? null
}

/**
 * Whether "Run wave" of `epic` can run now, and the text it sends or the reason it cannot. With
 * `autopilot`, whether Autopilot can start: the template must also name the Wave's Tickets
 * ({tickets}, ADR-0033), and the reason says so on the Autopilot button. `resumable`: the Tickets
 * of the Wave the last Stop of this Epic interrupted (worfy-week ticket 17); those still in work
 * count as ready, as main counts them. When it can, the Wave's Tickets come along (the Autopilot
 * button's estimate counts them).
 */
export function useRunWaveState(projectId: string, epic: string, tickets: readonly Ticket[], autopilot = false, resumable: readonly number[] = []): WaveState {
  const branch = useBranch(projectId)
  const templates = useActionTemplates(projectId)
  if (templates === undefined) return READING
  return runWaveState({ epic, tickets, template: templates.runWave, branch, autopilot, resumable })
}

/** Whether "Ship ticket" of `ticket` can run now; `tickets` are every Ticket, for its blockers. */
export function useShipTicketState(projectId: string, ticket: Ticket, tickets: readonly Ticket[]): ActionState {
  const branch = useBranch(projectId)
  const templates = useActionTemplates(projectId)
  const launched = useLaunched(projectId, ticket.epic, ticket.num)
  if (templates === undefined) return READING
  return shipTicketState({ ticket, tickets, template: templates.shipTicket, branch, launched })
}

/**
 * Whether `action` — "Fix checks", "Resolve conflicts" or "Address comments" — can run on the pull request of `row`, a
 * row of the Project's PR inbox, and the text main would send, or why not: a read-only screen (a Linked machine with
 * read-only access, worfy-link ticket 25) first, then the verdict of prFollowState over the row, the login the inbox
 * reads as and the Project's template — the PR is not the user's, comes from a fork, has no reason for the action, the
 * template is empty or does not render. The button of Pull requests (worfy-pr-follow ticket 04), of the Ticket Node
 * and the row of the Command palette (ticket 05) take it, and pass `action` to `actions.prFollow` on a click.
 */
export function usePrFollowState(projectId: string, row: PrInboxRow, action: PrFollowAction): ActionState {
  const templates = useActionTemplates(projectId)
  const viewer = usePrInbox(projectId).snapshot?.viewer ?? null
  const readOnly = useReadOnly()
  if (readOnly !== null) return { enabled: false, reason: readOnly }
  if (templates === undefined) return READING
  return prFollowState({ action, template: templates[action], repo: row.repo, pr: row.number, row, viewer })
}
