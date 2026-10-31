import { beforeEach, describe, expect, it } from 'vitest'
import { sdkMessageToEvents, type AgentEvent, type AgentEventEnvelope } from '../../src/shared/agent/events'
import { mainThreadEvents, parseTranscriptLines } from '../../src/shared/transcript/parse'
import { foldTranscript } from '../../src/renderer/session/fold'
import { acceptAgentEvent, joinPastAndLive, useSessionLogs } from '../../src/renderer/session/store'

// The turns a resumed Session had before (its transcript file) joined with the live events of the
// Session (worfy-daily ticket 22): a turn that is in both shows once.

const user = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const text = (messageId: string, body: string): AgentEvent => ({ type: 'text', text: body, messageId, parentToolUseId: null, synthetic: false })
const toolUse = (id: string): AgentEvent => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' }, parentToolUseId: null })
const toolResult = (toolUseId: string): AgentEvent => ({ type: 'tool_result', toolUseId, content: 'ok', isError: false, parentToolUseId: null })
const delta = (body: string): AgentEvent => ({ type: 'delta', kind: 'text', text: body, parentToolUseId: null })
const init: AgentEvent = {
  type: 'init',
  sdkSessionId: 's',
  model: 'claude-opus-5-5',
  permissionMode: 'default',
  apiKeySource: 'none',
  cwd: '/p',
  claudeCodeVersion: null,
  slashCommands: [],
}
const result: AgentEvent = {
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text: 'Third answer',
  costUsd: 0,
  durationMs: 1,
  numTurns: 1,
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted: false,
}

/** Two turns from before Resume. */
const before: AgentEvent[] = [user('First question'), text('msg_1', 'First answer'), user('Second question'), toolUse('tool_1'), toolResult('tool_1'), text('msg_2', 'Second answer')]
/** The turn after Resume, as the live Session brings it. */
const liveTurn: AgentEvent[] = [user('go on'), init, delta('Third '), toolUse('tool_3'), toolResult('tool_3'), text('msg_3', 'Third answer'), result]
/** The same turn as the transcript file records it. */
const writtenTurn: AgentEvent[] = [user('go on'), toolUse('tool_3'), toolResult('tool_3'), text('msg_3', 'Third answer')]

describe('joinPastAndLive', () => {
  it('shows the turns before Resume first, then the live ones', () => {
    expect(joinPastAndLive(before, liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows a turn that is in the transcript and in the live events once, from the live events', () => {
    expect(joinPastAndLive([...before, ...writtenTurn], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once a turn whose prompt the transcript has and whose answer it does not have yet', () => {
    expect(joinPastAndLive([...before, user('go on')], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once a turn the transcript has only partly written', () => {
    expect(joinPastAndLive([...before, user('go on'), toolUse('tool_3')], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once every live turn the transcript has, a later turn after a turn without an answer too', () => {
    const failed: AgentEvent[] = [user('try'), init]
    const live = [...failed, ...liveTurn]
    expect(joinPastAndLive([...before, user('try'), ...writtenTurn], live)).toEqual([...before, ...live])
  })

  it('shows once a turn whose prompt the transcript follows with an event the live events do not have', () => {
    const notice: AgentEvent = { type: 'notice', kind: 'synthetic', text: 'Hook context' }
    expect(joinPastAndLive([...before, user('go on'), notice, ...writtenTurn.slice(1)], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once a slash command the transcript records as a command', () => {
    const live: AgentEvent[] = [user('/compact now'), init, text('msg_4', 'Compacted')]
    const written: AgentEvent[] = [{ type: 'command', name: '/compact', args: 'now' }, text('msg_4', 'Compacted')]
    expect(joinPastAndLive([...before, ...written], live)).toEqual([...before, ...live])
  })

  it('keeps a turn before Resume whose prompt reads like a live one but which has an answer', () => {
    const past = [...before, user('go on'), text('msg_old', 'Old answer')]
    expect(joinPastAndLive(past, liveTurn)).toEqual([...past, ...liveTurn])
  })

  it('shows once a prompt with an image, which the live events name and the transcript sends as a block of its own', () => {
    const live: AgentEvent[] = [user('look\n\nAttached images: a.png'), init, text('msg_5', 'A cat')]
    expect(joinPastAndLive([...before, user('look')], live)).toEqual([...before, ...live])
    expect(joinPastAndLive([...before, user('look'), text('msg_5', 'A cat')], live)).toEqual([...before, ...live])
  })

  it('shows once a prompt with files, whose line both the live events and the transcript have', () => {
    const prompt = 'read these\n\nAttached files: /p/a.md'
    const live: AgentEvent[] = [user(prompt), init, text('msg_6', 'Read')]
    expect(joinPastAndLive([...before, user(prompt)], live)).toEqual([...before, ...live])
  })

  it('keeps a prompt from before Resume that an interruption closed, when the live turn has the same text', () => {
    const past = [...before, user('hi'), user('[Request interrupted by user]')]
    const live: AgentEvent[] = [user('hi'), init, text('msg_7', 'Hello')]
    expect(joinPastAndLive(past, live)).toEqual([...past, ...live])
    expect(joinPastAndLive([...past, user('hi'), text('msg_7', 'Hello')], live)).toEqual([...past, ...live])
  })

  it('takes from the transcript only as many prompts as the live events open with', () => {
    const live: AgentEvent[] = [user('hi'), init, text('msg_8', 'Hello')]
    expect(joinPastAndLive([...before, user('hi'), user('hi'), text('msg_8', 'Hello')], live)).toEqual([...before, user('hi'), ...live])
  })

  it('cannot tell a prompt from before Resume without answer or interruption from the same live one, and shows it once', () => {
    // A known gap: nothing in the file tells the two apart.
    const live: AgentEvent[] = [user('hi'), init, text('msg_9', 'Hello')]
    expect(joinPastAndLive([...before, user('hi')], live)).toEqual([...before, ...live])
  })

  it('keeps a prompt from before Resume without answer when the same text comes live after the turn the file has', () => {
    // Only the live prompts before the event the file has at the join point open the live part.
    const past = [...before, user('hi'), user('a'), text('msg_a', 'A')]
    const live: AgentEvent[] = [user('a'), text('msg_a', 'A'), user('hi'), text('msg_h', 'Hello')]
    expect(joinPastAndLive(past, live)).toEqual([...before, user('hi'), ...live])
  })

  it('while the file has none of the live ids, cannot tell a prompt from before Resume without answer from any same live one, and shows it once', () => {
    // A known gap (worfy-link ticket 41): until the file has the first live turn, every live prompt
    // may be in it. Once it has that turn, the prompt from before Resume shows again (the test above).
    const live: AgentEvent[] = [user('a'), text('msg_a', 'A'), user('hi'), text('msg_h', 'Hello')]
    expect(joinPastAndLive([...before, user('hi')], live)).toEqual([...before, ...live])
  })

  it('keeps every turn before Resume when no live event has come yet', () => {
    expect(joinPastAndLive(before, [])).toEqual(before)
  })

  it('shows only the live events while there is no transcript', () => {
    expect(joinPastAndLive([], liveTurn)).toEqual(liveTurn)
  })

  it('shows once a live turn the transcript has entirely, when the live events start in its middle', () => {
    // The oldest live events were dropped (KEEP_EVENTS): the transcript still has the whole turn.
    const live = liveTurn.slice(3)
    expect(joinPastAndLive([...before, ...writtenTurn], live)).toEqual([...before, user('go on'), ...live])
  })

  it('shows a live prompt once when the live events open with an event the transcript does not record', () => {
    // A background task's end that Claude Code took in without a turn: the live events have it,
    // the file only as a queue operation, which carries no id.
    const ended: AgentEvent = { type: 'subagent', phase: 'finished', taskId: 'bg_1', toolUseId: 'tool_bg', description: null, subagentType: null, status: 'completed', summary: null }
    const live = [ended, ...liveTurn]
    expect(joinPastAndLive([...before, ...writtenTurn], live)).toEqual([...before, ...live])
    expect(joinPastAndLive([...before, user('go on')], live)).toEqual([...before, ...live])
  })
})

// worfy-link ticket 41. A Session of Machine A shown in a window of Machine B: the window loaded
// (its live events start) between two turns, a background command of the earlier turn ended, then
// the user sent a message with an image on A. Claude Code wrote the prompt, its «Added by Claude
// Code» companion (isMeta, turnCompanion) and the answer; the window got the same turn live.
describe('joinPastAndLive: a message with an image in a window opened from another Machine', () => {
  const SESSION = 'session-41'
  const record = (fields: Record<string, unknown>): string => JSON.stringify({ sessionId: SESSION, isSidechain: false, timestamp: '2026-10-31T04:54:29.065Z', ...fields })
  const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const TYPED = 'Remove the inner ring of the switch'
  const assistant = (id: string, content: unknown[]): Record<string, unknown> => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', role: 'assistant', content }, parent_tool_use_id: null })

  /** The file: the earlier turn with its background command, the task's end as queue operations, then the turn with the image. */
  const file = [
    record({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Install the dependencies' } }),
    record({ type: 'assistant', uuid: 'a1', ...assistant('msg_a', [{ type: 'tool_use', id: 'tool_bg', name: 'Bash', input: { command: 'pnpm install', run_in_background: true } }]) }),
    record({ type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_bg', content: 'Command running in background with ID: bg_1' }] }, toolUseResult: { backgroundTaskId: 'bg_1' } }),
    record({ type: 'assistant', uuid: 'a2', ...assistant('msg_b', [{ type: 'text', text: 'Installing.' }]) }),
    record({ type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>bg_1</task-id>\n<status>completed</status>\n</task-notification>' }),
    record({ type: 'queue-operation', operation: 'remove', reason: 'absorbed_mid_turn' }),
    record({ type: 'queue-operation', operation: 'enqueue' }),
    record({ type: 'queue-operation', operation: 'dequeue' }),
    record({
      type: 'user',
      uuid: 'u3',
      imagePasteIds: [1],
      message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PIXEL } }, { type: 'text', text: `${TYPED}\n\nAttached images: switch.png` }] },
    }),
    record({ type: 'user', uuid: 'u4', parentUuid: 'u3', isMeta: true, turnCompanion: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /tmp/images/1.png]' }] } }),
    record({ type: 'assistant', uuid: 'a3', parentUuid: 'u4', ...assistant('msg_c', [{ type: 'thinking', thinking: '', signature: 's' }]) }),
    record({ type: 'assistant', uuid: 'a4', ...assistant('msg_c', [{ type: 'text', text: 'Done: the ring is gone.' }]) }),
  ]

  /** What the window got live, in order: the task's end, the prompt main reported, the answer. */
  const liveMessages: AgentEventEnvelope['event'][] = [
    ...sdkMessageToEvents({ type: 'system', subtype: 'task_notification', task_id: 'bg_1', tool_use_id: 'tool_bg', status: 'completed', summary: 'Background command completed' }),
    { type: 'prompt', text: TYPED, attachments: [{ kind: 'image', name: 'switch.png', mediaType: 'image/png', ref: null }] },
    ...sdkMessageToEvents(assistant('msg_c', [{ type: 'thinking', thinking: '' }])),
    ...sdkMessageToEvents(assistant('msg_c', [{ type: 'text', text: 'Done: the ring is gone.' }])),
    ...sdkMessageToEvents({ type: 'result', subtype: 'success', is_error: false, result: 'Done: the ring is gone.', total_cost_usd: 0, duration_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
  ]

  beforeEach(() => useSessionLogs.setState({ logs: {} }))

  it('shows the prompt once, the transcript read before the answer or after it', () => {
    for (const event of liveMessages) acceptAgentEvent({ sessionId: SESSION, event })
    const live = useSessionLogs.getState().logs[SESSION]?.events ?? []
    const prompts = (past: readonly AgentEvent[]) =>
      foldTranscript(joinPastAndLive(past, live)).flatMap((item) => (item.kind === 'prompt' ? [item.text] : []))
    const whole = mainThreadEvents(parseTranscriptLines(file))
    // The window read the file up to the companion, then up to the answer (it follows the file).
    const upToCompanion = mainThreadEvents(parseTranscriptLines(file.slice(0, 10)))
    expect(prompts(upToCompanion)).toEqual(['Install the dependencies', TYPED])
    expect(prompts(whole)).toEqual(['Install the dependencies', TYPED])
  })
})
