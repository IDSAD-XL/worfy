// The summary of a Work track period, one line on the screen (owner decision 10). Pure, like lanes.ts.
//
// Hours of work are the union of the intervals of the work kinds (turns, Subagents, Waves): two
// Subagents working the same hour take that hour once. Hours by Epic are the union inside each Epic,
// so an hour two Epics share counts in both, and their sum may pass the total. Gate runs, CI runs and
// PRs are not hours of work. A PR is merged in the period when its merge (`end`) falls in it; a Run
// counts when it overlaps the period. A no-data gap counts once per source: overlapping or touching
// gaps of one source — a transcript gap of one Session inside the gap of all of them — are one gap.
// Each day of the period has its own hours and merges (the Month cells); a span across midnight is
// split between its days.
import { intervalUnionLength } from '../flight-recorder/summary'
import { WORK_SOURCES, type WorkSource, type WorkTrackInput } from './facts'
import { buildSpans, NO_EPIC, periodBounds, periodDays, WORK_KINDS } from './lanes'

type Interval = readonly [number, number]

export interface EpicHours {
  /** The Epic, NO_EPIC for work with none. */
  epic: string
  ms: number
}

/** A no-data gap of one source, merged and cut to the period. */
export interface GapSummary {
  source: WorkSource
  start: number
  end: number
  /** The distinct hints of the gaps merged into it. */
  why: readonly string[]
}

export interface DaySummary {
  /** The local midnight the day starts at. */
  start: number
  workMs: number
  prsMerged: number
}

export interface WorkSummary {
  workMs: number
  /** The longest first; NO_EPIC last. */
  byEpic: EpicHours[]
  prsMerged: number
  runs: number
  gaps: GapSummary[]
  gapCount: number
  days: DaySummary[]
}

/** The parts of `intervals` inside [from, to). */
function clip(intervals: readonly Interval[], from: number, to: number): Interval[] {
  const parts: Interval[] = []
  for (const [start, end] of intervals) {
    const cutStart = Math.max(start, from)
    const cutEnd = Math.min(end, to)
    if (cutEnd > cutStart) parts.push([cutStart, cutEnd])
  }
  return parts
}

/** The gaps of each source, merged where they overlap or touch, in the order of WORK_SOURCES. */
function mergeGaps(input: WorkTrackInput, from: number, to: number): GapSummary[] {
  const merged: GapSummary[] = []
  for (const source of WORK_SOURCES) {
    const gaps = input.gaps
      .filter((gap) => gap.source === source)
      .map((gap) => ({ start: Math.max(Date.parse(gap.start), from), end: Math.min(Date.parse(gap.end), to), why: gap.why }))
      .filter((gap) => gap.end > gap.start)
      .sort((a, b) => a.start - b.start)
    let open: { start: number; end: number; why: string[] } | null = null
    for (const gap of gaps) {
      if (open && gap.start <= open.end) {
        open.end = Math.max(open.end, gap.end)
        if (!open.why.includes(gap.why)) open.why.push(gap.why)
        continue
      }
      if (open) merged.push({ source, ...open })
      open = { start: gap.start, end: gap.end, why: [gap.why] }
    }
    if (open) merged.push({ source, ...open })
  }
  return merged
}

export function summarize(input: WorkTrackInput): WorkSummary {
  const { start: from, end: to } = periodBounds(input.period)
  const spans = buildSpans(input)
  const work = spans.filter((span) => WORK_KINDS.has(span.kind))
  const intervals: Interval[] = work.map((span) => [span.start, span.end])

  const byEpicIntervals = new Map<string, Interval[]>()
  for (const span of work) {
    const epic = span.epic ?? NO_EPIC
    byEpicIntervals.set(epic, [...(byEpicIntervals.get(epic) ?? []), [span.start, span.end]])
  }
  const byEpic = [...byEpicIntervals.entries()]
    .map(([epic, list]) => ({ epic, ms: intervalUnionLength(list) }))
    .sort((a, b) => {
      if (a.epic === NO_EPIC || b.epic === NO_EPIC) return a.epic === NO_EPIC ? 1 : -1
      return b.ms - a.ms || a.epic.localeCompare(b.epic)
    })

  const merges = input.facts.filter((fact) => fact.kind === 'pr' && fact.end !== null).map((fact) => Date.parse(fact.end as string))
  const mergedIn = (start: number, end: number): number => merges.filter((at) => at >= start && at < end).length

  const gaps = mergeGaps(input, from, to)
  const days = periodDays(input.period).map((start, index, all) => {
    const end = all[index + 1] ?? to
    return { start, workMs: intervalUnionLength(clip(intervals, start, end)), prsMerged: mergedIn(start, end) }
  })

  return {
    workMs: intervalUnionLength(intervals),
    byEpic,
    prsMerged: mergedIn(from, to),
    runs: spans.filter((span) => span.kind === 'run').length,
    gaps,
    gapCount: gaps.length,
    days,
  }
}
