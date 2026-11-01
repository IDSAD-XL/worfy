// Self time and the summary of a Run's timeline (src/shared/flight-recorder/summary.ts;
// worfy-flight-recorder ticket 12, decision 03 Q8): self time is the duration minus the union of the
// intervals of the nested spans — children run in parallel, so it is the union, not the sum; the
// summary names the three longest Stages by self time, the Waits by cause with their share of the
// Run, and the work inside Stages by subkind, summed with the note «summed; parallel».
// The facts are literals, no source is read.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { buildTimeline, type RunFacts, type Span, type Timeline } from '../../src/shared/flight-recorder/spans'
import { intervalUnionLength, selfTime, summarize, WORK_NOTE } from '../../src/shared/flight-recorder/summary'

const T = (hhmm: string): string => `2026-10-17T${hhmm}:00.000Z`
const MIN = 60_000

function facts(over: Partial<RunFacts> = {}): RunFacts {
  return {
    run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('14:00'), live: false, outcome: 'ok' },
    now: T('14:00'),
    pipeline: DEFAULT_PIPELINE,
    waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/01'] }],
    ticketEvents: [],
    work: [],
    waits: [],
    blocks: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

const one = (timeline: Timeline, test: (span: Span) => boolean): Span => {
  const found = timeline.spans.filter(test)
  expect(found).toHaveLength(1)
  return found[0] as Span
}

describe('intervalUnionLength', () => {
  it('counts overlapping intervals once and disjoint ones in full', () => {
    expect(intervalUnionLength([[0, 10], [5, 20], [30, 40]])).toBe(30)
    expect(intervalUnionLength([[30, 40], [0, 10], [10, 15]])).toBe(25)
    expect(intervalUnionLength([])).toBe(0)
  })

  it('counts a nested interval once', () => {
    expect(intervalUnionLength([[0, 100], [10, 20], [30, 40]])).toBe(100)
  })
})

describe('self time', () => {
  it('of a Stage with two parallel agents is its duration minus the union of theirs, not the sum', () => {
    const timeline = buildTimeline(
      facts({
        // Queued 10:00–10:00 is zero long; Implementing 10:00–11:00.
        ticketEvents: [
          { ticket: 'e/01', event: 'claim', at: T('10:00'), source: 'journal' },
          { ticket: 'e/01', event: 'pr-opened', at: T('11:00'), source: 'github' },
        ],
        work: [
          { id: 'a', kind: 'agent', ticket: 'e/01', name: 'impl-01', agentType: 'worfy:implementer', start: T('10:10'), end: T('10:40'), startSource: 'transcript', endSource: 'transcript' },
          { id: 'b', kind: 'agent', ticket: 'e/01', name: 'helper', agentType: 'Explore', start: T('10:20'), end: T('10:50'), startSource: 'transcript', endSource: 'transcript' },
        ],
      }),
    )
    const implementing = one(timeline, (span) => span.kind === 'stage' && span.stages[0] === 'implementing')
    // The union of 10:10–10:40 and 10:20–10:50 is 40 minutes; the sum would be 60.
    expect(selfTime(implementing, timeline)).toBe(20 * MIN)
  })

  it('counts a child only inside its parent', () => {
    const timeline = buildTimeline(
      facts({
        ticketEvents: [
          { ticket: 'e/01', event: 'claim', at: T('10:00'), source: 'journal' },
          { ticket: 'e/01', event: 'pr-opened', at: T('11:00'), source: 'github' },
        ],
        // Starts inside Implementing and runs on past its end: only 10:30–11:00 is inside.
        work: [{ id: 'a', kind: 'agent', ticket: 'e/01', name: 'impl-01', start: T('10:30'), end: T('11:30'), startSource: 'transcript', endSource: 'transcript' }],
      }),
    )
    const implementing = one(timeline, (span) => span.kind === 'stage' && span.stages[0] === 'implementing')
    expect(selfTime(implementing, timeline)).toBe(30 * MIN)
  })

  it('of a span with no children is its duration, and a Ticket in two Waves counts only its parts', () => {
    const timeline = buildTimeline(
      facts({
        waves: [
          { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01'] },
          { number: 2, startedAt: T('12:00'), finishedAt: T('12:30'), tickets: ['e/01'] },
        ],
      }),
    )
    const ticket = one(timeline, (span) => span.kind === 'ticket')
    expect(ticket.segments).toHaveLength(2)
    // One Stage (Queued) spans both parts, so the Ticket itself has no time of its own.
    expect(selfTime(ticket, timeline)).toBe(0)
    const queued = one(timeline, (span) => span.kind === 'stage')
    expect(selfTime(queued, timeline)).toBe(90 * MIN)
    const wait = buildTimeline(facts({ waits: [{ id: 'w', cause: 'limits', start: T('11:00'), end: T('11:20'), startSource: 'journal', endSource: 'journal' }] }))
    expect(selfTime(one(wait, (span) => span.kind === 'wait'), wait)).toBe(20 * MIN)
  })
})

describe('summarize', () => {
  // Three Tickets, each Stage with a known self time.
  const timeline = buildTimeline(
    facts({
      waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/01', 'e/02'] }],
      ticketEvents: [
        // e/01: Queued 10:00–10:05 (5), Implementing 10:05–11:05 (60, 20 of it inside agents), CI 11:05–11:15, review 11:15–…
        { ticket: 'e/01', event: 'claim', at: T('10:05'), source: 'journal' },
        { ticket: 'e/01', event: 'pr-opened', at: T('11:05'), source: 'github' },
        { ticket: 'e/01', event: 'ci-finished', at: T('11:15'), source: 'github' },
        { ticket: 'e/01', event: 'mark', mark: 'review', verdict: 'success', at: T('11:45'), source: 'github' },
        { ticket: 'e/01', event: 'merge', at: T('12:00'), source: 'github' },
        { ticket: 'e/01', event: 'done', at: T('12:10'), source: 'journal' },
        // e/02: Queued 10:00–12:00 (120), Implementing 12:00–14:00 (120, 100 of it inside an agent).
        { ticket: 'e/02', event: 'claim', at: T('12:00'), source: 'journal' },
      ],
      work: [
        { id: 'i1', kind: 'agent', ticket: 'e/01', name: 'impl-01', agentType: 'worfy:implementer', start: T('10:10'), end: T('10:50'), startSource: 'transcript', endSource: 'transcript' },
        { id: 'i1b', kind: 'agent', ticket: 'e/01', name: 'impl-01-helper', agentType: 'worfy:implementer', start: T('10:20'), end: T('10:30'), startSource: 'transcript', endSource: 'transcript' },
        { id: 'c1', kind: 'ci', ticket: 'e/01', name: 'ci', start: T('11:05'), end: T('11:15'), startSource: 'github', endSource: 'github' },
        { id: 'v1', kind: 'agent', ticket: 'e/01', name: 'verify-01', agentType: 'worfy:reviewer', start: T('11:20'), end: T('11:40'), startSource: 'transcript', endSource: 'transcript' },
        { id: 'g1', kind: 'gate', ticket: 'e/01', name: 'gate', start: T('11:46'), end: T('11:56'), startSource: 'gate-log', endSource: 'gate-log' },
        { id: 's1', kind: 'script', ticket: 'e/01', name: 'merge-once', start: T('11:45'), end: T('11:59'), startSource: 'transcript', endSource: 'transcript' },
        // Work of the Run as a whole is inside no Stage: not in the sums.
        { id: 'q1', kind: 'agent', ticket: null, name: 'gate-queue', start: T('13:00'), end: T('13:40'), startSource: 'transcript', endSource: 'transcript' },
        { id: 'i2', kind: 'agent', ticket: 'e/02', name: 'impl-02', agentType: 'worfy:implementer', start: T('12:10'), end: T('13:50'), startSource: 'transcript', endSource: 'transcript' },
      ],
      waits: [
        { id: 'w1', cause: 'limits', start: T('12:00'), end: T('12:30'), startSource: 'journal', endSource: 'journal' },
        { id: 'w2', cause: 'limits', start: T('13:00'), end: T('13:30'), startSource: 'journal', endSource: 'journal' },
        { id: 'w3', cause: 'gate-queue', start: T('13:30'), end: T('13:54'), startSource: 'journal', endSource: 'journal' },
      ],
    }),
  )
  const summary = summarize(timeline)

  it('names the three longest Stages by self time, not by duration; a tie goes to the earlier one', () => {
    const rows = summary.topStages.map((row) => ({ ticket: row.ticket, name: row.name, self: row.selfTime / MIN, duration: row.duration / MIN }))
    // e/01: Queued 5, Implementing 60 less the union 10:10–10:50 of its implementers = 20, CI 0,
    // Agent review 30 less 20 = 10, Gate & merge 15 less the union of gate and merge script = 1,
    // Closing 10. e/02: Queued 120, Implementing 120 less 100 = 20. The longest by duration —
    // e/02 Implementing — is only third.
    expect(rows).toEqual([
      { ticket: 'e/02', name: 'Queued', self: 120, duration: 120 },
      { ticket: 'e/01', name: 'Implementing', self: 20, duration: 60 },
      { ticket: 'e/02', name: 'Implementing', self: 20, duration: 120 },
    ])
    expect(summary.topStages[0]?.spanId).toBe(timeline.spans.find((span) => span.kind === 'stage' && span.links.ticket === 'e/02')?.id)
  })

  it('sums the Waits by cause with their share of the Run', () => {
    expect(summary.waits).toEqual([
      { cause: 'limits', total: 60 * MIN, share: 60 / 240 },
      { cause: 'gate-queue', total: 24 * MIN, share: 24 / 240 },
    ])
  })

  it('sums the work inside Stages by subkind, marked summed and parallel', () => {
    expect(WORK_NOTE).toBe('summed; parallel')
    expect(summary.workNote).toBe(WORK_NOTE)
    const totals = Object.fromEntries(summary.work.map((row) => [row.subkind, [row.total / MIN, row.count]]))
    // The two implementers of e/01 overlap: the sum counts both in full (40 + 10), plus 100 of e/02.
    expect(totals).toEqual({ implementer: [150, 3], verifier: [20, 1], ci: [10, 1], gate: [10, 1], script: [14, 1] })
  })

  it('gives an empty summary for a Run with no Stages and no Waits', () => {
    const empty = summarize(buildTimeline(facts({ waves: [] })))
    expect(empty).toEqual({ topStages: [], waits: [], work: [], workNote: WORK_NOTE, runDuration: 240 * MIN })
  })
})
