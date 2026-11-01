// The facts of the transcripts for the span model (src/shared/flight-recorder/from-transcript.ts;
// worfy-flight-recorder ticket 14, decision 03 Q4, decision 04 Q2 and Q6): an agent's span is one
// stretch of active work, from the `Agent` call or a `SendMessage` that resumes it to its report,
// not the life of its Session; a rework through `SendMessage` is the agent's next span, `#2` in the
// model; a message to an agent that still works adds nothing; an agent's error is `failed`; the
// subkind comes from the agent's name and type; the Orchestrator's turns name the Tickets they
// touched. The transcript lines are built here; no file is read.
import { describe, expect, it } from 'vitest'
import { agentIdsIn, transcriptFacts, wavePromptTimes, type SubagentLines } from '../../src/shared/flight-recorder/from-transcript'
import { agentSubkind, buildTimeline, type RunFacts, type WorkFact } from '../../src/shared/flight-recorder/spans'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'

const SESSION = 'orch-1'
const T = (hhmm: string, seconds = '00'): string => `2026-10-17T${hhmm}:${seconds}.000Z`
const CWD = '/Users/someone/repo'

type Json = Record<string, unknown>
const line = (record: Json): string => JSON.stringify({ sessionId: SESSION, cwd: CWD, isSidechain: false, ...record })

const prompt = (at: string, text: string): string => line({ type: 'user', timestamp: at, message: { role: 'user', content: text } })
const say = (at: string, text = 'ok'): string => line({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const toolUse = (at: string, id: string, name: string, input: Json): string =>
  line({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const toolResult = (at: string, id: string, text: string, toolUseResult?: Json, isError = false): string =>
  line({
    type: 'user',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], ...(isError ? { is_error: true } : {}) }] },
    ...(toolUseResult === undefined ? {} : { toolUseResult }),
  })
const notificationText = (agentId: string, toolUseId: string, status = 'completed', summary = 'Agent finished', result?: string): string =>
  `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>${summary}</summary>${result === undefined ? '' : `\n<result>${result}</result>`}\n</task-notification>`
const notification = (at: string, agentId: string, toolUseId: string, status?: string, summary?: string, result?: string): string =>
  prompt(at, notificationText(agentId, toolUseId, status, summary, result))
const queued = (at: string, agentId: string, toolUseId: string): string =>
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: at, sessionId: SESSION, content: notificationText(agentId, toolUseId) })

/** A background `Agent` call and the result that names the agent. */
const launch = (at: string, id: string, agentId: string, input: Json): string[] => [
  toolUse(at, id, 'Agent', { run_in_background: true, prompt: 'go', ...input }),
  toolResult(at, id, 'Async agent launched successfully.', { isAsync: true, status: 'async_launched', agentId }),
]
const send = (at: string, id: string, to: string, resumedAgentId?: string): string[] => [
  toolUse(at, id, 'SendMessage', { to, summary: 'Rework round', message: 'fix it' }),
  toolResult(
    at,
    id,
    resumedAgentId === undefined ? 'queued' : 'resuming',
    resumedAgentId === undefined ? { success: true, message: `Message queued for delivery to ${to} at its next tool round.` } : { success: true, message: `Resuming agent ${to}`, resumedAgentId },
  ),
]

const IMPL = { name: 'impl-05', subagent_type: 'worfy:implementer', description: 'Implement e ticket 05' }
const VERIFY = { name: 'verify-05', subagent_type: 'worfy:reviewer', description: 'Verify e ticket 05 PR' }

const agentLine = (at: string, text: string, cwd = CWD): string =>
  JSON.stringify({ type: 'assistant', timestamp: at, cwd, isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const agentTask = (at: string, cwd = CWD): string => JSON.stringify({ type: 'user', timestamp: at, cwd, isSidechain: true, message: { role: 'user', content: 'task' } })

const facts = (lines: readonly string[], subagents: ReadonlyMap<string, SubagentLines> = new Map(), tickets: readonly string[] = ['e/05', 'e/07']) =>
  transcriptFacts({ session: SESSION, epic: 'e', tickets, lines, subagents })

const agents = (work: readonly WorkFact[]) => work.filter((fact) => fact.kind === 'agent')

function timeline(work: readonly WorkFact[], extra: Partial<RunFacts> = {}) {
  return buildTimeline({
    run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('14:00'), live: false, outcome: 'ok' },
    now: T('14:00'),
    pipeline: DEFAULT_PIPELINE,
    waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/05'] }],
    ticketEvents: [{ ticket: 'e/05', at: T('10:00'), source: 'journal', event: 'status', state: 'claimed' }],
    work,
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...extra,
  })
}

describe('an agent span', () => {
  it('runs from the Agent call of impl-05 to its task-notification: an implementer of Ticket 05', () => {
    const { work } = facts([prompt(T('10:00'), 'go'), ...launch(T('10:01'), 'call-1', 'a5', IMPL), say(T('10:02')), notification(T('10:40'), 'a5', 'call-1')])
    expect(agents(work)).toEqual([
      expect.objectContaining({
        kind: 'agent',
        name: 'impl-05',
        agentType: 'worfy:implementer',
        ticket: 'e/05',
        start: T('10:01'),
        end: T('10:40'),
        agent: 'a5',
        session: SESSION,
        startSource: 'transcript',
        endSource: 'transcript',
      }),
    ])
    expect(agents(work)[0]?.outcome).toBeUndefined()
    expect(agentSubkind(agents(work)[0]!.name, agents(work)[0]!.agentType)).toBe('implementer')
  })

  it('ends at the queued task-notification, and the same notification delivered later changes nothing', () => {
    const { work } = facts([...launch(T('10:01'), 'call-1', 'a5', IMPL), queued(T('10:40'), 'a5', 'call-1'), notification(T('10:41'), 'a5', 'call-1')])
    expect(agents(work).map((fact) => [fact.start, fact.end])).toEqual([[T('10:01'), T('10:40')]])
  })

  it('a SendMessage after the report starts the second span of the agent, #2 with the rejecting verifier as its cause', () => {
    const lines = [
      ...launch(T('10:01'), 'call-1', 'a5', IMPL),
      notification(T('10:40'), 'a5', 'call-1'),
      ...launch(T('10:41'), 'call-2', 'v5', VERIFY),
      notification(T('10:50'), 'v5', 'call-2'),
      ...send(T('11:00'), 'send-1', 'impl-05', 'a5'),
      notification(T('11:30'), 'a5', 'send-1'),
    ]
    const verifier = new Map([['v5', { meta: null, lines: [agentTask(T('10:41')), agentLine(T('10:49'), 'REJECTED\n\n- [med] the test is missing')] }]])
    const { work } = facts(lines, verifier)
    const implementer = agents(work).filter((fact) => fact.name === 'impl-05')
    expect(implementer.map((fact) => [fact.start, fact.end])).toEqual([
      [T('10:01'), T('10:40')],
      [T('11:00'), T('11:30')],
    ])
    expect(new Set(implementer.map((fact) => fact.id)).size).toBe(2)

    const spans = timeline(work).spans.filter((span) => span.kind === 'agent')
    const second = spans.find((span) => span.name === 'impl-05' && span.attempt === 2)
    const rejected = spans.find((span) => span.name === 'verify-05')
    expect(rejected?.outcome).toBe('rejected')
    expect(second?.retryOf).toBe(rejected?.id)
  })

  it('is a stretch of active work: no span between the report and the SendMessage that resumes it', () => {
    const { work } = facts([...launch(T('10:01'), 'call-1', 'a5', IMPL), notification(T('10:40'), 'a5', 'call-1'), ...send(T('12:00'), 'send-1', 'impl-05', 'a5'), notification(T('12:10'), 'a5', 'send-1')])
    const covered = (time: string) => agents(work).some((fact) => fact.start <= time && (fact.end === null || time <= fact.end))
    expect(covered(T('11:00'))).toBe(false)
    expect(covered(T('10:20'))).toBe(true)
    expect(covered(T('12:05'))).toBe(true)
  })

  it('a queued message opens no span even when an earlier agent of that name has reported', () => {
    const { work } = facts([
      ...launch(T('10:01'), 'call-1', 'a5', IMPL),
      notification(T('10:20'), 'a5', 'call-1'),
      ...launch(T('10:30'), 'call-2', 'a5b', IMPL),
      ...send(T('10:40'), 'send-1', 'impl-05'),
      ...send(T('10:50'), 'send-2', 'a5'),
    ])
    expect(agents(work).map((fact) => fact.id)).toEqual(['a5#1', 'a5b#1'])
  })

  it('a message to an agent that still works adds no span', () => {
    const { work } = facts([...launch(T('10:01'), 'call-1', 'a5', IMPL), ...send(T('10:20'), 'send-1', 'impl-05'), notification(T('10:40'), 'a5', 'call-1')])
    expect(agents(work).map((fact) => [fact.start, fact.end])).toEqual([[T('10:01'), T('10:40')]])
  })

  it('an error of the agent is failed: a failed task-notification, a foreground call that errs', () => {
    const { work } = facts([
      ...launch(T('10:01'), 'call-1', 'a5', IMPL),
      notification(T('10:40'), 'a5', 'call-1', 'failed', 'Agent "Implement e ticket 05" failed: API Error'),
      toolUse(T('10:45'), 'call-2', 'Agent', { subagent_type: 'worfy:scout', description: 'Map files' }),
      toolResult(T('10:46'), 'call-2', 'Agent type not found', undefined, true),
    ])
    expect(agents(work).map((fact) => [fact.name, fact.outcome, fact.reason, fact.end])).toEqual([
      ['impl-05', 'failed', 'Agent "Implement e ticket 05" failed: API Error', T('10:40')],
      ['Map files', 'failed', 'Agent type not found', T('10:46')],
    ])
  })

  it('an agent that was killed, or that the user stopped, is stopped', () => {
    const own = new Map([['a7', { meta: { stoppedByUser: true }, lines: [agentTask(T('10:02')), agentLine(T('10:20'), 'halfway')] }]])
    const { work } = facts(
      [
        ...launch(T('10:01'), 'call-1', 'a5', IMPL),
        notification(T('10:30'), 'a5', 'call-1', 'killed', 'Agent was stopped'),
        ...launch(T('10:02'), 'call-2', 'a7', { name: 'impl-07', subagent_type: 'worfy:implementer' }),
      ],
      own,
    )
    expect(agents(work).map((fact) => [fact.name, fact.outcome, fact.end])).toEqual([
      ['impl-05', 'stopped', T('10:30')],
      ['impl-07', 'stopped', T('10:20')],
    ])
  })

  it('a foreground call ends with its result', () => {
    const { work } = facts([
      toolUse(T('10:01'), 'call-1', 'Agent', { subagent_type: 'worfy:scout', description: 'Map ticket 05 files', prompt: 'map' }),
      toolResult(T('10:09'), 'call-1', 'The map', { status: 'completed', agentId: 's1' }),
    ])
    expect(agents(work)).toEqual([expect.objectContaining({ name: 'Map ticket 05 files', start: T('10:01'), end: T('10:09'), agent: 's1', ticket: 'e/05' })])
  })

  it('without a report it stays open, seen last at the last record of its own transcript', () => {
    const own = new Map([['a5', { meta: null, lines: [agentTask(T('10:01')), agentLine(T('10:30'), 'working')] }]])
    const { work } = facts(launch(T('10:01'), 'call-1', 'a5', IMPL), own)
    expect(agents(work)).toEqual([expect.objectContaining({ end: null, lastSeenAt: T('10:30') })])
  })

  it('a restart after a session-error is a new call of impl-05: the model numbers it #2 with the Journal reason', () => {
    const { work } = facts([...launch(T('10:01'), 'call-1', 'a5', IMPL), ...launch(T('11:00'), 'call-2', 'a5b', IMPL), notification(T('11:30'), 'a5b', 'call-2')])
    expect(agents(work).map((fact) => [fact.agent, fact.start, fact.end, fact.outcome])).toEqual([
      ['a5', T('10:01'), T('11:00'), 'cut-off'],
      ['a5b', T('11:00'), T('11:30'), undefined],
    ])
    const spans = timeline(work, { retryCauses: [{ ticket: null, kind: 'agent', at: T('10:50'), reason: 'session-error: overloaded', source: 'journal' }] }).spans
    const second = spans.find((span) => span.kind === 'agent' && span.attempt === 2)
    expect(second?.reason).toBe('session-error: overloaded')
  })
})

describe('an attempt that a new call of its name replaced', () => {
  it('is over at its last own record in a live Run, not running next to its replacement', () => {
    const own = new Map([['a5', { meta: null, lines: [agentTask(T('10:01')), agentLine(T('10:40'), 'halfway')] }]])
    const { work } = facts([...launch(T('10:01'), 'call-1', 'a5', IMPL), ...launch(T('10:58'), 'call-2', 'a5b', IMPL), notification(T('11:30'), 'a5b', 'call-2')], own)
    expect(agents(work)[0]).toEqual(expect.objectContaining({ agent: 'a5', end: T('10:40'), outcome: 'cut-off', reason: 'replaced by a new call of impl-05' }))
    const live = timeline(work, { run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: null, live: true }, now: T('13:00') })
    const first = live.spans.find((span) => span.kind === 'agent' && span.attempt === 1)
    expect(first?.outcome).toBe('cut-off')
    expect(first?.end).toBe(Date.parse(T('10:40')))
  })

  it('an agent of another name is not replaced', () => {
    const { work } = facts([...launch(T('10:01'), 'call-1', 'a5', IMPL), ...launch(T('10:58'), 'call-2', 'v5', VERIFY)])
    expect(agents(work).map((fact) => [fact.name, fact.end])).toEqual([
      ['impl-05', null],
      ['verify-05', null],
    ])
  })
})

describe('the subkind and the Ticket of an agent', () => {
  it('a verifier and any other agent get verifier and other', () => {
    const { work } = facts([
      ...launch(T('10:01'), 'call-1', 'v5', VERIFY),
      ...launch(T('10:02'), 'call-2', 's1', { subagent_type: 'worfy:scout', description: 'Look around' }),
      ...launch(T('10:03'), 'call-3', 'g1', { name: 'helper', description: 'Help' }),
    ])
    expect(agents(work).map((fact) => [fact.name, agentSubkind(fact.name, fact.agentType)])).toEqual([
      ['verify-05', 'verifier'],
      ['Look around', 'other'],
      ['helper', 'other'],
    ])
  })

  it('a verifier that answers REJECTED is rejected with its verdict, VERIFIED stays ok', () => {
    const own = new Map([
      ['v5', { meta: null, lines: [agentLine(T('10:09'), '**REJECTED**: the stage name is cut')] }],
      ['v7', { meta: null, lines: [agentLine(T('10:19'), 'VERIFIED; debt: one comment')] }],
    ])
    const { work } = facts(
      [
        ...launch(T('10:01'), 'call-1', 'v5', VERIFY),
        notification(T('10:10'), 'v5', 'call-1'),
        ...launch(T('10:11'), 'call-2', 'v7', { name: 'verify-07r2', subagent_type: 'worfy:reviewer' }),
        notification(T('10:20'), 'v7', 'call-2'),
      ],
      own,
    )
    expect(agents(work).map((fact) => [fact.name, fact.ticket, fact.outcome, fact.verdict])).toEqual([
      ['verify-05', 'e/05', 'rejected', 'REJECTED'],
      ['verify-07r2', 'e/07', undefined, 'VERIFIED'],
    ])
  })

  it('the verdict is the first word of the report only; a failed verifier stays failed', () => {
    const { work } = facts([
      ...launch(T('10:01'), 'call-1', 'v5', VERIFY),
      notification(T('10:10'), 'v5', 'call-1', 'completed', 'done', 'The earlier REJECTED is resolved; VERIFIED'),
      ...launch(T('10:11'), 'call-2', 'v7', { name: 'verify-07', subagent_type: 'worfy:reviewer' }),
      notification(T('10:20'), 'v7', 'call-2', 'failed', 'API Error', 'REJECTED\nhalf a review'),
    ])
    expect(agents(work).map((fact) => [fact.name, fact.outcome, fact.verdict])).toEqual([
      ['verify-05', undefined, undefined],
      ['verify-07', 'failed', 'REJECTED'],
    ])
  })

  it('a verifier whose name has no Ticket number takes the Ticket its prompt names: a branch, an issue path, ticket NN', () => {
    const { work } = facts([
      ...launch(T('10:01'), 'call-1', 'v1', { name: 'verify-fr05-correct', subagent_type: 'worfy:reviewer', prompt: 'Review PR #470, branch e/05, head abc' }),
      ...launch(T('10:02'), 'call-2', 'v2', { name: 'verify-fr07-tests', subagent_type: 'worfy:reviewer', prompt: 'Read .scratch/e/issues/07-the-ticket.md first' }),
      ...launch(T('10:03'), 'call-3', 'v3', { name: 'verify-docs', subagent_type: 'worfy:reviewer', prompt: 'Lens: docs of ticket 05' }),
      ...launch(T('10:04'), 'call-4', 'v4', { name: 'verify-other', subagent_type: 'worfy:reviewer', prompt: 'Review branch other-epic/05 and ticket 09' }),
    ])
    expect(agents(work).map((fact) => [fact.name, fact.ticket])).toEqual([
      ['verify-fr05-correct', 'e/05'],
      ['verify-fr07-tests', 'e/07'],
      ['verify-docs', 'e/05'],
      ['verify-other', null],
    ])
  })

  it('the report of the task-notification wins over the agent transcript for the verdict', () => {
    const { work } = facts([...launch(T('10:01'), 'call-1', 'v5', VERIFY), notification(T('10:10'), 'v5', 'call-1', 'completed', 'done', 'REJECTED\nreasons')])
    expect(agents(work)[0]?.outcome).toBe('rejected')
  })

  it('a Ticket outside the Run is not named; the worktree of the report or of the agent stands in, else null', () => {
    const report = '```json\n{\n  "ticket": "e/09",\n  "pr": 470,\n  "worktree": "/Users/someone/repo/.claude/worktrees/09"\n}\n```'
    const own = new Map([
      ['a9', { meta: null, lines: [agentTask(T('10:01')), agentLine(T('10:20'), report)] }],
      ['h1', { meta: null, lines: [agentTask(T('10:02'), '/Users/someone/repo/.claude/worktrees/review-1'), agentLine(T('10:21'), 'done', '/Users/someone/repo/.claude/worktrees/review-1')] }],
    ])
    const { work } = facts(
      [
        ...launch(T('10:01'), 'call-1', 'a9', { name: 'impl-09', subagent_type: 'worfy:implementer' }),
        ...launch(T('10:02'), 'call-2', 'h1', { name: 'helper' }),
        ...launch(T('10:03'), 'call-3', 'h2', { name: 'other-helper' }),
        notification(T('10:20'), 'a9', 'call-1'),
        notification(T('10:21'), 'h1', 'call-2'),
      ],
      own,
    )
    const byName = new Map(agents(work).map((fact) => [fact.name, fact]))
    expect(byName.get('impl-09')).toEqual(expect.objectContaining({ worktree: '/Users/someone/repo/.claude/worktrees/09', pr: 470 }))
    expect(byName.get('impl-09')?.ticket).toBeUndefined()
    expect(byName.get('helper')).toEqual(expect.objectContaining({ worktree: '/Users/someone/repo/.claude/worktrees/review-1' }))
    expect(byName.get('helper')?.ticket).toBeUndefined()
    expect(byName.get('other-helper')?.ticket).toBeNull()
    expect('ticket' in byName.get('other-helper')!).toBe(true)
  })

  it('the meta of the agent names it when the call does not', () => {
    const own = new Map([['a5', { meta: { agentType: 'worfy:implementer', name: 'impl-05', description: 'x' }, lines: [] }]])
    const { work } = facts([toolUse(T('10:01'), 'call-1', 'Agent', { prompt: 'go', run_in_background: true }), toolResult(T('10:01'), 'call-1', 'Async agent launched', { status: 'async_launched', agentId: 'a5' })], own)
    expect(agents(work)).toEqual([expect.objectContaining({ name: 'impl-05', agentType: 'worfy:implementer', ticket: 'e/05' })])
  })
})

describe('the turns of the Orchestrator', () => {
  it('a turn runs from a prompt or a delivered report to its last answer and names the Tickets it touched', () => {
    const { turns } = facts([
      prompt(T('10:00'), '/worfy:epic-wave tickets 05, 07 of epic e'),
      say(T('10:00', '30')),
      ...launch(T('10:01'), 'call-1', 'a5', IMPL),
      say(T('10:02')),
      notification(T('10:40'), 'a5', 'call-1'),
      say(T('10:41')),
      prompt(T('10:50'), 'Another Claude session sent a message:\n<agent-message from="verify-07">\nquestion\n</agent-message>'),
      say(T('10:51')),
    ])
    expect(turns.map((turn) => [turn.start, turn.end, turn.tickets])).toEqual([
      [T('10:00'), T('10:02'), ['e/05', 'e/07']],
      [T('10:40'), T('10:41'), ['e/05']],
      [T('10:50'), T('10:51'), ['e/07']],
    ])
    expect(turns.every((turn) => turn.session === SESSION && turn.startSource === 'transcript')).toBe(true)
    expect(new Set(turns.map((turn) => turn.id)).size).toBe(3)
  })

  it('records of Subagents in the file, meta prompts and tool results start no turn', () => {
    const { turns } = facts([
      prompt(T('10:00'), 'go'),
      line({ type: 'user', timestamp: T('10:00', '01'), isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill' }] } }),
      line({ type: 'user', timestamp: T('10:00', '02'), isSidechain: true, message: { role: 'user', content: 'sidechain' } }),
      say(T('10:01')),
    ])
    expect(turns.map((turn) => [turn.start, turn.end])).toEqual([[T('10:00'), T('10:01')]])
  })

  it('a turn with no answer yet is open', () => {
    const { turns } = facts([prompt(T('10:00'), 'go')])
    expect(turns).toEqual([expect.objectContaining({ start: T('10:00'), end: null, lastSeenAt: T('10:00') })])
  })
})

describe('the Subagents of a window', () => {
  it('are those whose Agent call or resuming SendMessage lies in it', () => {
    const lines = [
      ...launch(T('09:00'), 'call-0', 'early', IMPL),
      ...launch(T('10:01'), 'call-1', 'a5', IMPL),
      ...send(T('10:30'), 'send-1', 'early', 'early'),
      ...send(T('10:31'), 'send-2', 'impl-05'),
      ...launch(T('12:01'), 'call-2', 'late', IMPL),
    ]
    const inside = (at: string) => at >= T('10:00') && at <= T('11:00')
    expect([...agentIdsIn(lines, inside)].sort()).toEqual(['a5', 'early'])
  })
})

describe('the prompt of a Wave', () => {
  it('is found as typed, queued or as a slash command, with its own timestamp', () => {
    const lines = [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: T('10:00'), content: '/worfy:epic-wave tickets 05 of epic e' }),
      prompt(T('10:00', '01'), '<command-message>worfy:epic-wave</command-message>\n<command-name>/worfy:epic-wave</command-name>\n<command-args>tickets 05 of epic e</command-args>'),
      prompt(T('12:00'), '/worfy:epic-wave tickets 05 of epic e'),
      prompt(T('13:00'), '/worfy:epic-wave tickets 07 of epic e'),
    ]
    expect(wavePromptTimes(lines, '/worfy:epic-wave tickets 05 of epic e')).toEqual([T('10:00'), T('10:00', '01'), T('12:00')])
  })
})
