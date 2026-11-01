// The span model of Flight Recorder (src/shared/flight-recorder/spans.ts; worfy-flight-recorder
// ticket 12, decision 03): the kinds and fields of a span, the tree built from facts (a Ticket in
// two Waves is one row with two parts; the Orchestrator's turns on a lane of their own), the Stages
// replayed through the board's stageOf (joined Stages where a source has no boundary), retries `#N`
// with the span that caused them, the Journal's retry causes, gate runs placed by sha and worktree,
// blocks as marks, cut-off spans against live ones, the labels of lost sources, the Run's end as
// the limit of what belongs to it — and that the module imports neither Node nor the DOM.
// The facts are literals, no source is read.
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE, type PipelineStage } from '../../src/shared/workflow/pipeline'
import {
  agentSubkind,
  AGENT_SUBKINDS,
  buildTimeline,
  childrenOf,
  LOST_SOURCE_LABELS,
  NO_BOUNDARY_NOTE,
  NO_END_REASON,
  NO_REASON,
  SPAN_KINDS,
  SPAN_OUTCOMES,
  WAIT_CAUSES,
  WAVE_FINISHED_REASON,
  type RunFacts,
  type Span,
  type StageEvent,
  type StageEventFact,
  type Timeline,
  type WorkFact,
} from '../../src/shared/flight-recorder/spans'

const T = (hhmm: string): string => `2026-10-17T${hhmm}:00.000Z`
const at = (hhmm: string): number => Date.parse(T(hhmm))

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

const liveRun = { id: 'run-1', startedAt: T('10:00'), stoppedAt: null, live: true }

// The events of a Ticket, `e/01` unless said otherwise.
const ev = (hhmm: string, fields: StageEvent & { ticket?: string }): StageEventFact =>
  ({ ticket: 'e/01', at: T(hhmm), source: fields.event === 'status' ? 'journal' : 'github', ...fields }) as StageEventFact
const claimed = (hhmm: string, ticket = 'e/01') => ev(hhmm, { event: 'status', state: 'claimed', ticket })
const done = (hhmm: string, ticket = 'e/01') => ev(hhmm, { event: 'status', state: 'done', ticket })
const blocked = (hhmm: string, reason = 'needs the owner', ticket = 'e/01') => ev(hhmm, { event: 'status', state: 'blocked', reason, waits: 'owner', ticket })
const prOpened = (hhmm: string, sha: string | null = 's1', pr = 7) => ev(hhmm, { event: 'pr-opened', pr, sha })
const push = (hhmm: string, sha: string) => ev(hhmm, { event: 'push', sha })
const ciStarted = (hhmm: string, sha: string | null = null) => ev(hhmm, { event: 'ci-started', name: 'ci', sha })
const ciFinished = (hhmm: string, conclusion: 'success' | 'failure' = 'success', sha: string | null = null) => ev(hhmm, { event: 'ci-finished', name: 'ci', sha, conclusion })
const mark = (hhmm: string, name: string, verdict: 'success' | 'failure' | 'skipped', more: { sha?: string | null; reason?: string } = {}) =>
  ev(hhmm, { event: 'mark', mark: name, verdict, sha: more.sha ?? null, ...(more.reason === undefined ? {} : { reason: more.reason }) })
const merge = (hhmm: string) => ev(hhmm, { event: 'merge' })

const work = (id: string, from: string, to: string | null, more: Partial<WorkFact> = {}): WorkFact => ({
  id,
  kind: 'agent',
  ticket: 'e/01',
  name: 'impl-01',
  agentType: 'worfy:implementer',
  start: T(from),
  end: to === null ? null : T(to),
  startSource: 'transcript',
  ...(to === null ? {} : { endSource: 'transcript' as const }),
  ...more,
})

const all = (timeline: Timeline, test: (span: Span) => boolean): Span[] => timeline.spans.filter(test)
const one = (timeline: Timeline, test: (span: Span) => boolean): Span => {
  const found = all(timeline, test)
  expect(found).toHaveLength(1)
  return found[0] as Span
}
const byId = (timeline: Timeline, id: string): Span => one(timeline, (span) => span.id === id)
const stages = (timeline: Timeline, ticket = 'e/01'): Span[] => all(timeline, (span) => span.kind === 'stage' && span.links.ticket === ticket)
const ticketOf = (timeline: Timeline, ticket = 'e/01'): Span => one(timeline, (span) => span.kind === 'ticket' && span.name === ticket)

describe('the vocabulary', () => {
  it('has the fixed kinds, outcomes, subkinds and Wait causes of the spec', () => {
    expect(SPAN_KINDS).toEqual(['run', 'wave', 'ticket', 'stage', 'agent', 'ci', 'gate', 'script', 'wait', 'orchestrator-turn'])
    expect(SPAN_OUTCOMES).toEqual(['ok', 'failed', 'rejected', 'blocked', 'stopped', 'cut-off'])
    expect(AGENT_SUBKINDS).toEqual(['implementer', 'verifier', 'other'])
    expect(WAIT_CAUSES).toEqual(['limits', 'limits-budget', 'start-window', 'background-tasks', 'gate-queue', 'other-machine'])
  })

  it('tells an agent subkind by its Harness type, else its name', () => {
    expect(agentSubkind('anything', 'worfy:implementer')).toBe('implementer')
    expect(agentSubkind('anything', 'implementer')).toBe('implementer')
    expect(agentSubkind('anything', 'worfy:reviewer')).toBe('verifier')
    // A type of another plugin is not the Harness's: the name decides.
    expect(agentSubkind('impl-12', 'other:reviewer')).toBe('implementer')
    expect(agentSubkind('verify-12', 'worfy:scout')).toBe('other')
    expect(agentSubkind('impl-12')).toBe('implementer')
    expect(agentSubkind('verify-g12-claims')).toBe('verifier')
    expect(agentSubkind('review-12')).toBe('verifier')
    expect(agentSubkind('helper', 'Explore')).toBe('other')
  })

  it('gives every span the fields of decision 03, Q6', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05')], work: [work('a', '10:10', '10:20', { session: 's-1', agent: 'a-1', pr: 7, sha: 'abc', verdict: 'VERIFIED', note: 'green cache' })] }))
    expect(byId(timeline, 'agent:a')).toMatchObject({
      kind: 'agent',
      subkind: 'implementer',
      start: at('10:10'),
      end: at('10:20'),
      outcome: 'ok',
      reason: null,
      attempt: 1,
      retryOf: null,
      links: { run: 'run-1', ticket: 'e/01', session: 's-1', agent: 'a-1', pr: 7, sha: 'abc', verdict: 'VERIFIED' },
      startSource: 'transcript',
      endSource: 'transcript',
      lost: null,
      note: 'green cache',
    })
  })
})

describe('the tree', () => {
  const timeline = buildTimeline(
    facts({
      waves: [
        { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01', 'e/02'], session: 'orch-1' },
        { number: 2, startedAt: T('12:00'), finishedAt: T('13:00'), tickets: ['e/01'] },
      ],
      ticketEvents: [claimed('10:10'), prOpened('12:30'), ciStarted('12:31')],
      work: [work('a', '10:15', '10:45'), work('b', '12:05', '12:25', { name: 'helper', agentType: 'Explore' })],
      turns: [
        { id: 't1', start: T('10:00'), end: T('10:02'), tickets: ['e/01', 'e/02'], startSource: 'transcript', endSource: 'transcript' },
        { id: 't2', start: T('12:00'), end: T('12:01'), tickets: ['e/01'], startSource: 'transcript', endSource: 'transcript' },
      ],
    }),
  )

  it('makes one row for a Ticket in two Waves, with a part per Wave and the gap between them', () => {
    const ticket = ticketOf(timeline)
    expect(ticket.segments).toEqual([
      { start: at('10:00'), end: at('11:00'), wave: 1 },
      { start: at('12:00'), end: at('13:00'), wave: 2 },
    ])
    expect([ticket.links.waves, ticket.parent]).toEqual([[1, 2], 'run'])
    // A Stage that goes on across the gap has the same two-part shape: Implementing 10:10–12:30.
    const implementing = one(timeline, (span) => span.kind === 'stage' && span.name === 'Implementing')
    expect(implementing.segments).toEqual([
      { start: at('10:10'), end: at('11:00'), wave: 1 },
      { start: at('12:00'), end: at('12:30'), wave: 2 },
    ])
  })

  it('hangs the Waves off the Run, the Stages off their Ticket and the work off its Stage', () => {
    expect(all(timeline, (span) => span.kind === 'wave').map((span) => [span.name, span.parent, span.links.wave])).toEqual([
      ['Wave 1', 'run', 1],
      ['Wave 2', 'run', 2],
    ])
    expect(one(timeline, (span) => span.kind === 'wave' && span.links.wave === 1).links.session).toBe('orch-1')
    expect(childrenOf(timeline, ticketOf(timeline)).map((span) => span.name)).toEqual(['Queued', 'Implementing', 'CI'])
    const implementing = one(timeline, (span) => span.name === 'Implementing')
    expect(childrenOf(timeline, implementing).map((span) => [span.name, span.subkind])).toEqual([
      ['impl-01', 'implementer'],
      ['helper', 'other'],
    ])
  })

  it('puts the Orchestrator turns on their own lane, linked to the Tickets and not nested in them', () => {
    const turns = all(timeline, (span) => span.kind === 'orchestrator-turn')
    expect(turns.map((span) => [span.lane, span.parent, span.links.tickets])).toEqual([
      ['orchestrator', 'run', ['e/01', 'e/02']],
      ['orchestrator', 'run', ['e/01']],
    ])
  })

  it('ends a Ticket the last Wave finished without it as stopped, with a reason', () => {
    const ticket = ticketOf(timeline, 'e/02')
    expect([ticket.segments.length, ticket.outcome, ticket.reason]).toEqual([1, 'stopped', WAVE_FINISHED_REASON])
  })

  it('gives a Ticket done in one Wave and named again in a later one no part in the later one', () => {
    const again = buildTimeline(
      facts({
        waves: [
          { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01'] },
          { number: 2, startedAt: T('12:00'), finishedAt: T('13:00'), tickets: ['e/01'] },
        ],
        ticketEvents: [claimed('10:05'), done('10:30')],
      }),
    )
    const ticket = ticketOf(again)
    expect([ticket.segments, ticket.end, ticket.outcome]).toEqual([[{ start: at('10:00'), end: at('10:30'), wave: 1 }], at('10:30'), 'ok'])
  })
})

describe('Stages', () => {
  it('take each boundary from a source event: claim, PR, CI, verdict, merge, done', () => {
    const timeline = buildTimeline(
      facts({
        // Out of order on purpose: the model sorts.
        ticketEvents: [merge('11:30'), claimed('10:05'), prOpened('10:50'), ciStarted('10:51'), ciFinished('11:00'), mark('11:20', 'review', 'success', { sha: 's1' }), done('11:40')],
      }),
    )
    expect(stages(timeline).map((span) => [span.name, span.start, span.end, span.outcome, span.note, span.startSource, span.endSource])).toEqual([
      ['Queued', at('10:00'), at('10:05'), 'ok', null, null, 'journal'],
      ['Implementing', at('10:05'), at('10:50'), 'ok', null, 'journal', 'github'],
      ['CI', at('10:50'), at('11:00'), 'ok', null, 'github', 'github'],
      ['Agent review', at('11:00'), at('11:20'), 'ok', null, 'github', 'github'],
      ['Gate & merge', at('11:20'), at('11:30'), 'ok', null, 'github', 'github'],
      ['Closing', at('11:30'), at('11:40'), 'ok', null, 'github', 'journal'],
    ])
    const ticket = ticketOf(timeline)
    expect([ticket.end, ticket.outcome]).toEqual([at('11:40'), 'ok'])
  })

  it('carry the PR and the head sha in their links, and so does the Ticket', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), prOpened('10:50', 's1', 42), ciStarted('10:51'), push('11:10', 's2')] }))
    const [queued, implementing, ci] = stages(timeline)
    expect([queued?.links.pr, implementing?.links.pr, implementing?.links.sha]).toEqual([undefined, undefined, undefined])
    expect([ci?.name, ci?.links.pr, ci?.links.sha]).toEqual(['CI', 42, 's1'])
    expect([ticketOf(timeline).links.pr, ticketOf(timeline).links.sha]).toEqual([42, 's2'])
  })

  it('join neighbouring Stages with no boundary event into one span named after all of them, with the note', () => {
    // No PR event: the mark has no head to count on, and the merge passes everything before it at once.
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), ciFinished('11:00'), mark('11:20', 'review', 'success', { sha: 's1' }), merge('11:30')] }))
    const joined = one(timeline, (span) => span.kind === 'stage' && span.note !== null)
    expect([joined.name, joined.stages, joined.note, joined.start, joined.end]).toEqual([
      'Implementing + CI + Agent review + Gate & merge',
      ['implementing', 'ci', 'agent-review', 'gate-merge'],
      NO_BOUNDARY_NOTE,
      at('10:05'),
      at('11:30'),
    ])
    expect(NO_BOUNDARY_NOTE).toBe('no boundary in sources')
  })

  it('let a merge pass every Stage before it, as the board does', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), prOpened('10:50'), ciStarted('10:51'), merge('11:30')] }))
    expect(stages(timeline).map((span) => span.name)).toEqual(['Queued', 'Implementing', 'CI + Agent review + Gate & merge', 'Closing'])
  })

  it('join Implementing and CI when the PR has no CI at all', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), prOpened('10:50')] }))
    expect(stages(timeline).map((span) => [span.name, span.end])).toEqual([
      ['Queued', at('10:05')],
      ['Implementing + CI', at('10:50')],
      ['Agent review', at('14:00')],
    ])
  })

  it('follow the Profile Pipeline: a Check passes on its mark, a skipped one too', () => {
    const pipeline: readonly PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'ci' }, { kind: 'agent-review' }, { kind: 'check', name: 'windows' }, { kind: 'gate-merge' }, { kind: 'closing' }, { kind: 'done' }]
    const run = (verdict: 'success' | 'skipped') =>
      buildTimeline(facts({ pipeline, ticketEvents: [claimed('10:05'), prOpened('10:50'), ciStarted('10:51'), ciFinished('11:00'), mark('11:20', 'review', 'success'), mark('12:00', 'check/windows', verdict)] }))
    for (const verdict of ['success', 'skipped'] as const) {
      expect(stages(run(verdict)).map((span) => [span.name, span.end])).toEqual([
        ['Queued', at('10:05')],
        ['Implementing', at('10:50')],
        ['CI', at('11:00')],
        ['Agent review', at('11:20')],
        ['Check «windows»', at('12:00')],
        ['Gate & merge', at('14:00')],
      ])
    }
  })

  it('count a Ticket claimed before the Run (no status event) as claimed by its first other event', () => {
    // A resumed Run takes a Ticket in work into its Wave: ticket-status is written only on a change.
    const timeline = buildTimeline(facts({ ticketEvents: [prOpened('10:30'), ciFinished('10:50'), mark('11:30', 'review', 'success')] }))
    expect(stages(timeline).map((span) => [span.name, span.start, span.end, span.note])).toEqual([
      ['Queued + Implementing', at('10:00'), at('10:30'), NO_BOUNDARY_NOTE],
      ['CI', at('10:30'), at('10:50'), null],
      ['Agent review', at('10:50'), at('11:30'), null],
      ['Gate & merge', at('11:30'), at('14:00'), null],
    ])
    // A status the Journal does write still decides: an explicit `open` keeps the Ticket queued.
    const reopened = buildTimeline(facts({ ticketEvents: [ev('10:10', { event: 'status', state: 'open' }), prOpened('10:30')] }))
    expect(stages(reopened).map((span) => span.name)).toEqual(['Queued'])
  })

  it('ignore a check of an older head once a new commit is pushed', () => {
    const timeline = buildTimeline(
      facts({
        ticketEvents: [
          claimed('10:05'),
          prOpened('10:40', 's1'),
          ciStarted('10:40', 's1'),
          ciFinished('10:50', 'success', 's1'),
          push('11:00', 's2'),
          ciStarted('11:00', 's2'),
          // A late check of the old head.
          ev('11:05', { event: 'ci-started', name: 'e2e', sha: 's1' }),
          ciFinished('11:10', 'success', 's2'),
        ],
      }),
    )
    expect(stages(timeline).map((span) => [span.name, span.attempt, span.end])).toEqual([
      ['Queued', 1, at('10:05')],
      ['Implementing', 1, at('10:40')],
      ['CI', 1, at('10:50')],
      ['Agent review', 1, at('11:00')],
      ['CI', 2, at('11:10')],
      ['Agent review', 2, at('14:00')],
    ])
    // Sent back by a commit, not by a verdict: stopped, with where it went.
    expect([stages(timeline)[3]?.outcome, stages(timeline)[3]?.reason]).toEqual(['stopped', 'back to CI'])
  })

  it('count an attempt of every Stage a joined span covered', () => {
    // «Implementing + CI» (a PR with no CI), REJECTED, a new commit with CI: that CI is #2.
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), prOpened('10:50'), mark('11:20', 'review', 'failure', { reason: 'REJECTED' }), push('11:40', 's2'), ciStarted('11:41')] }))
    expect(stages(timeline).map((span) => [span.name, span.attempt])).toEqual([
      ['Queued', 1],
      ['Implementing + CI', 1],
      ['Agent review', 1],
      ['Implementing', 2],
      ['CI', 2],
    ])
  })

  it('start no earlier than the Ticket row, and read nothing after it', () => {
    const timeline = buildTimeline(
      facts({
        waves: [{ number: 2, startedAt: T('11:00'), finishedAt: T('12:00'), tickets: ['e/01'] }],
        // Claimed before its Wave began; merged by hand after its Wave, while the Run still went on.
        ticketEvents: [claimed('10:30'), prOpened('11:20'), ciStarted('11:21'), merge('13:00')],
      }),
    )
    expect(stages(timeline).map((span) => [span.name, span.start, span.end])).toEqual([
      ['Implementing', at('11:00'), at('11:20')],
      ['CI', at('11:20'), at('12:00')],
    ])
  })
})

describe('retries', () => {
  // A failed CI run is re-run (#2 of ci); a REJECTED verdict sends the Ticket back: the
  // implementer's second stretch is #2, caused by the verifier's REJECTED span; a second failure
  // mark on the same head adds nothing; the new commit starts CI #2.
  const timeline = buildTimeline(
    facts({
      ticketEvents: [
        claimed('10:05'),
        prOpened('10:40', 's1'),
        ciStarted('10:40'),
        ciFinished('10:45', 'failure'),
        ciStarted('10:46'),
        ciFinished('10:50'),
        mark('11:10', 'review', 'failure', { sha: 's1', reason: 'REJECTED: missing test' }),
        mark('11:11', 'review', 'failure', { sha: 's1' }),
        push('11:40', 's2'),
        ciStarted('11:40'),
        ciFinished('11:50'),
        mark('12:10', 'review', 'success', { sha: 's2' }),
      ],
      work: [
        work('impl-1', '10:06', '10:40'),
        work('ci-1', '10:40', '10:45', { kind: 'ci', name: 'ci', agentType: undefined, outcome: 'failed', reason: 'unit shard 2 red', startSource: 'github', endSource: 'github' }),
        work('ci-1b', '10:46', '10:50', { kind: 'ci', name: 'ci', agentType: undefined, startSource: 'github', endSource: 'github' }),
        work('verify-1', '10:52', '11:10', { name: 'verify-01', agentType: 'worfy:reviewer', outcome: 'rejected', reason: 'REJECTED: missing test' }),
        // Starts the very minute the verdict lands.
        work('impl-2', '11:10', '11:40'),
        work('ci-2', '11:40', '11:50', { kind: 'ci', name: 'ci', agentType: undefined, startSource: 'github', endSource: 'github' }),
        work('verify-2', '11:52', '12:10', { name: 'verify-01', agentType: 'worfy:reviewer' }),
      ],
      waits: [{ id: 'w', cause: 'limits', start: T('12:20'), end: T('12:40'), startSource: 'journal', endSource: 'journal' }],
    }),
  )

  it('number the second span of the same agent #2 and link it to the REJECTED span', () => {
    const second = byId(timeline, 'agent:impl-2')
    expect([second.attempt, second.retryOf]).toEqual([2, 'agent:verify-1'])
    expect(second.reason).toContain('verify-01')
    expect(byId(timeline, 'agent:impl-1').attempt).toBe(1)
  })

  it('send the Ticket back to Implementing #2 once for a REJECTED verdict, however often it is repeated', () => {
    expect(stages(timeline).map((span) => [span.name, span.attempt, span.outcome, span.start, span.end])).toEqual([
      ['Queued', 1, 'ok', at('10:00'), at('10:05')],
      ['Implementing', 1, 'ok', at('10:05'), at('10:40')],
      ['CI', 1, 'ok', at('10:40'), at('10:50')],
      ['Agent review', 1, 'rejected', at('10:50'), at('11:10')],
      ['Implementing', 2, 'ok', at('11:10'), at('11:40')],
      ['CI', 2, 'ok', at('11:40'), at('11:50')],
      ['Agent review', 2, 'ok', at('11:50'), at('12:10')],
      ['Gate & merge', 1, 'stopped', at('12:10'), at('14:00')],
    ])
    const [, , , rejected, implementing2] = stages(timeline)
    expect(rejected?.reason).toBe('REJECTED: missing test')
    expect([implementing2?.retryOf, implementing2?.reason]).toEqual([rejected?.id, 'after Agent review: REJECTED: missing test'])
    // Work that starts on a boundary belongs to the Stage that starts there.
    expect(byId(timeline, 'ci:ci-1').parent).toBe(stages(timeline)[2]?.id)
    expect(byId(timeline, 'agent:impl-2').parent).toBe(implementing2?.id)
  })

  it('number a repeated CI run #2 of ci, caused by the failed one', () => {
    expect([byId(timeline, 'ci:ci-1b').attempt, byId(timeline, 'ci:ci-1b').retryOf]).toEqual([2, 'ci:ci-1'])
    expect(byId(timeline, 'ci:ci-2').attempt).toBe(3)
    expect(byId(timeline, 'agent:verify-2').attempt).toBe(2)
  })

  it('link a retry to the previous attempt when nothing failed before it, and never to work of the Run', () => {
    const plain = buildTimeline(
      facts({
        ticketEvents: [claimed('10:05')],
        work: [
          work('x', '10:10', '10:20', { kind: 'ci', name: 'ci' }),
          work('q', '10:25', '10:30', { ticket: null, kind: 'ci', name: 'queue', outcome: 'failed', reason: 'gate queue broke' }),
          work('y', '10:40', '10:50', { kind: 'ci', name: 'ci' }),
        ],
      }),
    )
    const rerun = byId(plain, 'ci:y')
    expect([rerun.attempt, rerun.retryOf, rerun.reason]).toEqual([2, 'ci:x', 'after ci'])
    expect(byId(plain, 'ci:q').parent).toBe('run')
  })

  it('attach a narrow-round only to work of its own Ticket', () => {
    const timeline = buildTimeline(
      facts({
        waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/01', 'e/02'] }],
        ticketEvents: [claimed('10:05'), claimed('10:05', 'e/02')],
        work: [
          work('x1', '10:10', '10:20'),
          work('y1', '10:10', '10:20', { ticket: 'e/02', name: 'impl-02' }),
          // e/01's second stretch starts first after the cause, but the cause names e/02.
          work('x2', '10:40', '10:50'),
          work('y2', '10:45', '10:55', { ticket: 'e/02', name: 'impl-02' }),
        ],
        retryCauses: [{ ticket: 'e/02', kind: 'agent', at: T('10:30'), reason: 'narrow-round: e/02', source: 'journal' }],
      }),
    )
    expect([byId(timeline, 'agent:y2').reason, byId(timeline, 'agent:x2').reason]).toEqual(['narrow-round: e/02', 'after impl-01'])
  })

  it('take the cause the source names, under another name too', () => {
    const named = buildTimeline(
      facts({
        ticketEvents: [claimed('10:05')],
        work: [
          work('a1', '10:10', '10:20', { outcome: 'failed', reason: 'Session died' }),
          work('v', '10:21', '10:24', { name: 'verify-01', outcome: 'failed', reason: 'crashed' }),
          work('a2', '10:25', '10:50', { name: 'impl-01-r', retryOf: { kind: 'agent', id: 'a1' } }),
        ],
      }),
    )
    const restart = byId(named, 'agent:a2')
    expect([restart.attempt, restart.retryOf]).toEqual([2, 'agent:a1'])
  })

  it('attach a cause of the Journal to the next attempt: session-error without a Ticket, narrow-round with one', () => {
    const journal = buildTimeline(
      facts({
        ticketEvents: [claimed('10:05')],
        work: [work('a1', '10:10', '10:20', { outcome: 'failed', reason: 'Session died' }), work('a2', '10:25', '10:50', { name: 'impl-01-r' }), work('v1', '10:55', '11:00', { name: 'verify-01', agentType: 'worfy:reviewer' }), work('a3', '11:05', '11:20')],
        retryCauses: [
          { ticket: null, kind: 'agent', at: T('10:21'), reason: 'session-error: Session died', source: 'journal' },
          { ticket: 'e/01', kind: 'agent', at: T('11:01'), reason: 'narrow-round: started', source: 'journal' },
        ],
      }),
    )
    const restart = byId(journal, 'agent:a2')
    expect([restart.attempt, restart.retryOf, restart.reason]).toEqual([2, 'agent:a1', 'session-error: Session died'])
    expect(byId(journal, 'agent:v1').attempt).toBe(1)
    const narrow = byId(journal, 'agent:a3')
    expect([narrow.attempt, narrow.reason]).toEqual([2, 'narrow-round: started'])
  })

  it('always carry a reason on a Wait, a retry and every outcome but ok', () => {
    const needing = timeline.spans.filter((span) => span.kind === 'wait' || span.attempt > 1 || (span.outcome !== null && span.outcome !== 'ok'))
    expect(needing.length).toBeGreaterThanOrEqual(10)
    for (const span of needing) expect([span.id, typeof span.reason === 'string' && span.reason.length > 0]).toEqual([span.id, true])
    const bare = buildTimeline(facts({ work: [work('f', '10:10', '10:20', { outcome: 'failed' })] }))
    expect(one(bare, (span) => span.kind === 'agent').reason).toBe(NO_REASON)
    expect(one(timeline, (span) => span.kind === 'wait').reason).toBe('limits')
  })
})

describe('gate runs and their steps', () => {
  it('find their Ticket by sha or worktree, hang their steps off them, and leave out runs of no Ticket', () => {
    const timeline = buildTimeline(
      facts({
        waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/01', 'e/02'] }],
        ticketEvents: [claimed('10:05'), prOpened('10:50', 's1'), claimed('10:05', 'e/02')],
        work: [
          work('i2', '10:10', '10:40', { ticket: 'e/02', name: 'impl-02', worktree: 'wt/fr-02' }),
          { id: 'g1', kind: 'gate', name: 'gate', sha: 's1', start: T('11:00'), end: T('11:10'), startSource: 'gate-log', endSource: 'gate-log' },
          { id: 'g1-lint', kind: 'script', name: 'lint', parentWork: { kind: 'gate', id: 'g1' }, start: T('11:01'), end: T('11:03'), startSource: 'gate-log', endSource: 'gate-log' },
          { id: 'g2', kind: 'gate', name: 'gate', worktree: 'wt/fr-02', start: T('10:41'), end: T('10:45'), startSource: 'gate-log', endSource: 'gate-log' },
          { id: 'g3', kind: 'gate', name: 'gate', sha: 'unknown', worktree: 'wt/other', start: T('10:41'), end: T('10:45'), startSource: 'gate-log', endSource: 'gate-log' },
        ],
      }),
    )
    expect(byId(timeline, 'gate:g1').links.ticket).toBe('e/01')
    expect(byId(timeline, 'script:g1-lint')).toMatchObject({ parent: 'gate:g1', links: { ticket: 'e/01' } })
    expect(byId(timeline, 'gate:g2').links.ticket).toBe('e/02')
    expect(timeline.spans.some((span) => span.id === 'gate:g3')).toBe(false)
  })
})

describe('work from before the Run', () => {
  it('is left out: a gate run of an older worktree at the same path, work over before its Ticket row began', () => {
    const timeline = buildTimeline(
      facts({
        waves: [
          { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01'] },
          { number: 2, startedAt: T('12:00'), finishedAt: T('14:00'), tickets: ['e/02'] },
        ],
        ticketEvents: [claimed('10:05'), claimed('12:05', 'e/02')],
        work: [
          work('i1', '10:10', '10:40', { worktree: 'wt/01' }),
          work('i2', '12:10', '12:40', { ticket: 'e/02', name: 'impl-02', worktree: 'wt/02' }),
          // Five days before the Run, from the same worktree path, with a sha of no Ticket.
          { id: 'old', kind: 'gate', name: 'gate', sha: 'gone', worktree: 'wt/01', start: '2026-10-12T10:00:00.000Z', end: '2026-10-12T10:10:00.000Z', startSource: 'gate-log', endSource: 'gate-log' },
          { id: 'now', kind: 'gate', name: 'gate', worktree: 'wt/01', start: T('10:41'), end: T('10:50'), startSource: 'gate-log', endSource: 'gate-log' },
          // Over in Wave 1, while e/02 has its row only in Wave 2.
          { id: 'early', kind: 'gate', name: 'gate', worktree: 'wt/02', start: T('10:30'), end: T('10:45'), startSource: 'gate-log', endSource: 'gate-log' },
          { id: 'before-run', kind: 'agent', ticket: null, name: 'helper', start: '2026-10-16T10:00:00.000Z', end: '2026-10-16T11:00:00.000Z', startSource: 'transcript', endSource: 'transcript' },
        ],
      }),
    )
    const gates = timeline.spans.filter((span) => span.kind === 'gate').map((span) => span.id)
    expect(gates).toEqual(['gate:now'])
    expect(timeline.spans.some((span) => span.id === 'agent:before-run')).toBe(false)
  })
})

describe('Waits', () => {
  it('link the Tickets that stood: given, else of the Wave open at the start, else of the Wave that waited', () => {
    const timeline = buildTimeline(
      facts({
        waves: [
          { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01', 'e/02'] },
          { number: 2, startedAt: T('12:00'), finishedAt: T('13:00'), tickets: ['e/03'] },
        ],
        waits: [
          { id: 'in', cause: 'limits', start: T('10:30'), end: T('10:40'), startSource: 'journal', endSource: 'journal' },
          { id: 'between', cause: 'limits-budget', start: T('11:10'), end: T('11:50'), startSource: 'journal', endSource: 'journal' },
          { id: 'given', cause: 'other-machine', start: T('12:10'), end: T('12:20'), tickets: ['e/01'], detail: 'pc', startSource: 'github', endSource: 'github' },
        ],
      }),
    )
    expect(all(timeline, (span) => span.kind === 'wait').map((span) => [span.id, span.links.tickets, span.reason])).toEqual([
      ['wait:in', ['e/01', 'e/02'], 'limits'],
      ['wait:between', ['e/03'], 'limits-budget'],
      ['wait:given', ['e/01'], 'other-machine: pc'],
    ])
  })
})

describe('blocks', () => {
  it('are a mark with Blocked reason and Waits up to the clearing, not a span', () => {
    const without = buildTimeline(facts({ ticketEvents: [claimed('10:05')] }))
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), blocked('11:00'), blocked('11:10'), claimed('11:30')] }))
    // The same block said twice is one mark.
    expect(timeline.blocks).toEqual([{ ticket: 'e/01', at: at('11:00'), until: at('11:30'), reason: 'needs the owner', waits: 'owner', cleared: true, source: 'journal' }])
    expect(timeline.spans.map((span) => span.id)).toEqual(without.spans.map((span) => span.id))
    expect(timeline.spans.some((span) => span.outcome === 'blocked')).toBe(false)
  })

  it('hatch the row to the end of the Run when never cleared, and the Ticket ends blocked', () => {
    // Computed two hours after the stop: the hatch still ends with the Run.
    const timeline = buildTimeline(facts({ now: T('16:00'), ticketEvents: [claimed('10:05'), blocked('11:00')] }))
    expect(timeline.blocks.map((mark) => [mark.until, mark.cleared])).toEqual([[at('14:00'), false]])
    expect([ticketOf(timeline).outcome, ticketOf(timeline).reason]).toEqual(['blocked', 'needs the owner'])
  })

  it('cleared after the Run ended held to its end', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [claimed('10:05'), blocked('11:00'), claimed('18:00')] }))
    expect(timeline.blocks.map((mark) => [mark.until, mark.cleared])).toEqual([[at('14:00'), false]])
    expect(ticketOf(timeline).outcome).toBe('blocked')
  })

  it('that begins after the Ticket row ended does not make the Ticket blocked', () => {
    const timeline = buildTimeline(facts({ waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('12:00'), tickets: ['e/01'] }], ticketEvents: [claimed('10:05'), blocked('13:00')] }))
    expect(timeline.blocks).toHaveLength(1)
    expect(ticketOf(timeline).outcome).toBe('stopped')
  })

  it('hatch the row up to now while the Run is live', () => {
    const live = buildTimeline(facts({ run: liveRun, now: T('12:00'), waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }], ticketEvents: [blocked('11:00')] }))
    expect(live.blocks.map((mark) => mark.until)).toEqual([at('12:00')])
  })

  it('of a Ticket the Journal does not know are dropped', () => {
    expect(buildTimeline(facts({ ticketEvents: [blocked('11:00', 'x', 'e/99')] })).blocks).toEqual([])
  })
})

describe('the end of the Run', () => {
  it('limits the Ticket: done after the Run is not done within it', () => {
    const timeline = buildTimeline(facts({ waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('13:00'), tickets: ['e/01'] }], ticketEvents: [claimed('10:05'), merge('15:00'), done('18:00')] }))
    expect([ticketOf(timeline).outcome, ticketOf(timeline).end]).toEqual(['stopped', at('13:00')])
    expect(stages(timeline).map((span) => span.name)).toEqual(['Queued', 'Implementing'])
  })
})

describe('what comes after the Run', () => {
  it('is left out: work, Waits, turns and Orchestrator marks', () => {
    const timeline = buildTimeline(
      facts({
        work: [work('late', '15:00', '15:10')],
        waits: [{ id: 'late', cause: 'limits', start: T('15:00'), end: T('15:30'), startSource: 'journal', endSource: 'journal' }],
        turns: [{ id: 'late', start: T('15:00'), end: T('15:01'), tickets: [], startSource: 'transcript', endSource: 'transcript' }],
        orchestratorMarks: [
          { kind: 'human-input', at: T('15:00'), text: 'late' },
          { kind: 'human-input', at: T('11:00'), text: 'second' },
          { kind: 'refused-dialog', at: T('10:30'), text: 'first' },
        ],
      }),
    )
    expect(timeline.spans.some((span) => span.id.endsWith(':late'))).toBe(false)
    expect(timeline.orchestratorMarks).toEqual([
      { kind: 'refused-dialog', at: at('10:30'), text: 'first' },
      { kind: 'human-input', at: at('11:00'), text: 'second' },
    ])
  })
})

describe('spans with no end', () => {
  const open = {
    ticketEvents: [claimed('10:05')],
    work: [work('a', '10:10', null, { lastSeenAt: T('10:55') }), work('b', '10:20', null, { name: 'helper', lastSeenAt: T('10:15') })],
    waits: [{ id: 'w', cause: 'background-tasks' as const, start: T('11:00'), end: null, lastSeenAt: T('11:10'), startSource: 'journal' as const }],
    turns: [{ id: 't', start: T('10:00'), end: null, tickets: ['e/01'], startSource: 'transcript' as const }],
  }

  it('end at the last event about them, cut-off, once the Run is stopped', () => {
    const timeline = buildTimeline(
      facts({
        ...open,
        run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('12:00'), live: false, outcome: 'stopped', reason: 'user-stop' },
        waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, lastSeenAt: T('11:50'), tickets: ['e/01'] }],
      }),
    )
    const agent = byId(timeline, 'agent:a')
    expect([agent.end, agent.until, agent.outcome, agent.reason, agent.endSource]).toEqual([at('10:55'), at('10:55'), 'cut-off', NO_END_REASON, null])
    // A last event before the start does not end it before it began.
    expect(byId(timeline, 'agent:b').end).toBe(at('10:20'))
    const wait = one(timeline, (span) => span.kind === 'wait')
    expect([wait.end, wait.outcome, wait.reason]).toEqual([at('11:10'), 'cut-off', 'background-tasks'])
    expect(one(timeline, (span) => span.kind === 'orchestrator-turn').end).toBe(at('10:00'))
    const wave = one(timeline, (span) => span.kind === 'wave')
    expect([wave.end, wave.outcome]).toEqual([at('11:50'), 'cut-off'])
    expect([ticketOf(timeline).end, ticketOf(timeline).outcome]).toEqual([at('11:50'), 'cut-off'])
    const run = one(timeline, (span) => span.kind === 'run')
    expect([run.end, run.outcome, run.reason]).toEqual([at('12:00'), 'stopped', 'user-stop'])
  })

  it('end a Wave with no finish and no last event with the Run', () => {
    const timeline = buildTimeline(facts({ waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }] }))
    const wave = one(timeline, (span) => span.kind === 'wave')
    expect([wave.end, wave.outcome]).toEqual([at('14:00'), 'cut-off'])
  })

  it('stretch to now and have no outcome while the Run is live', () => {
    const timeline = buildTimeline(facts({ ...open, run: liveRun, now: T('12:00'), waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }] }))
    expect(timeline.live).toBe(true)
    for (const kind of ['run', 'wave', 'ticket', 'wait', 'orchestrator-turn'] as const) {
      const span = one(timeline, (item) => item.kind === kind)
      expect([kind, span.end, span.until, span.outcome]).toEqual([kind, null, at('12:00'), null])
    }
    expect([byId(timeline, 'agent:a').end, byId(timeline, 'agent:a').until]).toEqual([null, at('12:00')])
    const implementing = one(timeline, (span) => span.kind === 'stage' && span.name === 'Implementing')
    expect([implementing.end, implementing.until, implementing.outcome]).toEqual([null, at('12:00'), null])
  })

  it('keep a Ticket between Waves of a live Run open up to now, with no outcome', () => {
    const timeline = buildTimeline(facts({ run: liveRun, now: T('12:30'), waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01'] }], ticketEvents: [claimed('10:05')] }))
    const ticket = ticketOf(timeline)
    expect([ticket.end, ticket.until, ticket.outcome, ticket.reason, ticket.segments]).toEqual([null, at('12:30'), null, null, [{ start: at('10:00'), end: at('11:00'), wave: 1 }]])
    const implementing = one(timeline, (span) => span.name === 'Implementing')
    expect([implementing.end, implementing.outcome]).toEqual([null, null])
  })

  it('cut a Run that stopped without run-stopped at its last event', () => {
    const timeline = buildTimeline(facts({ run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: null, live: false, lastSeenAt: T('13:00') }, waves: [] }))
    const run = one(timeline, (span) => span.kind === 'run')
    expect([run.end, run.outcome]).toEqual([at('13:00'), 'cut-off'])
  })
})

describe('lost sources', () => {
  it('label a span the Journal knows of whose details are gone, with the four labels', () => {
    expect(LOST_SOURCE_LABELS).toEqual({
      'transcript-deleted': 'transcript deleted',
      'gate-logs-deleted': 'gate logs deleted (10 runs or 8 days)',
      'github-no-answer': 'GitHub did not answer',
      'branch-deleted': 'branch deleted',
    })
    const timeline = buildTimeline(
      facts({
        waves: [
          { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01'] },
          { number: 2, startedAt: T('12:00'), finishedAt: T('13:00'), tickets: ['e/01'] },
        ],
        lost: [
          { ticket: 'e/01', kind: 'agent', name: 'implementer', source: 'transcript-deleted' },
          { ticket: 'e/01', kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: T('12:10'), end: T('12:20') },
          { ticket: 'e/01', kind: 'ci', name: 'PR and CI', source: 'github-no-answer' },
          { ticket: 'e/01', kind: 'script', name: 'gate: VERIFIED', source: 'branch-deleted' },
          { ticket: null, kind: 'orchestrator-turn', name: 'Orchestrator', source: 'transcript-deleted' },
        ],
      }),
    )
    const lost = all(timeline, (span) => span.lost !== null)
    expect(lost.map((span) => [span.kind, span.lost, span.lane])).toEqual([
      ['agent', 'transcript-deleted', 'tree'],
      ['gate', 'gate-logs-deleted', 'tree'],
      ['ci', 'github-no-answer', 'tree'],
      ['script', 'branch-deleted', 'tree'],
      ['orchestrator-turn', 'transcript-deleted', 'orchestrator'],
    ])
    const ticket = ticketOf(timeline)
    // With no times of its own it covers its Ticket's row, gap and all, and in a stopped Run it ends.
    const implementer = lost[0] as Span
    expect([implementer.parent, implementer.segments, implementer.end]).toEqual([ticket.id, ticket.segments, ticket.until])
    expect([lost[1]?.start, lost[1]?.end]).toEqual([at('12:10'), at('12:20')])
    expect(lost[4]?.end).toBe(at('14:00'))
    expect(lost.every((span) => span.outcome === null)).toBe(true)
  })

  it('without a Ticket cover every Ticket of the Run that has no span of that kind', () => {
    const timeline = buildTimeline(
      facts({
        waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/01', 'e/02'] }],
        work: [work('c', '10:10', '10:20', { kind: 'ci', name: 'ci' })],
        lost: [{ ticket: null, kind: 'ci', name: 'PR and CI', source: 'github-no-answer' }],
      }),
    )
    expect(all(timeline, (span) => span.lost !== null).map((span) => span.links.ticket)).toEqual(['e/02'])
  })

  it('stay unfinished in a live Run while their Ticket is', () => {
    const timeline = buildTimeline(facts({ run: liveRun, now: T('12:00'), waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }], lost: [{ ticket: 'e/01', kind: 'agent', name: 'implementer', source: 'transcript-deleted' }] }))
    const lost = one(timeline, (span) => span.lost !== null)
    expect([lost.end, lost.until]).toEqual([null, at('12:00')])
  })

  it('leave out a step the Journal is silent about too: no span without a trace', () => {
    const timeline = buildTimeline(
      facts({
        lost: [
          { ticket: 'e/99', kind: 'agent', name: 'implementer', source: 'transcript-deleted' },
          { kind: 'gate', name: 'gate', sha: 'unknown', source: 'gate-logs-deleted' },
        ],
        work: [work('ghost', '10:10', '10:20', { ticket: 'e/99' })],
        ticketEvents: [claimed('10:05', 'e/99')],
      }),
    )
    expect(timeline.spans.some((span) => span.links.ticket === 'e/99' || span.name === 'e/99' || span.lost !== null)).toBe(false)
    expect(timeline.spans.some((span) => span.kind === 'agent')).toBe(false)
  })
})

describe('the module', () => {
  it('imports neither Node nor the DOM', () => {
    const builtins = new Set(builtinModules)
    for (const file of ['facts.ts', 'spans.ts', 'summary.ts']) {
      const text = readFileSync(join(import.meta.dirname, '../../src/shared/flight-recorder', file), 'utf8')
      const sources = [...text.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gmu)].map((match) => match[1] ?? '')
      expect(sources.length).toBeGreaterThan(0)
      for (const source of sources) {
        expect([file, source, source.startsWith('node:') || builtins.has(source.split('/')[0] ?? '') || source.startsWith('electron')]).toEqual([file, source, false])
        expect([file, source, source.startsWith('./') || ['../workflow/pipeline', '../workflow/types', '../agent/subagent-type'].includes(source)]).toEqual([file, source, true])
      }
      expect([file, /\bimport\s*\(|\brequire\s*\(/u.test(text)]).toEqual([file, false])
      expect([file, /\b(?:window|document|navigator|localStorage|HTMLElement|process|fetch|XMLHttpRequest|WebSocket)\s*[.(]/u.test(text)]).toEqual([file, false])
    }
  })
})
