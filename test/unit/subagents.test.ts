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
  readWorkflowJournal,
  subagentFile,
  subagentSignals,
  subagentSignalsOfLines,
  summaryLine,
  workflowAgentFile,
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

  it('reads the verdict of a `worfy:reviewer` answering in English, bold, with a tail after the word', () => {
    const verdictOf = (answer: string) => {
      const signals = live([
        [1000, call('toolu_r', { subagent_type: 'worfy:reviewer', name: 'verify-10' })],
        [1010, started('task-r', 'toolu_r', 'worfy:reviewer')],
        [9000, finished('task-r', 'toolu_r', 'completed', answer)],
      ])
      const [reviewer] = flattenSubagents(buildSubagentTree({ signals, files: [] }))
      return { subagentType: reviewer?.subagentType, verdict: reviewer?.verdict }
    }
    expect(verdictOf('**VERIFIED** (round 2, head abc1234)\nAll three lenses clean.')).toEqual({ subagentType: 'worfy:reviewer', verdict: 'VERIFIED' })
    expect(verdictOf('REJECTED: 2 findings\n- src/a.ts:1 — x\n- src/b.ts:2 — y')).toEqual({ subagentType: 'worfy:reviewer', verdict: 'REJECTED' })
    expect(verdictOf('## REJECTED — round 1\n')).toEqual({ subagentType: 'worfy:reviewer', verdict: 'REJECTED' })
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

  // worfy-week ticket 12: an MCP tool name lost its `__` as if `__qmd__` were emphasis («mcpqmdget»).
  it('keeps `__` inside a word: a tool name stays as it is, emphasis at word boundaries still goes', () => {
    expect(summaryLine('mcp__qmd__get')).toBe('mcp__qmd__get')
    expect(summaryLine('Called mcp__qmd__get and mcp__worfy-canvas__create_card')).toBe('Called mcp__qmd__get and mcp__worfy-canvas__create_card')
    expect(summaryLine('__VERIFIED__: mcp__qmd__get works')).toBe('VERIFIED: mcp__qmd__get works')
    expect(summaryLine('the __fix__ holds, (__really__)')).toBe('the fix holds, (really)')
    expect(summaryLine('**REJECTED** and *twice*')).toBe('REJECTED and twice')
    // `**` stays emphasis inside a word, as in CommonMark.
    expect(summaryLine('un**frigging**believable')).toBe('unfriggingbelievable')
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

// Ticket worfy-daily/08, ADR-0030 and ADR-0031: Subagents that stayed `running` long after they stopped.
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

// ADR-0085: a Session continued in a new process keeps its sessionId; a Subagent without an end
// whose last record is older than the start of the Session's running process died with an earlier
// process, and is `interrupted`.
describe('a Subagent of an earlier process of its Session', () => {
  const STALE = join(HOME, '-Users-test-projects-stale')
  const SESSION_9 = '99999999-9999-4999-8999-999999999999'
  const A = 'a6000000000000260'
  const B = 'a7000000000000260'
  /** The last record of B, which never reported. */
  const B_LAST = at('2026-09-10T02:31:00.000Z')
  const statuses = (tree: readonly SubagentInfo[]) => flattenSubagents(tree).map(({ agentId, status }) => [agentId, status])
  const processFrom = (startedAt: number) => ({ kind: 'session-process' as const, startedAt })

  it('is interrupted when the process started after its last record, running when before', () => {
    const { signals, files } = load(STALE, SESSION_9)
    const after = buildSubagentTree({ signals: [...signals, processFrom(at('2026-09-10T05:00:00.000Z'))], files })
    expect(statuses(after)).toEqual([[A, 'done'], [B, 'interrupted']])
    // Its time ends with its last record, its summary is its last text, as for one cut off by a closed Session.
    expect(after[1]).toMatchObject({ durationMs: B_LAST - at('2026-09-10T02:30:07.000Z'), summary: 'Fetching the vendor page.' })
    expect(statuses(buildSubagentTree({ signals: [...signals, processFrom(at('2026-09-10T02:00:00.000Z'))], files }))).toEqual([[A, 'done'], [B, 'running']])
  })

  it('tells 300 ms apart within one second: interrupted 300 ms after its last record, running 300 ms before it', () => {
    const { signals, files } = load(STALE, SESSION_9)
    expect(statuses(buildSubagentTree({ signals: [...signals, processFrom(B_LAST + 300)], files }))).toEqual([[A, 'done'], [B, 'interrupted']])
    expect(statuses(buildSubagentTree({ signals: [...signals, processFrom(B_LAST - 300)], files }))).toEqual([[A, 'done'], [B, 'running']])
  })

  it('stays running without a known start of the process, and is an error once the Session is closed (ADR-0031)', () => {
    const { signals, files } = load(STALE, SESSION_9)
    expect(statuses(buildSubagentTree({ signals, files }))).toEqual([[A, 'done'], [B, 'running']])
    expect(statuses(buildSubagentTree({ signals: [...signals, processFrom(B_LAST + 1000), { kind: 'session-closed' }], files }))).toEqual([[A, 'done'], [B, 'error']])
  })

  it('takes the start of the process only from the Session thread, not from a Subagent file', () => {
    const { signals, files } = load(STALE, SESSION_9)
    const withStray = files.map((file) => ({ ...file, signals: [...file.signals, processFrom(B_LAST + 1000)] }))
    expect(statuses(buildSubagentTree({ signals, files: withStray }))).toEqual([[A, 'done'], [B, 'running']])
  })

  it('judges a Subagent known only by its call by the call: interrupted when the process started after it', () => {
    const signals = live([[1000, call('toolu_old', { subagent_type: 'scout', run_in_background: true })]])
    expect(buildSubagentTree({ signals: [...signals, processFrom(2000)], files: [] }).map(({ status }) => status)).toEqual(['interrupted'])
    expect(buildSubagentTree({ signals: [...signals, processFrom(500)], files: [] }).map(({ status }) => status)).toEqual(['running'])
  })
})

// Ticket worfy-daily/17, ADR-0035: the agents of a workflow script live in
// `<sessionId>/subagents/workflows/wf_*/` with a journal.jsonl; they hang under the Workflow call.
describe('Subagents of a workflow script', () => {
  const WORKFLOW = join(HOME, '-Users-test-projects-workflow')
  const SESSION_12 = '12121212-1212-4121-8121-121212121212'
  const RUN = 'wf_0a1b2c3d-4e5'
  const CALL = 'toolu_01S12WORKFLOW1XXXXXXXXX'

  /** What main reads for Session 1212: its transcript, and every agent of its workflow run with the run's journal. */
  function loadWorkflow(until?: string, journalUntil = Number.POSITIVE_INFINITY) {
    const folder = join(WORKFLOW, SESSION_12, 'subagents', 'workflows', RUN)
    const journal = readWorkflowJournal(lines(join(folder, 'journal.jsonl')).slice(0, journalUntil))
    const files: SubagentFile[] = []
    for (const name of readdirSync(folder).sort()) {
      const match = /^agent-(.+)\.jsonl$/.exec(name)
      if (!match) continue
      const agentId = match[1]!
      const meta: unknown = JSON.parse(readFileSync(join(folder, `agent-${agentId}.meta.json`), 'utf8'))
      files.push(workflowAgentFile(subagentFile(agentId, meta, upTo(lines(join(folder, name)), until)), RUN, journal.get(agentId)))
    }
    return { signals: subagentSignalsOfLines(upTo(lines(join(WORKFLOW, `${SESSION_12}.jsonl`)), until)), files }
  }
  const rows = (tree: SubagentInfo[]) => flattenSubagents(tree).map(({ id, name, subagentType, status, depth }) => ({ id, name, subagentType, status, depth }))

  it('reads the journal: a label and phase from started, the end from result or failed', () => {
    const journal = readWorkflowJournal(lines(join(WORKFLOW, SESSION_12, 'subagents', 'workflows', RUN, 'journal.jsonl')))
    expect(Object.fromEntries(journal)).toEqual({
      a8100000000000260: { label: 'impl:03', phase: 'Implement', end: 'completed', result: 'Synthetic implementer report for 03.' },
      a8200000000000260: { label: null, phase: null, end: 'failed', result: null },
      a8300000000000260: { label: 'scout:03', phase: 'Review', end: 'completed', result: 'Synthetic scout notes for 03.' },
    })
    // Lines that are not JSON, records without an agent and unknown types are skipped.
    expect(readWorkflowJournal(['not json', '{"type":"launched"}', '{"type":"paused","agentId":"a1"}']).size).toBe(0)
  })

  it('links the agents of a workflow run to the Workflow call that started it, by the run id in its result', () => {
    const tree = buildSubagentTree(loadWorkflow())
    expect(rows(tree)).toEqual([
      { id: CALL, name: 'wave-03', subagentType: 'workflow', status: 'done', depth: 1 },
      { id: 'agent:a8100000000000260', name: 'impl:03', subagentType: 'workflow-subagent', status: 'done', depth: 2 },
      { id: 'agent:a8200000000000260', name: null, subagentType: 'workflow-subagent', status: 'error', depth: 2 },
      { id: 'agent:a8300000000000260', name: 'scout:03', subagentType: 'Explore', status: 'done', depth: 2 },
    ])
    expect(tree[0]).toMatchObject({
      agentId: null,
      toolUseId: CALL,
      description: 'Synthetic wave 3: implement, review, scout',
      background: true,
      transcript: false,
      startedAt: at('2026-09-12T10:00:05.000Z'),
      durationMs: at('2026-09-12T10:09:00.000Z') - at('2026-09-12T10:00:05.000Z'),
    })
    expect(tree[0]!.children[0]).toMatchObject({ summary: 'Synthetic implementer report for 03.', model: 'claude-sonnet-5', transcript: true, parentAgentId: null })
  })

  it('keeps the run and its agents running until the journal and the task-notification end them', () => {
    // 10:05: the implementer has answered, the reviewer and the scout still work, no notification yet.
    const tree = buildSubagentTree(loadWorkflow('2026-09-12T10:05:30.000Z', 5))
    expect(rows(tree).map(({ name, status }) => [name, status])).toEqual([
      ['wave-03', 'running'],
      ['impl:03', 'done'],
      [null, 'running'],
      ['scout:03', 'running'],
    ])
    // The Session is gone: whatever has not ended was cut off with it (ADR-0031).
    const closed = buildSubagentTree({ ...loadWorkflow('2026-09-12T10:05:30.000Z', 5), signals: [...loadWorkflow('2026-09-12T10:05:30.000Z', 5).signals, { kind: 'session-closed' }] })
    expect(rows(closed).map(({ status }) => status)).toEqual(['error', 'done', 'error', 'error'])
  })

  it('cuts off an agent the journal never ended once its run has ended', () => {
    const { signals, files } = loadWorkflow(undefined, 5)
    expect(rows(buildSubagentTree({ signals, files })).map(({ status }) => status)).toEqual(['done', 'done', 'error', 'error'])
  })

  it('names the run from the inline script, from the script file, or by its run id', () => {
    const result = (id: string, runId: string): AgentEvent => ({ type: 'tool_result', toolUseId: id, content: `Workflow launched in background. Task ID: t-${id}\nSummary: Run ${id}\nRun ID: ${runId}`, isError: false, parentToolUseId: null })
    const workflow = (id: string, input: Record<string, unknown>): AgentEvent => ({ type: 'tool_use', id, name: 'Workflow', input, parentToolUseId: null })
    const signals = live([
      [1000, workflow('toolu_inline', { script: "export const meta = {\n  name: 'review-wave',\n  description: 'x',\n}" })],
      [1001, result('toolu_inline', 'wf_inline-001')],
      [2000, workflow('toolu_file', { scriptPath: '/Users/test/.claude/projects/p/s/workflows/scripts/fix-pass-wf_file-002.js', args: {} })],
      [2001, result('toolu_file', 'wf_file-002')],
      [3000, workflow('toolu_bare', {})],
      [3001, result('toolu_bare', 'wf_bare-003')],
    ])
    const tree = buildSubagentTree({ signals, files: [] })
    expect(tree.map(({ id, name, description, status }) => [id, name, description, status])).toEqual([
      ['toolu_inline', 'review-wave', 'Run toolu_inline', 'running'],
      ['toolu_file', 'fix-pass', 'Run toolu_file', 'running'],
      ['toolu_bare', 'wf_bare-003', 'Run toolu_bare', 'running'],
    ])
  })

  it('names the run from a script file and finds it by its transcript folder on Windows, with `\\` (worfy-windows ticket 08)', () => {
    const workflow = (id: string, input: Record<string, unknown>): AgentEvent => ({ type: 'tool_use', id, name: 'Workflow', input, parentToolUseId: null })
    const { files } = loadWorkflow()
    const signals = live([
      [1000, workflow('toolu_win', { scriptPath: `C:\\Users\\test\\.claude\\projects\\p\\s\\workflows\\scripts\\fix-pass-${RUN}.js` })],
      [1001, { type: 'tool_result', toolUseId: 'toolu_win', content: `Workflow launched in background.\nTranscript dir: C:\\Users\\test\\.claude\\projects\\p\\s\\subagents\\workflows\\${RUN}`, isError: false, parentToolUseId: null }],
    ])
    const tree = buildSubagentTree({ signals, files })
    expect(tree.map(({ id, name, children }) => [id, name, children.length])).toEqual([['toolu_win', 'fix-pass', 3]])
  })

  it('interrupts an agent without an end whose last record is older than the start of the Session process, and its run once none of its agents runs (ADR-0085)', () => {
    const at1030 = loadWorkflow('2026-09-12T10:05:30.000Z', 5)
    const after = (startedAt: string) => buildSubagentTree({ ...at1030, signals: [...at1030.signals, { kind: 'session-process', startedAt: at(startedAt) }] })
    // The reviewer wrote last at 10:04:01, the scout at 10:05:00: the scout still runs, and so does the run.
    expect(rows(after('2026-09-12T10:04:30.000Z')).map(({ name, status }) => [name, status])).toEqual([
      ['wave-03', 'running'],
      ['impl:03', 'done'],
      [null, 'interrupted'],
      ['scout:03', 'running'],
    ])
    expect(rows(after('2026-09-12T10:05:10.000Z')).map(({ status }) => status)).toEqual(['interrupted', 'done', 'interrupted', 'interrupted'])
  })

  it('interrupts a run without agents when the Session process started after its Workflow call, and keeps it running when before', () => {
    const { signals } = loadWorkflow('2026-09-12T10:00:30.000Z')
    const run = (startedAt: string) => buildSubagentTree({ signals: [...signals, { kind: 'session-process', startedAt: at(startedAt) }], files: [] }).map(({ name, status }) => [name, status])
    expect(run('2026-09-12T11:00:00.000Z')).toEqual([['wave-03', 'interrupted']])
    expect(run('2026-09-12T09:00:00.000Z')).toEqual([['wave-03', 'running']])
  })

  it('interrupts a run known only by its folder when an agent of it was interrupted and none runs', () => {
    const { files } = loadWorkflow('2026-09-12T10:05:30.000Z', 5)
    const tree = buildSubagentTree({ signals: [{ kind: 'session-process', startedAt: at('2026-09-12T10:05:10.000Z') }], files })
    expect(rows(tree).map(({ status }) => status)).toEqual(['interrupted', 'done', 'interrupted', 'interrupted'])
  })

  it('groups the agents of a run whose Workflow call is not known under the run id', () => {
    const { files } = loadWorkflow()
    const tree = buildSubagentTree({ signals: [], files })
    expect(rows(tree)).toEqual([
      { id: `workflow:${RUN}`, name: RUN, subagentType: 'workflow', status: 'done', depth: 1 },
      { id: 'agent:a8100000000000260', name: 'impl:03', subagentType: 'workflow-subagent', status: 'done', depth: 2 },
      { id: 'agent:a8200000000000260', name: null, subagentType: 'workflow-subagent', status: 'error', depth: 2 },
      { id: 'agent:a8300000000000260', name: 'scout:03', subagentType: 'Explore', status: 'done', depth: 2 },
    ])
  })

  it('shows a resumed run once, under the call that resumed it', () => {
    const { files } = loadWorkflow()
    const workflow = (id: string, input: Record<string, unknown>): AgentEvent => ({ type: 'tool_use', id, name: 'Workflow', input, parentToolUseId: null })
    const launched = (id: string): AgentEvent => ({ type: 'tool_result', toolUseId: id, content: `Workflow launched in background. Task ID: t-${id}\nRun ID: ${RUN}`, isError: false, parentToolUseId: null })
    const signals = live([
      [1000, workflow('toolu_first', { script: "export const meta = { name: 'wave-03' }" })],
      [1001, launched('toolu_first')],
      [2000, { type: 'subagent', phase: 'finished', taskId: 't-toolu_first', toolUseId: 'toolu_first', description: null, subagentType: null, status: 'failed', summary: 'Dynamic workflow failed', result: null }],
      [3000, workflow('toolu_again', { scriptPath: `/x/wave-03-${RUN}.js`, resumeFromRunId: RUN })],
      [3001, launched('toolu_again')],
    ])
    const tree = buildSubagentTree({ signals, files })
    expect(tree.map(({ id, status, children }) => [id, status, children.length])).toEqual([['toolu_again', 'running', 3]])
  })

  it('does not take a Workflow result for an Agent result, nor a Bash call that mentions a run for a run', () => {
    const signals = live([
      [1000, { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: `ls subagents/workflows/${RUN}` }, parentToolUseId: null }],
      [1001, { type: 'tool_result', toolUseId: 'toolu_bash', content: `Run ID: ${RUN}`, isError: false, parentToolUseId: null }],
    ])
    expect(signals).toEqual([])
    expect(buildSubagentTree({ signals, files: [] })).toEqual([])
  })
})
