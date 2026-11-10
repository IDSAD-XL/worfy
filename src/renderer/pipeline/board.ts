// What the Pipeline board (PipelineBoard.tsx) and the sidebar's Pipeline section
// (shell/sidebar/PipelineSection.tsx) say alike about a Ticket.
import type { PipelineColumn, PipelineTicket } from '../../shared/ipc/pipeline'
import type { PrInboxSnapshot } from '../../shared/ipc/pr-inbox'
import { onStageFor, stuckOf, type ReleaseFact, type RepoPull, type TicketStage } from '../../shared/workflow/pipeline'
import type { WorkflowModel } from '../../shared/workflow/types'
import { reviewsByTicket } from '../canvas/badges/review-threads'
import { ticketTitle } from '../canvas/epic-layout'

/** The key of a Ticket in a map of titles. */
export const ticketKeyOf = (ticket: { epic: string; num: number }): string => `${ticket.epic}/${ticket.num}`

/** How a Ticket is named on the board and in the sidebar: `<epic> NN`. */
export const ticketRef = (ticket: { epic: string; num: number }): string => `${ticket.epic} ${String(ticket.num).padStart(2, '0')}`

/** Who the Ticket waits for, as its `Waits:` line says it: `owner`, `team`, `agent` or a Machine's name. */
export const waitsText = (waits: string): string => `Waits: ${waits}`

/**
 * «Waits: 2 answers» on a card on Human review whose PRs hold review threads that wait for the user's answer (the PR
 * inbox, worfy-pr-inbox ticket 06; summed over the PRs of a Ticket over several repositories); null on any other Stage
 * and when none waits.
 */
export function answersText(kind: TicketStage['kind'], answers: number): string | null {
  if (kind !== 'human-review' || answers <= 0) return null
  return `Waits: ${answers} answer${answers === 1 ? '' : 's'}`
}

/**
 * The review threads of each Ticket's PRs that wait for the user's answer, by ticketKeyOf, from the Project's PR inbox
 * snapshot (reviewsByTicket of the review threads badge, the same map, so the card and the Ticket Node count alike);
 * only Tickets that have any.
 */
export function answersOf(inbox: PrInboxSnapshot | undefined, model: WorkflowModel | undefined): Record<string, number> {
  const answers: Record<string, number> = {}
  for (const [key, reviews] of reviewsByTicket(inbox, model?.tickets ?? [])) if (reviews.threads > 0) answers[key] = reviews.threads
  return answers
}

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

// ── a Ticket over several repositories (ADR-0104, worfy-multi-repo-ticket 06) ──

const PR_STATE: Record<NonNullable<RepoPull['state']>, string> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' }

/** A row of the card of a Ticket over several repositories: `lib #41 · merged`, `app · no PR`. */
export function pullRowText(pull: RepoPull): string {
  if (pull.number === null || pull.state === null) return `${pull.repo} · no PR`
  return `${pull.repo} #${pull.number} · ${PR_STATE[pull.state]}`
}

/** «1/2 merged» once a PR of the Ticket is merged; null before (ADR-0104, item 8) and for a Ticket of one repository. */
export function mergedText(merged: TicketStage['merged']): string | null {
  if (merged === undefined || merged.count === 0) return null
  return `${merged.count}/${merged.of} merged`
}

/**
 * What the card says of the `Release:` lines while the Ticket, or one of its repositories, stands on the Stage
 * `release` (`kindOf` gives a Stage id's kind): «waits for release <ref>» for a line not met yet, «release <ref> not
 * checked» when worfy could not ask; nothing for a line released, and nothing on any other Stage.
 */
export function releaseLines(ticket: Pick<TicketStage, 'kind' | 'release' | 'prs'>, kindOf: (stage: string) => string | undefined): { text: string; checked: boolean }[] {
  const onRelease = ticket.kind === 'release' || (ticket.prs ?? []).some((pull) => kindOf(pull.stage) === 'release')
  if (!onRelease) return []
  return (ticket.release ?? []).flatMap((line: ReleaseFact): { text: string; checked: boolean }[] => {
    if (line.state === 'waiting') return [{ text: `waits for release ${line.ref}`, checked: true }]
    if (line.state === 'not checked') return [{ text: `release ${line.ref} not checked`, checked: false }]
    return []
  })
}
