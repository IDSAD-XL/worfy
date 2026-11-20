// What the review threads badge (ReviewThreads.tsx, worfy-pr-inbox ticket 06) and the Pipeline board's «Waits: N answers»
// count, from the Project's PR inbox snapshot: pure, so the badge, the card's height (ticket-card.ts through
// sources/epics.ts) and the board count alike.
import type { PrApprovals, PrInboxSnapshot } from '../../../shared/ipc/pr-inbox'
import { ticketOfRow, waitingThreads } from '../../../shared/pr-inbox/rows'
import type { Ticket } from '../../../shared/workflow/types'
import { approvalsShort, orderedGroups, threadsText, type PullRef } from '../../pr-inbox/usePrInbox'

// Moved to src/shared, where main reads it too (worfy-pr-follow ticket 01); the badge and its tests still take it from here.
export { waitingThreads }

/** One PR of a Ticket and what it waits for from the user. */
export interface TicketPull extends PullRef {
  threads: number
  changesRequested: boolean
  /** The PR's approvals while it is short of them (approvalsShort, worfy-pr-review ticket 03); null when enough or unknown. */
  approvals: PrApprovals | null
}

/** What a Ticket's PRs wait for: each PR the snapshot holds for it, and their sum. */
export interface TicketReviews {
  pulls: TicketPull[]
  threads: number
  changesRequested: boolean
  /** The first PR, in the order of the view's groups, that is short of approvals: the chip of the card and the board. */
  short: TicketPull | null
}

const keyOf = (ticket: Pick<Ticket, 'epic' | 'num'>): string => `${ticket.epic}/${ticket.num}`

/** One map per snapshot and list of Tickets: the badge of every Ticket Node, the card heights and the board read the same one. */
const cache = new WeakMap<PrInboxSnapshot, WeakMap<readonly Ticket[], ReadonlyMap<string, TicketReviews>>>()

/**
 * What the PRs of the snapshot wait for, by the Ticket each belongs to (`<epic>/<num>`) — by its `PR:` lines (repo, N),
 * else by its branch, as the view's Ticket chip finds it (ticketOfRow) — with their waiting threads summed. Each row is
 * matched once, so the work is rows × Tickets, and once per (snapshot, `tickets`): a new snapshot or a new model makes
 * a new map, a render does not. Empty when the inbox is off.
 */
export function reviewsByTicket(snapshot: PrInboxSnapshot | undefined, tickets: readonly Ticket[]): ReadonlyMap<string, TicketReviews> {
  if (snapshot === undefined || !snapshot.enabled) return new Map()
  let bySnapshot = cache.get(snapshot)
  if (bySnapshot === undefined) cache.set(snapshot, (bySnapshot = new WeakMap()))
  const known = bySnapshot.get(tickets)
  if (known !== undefined) return known
  const byTicket = new Map<string, TicketReviews>()
  for (const { rows } of orderedGroups(snapshot)) {
    for (const row of rows) {
      const owner = ticketOfRow(row, tickets)
      if (owner === undefined) continue
      const pull: TicketPull = {
        repo: row.repo,
        number: row.number,
        threads: waitingThreads(row, snapshot.viewer),
        changesRequested: row.reviewDecision === 'CHANGES_REQUESTED',
        approvals: approvalsShort(row.approvals) ? row.approvals! : null,
      }
      const short = pull.approvals === null ? null : pull
      const reviews = byTicket.get(keyOf(owner))
      if (reviews === undefined) byTicket.set(keyOf(owner), { pulls: [pull], threads: pull.threads, changesRequested: pull.changesRequested, short })
      else byTicket.set(keyOf(owner), { pulls: [...reviews.pulls, pull], threads: reviews.threads + pull.threads, changesRequested: reviews.changesRequested || pull.changesRequested, short: reviews.short ?? short })
    }
  }
  bySnapshot.set(tickets, byTicket)
  return byTicket
}

/**
 * What the PRs of `ticket` wait for (reviewsByTicket); null when the snapshot holds none of its PRs, or the inbox is off.
 * `tickets`: the Project's Tickets, which decide whose a PR is; pass the same list each time, so the map is made once.
 */
export function reviewsOfTicket(snapshot: PrInboxSnapshot | undefined, ticket: Pick<Ticket, 'epic' | 'num'>, tickets: readonly Ticket[]): TicketReviews | null {
  return reviewsByTicket(snapshot, tickets).get(keyOf(ticket)) ?? null
}

/** The labels of the badge: «3 open threads», «changes requested»; none when nothing waits for the user. */
export function reviewLabels(reviews: Pick<TicketReviews, 'threads' | 'changesRequested'> | null): string[] {
  if (reviews === null) return []
  const threads = threadsText(reviews.threads)
  return [...(threads === null ? [] : [threads]), ...(reviews.changesRequested ? ['changes requested'] : [])]
}

/**
 * How many lines of chips the badge draws: a line per label, and the approvals chip on the last of them, or on a line of
 * its own when there is no label (worfy-pr-review ticket 03: the chip adds no line beside a label).
 */
export const reviewLinesOf = (reviews: TicketReviews | null): number => (reviews === null ? 0 : Math.max(reviewLabels(reviews).length, reviews.short === null ? 0 : 1))

/** How many lines of chips the badge draws on each Ticket that has any, by `<epic>/<num>`: the room ticket-card.ts gives the card. */
export function reviewChipsOf(snapshot: PrInboxSnapshot | undefined, tickets: readonly Ticket[]): Record<string, number> {
  const chips: Record<string, number> = {}
  for (const [key, reviews] of reviewsByTicket(snapshot, tickets)) {
    const count = reviewLinesOf(reviews)
    if (count > 0) chips[key] = count
  }
  return chips
}
