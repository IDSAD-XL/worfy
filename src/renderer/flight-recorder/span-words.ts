// The words and colours a span goes by on the Run history screen (worfy-flight-recorder tickets 18, 19): its
// name, the token of its colour, its duration, its outcome and its lost source, shared by the timeline
// (Timeline.tsx) and the detail panel (DetailPanel.tsx).
import { LOST_SOURCE_LABELS, type Span, type WaitCause } from '../../shared/flight-recorder/spans'

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
}

/** The name a span goes by on screen. */
export function displayName(span: Span): string {
  switch (span.kind) {
    case 'run':
      return `Run ${span.name.slice(-6)}`
    case 'ticket':
      return `Ticket ${span.name.split('/').at(-1) ?? span.name}`
    case 'wait':
      return span.waitCause === null ? span.name : WAIT_WORDS[span.waitCause]
    case 'orchestrator-turn':
      return 'Orchestrator turn'
    default:
      return span.name
  }
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
