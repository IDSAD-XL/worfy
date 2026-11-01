// Self time and the summary of a Run's timeline (the Model section of the worfy-flight-recorder
// spec, on self time and the summary; decision 03, Q8). Pure, like spans.ts.
//
// Self time is a span's duration minus the union of the intervals of the spans nested in it:
// children run in parallel, so two agents working the same half hour take that half hour once, not
// twice. A child counts only inside its parent's parts. The summary over the top of the timeline:
// the three longest Stages by self time; the Waits by cause, with the sum and the share of the Run;
// the work inside Stages by subkind, summed — parallel work makes that sum longer than the clock,
// hence the note «summed; parallel».
import { childrenOf, duration, type AgentSubkind, type Span, type Timeline, type WaitCause, type WorkKind } from './spans'

/** The note on the work totals: a sum over parallel spans, not wall-clock time. */
export const WORK_NOTE = 'summed; parallel'

/** How many Stages the summary names. */
export const TOP_STAGES = 3

type Interval = readonly [number, number]

/** The total length of a set of intervals, each moment counted once. */
export function intervalUnionLength(intervals: readonly Interval[]): number {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
  let total = 0
  let from = Number.NEGATIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY
  for (const [start, end] of sorted) {
    if (start > to) {
      if (to > from) total += to - from
      from = start
      to = end
    } else if (end > to) {
      to = end
    }
  }
  if (to > from) total += to - from
  return total
}

/** The parts of `child` inside the parts of `parent`. */
function inside(parent: Span, child: Span): Interval[] {
  const parts: Interval[] = []
  for (const outer of parent.segments) {
    for (const inner of child.segments) {
      const start = Math.max(outer.start, inner.start)
      const end = Math.min(outer.end, inner.end)
      if (end > start) parts.push([start, end])
    }
  }
  return parts
}

/** A span's duration minus the union of its children's intervals inside it. */
export function selfTime(span: Span, timeline: Timeline): number {
  const covered = intervalUnionLength(childrenOf(timeline, span).flatMap((child) => inside(span, child)))
  return Math.max(0, duration(span) - covered)
}

export interface StageRow {
  spanId: string
  ticket: string
  /** The Stage's name; «A + B» for Stages no source separates. */
  name: string
  attempt: number
  selfTime: number
  duration: number
}

export interface WaitRow {
  cause: WaitCause
  total: number
  /** Of the Run's duration, 0…1. */
  share: number
}

export type WorkSubkind = AgentSubkind | Exclude<WorkKind, 'agent'>

export interface WorkRow {
  subkind: WorkSubkind
  /** The sum of the durations: parallel spans each count in full (WORK_NOTE). */
  total: number
  count: number
}

export interface Summary {
  topStages: StageRow[]
  waits: WaitRow[]
  work: WorkRow[]
  workNote: typeof WORK_NOTE
  runDuration: number
}

const WORK_KINDS: ReadonlySet<string> = new Set<WorkKind>(['agent', 'ci', 'gate', 'script'])

/** The summary over the top of the timeline. */
export function summarize(timeline: Timeline): Summary {
  const run = timeline.spans.find((span) => span.kind === 'run')
  const runDuration = run === undefined ? 0 : duration(run)

  const topStages = timeline.spans
    .filter((span) => span.kind === 'stage' && span.lost === null)
    .map((span) => ({ span, self: selfTime(span, timeline) }))
    // The longest first; of two equal, the earlier.
    .sort((a, b) => b.self - a.self || a.span.start - b.span.start)
    .slice(0, TOP_STAGES)
    .map(({ span, self }) => ({ spanId: span.id, ticket: span.links.ticket ?? '', name: span.name, attempt: span.attempt, selfTime: self, duration: duration(span) }))

  const waitTotals = new Map<WaitCause, number>()
  for (const span of timeline.spans) {
    if (span.kind !== 'wait' || span.waitCause === null) continue
    waitTotals.set(span.waitCause, (waitTotals.get(span.waitCause) ?? 0) + duration(span))
  }
  const waits = [...waitTotals]
    .map(([cause, total]) => ({ cause, total, share: runDuration > 0 ? total / runDuration : 0 }))
    .sort((a, b) => b.total - a.total)

  // Work inside a Stage only; work whose details are gone has no real times and is left out.
  const stageIds = new Set(timeline.spans.filter((span) => span.kind === 'stage').map((span) => span.id))
  const workTotals = new Map<WorkSubkind, { total: number; count: number }>()
  for (const span of timeline.spans) {
    if (!WORK_KINDS.has(span.kind) || span.lost !== null || span.parent === null || !stageIds.has(span.parent)) continue
    const subkind: WorkSubkind = span.kind === 'agent' ? (span.subkind ?? 'other') : (span.kind as Exclude<WorkKind, 'agent'>)
    const row = workTotals.get(subkind) ?? { total: 0, count: 0 }
    row.total += duration(span)
    row.count += 1
    workTotals.set(subkind, row)
  }
  const work = [...workTotals].map(([subkind, row]) => ({ subkind, ...row })).sort((a, b) => b.total - a.total)

  return { topStages, waits, work, workNote: WORK_NOTE, runDuration }
}
