// The Subagent tree of a Session (ticket 15, src/shared/transcript/subagents.ts) built from the
// synthetic Claude home of ticket 09 (test/fixtures/claude-home/README.md): the Session's own
// transcript, and the `subagents/agent-<id>.jsonl` and `.meta.json` files next to it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import {
  buildSubagentTree,
  flattenSubagents,
  readSubagentMeta,
  subagentFile,
  subagentSignals,
  subagentSignalsOfLines,
  summaryLine,
  type SubagentFile,
  type SubagentInfo,
} from '../../src/shared/transcript/subagents'

const HOME = join(__dirname, '../fixtures/claude-home/projects')
const DEMO = join(HOME, '-Users-test-projects-demo')
const AGENTS = join(HOME, '-Users-test-projects-agents')
const SESSION_7 = '77777777-7777-4777-8777-777777777777'

const lines = (path: string): string[] => readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '')

/** Records written up to `until` (ISO): the files as they were at that moment. Records without a time are kept. */
const upTo = (all: string[], until: string | undefined): string[] =>
  until === undefined ? all : all.filter((line) => {
    const time = (JSON.parse(line) as { timestamp?: string }).timestamp
    return time === undefined || time <= until
  })

/** What main reads for a Session: the signals of its transcript and its Subagents' files, as they were at `until`. */
function load(dir: string, sessionId: string, until?: string) {
  const kept = upTo(lines(join(dir, `${sessionId}.jsonl`)), until)
  const folder = join(dir, sessionId, 'subagents')
  const files: SubagentFile[] = []
  if (existsSync(folder)) {
    for (const name of readdirSync(folder).sort()) {
      const match = /^agent-(.+)\.jsonl$/.exec(name)
      if (!match) continue
      const agentId = match[1]!
      const metaPath = join(folder, `agent-${agentId}.meta.json`)
      const meta: unknown = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null
      const transcript = upTo(lines(join(folder, name)), until)
      if (transcript.length > 0) files.push(subagentFile(agentId, meta, transcript))
    }
  }
  return { signals: subagentSignalsOfLines(kept), files }
}

/** The fields the ticket asks for, without the children. */
const shape = ({ children, ...info }: SubagentInfo) => ({ ...info, children: children.map((child) => child.agentId) })
const at = (iso: string) => Date.parse(iso)

describe('buildSubagentTree', () => {
  it('puts a nested Subagent under the Subagent that started it', () => {
    const tree = buildSubagentTree(load(DEMO, '55555555-5555-4555-8555-555555555555'))
    expect(tree.map((node) => node.agentId)).toEqual(['a1000000000000286'])
    const [implementer] = tree
    expect(implementer!.children.map((node) => node.agentId)).toEqual(['a2000000000000286'])
    const scout = implementer!.children[0]!
    expect(scout).toMatchObject({ subagentType: 'scout', parentAgentId: 'a1000000000000286', depth: 2, status: 'done', summary: 'Synthetic scout report.' })
    expect(scout.startedAt).toBe(at('2026-05-05T10:06:53.000Z'))
  })

  it('builds the tree of three Subagents, one nested and one in the background, with type, model, status and result', () => {
    const tree = buildSubagentTree(load(AGENTS, SESSION_7))
    expect(tree.map(shape)).toEqual([
      {
        id: 'toolu_01S7AGENT1XXXXXXXXXXXXXX',
        agentId: 'a3000000000000286',
        toolUseId: 'toolu_01S7AGENT1XXXXXXXXXXXXXX',
        parentAgentId: null,
        name: 'impl-08',
        subagentType: 'implementer',
        model: 'claude-sonnet-5',
        description: 'Implement demo-epic 08',
        status: 'done',
        background: true,
        startedAt: at('2026-06-01T10:00:05.000Z'),
        durationMs: 175_000,
        summary: 'Synthetic implementer report for 08.',
        verdict: null,
        depth: 1,
        transcript: true,
        children: ['a4000000000000286'],
      },
      {
        id: 'toolu_01S7AGENT3XXXXXXXXXXXXXX',
        agentId: 'a5000000000000286',
        toolUseId: 'toolu_01S7AGENT3XXXXXXXXXXXXXX',
        parentAgentId: null,
        name: 'verify-07',
        subagentType: 'reviewer',
        model: 'claude-opus-5-5',
        description: 'Review demo-epic 07',
        status: 'done',
        background: false,
        startedAt: at('2026-06-01T10:00:10.000Z'),
        durationMs: 50_000,
        summary: 'REJECTED',
        verdict: 'REJECTED',
        depth: 1,
        transcript: true,
        children: [],
      },
    ])
    expect(shape(tree[0]!.children[0]!)).toEqual({
      id: 'toolu_01S7AGENT2XXXXXXXXXXXXXX',
      agentId: 'a4000000000000286',
      toolUseId: 'toolu_01S7AGENT2XXXXXXXXXXXXXX',
      parentAgentId: 'a3000000000000286',
      name: null,
      subagentType: 'scout',
      model: 'claude-haiku-4-5',
      description: 'Scout demo-epic 08 files',
      status: 'done',
      background: false,
      startedAt: at('2026-06-01T10:00:20.000Z'),
      durationMs: 70_000,
      summary: 'Synthetic scout notes.',
      verdict: null,
      depth: 2,
      transcript: true,
      children: [],
    })
  })

  it('shows a background Subagent running until its task-notification, then done', () => {
    const before = flattenSubagents(buildSubagentTree(load(AGENTS, SESSION_7, '2026-06-01T10:01:10.000Z')))
    expect(before.map(({ name, subagentType, status, durationMs, summary }) => ({ name, subagentType, status, durationMs, summary }))).toEqual([
      { name: 'impl-08', subagentType: 'implementer', status: 'running', durationMs: null, summary: null },
      { name: null, subagentType: 'scout', status: 'running', durationMs: null, summary: null },
      { name: 'verify-07', subagentType: 'reviewer', status: 'done', durationMs: 50_000, summary: 'REJECTED' },
    ])
    expect(before[0]!.startedAt).toBe(at('2026-06-01T10:00:05.000Z'))
    // The implementer has answered (its file ends the turn) but the Session was not told yet.
    const answered = buildSubagentTree(load(AGENTS, SESSION_7, '2026-06-01T10:02:59.000Z'))
    expect(answered[0]!.status).toBe('done')
    const after = buildSubagentTree(load(AGENTS, SESSION_7))
    expect(after[0]).toMatchObject({ status: 'done', summary: 'Synthetic implementer report for 08.' })
  })

  it('finds a synchronous Subagent without meta.json through the Agent tool result', () => {
    const tree = buildSubagentTree(load(DEMO, '22222222-2222-4222-8222-222222222222'))
    expect(tree.map(({ children, ...info }) => ({ ...info, children: children.length }))).toEqual([
      {
        id: expect.stringMatching(/^toolu_/) as unknown as string,
        agentId: 'a0000000000000247',
        toolUseId: expect.stringMatching(/^toolu_/) as unknown as string,
        parentAgentId: null,
        name: null,
        subagentType: 'scout',
        model: 'claude-opus-5',
        description: 'Synthetic scout task',
        status: 'done',
        background: false,
        startedAt: expect.any(Number) as unknown as number,
        durationMs: expect.any(Number) as unknown as number,
        summary: 'Synthetic subagent report.',
        verdict: null,
        depth: 1,
        transcript: true,
        children: 0,
      },
    ])
  })

  it('a Session without Subagents has an empty tree', () => {
    expect(buildSubagentTree(load(DEMO, '11111111-1111-4111-8111-111111111111'))).toEqual([])
  })
})

/** SDK-shaped events of a live Session (what the fake agent sends), with the times worfy saw them. */
function live(events: Array<[number, AgentEvent]>) {
  return subagentSignals(events.map(([atMs, event]) => ({ event, at: atMs })))
}
const call = (id: string, input: Record<string, unknown>, parentToolUseId: string | null = null): AgentEvent => ({ type: 'tool_use', id, name: 'Agent', input, parentToolUseId })
const started = (taskId: string, toolUseId: string | null, subagentType: string | null): AgentEvent => ({
  type: 'subagent',
  phase: 'started',
  taskId,
  toolUseId,
  description: null,
  subagentType,
  status: null,
  summary: null,
})
const finished = (taskId: string, toolUseId: string | null, status: string, result?: string): AgentEvent => ({
  type: 'subagent',
  phase: 'finished',
  taskId,
  toolUseId,
  description: null,
  subagentType: null,
  status,
  summary: null,
  ...(result === undefined ? {} : { result }),
})

describe('buildSubagentTree on live events', () => {
  it('builds the tree from SDK events: background start, nested call, notification', () => {
    const signals = live([
      [1000, call('toolu_a', { subagent_type: 'implementer', name: 'impl-09', model: 'sonnet', description: 'Implement 09', run_in_background: true })],
      [1010, started('task-a', 'toolu_a', 'implementer')],
      [1020, { type: 'tool_result', toolUseId: 'toolu_a', content: 'Async agent launched successfully.', isError: false, parentToolUseId: null }],
      [2000, call('toolu_b', { subagent_type: 'scout', description: 'Scout' }, 'toolu_a')],
      [2010, started('task-b', 'toolu_b', 'scout')],
      // A background Bash run also has a task: it is not a Subagent.
      [2500, started('task-bash', 'toolu_bash', null)],
      [2600, finished('task-bash', 'toolu_bash', 'completed')],
    ])
    const running = buildSubagentTree({ signals, files: [] })
    expect(flattenSubagents(running).map(({ agentId, parentAgentId, status, model, depth }) => ({ agentId, parentAgentId, status, model, depth }))).toEqual([
      { agentId: 'task-a', parentAgentId: null, status: 'running', model: 'sonnet', depth: 1 },
      { agentId: 'task-b', parentAgentId: 'task-a', status: 'running', model: null, depth: 2 },
    ])
    const done = buildSubagentTree({
      signals: [...signals, ...live([[9000, finished('task-a', 'toolu_a', 'completed', 'VERIFIED: all good')], [9500, finished('task-b', 'toolu_b', 'failed')]])],
      files: [],
    })
    expect(flattenSubagents(done).map(({ agentId, status, durationMs, verdict }) => ({ agentId, status, durationMs, verdict }))).toEqual([
      { agentId: 'task-a', status: 'done', durationMs: 8000, verdict: 'VERIFIED' },
      { agentId: 'task-b', status: 'error', durationMs: 7500, verdict: null },
    ])
  })

  it('shows a call whose Subagent has no id yet, and keeps one node when the files name it', () => {
    const signals = live([[1000, call('toolu_01S7AGENT3XXXXXXXXXXXXXX', { subagent_type: 'reviewer', name: 'verify-07' })]])
    expect(buildSubagentTree({ signals, files: [] }).map(({ id, agentId, status }) => ({ id, agentId, status }))).toEqual([
      { id: 'toolu_01S7AGENT3XXXXXXXXXXXXXX', agentId: null, status: 'running' },
    ])
    const { files } = load(AGENTS, SESSION_7)
    const tree = buildSubagentTree({ signals, files })
    expect(flattenSubagents(tree).filter((info) => info.toolUseId === 'toolu_01S7AGENT3XXXXXXXXXXXXXX')).toHaveLength(1)
    expect(flattenSubagents(tree).map((info) => info.agentId).sort()).toEqual(['a3000000000000286', 'a4000000000000286', 'a5000000000000286'])
  })

  it('merges the record found by the call id with the one found by the Subagent id when a file names both', () => {
    // The call comes first (toolUseId X), then a task-notification with the Subagent's id and no
    // tool_use_id, and only then the Subagent's meta.json names call X: three sources, one node.
    const signals = live([
      [1000, call('toolu_X', { subagent_type: 'scout', run_in_background: true })],
      [1100, { type: 'tool_result', toolUseId: 'toolu_X', content: 'Async agent launched successfully.', isError: false, parentToolUseId: null }],
      [5000, finished('a-x', null, 'completed', 'Scout done.')],
    ])
    const file = subagentFile('a-x', { toolUseId: 'toolu_X', agentType: 'scout' }, [])
    const tree = buildSubagentTree({ signals, files: [file] })
    expect(flattenSubagents(tree).map(({ id, agentId, toolUseId, status, summary, durationMs }) => ({ id, agentId, toolUseId, status, summary, durationMs }))).toEqual([
      { id: 'toolu_X', agentId: 'a-x', toolUseId: 'toolu_X', status: 'done', summary: 'Scout done.', durationMs: 4000 },
    ])
  })

  it("names a Subagent by its files' id when the live task id differs, and nests by that id", () => {
    // The SDK's task_id has matched the file's agentId on real transcripts, but nothing promises it:
    // the transcript to open and the parent named by meta.parentAgentId use the file's id.
    const signals = live([
      [1000, call('toolu_T1', { subagent_type: 'implementer' })],
      [1010, started('task-K1', 'toolu_T1', 'implementer')],
    ])
    const parent = subagentFile('R1', { toolUseId: 'toolu_T1', agentType: 'implementer' }, [])
    const child = subagentFile('R2', { toolUseId: 'toolu_T2', agentType: 'scout', parentAgentId: 'R1' }, [])
    const tree = buildSubagentTree({ signals, files: [parent, child] })
    expect(flattenSubagents(tree).map(({ id, agentId, parentAgentId, depth, transcript }) => ({ id, agentId, parentAgentId, depth, transcript }))).toEqual([
      { id: 'toolu_T1', agentId: 'R1', parentAgentId: null, depth: 1, transcript: true },
      { id: 'toolu_T2', agentId: 'R2', parentAgentId: 'R1', depth: 2, transcript: true },
    ])
    // The live task id still finds the Subagent: its notification ends it.
    const done = buildSubagentTree({ signals: [...signals, ...live([[3000, finished('task-K1', null, 'completed')]])], files: [parent, child] })
    expect(done[0]).toMatchObject({ agentId: 'R1', status: 'done', durationMs: 2000 })
    expect(flattenSubagents(done)).toHaveLength(2)
  })

  it('keeps every id of merged records: the live task id still finds the Subagent after the files merge it', () => {
    // started(task-K1, T1) and a notification by the files' id R1 without a call id make two
    // records; R1's meta names T1 and merges them. A child named by task-K1 must find the merged one.
    const signals = live([
      [1000, call('toolu_T1', { subagent_type: 'implementer' })],
      [1010, started('task-K1', 'toolu_T1', 'implementer')],
      [4000, finished('R1', null, 'completed')],
    ])
    const parent = subagentFile('R1', { toolUseId: 'toolu_T1', agentType: 'implementer' }, [])
    const child = subagentFile('R2', { toolUseId: 'toolu_T2', agentType: 'scout', parentAgentId: 'task-K1' }, [])
    const tree = buildSubagentTree({ signals, files: [parent, child] })
    expect(flattenSubagents(tree).map(({ agentId, parentAgentId, depth, status }) => ({ agentId, parentAgentId, depth, status }))).toEqual([
      { agentId: 'R1', parentAgentId: null, depth: 1, status: 'done' },
      { agentId: 'R2', parentAgentId: 'R1', depth: 2, status: 'running' },
    ])
  })
})

describe('summaryLine and the meta file', () => {
  it('takes the first line without markdown marks', () => {
    expect(summaryLine('\n\n## **REJECTED** — two findings\nmore')).toBe('REJECTED — two findings')
    expect(summaryLine('**REJECTED** — reason')).toBe('REJECTED — reason')
    expect(summaryLine('*VERIFIED*: the __fix__ holds')).toBe('VERIFIED: the fix holds')
    // Underscores inside a word and a lone asterisk are not emphasis.
    expect(summaryLine('Checked subagent_type and 2 * 3')).toBe('Checked subagent_type and 2 * 3')
    expect(summaryLine('**VERIFIED**')).toBe('VERIFIED')
    expect(summaryLine('   ')).toBeNull()
    expect(summaryLine(null)).toBeNull()
    expect(summaryLine('x'.repeat(400))).toHaveLength(160)
  })

  it('reads meta.json leniently: a field of another type is dropped, unknown keys are not copied', () => {
    expect(readSubagentMeta({ agentType: 'scout', spawnDepth: 'two', name: 7, secret: 'x', toolUseId: 'toolu_1' })).toEqual({ agentType: 'scout', toolUseId: 'toolu_1' })
    expect(readSubagentMeta([1, 2])).toBeNull()
    expect(readSubagentMeta('scout')).toBeNull()
  })

  it('takes a synchronous call result as the end, and a background launch as a start', () => {
    const sync = live([
      [1000, call('toolu_sync', { subagent_type: 'scout' })],
      [4000, { type: 'tool_result', toolUseId: 'toolu_sync', content: '## Findings\nnone', isError: false, parentToolUseId: null }],
      [1000, call('toolu_bg', { subagent_type: 'scout' })],
      [1100, { type: 'tool_result', toolUseId: 'toolu_bg', content: 'Async agent launched successfully.', isError: false, parentToolUseId: null }],
      [1000, call('toolu_bad', { subagent_type: 'scout' })],
      [1200, { type: 'tool_result', toolUseId: 'toolu_bad', content: 'Agent type not found', isError: true, parentToolUseId: null }],
    ])
    expect(buildSubagentTree({ signals: sync, files: [] }).map(({ id, status, durationMs, summary, background }) => ({ id, status, durationMs, summary, background }))).toEqual([
      { id: 'toolu_bad', status: 'error', durationMs: 200, summary: 'Agent type not found', background: false },
      { id: 'toolu_bg', status: 'running', durationMs: null, summary: null, background: true },
      { id: 'toolu_sync', status: 'done', durationMs: 3000, summary: 'Findings', background: false },
    ])
  })

  it('puts a nested Subagent under its parent by meta.parentAgentId before the parent file shows the call', () => {
    const signals = live([[1000, call('toolu_p', { subagent_type: 'implementer' })]])
    const parent = subagentFile('p1', { toolUseId: 'toolu_p', agentType: 'implementer' }, [])
    const child = subagentFile('c1', { toolUseId: 'toolu_c', agentType: 'scout', parentAgentId: 'p1' }, [])
    const tree = buildSubagentTree({ signals, files: [parent, child] })
    expect(tree.map((info) => [info.agentId, info.children.map((each) => [each.agentId, each.parentAgentId, each.depth])])).toEqual([['p1', [['c1', 'p1', 2]]]])
  })

  it('shows a Subagent the user stopped as an error, though no task-notification came', () => {
    const signals = live([[1000, call('toolu_s', { subagent_type: 'scout', run_in_background: true })]])
    const file = subagentFile('a-stopped', { toolUseId: 'toolu_s', agentType: 'scout', stoppedByUser: true }, [])
    expect(buildSubagentTree({ signals, files: [file] })[0]).toMatchObject({ agentId: 'a-stopped', status: 'error' })
    expect(buildSubagentTree({ signals, files: [{ ...file, meta: { ...file.meta, stoppedByUser: false } }] })[0]).toMatchObject({ status: 'running' })
  })

  it('skips lines of a Subagent transcript that are not JSON', () => {
    const file = subagentFile('a1', null, ['not json', '{"type":"assistant","timestamp":"2026-01-01T00:00:00.000Z","message":{"model":"m","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"}}'])
    expect(file).toMatchObject({ agentId: 'a1', meta: null, transcript: true, model: 'm', finalText: 'Done.', ended: true, firstAt: at('2026-01-01T00:00:00.000Z') })
  })
})

// Ticket worfy-daily/08, ADR-0030: Subagents that stayed `running` long after they stopped.
describe('a Subagent whose end is not a task-notification user message', () => {
  const STALE = join(HOME, '-Users-test-projects-stale')
  const SESSION_9 = '99999999-9999-4999-8999-999999999999'
  const A = 'a6000000000000260'
  const B = 'a7000000000000260'
  const statuses = (tree: readonly SubagentInfo[]) => flattenSubagents(tree).map(({ agentId, status }) => [agentId, status])
  const notification = (taskId: string, toolUseId: string) =>
    `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>Report.</result>\n</task-notification>`
  const launched = (toolUseId: string, agentId: string): string[] => [
    JSON.stringify({ type: 'assistant', timestamp: '2026-09-10T00:00:00.000Z', message: { model: 'm', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'scout', run_in_background: true } }], stop_reason: 'tool_use' } }),
    JSON.stringify({ type: 'user', timestamp: '2026-09-10T00:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId } }),
  ]

  it('reads a task-notification that Claude Code queued: a queue-operation and a queued_command attachment', () => {
    const tree = buildSubagentTree(load(STALE, SESSION_9))
    expect(flattenSubagents(tree).find((info) => info.agentId === A)).toMatchObject({ status: 'done', summary: 'Synthetic report for option A.', durationMs: at('2026-09-10T02:33:00.000Z') - at('2026-09-10T02:30:05.000Z') })
  })

  it('ends a Subagent by a queue-operation alone, and by a queued_command attachment alone', () => {
    const enqueue = JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-09-10T00:01:00.000Z', content: notification('a-q', 'toolu_q') })
    const attachment = JSON.stringify({ type: 'attachment', timestamp: '2026-09-10T00:01:00.000Z', attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: notification('a-q', 'toolu_q') } })
    for (const line of [enqueue, attachment]) {
      expect(statuses(buildSubagentTree({ signals: subagentSignalsOfLines([...launched('toolu_q', 'a-q'), line]), files: [] }))).toEqual([['a-q', 'done']])
    }
  })

  it('does not end a Subagent by a queue removal or by a queued command that is not a task-notification', () => {
    const remove = JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: '2026-09-10T00:01:00.000Z', content: notification('a-q', 'toolu_q') })
    const typed = JSON.stringify({ type: 'attachment', timestamp: '2026-09-10T00:01:00.000Z', attachment: { type: 'queued_command', prompt: `please also check ${notification('a-q', 'toolu_q')}` } })
    expect(statuses(buildSubagentTree({ signals: subagentSignalsOfLines([...launched('toolu_q', 'a-q'), remove, typed]), files: [] }))).toEqual([['a-q', 'running']])
  })

  it('reads a queued task-notification of a nested Subagent in its parent transcript', () => {
    const parent = subagentFile('a-p', null, [
      ...launched('toolu_n', 'a-n'),
      JSON.stringify({ type: 'attachment', isSidechain: true, timestamp: '2026-09-10T00:01:00.000Z', attachment: { type: 'queued_command', prompt: notification('a-n', 'toolu_n') } }),
    ])
    const child = subagentFile('a-n', { toolUseId: 'toolu_n', parentAgentId: 'a-p' }, [])
    expect(statuses(buildSubagentTree({ signals: [], files: [parent, child] }))).toEqual([['a-p', 'running'], ['a-n', 'done']])
  })

  it('shows a background Subagent without a task-notification as an error once its Session is closed', () => {
    const { signals, files } = load(STALE, SESSION_9)
    expect(statuses(buildSubagentTree({ signals, files }))).toEqual([[A, 'done'], [B, 'running']])
    const closed = buildSubagentTree({ signals: [...signals, { kind: 'session-closed' }], files })
    expect(statuses(closed)).toEqual([[A, 'done'], [B, 'error']])
    // Its time ends with the last record of its file, its summary is its last text.
    expect(closed[1]).toMatchObject({ durationMs: at('2026-09-10T02:31:00.000Z') - at('2026-09-10T02:30:07.000Z'), summary: 'Fetching the vendor page.' })
  })

  it('shows a synchronous Subagent cut off by the closed Session as an error, and keeps what had ended', () => {
    const signals = live([
      [1000, call('toolu_cut', { subagent_type: 'scout' })],
      [1000, call('toolu_ok', { subagent_type: 'scout' })],
      [3000, { type: 'tool_result', toolUseId: 'toolu_ok', content: 'Found it.', isError: false, parentToolUseId: null }],
      [1000, call('toolu_bg', { subagent_type: 'scout', run_in_background: true })],
      [1100, { type: 'tool_result', toolUseId: 'toolu_bg', content: 'Async agent launched successfully.', isError: false, parentToolUseId: null }],
      [5000, { type: 'subagent', phase: 'finished', taskId: 'a-bg', toolUseId: 'toolu_bg', description: null, subagentType: null, status: 'completed', summary: 'Done', result: null }],
    ])
    const tree = buildSubagentTree({ signals: [...signals, { kind: 'session-closed' }], files: [] })
    expect(tree.map(({ id, status }) => [id, status])).toEqual([
      ['toolu_bg', 'done'],
      ['toolu_cut', 'error'],
      ['toolu_ok', 'done'],
    ])
  })

  it('takes the closed Session only from the Session thread, not from a Subagent file', () => {
    const { signals, files } = load(STALE, SESSION_9)
    const withStray = files.map((file) => ({ ...file, signals: [...file.signals, { kind: 'session-closed' as const }] }))
    expect(statuses(buildSubagentTree({ signals, files: withStray }))).toEqual([[A, 'done'], [B, 'running']])
  })
})
