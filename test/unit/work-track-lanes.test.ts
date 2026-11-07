// The lanes of Work track (src/shared/work-track/lanes.ts; worfy-work-track ticket 04, owner decision 9):
// «by Session» — «Autopilot Runs» on top (a Run and its Waves), then a lane per Session in the order of
// its first work, its Subagents folded under it until the Session is expanded, and «Gate runs» last;
// «by Epic» — a lane per Epic, «—» for work with no Epic; every span is cut to the period. The CI runs and the
// Ticket status changes are on two rows of their own, hatched by GitHub and by git (ticket 13).
// The facts are literals in local time, so the test reads the same in every time zone.
import { describe, expect, it } from 'vitest'
import type { SessionInfo, SourceGap, WorkFact, WorkTrackInput } from '../../src/shared/work-track/facts'
import { buildSpans, lanesByEpic, lanesBySession, markRows, NO_EPIC, offLaneSpans, periodBounds, type Lane } from '../../src/shared/work-track/lanes'

/** A local time on a day of November 2026 (no change of daylight saving time in the days used). */
const at = (day: number, hh: number, mm = 0): string => new Date(2026, 10, day, hh, mm).toISOString()

const fact = (over: Partial<WorkFact> & Pick<WorkFact, 'id' | 'kind' | 'start'>): WorkFact => ({
  end: null,
  outcome: 'ok',
  session: null,
  source: 'transcript',
  title: over.id,
  ...over,
})

const sessions: SessionInfo[] = [
  { id: 'orch-1111', name: 'Orchestrator', vendor: 'claude', hidden: false, archived: false },
  { id: 'brdg-2222', name: 'bridge', vendor: 'claude', hidden: true, archived: false },
  { id: 'cdx-3333', name: 'Codex Session', vendor: 'codex', hidden: false, archived: true },
]

// Monday 9 November … Sunday 15 November, local time.
const period = { kind: 'week', start: at(9, 0) } as const

const facts: WorkFact[] = [
  fact({ id: 'run-1', kind: 'run', start: at(10, 9), end: at(10, 13), session: 'orch-1111', epic: 'ep-a', source: 'journal' }),
  fact({ id: 'wave-1', kind: 'wave', start: at(10, 9), end: at(10, 10, 30), session: 'orch-1111', parent: 'run-1', source: 'journal' }),
  fact({ id: 'wave-2', kind: 'wave', start: at(10, 11), end: at(10, 13), session: 'orch-1111', parent: 'run-1', epic: 'ep-b', source: 'journal' }),
  fact({ id: 'turn-o1', kind: 'turn', start: at(10, 9), end: at(10, 9, 10), session: 'orch-1111' }),
  // inside Wave 1: the implementer and the helper it started take the Epic of the Wave
  fact({ id: 'impl-01', kind: 'subagent', start: at(10, 9, 10), end: at(10, 10), session: 'orch-1111', parent: 'wave-1', ticket: '01', title: 'impl-01' }),
  fact({ id: 'helper', kind: 'subagent', start: at(10, 9, 20), end: at(10, 9, 40), session: 'orch-1111', parent: 'impl-01', title: 'helper' }),
  // the bridge works first, before the Run; its scout runs outside any Wave
  fact({ id: 'turn-b1', kind: 'turn', start: at(10, 8), end: at(10, 8, 30), session: 'brdg-2222' }),
  fact({ id: 'scout', kind: 'subagent', start: at(10, 8, 5), end: at(10, 8, 20), session: 'brdg-2222', title: 'scout' }),
  fact({ id: 'turn-c1', kind: 'turn', start: at(10, 11), end: at(10, 11, 20), session: 'cdx-3333', source: 'codex' }),
  // a turn of the week before, and one of the bridge across the start of the period
  fact({ id: 'turn-old', kind: 'turn', start: at(2, 10), end: at(2, 11), session: 'cdx-3333', source: 'codex' }),
  fact({ id: 'turn-edge', kind: 'turn', start: at(8, 23), end: at(9, 1), session: 'brdg-2222' }),
  fact({ id: 'gate-1', kind: 'gate', start: at(10, 10), end: at(10, 10, 5), epic: 'ep-a', source: 'gate-log' }),
  fact({ id: 'gate-2', kind: 'gate', start: at(10, 12), end: at(10, 12, 10), outcome: 'failed', source: 'gate-log' }),
  fact({ id: 'pr-7', kind: 'pr', start: at(10, 9, 30), end: at(10, 12, 30), epic: 'ep-a', pr: 7, source: 'github' }),
]

const gaps: SourceGap[] = [
  { source: 'gate-log', start: at(9, 0), end: at(9, 6), why: 'Gate logs kept 31 days' },
  { source: 'transcript', start: at(9, 0), end: at(9, 2), why: 'Transcripts are deleted after 35 days' },
]

const input: WorkTrackInput = { period, now: at(16, 12), facts, sessions, gaps }

const ids = (lane: Lane): string[] => lane.spans.map((span) => span.id)

/** The lane with `id`; a missing lane fails the test. */
function laneOf(lanes: readonly Lane[], id: string): Lane {
  const found = lanes.find((lane) => lane.id === id)
  if (!found) throw new Error(`no lane ${id} among ${lanes.map((lane) => lane.id).join(', ')}`)
  return found
}

describe('lanes by Session', () => {
  it('puts Autopilot Runs on top, Sessions by their first work, Gate runs last', () => {
    const lanes = lanesBySession(input)
    expect(lanes.map((lane) => lane.id)).toEqual(['runs', 'session:brdg-2222', 'session:orch-1111', 'session:cdx-3333', 'gate'])
    expect(lanes.map((lane) => lane.title)).toEqual(['Autopilot Runs', 'bridge', 'Orchestrator', 'Codex Session', 'Gate runs'])
    expect(ids(laneOf(lanes, 'runs'))).toEqual(['run-1', 'wave-1', 'wave-2'])
    expect(ids(laneOf(lanes, 'gate'))).toEqual(['gate-1', 'gate-2'])
  })

  it('carries the Session marks: hidden, archived, the Vendor', () => {
    const lanes = lanesBySession(input)
    const bridge = laneOf(lanes, 'session:brdg-2222')
    const codex = laneOf(lanes, 'session:cdx-3333')
    expect(bridge.session).toMatchObject({ hidden: true, archived: false, vendor: 'claude' })
    expect(codex.session).toMatchObject({ hidden: false, archived: true, vendor: 'codex' })
  })

  it('folds the Subagents of a Session: a count and a strip, no child lanes', () => {
    const orch = laneOf(lanesBySession(input), 'session:orch-1111')
    expect(ids(orch)).toEqual(['turn-o1'])
    expect(orch.subagents).toBe(2)
    expect(orch.expanded).toBe(false)
    expect(orch.children).toEqual([])
    expect(orch.strip.map((span) => span.id)).toEqual(['impl-01', 'helper'])
  })

  it('unfolds the Subagents of an expanded Session, nested by who started whom', () => {
    const lanes = lanesBySession(input, { expanded: new Set(['orch-1111']) })
    const orch = laneOf(lanes, 'session:orch-1111')
    expect(orch.expanded).toBe(true)
    expect(orch.strip).toEqual([])
    expect(orch.children.map((lane) => [lane.title, lane.depth])).toEqual([['impl-01', 1]])
    expect(orch.children.flatMap((lane) => lane.children).map((lane) => [lane.title, lane.depth])).toEqual([['helper', 2]])
    // the other Sessions stay folded
    expect(laneOf(lanes, 'session:brdg-2222').children).toEqual([])
    expect(laneOf(lanes, 'session:brdg-2222').subagents).toBe(1)
  })

  it('cuts spans to the period and leaves out what is outside it', () => {
    const lanes = lanesBySession(input)
    const bridge = laneOf(lanes, 'session:brdg-2222')
    const codex = laneOf(lanes, 'session:cdx-3333')
    expect(ids(codex)).toEqual(['turn-c1'])
    expect(ids(bridge)).toEqual(['turn-edge', 'turn-b1'])
    const { start } = periodBounds(period)
    expect(bridge.spans.at(0)).toMatchObject({ start, clippedStart: true, clippedEnd: false })
  })

  it('hatches the lanes whose source has no data', () => {
    const lanes = lanesBySession(input)
    expect(laneOf(lanes, 'gate').gaps.map((gap) => gap.source)).toEqual(['gate-log'])
    expect(laneOf(lanes, 'session:brdg-2222').gaps.map((gap) => gap.source)).toEqual(['transcript'])
    // a transcript gap is not one of Codex
    expect(laneOf(lanes, 'session:cdx-3333').gaps).toEqual([])
    expect(laneOf(lanes, 'runs').gaps).toEqual([])
  })

  it('keeps PRs, CI runs and Ticket status changes off the lanes', () => {
    expect(offLaneSpans(input).map((span) => span.id)).toEqual(['pr-7'])
  })
})

describe('the rows of CI runs and Ticket status changes (worfy-work-track ticket 13)', () => {
  const marked: WorkTrackInput = {
    ...input,
    facts: [
      ...facts,
      fact({ id: 'ci-1', kind: 'ci', start: at(10, 9, 40), end: at(10, 9, 52), outcome: 'failed', pr: 7, source: 'github', title: 'ci' }),
      fact({ id: 'ci-2', kind: 'ci', start: at(11, 15), end: null, outcome: null, source: 'github', title: 'ci' }),
      fact({ id: 'ci-old', kind: 'ci', start: at(2, 15), end: at(2, 15, 10), source: 'github', title: 'ci' }),
      fact({ id: 'status-1', kind: 'ticket-status', start: at(10, 12, 31), end: at(10, 12, 31), epic: 'ep-a', ticket: '01', source: 'git', title: '01 claimed → done' }),
    ],
    gaps: [
      ...gaps,
      { source: 'github', start: at(12, 0), end: at(12, 8), why: 'GitHub could not be reached: no network' },
      { source: 'git', start: at(8, 0), end: at(9, 3), why: 'The Project is not a git repository' },
    ],
  }

  it('gives the CI runs a row hatched by GitHub, the status changes a row hatched by git', () => {
    const [ci, status] = markRows(marked)
    expect(ci).toMatchObject({ id: 'ci', title: 'CI runs', source: 'github' })
    expect(ci!.marks.map((span) => span.id)).toEqual(['ci-1', 'ci-2'])
    expect(ci!.gaps.map((gap) => [gap.source, gap.why])).toEqual([['github', 'GitHub could not be reached: no network']])
    expect(status).toMatchObject({ id: 'ticket-status', title: 'Ticket status', source: 'git' })
    expect(status!.marks.map((span) => span.id)).toEqual(['status-1'])
    // the git gap is cut to the period
    const { start } = periodBounds(period)
    expect(status!.gaps).toEqual([{ source: 'git', start, end: Date.parse(at(9, 3)), why: 'The Project is not a git repository' }])
  })

  it('leaves the GitHub and git gaps off every lane', () => {
    for (const lanes of [lanesBySession(marked), lanesByEpic(marked)]) {
      const sources = lanes.flatMap((lane) => lane.gaps).map((gap) => gap.source)
      expect(sources).not.toContain('github')
      expect(sources).not.toContain('git')
    }
  })
})

describe('lanes by Epic', () => {
  it('gives each Epic a lane, «—» to work with no Epic, and keeps Gate runs', () => {
    const lanes = lanesByEpic(input)
    // Epics by their hours, the longest first (Wave 2 is 2 h, Wave 1 1.5 h); «—» last
    expect(lanes.map((lane) => lane.id)).toEqual(['epic:ep-b', 'epic:ep-a', `epic:${NO_EPIC}`, 'gate'])
    expect(laneOf(lanes, 'epic:ep-a').title).toBe('ep-a')
    expect(ids(laneOf(lanes, 'epic:ep-b'))).toEqual(['wave-2'])
    // Wave 1 takes the Epic of its Run; the Subagents inside it take the Epic of the Wave
    expect(ids(laneOf(lanes, 'epic:ep-a'))).toEqual(['wave-1', 'impl-01', 'helper'])
    // a turn of the Orchestrator outside a Wave and the bridge's scout outside a Wave: no Epic
    expect(ids(laneOf(lanes, `epic:${NO_EPIC}`))).toEqual(['turn-edge', 'turn-b1', 'scout', 'turn-o1', 'turn-c1'])
    expect(laneOf(lanes, `epic:${NO_EPIC}`).title).toBe('—')
  })

  it('resolves the Epic through the parent chain', () => {
    const byId = new Map(buildSpans(input).map((span) => [span.id, span.epic]))
    expect(byId.get('helper')).toBe('ep-a')
    expect(byId.get('wave-2')).toBe('ep-b')
    expect(byId.get('scout')).toBeNull()
  })
})
