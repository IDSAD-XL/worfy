// The accepted Epics of a Project for "Run all accepted": Epics whose spec the owner accepted and that have a
// ready Ticket now. worfy never parses the spec itself (ADR-0002): the acceptance date comes from
// `epic-status --json` (`acceptedAt`, harness/bin/TICKETS.md, "Spec status").
import type { Epic, WorkflowModel } from './types'
import { readyWave } from './waves'

export type AcceptedEpic = Epic & { acceptedAt: string }

/**
 * The Epics with an acceptance date and at least one Ticket in their ready Wave, oldest acceptance first;
 * Epics accepted on one day by name. A closed Epic (every Ticket done) has no ready Ticket and is left out.
 */
export function acceptedEpics(model: WorkflowModel): AcceptedEpic[] {
  return model.epics
    .filter((epic): epic is AcceptedEpic => typeof epic.acceptedAt === 'string' && epic.acceptedAt !== '')
    .filter((epic) => readyWave(model.tickets, epic.epic).ready.length > 0)
    .sort((a, b) => (a.acceptedAt < b.acceptedAt ? -1 : a.acceptedAt > b.acceptedAt ? 1 : a.epic < b.epic ? -1 : a.epic > b.epic ? 1 : 0))
}
