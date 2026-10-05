// When "Run wave" and "Ship ticket" (ticket 23) are shown and whether they can run now. The buttons
// on the Canvas (EpicActions.tsx, TicketActions.tsx) and the rows of the command palette (ticket 31)
// both ask here, so the two never disagree; main checks the same conditions again on a click.
import { runWaveState, shipTicketState, type ActionState } from '../../../shared/actions/render-template'
import type { Ticket } from '../../../shared/workflow/types'
import { useProjects } from '../../projects/useProjects'
import { useLaunched } from './launches'
import { useActionTemplates } from './templates'

const READING: ActionState = { enabled: false, reason: 'Reading the Project settings…' }

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

/** Whether "Run wave" of `epic` can run now, and the text it sends or the reason it cannot. */
export function useRunWaveState(projectId: string, epic: string, tickets: readonly Ticket[]): ActionState {
  const branch = useBranch(projectId)
  const templates = useActionTemplates(projectId)
  if (templates === undefined) return READING
  return runWaveState({ epic, tickets, template: templates.runWave, branch })
}

/** Whether "Ship ticket" of `ticket` can run now; `tickets` are every Ticket, for its blockers. */
export function useShipTicketState(projectId: string, ticket: Ticket, tickets: readonly Ticket[]): ActionState {
  const branch = useBranch(projectId)
  const templates = useActionTemplates(projectId)
  const launched = useLaunched(projectId, ticket.epic, ticket.num)
  if (templates === undefined) return READING
  return shipTicketState({ ticket, tickets, template: templates.shipTicket, branch, launched })
}
