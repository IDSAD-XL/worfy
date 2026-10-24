import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentEvent, type AgentEvent } from '../../src/shared/agent/events'
import { claudeHomeTranscript } from '../../src/shared/ipc/claude-home'
import {
  mainThreadEvents,
  parseTranscriptLine,
  parseTranscriptLines,
  timedEvent,
  transcriptEntrySchema,
  type TranscriptEntry,
} from '../../src/shared/transcript/parse'

// Fixtures from ticket 09: one synthetic transcript per Claude Code version, written by hand in
// the shape of real transcripts (test/fixtures/claude-home/README.md). Since ticket 14 the parser
// gives the events of a live Session (src/shared/agent/events.ts), so one transcript view draws
// both sources.
const projects = join(import.meta.dirname, '..', 'fixtures', 'claude-home', 'projects')

const entriesOf = (file: string): TranscriptEntry[] =>
  parseTranscriptLines(readFileSync(join(projects, file), 'utf8').split('\n').filter((line) => line.length > 0))
const eventsOf = (file: string): AgentEvent[] => entriesOf(file).map((entry) => entry.event)
/** `type`, with what tells events of one type apart: the notice's kind, the unknown record's name. */
const label = (event: AgentEvent): string =>
  event.type === 'notice' ? `notice:${event.kind}` : event.type === 'unknown' ? `unknown:${event.sdkType}` : event.type
const labels = (events: AgentEvent[]): string[] => events.map(label)

const S1 = '-Users-test-projects-demo/11111111-1111-4111-8111-111111111111.jsonl'
const S2 = '-Users-test-projects-demo/22222222-2222-4222-8222-222222222222.jsonl'
const S2_AGENT = '-Users-test-projects-demo/22222222-2222-4222-8222-222222222222/subagents/agent-a0000000000000247.jsonl'
const S3 = '-Users-test-My-Projects-demo-app/33333333-3333-4333-8333-333333333333.jsonl'
const S4 = '-Users-test-projects-demo--claude-worktrees-07/44444444-4444-4444-8444-444444444444.jsonl'
const S5 = '-Users-test-projects-demo/55555555-5555-4555-8555-555555555555.jsonl'
const S5_AGENT1 = '-Users-test-projects-demo/55555555-5555-4555-8555-555555555555/subagents/agent-a1000000000000286.jsonl'
const S5_AGENT2 = '-Users-test-projects-demo/55555555-5555-4555-8555-555555555555/subagents/agent-a2000000000000286.jsonl'
const S6 = '-Users-test-------/66666666-6666-4666-8666-666666666666.jsonl'

const QUEUE = 'unknown:queue-operation'
const LAST_PROMPT = 'unknown:last-prompt'

// Every event of every fixture, in order. A changed parser must change this table on purpose.
// Hooks that said nothing (a Stop hook with exit 0 and no output) are left out, as a live
// Session leaves them out: S1, S3, S4 and S5 have one each, S2 one of two.
const expected: [file: string, version: string, labels: string[]][] = [
  [
    S1,
    '2.1.222',
    [QUEUE, QUEUE, 'notice:user', 'unknown:attachment/task_reminder', 'thinking', 'text', 'tool_use', 'tool_result', 'text', 'title', 'title', LAST_PROMPT, 'unknown:mode'],
  ],
  [S2, '2.1.247', ['command', 'notice:synthetic', 'tool_use', 'tool_result', 'subagent', 'subagent', 'hook', 'text', 'title', LAST_PROMPT]],
  [S2_AGENT, '2.1.247', ['notice:user', 'tool_use', 'tool_result', 'text']],
  [
    S3,
    '2.1.270',
    [QUEUE, QUEUE, 'notice:user', 'unknown:attachment/total_tokens_reminder', 'thinking', 'tool_use', 'tool_result', 'text', 'unknown:system/turn_duration', 'unknown:file-history-snapshot', LAST_PROMPT],
  ],
  [
    S4,
    '2.1.284',
    [QUEUE, QUEUE, 'notice:user', 'tool_use', 'tool_result', 'unknown:attachment/invoked_skills', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'text', 'title', 'title', 'unknown:pr-link', LAST_PROMPT],
  ],
  [
    S5,
    '2.1.286',
    [QUEUE, QUEUE, 'command', 'unknown:attachment/environment', 'thinking', 'tool_use', 'tool_result', 'subagent', 'text', 'subagent', 'text', 'title', 'title', 'unknown:bridge-session', LAST_PROMPT],
  ],
  [S5_AGENT1, '2.1.286', ['notice:user', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'text']],
  [S5_AGENT2, '2.1.286', ['notice:user', 'tool_use', 'tool_result', 'text']],
  [S6, '2.1.286', ['notice:user', 'text', LAST_PROMPT]],
]

describe('transcript parsing on the ticket 09 fixtures', () => {
  it.each(expected)('%s (Claude Code %s) gives the expected events', (file, version, expectedLabels) => {
    const lines = readFileSync(join(projects, file), 'utf8').split('\n').filter((line) => line.length > 0)
    // The fixture really is of the version the table says.
    expect(lines.some((line) => line.includes(`"version":"${version}"`))).toBe(true)
    const entries = entriesOf(file)
    expect(labels(entries.map((entry) => entry.event))).toEqual(expectedLabels)
    for (const entry of entries) {
      // Every entry is inside its schema, and every event inside the schema of a live Session's
      // events, which the IPC channel sends: unchanged by parsing it again.
      expect(transcriptEntrySchema.parse(entry)).toStrictEqual(entry)
      expect(agentEvent.parse(entry.event)).toStrictEqual(entry.event)
    }
  })

  it('reads prompts, text, thinking, tool calls and their results as a live Session does', () => {
    const events = eventsOf(S3)
    expect(events.find((e) => e.type === 'notice')).toStrictEqual({ type: 'notice', kind: 'user', text: 'Synthetic prompt three.' })
    const toolUse = events.find((e) => e.type === 'tool_use')
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolUse).toMatchObject({ name: 'Bash', parentToolUseId: null })
    expect(toolResult).toMatchObject({ isError: false, parentToolUseId: null })
    expect(toolUse?.type === 'tool_use' && toolResult?.type === 'tool_result' && toolResult.toolUseId === toolUse.id).toBe(true)
    const text = events.find((e) => e.type === 'text')
    expect(text).toMatchObject({ synthetic: false, parentToolUseId: null })
    expect(text?.type === 'text' && text.messageId.startsWith('msg_')).toBe(true)
    expect(events).toContainEqual({ type: 'unknown', sdkType: 'system/turn_duration' })
  })

  it('reads a slash command and marks the injected skill text as synthetic', () => {
    const events = eventsOf(S2)
    expect(events[0]).toStrictEqual({ type: 'command', name: '/demo-skill', args: 'synthetic args' })
    expect(events[1]).toStrictEqual({ type: 'notice', kind: 'synthetic', text: 'Synthetic skill body text.' })
  })

  it('links a synchronous Agent call to its Subagent and ends it with the same record', () => {
    const [started, finished] = eventsOf(S2).filter((e) => e.type === 'subagent')
    expect(started).toMatchObject({ phase: 'started', taskId: 'a0000000000000247', status: null })
    expect(finished).toMatchObject({ phase: 'finished', taskId: 'a0000000000000247', status: 'completed' })
  })

  it('reads a background Agent launch and its task-notification', () => {
    const events = eventsOf(S5)
    const [started, notified] = events.filter((e) => e.type === 'subagent')
    expect(started).toMatchObject({ phase: 'started', taskId: 'a1000000000000286', toolUseId: 'toolu_01S5AGENT1XXXXXXXXXXXXXX', status: null })
    expect(notified).toMatchObject({
      phase: 'finished',
      taskId: 'a1000000000000286',
      toolUseId: 'toolu_01S5AGENT1XXXXXXXXXXXXXX',
      status: 'completed',
      result: 'Synthetic implementer final report.',
    })
    expect(events.find((e) => e.type === 'command')).toStrictEqual({ type: 'command', name: '/epic-wave', args: 'demo-epic 1' })
  })

  it('keeps a hook that said something and drops the ones that did not', () => {
    const hooks = eventsOf(S2).filter((e) => e.type === 'hook')
    expect(hooks).toStrictEqual([
      { type: 'hook', hookEvent: 'Stop', hookName: '/Users/test/.claude/hooks/stop.sh', exitCode: 0, outcome: 'success', stdout: 'synthetic stop hook stdout', stderr: '' },
    ])
    const [blocked] = parseTranscriptLine(
      JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', hookInfos: [{ command: 'gate.sh' }], hookErrors: [], preventedContinuation: true, stopReason: 'gate red' }),
    )
    expect(blocked?.event).toStrictEqual({ type: 'hook', hookEvent: 'Stop', hookName: 'gate.sh', exitCode: null, outcome: 'blocked', stdout: 'gate red', stderr: '' })
    const [failed] = parseTranscriptLine(JSON.stringify({ type: 'attachment', attachment: { type: 'hook_non_blocking_error', hookEvent: 'PostToolUse', command: 'lint.sh', exitCode: 1, stderr: 'boom' } }))
    expect(failed?.event).toMatchObject({ type: 'hook', hookEvent: 'PostToolUse', hookName: 'lint.sh', exitCode: 1, outcome: 'non_blocking_error', stderr: 'boom' })
  })

  it('reads titles in the order they were written', () => {
    const titles = eventsOf(S1).filter((e) => e.type === 'title')
    expect(titles).toStrictEqual([
      { type: 'title', source: 'ai', title: 'Synthetic generated title' },
      { type: 'title', source: 'custom', title: 'Synthetic custom title one' },
    ])
    expect(eventsOf(S4).filter((e) => e.type === 'title')).toMatchObject([
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
      for (const entry of entriesOf(file)) expect(entry).toMatchObject({ sidechain: true, agentId })
    }
    for (const entry of entriesOf(S5)) expect(entry.sidechain).toBe(false)
  })

  it('leaves the records of a Subagent out of the Session thread', () => {
    const subagent = entriesOf(S2_AGENT)
    const own = entriesOf(S3)
    expect(mainThreadEvents(subagent)).toEqual([])
    expect(mainThreadEvents([...own.slice(0, 3), ...subagent, ...own.slice(3)])).toStrictEqual(own.map(timedEvent))
  })

  it('gives each event of the Session thread the time of its record, and none to a record without one (ticket 14)', () => {
    const own = entriesOf(S3)
    const events = mainThreadEvents(own)
    expect(events).toHaveLength(own.length)
    expect(own.filter((entry) => entry.timestamp !== undefined).length).toBeGreaterThan(0)
    own.forEach((entry, index) => {
      expect(events[index]).toStrictEqual(entry.timestamp === undefined ? entry.event : { ...entry.event, at: Date.parse(entry.timestamp) })
    })
    const event: AgentEvent = { type: 'notice', kind: 'user', text: 'hi' }
    expect(timedEvent({ sidechain: false, event })).toStrictEqual(event)
    expect(timedEvent({ sidechain: false, timestamp: 'not a time', event })).toStrictEqual(event)
  })

  it('names the attachment type of an attachment it does not know', () => {
    expect(eventsOf(S4)).toContainEqual({ type: 'unknown', sdkType: 'attachment/invoked_skills' })
  })
})

describe('transcript parsing of records it does not know', () => {
  it('turns an unknown record type into an unknown event and goes on', () => {
    const entries = parseTranscriptLines([
      JSON.stringify({ type: 'brand-new-record', uuid: 'u1', timestamp: '2026-10-05T00:00:00.000Z', extra: { deep: [1, 2] } }),
      JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'still parsed' } }),
    ])
    expect(entries).toStrictEqual([
      { uuid: 'u1', timestamp: '2026-10-05T00:00:00.000Z', sidechain: false, event: { type: 'unknown', sdkType: 'brand-new-record' } },
      { uuid: 'u2', sidechain: false, event: { type: 'notice', kind: 'user', text: 'still parsed' } },
    ])
  })

  it('turns an unknown content block into an unknown event next to the known ones', () => {
    const entries = parseTranscriptLine(
      JSON.stringify({ type: 'assistant', message: { id: 'm', content: [{ type: 'hologram', data: 1 }, { type: 'text', text: 'ok', citations: [] }] } }),
    )
    expect(entries.map((entry) => entry.event)).toStrictEqual([
      { type: 'unknown', sdkType: 'assistant/hologram' },
      { type: 'text', text: 'ok', messageId: 'm', parentToolUseId: null, synthetic: false },
    ])
  })

  it('keeps only the fields of the contract, not the extra fields of the record', () => {
    const [entry] = parseTranscriptLine(
      JSON.stringify({ type: 'assistant', uuid: 'u', newField: 'x', message: { id: 'm', content: [{ type: 'thinking', thinking: 't', signature: 'secret-signature' }] } }),
    )
    expect(entry).toStrictEqual({ uuid: 'u', sidechain: false, event: { type: 'thinking', text: 't', messageId: 'm', parentToolUseId: null } })
  })

  it('reads the output of a local command and the text Claude Code wrote itself', () => {
    const [local] = parseTranscriptLine(JSON.stringify({ type: 'user', message: { content: '<local-command-stdout>Total cost: $0.01</local-command-stdout>' } }))
    expect(local?.event).toStrictEqual({ type: 'notice', kind: 'local_command', text: 'Total cost: $0.01' })
    const [synthetic] = parseTranscriptLine(JSON.stringify({ type: 'assistant', message: { id: 'm', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } }))
    expect(synthetic?.event).toMatchObject({ type: 'text', synthetic: true })
  })

  it.each([
    ['a line that is not JSON', '{"type":"user", "message":', 'line:unparsable'],
    ['a JSON value that is not an object', '[1,2,3]', 'record:invalid'],
    ['a user record without a message', '{"type":"user"}', 'user:invalid'],
    ['an assistant record whose content is not a list', '{"type":"assistant","message":{"content":"x"}}', 'assistant:invalid'],
    ['a title record without its title', '{"type":"custom-title"}', 'custom-title:invalid'],
  ])('turns %s into an unknown event without throwing', (_, line, sdkType) => {
    expect(parseTranscriptLine(line)).toStrictEqual([{ sidechain: false, event: { type: 'unknown', sdkType } }])
  })
})

describe('the claudeHome.transcript answer', () => {
  const answer = (events: unknown[]) => ({ found: true, events, cursor: { offset: 0, fileId: null }, reset: false, more: false })

  it('carries the parsed events unchanged and drops keys outside the schema', () => {
    const events = eventsOf(S5)
    expect(claudeHomeTranscript.output.parse(answer(events)).events).toStrictEqual(events)
    const parsed = claudeHomeTranscript.output.parse(answer([{ type: 'command', name: '/x', args: '', secret: 'leak' }]))
    expect(parsed.events).toStrictEqual([{ type: 'command', name: '/x', args: '' }])
  })

  it('refuses an event of a wrong type, and the entry wrapper itself', () => {
    expect(claudeHomeTranscript.output.safeParse(answer([{ type: 'title', source: 'ai', title: 42 }])).success).toBe(false)
    expect(claudeHomeTranscript.output.safeParse(answer([{ type: 'hologram' }])).success).toBe(false)
    // The channel sends events, not entries: a raw entry is not an event.
    expect(claudeHomeTranscript.output.safeParse(answer(entriesOf(S6))).success).toBe(false)
  })
})

// Hook attachments in the shape Claude Code 2.1.291 writes them (worfy-daily ticket 25): a
// SessionStart hook's systemMessage and additionalContext come as attachments of their own, with
// the text in `content` (a string, an array of strings) and no command, exit code or stdout.
describe('transcript parsing of hook attachments', () => {
  const line = (attachment: Record<string, unknown>) =>
    JSON.stringify({ type: 'attachment', uuid: 'u1', timestamp: '2026-10-06T10:00:00.000Z', isSidechain: false, attachment })
  const eventOf = (attachment: Record<string, unknown>) => parseTranscriptLine(line(attachment)).map((entry) => entry.event)

  it('reads hook_system_message as a successful hook with its text', () => {
    const events = eventOf({ type: 'hook_system_message', content: 'Worktree /tmp/x is ready', hookName: 'SessionStart:startup', toolUseID: 't1', hookEvent: 'SessionStart' })
    expect(events).toStrictEqual([
      { type: 'hook', hookEvent: 'SessionStart', hookName: 'SessionStart:startup', exitCode: null, outcome: 'success', stdout: 'Worktree /tmp/x is ready', stderr: '' },
    ])
  })

  it('reads hook_additional_context as a successful hook with its texts, one per line', () => {
    const events = eventOf({ type: 'hook_additional_context', content: ['## Rules', 'Second context'], hookName: 'SessionStart', toolUseID: 'SessionStart', hookEvent: 'SessionStart' })
    expect(events).toStrictEqual([{ type: 'hook', hookEvent: 'SessionStart', hookName: 'SessionStart', exitCode: null, outcome: 'success', stdout: '## Rules\nSecond context', stderr: '' }])
  })

  it('keeps the error outcomes and their text', () => {
    expect(
      eventOf({ type: 'hook_non_blocking_error', hookName: 'SessionStart:startup', hookEvent: 'SessionStart', stderr: 'node: not found', stdout: '', exitCode: 127, command: 'lock claim' }),
    ).toStrictEqual([{ type: 'hook', hookEvent: 'SessionStart', hookName: 'lock claim', exitCode: 127, outcome: 'non_blocking_error', stdout: '', stderr: 'node: not found' }])
    expect(eventOf({ type: 'hook_error_during_execution', content: 'spawn failed', hookName: 'PostToolUse:Edit', hookEvent: 'PostToolUse' })).toStrictEqual([
      { type: 'hook', hookEvent: 'PostToolUse', hookName: 'PostToolUse:Edit', exitCode: null, outcome: 'error_during_execution', stdout: '', stderr: 'spawn failed' },
    ])
    expect(
      eventOf({ type: 'hook_blocking_error', hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', blockingError: { blockingError: 'git push refused', command: 'guard.mjs' } }),
    ).toStrictEqual([{ type: 'hook', hookEvent: 'PreToolUse', hookName: 'guard.mjs', exitCode: null, outcome: 'blocking_error', stdout: '', stderr: 'git push refused' }])
    expect(eventOf({ type: 'hook_stopped_continuation', message: 'gate red', hookName: 'PostToolUse:Bash', hookEvent: 'PostToolUse' })).toStrictEqual([
      { type: 'hook', hookEvent: 'PostToolUse', hookName: 'PostToolUse:Bash', exitCode: null, outcome: 'stopped_continuation', stdout: 'gate red', stderr: '' },
    ])
    expect(eventOf({ type: 'hook_cancelled', hookName: 'Stop', hookEvent: 'Stop', command: 'stop.sh', timedOut: true })).toStrictEqual([
      { type: 'hook', hookEvent: 'Stop', hookName: 'stop.sh', exitCode: null, outcome: 'cancelled', stdout: '', stderr: '' },
    ])
  })

  it('drops a successful output attachment with no text, as it drops a quiet hook', () => {
    expect(eventOf({ type: 'hook_system_message', content: '', hookName: 'SessionStart:startup', hookEvent: 'SessionStart' })).toStrictEqual([])
    expect(eventOf({ type: 'hook_additional_context', content: [], hookName: 'SessionStart', hookEvent: 'SessionStart' })).toStrictEqual([])
  })
})

// worfy-ui ticket 28: a message worfy sent with attachments, as Claude Code writes it into its
// transcript — image blocks, then a text block that ends with the attachment lines (messageText) —
// reads back as one user notice: the typed text and the attachments, no paths, no base64.
describe('transcript parsing of a message with attachments', () => {
  const PNG = 'iVBORw0KGgoAAAA'
  const GIF = 'R0lGODlhAQABAAAA'
  const refOf = (data: string) => `${data.length.toString(16).padStart(2, '0')}${'a'.repeat(62)}`
  const user = (content: unknown) => JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-25T10:00:00.000Z', isSidechain: false, message: { role: 'user', content } })
  const image = (data: string, mediaType = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
  const eventsOf = (line: string, imageRef?: (data: string) => string | null) => parseTranscriptLine(line, imageRef ? { imageRef } : {}).map((entry) => entry.event)

  it('gives the image blocks as images named by their copy, and the files of the line as chips by name', () => {
    const text = 'what is on these?\n\nAttached files: /Users/a/Downloads/spec.pdf, /p/notes.md\n\nAttached images: shot.png, anim.gif'
    const events = eventsOf(user([image(PNG), image(GIF, 'image/gif'), { type: 'text', text }]), refOf)
    expect(events).toStrictEqual([
      {
        type: 'notice',
        kind: 'user',
        text: 'what is on these?',
        attachments: [
          { kind: 'image', name: 'shot.png', mediaType: 'image/png', ref: refOf(PNG) },
          { kind: 'image', name: 'anim.gif', mediaType: 'image/gif', ref: refOf(GIF) },
          { kind: 'file', name: 'spec.pdf', ext: 'pdf' },
          { kind: 'file', name: 'notes.md', ext: 'md' },
        ],
      },
    ])
    expect(JSON.stringify(events)).not.toContain(PNG)
    expect(JSON.stringify(events)).not.toContain('/Users/a/Downloads')
    // It is an event of the schema the renderer checks.
    for (const event of events) expect(agentEvent.parse(event)).toStrictEqual(event)
  })

  it('reads a message with files only, which Claude Code keeps as a string', () => {
    expect(eventsOf(user('read these\n\nAttached files: C:\\Users\\a\\b.csv'))).toStrictEqual([
      { type: 'notice', kind: 'user', text: 'read these', attachments: [{ kind: 'file', name: 'b.csv', ext: 'csv' }] },
    ])
  })

  it('without imageRef an image has no copy to show; a block the line does not name gets a name of its own', () => {
    expect(eventsOf(user([image(PNG), image(PNG), { type: 'text', text: 'two\n\nAttached images: one.png' }]))).toStrictEqual([
      {
        type: 'notice',
        kind: 'user',
        text: 'two',
        attachments: [
          { kind: 'image', name: 'one.png', mediaType: 'image/png', ref: null },
          { kind: 'image', name: 'image-2.png', mediaType: 'image/png', ref: null },
        ],
      },
    ])
  })

  it('an image sent with no text, from a terminal or an older worfy, still makes a user message', () => {
    expect(eventsOf(user([image(PNG, 'image/jpeg')]), refOf)).toStrictEqual([
      { type: 'notice', kind: 'user', text: '', attachments: [{ kind: 'image', name: 'image-1.jpg', mediaType: 'image/jpeg', ref: refOf(PNG) }] },
    ])
  })

  it('an image block it cannot show stays an unknown event, and a plain message stays as it was', () => {
    expect(labels(eventsOf(user([{ type: 'image', source: { type: 'url', url: 'https://x/y.png' } }, { type: 'text', text: 'hi' }])))).toEqual(['unknown:user/image', 'notice:user'])
    expect(labels(eventsOf(user([image(PNG, 'image/bmp')])))).toEqual(['unknown:user/image'])
    expect(eventsOf(user('just text'))).toStrictEqual([{ type: 'notice', kind: 'user', text: 'just text' }])
  })

  it('leaves text the harness injected alone, attachment lines and all', () => {
    const line = JSON.stringify({ type: 'user', uuid: 'u2', isSidechain: false, isMeta: true, message: { role: 'user', content: 'skill body\n\nAttached files: /p/a.ts' } })
    expect(eventsOf(line)).toStrictEqual([{ type: 'notice', kind: 'synthetic', text: 'skill body\n\nAttached files: /p/a.ts' }])
  })
})
