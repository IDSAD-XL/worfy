// The filter of the Run history screen (worfy-flight-recorder ticket 19; decision 05, p. 4; the prototype Card
// card-57714d55): which spans of a timeline the tree keeps, and what a selection highlights. Pure functions
// over the spans main computed (src/shared/flight-recorder/spans.ts); the screen keeps the filter's state.
//
// - The text filter, one field: a Ticket (its number `07`, `Ticket 7`, or its name `worfy-pipeline/07`), an
//   agent (its name `verify-05`, or its id from the start), a PR (`#460`, `PR 460`, `460`), a cause (a word
//   of the reason, `rejected`, or of the Wait's cause, `background`). Digits alone name a Ticket or a PR, never
//   a part of a sha, an agent id or a reason: `04` is not every reason that mentions 04.
// - «Problems only»: the failures (`failed`, `rejected`, `blocked`, `stopped` — a Ticket the Wave left
//   unfinished — and `cut-off`), the retries (#2 on), the Tickets with a block mark, and every Wait.
// - Both at once: a span is kept when it passes both. The rows above a kept span stay, as the way to it:
//   its parents, and for a Ticket the Wave its row is drawn under (the first of its Waves, store.ts).
import type { BlockMark, Span } from '../../shared/flight-recorder/spans'

export interface SpanFilter {
  /** The text of the filter field; blank — no text filter. */
  text: string
  problemsOnly: boolean
}

export const NO_FILTER: SpanFilter = { text: '', problemsOnly: false }

/** What the filter reads of a timeline. */
export interface FilteredTimeline {
  spans: readonly Span[]
  blocks: readonly BlockMark[]
}

/** The outcomes that are a problem: anything but `ok` and a span still going on. */
const PROBLEM_OUTCOMES: ReadonlySet<string> = new Set(['failed', 'rejected', 'blocked', 'stopped', 'cut-off'])

export const isFiltering = (filter: SpanFilter): boolean => filter.problemsOnly || filter.text.trim() !== ''

/**
 * Whether a span is a problem of the Run on its own: a failure, a retry, a Ticket with a block mark, a Wait.
 * The Run itself is never one: it is above every other problem, and a Run that stopped on a block says so in
 * the header.
 */
export function isProblem(span: Span, timeline: FilteredTimeline): boolean {
  if (span.kind === 'run') return false
  if (span.kind === 'wait' || span.attempt > 1) return true
  if (span.outcome !== null && PROBLEM_OUTCOMES.has(span.outcome)) return true
  return span.kind === 'ticket' && timeline.blocks.some((block) => block.ticket === span.links.ticket)
}

const ticketsOf = (span: Span): readonly string[] => span.links.tickets ?? (span.links.ticket === undefined ? [] : [span.links.ticket])

/** The number of a Ticket `<epic>/<NN>`; null for another name. */
function ticketNumber(ticket: string): number | null {
  const match = /\/(\d+)$/u.exec(ticket)
  return match === null ? null : Number(match[1])
}

/** One query of the text field, read once. */
type Query = { kind: 'number'; ticket: boolean; pr: boolean; value: number } | { kind: 'words'; text: string }

function readQuery(text: string): Query | null {
  const query = text.trim().toLowerCase().replace(/\s+/gu, ' ')
  if (query === '') return null
  const pr = /^(?:pr ?)?#(\d+)$|^pr ?(\d+)$/u.exec(query)
  if (pr !== null) return { kind: 'number', ticket: false, pr: true, value: Number(pr[1] ?? pr[2]) }
  const ticket = /^ticket ?(\d+)$/u.exec(query)
  if (ticket !== null) return { kind: 'number', ticket: true, pr: false, value: Number(ticket[1]) }
  if (/^\d+$/u.test(query)) return { kind: 'number', ticket: true, pr: true, value: Number(query) }
  return { kind: 'words', text: query }
}

function matches(span: Span, query: Query): boolean {
  const tickets = ticketsOf(span)
  if (query.kind === 'number') return (query.ticket && tickets.some((ticket) => ticketNumber(ticket) === query.value)) || (query.pr && span.links.pr === query.value)
  const { text } = query
  if (tickets.some((ticket) => ticket.toLowerCase().includes(text))) return true
  if (span.kind === 'agent' && (span.name.toLowerCase().includes(text) || (span.links.agent?.toLowerCase().startsWith(text) ?? false))) return true
  return (span.reason?.toLowerCase().includes(text) ?? false) || (span.waitCause?.includes(text) ?? false)
}

/**
 * The spans the tree keeps under the filter, in their order, with the rows above each; null when nothing
 * filters (every span stays). A filter that keeps no span keeps none, not even the Run.
 */
export function filterSpans(timeline: FilteredTimeline, filter: SpanFilter): readonly Span[] | null {
  if (!isFiltering(filter)) return null
  const query = readQuery(filter.text)
  const byId = new Map(timeline.spans.map((span) => [span.id, span]))
  const keep = new Set<string>()
  for (const span of timeline.spans) {
    if (query !== null && !matches(span, query)) continue
    if (filter.problemsOnly && !isProblem(span, timeline)) continue
    let at: Span | undefined = span
    while (at !== undefined && !keep.has(at.id)) {
      keep.add(at.id)
      if (at.kind === 'ticket') {
        const wave = firstWave(at, timeline.spans)
        if (wave !== undefined) keep.add(wave.id)
      }
      at = at.parent === null ? undefined : byId.get(at.parent)
    }
  }
  return timeline.spans.filter((span) => keep.has(span.id))
}

/** The Wave a Ticket's row is drawn under: the first of its Waves (firstWaveOf of store.ts). */
function firstWave(ticket: Span, spans: readonly Span[]): Span | undefined {
  const waves = ticket.links.waves ?? (ticket.links.wave === undefined ? [] : [ticket.links.wave])
  if (waves.length === 0) return undefined
  const first = Math.min(...waves)
  return spans.find((span) => span.kind === 'wave' && span.links.wave === first)
}

/** What the selected span highlights on the timeline. */
export interface Highlights {
  /** The span whose failure caused the selected retry: outlined dashed. */
  cause: string | null
  /** The Ticket rows of the selected Wait or Orchestrator turn. */
  tickets: ReadonlySet<string>
}

export function highlightsOf(selected: Span | undefined, spans: readonly Span[]): Highlights {
  if (selected === undefined) return { cause: null, tickets: new Set() }
  const cause = selected.attempt > 1 && selected.retryOf !== null && spans.some((span) => span.id === selected.retryOf) ? selected.retryOf : null
  const tickets = new Set<string>()
  if (selected.kind === 'wait' || selected.kind === 'orchestrator-turn') {
    const named = new Set(ticketsOf(selected))
    for (const span of spans) if (span.kind === 'ticket' && span.links.ticket !== undefined && named.has(span.links.ticket)) tickets.add(span.id)
  }
  return { cause, tickets }
}
