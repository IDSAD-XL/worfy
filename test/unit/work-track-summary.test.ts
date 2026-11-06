// The summary of a Work track period (src/shared/work-track/summary.ts; worfy-work-track ticket 04, owner
// decision 10): hours of work are the union of the intervals of turns, Subagents and Waves, so parallel
// work counts once; hours by Epic are the union inside each Epic; PRs merged, Autopilot Runs and the
// no-data gaps, a gap counted once per source; a Month split by days.
// The facts are literals in local time, so the test reads the same in every time zone.
import { describe, expect, it } from 'vitest'
import type { SourceGap, WorkFact, WorkTrackInput } from '../../src/shared/work-track/facts'
import { NO_EPIC } from '../../src/shared/work-track/lanes'
import { summarize } from '../../src/shared/work-track/summary'

const at = (day: number, hh: number, mm = 0): string => new Date(2026, 10, day, hh, mm).toISOString()
const HOUR = 3_600_000

const fact = (over: Partial<WorkFact> & Pick<WorkFact, 'id' | 'kind' | 'start'>): WorkFact => ({
  end: null,
  outcome: 'ok',
  session: 's-1',
  source: 'transcript',
  title: over.id,
  ...over,
})

const input = (over: Partial<WorkTrackInput>): WorkTrackInput => ({
  period: { kind: 'week', start: at(9, 0) },
  now: at(20, 0),
  facts: [],
  sessions: [],
  gaps: [],
  ...over,
})

describe('hours of work', () => {
  it('counts two parallel Subagents of an hour as 1 h, not 2', () => {
    const summary = summarize(
      input({
        facts: [
          fact({ id: 'a', kind: 'subagent', start: at(10, 10), end: at(10, 11), epic: 'ep-a' }),
          fact({ id: 'b', kind: 'subagent', start: at(10, 10), end: at(10, 11), epic: 'ep-a' }),
        ],
      }),
    )
    expect(summary.workMs).toBe(HOUR)
    expect(summary.byEpic).toEqual([{ epic: 'ep-a', ms: HOUR }])
  })

  it('takes the union inside each Epic and across them; gate, CI and PRs are not work hours', () => {
    const summary = summarize(
      input({
        facts: [
          fact({ id: 'w', kind: 'wave', start: at(10, 9), end: at(10, 11), epic: 'ep-a' }),
          fact({ id: 'a', kind: 'subagent', start: at(10, 10), end: at(10, 11), parent: 'w' }),
          fact({ id: 't', kind: 'turn', start: at(10, 10, 30), end: at(10, 12) }),
          fact({ id: 'g', kind: 'gate', start: at(10, 13), end: at(10, 14), source: 'gate-log' }),
          fact({ id: 'c', kind: 'ci', start: at(10, 13), end: at(10, 14), source: 'github' }),
        ],
      }),
    )
    expect(summary.workMs).toBe(3 * HOUR)
    expect(summary.byEpic).toEqual([
      { epic: 'ep-a', ms: 2 * HOUR },
      { epic: NO_EPIC, ms: 1.5 * HOUR },
    ])
  })

  it('stretches open work to now and cuts work to the period', () => {
    const summary = summarize(
      input({
        now: at(9, 1),
        facts: [
          fact({ id: 'open', kind: 'turn', start: at(9, 0, 30), end: null }),
          fact({ id: 'edge', kind: 'turn', start: at(8, 23), end: at(9, 0, 15) }),
        ],
      }),
    )
    expect(summary.workMs).toBe(0.75 * HOUR)
  })
})

describe('PRs, Runs and gaps', () => {
  it('counts PRs merged and Runs in the period', () => {
    const summary = summarize(
      input({
        facts: [
          fact({ id: 'pr-1', kind: 'pr', start: at(5, 9), end: at(10, 9), pr: 1, source: 'github' }),
          fact({ id: 'pr-2', kind: 'pr', start: at(10, 9), end: null, pr: 2, source: 'github' }),
          fact({ id: 'pr-3', kind: 'pr', start: at(1, 9), end: at(2, 9), pr: 3, source: 'github' }),
          fact({ id: 'run-1', kind: 'run', start: at(8, 22), end: at(9, 2), source: 'journal' }),
          fact({ id: 'run-2', kind: 'run', start: at(11, 9), end: at(11, 10), source: 'journal' }),
          fact({ id: 'run-0', kind: 'run', start: at(2, 9), end: at(2, 10), source: 'journal' }),
        ],
      }),
    )
    expect(summary.prsMerged).toBe(1)
    expect(summary.runs).toBe(2)
  })

  it('counts a gap once per source: overlapping gaps of one source are one gap', () => {
    const gaps: SourceGap[] = [
      { source: 'transcript', start: at(9, 0), end: at(9, 10), why: 'Transcripts are deleted after 35 days', session: 's-1' },
      { source: 'transcript', start: at(9, 8), end: at(9, 12), why: 'Transcripts are deleted after 35 days' },
      { source: 'gate-log', start: at(9, 0), end: at(9, 6), why: 'Gate logs kept 31 days' },
      { source: 'gate-log', start: at(12, 10), end: at(12, 11), why: 'gate keeps the last 10 runs per worktree' },
      { source: 'github', start: at(1, 0), end: at(2, 0), why: 'outside the period' },
    ]
    const summary = summarize(input({ gaps }))
    expect(summary.gapCount).toBe(3)
    expect(summary.gaps.map((gap) => [gap.source, gap.end - gap.start])).toEqual([
      ['transcript', 12 * HOUR],
      ['gate-log', 6 * HOUR],
      ['gate-log', HOUR],
    ])
  })
})

describe('Month by days', () => {
  it('splits a span across midnight between its two days and counts merges per day', () => {
    const summary = summarize(
      input({
        period: { kind: 'month', start: at(1, 0) },
        now: at(30, 23),
        facts: [
          fact({ id: 'night', kind: 'turn', start: at(10, 22), end: at(11, 2) }),
          fact({ id: 'pr-5', kind: 'pr', start: at(10, 9), end: at(11, 1), pr: 5, source: 'github' }),
        ],
      }),
    )
    expect(summary.days).toHaveLength(30)
    const day = (n: number) => summary.days[n - 1] ?? { start: 0, workMs: -1, prsMerged: -1 }
    expect(day(10)).toEqual({ start: new Date(2026, 10, 10).getTime(), workMs: 2 * HOUR, prsMerged: 0 })
    expect(day(11)).toEqual({ start: new Date(2026, 10, 11).getTime(), workMs: 2 * HOUR, prsMerged: 1 })
    expect(day(12).workMs).toBe(0)
    expect(summary.workMs).toBe(4 * HOUR)
  })
})
