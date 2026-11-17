// worfy-polish ticket 123: a message the owner sent to the Orchestrator two hours after its last turn
// reached Claude Code and got an answer, but the Session view showed no row for it. Between the two
// turns Autopilot gave the Orchestrator back: its Session was started again with `resume`, under a
// temporary `pending-…` id until the first system/init of the new process. The message's `prompt`
// went out under that id, then `renamed` moved it to the SDK session's id — where the store already
// kept the turns of the Session before. The store put what came under the temporary id before those
// older events, so the row stood above the earlier turns, out of sight.
//
// The paths of the rule «every message the agent got is shown once» and the orders of events around
// `renamed` that could break it. The orders follow what main sends, recorded on the real Session in
// test/unit/session-resume-event-order.test.ts. The events go through the renderer's own subscription
// to `agent.event`; what the Session view draws is folded from the store (and the transcript file).
import { act, renderHook } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { foldTranscript } from '../../src/renderer/session/fold'
import { ensureAgentEvents, joinPastAndLive, useSessionLog, useSessionLogs } from '../../src/renderer/session/store'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { mainThreadEvents, parseTranscriptLines } from '../../src/shared/transcript/parse'

const SDK = 'sdk-123'
const PENDING = 'pending-123'

const init: AgentEvent = { type: 'init', sdkSessionId: SDK, model: 'm', permissionMode: 'default', apiKeySource: 'none', cwd: '/p', claudeCodeVersion: null, slashCommands: [] }
const text = (messageId: string, body: string): AgentEvent => ({ type: 'text', text: body, messageId, parentToolUseId: null, synthetic: false })
const result: AgentEvent = {
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text: 'ok',
  costUsd: 0,
  durationMs: 1,
  numTurns: 1,
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted: false,
}
const state = (value: 'starting' | 'idle' | 'busy' | 'closed' | 'error'): AgentEvent => ({ type: 'state', state: value, error: null })

let deliver: ((payload: unknown) => void) | null = null
const emit = (sessionId: string, event: AgentEvent) => act(() => deliver?.({ sessionId, event }))

beforeAll(() => {
  const bridge = {
    invoke: () => Promise.resolve({ ok: false, error: 'not answered in this test' }),
    on: (channel: string, handler: (payload: unknown) => void) => {
      if (channel === 'agent.event') deliver = handler
      return 1
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  // The store subscribes once per renderer, as the app's first view makes it.
  ensureAgentEvents()
  if (deliver === null) throw new Error('the store did not subscribe to agent.event')
})

afterAll(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

beforeEach(() => useSessionLogs.setState({ logs: {} }))

/** The rows a Session view draws from the events it got. */
function rows(events: readonly AgentEvent[]): string[] {
  return foldTranscript(events).flatMap((item) => {
    if (item.kind === 'prompt') return [`prompt: ${item.text}`]
    if (item.kind === 'text') return [`text: ${item.text}`]
    if (item.kind === 'notice') return [`notice: ${item.text}`]
    if (item.kind === 'result') return ['result']
    return []
  })
}

/** The Session before the restart: one turn under the SDK session's id, then its Session closed. */
function turnBefore(): void {
  emit(SDK, state('starting'))
  emit(SDK, state('idle'))
  emit(SDK, { type: 'prompt', text: 'first question' })
  emit(SDK, state('busy'))
  emit(SDK, init)
  emit(SDK, text('msg_a', 'Answer A'))
  emit(SDK, result)
  emit(SDK, state('idle'))
  emit(SDK, state('closed'))
}

/** The new Session's process answers, once main renamed the Session back to the SDK id. */
function answer(): void {
  emit(SDK, init)
  emit(SDK, text('msg_b', 'Answer B'))
  emit(SDK, result)
}

const AFTER_RESTART = ['prompt: first question', 'text: Answer A', 'result', 'prompt: later question', 'text: Answer B', 'result']

/** The Session started again with `resume` takes a message: main's order (session-resume-event-order.test.ts). */
function messageAfterRestart(question: string): void {
  emit(PENDING, state('starting'))
  emit(PENDING, state('idle'))
  emit(PENDING, { type: 'prompt', text: question })
  emit(PENDING, state('busy'))
  emit(SDK, { type: 'renamed', from: PENDING })
  answer()
  emit(SDK, state('idle'))
}

const shown = (past: readonly AgentEvent[] = []): string[] => rows(joinPastAndLive(past, useSessionLogs.getState().logs[SDK]?.events ?? []))

describe('every message the agent got is shown once (worfy-polish ticket 123)', () => {
  it('a message sent after the agent process was started again stands after the turn before, not above it', () => {
    turnBefore()
    messageAfterRestart('later question')
    expect(useSessionLogs.getState().logs[PENDING]).toBeUndefined()
    expect(shown()).toEqual(AFTER_RESTART)
  })

  it('a message that waited in the queue of the new Session stands after the answer before it', () => {
    turnBefore()
    messageAfterRestart('later question')
    emit(SDK, { type: 'queue', items: [], paused: false })
    emit(SDK, { type: 'prompt', text: 'and one more' })
    emit(SDK, state('busy'))
    answer()
    expect(shown()).toEqual([...AFTER_RESTART, 'prompt: and one more', 'text: Answer B', 'result'])
  })

  it('the same text sent again after the restart is shown once in each turn', () => {
    turnBefore()
    messageAfterRestart('first question')
    expect(shown()).toEqual(['prompt: first question', 'text: Answer A', 'result', 'prompt: first question', 'text: Answer B', 'result'])
  })

  it('the message is shown once with the transcript file read again, before and after the file holds it', () => {
    turnBefore()
    messageAfterRestart('later question')
    const record = (fields: Record<string, unknown>): string => JSON.stringify({ sessionId: SDK, isSidechain: false, timestamp: '2026-11-17T16:26:48.560Z', ...fields })
    const answered = (id: string, body: string) => record({ type: 'assistant', uuid: `${id}-r`, message: { id, model: 'm', role: 'assistant', content: [{ type: 'text', text: body }] }, parent_tool_use_id: null })
    const file = [
      record({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'first question' } }),
      answered('msg_a', 'Answer A'),
      record({ type: 'queue-operation', operation: 'enqueue', content: 'later question' }),
      record({ type: 'queue-operation', operation: 'dequeue' }),
      record({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'later question' }, origin: { kind: 'human' } }),
      answered('msg_b', 'Answer B'),
    ]
    expect(shown(mainThreadEvents(parseTranscriptLines(file)))).toEqual(AFTER_RESTART)
    // Read before the new turn went into the file.
    expect(shown(mainThreadEvents(parseTranscriptLines(file.slice(0, 2))))).toEqual(AFTER_RESTART)
  })
})

describe('the orders of events around `renamed` (worfy-polish ticket 123)', () => {
  it('`prompt` before the Session view subscribes: the view that opens afterwards shows it once, after the turn before', () => {
    turnBefore()
    emit(PENDING, state('starting'))
    emit(PENDING, state('idle'))
    emit(PENDING, { type: 'prompt', text: 'later question' })
    emit(PENDING, state('busy'))
    emit(SDK, { type: 'renamed', from: PENDING })
    answer()
    const view = renderHook(() => useSessionLog(SDK))
    expect(rows(view.result.current.events)).toEqual(AFTER_RESTART)
  })

  it('`prompt` while the Session view still shows the temporary id: once the view follows the new id, it shows the message once, after the turn before', () => {
    turnBefore()
    emit(PENDING, state('starting'))
    emit(PENDING, state('idle'))
    const view = renderHook(({ id }) => useSessionLog(id), { initialProps: { id: PENDING } })
    emit(PENDING, { type: 'prompt', text: 'later question' })
    expect(rows(view.result.current.events)).toEqual(['prompt: later question'])
    // main publishes the Orchestrator's view under the new id before it sends `renamed`.
    view.rerender({ id: SDK })
    emit(SDK, { type: 'renamed', from: PENDING })
    answer()
    expect(rows(view.result.current.events)).toEqual(AFTER_RESTART)
  })

  it('the SDK echo of the message, after `renamed`, is dropped although the turn before ended without a result', () => {
    // The process before died in its turn: no result, so the echo of «first question» is still awaited.
    emit(SDK, { type: 'prompt', text: 'first question' })
    emit(SDK, init)
    emit(SDK, text('msg_a', 'Answer A'))
    emit(SDK, state('error'))
    emit(PENDING, state('idle'))
    emit(PENDING, { type: 'prompt', text: 'later question' })
    emit(SDK, { type: 'renamed', from: PENDING })
    emit(SDK, init)
    // Claude Code sends the message back before its answer.
    emit(SDK, { type: 'notice', kind: 'user', text: 'later question' })
    emit(SDK, text('msg_b', 'Answer B'))
    emit(SDK, result)
    expect(rows(useSessionLogs.getState().logs[SDK]?.events ?? [])).toEqual(['prompt: first question', 'text: Answer A', 'prompt: later question', 'text: Answer B', 'result'])
  })

  it('`renamed` before `prompt` (a Vendor that names its session at start): the message stands once after what the new Session showed before it', () => {
    turnBefore()
    emit(PENDING, state('starting'))
    emit(PENDING, { type: 'notice', kind: 'notification', text: 'Started again' })
    emit(PENDING, state('idle'))
    emit(SDK, { type: 'renamed', from: PENDING })
    const view = renderHook(() => useSessionLog(SDK))
    emit(SDK, { type: 'prompt', text: 'later question' })
    answer()
    expect(rows(view.result.current.events)).toEqual(['prompt: first question', 'text: Answer A', 'result', 'notice: Started again', 'prompt: later question', 'text: Answer B', 'result'])
  })

  it('takes the settings of the new Session, not those the Session before left under the same id', () => {
    const settings = (permissionMode: 'default' | 'bypassPermissions'): AgentEvent => ({ type: 'settings', settings: { model: null, effort: null, permissionMode } }) as AgentEvent
    emit(SDK, settings('bypassPermissions'))
    turnBefore()
    emit(PENDING, settings('default'))
    emit(PENDING, { type: 'prompt', text: 'later question' })
    emit(SDK, { type: 'renamed', from: PENDING })
    const log = useSessionLogs.getState().logs[SDK]
    expect(log?.settings).toMatchObject({ permissionMode: 'default' })
    expect(log?.echo).toBe('later question')
  })
})
