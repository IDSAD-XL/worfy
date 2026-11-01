// Self time and the summary of a Run's timeline (src/shared/flight-recorder/summary.ts;
// worfy-flight-recorder ticket 12, decision 03 Q8): self time is the duration minus the union of the
// intervals of the nested spans — children run in parallel, so it is the union, not the sum; a Wave
// counts the parts of its Tickets; the summary names the three longest Stages by self time, the
// Waits by cause with their share of the Run, and the work inside Stages by subkind, summed with the
// note «summed; parallel».
// The facts are literals, no source is read.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { buildTimeline, type RunFacts, type Span, type StageEvent, type StageEventFact, type Timeline, type WorkFact } from '../../src/shared/flight-recorder/spans'
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
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

const ev = (ticket: string, hhmm: string, fields: StageEvent): StageEventFact =>
  ({ ticket, at: T(hhmm), source: fields.event === 'status' ? 'journal' : 'github', ...fields }) as StageEventFact

const agent = (id: string, ticket: string, name: string, type: string, from: string, to: string): WorkFact => ({
  id,
  kind: 'agent',
  ticket,
  name,
  agentType: type,
  start: T(from),
  end: T(to),
  startSource: 'transcript',
  endSource: 'transcript',
})

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
  const implementingOf = (work: WorkFact[]) => {
    const timeline = buildTimeline(facts({ ticketEvents: [ev('e/01', '10:00', { event: 'status', state: 'claimed' }), ev('e/01', '11:00', { event: 'pr-opened', pr: 1, sha: 's1' })], work }))
    return { timeline, implementing: one(timeline, (span) => span.kind === 'stage' && span.stages[0] === 'implementing') }
  }

  it('of a Stage with two parallel agents is its duration minus the union of theirs, not the sum', () => {
    const { timeline, implementing } = implementingOf([agent('a', 'e/01', 'impl-01', 'worfy:implementer', '10:10', '10:40'), agent('b', 'e/01', 'helper', 'Explore', '10:20', '10:50')])
    // Implementing 10:00–11:00. The union of 10:10–10:40 and 10:20–10:50 is 40 minutes; the sum would be 60.
    expect(selfTime(implementing, timeline)).toBe(20 * MIN)
  })

  it('counts a child only inside its parent', () => {
    // Starts inside Implementing and runs on past its end: only 10:30–11:00 is inside.
    const { timeline, implementing } = implementingOf([agent('a', 'e/01', 'impl-01', 'worfy:implementer', '10:30', '11:30')])
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
    expect(selfTime(one(timeline, (span) => span.kind === 'stage'), timeline)).toBe(90 * MIN)
    const wait = buildTimeline(facts({ waits: [{ id: 'w', cause: 'limits', start: T('11:00'), end: T('11:20'), startSource: 'journal', endSource: 'journal' }] }))
    expect(selfTime(one(wait, (span) => span.kind === 'wait'), wait)).toBe(20 * MIN)
  })

  it('of a Wave subtracts the parts of its Tickets in that Wave', () => {
    const timeline = buildTimeline(
      facts({
        waves: [
          { number: 1, startedAt: T('10:00'), finishedAt: T('12:00'), tickets: ['e/01', 'e/02'] },
          { number: 2, startedAt: T('12:30'), finishedAt: T('13:30'), tickets: ['e/01'] },
        ],
        // e/02 is done at 10:30, e/01 runs through both Waves.
        ticketEvents: [ev('e/02', '10:10', { event: 'status', state: 'claimed' }), ev('e/02', '10:30', { event: 'status', state: 'done' })],
      }),
    )
    const wave = (number: number) => one(timeline, (span) => span.kind === 'wave' && span.links.wave === number)
    expect([selfTime(wave(1), timeline), selfTime(wave(2), timeline)]).toEqual([0, 0])
    const alone = buildTimeline(facts({ ticketEvents: [ev('e/01', '10:05', { event: 'status', state: 'claimed' }), ev('e/01', '11:00', { event: 'status', state: 'done' })] }))
    // The Wave lasts 10:00–14:00, its only Ticket 10:00–11:00.
    expect(selfTime(one(alone, (span) => span.kind === 'wave'), alone)).toBe(180 * MIN)
  })
})

describe('summarize', () => {
  // Two Tickets, each Stage with a known self time. e/02 is listed first, so the order of the spans
  // is not the order of their starts.
  const timeline = buildTimeline(
    facts({
      waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/02', 'e/01'] }],
      ticketEvents: [
        // e/01: Queued 10:00–10:05, Implementing 10:05–11:05, CI 11:05–11:15, Agent review 11:15–11:45,
        // Gate & merge 11:45–12:00, Closing 12:00–12:10.
        ev('e/01', '10:05', { event: 'status', state: 'claimed' }),
        ev('e/01', '11:05', { event: 'pr-opened', pr: 1, sha: 's1' }),
        ev('e/01', '11:05', { event: 'ci-started', name: 'ci', sha: 's1' }),
        ev('e/01', '11:15', { event: 'ci-finished', name: 'ci', sha: 's1', conclusion: 'success' }),
        ev('e/01', '11:45', { event: 'mark', mark: 'review', verdict: 'success', sha: 's1' }),
        ev('e/01', '12:00', { event: 'merge' }),
        ev('e/01', '12:10', { event: 'status', state: 'done' }),
        // e/02: Queued 10:00–12:00 (120), Implementing 12:00–14:00 (120, 100 of it inside an agent).
        ev('e/02', '12:00', { event: 'status', state: 'claimed' }),
      ],
      work: [
        agent('i1', 'e/01', 'impl-01', 'worfy:implementer', '10:10', '10:50'),
        agent('i1b', 'e/01', 'impl-01-helper', 'worfy:implementer', '10:20', '10:30'),
        { id: 'c1', kind: 'ci', ticket: 'e/01', name: 'ci', start: T('11:05'), end: T('11:15'), startSource: 'github', endSource: 'github' },
        agent('v1', 'e/01', 'verify-01', 'worfy:reviewer', '11:20', '11:40'),
        { id: 'g1', kind: 'gate', sha: 's1', name: 'gate', start: T('11:46'), end: T('11:56'), startSource: 'gate-log', endSource: 'gate-log' },
        // A step of the gate run is inside the gate run, not inside the Stage: not summed twice.
        { id: 'g1-lint', kind: 'script', name: 'lint', parentWork: { kind: 'gate', id: 'g1' }, start: T('11:47'), end: T('11:50'), startSource: 'gate-log', endSource: 'gate-log' },
        { id: 's1', kind: 'script', ticket: 'e/01', name: 'merge-once', start: T('11:45'), end: T('11:59'), startSource: 'transcript', endSource: 'transcript' },
        // Work of the Run as a whole is inside no Stage: not in the sums.
        { id: 'q1', kind: 'agent', ticket: null, name: 'gate-queue', start: T('13:00'), end: T('13:40'), startSource: 'transcript', endSource: 'transcript' },
        agent('i2', 'e/02', 'impl-02', 'worfy:implementer', '12:10', '13:50'),
      ],
      // A lost span has no real times: not in the sums.
      lost: [{ ticket: 'e/01', kind: 'agent', name: 'impl-01', source: 'transcript-deleted', start: T('10:12'), end: T('10:22') }],
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
    // e/02 Implementing — is only third; it ties with e/01 Implementing, which began earlier.
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

  // worfy-resource-planner ticket 08: a Run that waited for its Start window shows that wait as
  // its own row, whole, and not as Limits.
  it('gives the Waits for the Start window a row of their own, counted whole', () => {
    const waits = summarize(
      buildTimeline(
        facts({
          waves: [
            { number: 1, startedAt: T('10:00'), finishedAt: T('10:30'), tickets: ['e/01'] },
            { number: 2, startedAt: T('13:00'), finishedAt: T('14:00'), tickets: ['e/02'] },
          ],
          waits: [
            { id: 'start-window:1', cause: 'start-window', start: T('10:30'), end: T('13:00'), detail: `outside, until ${T('13:00')}`, tickets: ['e/02'], startSource: 'journal', endSource: 'journal' },
            { id: 'limits:1', cause: 'limits', start: T('13:30'), end: T('13:40'), startSource: 'journal', endSource: 'journal' },
          ],
        }),
      ),
    ).waits
    expect(waits).toEqual([
      { cause: 'start-window', total: 150 * MIN, share: 150 / 240 },
      { cause: 'limits', total: 10 * MIN, share: 10 / 240 },
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

  it('gives a share of 0, not a division by zero, in a Run of no length', () => {
    const instant = summarize(
      buildTimeline(
        facts({
          run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('10:00'), live: false, outcome: 'ok' },
          waves: [],
          waits: [{ id: 'w', cause: 'limits', start: T('10:00'), end: T('10:10'), startSource: 'journal', endSource: 'journal' }],
        }),
      ),
    )
    expect(instant.waits).toEqual([{ cause: 'limits', total: 10 * MIN, share: 0 }])
  })
})
