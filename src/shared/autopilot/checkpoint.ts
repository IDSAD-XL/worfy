// The checkpoint of an Autopilot Run: the state its journal (journal.ts, the format) holds, read back
// (worfy-continuity ticket 02). The journal is the Run's only record that outlives the app: worfy
// writes no other file for a Run, so what a restart of the app must know of it is read here, from the
// lines alone. Pure: the caller reads the file (src/main/autopilot/journal.ts) and gives its events.
//
// - The queue: the Epics in order (run-started, queue-changed, epic-started, as runEpics of
//   journal-walk.mjs reads them), those that ended (epic-finished), and the Epic the Run is on: the
//   last epic-started's, else the run-started's.
// - The start: the named Tickets, the Run mode, the Vendor (`claude` without one) and Auto-approval
//   (`off` without one), each as run-started says it.
// - The Wave: its number in the Epic the Run is on (0 before the first; an epic-started counts from 0
//   again), and its Tickets still in work — those of a wave-started without its wave-finished, minus
//   the ones a later ticket-status of the Run says `done` or `blocked`.
// - The wait the Run is in: a limits-hit (but a `quota` one, which a stop follows), start-window,
//   budget-stop or turn-retry opens one, with its until; a waiting-until gives the until (a bare
//   one, as before the Start window and the budget, is the Limits'); resumed, a Wave's start or end,
//   a retry-refused and run-stopped close it. A suspension does not: the wait goes on after a
//   restart until its until.
// - The retry: the last turn-retry's attempt and ceiling since the Wave's start.
// - The ladder of stuck Tickets (worfy-stuck-agents tickets 01, 05): per Ticket of the Run, its
//   ticket-continued lines and whether it was set aside (ticket-set-aside).
// - The end: run-stopped's reason and Tickets. The Run is cut off when its last line is
//   run-suspended, or when it has no run-stopped at all (the app was killed: the Flight Recorder
//   gives such a Run the outcome `cut-off`, src/shared/flight-recorder/facts.ts). `cutOff` says so,
//   with what a continuation goes on after: the suspension's cause, or `crash`. A run-continued after
//   the run-suspended means the Run went on.
// - `resumable`: the Tickets the next Run of the Epic takes into its first Wave if still in work
//   (AutopilotState.resumable; ADR-0050, ADR-0091). After a Force stop, a Session in error during a
//   Wave, or a Discard of a cut-off Run (`discarded`), the Tickets its run-stopped names; in a Run over
//   named Tickets, those it was given and does not name (carried); in a Run that sent no Wave in the
//   Epic it stopped on, all it was given. What a Run was given is what the Run before it left, when
//   that one was on the same Epic: resumableAfter() reads a Project's journals in order for it. A
//   cut-off Run leaves none until it is continued or discarded.
// - Unknown side effects (worfy-continuity ticket 07): the marks still open — an unknown-side-effects line, or one the
//   Run before on the same Epic left open (`before.marks`), without a later side-effects-checked of that Ticket — and
//   the Tickets included by Checked, include that no later wave-started carried yet. A marked Ticket is never
//   resumable, whatever run-stopped names; an included one is, once the Run is no longer cut off.
import type { EpicFinish } from './epic-queue'
import { type ContinuedAfter, type JournalEvent, parseJournal, type RunWaitKind } from './journal'
import type { RunMode } from './run-mode'
import { runEpics } from '../flight-recorder/journal-walk.mjs'
import type { VendorId } from '../vendors/vendor'

/** The stops whose run-stopped names Tickets the next Run takes along: their implementers died, or the Run was discarded. */
const RESUMABLE_STOPS: ReadonlySet<string> = new Set(['user-force-stop', 'session-error', 'discarded'])

/** What the Run before left: the Epic it was on when it stopped and its resumable Tickets. */
export interface LeftOver {
  epic: string
  resumable: readonly string[]
  /** The marks of Unknown side effects still open on that Epic (worfy-continuity ticket 07); absent: none. */
  marks?: readonly { ticket: string; actions: readonly string[] }[]
}

export interface RunCheckpoint {
  run: string
  project: string
  /** The Epic the Run began with (run-started). */
  first: string
  /** The Epic the Run is on: the last epic-started's, else the first. */
  epic: string
  /** The Epics of the Run in queue order: `[first]` for a Run of one Epic. */
  epics: string[]
  /** The Epics of the queue that ended, in order, with how. */
  finished: { epic: string; outcome: EpicFinish }[]
  /** The named Tickets of a Run over named Tickets; null for a Run over the whole Epic. */
  tickets: string[] | null
  mode: RunMode | null
  vendor: VendorId
  autoApproval: 'off' | 'shadow' | 'on'
  /** The number of the last Wave in the Epic the Run is on; 0 before its first. */
  wave: number
  /** The Tickets of that Wave still in work; none once it finished. */
  inWork: string[]
  /** The wait the Run is in; null when none. */
  waiting: { kind: RunWaitKind; until: string | null } | null
  /** The last turn-retry of the Wave: the attempt and the ceiling; null without one. */
  retry: { attempt: number; of: number } | null
  /** Per Ticket of the ladder, in order of its first line: its ticket-continued lines and whether it was set aside. */
  ladder: { epic: string; ticket: string; continued: number; setAside: boolean }[]
  /** The Run's run-stopped; null without one. */
  stopped: { reason: string; tickets: string[]; at: string } | null
  /** The Run is cut off by a restart: what a continuation goes on after, and the time of the last line before it. */
  cutOff: { after: ContinuedAfter; at: string } | null
  /**
   * The marks of Unknown side effects still open (worfy-continuity ticket 07): the Tickets left to a person, each with
   * worfy's summary of its calls without a result, in order of their lines (the Run before's first).
   */
  unknownSideEffects: { epic: string; ticket: string; actions: string[] }[]
  /** The Tickets given back by Checked, include that no later Wave carried yet, in order of their lines. */
  included: { epic: string; ticket: string }[]
  /** The Tickets the next Run of the Epic takes along, in number order. */
  resumable: string[]
  /** The lines of the file that did not read (journal.ts, Reading): a torn last line, a kind of a later build. */
  skipped: number
}

const byNumber = (a: string, b: string): number => Number(a) - Number(b) || a.localeCompare(b)

/**
 * The checkpoint of one Run from the events of its journal, in file order; null when it has none. `before`: what
 * the Run before it left (resumableAfter), for the Tickets this one was given; none — it was given none.
 */
export function runCheckpoint(events: readonly JournalEvent[], options: { skipped?: number; before?: LeftOver | null } = {}): RunCheckpoint | null {
  const head = events[0]
  if (head === undefined) return null
  const start = events.find((event): event is Extract<JournalEvent, { kind: 'run-started' }> => event.kind === 'run-started')
  const first = start?.epic ?? head.epic

  let epic = first
  const finished: RunCheckpoint['finished'] = []
  let wave = 0
  let open: { tickets: string[]; out: Set<string> } | null = null
  // Declared with `as`: TypeScript would narrow a plain `= null` to null for the reads inside the loop.
  let waiting = null as RunCheckpoint['waiting']
  let retry: RunCheckpoint['retry'] = null
  const ladder = new Map<string, RunCheckpoint['ladder'][number]>()
  let stopped: RunCheckpoint['stopped'] = null
  let suspended: { after: ContinuedAfter; at: string } | null = null
  const before = options.before ?? null
  const keyOf = (lineEpic: string, ticket: string): string => `${lineEpic}/${ticket}`
  // Insertion order is line order: the Run before's marks first.
  const marks = new Map<string, RunCheckpoint['unknownSideEffects'][number]>()
  if (before !== null && before.epic === first) for (const mark of before.marks ?? []) marks.set(keyOf(first, mark.ticket), { epic: first, ticket: mark.ticket, actions: [...mark.actions] })
  const included = new Map<string, RunCheckpoint['included'][number]>()

  const rung = (lineEpic: string, ticket: string): RunCheckpoint['ladder'][number] => {
    const key = `${lineEpic}/${ticket}`
    const known = ladder.get(key)
    if (known !== undefined) return known
    const made = { epic: lineEpic, ticket, continued: 0, setAside: false }
    ladder.set(key, made)
    return made
  }

  for (const event of events) {
    switch (event.kind) {
      case 'epic-started':
        epic = event.epic
        wave = 0
        open = null
        retry = null
        break
      case 'epic-finished':
        finished.push({ epic: event.epic, outcome: event.outcome })
        break
      case 'wave-started':
        wave = event.wave
        open = { tickets: [...event.tickets], out: new Set() }
        for (const ticket of event.tickets) included.delete(keyOf(event.epic, ticket))
        waiting = null
        retry = null
        break
      case 'wave-finished':
        open = null
        waiting = null
        retry = null
        break
      case 'ticket-status':
        if (open === null || event.epic !== epic) break
        if (event.state === 'done' || event.state === 'blocked') open.out.add(event.ticket)
        else open.out.delete(event.ticket)
        break
      case 'ticket-continued':
        rung(event.epic, event.ticket).continued += 1
        break
      case 'ticket-set-aside':
        rung(event.epic, event.ticket).setAside = true
        break
      case 'limits-hit':
        if (event.reason !== 'quota') waiting = { kind: 'limits', until: event.resetsAt }
        break
      case 'start-window':
        waiting = { kind: 'start-window', until: event.until }
        break
      case 'budget-stop':
        waiting = { kind: 'budget', until: event.until }
        break
      case 'turn-retry':
        waiting = { kind: 'retry', until: event.until }
        retry = { attempt: event.attempt, of: event.of }
        break
      case 'waiting-until':
        waiting = { kind: waiting?.kind ?? 'limits', until: event.until }
        break
      case 'resumed':
        waiting = null
        break
      case 'retry-refused':
        waiting = null
        retry = null
        break
      case 'run-stopped':
        stopped = { reason: event.reason, tickets: [...(event.tickets ?? [])], at: event.at }
        waiting = null
        break
      case 'run-suspended':
        suspended = { after: event.cause, at: event.at }
        break
      case 'run-continued':
        suspended = null
        break
      case 'unknown-side-effects':
        marks.set(keyOf(event.epic, event.ticket), { epic: event.epic, ticket: event.ticket, actions: [...event.actions] })
        included.delete(keyOf(event.epic, event.ticket))
        break
      case 'side-effects-checked':
        if (marks.delete(keyOf(event.epic, event.ticket))) included.set(keyOf(event.epic, event.ticket), { epic: event.epic, ticket: event.ticket })
        break
      default:
        break
    }
  }

  const last = events[events.length - 1]!
  const cutOff: RunCheckpoint['cutOff'] =
    last.kind === 'run-suspended' ? { after: last.cause, at: last.at } : stopped === null ? (suspended ?? { after: 'crash', at: last.at }) : null

  const given = before !== null && before.epic === first ? [...before.resumable] : []
  const named = start?.tickets ?? null
  const carried = named === null ? [] : given.filter((ticket) => !named.includes(ticket))
  const interrupted = stopped !== null && RESUMABLE_STOPS.has(stopped.reason) ? stopped.tickets : []
  const marked = new Set([...marks.values()].filter((mark) => mark.epic === epic).map((mark) => mark.ticket))
  const giveBack = [...included.values()].filter((each) => each.epic === epic).map((each) => each.ticket)
  const resumable =
    cutOff !== null ? [] : [...new Set([...(wave === 0 ? given : []), ...interrupted, ...carried, ...giveBack])].filter((ticket) => !marked.has(ticket)).sort(byNumber)

  return {
    run: head.run,
    project: head.project,
    first,
    epic,
    epics: runEpics(events),
    finished,
    tickets: named === null ? null : [...named],
    mode: start?.mode ?? null,
    vendor: start?.vendor ?? 'claude',
    autoApproval: start?.autoApproval ?? 'off',
    wave,
    inWork: open === null ? [] : open.tickets.filter((ticket) => !open!.out.has(ticket)),
    waiting,
    retry,
    ladder: [...ladder.values()],
    stopped,
    cutOff,
    unknownSideEffects: [...marks.values()],
    included: [...included.values()],
    resumable,
    skipped: options.skipped ?? 0,
  }
}

/** The checkpoint of one Run from its journal file's text (parseJournal); null when no line reads. */
export function readCheckpoint(source: string, before: LeftOver | null = null): RunCheckpoint | null {
  const { events, skipped } = parseJournal(source)
  return runCheckpoint(events, { skipped, before })
}

/**
 * What a Project's last Run left for the next Run (AutopilotState.resumable of its stopped state): the journals of the
 * Project's Runs, oldest first, each read with what the one before left. Null without a Run.
 */
export function resumableAfter(runs: readonly (readonly JournalEvent[])[]): LeftOver | null {
  let left: LeftOver | null = null
  for (const events of runs) {
    const checkpoint = runCheckpoint(events, { before: left })
    if (checkpoint === null) continue
    const marks = checkpoint.unknownSideEffects.filter((mark) => mark.epic === checkpoint.epic).map((mark) => ({ ticket: mark.ticket, actions: mark.actions }))
    left = { epic: checkpoint.epic, resumable: checkpoint.resumable, ...(marks.length === 0 ? {} : { marks }) }
  }
  return left
}
