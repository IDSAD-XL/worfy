// The span model of Flight Recorder (the Model section of the worfy-flight-recorder spec; decision 03): what a
// Run's timeline is made of and how it is built from facts. Pure: no Node, no DOM, no input or
// output — the readers of the sources (tickets 13–16) turn the Journal, the transcripts, GitHub and
// the gate logs into `RunFacts`, and `buildTimeline` turns those into spans. Nothing is stored: the
// timeline is computed each time it is opened (decision 01, Q4).
//
// The tree: Run → Wave → Ticket → Stage by the Project's Pipeline → work (an agent, a CI run, a gate
// run, a script). A Ticket that went through several Waves is one row for the whole Run, with a part
// per Wave and the gap between them (`segments`); so a Ticket span hangs off the Run and names its
// Waves in `links.waves`. Two lanes beside the tree hang off the Run as well: the Waits of the Run
// and the turns of the Orchestrator, which link to Tickets instead of being nested in them.
//
// The rules the model keeps, each with its decision:
// - a Stage is not stored (ADR-0067): each boundary is an event of a source. Where a source has no
//   event, neighbouring Stages are one span with the names of both and the note «no boundary in
//   sources» (decision 03, Q3);
// - a Wait is a span with a cause; a block is not a span but a mark on the Ticket's row that lasts
//   until it is cleared or the Run ends; a retry is a new span of the same kind, attempt `#N`, linked
//   to the span that caused it (decision 03, Q5);
// - a span with no end ends at the last event about it in any source, outcome `cut-off`, once the
//   Run is over; while the Run is live it stretches to now and has no outcome (decision 03, Q7;
//   decision 07);
// - a span the Journal knows of whose details are gone carries the label of the lost source; a step
//   the Journal is silent about too did not happen (decision 08, Q5);
// - a Wait, a retry and every outcome other than `ok` carry a reason, always.
import { STAGE_KINDS, stageId, stageLabel, type PipelineStage, type StageKind } from '../workflow/pipeline'

// ── the vocabulary ───────────────────────────────────────────────────────────

/** The kinds of span, a fixed set (decision 01, Q8). */
export const SPAN_KINDS = ['run', 'wave', 'ticket', 'stage', 'agent', 'ci', 'gate', 'script', 'wait', 'orchestrator-turn'] as const
export type SpanKind = (typeof SPAN_KINDS)[number]

/** The kinds of work inside a Stage. */
export const WORK_KINDS = ['agent', 'ci', 'gate', 'script'] as const
export type WorkKind = (typeof WORK_KINDS)[number]

/** The subkinds of an agent span, by the agent's name and type. */
export const AGENT_SUBKINDS = ['implementer', 'verifier', 'other'] as const
export type AgentSubkind = (typeof AGENT_SUBKINDS)[number]

/** How a span ended (decision 03, Q6). A span with no outcome (`null`) is still running. */
export const SPAN_OUTCOMES = ['ok', 'failed', 'rejected', 'blocked', 'stopped', 'cut-off'] as const
export type SpanOutcome = (typeof SPAN_OUTCOMES)[number]

/** Why the work of a Run stood (the spec's Model section, on Waits, blocks and retries). */
export const WAIT_CAUSES = ['limits', 'limits-budget', 'background-tasks', 'gate-queue', 'other-machine'] as const
export type WaitCause = (typeof WAIT_CAUSES)[number]

/** Where a fact came from: the source of a span's start and of its end. */
export const FACT_SOURCES = ['journal', 'transcript', 'github', 'gate-log', 'marks-file', 'git'] as const
export type FactSource = (typeof FACT_SOURCES)[number]

/** A source that is gone or did not answer, with the label the screen shows (decision 08, Q5). */
export const LOST_SOURCE_LABELS = {
  'transcript-deleted': 'transcript deleted',
  'gate-logs-deleted': 'gate logs deleted (10 runs or 8 days)',
  'github-no-answer': 'GitHub did not answer',
  'branch-deleted': 'branch deleted',
} as const
export type LostSource = keyof typeof LOST_SOURCE_LABELS

/** The note on a span of neighbouring Stages no source separates. */
export const NO_BOUNDARY_NOTE = 'no boundary in sources'
/** The reason of a span whose sources give none, where a reason is required. */
export const NO_REASON = 'no reason in sources'
/** The reason of a span cut off: it has no end in any source. */
export const NO_END_REASON = 'no end in sources'
/** The reason of a Ticket a Wave finished before it was done. */
export const WAVE_FINISHED_REASON = 'the Wave finished before the Ticket was done'

// ── the facts: what tickets 13–16 produce ────────────────────────────────────
//
// Times are ISO 8601 strings as the sources write them. Every fact names the source of its start
// and, once it has one, of its end. A fact with no end (`end: null`) is open; `lastSeenAt` is the
// last event about it in any source, which is where it is cut off once the Run is over (without
// it, the start). The facts need not be sorted.

type Iso = string

/** The Run itself, from the Journal (`run-started` … `run-stopped`). */
export interface RunFact {
  /** The run id of the Journal: the key that links every other source (decision 01, Q5). */
  id: string
  startedAt: Iso
  /** `run-stopped`; null when the Journal has none. */
  stoppedAt: Iso | null
  /** Whether the Run is going on now: then open spans stretch to `now` instead of being cut off. */
  live: boolean
  /** The last event of the Run in the Journal: where a Run that stopped without `run-stopped` ends. */
  lastSeenAt?: Iso
  /** How the Run ended, when it did; `stopped` when absent. */
  outcome?: SpanOutcome
  /** The stop reason of `run-stopped` (`user-stop`, `no-ready-wave`, …). */
  reason?: string
}

/** A Wave of the Run (`wave-started` … `wave-finished`). */
export interface WaveFact {
  /** The number of the Wave within the Run, from 1. */
  number: number
  startedAt: Iso
  finishedAt: Iso | null
  lastSeenAt?: Iso
  /** The Tickets the Wave was sent with: the Tickets the Journal knows of. */
  tickets: readonly string[]
  /** The id of the Orchestrator Session the Wave went to (`wave-started.session`). */
  session?: string
}

/**
 * An event that is a boundary of a Ticket's Stages (decision 03, Q3). Each one is mapped onto the
 * Project's Pipeline here, so a reader needs no Pipeline:
 * - `claim` (`ticket-status` claimed) — Queued is passed;
 * - `pr-opened` — Implementing is passed;
 * - `ci-started` — the Ticket is in CI (a boundary when `pr-opened` is missing);
 * - `ci-finished` — CI is passed;
 * - `mark` with `success` — the Stage of the mark is passed (`review` — Agent review,
 *   `check/<name>` — that Check); with `failure` — REJECTED: the Stage ends `rejected` and the
 *   Ticket is back in Implementing, attempt `#N`;
 * - `merge` — every Stage up to the merge is passed;
 * - `done` (`ticket-status` done) — the Ticket is done.
 */
export interface StageEventFact {
  ticket: string
  event: 'claim' | 'pr-opened' | 'ci-started' | 'ci-finished' | 'mark' | 'merge' | 'done'
  at: Iso
  source: FactSource
  /** `mark` only: `review` or `check/<name>`. */
  mark?: string
  /** `mark` only. */
  verdict?: 'success' | 'failure'
  /** Why, when the source says (the text of a REJECTED verdict). */
  reason?: string
  pr?: number
  sha?: string
}

/** One piece of work of a Ticket: an agent's stretch of active work, a CI run, a gate run, a script. */
export interface WorkFact {
  /** Unique among the work facts: the agent id, the CI run id, the gate run folder… */
  id: string
  kind: WorkKind
  /** The Ticket the work belongs to; null for work of the Run as a whole. */
  ticket: string | null
  /**
   * The agent's name (`impl-12`), the CI workflow, the script. Spans of one Ticket with the same
   * kind and name are attempts of one thing: the second is `#2`.
   */
  name: string
  /** The agent's type (`worfy:implementer`), for the subkind. */
  agentType?: string
  start: Iso
  end: Iso | null
  lastSeenAt?: Iso
  /** How it ended; `ok` when it ended and the source says nothing else. */
  outcome?: SpanOutcome
  reason?: string
  /** The id of the work fact that caused this attempt, when the source says (SendMessage after a verdict). */
  retryOf?: string
  session?: string
  agent?: string
  pr?: number
  sha?: string
  verdict?: string
  startSource: FactSource
  endSource?: FactSource
}

/** A Wait of the Run (the spec's Model section, on Waits, blocks and retries). */
export interface WaitFact {
  id: string
  cause: WaitCause
  start: Iso
  end: Iso | null
  lastSeenAt?: Iso
  /** Detail of the cause: the Limits window, the background tasks, the machine waited for. */
  detail?: string
  startSource: FactSource
  endSource?: FactSource
}

/** A block of a Ticket (`ticket-status` blocked … the next status): a mark, not a span. */
export interface BlockFact {
  ticket: string
  at: Iso
  /** `Blocked reason:`. */
  reason: string
  /** `Waits:`. */
  waits: string | null
  /** When the block was cleared; null while it holds. */
  clearedAt: Iso | null
  source: FactSource
}

/** A turn of the Orchestrator: linked to the Tickets it touched, not nested in them. */
export interface TurnFact {
  id: string
  start: Iso
  end: Iso | null
  lastSeenAt?: Iso
  tickets: readonly string[]
  session?: string
  startSource: FactSource
  endSource?: FactSource
}

/**
 * A span the Journal knows of whose details are gone: the implementer of a Ticket of a Wave whose
 * transcript is deleted, the gate runs past the log's limit, the PR and CI GitHub did not give. With
 * no times it covers its Ticket's row (or, for the Orchestrator, the Run).
 */
export interface LostFact {
  ticket: string | null
  kind: WorkKind | 'orchestrator-turn'
  name: string
  source: LostSource
  start?: Iso
  end?: Iso
}

/** A mark on the Orchestrator's lane: a dialog Autopilot refused, input of a person. */
export interface OrchestratorMarkFact {
  kind: 'refused-dialog' | 'human-input'
  at: Iso
  text: string
}

/** Everything a timeline is built from. */
export interface RunFacts {
  run: RunFact
  /** The moment the timeline is computed: where open spans of a live Run end. */
  now: Iso
  /** The Project's Pipeline (`workflow.pipeline`, else DEFAULT_PIPELINE). */
  pipeline: readonly PipelineStage[]
  waves: readonly WaveFact[]
  ticketEvents: readonly StageEventFact[]
  work: readonly WorkFact[]
  waits: readonly WaitFact[]
  blocks: readonly BlockFact[]
  turns: readonly TurnFact[]
  lost: readonly LostFact[]
  orchestratorMarks: readonly OrchestratorMarkFact[]
}

// ── the spans ────────────────────────────────────────────────────────────────

/** A stretch of time in milliseconds since the epoch; a Ticket span has one per Wave. */
export interface Segment {
  start: number
  end: number
  /** The Wave of the part, for a Ticket and its Stages. */
  wave?: number
}

export interface SpanLinks {
  run: string
  /** The Wave of a Wave span; the Waves of a Ticket span. */
  wave?: number
  waves?: readonly number[]
  ticket?: string
  /** The Tickets an Orchestrator turn touched. */
  tickets?: readonly string[]
  session?: string
  agent?: string
  pr?: number
  sha?: string
  verdict?: string
}

export interface Span {
  id: string
  kind: SpanKind
  /** `agent` only. */
  subkind: AgentSubkind | null
  /** The tree, or one of the two lanes of the Run. */
  lane: 'tree' | 'wait' | 'orchestrator'
  parent: string | null
  name: string
  start: number
  /** null: not finished, the Run is live. */
  end: number | null
  /** Where the span stops on the timeline: its end, or now while the Run is live. */
  until: number
  /** The parts of the span: one for most, one per Wave for a Ticket and its Stages. */
  segments: readonly Segment[]
  outcome: SpanOutcome | null
  reason: string | null
  /** From 1; a retry is 2 and on. */
  attempt: number
  /** The span that caused this attempt. */
  retryOf: string | null
  links: SpanLinks
  startSource: FactSource | null
  endSource: FactSource | null
  /** The lost source of a span whose details are gone. */
  lost: LostSource | null
  /** NO_BOUNDARY_NOTE on a span of Stages no source separates. */
  note: string | null
  /** `stage` only: the ids of the Pipeline Stages the span covers, in order. */
  stages: readonly string[]
  /** `wait` only. */
  waitCause: WaitCause | null
}

/** A block of a Ticket: its row is hatched from `at` to `until`. */
export interface BlockMark {
  ticket: string
  at: number
  until: number
  reason: string
  waits: string | null
  /** Whether the block was cleared (else it held to the end of the Run, or holds now). */
  cleared: boolean
  source: FactSource
}

export interface OrchestratorMark {
  kind: OrchestratorMarkFact['kind']
  at: number
  text: string
}

export interface Timeline {
  runId: string
  live: boolean
  now: number
  /** Every span, the Run first; a child names its parent. */
  spans: readonly Span[]
  blocks: readonly BlockMark[]
  orchestratorMarks: readonly OrchestratorMark[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ms(iso: Iso): number {
  const value = Date.parse(iso)
  if (Number.isNaN(value)) throw new Error(`flight-recorder: not a time: ${JSON.stringify(iso)}`)
  return value
}

const optionalMs = (iso: Iso | null | undefined): number | null => (iso === null || iso === undefined ? null : ms(iso))

/** The subkind of an agent by its type, else its name: implementers, verifiers, the rest. */
export function agentSubkind(name: string, agentType?: string): AgentSubkind {
  const type = (agentType ?? '').toLowerCase()
  if (type.includes('implementer')) return 'implementer'
  if (type.includes('reviewer') || type.includes('verifier')) return 'verifier'
  if (/^impl(?:ementer)?-/iu.test(name)) return 'implementer'
  if (/^(?:verify|verifier|review|reviewer)-/iu.test(name)) return 'verifier'
  return 'other'
}

/** The parts of [start, end] inside `segments`. */
export function clip(start: number, end: number, segments: readonly Segment[]): Segment[] {
  const parts: Segment[] = []
  for (const segment of segments) {
    const from = Math.max(start, segment.start)
    const to = Math.min(end, segment.end)
    if (to > from) parts.push(segment.wave === undefined ? { start: from, end: to } : { start: from, end: to, wave: segment.wave })
  }
  return parts
}

interface Ending {
  end: number | null
  until: number
  outcome: SpanOutcome | null
  reason: string | null
}

/**
 * How an open-or-closed fact ends: closed — at its end with its outcome; open in a live Run — not
 * finished, up to now; open in a Run that is over — cut off at the last event about it.
 */
function ending(start: number, end: number | null, lastSeen: number | null, live: boolean, now: number, outcome: SpanOutcome | undefined, reason: string | undefined): Ending {
  if (end !== null) {
    const result = outcome ?? 'ok'
    return { end, until: end, outcome: result, reason: reason ?? (result === 'ok' ? null : NO_REASON) }
  }
  if (live) return { end: null, until: Math.max(start, now), outcome: null, reason: reason ?? null }
  const cut = Math.max(start, lastSeen ?? start)
  return { end: cut, until: cut, outcome: 'cut-off', reason: reason ?? NO_END_REASON }
}

function span(fields: Partial<Span> & Pick<Span, 'id' | 'kind' | 'lane' | 'parent' | 'name' | 'start' | 'end' | 'until' | 'links'>): Span {
  return {
    subkind: null,
    segments: [{ start: fields.start, end: fields.until }],
    outcome: null,
    reason: null,
    attempt: 1,
    retryOf: null,
    startSource: null,
    endSource: null,
    lost: null,
    note: null,
    stages: [],
    waitCause: null,
    ...fields,
  }
}

const byTime = <T>(time: (item: T) => number) => (a: T, b: T) => time(a) - time(b)

// ── the Stages of a Ticket ───────────────────────────────────────────────────

const rank = (kind: StageKind): number => STAGE_KINDS.indexOf(kind)

/** The index of the first Pipeline Stage after `id` (`kind` in the catalogue when `id` is not in it). */
function after(pipeline: readonly PipelineStage[], id: string, kind: StageKind): number | null {
  const at = pipeline.findIndex((stage) => stageId(stage) === id)
  if (at >= 0) return at + 1 < pipeline.length ? at + 1 : null
  const next = pipeline.findIndex((stage) => rank(stage.kind) > rank(kind))
  return next >= 0 ? next : null
}

/** The Pipeline index a boundary event puts the Ticket in, or null when the Pipeline has no such Stage. */
function enteredIndex(pipeline: readonly PipelineStage[], event: StageEventFact): number | null {
  const index = (id: string) => {
    const at = pipeline.findIndex((stage) => stageId(stage) === id)
    return at >= 0 ? at : null
  }
  switch (event.event) {
    case 'claim':
      return after(pipeline, 'queued', 'queued')
    case 'pr-opened':
      return after(pipeline, 'implementing', 'implementing')
    case 'ci-started':
      return index('ci')
    case 'ci-finished':
      return after(pipeline, 'ci', 'ci')
    case 'mark': {
      if (event.verdict === 'failure') return index('implementing')
      if (event.mark === 'review') return after(pipeline, 'agent-review', 'agent-review')
      if (event.mark?.startsWith('check/') === true) return index(event.mark) === null ? null : after(pipeline, event.mark, 'check')
      return null
    }
    case 'merge':
      return index('gate-merge') !== null ? after(pipeline, 'gate-merge', 'gate-merge') : after(pipeline, 'awaiting-merge', 'awaiting-merge')
    case 'done':
      return pipeline.length - 1
  }
}

interface TicketRow {
  ticket: Span
  stages: Span[]
}

interface TicketContext {
  runId: string
  pipeline: readonly PipelineStage[]
}

/**
 * The Stage spans of one Ticket: the boundary events walked in time order. A forward event closes
 * the open span over every Stage it passes (more than one — the note «no boundary in sources») and
 * opens the next; a failure mark closes it `rejected` and opens Implementing again, attempt `#N`;
 * `done` closes the last one. The last open span ends with the Ticket.
 */
function stagesOf(ticket: Span, events: readonly StageEventFact[], context: TicketContext): Span[] {
  const { pipeline } = context
  const done = pipeline.length - 1
  const spans: Span[] = []
  let current = 0
  let openedAt = ticket.start
  let openedBy: FactSource | null = null
  const attempts = new Map<string, number>()
  let lastRejected: Span | null = null

  /** Closes the open span over the Stages `current`…`through`. */
  const close = (through: number, closing: { end: number | null; until: number; outcome: SpanOutcome | null; reason: string | null; source: FactSource | null }): Span => {
    const covered = pipeline.slice(current, through + 1)
    const ids = covered.map(stageId)
    const first = ids[0] ?? 'queued'
    const attempt = (attempts.get(first) ?? 0) + 1
    attempts.set(first, attempt)
    const cause = attempt > 1 ? lastRejected : null
    // A retry needs a reason: its own when it failed, else what sent the Ticket back.
    const retryReason = cause === null ? NO_REASON : `after ${cause.name} was rejected`
    const result = span({
      id: `${ticket.id}/stage:${spans.length + 1}`,
      kind: 'stage',
      lane: 'tree',
      parent: ticket.id,
      name: covered.map(stageLabel).join(' + '),
      start: openedAt,
      end: closing.end,
      until: closing.until,
      segments: clip(openedAt, closing.until, ticket.segments),
      outcome: closing.outcome,
      reason: closing.reason ?? (attempt > 1 ? retryReason : null),
      attempt,
      retryOf: cause?.id ?? null,
      links: { run: context.runId, ticket: ticket.name },
      startSource: openedBy,
      endSource: closing.source,
      note: ids.length > 1 ? NO_BOUNDARY_NOTE : null,
      stages: ids,
    })
    spans.push(result)
    return result
  }

  const sorted = [...events].sort(byTime((event) => ms(event.at)))
  for (const event of sorted) {
    if (current === done) break
    const raw = ms(event.at)
    // What happened after the Ticket's row ended (a merge by hand after the Run) is outside the Run.
    if (ticket.end !== null && raw > ticket.until) break
    const target = enteredIndex(pipeline, event)
    if (target === null) continue
    const at = Math.max(raw, openedAt)
    if (event.event === 'mark' && event.verdict === 'failure') {
      lastRejected = close(current, { end: at, until: at, outcome: 'rejected', reason: event.reason ?? `${event.mark ?? 'mark'}: failure`, source: event.source })
    } else if (target > current) {
      close(target - 1, { end: at, until: at, outcome: 'ok', reason: null, source: event.source })
    } else {
      continue
    }
    current = target
    openedAt = at
    openedBy = event.source
  }
  if (current !== done) {
    close(current, { end: ticket.end === null ? null : Math.max(ticket.end, openedAt), until: Math.max(ticket.until, openedAt), outcome: ticket.outcome, reason: ticket.reason, source: ticket.endSource })
  }
  // A Stage passed in no time is no span, unless it is the one the Ticket stands on.
  return spans.filter((item, index) => item.until > item.start || index === spans.length - 1)
}

// ── the timeline ─────────────────────────────────────────────────────────────

/** Builds the timeline of a Run from its facts. */
export function buildTimeline(facts: RunFacts): Timeline {
  const { run } = facts
  const runId = run.id
  const live = run.live
  const now = ms(facts.now)
  const runStart = ms(run.startedAt)
  const runEnding: Ending = (() => {
    const stopped = optionalMs(run.stoppedAt)
    if (stopped !== null) {
      const outcome = run.outcome ?? 'stopped'
      return { end: stopped, until: stopped, outcome, reason: run.reason ?? (outcome === 'ok' ? null : NO_REASON) }
    }
    return ending(runStart, null, optionalMs(run.lastSeenAt), live, now, undefined, run.reason)
  })()
  const runSpan = span({
    id: 'run',
    kind: 'run',
    lane: 'tree',
    parent: null,
    name: runId,
    start: runStart,
    ...runEnding,
    links: { run: runId },
    startSource: 'journal',
    endSource: runEnding.end === null ? null : 'journal',
  })
  const spans: Span[] = [runSpan]

  // Waves.
  const waves = [...facts.waves].sort((a, b) => a.number - b.number)
  const waveSpans = new Map<number, Span>()
  for (const wave of waves) {
    const start = ms(wave.startedAt)
    const end = ending(start, optionalMs(wave.finishedAt), optionalMs(wave.lastSeenAt) ?? runEnding.end, live, now, undefined, undefined)
    const waveSpan = span({
      id: `wave:${wave.number}`,
      kind: 'wave',
      lane: 'tree',
      parent: runSpan.id,
      name: `Wave ${wave.number}`,
      start,
      ...end,
      links: { run: runId, wave: wave.number, ...(wave.session === undefined ? {} : { session: wave.session }) },
      startSource: 'journal',
      endSource: wave.finishedAt === null ? null : 'journal',
    })
    waveSpans.set(wave.number, waveSpan)
    spans.push(waveSpan)
  }

  // Ticket rows: one per Ticket the Journal knows of, a part per Wave.
  const ticketOrder: string[] = []
  const ticketWaves = new Map<string, number[]>()
  for (const wave of waves) {
    for (const ticket of wave.tickets) {
      if (!ticketWaves.has(ticket)) {
        ticketWaves.set(ticket, [])
        ticketOrder.push(ticket)
      }
      ticketWaves.get(ticket)?.push(wave.number)
    }
  }
  const eventsOf = new Map<string, StageEventFact[]>()
  for (const event of facts.ticketEvents) eventsOf.set(event.ticket, [...(eventsOf.get(event.ticket) ?? []), event])
  const blocksOf = new Map<string, BlockFact[]>()
  for (const block of facts.blocks) blocksOf.set(block.ticket, [...(blocksOf.get(block.ticket) ?? []), block])
  const blockUntil = (block: BlockFact): number => optionalMs(block.clearedAt) ?? (live ? now : runSpan.until)

  const rows = new Map<string, TicketRow>()
  for (const ticket of ticketOrder) {
    const numbers = ticketWaves.get(ticket) ?? []
    const events = eventsOf.get(ticket) ?? []
    const doneEvent = events.filter((event) => event.event === 'done').sort(byTime((event) => ms(event.at)))[0]
    const doneAt = doneEvent === undefined ? null : ms(doneEvent.at)
    let segments: Segment[] = []
    for (const number of numbers) {
      const wave = waveSpans.get(number)
      if (wave === undefined) continue
      if (doneAt !== null && wave.start > doneAt && segments.length > 0) continue
      const end = doneAt !== null && doneAt >= wave.start && doneAt < wave.until ? doneAt : wave.until
      segments.push({ start: wave.start, end, wave: number })
    }
    segments = segments.sort((a, b) => a.start - b.start)
    const first = segments[0]
    const lastSegment = segments.at(-1)
    if (first === undefined || lastSegment === undefined) continue
    const lastWave = waveSpans.get(lastSegment.wave ?? -1)
    const stillOpen = doneAt === null && lastWave !== undefined && lastWave.end === null
    let ticketEnding: Ending
    if (doneAt !== null) ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'ok', reason: null }
    else if (stillOpen) ticketEnding = { end: null, until: lastSegment.end, outcome: null, reason: null }
    else {
      const openBlock = (blocksOf.get(ticket) ?? []).find((block) => block.clearedAt === null && ms(block.at) <= lastSegment.end)
      if (openBlock !== undefined) ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'blocked', reason: openBlock.reason }
      else if (lastWave?.outcome === 'cut-off') ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'cut-off', reason: NO_END_REASON }
      else ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'stopped', reason: WAVE_FINISHED_REASON }
    }
    const ticketSpan = span({
      id: `ticket:${ticket}`,
      kind: 'ticket',
      lane: 'tree',
      parent: runSpan.id,
      name: ticket,
      start: first.start,
      ...ticketEnding,
      segments,
      links: { run: runId, ticket, waves: segments.map((segment) => segment.wave ?? 0) },
      startSource: 'journal',
      endSource: ticketEnding.end === null ? null : doneEvent?.source ?? 'journal',
    })
    const stages = stagesOf(ticketSpan, events, { runId, pipeline: facts.pipeline })
    rows.set(ticket, { ticket: ticketSpan, stages })
    spans.push(ticketSpan, ...stages)
  }

  /** The parent of work of a Ticket at `at`: the Stage open then, else the Ticket; the Run without a row. */
  const parentAt = (ticket: string | null, at: number): string => {
    const row = ticket === null ? undefined : rows.get(ticket)
    if (row === undefined) return runSpan.id
    const stage = row.stages.find((item) => at >= item.start && at < item.until) ?? row.stages.find((item) => at === item.start)
    return stage?.id ?? row.ticket.id
  }

  // Work: attempts per Ticket, kind and name.
  const workSpans = new Map<string, Span>()
  const groups = new Map<string, WorkFact[]>()
  for (const fact of facts.work) {
    if (fact.ticket !== null && !rows.has(fact.ticket)) continue // the Journal is silent: no step
    const key = JSON.stringify([fact.ticket, fact.kind, fact.name])
    groups.set(key, [...(groups.get(key) ?? []), fact])
  }
  const attemptOf = new Map<string, number>()
  for (const group of groups.values()) {
    group.sort(byTime((fact) => ms(fact.start))).forEach((fact, index) => attemptOf.set(fact.id, index + 1))
  }
  const ordered = [...groups.values()].flat().sort(byTime((fact) => ms(fact.start)))
  for (const fact of ordered) {
    const start = ms(fact.start)
    const end = ending(start, optionalMs(fact.end), optionalMs(fact.lastSeenAt), live, now, fact.outcome, fact.reason)
    const links: SpanLinks = { run: runId }
    if (fact.ticket !== null) links.ticket = fact.ticket
    if (fact.session !== undefined) links.session = fact.session
    if (fact.agent !== undefined) links.agent = fact.agent
    if (fact.pr !== undefined) links.pr = fact.pr
    if (fact.sha !== undefined) links.sha = fact.sha
    if (fact.verdict !== undefined) links.verdict = fact.verdict
    const work = span({
      id: `${fact.kind}:${fact.id}`,
      kind: fact.kind,
      subkind: fact.kind === 'agent' ? agentSubkind(fact.name, fact.agentType) : null,
      lane: 'tree',
      parent: parentAt(fact.ticket, start),
      name: fact.name,
      start,
      ...end,
      attempt: attemptOf.get(fact.id) ?? 1,
      links,
      startSource: fact.startSource,
      endSource: end.end === null ? null : (fact.endSource ?? (fact.end === null ? null : fact.startSource)),
    })
    workSpans.set(fact.id, work)
    spans.push(work)
  }
  // The cause of each retry: the source's, else the last work of the Ticket that failed or was
  // rejected before it started (a REJECTED verifier, a failed CI run), else the previous attempt.
  for (const fact of ordered) {
    const work = workSpans.get(fact.id)
    if (work === undefined || work.attempt === 1) continue
    const ticketSpans = [...workSpans.values()].filter((item) => item.links.ticket === (fact.ticket ?? undefined) && item.id !== work.id)
    const given = fact.retryOf === undefined ? undefined : workSpans.get(fact.retryOf)
    const failedBefore = ticketSpans
      .filter((item) => (item.outcome === 'failed' || item.outcome === 'rejected') && item.until <= work.start)
      .sort((a, b) => b.until - a.until)[0]
    const previous = ordered
      .filter((other) => other.ticket === fact.ticket && other.kind === fact.kind && other.name === fact.name && (attemptOf.get(other.id) ?? 0) === work.attempt - 1)
      .map((other) => workSpans.get(other.id))[0]
    const cause = given ?? failedBefore ?? previous
    work.retryOf = cause?.id ?? null
    if (fact.reason === undefined && (work.outcome === 'ok' || work.outcome === null)) {
      work.reason = cause === undefined ? NO_REASON : `after ${cause.name}${cause.outcome === 'ok' || cause.outcome === null ? '' : ` ${cause.outcome}`}`
    }
  }

  // The lane of Waits.
  for (const wait of [...facts.waits].sort(byTime((fact) => ms(fact.start)))) {
    const start = ms(wait.start)
    const end = ending(start, optionalMs(wait.end), optionalMs(wait.lastSeenAt), live, now, undefined, undefined)
    spans.push(
      span({
        id: `wait:${wait.id}`,
        kind: 'wait',
        lane: 'wait',
        parent: runSpan.id,
        name: wait.cause,
        start,
        ...end,
        // A Wait always has its cause for a reason; a cut-off one keeps the cause too.
        reason: wait.detail === undefined ? wait.cause : `${wait.cause}: ${wait.detail}`,
        waitCause: wait.cause,
        links: { run: runId },
        startSource: wait.startSource,
        endSource: end.end === null ? null : (wait.endSource ?? (wait.end === null ? null : wait.startSource)),
      }),
    )
  }

  // The lane of the Orchestrator.
  for (const turn of [...facts.turns].sort(byTime((fact) => ms(fact.start)))) {
    const start = ms(turn.start)
    const end = ending(start, optionalMs(turn.end), optionalMs(turn.lastSeenAt), live, now, undefined, undefined)
    spans.push(
      span({
        id: `turn:${turn.id}`,
        kind: 'orchestrator-turn',
        lane: 'orchestrator',
        parent: runSpan.id,
        name: 'Orchestrator',
        start,
        ...end,
        links: { run: runId, tickets: [...turn.tickets], ...(turn.session === undefined ? {} : { session: turn.session }) },
        startSource: turn.startSource,
        endSource: end.end === null ? null : (turn.endSource ?? (turn.end === null ? null : turn.startSource)),
      }),
    )
  }

  // Spans whose details are gone: only where the Journal knows of the step.
  facts.lost.forEach((fact, index) => {
    const row = fact.ticket === null ? undefined : rows.get(fact.ticket)
    if (fact.ticket !== null && row === undefined) return
    if (fact.ticket === null && fact.kind !== 'orchestrator-turn') return
    const owner = row?.ticket ?? runSpan
    const start = optionalMs(fact.start) ?? owner.start
    const until = optionalMs(fact.end) ?? owner.until
    const links: SpanLinks = { run: runId }
    if (fact.ticket !== null) links.ticket = fact.ticket
    spans.push(
      span({
        id: `lost:${index + 1}`,
        kind: fact.kind,
        subkind: fact.kind === 'agent' ? agentSubkind(fact.name) : null,
        lane: fact.kind === 'orchestrator-turn' ? 'orchestrator' : 'tree',
        parent: fact.kind === 'orchestrator-turn' ? runSpan.id : fact.start === undefined ? owner.id : parentAt(fact.ticket, start),
        name: fact.name,
        start,
        end: optionalMs(fact.end),
        until,
        segments: fact.start === undefined && fact.end === undefined ? owner.segments : [{ start, end: until }],
        links,
        lost: fact.source,
      }),
    )
  })

  const blocks: BlockMark[] = facts.blocks
    .filter((block) => rows.has(block.ticket))
    .map((block) => ({ ticket: block.ticket, at: ms(block.at), until: blockUntil(block), reason: block.reason, waits: block.waits, cleared: block.clearedAt !== null, source: block.source }))
    .sort((a, b) => a.at - b.at)

  const orchestratorMarks = facts.orchestratorMarks.map((mark) => ({ kind: mark.kind, at: ms(mark.at), text: mark.text })).sort((a, b) => a.at - b.at)

  return { runId, live, now, spans, blocks, orchestratorMarks }
}

/** The children of a span: the spans that name it their parent. */
export const childrenOf = (timeline: Timeline, parent: Span): Span[] => timeline.spans.filter((item) => item.parent === parent.id)

/** How long a span lasted: the sum of its parts. */
export const duration = (item: Span): number => item.segments.reduce((total, segment) => total + (segment.end - segment.start), 0)
