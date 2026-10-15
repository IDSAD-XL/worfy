// Dependency levels, the ready Wave and Wave numbers of one Epic. Pure functions over the
// Tickets of the workflow model; nothing here reads files or knows about processes.
//
// A Wave is the set of Tickets that can be taken in parallel: open, every blocker done, and no
// file of "Где в коде" shared with another Ticket of the Wave or with a Ticket already in work.
// A Ticket whose `done` comes only from its unmerged worktree branch counts as still in work: its
// code is not in the main branch yet, which is where a dependant's worktree starts.
import type { Ticket } from './types'

/** Where a Ticket sits in the blocking graph of its Epic. */
export type Level =
  /** 0 without blockers, otherwise 1 + the highest level among the blockers. */
  | { kind: 'level'; level: number }
  /** "Blocked by" could not be read as a list of Ticket numbers. */
  | { kind: 'unparsed'; raw: string | null }
  /** "Blocked by" names numbers that are not Tickets of this Epic. */
  | { kind: 'missing-blocker'; missing: number[] }
  /** The Ticket blocks itself through these Tickets (sorted, the Ticket included). */
  | { kind: 'cycle'; cycle: number[] }
  /** The Ticket's own blockers are fine, but these direct blockers have no level. */
  | { kind: 'after-problem'; blockers: number[] }

/** Why an open Ticket is not in the ready Wave. */
export type WaitReason =
  | { kind: 'blockers'; blockers: number[] }
  | { kind: 'files'; files: string[]; heldBy: number[] }
  | { kind: 'unparsed'; raw: string | null }
  | { kind: 'missing-blocker'; missing: number[] }
  | { kind: 'cycle'; cycle: number[] }

/** A Ticket that would be ready but is not open: blocked, or without a status (ticket 30, ADR-0033). */
export interface SkippedTicket {
  num: number
  state: Extract<Ticket['state'], 'blocked' | 'none'>
}

export interface ReadyWave {
  /** In Ticket number order. `filesNotListed` — the Ticket has no "Где в коде" section. */
  ready: { num: number; filesNotListed: boolean }[]
  /** Open Tickets left for a later Wave, in number order. */
  waiting: { num: number; reason: WaitReason }[]
  /**
   * Tickets in `blocked` or `none` whose blockers are all done, in number order: they would be
   * ready if they were open. Autopilot names them in its journal and stops on them when nothing
   * open is ready (`blocked-tickets`).
   */
  skipped: SkippedTicket[]
}

type WaveTicket = Pick<Ticket, 'epic' | 'num' | 'state' | 'blockedRaw' | 'blockedNums' | 'blockedParsed' | 'files' | 'filesListed'> &
  /** Absent or null: the status comes from the checkout. */
  Partial<Pick<Ticket, 'fromBranch'>>

/** Done in the checkout: a blocker the ready Wave counts as closed. */
const closed = (ticket: WaveTicket | undefined): boolean => ticket?.state === 'done' && !ticket.fromBranch

/** Done only in its unmerged worktree branch: not a closed blocker yet. */
export const doneOnlyInBranch = (ticket: Pick<Ticket, 'state'> & Partial<Pick<Ticket, 'fromBranch'>>): boolean => ticket.state === 'done' && Boolean(ticket.fromBranch)

/** In work, or done only in its unmerged worktree branch: its files are held, its dependants wait. */
const inFlight = (ticket: WaveTicket): boolean => ticket.state === 'work' || doneOnlyInBranch(ticket)

const byNum = (a: { num: number }, b: { num: number }) => a.num - b.num

/** The Tickets of `epic` (by default the first Ticket's Epic), keyed by number. */
function epicTickets<T extends WaveTicket>(tickets: readonly T[], epic: string | undefined): Map<number, T> {
  const name = epic ?? tickets[0]?.epic
  return new Map(tickets.filter((ticket) => ticket.epic === name).map((ticket) => [ticket.num, ticket]))
}

/**
 * Tickets that sit on a blocking cycle, each mapped to its cycle's members. Tarjan's strongly
 * connected components over the edges Ticket → blocker inside the Epic.
 */
function cycles(tickets: Map<number, WaveTicket>): Map<number, number[]> {
  const index = new Map<number, number>()
  const low = new Map<number, number>()
  const stack: number[] = []
  const onStack = new Set<number>()
  const result = new Map<number, number[]>()
  let counter = 0

  const edges = (num: number) => (tickets.get(num)?.blockedNums ?? []).filter((blocker) => tickets.has(blocker))

  const visit = (num: number): void => {
    index.set(num, counter)
    low.set(num, counter)
    counter += 1
    stack.push(num)
    onStack.add(num)
    for (const next of edges(num)) {
      if (!index.has(next)) {
        visit(next)
        low.set(num, Math.min(low.get(num)!, low.get(next)!))
      } else if (onStack.has(next)) {
        low.set(num, Math.min(low.get(num)!, index.get(next)!))
      }
    }
    if (low.get(num) !== index.get(num)) return
    const component: number[] = []
    let top: number | undefined
    do {
      top = stack.pop()!
      onStack.delete(top)
      component.push(top)
    } while (top !== num)
    const selfLoop = component.length === 1 && edges(num).includes(num)
    if (component.length > 1 || selfLoop) {
      component.sort((a, b) => a - b)
      for (const member of component) result.set(member, component)
    }
  }

  for (const num of [...tickets.keys()].sort((a, b) => a - b)) if (!index.has(num)) visit(num)
  return result
}

/** The Ticket's own defect, if any: an unparsed "Blocked by", a blocker outside the Epic, a cycle. */
type Problem = Extract<Level, { kind: 'unparsed' | 'missing-blocker' | 'cycle' }>

function ownProblem(ticket: WaveTicket, tickets: Map<number, WaveTicket>, cycleOf: Map<number, number[]>): Problem | null {
  if (!ticket.blockedParsed && ticket.blockedRaw !== null) return { kind: 'unparsed', raw: ticket.blockedRaw }
  const missing = ticket.blockedNums.filter((blocker) => !tickets.has(blocker))
  if (missing.length) return { kind: 'missing-blocker', missing }
  const cycle = cycleOf.get(ticket.num)
  if (cycle) return { kind: 'cycle', cycle }
  return null
}

/** The level of every Ticket of one Epic, keyed by Ticket number. Never throws on a bad graph. */
export function ticketLevels(tickets: readonly WaveTicket[], epic?: string): Map<number, Level> {
  const all = epicTickets(tickets, epic)
  const cycleOf = cycles(all)
  const levels = new Map<number, Level>()

  const levelOf = (num: number): Level => {
    const known = levels.get(num)
    if (known) return known
    const ticket = all.get(num)!
    let level: Level | null = ownProblem(ticket, all, cycleOf)
    if (!level) {
      // No cycle reaches here, so the recursion terminates.
      const blockerLevels = ticket.blockedNums.map((blocker) => [blocker, levelOf(blocker)] as const)
      const broken = blockerLevels.filter(([, l]) => l.kind !== 'level').map(([blocker]) => blocker)
      level = broken.length
        ? { kind: 'after-problem', blockers: broken }
        : { kind: 'level', level: blockerLevels.reduce((max, [, l]) => Math.max(max, l.kind === 'level' ? l.level + 1 : 0), 0) }
    }
    levels.set(num, level)
    return level
  }

  for (const num of all.keys()) levelOf(num)
  return levels
}

/** True when two "Где в коде" entries name the same file; an entry ending in `/` holds its whole folder. */
export function filesOverlap(a: string, b: string): boolean {
  if (a === b) return true
  if (a.endsWith('/') && b.startsWith(a)) return true
  return b.endsWith('/') && a.startsWith(b)
}

/**
 * The ready Wave of one Epic: open Tickets whose blockers are all done in the checkout, in number
 * order. The files of Tickets in work (claimed in the checkout or in a worktree branch) and of
 * Tickets done only in a worktree branch are held from the start; a Ticket whose file overlaps a
 * held file, or a file of a Ticket already taken into this Wave, waits for the next one. Blocked and status-less Tickets never go into the Wave; those
 * whose blockers are all done are listed as `skipped`.
 */
export function readyWave(tickets: readonly WaveTicket[], epic?: string): ReadyWave {
  const all = epicTickets(tickets, epic)
  const cycleOf = cycles(all)
  const held: { file: string; num: number }[] = []
  for (const ticket of all.values()) {
    if (inFlight(ticket)) for (const file of ticket.files) held.push({ file, num: ticket.num })
  }

  const ready: ReadyWave['ready'] = []
  const waiting: ReadyWave['waiting'] = []
  const skipped: ReadyWave['skipped'] = []
  for (const ticket of [...all.values()].sort(byNum)) {
    if (ticket.state !== 'open' && ticket.state !== 'blocked' && ticket.state !== 'none') continue

    const problem = ownProblem(ticket, all, cycleOf)
    const notDone = ticket.blockedNums.filter((blocker) => !closed(all.get(blocker)))
    if (ticket.state !== 'open') {
      // A cycle whose other members are all done no longer blocks anything, as for an open Ticket.
      if ((!problem || problem.kind === 'cycle') && notDone.length === 0) skipped.push({ num: ticket.num, state: ticket.state })
      continue
    }
    if (problem && problem.kind !== 'cycle') {
      waiting.push({ num: ticket.num, reason: problem })
      continue
    }
    if (notDone.length) {
      // A cycle whose other members are all done no longer blocks anything.
      waiting.push({ num: ticket.num, reason: problem?.kind === 'cycle' ? problem : { kind: 'blockers', blockers: notDone } })
      continue
    }

    const clashes = held.filter((entry) => ticket.files.some((file) => filesOverlap(file, entry.file)))
    if (clashes.length) {
      const files = ticket.files.filter((file) => clashes.some((entry) => filesOverlap(file, entry.file)))
      const heldBy = [...new Set(clashes.map((entry) => entry.num))].sort((a, b) => a - b)
      waiting.push({ num: ticket.num, reason: { kind: 'files', files, heldBy } })
      continue
    }

    ready.push({ num: ticket.num, filesNotListed: !ticket.filesListed })
    for (const file of ticket.files) held.push({ file, num: ticket.num })
  }
  return { ready, waiting, skipped }
}

/**
 * The Wave number of every Ticket of one Epic, keyed by Ticket number: the ready-Wave step
 * repeated to the end, as the "Волны" table of a spec counts it. Wave 1 is the ready Wave now;
 * then its Tickets count as done, and so do Tickets that are in work today or done only in a
 * worktree branch. Done and in-work Tickets get no number; neither do Tickets that never become
 * ready (a cycle, an unparsed or missing blocker, or a blocked state upstream).
 */
export function waveNumbers(tickets: readonly WaveTicket[], epic?: string): Map<number, number> {
  let current = [...epicTickets(tickets, epic).values()]
  const waves = new Map<number, number>()
  for (let wave = 1; ; wave += 1) {
    const { ready } = readyWave(current)
    const working = current.some(inFlight)
    if (!ready.length && !working) return waves
    const taken = new Set(ready.map((entry) => entry.num))
    for (const num of taken) waves.set(num, wave)
    current = current.map((ticket) => (taken.has(ticket.num) || inFlight(ticket) ? { ...ticket, state: 'done' as const, fromBranch: null } : ticket))
    // A round with nothing ready only lets the Tickets in work finish; it does not use a number.
    if (!ready.length) wave -= 1
  }
}
