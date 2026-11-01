// The span model of Flight Recorder (src/shared/flight-recorder/spans.ts; worfy-flight-recorder
// ticket 12, decision 03): the kinds and fields of a span, the tree built from facts (a Ticket in
// two Waves is one row with two parts; the Orchestrator's turns on a lane of their own), the Stage
// boundaries by source events and the joined Stages where a source has none, retries `#N` with the
// span that caused them, blocks as marks, cut-off spans against live ones, the labels of lost
// sources — and that the module imports neither Node nor the DOM.
// The facts are literals, no source is read.
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import {
  agentSubkind,
  AGENT_SUBKINDS,
  buildTimeline,
  childrenOf,
  LOST_SOURCE_LABELS,
  NO_BOUNDARY_NOTE,
  NO_END_REASON,
  SPAN_KINDS,
  SPAN_OUTCOMES,
  WAIT_CAUSES,
  WAVE_FINISHED_REASON,
  type RunFacts,
  type Span,
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
    waits: [],
    blocks: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

const event = (hhmm: string, kind: StageEventFact['event'], more: Partial<StageEventFact> = {}): StageEventFact => ({
  ticket: 'e/01',
  event: kind,
  at: T(hhmm),
  source: kind === 'claim' || kind === 'done' ? 'journal' : 'github',
  ...more,
})

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
const stages = (timeline: Timeline): Span[] => all(timeline, (span) => span.kind === 'stage')

describe('the vocabulary', () => {
  it('has the fixed kinds, outcomes, subkinds and Wait causes of the spec', () => {
    expect(SPAN_KINDS).toEqual(['run', 'wave', 'ticket', 'stage', 'agent', 'ci', 'gate', 'script', 'wait', 'orchestrator-turn'])
    expect(SPAN_OUTCOMES).toEqual(['ok', 'failed', 'rejected', 'blocked', 'stopped', 'cut-off'])
    expect(AGENT_SUBKINDS).toEqual(['implementer', 'verifier', 'other'])
    expect(WAIT_CAUSES).toEqual(['limits', 'limits-budget', 'background-tasks', 'gate-queue', 'other-machine'])
  })

  it('tells an agent subkind by its type, else its name', () => {
    expect(agentSubkind('anything', 'worfy:implementer')).toBe('implementer')
    expect(agentSubkind('anything', 'worfy:reviewer')).toBe('verifier')
    expect(agentSubkind('impl-12')).toBe('implementer')
    expect(agentSubkind('verify-g12-claims')).toBe('verifier')
    expect(agentSubkind('review-12')).toBe('verifier')
    expect(agentSubkind('scout-flight-recorder', 'worfy:scout')).toBe('other')
    expect(agentSubkind('helper')).toBe('other')
  })

  it('gives every span the fields of decision 03, Q6', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim')], work: [work('a', '10:10', '10:20', { session: 's-1', agent: 'a-1', pr: 7, sha: 'abc', verdict: 'VERIFIED' })] }))
    const agent = one(timeline, (span) => span.kind === 'agent')
    expect(agent).toMatchObject({
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
      ticketEvents: [event('10:10', 'claim'), event('12:30', 'pr-opened')],
      work: [work('a', '10:15', '10:45'), work('b', '12:05', '12:25', { name: 'helper', agentType: 'Explore' })],
      turns: [
        { id: 't1', start: T('10:00'), end: T('10:02'), tickets: ['e/01', 'e/02'], startSource: 'transcript', endSource: 'transcript' },
        { id: 't2', start: T('12:00'), end: T('12:01'), tickets: ['e/01'], startSource: 'transcript', endSource: 'transcript' },
      ],
    }),
  )

  it('makes one row for a Ticket in two Waves, with a part per Wave and the gap between them', () => {
    const ticket = one(timeline, (span) => span.kind === 'ticket' && span.name === 'e/01')
    expect(ticket.segments).toEqual([
      { start: at('10:00'), end: at('11:00'), wave: 1 },
      { start: at('12:00'), end: at('13:00'), wave: 2 },
    ])
    expect(ticket.links.waves).toEqual([1, 2])
    expect(ticket.parent).toBe('run')
    // A Stage that goes on across the gap has the same two-part shape: Implementing 10:10–12:30.
    const implementing = one(timeline, (span) => span.kind === 'stage' && span.links.ticket === 'e/01' && span.stages[0] === 'implementing')
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
    const ticket = one(timeline, (span) => span.name === 'e/01')
    expect(childrenOf(timeline, ticket).map((span) => span.name)).toEqual(['Queued', 'Implementing', 'CI'])
    const implementing = one(timeline, (span) => span.links.ticket === 'e/01' && span.name === 'Implementing')
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
    const ticketIds = new Set(all(timeline, (span) => span.kind === 'ticket' || span.kind === 'stage').map((span) => span.id))
    expect(turns.some((span) => span.parent !== null && ticketIds.has(span.parent))).toBe(false)
  })

  it('ends a Ticket the last Wave finished without it as stopped, with a reason', () => {
    const ticket = one(timeline, (span) => span.name === 'e/02')
    expect(ticket.segments).toHaveLength(1)
    expect([ticket.outcome, ticket.reason]).toEqual(['stopped', WAVE_FINISHED_REASON])
  })
})

describe('Stages', () => {
  it('take each boundary from a source event: claim, PR, CI, verdict, merge, done', () => {
    const timeline = buildTimeline(
      facts({
        ticketEvents: [
          // Out of order on purpose: the model sorts.
          event('11:30', 'merge'),
          event('10:05', 'claim'),
          event('10:50', 'pr-opened', { pr: 7 }),
          event('10:51', 'ci-started'),
          event('11:00', 'ci-finished'),
          event('11:20', 'mark', { mark: 'review', verdict: 'success' }),
          event('11:40', 'done'),
        ],
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
    const ticket = one(timeline, (span) => span.kind === 'ticket')
    expect([ticket.end, ticket.outcome]).toEqual([at('11:40'), 'ok'])
  })

  it('join neighbouring Stages with no boundary event into one span named after both, with the note', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim'), event('11:00', 'ci-finished'), event('11:20', 'mark', { mark: 'review', verdict: 'success' })] }))
    const joined = one(timeline, (span) => span.kind === 'stage' && span.note !== null)
    expect([joined.name, joined.stages, joined.note, joined.start, joined.end]).toEqual(['Implementing + CI', ['implementing', 'ci'], NO_BOUNDARY_NOTE, at('10:05'), at('11:00')])
    expect(NO_BOUNDARY_NOTE).toBe('no boundary in sources')
    // ci-started is a boundary of its own when the PR event is missing.
    const withCi = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim'), event('10:50', 'ci-started'), event('11:00', 'ci-finished')] }))
    expect(stages(withCi).map((span) => span.name)).toEqual(['Queued', 'Implementing', 'CI', 'Agent review'])
  })

  it('follow the Profile Pipeline: a Check Stage passes on its own mark', () => {
    const pipeline = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'ci' }, { kind: 'agent-review' }, { kind: 'check', name: 'windows' }, { kind: 'gate-merge' }, { kind: 'closing' }, { kind: 'done' }] as const
    const timeline = buildTimeline(
      facts({
        pipeline,
        ticketEvents: [
          event('10:05', 'claim'),
          event('10:50', 'pr-opened'),
          event('11:00', 'ci-finished'),
          event('11:20', 'mark', { mark: 'review', verdict: 'success' }),
          event('12:00', 'mark', { mark: 'check/windows', verdict: 'success' }),
        ],
      }),
    )
    expect(stages(timeline).map((span) => [span.name, span.end])).toEqual([
      ['Queued', at('10:05')],
      ['Implementing', at('10:50')],
      ['CI', at('11:00')],
      ['Agent review', at('11:20')],
      ['Check «windows»', at('12:00')],
      ['Gate & merge', at('14:00')],
    ])
  })
})

describe('retries', () => {
  // A REJECTED verdict sends the Ticket back: the implementer's second stretch is #2, caused by the
  // verifier's REJECTED span; the CI run after it is #2 of `ci`, after the failed first one.
  const timeline = buildTimeline(
    facts({
      ticketEvents: [
        event('10:05', 'claim'),
        event('10:40', 'pr-opened'),
        event('10:50', 'ci-finished'),
        event('11:10', 'mark', { mark: 'review', verdict: 'failure', reason: 'REJECTED: missing test' }),
        event('11:40', 'pr-opened'),
        event('11:50', 'ci-finished'),
        event('12:10', 'mark', { mark: 'review', verdict: 'success' }),
      ],
      work: [
        work('impl-1', '10:06', '10:40'),
        work('ci-1', '10:40', '10:50', { kind: 'ci', name: 'ci', agentType: undefined, outcome: 'failed', reason: 'unit shard 2 red', startSource: 'github', endSource: 'github' }),
        work('verify-1', '10:52', '11:10', { name: 'verify-01', agentType: 'worfy:reviewer', outcome: 'rejected', reason: 'REJECTED: missing test' }),
        work('impl-2', '11:12', '11:40'),
        work('ci-2', '11:40', '11:50', { kind: 'ci', name: 'ci', agentType: undefined, startSource: 'github', endSource: 'github' }),
        work('verify-2', '11:52', '12:10', { name: 'verify-01', agentType: 'worfy:reviewer' }),
      ],
      waits: [{ id: 'w', cause: 'limits', start: T('12:20'), end: T('12:40'), startSource: 'journal', endSource: 'journal' }],
    }),
  )
  const byId = (id: string): Span => one(timeline, (span) => span.id === id)

  it('number the second span of the same agent #2 and link it to the REJECTED span', () => {
    const second = byId('agent:impl-2')
    expect([second.attempt, second.retryOf]).toEqual([2, 'agent:verify-1'])
    expect(second.reason).toContain('verify-01')
    expect(byId('agent:impl-1').attempt).toBe(1)
    // The second Implementing Stage is #2 as well, after the rejected Agent review.
    const implementing = all(timeline, (span) => span.kind === 'stage' && span.stages[0] === 'implementing')
    expect(implementing.map((span) => span.attempt)).toEqual([1, 2])
    const rejectedReview = one(timeline, (span) => span.kind === 'stage' && span.outcome === 'rejected')
    expect([rejectedReview.name, rejectedReview.reason]).toEqual(['Agent review', 'REJECTED: missing test'])
    expect(implementing[1]?.retryOf).toBe(rejectedReview.id)
    // The second Implementing hangs the second implementer.
    expect(second.parent).toBe(implementing[1]?.id)
  })

  it('number a repeated CI run #2 of ci', () => {
    const rerun = byId('ci:ci-2')
    expect([rerun.kind, rerun.attempt]).toEqual(['ci', 2])
    expect(rerun.retryOf).not.toBeNull()
    expect(byId('agent:verify-2').attempt).toBe(2)
  })

  it('link a retry to the previous attempt when nothing failed before it', () => {
    const plain = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim')], work: [work('x', '10:10', '10:20', { kind: 'ci', name: 'ci' }), work('y', '10:30', '10:40', { kind: 'ci', name: 'ci' })] }))
    const rerun = one(plain, (span) => span.id === 'ci:y')
    expect([rerun.attempt, rerun.retryOf]).toEqual([2, 'ci:x'])
    expect(rerun.reason).toBe('after ci')
  })

  it('take the cause the source names over the guess', () => {
    const named = buildTimeline(
      facts({
        ticketEvents: [event('10:05', 'claim')],
        work: [work('a', '10:06', '10:20'), work('v', '10:21', '10:30', { name: 'verify-01', outcome: 'failed', reason: 'crashed' }), work('b', '10:31', '10:50', { retryOf: 'a', reason: 'narrow-round' })],
      }),
    )
    expect([one(named, (span) => span.id === 'agent:b').retryOf, one(named, (span) => span.id === 'agent:b').reason]).toEqual(['agent:a', 'narrow-round'])
  })

  it('always carry a reason on a Wait, a retry and every outcome but ok', () => {
    const needing = timeline.spans.filter((span) => span.kind === 'wait' || span.attempt > 1 || (span.outcome !== null && span.outcome !== 'ok'))
    expect(needing.length).toBeGreaterThanOrEqual(8)
    for (const span of needing) expect([span.id, typeof span.reason === 'string' && span.reason.length > 0]).toEqual([span.id, true])
    // A failure the source gives no reason for still gets one.
    const bare = buildTimeline(facts({ work: [work('f', '10:10', '10:20', { outcome: 'failed' })] }))
    expect(one(bare, (span) => span.kind === 'agent').reason).toBe('no reason in sources')
    expect(one(timeline, (span) => span.kind === 'wait').reason).toBe('limits')
  })
})

describe('blocks', () => {
  const block = { ticket: 'e/01', at: T('11:00'), reason: 'needs the owner', waits: 'owner', source: 'journal' as const }

  it('are a mark with Blocked reason and Waits up to the clearing, not a span', () => {
    const without = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim')] }))
    const timeline = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim')], blocks: [{ ...block, clearedAt: T('11:30') }] }))
    expect(timeline.blocks).toEqual([{ ticket: 'e/01', at: at('11:00'), until: at('11:30'), reason: 'needs the owner', waits: 'owner', cleared: true, source: 'journal' }])
    expect(timeline.spans.map((span) => span.id)).toEqual(without.spans.map((span) => span.id))
    expect(timeline.spans.some((span) => span.outcome === 'blocked')).toBe(false)
  })

  it('hatch the row to the end of the Run when never cleared, and the Ticket ends blocked', () => {
    const timeline = buildTimeline(facts({ ticketEvents: [event('10:05', 'claim')], blocks: [{ ...block, clearedAt: null }] }))
    expect(timeline.blocks.map((mark) => [mark.until, mark.cleared])).toEqual([[at('14:00'), false]])
    const ticket = one(timeline, (span) => span.kind === 'ticket')
    expect([ticket.outcome, ticket.reason]).toEqual(['blocked', 'needs the owner'])
  })

  it('hatch the row up to now while the Run is live', () => {
    const live = buildTimeline(
      facts({
        run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: null, live: true },
        now: T('12:00'),
        waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }],
        blocks: [{ ...block, clearedAt: null }],
      }),
    )
    expect(live.blocks.map((mark) => mark.until)).toEqual([at('12:00')])
  })

  it('of a Ticket the Journal does not know are dropped', () => {
    expect(buildTimeline(facts({ blocks: [{ ...block, ticket: 'e/99', clearedAt: null }] })).blocks).toEqual([])
  })
})

describe('spans with no end', () => {
  const open = {
    ticketEvents: [event('10:05', 'claim')],
    work: [work('a', '10:10', null, { lastSeenAt: T('10:55') })],
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
    const agent = one(timeline, (span) => span.kind === 'agent')
    expect([agent.end, agent.until, agent.outcome, agent.reason, agent.endSource]).toEqual([at('10:55'), at('10:55'), 'cut-off', NO_END_REASON, null])
    const wait = one(timeline, (span) => span.kind === 'wait')
    expect([wait.end, wait.outcome, wait.reason]).toEqual([at('11:10'), 'cut-off', 'background-tasks'])
    // With no later event than its start, a span is cut at its start.
    expect(one(timeline, (span) => span.kind === 'orchestrator-turn').end).toBe(at('10:00'))
    const wave = one(timeline, (span) => span.kind === 'wave')
    expect([wave.end, wave.outcome]).toEqual([at('11:50'), 'cut-off'])
    const ticket = one(timeline, (span) => span.kind === 'ticket')
    expect([ticket.end, ticket.outcome]).toEqual([at('11:50'), 'cut-off'])
    const run = one(timeline, (span) => span.kind === 'run')
    expect([run.end, run.outcome, run.reason]).toEqual([at('12:00'), 'stopped', 'user-stop'])
  })

  it('stretch to now and have no outcome while the Run is live', () => {
    const timeline = buildTimeline(
      facts({
        ...open,
        run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: null, live: true },
        now: T('12:00'),
        waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }],
      }),
    )
    expect(timeline.live).toBe(true)
    for (const kind of ['run', 'wave', 'ticket', 'agent', 'wait', 'orchestrator-turn'] as const) {
      const span = one(timeline, (item) => item.kind === kind)
      expect([kind, span.end, span.until, span.outcome]).toEqual([kind, null, at('12:00'), null])
    }
    const implementing = one(timeline, (span) => span.kind === 'stage' && span.name === 'Implementing')
    expect([implementing.end, implementing.until, implementing.outcome]).toEqual([null, at('12:00'), null])
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
    const ticket = one(timeline, (span) => span.kind === 'ticket')
    // With no times of its own it covers its Ticket's row, gap and all.
    const implementer = lost[0] as Span
    expect([implementer.parent, implementer.segments]).toEqual([ticket.id, ticket.segments])
    expect([lost[1]?.start, lost[1]?.until]).toEqual([at('12:10'), at('12:20')])
    expect(lost.every((span) => span.outcome === null)).toBe(true)
  })

  it('leave out a step the Journal is silent about too: no span without a trace', () => {
    const timeline = buildTimeline(
      facts({
        lost: [{ ticket: 'e/99', kind: 'agent', name: 'implementer', source: 'transcript-deleted' }],
        work: [work('ghost', '10:10', '10:20', { ticket: 'e/99' })],
        ticketEvents: [event('10:05', 'claim', { ticket: 'e/99' })],
      }),
    )
    expect(timeline.spans.some((span) => span.links.ticket === 'e/99' || span.name === 'e/99')).toBe(false)
    // And a Ticket with no facts beyond its Wave has no agent span at all.
    expect(timeline.spans.some((span) => span.kind === 'agent')).toBe(false)
  })
})

describe('the module', () => {
  it('imports neither Node nor the DOM', () => {
    const builtins = new Set(builtinModules)
    for (const file of ['spans.ts', 'summary.ts']) {
      const text = readFileSync(join(import.meta.dirname, '../../src/shared/flight-recorder', file), 'utf8')
      const sources = [...text.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gmu)].map((match) => match[1] ?? '')
      expect(sources.length).toBeGreaterThan(0)
      for (const source of sources) {
        expect([file, source, source.startsWith('node:') || builtins.has(source.split('/')[0] ?? '') || source.startsWith('electron')]).toEqual([file, source, false])
        expect([file, source, source.startsWith('./') || source === '../workflow/pipeline']).toEqual([file, source, true])
      }
      expect([file, /\b(?:window|document|navigator|localStorage|HTMLElement|process|require)\s*[.(]/u.test(text)]).toEqual([file, false])
    }
  })
})
