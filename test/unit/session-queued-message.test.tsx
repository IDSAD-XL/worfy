import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { sdkMessageToEvents } from '../../src/shared/vendors/claude/events'
import { mainThreadEvents, parseTranscriptLines } from '../../src/shared/transcript/parse'
import { foldTranscript } from '../../src/renderer/session/fold'
import { acceptAgentEvent, joinPastAndLive, useSessionLogs } from '../../src/renderer/session/store'

// worfy-polish ticket 114: a message the user sent while Claude Code was still in a turn worfy did
// not count as one (the turn a background task's task-notification started) is given to Claude
// Code at once; Claude Code queues it and takes it into that turn. Its transcript file then holds
// the message only as a `queue-operation` and an `attachment` of type `queued_command` — no user
// record. A view that reads that part of the conversation from the file (the Orchestrator after
// Autopilot started it again, any Session after a restart of worfy) must still show the message.

const SESSION = 'session-114'
const TYPED = 'Did it stop again?'
const COMMAND = '/worfy:epic-wave tickets 03 of epic sample'

const record = (fields: Record<string, unknown>): string => JSON.stringify({ sessionId: SESSION, isSidechain: false, timestamp: '2026-11-14T21:46:16.000Z', ...fields })
const assistant = (id: string, content: unknown[]): Record<string, unknown> => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', role: 'assistant', content }, parent_tool_use_id: null })
const NOTIFICATION = '<task-notification>\n<task-id>bg_1</task-id>\n<status>completed</status>\n</task-notification>'

/** The file: a turn, the turn a task-notification started, the user's message taken into it, the answer. */
const file = [
  record({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Run the wave' } }),
  record({ type: 'assistant', uuid: 'a1', ...assistant('msg_a', [{ type: 'text', text: 'Started a background agent.' }]) }),
  record({ type: 'queue-operation', operation: 'enqueue', content: NOTIFICATION }),
  record({ type: 'attachment', uuid: 't1', attachment: { type: 'queued_command', prompt: NOTIFICATION, commandMode: 'task-notification' } }),
  record({ type: 'queue-operation', operation: 'remove' }),
  record({ type: 'assistant', uuid: 'a2', ...assistant('msg_b', [{ type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'gh pr list' } }]) }),
  record({ type: 'queue-operation', operation: 'enqueue', content: TYPED }),
  record({ type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' }] } }),
  record({ type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt: TYPED, commandMode: 'prompt' } }),
  record({ type: 'queue-operation', operation: 'remove' }),
  record({ type: 'assistant', uuid: 'a3', ...assistant('msg_c', [{ type: 'text', text: 'No, the wave goes on.' }]) }),
]

const result = (text: string): AgentEventEnvelope['event'] =>
  sdkMessageToEvents({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0, duration_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })[0] as AgentEventEnvelope['event']

const prompts = (events: readonly AgentEvent[]): string[] => foldTranscript(events).flatMap((item) => (item.kind === 'prompt' ? [item.text] : []))

describe('a message Claude Code took into a running turn (worfy-polish ticket 114)', () => {
  beforeEach(() => useSessionLogs.setState({ logs: {} }))

  it('reads it from the transcript file as the user message it was', () => {
    expect(prompts(mainThreadEvents(parseTranscriptLines(file)))).toEqual(['Run the wave', TYPED])
  })

  it('still shows it once Autopilot started the Orchestrator again and sent its command', () => {
    // The live Session the user wrote in: the message went to Claude Code at once (main's `prompt`).
    const old: AgentEventEnvelope['event'][] = [
      { type: 'prompt', text: TYPED },
      ...sdkMessageToEvents(assistant('msg_c', [{ type: 'text', text: 'No, the wave goes on.' }])),
      result('No, the wave goes on.'),
    ]
    for (const event of old) acceptAgentEvent({ sessionId: SESSION, event })
    // Autopilot's run starts the Orchestrator again: a new Session, `pending-…` until its init.
    const PENDING = 'pending-114'
    acceptAgentEvent({ sessionId: PENDING, event: { type: 'state', state: 'idle', error: null } })
    acceptAgentEvent({ sessionId: PENDING, event: { type: 'prompt', text: COMMAND } })
    const past = mainThreadEvents(parseTranscriptLines(file))
    const shown = (id: string) => prompts(joinPastAndLive(past, useSessionLogs.getState().logs[id]?.events ?? []))
    expect(shown(PENDING)).toEqual(['Run the wave', TYPED, COMMAND])
  })

  it('shows it once in the view of the Session the user wrote in, from the live events', () => {
    const live: AgentEventEnvelope['event'][] = [
      ...sdkMessageToEvents(assistant('msg_b', [{ type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'gh pr list' } }])),
      { type: 'prompt', text: TYPED },
      ...sdkMessageToEvents({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' }] }, parent_tool_use_id: null }),
      ...sdkMessageToEvents(assistant('msg_c', [{ type: 'text', text: 'No, the wave goes on.' }])),
      result('No, the wave goes on.'),
    ]
    for (const event of live) acceptAgentEvent({ sessionId: SESSION, event })
    const events = useSessionLogs.getState().logs[SESSION]?.events ?? []
    expect(prompts(joinPastAndLive(mainThreadEvents(parseTranscriptLines(file)), events))).toEqual(['Run the wave', TYPED])
    // The file read before the message went into it.
    expect(prompts(joinPastAndLive(mainThreadEvents(parseTranscriptLines(file.slice(0, 6))), events))).toEqual(['Run the wave', TYPED])
  })

  it('shows it once when the live events start at the message itself', () => {
    const live: AgentEventEnvelope['event'][] = [
      { type: 'prompt', text: TYPED },
      ...sdkMessageToEvents(assistant('msg_c', [{ type: 'text', text: 'No, the wave goes on.' }])),
      result('No, the wave goes on.'),
    ]
    for (const event of live) acceptAgentEvent({ sessionId: SESSION, event })
    const events = useSessionLogs.getState().logs[SESSION]?.events ?? []
    expect(prompts(joinPastAndLive(mainThreadEvents(parseTranscriptLines(file)), events))).toEqual(['Run the wave', TYPED])
  })

  it('reads a queued message from another Session or agent as synthetic text, not as the user\'s', () => {
    const PEER = '<cross-session-message from="another-session">Please look at the build.</cross-session-message>'
    const line = record({ type: 'attachment', uuid: 'q3', attachment: { type: 'queued_command', prompt: PEER, commandMode: 'prompt', isMeta: true, origin: { kind: 'peer' } } })
    const events = mainThreadEvents(parseTranscriptLines([line]))
    expect(events).toEqual([expect.objectContaining({ type: 'notice', kind: 'synthetic', text: PEER })])
    expect(prompts(events)).toEqual([])
  })

  it('reads a queued task-notification, and a queued command with no commandMode, as unknown only, as before', () => {
    const notification = mainThreadEvents(parseTranscriptLines(file.slice(3, 4)))
    expect(notification.map((event) => event.type)).toEqual(['unknown'])
    const forward = record({ type: 'attachment', uuid: 'q4', attachment: { type: 'queued_command', prompt: 'Look at the failing check', origin: { kind: 'agent_intent_forward' } } })
    expect(mainThreadEvents(parseTranscriptLines([forward])).map((event) => event.type)).toEqual(['unknown'])
  })

  it('reads a queued message with an image as one prompt with its attachment', () => {
    const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const prompt = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PIXEL } }, { type: 'text', text: `${TYPED}\n\nAttached images: shot.png` }]
    const line = record({ type: 'attachment', uuid: 'q2', attachment: { type: 'queued_command', prompt, commandMode: 'prompt' } })
    const items = foldTranscript(mainThreadEvents(parseTranscriptLines([line], { imageRef: (data) => (data === PIXEL ? 'copy-of-shot' : null) })))
    expect(items).toEqual([expect.objectContaining({ kind: 'prompt', text: TYPED, attachments: [expect.objectContaining({ kind: 'image', name: 'shot.png', ref: 'copy-of-shot' })] })])
  })

  it('still shows it after a restart of worfy, with no live events', () => {
    expect(prompts(joinPastAndLive(mainThreadEvents(parseTranscriptLines(file)), []))).toEqual(['Run the wave', TYPED])
  })
})
