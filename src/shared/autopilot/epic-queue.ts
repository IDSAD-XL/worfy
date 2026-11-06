// The Epic queue rule (worfy-autopilot-queue ticket 12): a Run over a queue of Epics runs one Epic's
// cycle at a time. When that cycle stops, the reason and the Epic's Tickets decide whether the Run
// goes on to the next Epic or stops as a whole. Pure functions: no Node, no DOM.
//
// - `done`: the Epic's cycle found nothing ready and every Ticket of the Epic is done in the checkout
//   (a Ticket done only in its unmerged branch is not), or a one-Epic Run over named Tickets ended
//   with `tickets-done`: its usual end.
// - `waits-owner`: nothing ready (`blocked-tickets`, `no-ready-wave`) and every Ticket not done
//   waits for the owner: `blocked` with `Waits: owner` (acceptance), status-less (`none`, which
//   `readyWave` never takes into a Wave: not in Autopilot), or blocked only by such Tickets.
// - anything else stops the Run: `limits-timeout`, `no-progress` and `wave-unfinished` (red CI on
//   main: the Harness hands out no Tickets), errors, Stop, `window-too-short`.
import type { Ticket } from '../workflow/types'
import { doneOnlyInBranch } from '../workflow/waves'
import type { AutopilotStopReason } from './cycle'

/** The most Epics one Run's queue holds. */
export const MAX_QUEUE_EPICS = 10

/** How an Epic of the queue ended: the `outcome` of its `epic-finished` journal line. */
export type EpicFinish = 'done' | 'waits-owner' | 'elsewhere' | 'removed'

/** What the Run does once an Epic's cycle stopped. */
export type EpicOutcome =
  | { kind: 'next'; outcome: 'done' }
  /** `tickets`: the Tickets of the Epic left for the owner, in number order. */
  | { kind: 'next'; outcome: 'waits-owner'; tickets: number[] }
  | { kind: 'stop' }

type QueueTicket = Pick<Ticket, 'epic' | 'num' | 'state' | 'blockedNums' | 'blockedParsed'> & Partial<Pick<Ticket, 'waits' | 'fromBranch'>>

/** The reasons a cycle stops when nothing of the Epic is left for Autopilot (`nothingReady`, cycle.ts). */
const EPIC_ENDS: ReadonlySet<AutopilotStopReason> = new Set<AutopilotStopReason>(['tickets-done', 'blocked-tickets', 'no-ready-wave'])

const doneInCheckout = (ticket: QueueTicket): boolean => ticket.state === 'done' && !doneOnlyInBranch(ticket)

/** Waits for the owner by itself: `Waits: owner` on a blocked Ticket, or no status Autopilot can take. */
const ownersOwn = (ticket: QueueTicket): boolean =>
  ticket.state === 'none' || (ticket.state === 'blocked' && ticket.waits?.trim().toLowerCase() === 'owner')

/**
 * The Tickets of the Epic that wait for the owner: their own, and those whose every blocker not done
 * is one of them, repeated until nothing new joins (so a chain behind an acceptance Ticket counts,
 * a cycle among other Tickets does not).
 */
function waitingForOwner(tickets: ReadonlyMap<number, QueueTicket>): Set<number> {
  const owner = new Set<number>()
  for (const ticket of tickets.values()) if (ownersOwn(ticket)) owner.add(ticket.num)
  for (let grew = true; grew; ) {
    grew = false
    for (const ticket of tickets.values()) {
      if (owner.has(ticket.num) || !behindOwnerOnly(ticket, tickets, owner)) continue
      owner.add(ticket.num)
      grew = true
    }
  }
  return owner
}

/** Open, blocked or status-less, its blockers read, and every one not done waits for the owner (at least one). */
function behindOwnerOnly(ticket: QueueTicket, tickets: ReadonlyMap<number, QueueTicket>, owner: ReadonlySet<number>): boolean {
  if (ticket.state !== 'open' && ticket.state !== 'blocked' && ticket.state !== 'none') return false
  if (!ticket.blockedParsed) return false
  const pending = ticket.blockedNums.filter((num) => {
    const blocker = tickets.get(num)
    return blocker === undefined || !doneInCheckout(blocker)
  })
  return pending.length > 0 && pending.every((num) => owner.has(num))
}

/** What the Run does after the cycle of `epic` stopped with `reason`, given the Tickets of the workflow model. */
export function epicOutcome(reason: AutopilotStopReason, tickets: readonly QueueTicket[], epic: string): EpicOutcome {
  if (!EPIC_ENDS.has(reason)) return { kind: 'stop' }
  // Named Tickets are given only to a one-Epic Run; when they are done, so is its Epic.
  if (reason === 'tickets-done') return { kind: 'next', outcome: 'done' }
  const own = new Map(tickets.filter((ticket) => ticket.epic === epic).map((ticket) => [ticket.num, ticket]))
  const left = [...own.values()].filter((ticket) => !doneInCheckout(ticket))
  if (left.length === 0) return { kind: 'next', outcome: 'done' }
  const owner = waitingForOwner(own)
  if (!left.every((ticket) => owner.has(ticket.num))) return { kind: 'stop' }
  return { kind: 'next', outcome: 'waits-owner', tickets: left.map((ticket) => ticket.num).sort((a, b) => a - b) }
}

/**
 * The next Epic of the queue the Run has not started: the first after `index` (-1 before the first)
 * that has no outcome yet, or null when none is left. An Epic named twice runs once.
 */
export function nextEpic(queue: readonly string[], index: number, outcomes: ReadonlyMap<string, EpicFinish>): { index: number; epic: string } | null {
  for (let next = index + 1; next < queue.length; next += 1) {
    const epic = queue[next]
    if (epic !== undefined && !outcomes.has(epic)) return { index: next, epic }
  }
  return null
}
