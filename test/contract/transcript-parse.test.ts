import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseTranscriptLine,
  parseTranscriptLines,
  transcriptEventSchema,
  type TranscriptEvent,
  type TranscriptEventKind,
} from '../../src/shared/transcript/parse'

// Fixtures from ticket 09: one synthetic transcript per Claude Code version, written by hand in
// the shape of real transcripts (test/fixtures/claude-home/README.md).
const projects = join(import.meta.dirname, '..', 'fixtures', 'claude-home', 'projects')

const eventsOf = (file: string): TranscriptEvent[] =>
  parseTranscriptLines(readFileSync(join(projects, file), 'utf8').split('\n').filter((line) => line.length > 0))
const kinds = (events: TranscriptEvent[]): TranscriptEventKind[] => events.map((event) => event.kind)

const S1 = '-Users-test-projects-demo/11111111-1111-4111-8111-111111111111.jsonl'
const S2 = '-Users-test-projects-demo/22222222-2222-4222-8222-222222222222.jsonl'
const S2_AGENT = '-Users-test-projects-demo/22222222-2222-4222-8222-222222222222/subagents/agent-a0000000000000247.jsonl'
const S3 = '-Users-test-My-Projects-demo-app/33333333-3333-4333-8333-333333333333.jsonl'
const S4 = '-Users-test-projects-demo--claude-worktrees-07/44444444-4444-4444-8444-444444444444.jsonl'
const S5 = '-Users-test-projects-demo/55555555-5555-4555-8555-555555555555.jsonl'
const S5_AGENT1 = '-Users-test-projects-demo/55555555-5555-4555-8555-555555555555/subagents/agent-a1000000000000286.jsonl'
const S5_AGENT2 = '-Users-test-projects-demo/55555555-5555-4555-8555-555555555555/subagents/agent-a2000000000000286.jsonl'
const S6 = '-Users-test-------/66666666-6666-4666-8666-666666666666.jsonl'

// Every event of every fixture, in order. A changed parser must change this table on purpose.
const expected: [file: string, version: string, kinds: TranscriptEventKind[]][] = [
  [
    S1,
    '2.1.222',
    ['unknown', 'unknown', 'text', 'unknown', 'thinking', 'text', 'tool_use', 'tool_result', 'text', 'hook', 'title', 'title', 'unknown', 'unknown'],
  ],
  [S2, '2.1.247', ['command', 'text', 'tool_use', 'tool_result', 'subagent', 'hook', 'text', 'hook', 'title', 'unknown']],
  [S2_AGENT, '2.1.247', ['text', 'tool_use', 'tool_result', 'text']],
  [S3, '2.1.270', ['unknown', 'unknown', 'text', 'unknown', 'thinking', 'tool_use', 'tool_result', 'text', 'hook', 'unknown', 'unknown', 'unknown']],
  [
    S4,
    '2.1.284',
    ['unknown', 'unknown', 'text', 'tool_use', 'tool_result', 'unknown', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'text', 'hook', 'hook', 'title', 'title', 'unknown', 'unknown'],
  ],
  [
    S5,
    '2.1.286',
    ['unknown', 'unknown', 'command', 'unknown', 'thinking', 'tool_use', 'tool_result', 'subagent', 'text', 'hook', 'subagent', 'text', 'title', 'title', 'unknown', 'unknown'],
  ],
  [S5_AGENT1, '2.1.286', ['text', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'text']],
  [S5_AGENT2, '2.1.286', ['text', 'tool_use', 'tool_result', 'text']],
  [S6, '2.1.286', ['text', 'text', 'unknown']],
]

describe('transcript parsing on the ticket 09 fixtures', () => {
  it.each(expected)('%s (Claude Code %s) gives the expected events', (file, version, expectedKinds) => {
    const lines = readFileSync(join(projects, file), 'utf8').split('\n').filter((line) => line.length > 0)
    // The fixture really is of the version the table says.
    expect(lines.some((line) => line.includes(`"version":"${version}"`))).toBe(true)
    const events = eventsOf(file)
    expect(kinds(events)).toEqual(expectedKinds)
    // Every event is inside the contract the IPC channel sends, unchanged by parsing it.
    for (const event of events) expect(transcriptEventSchema.parse(event)).toStrictEqual(event)
  })

  it('reads text, thinking, tool calls and their results', () => {
    const events = eventsOf(S3)
    expect(events.find((e) => e.kind === 'text' && e.role === 'user')).toMatchObject({ text: 'Synthetic prompt three.', isMeta: false, sidechain: false })
    const toolUse = events.find((e) => e.kind === 'tool_use')
    const toolResult = events.find((e) => e.kind === 'tool_result')
    expect(toolUse).toMatchObject({ name: 'Bash' })
    expect(toolResult).toMatchObject({ isError: false })
    expect(toolUse?.kind === 'tool_use' && toolResult?.kind === 'tool_result' && toolResult.toolUseId === toolUse.id).toBe(true)
    expect(events.find((e) => e.kind === 'unknown' && e.recordType === 'system')).toMatchObject({ subtype: 'turn_duration', reason: 'unknown-type' })
  })

  it('reads a slash command and marks the injected skill text as meta', () => {
    const events = eventsOf(S2)
    expect(events[0]).toMatchObject({ kind: 'command', name: '/demo-skill' })
    expect(events[1]).toMatchObject({ kind: 'text', role: 'user', isMeta: true, text: 'Synthetic skill body text.' })
  })

  it('links a synchronous Agent call to its Subagent', () => {
    const subagent = eventsOf(S2).find((e) => e.kind === 'subagent')
    expect(subagent).toMatchObject({ phase: 'started', subagentId: 'a0000000000000247', status: 'completed' })
  })

  it('reads a background Agent launch and its task-notification', () => {
    const events = eventsOf(S5)
    const [started, notified] = events.filter((e) => e.kind === 'subagent')
    expect(started).toMatchObject({ phase: 'started', subagentId: 'a1000000000000286', toolUseId: 'toolu_01S5AGENT1XXXXXXXXXXXXXX', status: 'async_launched' })
    expect(notified).toMatchObject({
      phase: 'notification',
      subagentId: 'a1000000000000286',
      toolUseId: 'toolu_01S5AGENT1XXXXXXXXXXXXXX',
      status: 'completed',
      result: 'Synthetic implementer final report.',
    })
    expect(events.find((e) => e.kind === 'command')).toMatchObject({ name: '/epic-wave', args: 'demo-epic 1' })
  })

  it('reads hooks from the Stop summary and from hook attachments', () => {
    const hooks = eventsOf(S2).filter((e) => e.kind === 'hook')
    expect(hooks[0]).toMatchObject({ source: 'attachment', hookEvent: 'Stop', outcome: 'success', exitCode: 0, stdout: 'synthetic stop hook stdout', commands: ['/Users/test/.claude/hooks/stop.sh'] })
    expect(hooks[1]).toMatchObject({ source: 'stop_hook_summary', hookEvent: 'Stop', commands: ['/Users/test/.claude/hooks/stop.sh'] })
  })

  it('reads titles in the order they were written', () => {
    const titles = eventsOf(S1).filter((e) => e.kind === 'title')
    expect(titles).toMatchObject([
      { source: 'ai', title: 'Synthetic generated title' },
      { source: 'custom', title: 'Synthetic custom title one' },
    ])
    expect(eventsOf(S4).filter((e) => e.kind === 'title')).toMatchObject([
      { source: 'custom', title: 'Ship demo-epic 07' },
      { source: 'agent', title: 'ship-demo-epic-07' },
    ])
  })

  it('marks every record of a Subagent with its agentId', () => {
    for (const [file, agentId] of [
      [S2_AGENT, 'a0000000000000247'],
      [S5_AGENT1, 'a1000000000000286'],
      [S5_AGENT2, 'a2000000000000286'],
    ] as const) {
      for (const event of eventsOf(file)) expect(event).toMatchObject({ sidechain: true, agentId })
    }
    for (const event of eventsOf(S5)) expect(event.sidechain).toBe(false)
  })

  it('names the attachment type of an attachment it does not know', () => {
    expect(eventsOf(S4).find((e) => e.kind === 'unknown' && e.recordType === 'attachment')).toMatchObject({ subtype: 'invoked_skills' })
  })
})

describe('transcript parsing of records it does not know', () => {
  it('turns an unknown record type into an unknown event and goes on', () => {
    const events = parseTranscriptLines([
      JSON.stringify({ type: 'brand-new-record', uuid: 'u1', timestamp: '2026-10-05T00:00:00.000Z', extra: { deep: [1, 2] } }),
      JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'still parsed' } }),
    ])
    expect(events).toStrictEqual([
      { kind: 'unknown', reason: 'unknown-type', recordType: 'brand-new-record', uuid: 'u1', timestamp: '2026-10-05T00:00:00.000Z', sidechain: false },
      { kind: 'text', role: 'user', text: 'still parsed', isMeta: false, uuid: 'u2', sidechain: false },
    ])
  })

  it('turns an unknown content block into an unknown event next to the known ones', () => {
    const events = parseTranscriptLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'hologram', data: 1 }, { type: 'text', text: 'ok', citations: [] }] } }),
    )
    expect(kinds(events)).toEqual(['unknown', 'text'])
    expect(events[0]).toMatchObject({ recordType: 'assistant', subtype: 'hologram' })
  })

  it('keeps only the fields of the contract, not the extra fields of the record', () => {
    const [event] = parseTranscriptLine(
      JSON.stringify({ type: 'assistant', uuid: 'u', newField: 'x', message: { content: [{ type: 'thinking', thinking: 't', signature: 'secret-signature' }] } }),
    )
    expect(event).toStrictEqual({ kind: 'thinking', text: 't', uuid: 'u', sidechain: false })
  })

  it.each([
    ['a line that is not JSON', '{"type":"user", "message":', 'unparsable'],
    ['a JSON value that is not an object', '[1,2,3]', 'invalid-shape'],
    ['a user record without a message', '{"type":"user"}', 'invalid-shape'],
    ['an assistant record whose content is not a list', '{"type":"assistant","message":{"content":"x"}}', 'invalid-shape'],
    ['a title record without its title', '{"type":"custom-title"}', 'invalid-shape'],
  ])('turns %s into an unknown event without throwing', (_, line, reason) => {
    const events = parseTranscriptLine(line)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'unknown', reason })
  })
})
