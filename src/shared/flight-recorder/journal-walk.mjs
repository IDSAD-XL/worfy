// The Autopilot Journal (`<worfy data folder>/autopilot/<run>.jsonl`, the format is the header of
// src/shared/autopilot/journal.ts) read into facts: the events of a file, the Run, its Waves, the Limits waits and
// the stops of one Run, and per Ticket and Epic over every Run. Shared by scripts/critical-path.mjs, which runs
// without a build and cannot import TypeScript, and by the app, which imports this file from TypeScript (types in
// journal-walk.d.mts). Plain JavaScript without Node modules: src/shared runs in every process. It reads text and
// returns values; the caller reads the files.

/** Every kind of Journal event, as JOURNAL_EVENT_KINDS of src/shared/autopilot/journal.ts (a unit test keeps them equal). */
export const JOURNAL_KINDS = [
  'run-started',
  'harness-behind',
  'wave-started',
  'ticket-status',
  'narrow-round',
  'wave-finished',
  'start-window',
  'budget-stop',
  'limits-hit',
  'waiting-until',
  'resumed',
  'session-error',
  'refused-dialog',
  'human-input',
  'background-tasks',
  'run-stopping',
  'gate-queue',
  'gate-queue-finished',
  'run-stopped',
  'orchestrator-returned',
  'tasks-killed',
]

/** The time of an ISO text in ms, or null. */
export function time(text) {
  if (typeof text !== 'string') return null
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : ms
}

const isTickets = (value) => Array.isArray(value) && value.every((t) => typeof t === 'string' && t !== '')

/** The fields of a kind the walk and its readers rely on; the other kinds need only the common ones. */
const FIELDS = {
  'wave-started': (e) => Number.isInteger(e.wave) && isTickets(e.tickets),
  'wave-finished': (e) => Number.isInteger(e.wave) && isTickets(e.tickets),
  'narrow-round': (e) => typeof e.ticket === 'string' && ['started', 'verified', 'rejected'].includes(e.outcome),
  'ticket-status': (e) => typeof e.ticket === 'string' && e.ticket !== '' && ['claimed', 'blocked', 'done', 'open'].includes(e.state),
  'waiting-until': (e) => typeof e.until === 'string',
  'run-stopped': (e) => typeof e.reason === 'string',
}

/**
 * The events of one Journal file's text, in file order, `at` in ms. A line that does not fit is skipped and
 * counted: not JSON, a kind not in JOURNAL_KINDS, or fields that do not match (no time, no Epic, a field of
 * FIELDS missing).
 */
export function parseJournal(text) {
  const parsed = { lines: 0, notJson: 0, unknownKind: 0, badFields: 0, events: [] }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    parsed.lines++
    let event
    try {
      event = JSON.parse(line)
    } catch {
      parsed.notJson++
      continue
    }
    if (event === null || typeof event !== 'object' || !JOURNAL_KINDS.includes(event.kind)) {
      parsed.unknownKind++
      continue
    }
    const at = time(event.at)
    if (at === null || typeof event.epic !== 'string' || event.epic === '' || !(FIELDS[event.kind]?.(event) ?? true)) {
      parsed.badFields++
      continue
    }
    parsed.events.push({ ...event, at })
  }
  return parsed
}

/**
 * One Run from the events of its Journal file. A Wave runs from wave-started to wave-finished; a Wave the Run
 * stopped inside, or one a later wave-started replaced, has no end. A Limits wait starts at limits-hit or
 * waiting-until and ends at resumed or at the stop of the Run; it holds the Tickets of the Wave open when it
 * started, and has no end when the Journal ends while the Run waits. A stop is a session-error or the
 * run-stopped, with the Tickets of the Wave open at that moment.
 */
export function walkRun(events) {
  const run = { started: null, stopped: null, waves: [], waits: [], stops: [], narrowRounds: [] }
  let wave = null
  let wait = null
  const stop = (event, reason) => run.stops.push({ kind: event.kind, at: event.at, reason, epic: wave?.epic ?? event.epic, tickets: wave?.tickets ?? [] })
  for (const event of events) {
    const { epic, at } = event
    switch (event.kind) {
      case 'run-started':
        run.started ??= { at, epic, project: typeof event.project === 'string' ? event.project : null, origin: typeof event.origin === 'string' && event.origin !== '' ? event.origin : null }
        break
      case 'wave-started':
        wave = { epic, wave: event.wave, tickets: event.tickets, start: at, end: null }
        run.waves.push(wave)
        break
      case 'wave-finished':
        if (wave !== null) wave.end = at
        wave = null
        break
      case 'limits-hit':
      case 'waiting-until':
        if (wait === null) {
          wait = { epic, cause: event.kind, start: at, end: null, tickets: wave?.epic === epic ? wave.tickets : [] }
          run.waits.push(wait)
        }
        break
      case 'resumed':
        if (wait !== null) wait.end = at
        wait = null
        break
      case 'narrow-round':
        run.narrowRounds.push({ at, epic, ticket: event.ticket, outcome: event.outcome })
        break
      case 'session-error':
        stop(event, null)
        break
      case 'run-stopped':
        if (wait !== null) wait.end = at
        wait = null
        stop(event, event.reason)
        run.stopped = { at, reason: event.reason }
        wave = null
        break
      default:
        break
    }
  }
  return run
}

/**
 * What every Run of the Journals says about each Ticket (`<epic>/<NN>`) and each Epic: the first start of a
 * Ticket, its Limits wait, its narrow rounds and the stops while its Wave was open; the repository (origin),
 * Project and Limits wait of an Epic. `files` holds the events of each Journal file, in name order.
 */
export function walkJournals(files) {
  const tickets = new Map()
  // Journals written before run-started had origin name only the Project; a later run of the
  // same Project gives its repository.
  const projectOrigins = new Map()
  const epics = new Map()
  const ticketOf = (epic, num) => {
    const key = `${epic}/${num}`
    if (!tickets.has(key)) tickets.set(key, { start: null, wait: 0, openWait: false, stops: [], narrow: { started: 0, rejected: 0 } })
    return tickets.get(key)
  }
  const epicOf = (epic) => {
    if (!epics.has(epic)) epics.set(epic, { origin: null, project: null, wait: 0, openWait: false })
    return epics.get(epic)
  }
  for (const events of files) {
    for (const event of events) {
      if (typeof event.project === 'string' && event.project !== '') epicOf(event.epic).project = event.project
      if (event.kind === 'run-started' && typeof event.origin === 'string' && event.origin !== '') {
        epicOf(event.epic).origin = event.origin
        if (typeof event.project === 'string') projectOrigins.set(event.project, event.origin)
      }
    }
    const run = walkRun(events)
    for (const wave of run.waves) {
      epicOf(wave.epic)
      for (const num of wave.tickets) {
        const ticket = ticketOf(wave.epic, num)
        if (ticket.start === null || wave.start < ticket.start) ticket.start = wave.start
      }
    }
    for (const round of run.narrowRounds) {
      const narrow = ticketOf(round.epic, round.ticket).narrow
      if (round.outcome === 'started') narrow.started++
      if (round.outcome === 'rejected') narrow.rejected++
    }
    for (const wait of run.waits) {
      if (wait.end === null) {
        for (const num of wait.tickets) ticketOf(wait.epic, num).openWait = true
        epicOf(wait.epic).openWait = true
        continue
      }
      for (const num of wait.tickets) ticketOf(wait.epic, num).wait += wait.end - wait.start
      epicOf(wait.epic).wait += wait.end - wait.start
    }
    for (const stop of run.stops) {
      for (const num of stop.tickets) ticketOf(stop.epic, num).stops.push(stop.kind === 'run-stopped' ? `run-stopped: ${stop.reason}` : stop.kind)
    }
  }
  for (const info of epics.values()) info.origin ??= projectOrigins.get(info.project) ?? null
  return { tickets, epics }
}
