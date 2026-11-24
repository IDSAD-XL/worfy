// Opening the Acceptance view (worfy-acceptance ticket 05) and the places a row of it leads to. The toolbar tab opens
// it; the sidebar section, the palette and the notification of ticket 06 come through openAcceptance with a target.
// The view is over every Project of the window's Machine, so it opens without a Project; Open Ticket and Open
// Orchestrator select the row's Project first, as openPrInboxOf does for another Project's PR.
import { epicNodeId, ticketNodeId } from '../../shared/layout/derived'
import { focusCanvasNode } from '../find/canvas-requests'
import { windowMachine } from '../ipc'
import { openProject, projectsNow } from '../projects/useProjects'
import { openOrchestrator, setView } from '../session/navigation'
import { focusAcceptance } from './useAcceptance'

/** Opens the view; with `target`, on that Ticket's item (or its first row). False when the queue has no such row. */
export function openAcceptance(target?: { projectId: string; epic: string; num: number; item?: number }): boolean {
  setView('acceptance')
  return target === undefined ? true : focusAcceptance(target)
}

/** Selects Project `projectId` when it is not the active one; the reason when it could not be. */
async function selectProject(projectId: string): Promise<string | undefined> {
  if (projectsNow()?.activeId === projectId) return undefined
  return openProject(windowMachine(), projectId)
}

/** Open Ticket: the Ticket's card on the Canvas of its Project. */
export async function openAcceptanceTicket(ticket: { projectId: string; epic: string; num: number }): Promise<string | undefined> {
  const refused = await selectProject(ticket.projectId)
  if (refused !== undefined) return refused
  setView('canvas')
  focusCanvasNode(ticket.projectId, ticketNodeId(ticket.epic, ticket.num), epicNodeId(ticket.epic))
  return undefined
}

/** Open Orchestrator: the Session view of the Project's Orchestrator. */
export async function openAcceptanceOrchestrator(projectId: string): Promise<string | undefined> {
  return (await selectProject(projectId)) ?? openOrchestrator(projectId)
}
