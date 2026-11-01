// The facts of the Autopilot Journal for the span model (src/shared/flight-recorder/from-journal.ts;
// worfy-flight-recorder ticket 13): the frame of the Run and its Waves, the Waits by cause, the
// Tickets' statuses (with the time of the change, not of its sighting), the claim of an old Journal
// at wave-started, the Journal's retry causes and the marks on the Orchestrator's lane. The Journals
// are literals, plus the night-Run fixture of ticket 10; the facts go through buildTimeline where the
// claim is about the timeline.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { journalFacts, STOP_OUTCOMES, type JournalFacts } from '../../src/shared/flight-recorder/from-journal'
import { summarize } from '../../src/shared/flight-recorder/summary'
import { buildTimeline, type RunFacts, type StageEventFact, type WorkFact } from '../../src/shared/flight-recorder/spans'
import { AUTOPILOT_STOP_REASONS } from '../../src/shared/autopilot/cycle'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'

const RUN = '2026-10-17T10-00-00-000Z-a1b2c3'
/** `10:05` or `10:05:40` of the Run's day, UTC. */
const T = (hhmm: string): string => `2026-10-17T${hhmm}${hhmm.length === 5 ? ':00' : ''}.000Z`

/** One Journal line of the Run, Epic `e`. */
const line = (hhmm: string, kind: string, fields: Record<string, unknown> = {}): string =>
  JSON.stringify({ at: T(hhmm), run: RUN, project: 'repo-1a2b3c4d', epic: 'e', kind, ...fields })

const started = (fields: Record<string, unknown> = {}) => line('10:00', 'run-started', { origin: 'github.com/owner/repo', by: 'button', ...fields })
const wave = (hhmm: string, number: number, tickets: string[], fields: Record<string, unknown> = {}) => line(hhmm, 'wave-started', { wave: number, tickets, ...fields })
const finished = (hhmm: string, number: number, tickets: string[]) => line(hhmm, 'wave-finished', { wave: number, tickets })
const stopped = (hhmm: string, reason = 'no-ready-wave', fields: Record<string, unknown> = {}) => line(hhmm, 'run-stopped', { reason, ...fields })
const status = (hhmm: string, ticket: string, state: string, fields: Record<string, unknown> = {}) => line(hhmm, 'ticket-status', { ticket, state, ...fields })
const tasks = (hhmm: string, ...descriptions: string[]) =>
  line(hhmm, 'background-tasks', { tasks: descriptions.map((description, index) => ({ id: `t${index}`, type: 'local_agent', description })) })

function read(...lines: string[]): JournalFacts {
  const facts = journalFacts({ run: RUN, lines })
  if (facts === null) throw new Error('no facts')
  return facts
}

/** The Journal's facts as RunFacts, with the work of other sources added. */
function runFacts(journal: JournalFacts, more: Partial<RunFacts> = {}): RunFacts {
  return {
    run: { ...journal.run, live: false },
    now: journal.run.stoppedAt ?? journal.run.startedAt,
    pipeline: DEFAULT_PIPELINE,
    waves: journal.waves,
    ticketEvents: journal.ticketEvents,
    work: [],
    retryCauses: journal.retryCauses,
    waits: journal.waits,
    turns: [],
    lost: [],
    orchestratorMarks: journal.orchestratorMarks,
    ...more,
  }
}

const agent = (id: string, name: string, ticket: string, start: string, end: string): WorkFact => ({
  id,
  kind: 'agent',
  ticket,
  name,
  agentType: 'worfy:implementer',
  start: T(start),
  end: T(end),
  startSource: 'transcript',
})

describe('from-journal: the Waits', () => {
  it('turns limits-hit … resumed into a Wait `limits` with those times', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      line('10:10', 'limits-hit', { window: 'five_hour', resetsAt: T('11:00') }),
      line('10:10', 'waiting-until', { until: T('11:00') }),
      line('11:00', 'resumed'),
      finished('11:30', 1, ['01']),
      stopped('11:30'),
    )
    expect(facts.waits).toEqual([{ id: 'limits:1', cause: 'limits', start: T('10:10'), end: T('11:00'), detail: `five_hour, until ${T('11:00')}`, startSource: 'journal', endSource: 'journal' }])
    const timeline = buildTimeline(runFacts(facts))
    const wait = timeline.spans.find((item) => item.kind === 'wait')
    expect(wait).toMatchObject({ waitCause: 'limits', start: Date.parse(T('10:10')), end: Date.parse(T('11:00')), reason: `limits: five_hour, until ${T('11:00')}`, links: { tickets: ['e/01'] } })
  })

  it('turns budget-stop … resumed before a Wave into a Wait `limits-budget` that stands for the next Wave', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      finished('10:40', 1, ['01']),
      line('10:40', 'budget-stop', { cause: 'daily-share', share: 0.1, used: 0.1, need: 0.02, until: T('12:00'), text: 'nothing left of today' }),
      line('10:40', 'waiting-until', { until: T('12:00') }),
      line('12:00', 'resumed'),
      wave('12:00', 2, ['02']),
      finished('12:30', 2, ['02']),
      stopped('12:30'),
    )
    expect(facts.waits).toEqual([
      { id: 'limits-budget:1', cause: 'limits-budget', start: T('10:40'), end: T('12:00'), detail: `daily-share, until ${T('12:00')}`, tickets: ['e/02'], startSource: 'journal', endSource: 'journal' },
    ])
    // Written in the millisecond of wave-finished, where the model still counts Wave 1 open.
    const wait = buildTimeline(runFacts(facts)).spans.find((item) => item.kind === 'wait')
    expect(wait).toMatchObject({ waitCause: 'limits-budget', start: Date.parse(T('10:40')), end: Date.parse(T('12:00')), links: { tickets: ['e/02'] } })
    // A Wave sent in the very millisecond of the budget-stop is the one that stood.
    const same = read(started(), line('10:40', 'budget-stop', { cause: 'five-hour', until: T('10:40') }), wave('10:40', 1, ['03']), stopped('11:00'))
    expect(same.waits).toMatchObject([{ cause: 'limits-budget', tickets: ['e/03'] }])
    // No Wave after it: no Ticket stood.
    const last = read(started(), wave('10:01', 1, ['01']), finished('10:40', 1, ['01']), line('10:40', 'budget-stop', { cause: 'five-hour', until: T('12:00') }), stopped('11:00', 'user-stop'))
    expect(last.waits).toMatchObject([{ cause: 'limits-budget', end: T('11:00'), tickets: [] }])
  })

  // worfy-resource-planner ticket 08: the wait of the Run mode `start-window` is its own cause, not
  // the Limits — a Run started at 08:00 that waited for 23:00 did not stand on the Limits for 15 hours.
  it('turns start-window … resumed before a Wave into a Wait `start-window` that stands for the next Wave, not a Wait `limits`', () => {
    const facts = read(
      started({ mode: 'start-window' }),
      wave('10:01', 1, ['01']),
      finished('10:40', 1, ['01']),
      line('10:40', 'start-window', { reason: 'outside', until: T('23:00'), text: 'outside the Start window 23:00–07:00' }),
      line('10:40', 'waiting-until', { until: T('23:00') }),
      line('23:00', 'resumed'),
      wave('23:00', 2, ['02']),
      finished('23:30', 2, ['02']),
      stopped('23:30'),
    )
    expect(facts.waits).toEqual([
      { id: 'start-window:1', cause: 'start-window', start: T('10:40'), end: T('23:00'), detail: `outside, until ${T('23:00')}`, tickets: ['e/02'], startSource: 'journal', endSource: 'journal' },
    ])
    const wait = buildTimeline(runFacts(facts)).spans.find((item) => item.kind === 'wait')
    expect(wait).toMatchObject({ waitCause: 'start-window', start: Date.parse(T('10:40')), end: Date.parse(T('23:00')), links: { tickets: ['e/02'] } })
    // A Wave too long for what is left of the window: the reason is the detail.
    const tooLong = read(started({ mode: 'start-window' }), line('10:40', 'start-window', { reason: 'wave-too-long', until: T('23:00'), text: 'the Wave would end after 07:00', durationP90Ms: 3_600_000 }), line('10:40', 'waiting-until', { until: T('23:00') }), line('23:00', 'resumed'), wave('23:00', 1, ['03']), stopped('23:30'))
    expect(tooLong.waits).toEqual([
      { id: 'start-window:1', cause: 'start-window', start: T('10:40'), end: T('23:00'), detail: `wave-too-long, until ${T('23:00')}`, tickets: ['e/03'], startSource: 'journal', endSource: 'journal' },
    ])
  })

  // One Wait at a time for the Limits, the budget and the Start window (they share the waiting-until and
  // resumed that follow): the line that comes while one is open neither closes it nor opens another.
  // No writer does so — a start-window is checked before a Wave, a limits-hit comes inside one — but a
  // Journal that does keeps its time in one Wait.
  it('keeps a Limits Wait that is open when a start-window comes: no second Wait, nothing closed early', () => {
    const facts = read(
      started({ mode: 'start-window' }),
      wave('10:01', 1, ['01']),
      line('10:10', 'limits-hit', { window: 'seven_day', resetsAt: T('11:00') }),
      line('10:20', 'start-window', { reason: 'outside', until: T('11:00'), text: 'outside the Start window' }),
      line('10:20', 'waiting-until', { until: T('11:00') }),
      line('11:00', 'resumed'),
      finished('11:30', 1, ['01']),
      stopped('11:30'),
    )
    expect(facts.waits).toEqual([{ id: 'limits:1', cause: 'limits', start: T('10:10'), end: T('11:00'), detail: `seven_day, until ${T('11:00')}`, startSource: 'journal', endSource: 'journal' }])
  })

  it('leaves a background-tasks Wait open across a start-window: the Start window Wait runs beside it', () => {
    const facts = read(
      started({ mode: 'start-window' }),
      wave('10:01', 1, ['01']),
      tasks('10:05', 'Run gate fast'),
      finished('10:40', 1, ['01']),
      line('10:40', 'start-window', { reason: 'outside', until: T('23:00'), text: 'outside the Start window' }),
      line('10:40', 'waiting-until', { until: T('23:00') }),
      tasks('10:50'),
      line('23:00', 'resumed'),
      stopped('23:00'),
    )
    expect(facts.waits).toEqual([
      { id: 'background-tasks:1', cause: 'background-tasks', start: T('10:05'), end: T('10:50'), detail: 'Run gate fast', startSource: 'journal', endSource: 'journal' },
      { id: 'start-window:1', cause: 'start-window', start: T('10:40'), end: T('23:00'), detail: `outside, until ${T('23:00')}`, tickets: [], startSource: 'journal', endSource: 'journal' },
    ])
  })

  it('keeps a Start window Wait when a limits-hit comes inside it: no Wait `limits` opens', () => {
    const facts = read(
      started({ mode: 'start-window' }),
      line('10:00', 'start-window', { reason: 'outside', until: T('23:00'), text: 'outside the Start window' }),
      line('10:00', 'waiting-until', { until: T('23:00') }),
      line('12:00', 'limits-hit', { window: 'seven_day', resetsAt: null }),
      line('23:00', 'resumed'),
      wave('23:00', 1, ['01']),
      stopped('23:30'),
    )
    expect(facts.waits).toEqual([
      { id: 'start-window:1', cause: 'start-window', start: T('10:00'), end: T('23:00'), detail: `outside, until ${T('23:00')}`, tickets: ['e/01'], startSource: 'journal', endSource: 'journal' },
    ])
  })

  it('ends a Wait `start-window` still open at run-stopped there: no Ticket stood without a Wave after it', () => {
    const facts = read(
      started({ mode: 'start-window' }),
      wave('10:01', 1, ['01']),
      finished('10:40', 1, ['01']),
      line('10:40', 'start-window', { reason: 'outside', until: T('23:00'), text: 'outside the Start window' }),
      line('10:40', 'waiting-until', { until: T('23:00') }),
      stopped('12:00', 'user-stop'),
      line('12:05', 'resumed'),
    )
    expect(facts.waits).toEqual([
      { id: 'start-window:1', cause: 'start-window', start: T('10:40'), end: T('12:00'), detail: `outside, until ${T('23:00')}`, tickets: [], startSource: 'journal', endSource: 'journal' },
    ])
  })

  it('turns the stretches with live background tasks into Waits `background-tasks`, each with its tasks', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      tasks('10:05', 'Implement ticket 01'),
      tasks('10:20', 'Implement ticket 01', 'Run gate fast'),
      tasks('10:25', 'Implement ticket 01'),
      tasks('10:40'),
      tasks('10:50', 'Verify ticket 01'),
      tasks('11:00'),
      finished('11:01', 1, ['01']),
      stopped('11:01'),
    )
    expect(facts.waits).toEqual([
      { id: 'background-tasks:1', cause: 'background-tasks', start: T('10:05'), end: T('10:40'), detail: 'Implement ticket 01; Run gate fast', startSource: 'journal', endSource: 'journal' },
      { id: 'background-tasks:2', cause: 'background-tasks', start: T('10:50'), end: T('11:00'), detail: 'Verify ticket 01', startSource: 'journal', endSource: 'journal' },
    ])
    const spans = buildTimeline(runFacts(facts)).spans.filter((item) => item.waitCause === 'background-tasks')
    expect(spans.map(({ start, end, outcome }) => ({ start, end, outcome }))).toEqual([
      { start: Date.parse(T('10:05')), end: Date.parse(T('10:40')), outcome: 'ok' },
      { start: Date.parse(T('10:50')), end: Date.parse(T('11:00')), outcome: 'ok' },
    ])
  })

  it('ends a Wait still open at run-stopped there, and drops what the Journal holds after it', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      tasks('10:05', 'Implement ticket 01'),
      line('10:30', 'limits-hit', { window: null, resetsAt: null }),
      stopped('11:00', 'user-stop'),
      tasks('11:05'),
      status('11:05', '01', 'done', { statusAt: '2026-10-17T11:05Z' }),
      line('11:06', 'human-input', { source: 'worfy', what: 'typed in the Orchestrator' }),
      line('11:06', 'tasks-killed', { reason: 'app-quit', tasks: [] }),
      line('11:07', 'orchestrator-returned'),
    )
    // The Run stopped inside Wave 1: the Wave is last seen at the stop, never past it.
    expect(facts.waves).toMatchObject([{ number: 1, finishedAt: null, lastSeenAt: T('11:00') }])
    expect(facts.ticketEvents).toEqual([])
    const timeline = buildTimeline(runFacts(facts))
    expect(timeline.spans.find((item) => item.kind === 'wave')?.until).toBe(Date.parse(T('11:00')))
    expect(facts.waits.map(({ cause, start, end }) => ({ cause, start, end }))).toEqual([
      { cause: 'background-tasks', start: T('10:05'), end: T('11:00') },
      { cause: 'limits', start: T('10:30'), end: T('11:00') },
    ])
    expect(facts.waits.find((item) => item.cause === 'limits')?.detail).toBeUndefined()
    expect(facts.orchestratorMarks).toEqual([])
    // The Run's last line is still where it was last seen.
    expect(facts.run.lastSeenAt).toBe(T('11:07'))
  })

  it('leaves a Wait open with its last sighting when the Journal ends without run-stopped', () => {
    const facts = read(started(), wave('10:01', 1, ['01']), line('10:30', 'limits-hit', { window: 'five_hour', resetsAt: null }), line('10:30', 'waiting-until', { until: T('11:00') }), tasks('10:45'))
    expect(facts.waits).toEqual([{ id: 'limits:1', cause: 'limits', start: T('10:30'), end: null, lastSeenAt: T('10:45'), detail: `five_hour, until ${T('11:00')}`, startSource: 'journal' }])
    expect(facts.run).toMatchObject({ stoppedAt: null, lastSeenAt: T('10:45') })
    expect(facts.run.outcome).toBeUndefined()
  })

  it('turns gate-queue … gate-queue-finished into a Wait `gate-queue`', () => {
    const facts = read(started(), line('10:01', 'gate-queue', { text: 'Process gate queue' }), tasks('10:05', 'gate full of PR 7'), tasks('10:20'), line('10:22', 'gate-queue-finished'), stopped('10:22'))
    expect(facts.waits.filter((item) => item.cause === 'gate-queue')).toEqual([{ id: 'gate-queue:1', cause: 'gate-queue', start: T('10:01'), end: T('10:22'), startSource: 'journal', endSource: 'journal' }])
    const span = buildTimeline(runFacts(facts)).spans.find((item) => item.waitCause === 'gate-queue')
    expect(span).toMatchObject({ start: Date.parse(T('10:01')), end: Date.parse(T('10:22')), outcome: 'ok', reason: 'gate-queue' })
  })

  it('cuts a gate-queue of an old Journal (no gate-queue-finished) off at run-stopped, which follows its turn, by the rule of the model', () => {
    const facts = read(
      line('10:00', 'run-started', { origin: 'github.com/owner/repo' }),
      line('10:01', 'gate-queue', { text: 'Process gate queue' }),
      tasks('10:05', 'gate full of PR 7'),
      tasks('10:20'),
      stopped('10:40', 'no-ready-wave'),
    )
    const gate = facts.waits.find((item) => item.cause === 'gate-queue')
    expect(gate).toEqual({ id: 'gate-queue:1', cause: 'gate-queue', start: T('10:01'), end: null, lastSeenAt: T('10:40'), startSource: 'journal' })
    const span = buildTimeline(runFacts(facts)).spans.find((item) => item.waitCause === 'gate-queue')
    expect(span).toMatchObject({ outcome: 'cut-off', start: Date.parse(T('10:01')), end: Date.parse(T('10:40')), reason: 'gate-queue' })
    // No line between the two: still not a Wait of no length.
    const bare = read(line('10:00', 'run-started'), line('10:01', 'gate-queue', { text: 'Process gate queue' }), stopped('10:30', 'no-ready-wave'))
    expect(bare.waits).toMatchObject([{ cause: 'gate-queue', end: null, lastSeenAt: T('10:30') }])
  })

  it('takes a waiting-until alone as a Wait `limits`, and the last until of several', () => {
    const lone = read(started(), wave('10:01', 1, ['01']), line('10:10', 'waiting-until', { until: T('10:30') }), line('10:30', 'resumed'), stopped('11:00'))
    expect(lone.waits).toEqual([{ id: 'limits:1', cause: 'limits', start: T('10:10'), end: T('10:30'), detail: `until ${T('10:30')}`, startSource: 'journal', endSource: 'journal' }])
    const twice = read(
      started(),
      wave('10:01', 1, ['01']),
      line('10:10', 'limits-hit', { window: 'seven_day', resetsAt: null }),
      line('10:10', 'waiting-until', { until: T('10:30') }),
      line('10:30', 'waiting-until', { until: T('10:50') }),
      line('10:50', 'resumed'),
      stopped('11:00'),
    )
    expect(twice.waits).toMatchObject([{ cause: 'limits', start: T('10:10'), end: T('10:50'), detail: `seven_day, until ${T('10:50')}` }])
  })
})

describe('from-journal: the statuses of the Tickets', () => {
  it('turns claimed → blocked → claimed → done into the claim, the block mark, its clearing and done', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      status('10:05', '01', 'claimed'),
      status('10:30', '01', 'blocked', { reason: 'needs the owner', waits: 'owner' }),
      status('11:00', '01', 'claimed'),
      status('11:40', '01', 'done'),
      finished('11:45', 1, ['01']),
      stopped('11:45'),
    )
    expect(facts.ticketEvents).toEqual([
      { ticket: 'e/01', at: T('10:05'), source: 'journal', event: 'status', state: 'claimed' },
      { ticket: 'e/01', at: T('10:30'), source: 'journal', event: 'status', state: 'blocked', reason: 'needs the owner', waits: 'owner' },
      { ticket: 'e/01', at: T('11:00'), source: 'journal', event: 'status', state: 'claimed' },
      { ticket: 'e/01', at: T('11:40'), source: 'journal', event: 'status', state: 'done' },
    ])
    const timeline = buildTimeline(runFacts(facts))
    expect(timeline.blocks).toEqual([{ ticket: 'e/01', at: Date.parse(T('10:30')), until: Date.parse(T('11:00')), reason: 'needs the owner', waits: 'owner', cleared: true, source: 'journal' }])
    expect(timeline.spans.find((item) => item.kind === 'ticket')).toMatchObject({ outcome: 'ok', end: Date.parse(T('11:40')) })
  })

  it('takes the time of the change from a full statusAt, not the time worfy saw it', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      // Seen only at the last read before run-stopped.
      status('11:59', '01', 'done', { statusAt: '2026-10-17T11:20Z' }),
      stopped('12:00'),
    )
    expect(facts.ticketEvents).toEqual([{ ticket: 'e/01', at: T('11:20'), source: 'journal', event: 'status', state: 'done' }])
  })

  it('falls back to the sighting for a bare date, a time without a zone, or a statusAt after the sighting', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01', '02', '03']),
      status('10:30', '01', 'claimed', { statusAt: '2026-10-17' }),
      status('10:31', '02', 'claimed', { statusAt: '2026-10-17T10:20' }),
      status('10:32', '03', 'claimed', { statusAt: '2026-10-17T10:50Z' }),
      stopped('12:00'),
    )
    expect(facts.ticketEvents.map(({ ticket, at }) => ({ ticket, at }))).toEqual([
      { ticket: 'e/01', at: T('10:30') },
      { ticket: 'e/02', at: T('10:31') },
      { ticket: 'e/03', at: T('10:32') },
    ])
  })

  it('takes the sighting when a statusAt falls before the Ticket’s previous status (a Status line git brought in)', () => {
    const facts = read(
      started(),
      wave('10:01', 1, ['01']),
      status('10:05:40', '01', 'claimed'),
      // Written at 10:05:50; the Status line gives the minute only.
      status('10:06', '01', 'blocked', { statusAt: '2026-10-17T10:05Z', reason: 'r' }),
      stopped('12:00'),
    )
    // The block keeps its length instead of none.
    expect(facts.ticketEvents.map(({ at }) => at)).toEqual(['2026-10-17T10:05:40.000Z', T('10:06')])
  })

  it('clamps a first statusAt from before the Run to the Run’s start: the Ticket’s work does not land in Queued', () => {
    const facts = read(started(), wave('10:01', 1, ['01']), status('10:30', '01', 'claimed', { statusAt: '2026-10-17T09:50Z' }), status('10:40', '01', 'blocked', { statusAt: '2026-10-17T10:35Z' }), stopped('10:40'))
    expect(facts.ticketEvents.map(({ at }) => at)).toEqual([T('10:00'), T('10:35')])
    const timeline = buildTimeline(runFacts(facts, { work: [agent('a1', 'impl-01', 'e/01', '10:05', '10:38')] }))
    const stages = timeline.spans.filter((item) => item.kind === 'stage')
    expect(stages[0]).toMatchObject({ start: Date.parse(T('10:01')) })
    expect(stages[0]?.stages).not.toContain(DEFAULT_PIPELINE[0]?.kind)
    expect(timeline.spans.find((item) => item.id === 'agent:a1')?.parent).toBe(stages[0]?.id)
  })

  it('claims each Ticket of an old Journal (no ticket-status, no run-started.by) at the first wave-started that names it', () => {
    const facts = read(
      line('10:00', 'run-started', { origin: 'github.com/owner/repo' }),
      wave('10:01', 1, ['01', '02']),
      finished('11:00', 1, ['01', '02']),
      wave('11:00', 2, ['02', '03']),
      stopped('12:00', 'user-stop'),
    )
    expect(facts.ticketEvents).toEqual([
      { ticket: 'e/01', at: T('10:01'), source: 'journal', event: 'status', state: 'claimed' },
      { ticket: 'e/02', at: T('10:01'), source: 'journal', event: 'status', state: 'claimed' },
      { ticket: 'e/03', at: T('11:00'), source: 'journal', event: 'status', state: 'claimed' },
    ])
  })

  it('claims nothing at wave-started in a Journal of ticket 11 on, where a Ticket without ticket-status kept its status', () => {
    const facts = read(started(), wave('10:01', 1, ['01', '02']), status('10:05', '01', 'claimed'), stopped('12:00'))
    expect(facts.ticketEvents.map(({ ticket }) => ticket)).toEqual(['e/01'])
    expect(read(started(), wave('10:01', 1, ['01']), stopped('12:00')).ticketEvents).toEqual([])
    // A ticket-status line alone tells a later Journal, run-started without `by` too.
    const noBy = read(line('10:00', 'run-started'), wave('10:01', 1, ['01', '02']), status('10:05', '01', 'claimed'), stopped('12:00'))
    expect(noBy.ticketEvents.map(({ ticket, at }) => ({ ticket, at }))).toEqual([{ ticket: 'e/01', at: T('10:05') }])
    // A `by` the format does not know reads as none, but still marks a later Journal.
    const odd = read(started({ by: 'robot' }), wave('10:01', 1, ['01']), stopped('12:00'))
    expect(odd.by).toBeUndefined()
    expect(odd.ticketEvents).toEqual([])
  })

  it('lets the claim of an old Journal and the implied claim of a PR event before it agree: no step back', () => {
    const journal = read(line('10:00', 'run-started'), wave('10:30', 1, ['01']), stopped('12:00', 'user-stop'))
    // A PR opened before the Wave (a Run resumed over a Ticket in work), then CI and a merge.
    const github: StageEventFact[] = [
      { ticket: 'e/01', at: T('10:10'), source: 'github', event: 'pr-opened', pr: 7, sha: 's1' },
      { ticket: 'e/01', at: T('10:45'), source: 'github', event: 'ci-started', name: 'ci', sha: 's1' },
      { ticket: 'e/01', at: T('10:55'), source: 'github', event: 'ci-finished', name: 'ci', sha: 's1', conclusion: 'success' },
    ]
    const withPr = buildTimeline(runFacts(journal, { ticketEvents: [...journal.ticketEvents, ...github] }))
    const without = buildTimeline(runFacts(journal, { ticketEvents: github }))
    const stages = (timeline: ReturnType<typeof buildTimeline>) => timeline.spans.filter((item) => item.kind === 'stage').map(({ name, start, outcome }) => ({ name, start, outcome }))
    expect(stages(withPr)).toEqual(stages(without))
    expect(stages(withPr).some((item) => item.outcome === 'stopped' || item.outcome === 'rejected')).toBe(false)
    // With no other event, the claim alone moves the Ticket out of the first Stage at wave-started.
    const alone = buildTimeline(runFacts(journal))
    const first = alone.spans.find((item) => item.kind === 'stage')
    expect(first?.stages[0]).not.toBe(DEFAULT_PIPELINE[0]?.kind)
    expect(first?.start).toBe(Date.parse(T('10:30')))
  })
})

describe('from-journal: retries', () => {
  it('makes narrow-round `started` the cause of the next attempt of the Ticket’s agent, #2', () => {
    const journal = read(
      started(),
      wave('10:01', 1, ['01']),
      line('10:40', 'narrow-round', { ticket: '01', outcome: 'started', text: 'NARROW: fix the import order' }),
      line('11:10', 'narrow-round', { ticket: '01', outcome: 'verified', text: 'NARROW: VERIFIED' }),
      finished('11:30', 1, ['01']),
      stopped('11:30'),
    )
    expect(journal.retryCauses).toEqual([{ ticket: 'e/01', kind: 'agent', at: T('10:40'), reason: 'narrow round: NARROW: fix the import order', source: 'journal' }])
    const timeline = buildTimeline(runFacts(journal, { work: [agent('a1', 'impl-01', 'e/01', '10:02', '10:30'), agent('a2', 'impl-01-narrow', 'e/01', '10:41', '11:00')] }))
    expect(timeline.spans.find((item) => item.id === 'agent:a2')).toMatchObject({ attempt: 2, retryOf: 'agent:a1', reason: 'narrow round: NARROW: fix the import order' })
  })

  it('makes a session-error the cause of the next agent attempt, #2, in a new Wave', () => {
    const journal = read(
      started(),
      wave('10:01', 1, ['01']),
      line('10:20', 'session-error', { session: 's1', message: 'The Session failed' }),
      wave('10:25', 2, ['01'], { session: 's2' }),
      finished('11:30', 2, ['01']),
      stopped('11:30'),
    )
    expect(journal.retryCauses).toEqual([{ ticket: null, kind: 'agent', at: T('10:20'), reason: 'session-error: The Session failed', source: 'journal' }])
    expect(journal.waves.map(({ number, session }) => ({ number, session }))).toEqual([{ number: 1, session: undefined }, { number: 2, session: 's2' }])
    const timeline = buildTimeline(runFacts(journal, { work: [agent('a1', 'impl-01', 'e/01', '10:02', '10:20'), agent('a2', 'impl-01-restart', 'e/01', '10:26', '11:20')] }))
    expect(timeline.spans.find((item) => item.id === 'agent:a2')).toMatchObject({ attempt: 2, retryOf: 'agent:a1', reason: 'session-error: The Session failed' })
  })
})

describe('from-journal: the marks of the Orchestrator', () => {
  it('turns refused-dialog and human-input into marks on the Orchestrator’s lane, not Waits', () => {
    const journal = read(
      started(),
      wave('10:01', 1, ['01']),
      line('10:10', 'refused-dialog', { session: 's1', what: 'permission: Bash', agent: 'a1', reason: 'writes outside the worktree' }),
      line('10:20', 'refused-dialog', { session: 's1', what: 'question' }),
      line('10:30', 'human-input', { source: 'observer', what: 'clicked Allow on a Keychain dialog' }),
      finished('11:00', 1, ['01']),
      stopped('11:00'),
    )
    expect(journal.orchestratorMarks).toEqual([
      { kind: 'refused-dialog', at: T('10:10'), text: 'permission: Bash (agent a1): writes outside the worktree' },
      { kind: 'refused-dialog', at: T('10:20'), text: 'question' },
      { kind: 'human-input', at: T('10:30'), text: 'clicked Allow on a Keychain dialog (observer)' },
    ])
    expect(journal.waits).toEqual([])
    const timeline = buildTimeline(runFacts(journal))
    expect(timeline.orchestratorMarks.map(({ kind }) => kind)).toEqual(['refused-dialog', 'refused-dialog', 'human-input'])
    expect(timeline.spans.filter((item) => item.lane === 'wait')).toEqual([])
  })
})

describe('from-journal: the frame of the Run', () => {
  it('gives the Run, its Waves (number, Tickets, Session, text) and the stop with its outcome', () => {
    const journal = read(
      started({ by: 'command', tickets: ['01', '02'] }),
      wave('10:01', 1, ['01'], { text: '/worfy:epic-wave tickets 01 of epic e', session: 's1' }),
      finished('11:00', 1, ['01']),
      wave('11:00', 2, ['02']),
      tasks('11:30', 'Implement ticket 02'),
      stopped('12:00', 'user-force-stop', { tickets: ['02'] }),
    )
    expect(journal.run).toEqual({ id: RUN, startedAt: T('10:00'), stoppedAt: T('12:00'), lastSeenAt: T('12:00'), outcome: 'stopped', reason: 'user-force-stop' })
    expect(journal).toMatchObject({ epic: 'e', by: 'command', named: ['e/01', 'e/02'], tickets: ['e/01', 'e/02'], skipped: 0 })
    expect(journal.waves).toEqual([
      { number: 1, startedAt: T('10:01'), finishedAt: T('11:00'), tickets: ['e/01'], session: 's1', text: '/worfy:epic-wave tickets 01 of epic e' },
      // The Run stopped inside Wave 2: no end, last seen at the stop.
      { number: 2, startedAt: T('11:00'), finishedAt: null, lastSeenAt: T('12:00'), tickets: ['e/02'] },
    ])
  })

  // worfy-resource-planner ticket 08: the Run mode, the Epic forecast and the actual share, for the
  // head of the Run in Run history (ticket 11 of that Epic shows them).
  const FORECAST = { mode: 'budget-aware', waves: 3, tickets: 7, uncounted: 1, samples: 12, low: 0.18, high: 0.31, fit: 2, week: { utilization: 0.4, resetsAt: T('20:00') }, durationP90Ms: 5_400_000, durationSamples: 9 }
  const ACTUAL = { share: 0.24, waves: 2, counted: 2 }

  it('gives the Run mode, the Epic forecast and the actual share of the Journal', () => {
    const journal = read(
      started({ mode: 'budget-aware' }),
      line('10:00', 'forecast', FORECAST),
      wave('10:01', 1, ['01']),
      finished('11:00', 1, ['01']),
      wave('11:00', 2, ['02']),
      finished('12:00', 2, ['02']),
      stopped('12:00', 'tickets-done', { actual: ACTUAL }),
    )
    expect(journal.mode).toBe('budget-aware')
    // The forecast keeps only what Run history shows.
    expect(journal.forecast).toEqual({ low: 0.18, high: 0.31, waves: 3, tickets: 7, uncounted: 1, samples: 12, fit: 2 })
    expect(journal.actual).toEqual({ share: 0.24, waves: 2, counted: 2 })
    expect(journal.skipped).toBe(0)
    // Not enough data: the range and K are null, and stay null.
    const few = read(started({ mode: 'fastest' }), line('10:00', 'forecast', { ...FORECAST, mode: 'fastest', samples: 3, low: null, high: null, fit: null }), stopped('10:01'))
    expect(few.mode).toBe('fastest')
    expect(few.forecast).toEqual({ low: null, high: null, waves: 3, tickets: 7, uncounted: 1, samples: 3, fit: null })
    expect('actual' in few).toBe(false)
  })

  it('has no mode, forecast or actual in a Journal of before the Epic, and reads the rest as before', () => {
    const lines = [started(), wave('10:01', 1, ['01']), finished('11:00', 1, ['01']), stopped('11:00', 'tickets-done')]
    const journal = read(...lines)
    expect('mode' in journal || 'forecast' in journal || 'actual' in journal).toBe(false)
    expect(journal).toMatchObject({ by: 'button', tickets: ['e/01'], skipped: 0, waits: [] })
    expect(journal.run).toEqual({ id: RUN, startedAt: T('10:00'), stoppedAt: T('11:00'), lastSeenAt: T('11:00'), outcome: 'ok', reason: 'tickets-done' })
  })

  it('reads a mode, a forecast or an actual of another shape as none, and skips no line for it', () => {
    const shapes: Record<string, unknown>[] = [
      { ...FORECAST, low: '18%' },
      { ...FORECAST, high: -0.1 },
      { ...FORECAST, waves: 1.5 },
      { ...FORECAST, tickets: -1 },
      { ...FORECAST, uncounted: null },
      { ...FORECAST, samples: '12' },
      { ...FORECAST, fit: 0.5 },
      { ...FORECAST, fit: -1 },
      { mode: 'budget-aware' },
    ]
    for (const shape of shapes) {
      const journal = read(started(), line('10:00', 'forecast', shape), wave('10:01', 1, ['01']), stopped('10:30'))
      expect('forecast' in journal, JSON.stringify(shape)).toBe(false)
      // The mode is run-started's alone: the forecast line's `mode` does not stand in for a missing one.
      expect('mode' in journal, JSON.stringify(shape)).toBe(false)
      expect(journal.skipped).toBe(0)
      expect(journal.waves).toHaveLength(1)
    }
    for (const actual of [{ share: -0.1, waves: 2, counted: 2 }, { share: 0.2, waves: 0, counted: 0 }, { share: 0.2, waves: 2, counted: 3 }, { share: 0.2, waves: 2 }, 'a lot', null]) {
      const journal = read(started(), stopped('10:30', 'tickets-done', { actual }))
      expect('actual' in journal, JSON.stringify(actual)).toBe(false)
      expect(journal).toMatchObject({ skipped: 0, run: { reason: 'tickets-done', outcome: 'ok' } })
    }
    const night = read(started({ mode: 'night' }), stopped('10:30'))
    expect('mode' in night).toBe(false)
    expect(night).toMatchObject({ by: 'button', skipped: 0 })
  })

  it('takes the forecast of the first forecast line and the actual of the run-stopped that ends the Run', () => {
    const journal = read(
      started({ mode: 'start-window' }),
      line('10:00', 'forecast', FORECAST),
      line('10:00', 'forecast', { ...FORECAST, low: 0.5, high: 0.6 }),
      wave('10:01', 1, ['01']),
      finished('10:20', 1, ['01']),
      // An earlier run-stopped with an actual of its own: the Run ends at the last one.
      stopped('10:20', 'user-stop', { actual: { share: 0.05, waves: 1, counted: 1 } }),
      wave('10:21', 2, ['02']),
      finished('10:30', 2, ['02']),
      stopped('10:30', 'tickets-done', { actual: { share: 0.1, waves: 2, counted: 1 } }),
    )
    expect(journal.mode).toBe('start-window')
    expect(journal.forecast).toEqual({ low: 0.18, high: 0.31, waves: 3, tickets: 7, uncounted: 1, samples: 12, fit: 2 })
    expect(journal.actual).toEqual({ share: 0.1, waves: 2, counted: 1 })
    expect(journal.run).toMatchObject({ stoppedAt: T('10:30'), reason: 'tickets-done' })
  })

  it('does not break on a wave-started after run-stopped: that Wave is last seen at its own line', () => {
    const journal = read(started(), wave('10:01', 1, ['01']), stopped('10:30'), wave('10:40', 2, ['02']))
    expect(journal.waves[1]).toMatchObject({ number: 2, finishedAt: null, lastSeenAt: T('10:40') })
  })

  it('gives a Wave a later wave-started replaced its last line before that start', () => {
    const journal = read(started(), wave('10:01', 1, ['01']), tasks('10:20', 'x'), tasks('10:40'), wave('11:00', 2, ['02']), finished('11:30', 2, ['02']), stopped('11:30'))
    expect(journal.waves[0]).toMatchObject({ finishedAt: null, lastSeenAt: T('10:40') })
  })

  it('maps every stop reason to an outcome', () => {
    expect(Object.keys(STOP_OUTCOMES).sort()).toEqual([...AUTOPILOT_STOP_REASONS].sort())
    expect(STOP_OUTCOMES).toEqual({
      'tickets-done': 'ok',
      'no-ready-wave': 'ok',
      'blocked-tickets': 'blocked',
      'user-stop': 'stopped',
      'user-force-stop': 'stopped',
      'app-quit': 'stopped',
      interrupted: 'stopped',
      'no-progress': 'failed',
      'wave-unfinished': 'failed',
      'session-error': 'failed',
      'turn-error': 'failed',
      'session-closed': 'failed',
      'send-failed': 'failed',
      'workflow-error': 'failed',
      'limits-timeout': 'failed',
      'background-stalled': 'failed',
      'window-too-short': 'failed',
    })
    expect(read(started(), stopped('10:01', 'tickets-done')).run.outcome).toBe('ok')
    // The Start window too short for any Wave (worfy-resource-planner ticket 05): the Run did not do its work.
    expect(read(started(), stopped('10:01', 'window-too-short')).run.outcome).toBe('failed')
    // A reason the format does not know stays the reason; the outcome is the model's default.
    const unknown = read(started(), stopped('10:01', 'something-new')).run
    expect(unknown).toMatchObject({ reason: 'something-new' })
    expect(unknown.outcome).toBeUndefined()
  })

  it('skips lines of another Run and lines that do not parse, and counts them', () => {
    const journal = read(
      started(),
      '{"at":"cut off',
      JSON.stringify({ at: T('10:05'), run: 'another-run', project: 'p', epic: 'e', kind: 'human-input', source: 'observer', what: 'clicked' }),
      line('10:06', 'no-such-kind'),
      stopped('10:10'),
    )
    expect(journal.skipped).toBe(3)
    expect(journal.orchestratorMarks).toEqual([])
  })

  it('gives null for a Journal with no line of the Run', () => {
    expect(journalFacts({ run: RUN, lines: [] })).toBeNull()
    expect(journalFacts({ run: RUN, lines: ['not json', ''] })).toBeNull()
  })

  it('starts the Run at its first line when run-started is missing', () => {
    expect(read(wave('10:01', 1, ['01']), stopped('11:00')).run.startedAt).toBe(T('10:01'))
  })
})

describe('from-journal: the night-Run fixture', () => {
  const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
  const file = join(import.meta.dirname, '..', 'fixtures', 'flight-recorder', 'night-run', 'data', 'autopilot', `${NIGHT_RUN}.jsonl`)
  const night = (): JournalFacts => {
    const facts = journalFacts({ run: NIGHT_RUN, lines: readFileSync(file, 'utf8').split('\n') })
    if (facts === null) throw new Error('no facts')
    return facts
  }

  it('has the Journal’s Waves, their Tickets, the stop reason and the length of the Run', () => {
    const facts = night()
    expect(facts.waves.map(({ number, tickets }) => ({ number, tickets }))).toEqual([
      { number: 1, tickets: ['worfy-pipeline/03', 'worfy-pipeline/07'] },
      { number: 2, tickets: ['worfy-pipeline/04', 'worfy-pipeline/05'] },
    ])
    expect(facts.waves.map(({ startedAt, finishedAt }) => ({ startedAt, finishedAt }))).toEqual([
      { startedAt: '2026-10-17T22:29:33.879Z', finishedAt: '2026-10-18T01:13:01.175Z' },
      { startedAt: '2026-10-18T01:13:02.542Z', finishedAt: '2026-10-18T03:17:34.592Z' },
    ])
    expect(facts.run).toMatchObject({ id: NIGHT_RUN, startedAt: '2026-10-17T22:29:32.707Z', stoppedAt: '2026-10-18T03:17:34.592Z', reason: 'blocked-tickets', outcome: 'blocked' })
    // 4 h 48 min.
    expect(Date.parse(facts.run.stoppedAt ?? '') - Date.parse(facts.run.startedAt)).toBe(4 * 3_600_000 + 48 * 60_000 + 1885)
    expect(facts.skipped).toBe(0)
  })

  it('claims the Tickets at their wave-started (a Journal of before ticket 11) and keeps the background tasks as Waits', () => {
    const facts = night()
    expect(facts.ticketEvents.map(({ ticket, at }) => ({ ticket, at }))).toEqual([
      { ticket: 'worfy-pipeline/03', at: '2026-10-17T22:29:33.879Z' },
      { ticket: 'worfy-pipeline/07', at: '2026-10-17T22:29:33.879Z' },
      { ticket: 'worfy-pipeline/04', at: '2026-10-18T01:13:02.542Z' },
      { ticket: 'worfy-pipeline/05', at: '2026-10-18T01:13:02.542Z' },
    ])
    expect(facts.waits.every((wait) => wait.cause === 'background-tasks' && wait.end !== null)).toBe(true)
    expect(facts.waits[0]).toMatchObject({ start: '2026-10-17T22:32:00.533Z', end: '2026-10-17T23:22:30.560Z', detail: 'Implement worfy-pipeline ticket 03' })
    expect(facts.retryCauses).toEqual([])
    expect(facts.orchestratorMarks).toEqual([])
    const timeline = buildTimeline(runFacts(facts))
    expect(timeline.spans.filter((item) => item.kind === 'wave')).toHaveLength(2)
    expect(timeline.spans.filter((item) => item.kind === 'ticket')).toHaveLength(4)
  })

  // The baseline of the model's rule to come (a background-tasks Wait counts only where no work of
  // the Run runs): today the Journal's Waits cover the agents' own work, nearly the whole Run.
  it('pins the raw background-tasks Waits of the night Run: their number and length', () => {
    const facts = night()
    const total = facts.waits.reduce((sum, wait) => sum + Date.parse(wait.end ?? wait.start) - Date.parse(wait.start), 0)
    expect({ count: facts.waits.length, total }).toEqual({ count: 13, total: 15_808_308 })
    const [row] = summarize(buildTimeline(runFacts(facts))).waits
    expect(row).toMatchObject({ cause: 'background-tasks', total })
    expect(row?.share).toBeCloseTo(0.915, 3)
  })
})

describe('from-journal: pure', () => {
  it('imports neither Node nor the DOM', () => {
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'shared', 'flight-recorder', 'from-journal.ts'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gmu)].map((match) => match[1])
    expect(imports.every((name) => name !== undefined && name.startsWith('.'))).toBe(true)
  })
})
