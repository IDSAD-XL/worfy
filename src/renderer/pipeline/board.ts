// What the Pipeline board (PipelineBoard.tsx) and the sidebar's Pipeline section
// (shell/sidebar/PipelineSection.tsx) say alike about a Ticket.
import type { PipelineColumn, PipelineTicket } from '../../shared/ipc/pipeline'
import { onStageFor, stuckOf, type TicketStage } from '../../shared/workflow/pipeline'
import type { WorkflowModel } from '../../shared/workflow/types'
import { ticketTitle } from '../canvas/epic-layout'

/** The key of a Ticket in a map of titles. */
export const ticketKeyOf = (ticket: { epic: string; num: number }): string => `${ticket.epic}/${ticket.num}`

/** How a Ticket is named on the board and in the sidebar: `<epic> NN`. */
export const ticketRef = (ticket: { epic: string; num: number }): string => `${ticket.epic} ${String(ticket.num).padStart(2, '0')}`

/** Who the Ticket waits for, as its `Waits:` line says it: `owner`, `team`, `agent` or a Machine's name. */
export const waitsText = (waits: string): string => `Waits: ${waits}`

/** The titles of the model's Tickets without their leading number, by ticketKeyOf. */
export function titlesOf(model: WorkflowModel | undefined): Record<string, string> {
  const titles: Record<string, string> = {}
  for (const ticket of model?.tickets ?? []) titles[ticketKeyOf(ticket)] = ticketTitle(ticket)
  return titles
}

/** Whether a Ticket is in work: neither Queued nor Done. */
export const inWork = (ticket: PipelineTicket): boolean => ticket.kind !== 'queued' && ticket.kind !== 'done'

/**
 * The tooltip line of a stuck Ticket — «stuck: on CI for 3 h» — or null while it is not stuck on
 * `column`, the Stage it stands on (worfy-pipeline ticket 06). `now` is the caller's clock (useNow,
 * a new value every minute); a new snapshot draws the caller again, so the line is found again too.
 */
export function stuckLine(column: PipelineColumn | undefined, ticket: Pick<TicketStage, 'waits' | 'enteredAt'>, now: number): string | null {
  if (column === undefined) return null
  const stuck = stuckOf(column, ticket, now)
  return stuck?.stuck ? `stuck: ${onStageFor(column.title, stuck.forMs)}` : null
}
