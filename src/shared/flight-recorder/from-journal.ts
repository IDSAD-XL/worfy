// The facts of the Autopilot Journal for the span model (worfy-flight-recorder ticket 13; the
// reader's part of the contract in facts.ts): the lines of one Run's Journal turned into the frame of
// the Run (decision 08, Q5) — the Run and its Waves, the Waits, the Tickets' statuses, the Journal's
// retry causes and the marks on the Orchestrator's lane. Pure: no Node, no DOM; the lines are parsed by
// journal-walk.mjs (ticket 10), the caller reads the file (`<data dir>/autopilot/<run>.jsonl`).
//
// - A Ticket is `<epic>/<NN>`, the number as the Journal writes it (`wave-started.tickets`): the key
//   the other readers are given for the Run's Tickets.
// - The Run ends at its run-stopped: the lines after it (background tasks while the Run waits to give
//   the Orchestrator back, orchestrator-returned, tasks-killed) are not the Run's, only its last
//   sighting (`lastSeenAt`). A line of another Run (an observer that wrote to the wrong file) is skipped.
// - Waits (decision 03, Q5): `limits` from limits-hit (or a waiting-until alone) to resumed,
//   `limits-budget` from budget-stop to resumed, `background-tasks` from a background-tasks line with
//   live tasks to the next one with none, `gate-queue` from gate-queue to gate-queue-finished. A
//   Limits or background-tasks Wait still open at run-stopped ends there; a gate-queue has its own
//   end, so one without it (a Journal of before ticket 11) is left open, last seen at run-stopped
//   (which follows the gate queue's turn), and the model cuts it off there.
// - The `background-tasks` Wait is the Journal's word, not the Run standing idle: the tasks are the
//   Orchestrator's agents, gate runs and scripts, so the Wait covers their own work (on the night Run,
//   most of the Run). The Journal cannot tell whether the Orchestrator's turn still went on meanwhile
//   either, so the Wait starts with the first live task. The reader stays faithful to the Journal;
//   counting such a Wait only where no work of the Run runs is the model's rule, a later ticket of
//   this Epic.
// - Statuses from ticket-status. Its `at` is when worfy saw the change, maybe only at the read right
//   before run-stopped; the time of the change is `statusAt` when it is a full timestamp with a zone
//   and lies between the Ticket's previous status and the sighting. A bare date or a time without a
//   zone gives no moment, a later one is no time of a change seen before, and one before the previous
//   status is a Status line older than the change (git brought the file in: a merge, a fast-forward
//   of the main checkout): the sighting stands for all three. A first status from before the Run
//   (claimed before it, the line brought in later) is clamped to the Run's start: the Ticket was in
//   that state when the Run began.
// - A Journal of before ticket 11 (no ticket-status line, run-started without `by`) claims each Ticket
//   at the first wave-started that names it. A later Journal claims nothing there: a Ticket with no
//   ticket-status kept its status through the Run (one a resumed Run took over in work counts as
//   claimed by its first other event, in the model).
// - Retry causes: narrow-round `started` (the narrow fix round of a Ticket) and session-error (no
//   Ticket); the model puts each on the first agent work at or after it.
// - refused-dialog and human-input are marks on the Orchestrator's lane, not Waits.
import type { AutopilotStopReason } from '../autopilot/cycle'
import { RUN_STARTED_BY } from '../autopilot/journal'
import type { OrchestratorMarkFact, RetryCauseFact, RunFact, SpanOutcome, StageEventFact, WaitCause, WaitFact, WaveFact } from './facts'
import { parseJournal, walkRun, type JournalEvent } from './journal-walk.mjs'

type Iso = string

export interface JournalInput {
  /** The run id: the file name without `.jsonl`. */
  run: string
  /** The lines of the file, in file order. */
  lines: readonly string[]
}

/** A Wave, with the text the Orchestrator got (the transcript reader finds the Wave's prompt by it). */
export interface JournalWave extends WaveFact {
  text?: string
}

/** The part of RunFacts the Journal fills, and what the service needs to ask the other readers. */
export interface JournalFacts {
  /** The Run; `live` is the service's. */
  run: Omit<RunFact, 'live'>
  epic: string
  /** Every Ticket the Waves name, in the order they are first named. */
  tickets: string[]
  /** run-started `by`: who started the Run (`button`, `command`, `tool`), as written. */
  by?: string
  /** run-started `tickets`: a Run over named Tickets. */
  named?: string[]
  waves: JournalWave[]
  ticketEvents: StageEventFact[]
  retryCauses: RetryCauseFact[]
  waits: WaitFact[]
  orchestratorMarks: OrchestratorMarkFact[]
  /** The lines left out: not JSON, an unknown kind, fields that do not match, another Run's. */
  skipped: number
}

/**
 * How a Run ended, by the reason of its run-stopped (AUTOPILOT_STOP_REASONS of
 * src/shared/autopilot/cycle.ts): nothing left to send is `ok`, a stop on blocked Tickets `blocked`,
 * a person's or the app's stop `stopped` (`interrupted`: the Orchestrator's turn was interrupted, which
 * only the Interrupt button of a Session does, through agent.interrupt), the rest — an error, a stall,
 * a Wave that made no progress, a Start window too short for any Wave (`window-too-short`) — `failed`. `session-closed` is `failed`: the Session closes under the
 * Run when a person closes it, and also when a new Session for the next Wave does not come up.
 */
export const STOP_OUTCOMES: Readonly<Record<AutopilotStopReason, SpanOutcome>> = {
  'tickets-done': 'ok',
  'no-ready-wave': 'ok',
  'blocked-tickets': 'blocked',
  'user-stop': 'stopped',
  'user-force-stop': 'stopped',
  'app-quit': 'stopped',
  'no-progress': 'failed',
  'wave-unfinished': 'failed',
  'session-error': 'failed',
  'turn-error': 'failed',
  interrupted: 'stopped',
  'session-closed': 'failed',
  'send-failed': 'failed',
  'workflow-error': 'failed',
  'limits-timeout': 'failed',
  'background-stalled': 'failed',
  'window-too-short': 'failed',
}

const iso = (ms: number): Iso => new Date(ms).toISOString()
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const numbers = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '') ? (value as string[]) : undefined)

/** A full timestamp with a zone: a moment. A date, or a time without a zone, is none. */
const FULL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/iu
function moment(value: unknown): number | null {
  if (typeof value !== 'string' || !FULL_TIME.test(value)) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** What a background task is called: its description, else its type or id. */
function taskNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((task: unknown) => {
    if (task === null || typeof task !== 'object') return []
    const { description, type, id } = task as Record<string, unknown>
    const name = text(description) ?? text(type) ?? text(id)
    return name === undefined ? [] : [name]
  })
}

interface OpenWait {
  cause: WaitCause
  start: number
  lastSeen: number
  detail: string[]
}

/** The facts of one Run's Journal; null when no line of it can be read. */
export function journalFacts(input: JournalInput): JournalFacts | null {
  const parsed = parseJournal(input.lines.join('\n'))
  const ours = (event: JournalEvent): boolean => typeof event.run !== 'string' || event.run === input.run
  const events = parsed.events.filter(ours)
  const first = events[0]
  if (first === undefined) return null
  const skipped = parsed.notJson + parsed.unknownKind + parsed.badFields + (parsed.events.length - events.length)

  const epic = first.epic
  const key = (num: string): string => `${epic}/${num}`
  const walked = walkRun(events)
  const stopIndex = events.findLastIndex((event) => event.kind === 'run-stopped')
  const inRun = stopIndex === -1 ? events : events.slice(0, stopIndex + 1)
  const lastSeen = Math.max(...events.map((event) => event.at))

  // The Run.
  const runStarted = events.find((event) => event.kind === 'run-started')
  const startedAt = walked.started?.at ?? first.at
  const run: JournalFacts['run'] = { id: input.run, startedAt: iso(startedAt), stoppedAt: walked.stopped === null ? null : iso(walked.stopped.at), lastSeenAt: iso(lastSeen) }
  if (walked.stopped !== null) {
    run.reason = walked.stopped.reason
    const outcome = Object.hasOwn(STOP_OUTCOMES, walked.stopped.reason) ? (STOP_OUTCOMES as Record<string, SpanOutcome>)[walked.stopped.reason] : undefined
    if (outcome !== undefined) run.outcome = outcome
  }

  // The Waves: walkRun gives one per wave-started, in file order.
  const starts = events.flatMap((event, index) => (event.kind === 'wave-started' ? [index] : []))
  const waves = walked.waves.map((wave, n): JournalWave => {
    const index = starts[n] ?? 0
    const line = events[index]
    const fact: JournalWave = { number: wave.wave, startedAt: iso(wave.start), finishedAt: wave.end === null ? null : iso(wave.end), tickets: wave.tickets.map(key) }
    if (wave.end === null) {
      // Its last line: before the next wave-started, else up to run-stopped or the end of the file.
      const next = starts[n + 1]
      const through = Math.min(next === undefined ? events.length - 1 : next - 1, stopIndex === -1 ? events.length - 1 : stopIndex)
      // A wave-started after run-stopped (no writer does that) is last seen at its own line.
      fact.lastSeenAt = iso(through < index ? wave.start : Math.max(...events.slice(index, through + 1).map((event) => event.at)))
    }
    const session = text(line?.session)
    if (session !== undefined) fact.session = session
    const prompt = text(line?.text)
    if (prompt !== undefined) fact.text = prompt
    return fact
  })
  const tickets = [...new Set(waves.flatMap((wave) => wave.tickets))]

  // The statuses of the Tickets.
  const ticketEvents: StageEventFact[] = []
  const previous = new Map<string, number>()
  for (const event of inRun) {
    if (event.kind !== 'ticket-status') continue
    const ticket = key(event.ticket as string)
    const told = moment(event.statusAt)
    const before = previous.get(ticket)
    const at = told === null || told > event.at || (before !== undefined && told < before) ? event.at : Math.max(told, startedAt)
    previous.set(ticket, at)
    const reason = text(event.reason)
    const waits = text(event.waits)
    ticketEvents.push({
      ticket,
      at: iso(at),
      source: 'journal',
      event: 'status',
      state: event.state as 'claimed' | 'blocked' | 'done' | 'open',
      ...(reason === undefined ? {} : { reason }),
      ...(waits === undefined ? {} : { waits }),
    })
  }
  const oldJournal = !events.some((event) => event.kind === 'ticket-status') && !(runStarted !== undefined && 'by' in runStarted)
  if (oldJournal) {
    const claimed = new Set<string>()
    for (const wave of waves) {
      for (const ticket of wave.tickets) {
        if (claimed.has(ticket)) continue
        claimed.add(ticket)
        ticketEvents.push({ ticket, at: wave.startedAt, source: 'journal', event: 'status', state: 'claimed' })
      }
    }
  }

  // Waits, retry causes and the Orchestrator's marks: the lines up to run-stopped.
  const waits: WaitFact[] = []
  const counts = new Map<WaitCause, number>()
  const close = (wait: OpenWait, end: number | null) => {
    const n = (counts.get(wait.cause) ?? 0) + 1
    counts.set(wait.cause, n)
    const detail = wait.detail.length === 0 ? undefined : wait.detail.join(wait.cause === 'background-tasks' ? '; ' : ', ')
    waits.push({
      id: `${wait.cause}:${n}`,
      cause: wait.cause,
      start: iso(wait.start),
      end: end === null ? null : iso(end),
      ...(end === null ? { lastSeenAt: iso(wait.lastSeen) } : {}),
      ...(detail === undefined ? {} : { detail }),
      startSource: 'journal',
      ...(end === null ? {} : { endSource: 'journal' as const }),
    })
  }
  const open = (cause: WaitCause, at: number, detail: string[] = []): OpenWait => ({ cause, start: at, lastSeen: at, detail })
  let limits: OpenWait | null = null
  let tasks: OpenWait | null = null
  let gate: OpenWait | null = null
  const retryCauses: RetryCauseFact[] = []
  const orchestratorMarks: OrchestratorMarkFact[] = []

  for (const event of inRun) {
    const { at } = event
    for (const wait of [limits, tasks, gate]) if (wait !== null) wait.lastSeen = at
    switch (event.kind) {
      case 'limits-hit':
        limits ??= open('limits', at, text(event.window) === undefined ? [] : [event.window as string])
        break
      case 'budget-stop':
        limits ??= open('limits-budget', at, text(event.cause) === undefined ? [] : [event.cause as string])
        break
      case 'waiting-until':
        limits ??= open('limits', at)
        limits.detail = [...limits.detail.filter((part) => !part.startsWith('until ')), `until ${event.until as string}`]
        break
      case 'resumed':
        if (limits !== null) close(limits, at)
        limits = null
        break
      case 'background-tasks': {
        const names = taskNames(event.tasks)
        if (names.length === 0) {
          if (tasks !== null) close(tasks, at)
          tasks = null
          break
        }
        tasks ??= open('background-tasks', at)
        for (const name of names) if (!tasks.detail.includes(name)) tasks.detail.push(name)
        break
      }
      case 'gate-queue':
        gate ??= open('gate-queue', at)
        break
      case 'gate-queue-finished':
        if (gate !== null) close(gate, at)
        gate = null
        break
      case 'run-stopped':
        // The stop ends the Limits and the background tasks the Run waited for; a gate queue has an end of its own.
        if (limits !== null) close(limits, at)
        if (tasks !== null) close(tasks, at)
        limits = null
        tasks = null
        break
      case 'narrow-round':
        if (event.outcome === 'started') {
          const said = text(event.text)
          retryCauses.push({ ticket: key(event.ticket as string), kind: 'agent', at: iso(at), reason: said === undefined ? 'narrow round' : `narrow round: ${said}`, source: 'journal' })
        }
        break
      case 'session-error': {
        const message = text(event.message)
        retryCauses.push({ ticket: null, kind: 'agent', at: iso(at), reason: message === undefined ? 'session-error' : `session-error: ${message}`, source: 'journal' })
        break
      }
      case 'refused-dialog': {
        const agent = text(event.agent)
        const reason = text(event.reason)
        orchestratorMarks.push({ kind: 'refused-dialog', at: iso(at), text: `${text(event.what) ?? 'a request'}${agent === undefined ? '' : ` (agent ${agent})`}${reason === undefined ? '' : `: ${reason}`}` })
        break
      }
      case 'human-input': {
        const source = text(event.source)
        orchestratorMarks.push({ kind: 'human-input', at: iso(at), text: `${text(event.what) ?? 'a person stepped in'}${source === undefined ? '' : ` (${source})`}` })
        break
      }
      default:
        break
    }
  }
  for (const wait of [limits, tasks, gate]) if (wait !== null) close(wait, null)
  waits.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  // A budget-stop is checked before a Wave, never inside one (often in the millisecond of the last
  // wave-finished, where the model still counts that Wave open): the Tickets that stood are the next
  // Wave's, none when the Run sent no other.
  for (const wait of waits) {
    if (wait.cause !== 'limits-budget') continue
    wait.tickets = waves.find((wave) => Date.parse(wave.startedAt) >= Date.parse(wait.start))?.tickets ?? []
  }

  const facts: JournalFacts = { run, epic, tickets, waves, ticketEvents, retryCauses, waits, orchestratorMarks, skipped }
  // Another value of `by` reads as none (the run-started header of src/shared/autopilot/journal.ts).
  const by = (RUN_STARTED_BY as readonly unknown[]).includes(runStarted?.by) ? (runStarted?.by as string) : undefined
  if (by !== undefined) facts.by = by
  const named = numbers(runStarted?.tickets)
  if (named !== undefined) facts.named = named.map(key)
  return facts
}
