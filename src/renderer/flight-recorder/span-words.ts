// The words and colours a span goes by on the Run history screen (worfy-flight-recorder tickets 18, 19): its
// name, the token of its colour, its duration, its outcome and its lost source, shared by the timeline
// (Timeline.tsx) and the detail panel (DetailPanel.tsx). The continuation ladder (worfy-stuck-agents ticket
// 05) has its words here too: the stop `main-red`, the reason of the attempt a `ticket-continued` caused,
// and the mark of a `ticket-set-aside` on the Run's row. So has the stop `turn-hung` (ticket 09).
import { QUIET_HUNG_MS } from '../../shared/autopilot/cycle'
import type { OrchestratorMarkFact } from '../../shared/flight-recorder/facts'
import { LOST_SOURCE_LABELS, type Span, type WaitCause } from '../../shared/flight-recorder/spans'
import { formatLocal } from './store'

/** The colour token of a span's kind: `--span-<token>` (tokens.css, F-SPEC "Run history"). */
export function tokenOf(span: Span): string {
  switch (span.kind) {
    case 'agent':
      return span.subkind === 'implementer' || span.subkind === 'verifier' ? span.subkind : 'agent'
    case 'orchestrator-turn':
      return 'orchestrator'
    default:
      return span.kind
  }
}

// Every cause has its words: a new cause in WAIT_CAUSES fails typecheck here until it gets them.
const WAIT_WORDS: Readonly<Record<WaitCause, string>> = {
  limits: 'Limits',
  'limits-budget': 'Limits budget',
  'start-window': 'Start window',
  'background-tasks': 'Background tasks',
  'gate-queue': 'Gate queue',
  'other-machine': 'Other Machine',
  'api-retry': 'Retry after an API error',
  'orchestrator-busy': 'Orchestrator busy',
}

// The stops of a Run that waited for its Orchestrator (worfy-autopilot-queue tickets 07, 18), and of a queue whose
// last Epic waits for the owner (ticket 21), in words; the other stop reasons are shown as the Journal writes them.
const STOP_WORDS: Readonly<Record<string, string>> = {
  'start-cancelled': 'start-cancelled: cancelled while it waited for the Orchestrator',
  'start-refused': 'start-refused: refused once the Orchestrator was free',
  'waits-owner': 'waits-owner: the last Epic of the queue waits for the owner',
  'main-red': 'main-red: main was red, so the stuck Ticket was not continued',
  'turn-hung': `turn-hung: the Orchestrator's turn gave no sign of life for ${QUIET_HUNG_MS / 60_000} min`,
}

/** What the Run saw of a stuck Ticket, by the cause of its continuation or set-aside (CONTINUATION_CAUSES). */
const STUCK_WORDS: Readonly<Record<string, string>> = {
  'wave-unfinished': 'still in work after the turn',
  'no-progress': 'the same Wave came back',
}

/** `ticket-continued: <cause>, <attempt> of <of>` as from-journal.ts makes it. */
const CONTINUED = /^ticket-continued: ([a-z-]+), (\d+) of (\d+)$/u
/** `ticket-set-aside: <ticket>, <cause>, <attempts>` as from-journal.ts makes it. */
const SET_ASIDE = /^ticket-set-aside: (\S+), ([a-z-]+), (\d+)$/u

/** The reason of an attempt a continuation caused: `continuation 1 of 2: still in work after the turn`. */
function continuedText(reason: string): string | null {
  const match = CONTINUED.exec(reason)
  if (match === null) return null
  const [, cause, attempt, of] = match
  return `continuation ${attempt} of ${of}: ${STUCK_WORDS[cause!] ?? cause}`
}

/**
 * A mark of the Run as the timeline writes it. A Ticket set aside: `Ticket 05 set aside after 2 continuations:
 * still in work after the turn` (its Epic named in a Run over a queue, as displayName does); the others as the
 * Journal reader wrote them.
 */
export function markText(mark: Pick<OrchestratorMarkFact, 'kind' | 'text'>, epics: readonly string[] = []): string {
  const match = mark.kind === 'ticket-set-aside' ? SET_ASIDE.exec(mark.text) : null
  if (match === null) return mark.text
  const [, ticket, cause, attempts] = match
  const name = epics.length > 1 ? ticket! : (ticket!.split('/').at(-1) ?? ticket!)
  return `Ticket ${name} set aside after ${attempts} ${attempts === '1' ? 'continuation' : 'continuations'}: ${STUCK_WORDS[cause!] ?? cause}`
}

/** A stop reason of `run-stopped` as the header and the detail panel write it. */
export const stopReasonText = (reason: string): string => STOP_WORDS[reason] ?? reason

/** «worfy-faults → worfy-retry → worfy-guide +2»: the Epics of a Run, three at most and how many more. */
export function epicsText(epics: readonly string[]): string {
  const shown = epics.slice(0, 3).join(' → ')
  return epics.length > 3 ? `${shown} +${epics.length - 3}` : shown
}

/**
 * The name a span goes by on screen. `epics` — the Epics of its Run (RunView.epics): over a queue of Epics
 * two Tickets may share a number, so a Ticket names its Epic (`Ticket beta/01`); a Run of one Epic writes
 * the number alone (`Ticket 01`).
 */
export function displayName(span: Span, epics: readonly string[] = []): string {
  switch (span.kind) {
    case 'run':
      return `Run ${span.name.slice(-6)}`
    case 'ticket':
      return `Ticket ${epics.length > 1 ? span.name : (span.name.split('/').at(-1) ?? span.name)}`
    case 'wait':
      return span.waitCause === null ? span.name : WAIT_WORDS[span.waitCause]
    case 'orchestrator-turn':
      return 'Orchestrator turn'
    default:
      return span.name
  }
}

/** The `until <moment>` the Journal reader puts in a Wait's detail (from-journal.ts, waiting-until): an ISO moment. */
const UNTIL_ISO = /until (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/g

/**
 * The reason of a span as the screen writes it. A Wait's `until` is in local time, as Start and End are
 * (formatLocal; worfy-resource-planner ticket 11): the Journal keeps it as an ISO moment in UTC, and the
 * screen says «Times are local». A moment that does not parse stays as it is. A Run's stop reason goes by
 * stopReasonText, the reason of an attempt a continuation caused by its words (`continuation 1 of 2: …`).
 */
export function reasonText(span: Span): string | null {
  if (span.reason !== null && span.kind === 'run') return stopReasonText(span.reason)
  if (span.reason !== null && span.kind !== 'wait') return continuedText(span.reason) ?? span.reason
  if (span.reason === null) return null
  return span.reason.replace(UNTIL_ISO, (whole, iso: string) => {
    const at = Date.parse(iso)
    return Number.isNaN(at) ? whole : `until ${formatLocal(at)}`
  })
}

export const spanDuration = (span: Span): number => (span.segments.length > 0 ? span.segments.reduce((sum, part) => sum + part.end - part.start, 0) : span.until - span.start)

/** The outcome as the row writes it; null for `ok`. A span that goes on says so while the Run is live. */
export function outcomeWord(span: Span, live: boolean): string | null {
  if (span.outcome === null) return live && span.end === null ? 'running' : null
  return span.outcome === 'ok' ? null : span.outcome
}

/**
 * The words for a span whose source is gone (LOST_SOURCE_LABELS, facts.ts). A span still running has no
 * transcript «deleted»: main marks it `transcript-deleted` when it finds none, and while the work goes on
 * its transcript may simply not be there yet.
 */
export function lostWord(span: Span): string | null {
  if (span.lost === null) return null
  if (span.lost === 'transcript-deleted' && span.end === null) return 'transcript not found yet'
  return LOST_SOURCE_LABELS[span.lost]
}
