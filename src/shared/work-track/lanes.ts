// The lanes of Work track (the spec's Model section; owner decision 9). Pure: facts in, lanes out.
//
// «by Session», the default: the lane «Autopilot Runs» on top holds the Runs and the Waves (a Wave
// started by hand too: its marker is a Wave all the same); then a lane per Session in the order of its
// first work in the period, its turns on it and its Subagents folded under it — a count and a thin
// strip — until the Session is expanded, then a lane per Subagent, nested under the Subagent that
// started it; the lane «Gate runs» last. «by Epic»: a lane per Epic holding the work (Waves, turns,
// Subagents) of that Epic, the longest first, «—» for work with no Epic last, then «Gate runs».
// PRs, CI runs and Ticket status changes are on no lane (offLaneSpans): the screen marks them on the
// axis and in the side panel.
//
// Every span is cut to the period; a fact with no end lasts until `now`. The Epic of a fact with
// none is the Epic of its parent chain (a Subagent inside a Wave takes the Wave's); with none there
// either it is «—», never a guess (spec, risk 3).
import { intervalUnionLength } from '../flight-recorder/summary'
import type { Period, SessionInfo, SourceGap, WorkFact, WorkFactKind, WorkSource, WorkTrackInput } from './facts'

/** The name of the missing Epic. */
export const NO_EPIC = '—'
export const RUNS_LANE_TITLE = 'Autopilot Runs'
export const GATE_LANE_TITLE = 'Gate runs'

/** The kinds that are work: the hours count them, the Epic lanes hold them (Runs are their Waves). */
export const WORK_KINDS: ReadonlySet<WorkFactKind> = new Set<WorkFactKind>(['wave', 'turn', 'subagent'])

const RUNS_KINDS: ReadonlySet<WorkFactKind> = new Set<WorkFactKind>(['run', 'wave'])
const OFF_LANE_KINDS: ReadonlySet<WorkFactKind> = new Set<WorkFactKind>(['pr', 'ci', 'ticket-status'])
const RUNS_SOURCES: ReadonlySet<WorkSource> = new Set<WorkSource>(['journal', 'wave-marker'])

/** A fact placed in the period: times in milliseconds since the epoch, cut to the period. */
export interface WorkSpan extends Omit<WorkFact, 'start' | 'end' | 'epic'> {
  start: number
  end: number
  /** No end in the sources: it lasts until `now`. */
  open: boolean
  /** Cut at the start or the end of the period. */
  clippedStart: boolean
  clippedEnd: boolean
  /** The Epic of the fact or of its parent chain; `null` — none («—»). */
  epic: string | null
}

/** A «no data» stretch on a lane, cut to the period. */
export interface LaneGap {
  source: WorkSource
  start: number
  end: number
  why: string
}

export type LaneKind = 'runs' | 'session' | 'subagent' | 'epic' | 'gate'

export interface Lane {
  id: string
  kind: LaneKind
  title: string
  /** 0 for a lane of the track, 1 and deeper for a Subagent under its Session. */
  depth: number
  spans: WorkSpan[]
  /** The Session of a Session lane: the marks `hidden`, `archived` and the Vendor. */
  session?: SessionInfo
  /** How many Subagent lanes a Session has under it, at every depth. */
  subagents: number
  expanded: boolean
  /** The Subagent lanes, when expanded. */
  children: Lane[]
  /** The Subagent spans of a folded Session, drawn as a strip on its lane. */
  strip: WorkSpan[]
  gaps: LaneGap[]
}

export interface LaneOptions {
  /** The Sessions whose Subagents are unfolded (▸ on the screen); none by default. */
  expanded?: ReadonlySet<string>
}

// ── the period ───────────────────────────────────────────────────────────────

/** A local midnight `days` after the one of `time`, through daylight saving changes. */
function addDays(time: number, days: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
}

/** The start and the end (exclusive) of the period, in milliseconds. */
export function periodBounds(period: Period): { start: number; end: number } {
  const start = Date.parse(period.start)
  if (period.kind === 'day') return { start, end: addDays(start, 1) }
  if (period.kind === 'week') return { start, end: addDays(start, 7) }
  const date = new Date(start)
  return { start, end: new Date(date.getFullYear(), date.getMonth() + 1, date.getDate()).getTime() }
}

/** The local midnights the days of the period start at. */
export function periodDays(period: Period): number[] {
  const { start, end } = periodBounds(period)
  const days: number[] = []
  for (let day = start; day < end; day = addDays(day, 1)) days.push(day)
  return days
}

// ── the spans ────────────────────────────────────────────────────────────────

function epicResolver(facts: readonly WorkFact[]): (fact: WorkFact) => string | null {
  const byId = new Map(facts.map((fact) => [fact.id, fact]))
  return (fact) => {
    const seen = new Set<string>()
    for (let at: WorkFact | undefined = fact; at && !seen.has(at.id); at = at.parent === undefined ? undefined : byId.get(at.parent)) {
      if (at.epic) return at.epic
      seen.add(at.id)
    }
    return null
  }
}

/** The facts in the period as spans, by start, the longer first on a tie (a Run before its first Wave). */
export function buildSpans(input: WorkTrackInput): WorkSpan[] {
  const bounds = periodBounds(input.period)
  const now = Date.parse(input.now)
  const epicOf = epicResolver(input.facts)
  const spans: WorkSpan[] = []
  for (const fact of input.facts) {
    const start = Date.parse(fact.start)
    const end = fact.end === null ? Math.max(start, now) : Date.parse(fact.end)
    const inPeriod = end === start ? start >= bounds.start && start < bounds.end : end > bounds.start && start < bounds.end
    if (!inPeriod) continue
    spans.push({
      ...fact,
      start: Math.max(start, bounds.start),
      end: Math.min(end, bounds.end),
      open: fact.end === null,
      clippedStart: start < bounds.start,
      clippedEnd: end > bounds.end,
      epic: epicOf(fact),
    })
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** The PRs, CI runs and Ticket status changes of the period: no lane holds them. */
export function offLaneSpans(input: WorkTrackInput): WorkSpan[] {
  return buildSpans(input).filter((span) => OFF_LANE_KINDS.has(span.kind))
}

function laneGaps(gaps: readonly SourceGap[], bounds: { start: number; end: number }, takes: (gap: SourceGap) => boolean): LaneGap[] {
  const result: LaneGap[] = []
  for (const gap of gaps) {
    if (!takes(gap)) continue
    const start = Math.max(Date.parse(gap.start), bounds.start)
    const end = Math.min(Date.parse(gap.end), bounds.end)
    if (end > start) result.push({ source: gap.source, start, end, why: gap.why })
  }
  return result.sort((a, b) => a.start - b.start)
}

function lane(id: string, kind: LaneKind, title: string, spans: WorkSpan[], over: Partial<Lane> = {}): Lane {
  return { id, kind, title, depth: 0, spans, subagents: 0, expanded: false, children: [], strip: [], gaps: [], ...over }
}

/** What a Session lane is called when the Canvas and the Vendor history do not know the Session. */
function unknownSession(id: string): SessionInfo {
  return { id, name: id ? `Session ${id.slice(0, 4)}` : NO_EPIC, vendor: 'claude', hidden: false, archived: false }
}

/** The Subagent lanes of a Session: one per title under the same parent, nested under the Subagent that started it. */
function subagentLanes(sessionId: string, subagents: readonly WorkSpan[]): Lane[] {
  const byId = new Map(subagents.map((span) => [span.id, span]))
  const keys = new Map<string, { key: string; parentKey: string | null; depth: number }>()
  const place = (span: WorkSpan, seen: Set<string>): { key: string; parentKey: string | null; depth: number } => {
    const known = keys.get(span.id)
    if (known) return known
    seen.add(span.id)
    const parent = span.parent === undefined ? undefined : byId.get(span.parent)
    const above = parent && !seen.has(parent.id) ? place(parent, seen) : null
    const placed = { key: `${above?.key ?? ''}/${span.title}`, parentKey: above?.key ?? null, depth: (above?.depth ?? 0) + 1 }
    keys.set(span.id, placed)
    return placed
  }
  const lanes = new Map<string, { lane: Lane; parentKey: string | null }>()
  for (const span of subagents) {
    const { key, parentKey, depth } = place(span, new Set())
    const found = lanes.get(key)
    if (found) found.lane.spans.push(span)
    else lanes.set(key, { lane: lane(`subagent:${sessionId}${key}`, 'subagent', span.title, [span], { depth }), parentKey })
  }
  const top: Lane[] = []
  for (const { lane: child, parentKey } of lanes.values()) {
    const parent = parentKey === null ? undefined : lanes.get(parentKey)
    ;(parent ? parent.lane.children : top).push(child)
  }
  return top
}

/** The lanes «by Session»: Autopilot Runs, the Sessions by their first work, Gate runs. */
export function lanesBySession(input: WorkTrackInput, options: LaneOptions = {}): Lane[] {
  const bounds = periodBounds(input.period)
  const spans = buildSpans(input)
  const infos = new Map(input.sessions.map((session) => [session.id, session]))

  const bySession = new Map<string, { first: number; turns: WorkSpan[]; subagents: WorkSpan[] }>()
  const entry = (id: string, at: number) => {
    const found = bySession.get(id)
    if (found) {
      found.first = Math.min(found.first, at)
      return found
    }
    const created = { first: at, turns: [] as WorkSpan[], subagents: [] as WorkSpan[] }
    bySession.set(id, created)
    return created
  }
  for (const span of spans) {
    if (span.kind === 'turn') entry(span.session ?? '', span.start).turns.push(span)
    else if (span.kind === 'subagent') entry(span.session ?? '', span.start).subagents.push(span)
  }
  // A Session whose own transcript is gone still gets its lane, hatched.
  for (const gap of input.gaps) {
    if (gap.session === undefined) continue
    const start = Math.max(Date.parse(gap.start), bounds.start)
    if (Math.min(Date.parse(gap.end), bounds.end) > start) entry(gap.session, start)
  }

  const sessionLanes = [...bySession.entries()]
    .sort(([idA, a], [idB, b]) => a.first - b.first || idA.localeCompare(idB))
    .map(([id, { turns, subagents }]) => {
      const session = infos.get(id) ?? unknownSession(id)
      const source: WorkSource = session.vendor === 'codex' ? 'codex' : 'transcript'
      const expanded = options.expanded?.has(id) ?? false
      const children = subagentLanes(id, subagents)
      return lane(`session:${id}`, 'session', session.name, turns, {
        session,
        subagents: countLanes(children),
        expanded,
        children: expanded ? children : [],
        strip: expanded ? [] : subagents,
        gaps: laneGaps(input.gaps, bounds, (gap) => gap.source === source && (gap.session === undefined || gap.session === id)),
      })
    })

  return [
    lane('runs', 'runs', RUNS_LANE_TITLE, spans.filter((span) => RUNS_KINDS.has(span.kind)), {
      gaps: laneGaps(input.gaps, bounds, (gap) => RUNS_SOURCES.has(gap.source)),
    }),
    ...sessionLanes,
    gateLane(input, spans, bounds),
  ]
}

function countLanes(lanes: readonly Lane[]): number {
  return lanes.reduce((sum, child) => sum + 1 + countLanes(child.children), 0)
}

function gateLane(input: WorkTrackInput, spans: readonly WorkSpan[], bounds: { start: number; end: number }): Lane {
  return lane('gate', 'gate', GATE_LANE_TITLE, spans.filter((span) => span.kind === 'gate'), {
    gaps: laneGaps(input.gaps, bounds, (gap) => gap.source === 'gate-log'),
  })
}

/** The lanes «by Epic»: an Epic per lane, the longest first, «—» last, then Gate runs. */
export function lanesByEpic(input: WorkTrackInput): Lane[] {
  const bounds = periodBounds(input.period)
  const spans = buildSpans(input)
  const byEpic = new Map<string, WorkSpan[]>()
  for (const span of spans) {
    if (!WORK_KINDS.has(span.kind)) continue
    const epic = span.epic ?? NO_EPIC
    byEpic.set(epic, [...(byEpic.get(epic) ?? []), span])
  }
  const hours = (list: readonly WorkSpan[]): number => intervalUnionLength(list.map((span) => [span.start, span.end] as const))
  const epics = [...byEpic.entries()].sort(([a, listA], [b, listB]) => {
    if (a === NO_EPIC || b === NO_EPIC) return a === NO_EPIC ? 1 : -1
    return hours(listB) - hours(listA) || a.localeCompare(b)
  })
  return [...epics.map(([epic, list]) => lane(`epic:${epic}`, 'epic', epic, list)), gateLane(input, spans, bounds)]
}
