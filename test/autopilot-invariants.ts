// The Recovery invariants of an Autopilot Run (worfy-faults ticket 01; the rules table of the
// recovery rules in .scratch/worfy-faults/spec.md): what must hold after any Fault scenario.
// A contract or e2e test injects one fault into a Run on the fake agent, collects what the Run left
// behind and calls checkRecovery; an empty list means every rule holds. Pure functions: no
// Electron, no file system — the caller reads the files.
//
//   I1  the command of a Wave reaches the Orchestrator once per Wave
//   I2  worfy changes nothing on GitHub: every gh call is a read
//   I3  one ticket-status line per change of a Ticket's Status:, none lost, none repeated
//   I4  the journal names the expected reason and ends (no run-stopped only for a killed app);
//       with Auto-continue on (worfy-retry ticket 09) each turn-retry gets its resumed, and a
//       retry-refused is the give-up right before run-stopped turn-error
//
// The continuation Auto-continue sends after a turn-retry holds no `/epic-wave` line: I1 does not
// count it as a Wave's command, and a Wave command sent again in its place is a second one.
//   I5  no person stepped in: no human-input, no refused-dialog
//   I6  a new start after the stop goes through: a new journal that begins with run-started
//   I7  worfy writes nothing into the Project
//   I8  every line of the journal reads (a killed app may leave one torn last line)
//
// A violation is one English line that starts with the rule's number: "I1: /epic-wave for wave 1
// sent 2 times".
import { parseJournal, type JournalEvent, type TicketStatusState } from '../src/shared/autopilot/journal'

/** A change of a Ticket's `Status:` line the test made for the Orchestrator. */
export interface StatusWrite {
  /** When the test wrote it, ISO. */
  at: string
  /** The Ticket's file, from the Project's root, either separator. */
  file: string
  /** The Ticket's number, as `ticket-status` names it: `01`. */
  ticket: string
  state: TicketStatusState
}

/** What the scenario expects of its Run — the first journal. */
export interface RecoveryExpect {
  /** `run-stopped.reason` of the Run; null: no run-stopped at all (the app was killed). */
  stop: string | null
  /** The error text of the scenario: a `session-error` of the Run before its stop matches it. */
  errorText?: RegExp
  /** How many `wave-started` lines all the journals hold together. */
  waves: number
  /** The Run survived the fault: it has a `resumed` line. */
  resumed?: boolean
  /** With Auto-continue on (worfy-retry ticket 09): the reason of the `retry-refused` the Run stops with turn-error after. */
  refused?: Extract<JournalEvent, { kind: 'retry-refused' }>['reason']
  /** The journal of a Run without run-stopped may end with one unreadable line (SIGKILL tore it). */
  tornLastLine?: boolean
}

export interface RecoveryInput {
  /** The text of each journal file, in run order: the scenario's Run first, then the new starts. */
  journals: string[]
  /** The texts the Orchestrator got, in order (WORFY_AGENT_LOG lines or FakeCall `message`). */
  messages: string[]
  /** The arguments of each gh stub call, in order (GH_STUB_LOG lines); absent — gh was not watched. */
  gh?: string[][]
  statusWrites: StatusWrite[]
  /** Every file of the Project before and after the scenario: path → bytes as base64 (`files()` of the e2e). */
  projectBefore: Record<string, string>
  projectAfter: Record<string, string>
  /** The new start after the Run stopped: its refusal, null when it went through; null — the test did not start again. */
  restart: { refusal: string | null } | null
  expect: RecoveryExpect
}

/** One journal file, read. */
interface Run {
  /** 1 for the scenario's Run, 2 and on for the new starts. */
  number: number
  text: string
  events: JournalEvent[]
}

type RunStopped = Extract<JournalEvent, { kind: 'run-stopped' }>
type Rule = (input: RecoveryInput, runs: readonly Run[]) => string[]

const stoppedOf = (run: Run): RunStopped | undefined => run.events.find((event): event is RunStopped => event.kind === 'run-stopped')
const list = (items: readonly string[]): string => items.join(', ')
const sameSet = (a: readonly string[], b: readonly string[]): boolean => list([...new Set(a)].sort()) === list([...new Set(b)].sort())

/** A line of a message that is the command of a Wave: `/epic-wave …` or `/worfy:epic-wave …`. */
const WAVE_COMMAND = /^[ \t]*\/(?:worfy:)?epic-wave\b.*$/mu

/** The Ticket numbers the Wave command in `message` names, or null when it holds none. */
function commandTickets(message: string, epic: string): string[] | null {
  const line = WAVE_COMMAND.exec(message)?.[0]
  if (line === undefined) return null
  const words = epic === '' ? line : line.replaceAll(epic, ' ')
  return [...words.matchAll(/\b\d+\b/gu)].map((match) => match[0])
}

/** I1: one Wave command per `wave-started`, naming that Wave's Tickets, and the Waves the scenario expects. */
export const waveCommandOnce: Rule = (input, runs) => {
  const waves = runs.flatMap((run) => run.events.flatMap((event) => (event.kind === 'wave-started' ? [{ run: run.number, wave: event.wave, tickets: event.tickets }] : [])))
  const label = (wave: (typeof waves)[number]): string => `wave ${wave.wave}${wave.run > 1 ? ` of run ${wave.run}` : ''}`
  const epic = runs.flatMap((run) => run.events)[0]?.epic ?? ''
  const out: string[] = []
  if (waves.length !== input.expect.waves) out.push(`I1: ${waves.length} wave-started, the scenario expects ${input.expect.waves}`)
  const sent = waves.map(() => 0)
  let next = 0
  for (const message of input.messages) {
    const tickets = commandTickets(message, epic)
    if (tickets === null) continue
    const wave = waves[next]
    if (wave !== undefined && sameSet(tickets, wave.tickets)) sent[next++] = 1
    // The same Tickets as the Wave sent last: that Wave's command went again.
    else if (next > 0 && sameSet(tickets, waves[next - 1]!.tickets)) sent[next - 1]! += 1
    else out.push(`I1: /epic-wave names ${list(tickets)}, which no wave-started announces`)
  }
  waves.forEach((wave, index) => {
    if (sent[index] === 0) out.push(`I1: ${label(wave)} (${list(wave.tickets)}) has no /epic-wave`)
    else if (sent[index]! > 1) out.push(`I1: /epic-wave for ${label(wave)} sent ${sent[index]} times`)
  })
  return out
}

/** `-X PATCH`, `--method=PATCH`, `-f key=value`, `--input file`: options that make `gh api` write. */
const API_WRITE = /^(?:-X|--method|-f|-F|--field|--raw-field|--input)(?:=|$)|^-[XfF]./u

function ghReads(args: readonly string[]): boolean {
  const [group, command] = args
  if (group === 'pr' && command === 'list') return true
  if (group === 'auth' && (command === 'status' || command === 'token')) return true
  if (group === 'api' && /^repos\/[^/\s]+\/[^/\s]+$/u.test(command ?? '')) return !args.slice(2).some((arg) => API_WRITE.test(arg))
  return false
}

/** I2: every gh call is on the read list of the spec: `pr list`, `auth status`, `auth token`, `api repos/<owner>/<repo>` without a write option. */
export const ghOnlyReads: Rule = (input) =>
  (input.gh ?? []).flatMap((args, index) => (ghReads(args) ? [] : [`I2: gh log line ${index + 1}: gh ${args.join(' ')} is not a read`]))

/** Runs that end without the last read of the Tickets: a Force stop, a quit, a killed app. */
const NO_LAST_READ = new Set(['user-force-stop', 'app-quit'])

/** I3: per Ticket, the run's `ticket-status` states are its Status changes during the run, in order. */
export const statusOnce: Rule = (input, runs) => {
  const out: string[] = []
  const startOf = (run: Run): number => Date.parse(run.events[0]?.at ?? '')
  runs.forEach((run, index) => {
    const stopped = stoppedOf(run)
    const next = runs[index + 1]
    const from = startOf(run)
    const until = stopped !== undefined ? Date.parse(stopped.at) : next !== undefined ? startOf(next) : Infinity
    const lastRead = stopped !== undefined && !NO_LAST_READ.has(stopped.reason)
    const writes = input.statusWrites.filter((write) => Date.parse(write.at) >= from && Date.parse(write.at) <= until)
    const journaled = run.events.flatMap((event) => (event.kind === 'ticket-status' ? [event] : []))
    const tickets = [...new Set([...writes.map((write) => write.ticket), ...journaled.map((event) => event.ticket)])].sort()
    for (const ticket of tickets) {
      const changes = writes.filter((write) => write.ticket === ticket).map((write) => write.state)
      const lines = journaled.filter((event) => event.ticket === ticket).map((event) => event.state)
      if (list(lines) === list(changes)) continue
      // Without the last read the latest changes may be missing, never the earlier ones.
      if (!lastRead && list(lines) === list(changes.slice(0, lines.length))) continue
      const what = lines.length > changes.length ? 'extra ticket-status' : lines.length < changes.length ? 'missing ticket-status' : 'ticket-status out of step'
      out.push(`I3: ticket ${ticket} in run ${run.number}: ${what} (journaled: ${list(lines) || 'none'}; Status changes: ${list(changes) || 'none'})`)
    }
  })
  return out
}

/** I4: the event a reason of `run-stopped` needs before it in the same run (spec, the causes table). */
const CAUSE_EVENT: Readonly<Record<string, JournalEvent['kind']>> = {
  'turn-error': 'session-error',
  'session-error': 'session-error',
  'limits-timeout': 'limits-hit',
  'background-stalled': 'background-tasks',
}

/** I4: the scenario's Run stops with the expected reason after the event that reason needs, or is resumed, or has no run-stopped when killed. */
export const namesItsEnd: Rule = (input, runs) => {
  const run = runs[0]
  if (run === undefined) return ['I4: no journal']
  const { stop, errorText, resumed } = input.expect
  const out: string[] = []
  const stops = run.events.filter((event): event is RunStopped => event.kind === 'run-stopped')
  const end = stops[0]
  const before = end === undefined ? run.events : run.events.slice(0, run.events.indexOf(end))
  const errors = before.flatMap((event) => (event.kind === 'session-error' ? [event.message] : []))
  if (stop === null) {
    if (end !== undefined) out.push(`I4: run-stopped ${end.reason}, the scenario expects none (killed app)`)
  } else if (end === undefined) out.push(`I4: no run-stopped, the scenario expects ${stop}`)
  else if (stops.length > 1) out.push(`I4: ${stops.length} run-stopped lines`)
  else if (end.reason !== stop) out.push(`I4: run-stopped ${end.reason}, the scenario expects ${stop}`)
  else {
    const cause = CAUSE_EVENT[stop]
    if (cause !== undefined && !before.some((event) => event.kind === cause)) out.push(`I4: run-stopped ${stop} has no ${cause} before it`)
    else if (cause === 'session-error' && errorText !== undefined && !errors.some((message) => errorText.test(message)))
      out.push(`I4: session-error before run-stopped ${stop} does not match ${String(errorText)}: ${errors.at(-1)}`)
  }
  // A Run that survived the error with Auto-continue names it in its turn-retry rather than in a session-error.
  const retried = before.flatMap((event) => (event.kind === 'turn-retry' ? [event.message] : []))
  if (errorText !== undefined && (stop === null || CAUSE_EVENT[stop] !== 'session-error') && ![...errors, ...retried].some((message) => errorText.test(message)))
    out.push(`I4: no session-error or turn-retry matches ${String(errorText)}`)
  if (resumed === true && !run.events.some((event) => event.kind === 'resumed')) out.push('I4: the Run has no resumed')
  return [...out, ...retriesEnd(run, input.expect)]
}

/** Stops of a person: a wait to retry may end with them, without its `resumed`. */
const PERSON_STOPS = new Set(['user-stop', 'user-force-stop', 'app-quit'])
/** The events that end a wait to retry or follow a give-up: the next one after `turn-retry` or `retry-refused`. */
const RETRY_NEXT = new Set<JournalEvent['kind']>(['resumed', 'turn-retry', 'retry-refused', 'wave-started', 'wave-finished', 'run-stopped'])

/**
 * I4 with Auto-continue (worfy-retry ticket 09): each `turn-retry` gets its `resumed` before the run's
 * next step (unless a person stopped the run during the wait, or the app was killed); a `retry-refused`
 * is followed by `run-stopped` `turn-error`; and the scenario's `refused` reason stands before that stop.
 */
function retriesEnd(run: Run, expect: RecoveryExpect): string[] {
  const out: string[] = []
  const events = run.events
  const nextOf = (index: number): JournalEvent | undefined => events.slice(index + 1).find((event) => RETRY_NEXT.has(event.kind))
  events.forEach((event, index) => {
    const next = nextOf(index)
    if (event.kind === 'turn-retry') {
      if (next?.kind === 'resumed') return
      if (next?.kind === 'run-stopped' && PERSON_STOPS.has(next.reason)) return
      if (next === undefined && expect.stop === null) return
      out.push(`I4: turn-retry ${event.attempt} has no resumed before ${next === undefined ? 'the end of the journal' : next.kind}`)
    } else if (event.kind === 'retry-refused') {
      if (next?.kind === 'run-stopped' && next.reason === 'turn-error') return
      if (next === undefined && expect.stop === null) return
      const what = next === undefined ? 'the end of the journal' : next.kind === 'run-stopped' ? `run-stopped ${next.reason}` : next.kind
      out.push(`I4: retry-refused ${event.reason} is followed by ${what}, not run-stopped turn-error`)
    }
  })
  if (expect.refused !== undefined) {
    const end = events.findIndex((event) => event.kind === 'run-stopped')
    const refusals = (end === -1 ? events : events.slice(0, end)).flatMap((event) => (event.kind === 'retry-refused' ? [event.reason] : []))
    if (!refusals.includes(expect.refused))
      out.push(`I4: no retry-refused ${expect.refused} before ${end === -1 ? 'the end of the journal' : 'run-stopped'}`)
  }
  return out
}

/** I5: no line of a person stepping in, in any run. */
export const noHumanStep: Rule = (_input, runs) =>
  runs.flatMap((run) =>
    run.events.flatMap((event) => (event.kind === 'human-input' || event.kind === 'refused-dialog' ? [`I5: ${event.kind} in run ${run.number}: ${event.what}`] : [])),
  )

/** I6: the new start went through and began a journal of its own. */
export const startsAgain: Rule = (input, runs) => {
  if (input.restart === null) return []
  if (input.restart.refusal !== null) return [`I6: the new start was refused: ${input.restart.refusal}`]
  const first = runs[0]?.events[0]?.run
  const last = runs.length > 1 ? runs.at(-1)!.events[0] : undefined
  return last?.kind === 'run-started' && last.run !== first ? [] : ['I6: no new journal with run-started after the new start']
}

const slashes = (files: Record<string, string>): Map<string, string> => new Map(Object.entries(files).map(([path, bytes]) => [path.replaceAll('\\', '/'), bytes]))

/** I7: every file of the Project that differs after the scenario is one the test wrote for the Orchestrator. */
export const projectUntouched: Rule = (input) => {
  const before = slashes(input.projectBefore)
  const after = slashes(input.projectAfter)
  const written = new Set(input.statusWrites.map((write) => write.file.replaceAll('\\', '/')))
  const out: string[] = []
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (written.has(path) || before.get(path) === after.get(path)) continue
    if (!before.has(path)) out.push(`I7: worfy wrote ${path} into the Project`)
    else if (!after.has(path)) out.push(`I7: worfy removed ${path} from the Project`)
    else out.push(`I7: worfy changed ${path} in the Project`)
  }
  return out
}

/** I8: every line of each journal reads; a run without run-stopped may end with one torn line when the scenario allows it. */
export const journalReads: Rule = (input, runs) =>
  runs.flatMap((run) => {
    const lines = run.text.split('\n')
    const unreadable = lines.flatMap((line, index) => (line.trim() !== '' && parseJournal(line).skipped > 0 ? [index + 1] : []))
    if (unreadable.length === 0) return []
    const last = lines.findLastIndex((line) => line.trim() !== '') + 1
    if (input.expect.tornLastLine === true && stoppedOf(run) === undefined && unreadable.length === 1 && unreadable[0] === last) return []
    return [`I8: journal of run ${run.number}: unreadable line ${list(unreadable.map(String))}`]
  })

/** The rules in order, by number. */
export const RECOVERY_RULES: Readonly<Record<string, Rule>> = {
  I1: waveCommandOnce,
  I2: ghOnlyReads,
  I3: statusOnce,
  I4: namesItsEnd,
  I5: noHumanStep,
  I6: startsAgain,
  I7: projectUntouched,
  I8: journalReads,
}

/** Every violation of I1–I8 by the Run `input` describes, in rule order; empty when all hold. */
export function checkRecovery(input: RecoveryInput): string[] {
  const runs = input.journals.map((text, index): Run => ({ number: index + 1, text, events: parseJournal(text).events }))
  return Object.values(RECOVERY_RULES).flatMap((rule) => rule(input, runs))
}
