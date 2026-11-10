// What the review threads badge (ReviewThreads.tsx, worfy-pr-inbox ticket 06) and the Pipeline board's «Waits: N answers»
// count, from the Project's PR inbox snapshot: pure, so the badge, the card's height (ticket-card.ts through
// sources/epics.ts) and the board count alike.
import type { PrInboxRow, PrInboxSnapshot } from '../../../shared/ipc/pr-inbox'
import type { Ticket } from '../../../shared/workflow/types'
import { orderedGroups, threadsText, ticketOfRow, type PullRef } from '../../pr-inbox/usePrInbox'

/** The unresolved threads of a PR whose last comment is not the user's: the answers the PR waits for. */
export function waitingThreads(row: Pick<PrInboxRow, 'threads'>, viewer: string | null): number {
  const me = viewer?.toLowerCase() ?? null
  return row.threads.filter((thread) => {
    const last = thread.comments.at(-1)
    return !thread.isResolved && last !== undefined && (me === null || last.author?.toLowerCase() !== me)
  }).length
}

/** One PR of a Ticket and what it waits for from the user. */
export interface TicketPull extends PullRef {
  threads: number
  changesRequested: boolean
}

/** What a Ticket's PRs wait for: each PR the snapshot holds for it, and their sum. */
export interface TicketReviews {
  pulls: TicketPull[]
  threads: number
  changesRequested: boolean
}

const sameTicket = (a: Pick<Ticket, 'epic' | 'num'>, b: Pick<Ticket, 'epic' | 'num'>): boolean => a.epic === b.epic && a.num === b.num

/**
 * The PRs of the snapshot that belong to `ticket` — by its `PR:` lines (repo, N), else by its branch — as the view's
 * Ticket chip finds them (ticketOfRow over all the Project's `tickets`), with their waiting threads summed. Null when
 * the snapshot holds none of its PRs, or the inbox is off.
 */
export function reviewsOfTicket(snapshot: PrInboxSnapshot | undefined, ticket: Ticket, tickets: readonly Ticket[]): TicketReviews | null {
  if (snapshot === undefined || !snapshot.enabled) return null
  const all = tickets.some((each) => sameTicket(each, ticket)) ? tickets : [ticket, ...tickets]
  const pulls: TicketPull[] = []
  for (const { rows } of orderedGroups(snapshot)) {
    for (const row of rows) {
      const owner = ticketOfRow(row, all)
      if (owner === undefined || !sameTicket(owner, ticket)) continue
      pulls.push({ repo: row.repo, number: row.number, threads: waitingThreads(row, snapshot.viewer), changesRequested: row.reviewDecision === 'CHANGES_REQUESTED' })
    }
  }
  if (pulls.length === 0) return null
  return { pulls, threads: pulls.reduce((sum, pull) => sum + pull.threads, 0), changesRequested: pulls.some((pull) => pull.changesRequested) }
}

/** The labels of the badge: «3 open threads», «changes requested»; none when nothing waits for the user. */
export function reviewLabels(reviews: Pick<TicketReviews, 'threads' | 'changesRequested'> | null): string[] {
  if (reviews === null) return []
  const threads = threadsText(reviews.threads)
  return [...(threads === null ? [] : [threads]), ...(reviews.changesRequested ? ['changes requested'] : [])]
}

/** How many chips the badge draws on each Ticket that has any, by `<epic>/<num>`: the room ticket-card.ts gives the card. */
export function reviewChipsOf(snapshot: PrInboxSnapshot | undefined, tickets: readonly Ticket[]): Record<string, number> {
  const chips: Record<string, number> = {}
  if (snapshot === undefined || !snapshot.enabled) return chips
  for (const ticket of tickets) {
    const count = reviewLabels(reviewsOfTicket(snapshot, ticket, tickets)).length
    if (count > 0) chips[`${ticket.epic}/${ticket.num}`] = count
  }
  return chips
}
