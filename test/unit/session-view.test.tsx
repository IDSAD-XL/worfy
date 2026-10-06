// The Session view (src/renderer/session/): folding a Session's events into transcript rows, the
// renderer's event store, the input field's keys and prompt history, its pickers and queue chip
// (composer/, ticket 19), the rail made of files in rail/, and opening the view by a double click
// on the Orchestrator's Node.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { foldTranscript } from '../../src/renderer/session/fold'
import { promptHistory, stepHistory } from '../../src/renderer/session/history'
import { collectRowTypes } from '../../src/renderer/session/rows/index'
import { collectRailBlocks, type RailBlockProps } from '../../src/renderer/session/rail/index'
import { collectComposerItems } from '../../src/renderer/session/composer/index'
import type { OutgoingMessage } from '../../src/renderer/session/MessageInput'
import { mainThreadEvents, parseTranscriptLines } from '../../src/shared/transcript/parse'

type Result = Extract<AgentEvent, { type: 'result' }>

const result = (overrides: Partial<Result> = {}): Result => ({
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text: 'done',
  costUsd: 0.0021,
  durationMs: 1200,
  numTurns: 1,
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted: false,
  ...overrides,
})

const prompt = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const text = (value: string, overrides: Partial<Extract<AgentEvent, { type: 'text' }>> = {}): AgentEvent => ({
  type: 'text',
  text: value,
  messageId: 'm1',
  parentToolUseId: null,
  synthetic: false,
  ...overrides,
})
const delta = (value: string, parentToolUseId: string | null = null): AgentEvent => ({ type: 'delta', kind: 'text', text: value, parentToolUseId })
const toolUse = (id: string, name: string, input: unknown, parentToolUseId: string | null = null): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId })
const toolResult = (toolUseId: string, content: string, isError = false): AgentEvent => ({ type: 'tool_result', toolUseId, content, isError, parentToolUseId: null })

/** A fixed clock for the row times (ticket 14): 2026-10-06 14:20:00, local time. */
const NOW = new Date(2026, 9, 6, 14, 20, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

describe('foldTranscript', () => {
  it('shows the user prompt, then the streamed text replaced in place by the whole block', () => {
    const streaming = foldTranscript([prompt('hi'), delta('Hel'), delta('lo')])
    expect(streaming.map((item) => item.kind)).toEqual(['prompt', 'text'])
    expect(streaming[1]).toMatchObject({ kind: 'text', text: 'Hello', streaming: true })

    const done = foldTranscript([prompt('hi'), delta('Hel'), delta('lo'), text('Hello, **world**'), result()])
    expect(done.map((item) => item.kind)).toEqual(['prompt', 'text', 'result'])
    expect(done[1]).toMatchObject({ kind: 'text', text: 'Hello, **world**', streaming: false })
  })

  it('groups consecutive tool calls and pairs each with its result', () => {
    const items = foldTranscript([
      toolUse('t1', 'Bash', { command: 'epic-status --json' }),
      toolResult('t1', '{}'),
      toolUse('t2', 'Read', { file_path: 'spec.md' }),
      toolResult('t2', 'no such file', true),
      text('next'),
      toolUse('t3', 'Grep', { pattern: 'x' }),
    ])
    expect(items.map((item) => item.kind)).toEqual(['tools', 'text', 'tools'])
    const first = items[0]
    expect(first?.kind === 'tools' && first.calls.map((call) => [call.name, call.result])).toEqual([
      ['Bash', { content: '{}', isError: false }],
      ['Read', { content: 'no such file', isError: true }],
    ])
    const last = items[2]
    expect(last?.kind === 'tools' && last.calls[0]?.result).toBeNull()
  })

  it("leaves a subagent's own text and tool calls out of the main thread", () => {
    const items = foldTranscript([toolUse('a1', 'Agent', { description: 'impl-07' }), delta('sub', 'a1'), text('inside', { parentToolUseId: 'a1' }), toolUse('s1', 'Bash', {}, 'a1')])
    expect(items).toHaveLength(1)
    expect(items[0]?.kind === 'tools' && items[0].calls.map((call) => call.id)).toEqual(['a1'])
  })

  it('puts a subagent on the row of the Agent call that started it, and finishes it there', () => {
    const items = foldTranscript([
      toolUse('a1', 'Agent', { description: 'impl-07' }),
      { type: 'subagent', phase: 'started', taskId: 'k1', toolUseId: 'a1', description: 'impl-07', subagentType: 'implementer', status: null, summary: null },
      { type: 'subagent', phase: 'finished', taskId: 'k1', toolUseId: 'a1', description: null, subagentType: null, status: 'completed', summary: 'PR #9' },
      { type: 'subagent', phase: 'started', taskId: 'k2', toolUseId: null, description: 'background', subagentType: null, status: null, summary: null },
    ])
    expect(items.map((item) => item.kind)).toEqual(['tools', 'subagent'])
    expect(items[0]?.kind === 'tools' && items[0].calls[0]?.subagent).toMatchObject({ taskId: 'k1', status: 'completed', summary: 'PR #9' })
    expect(items[1]).toMatchObject({ kind: 'subagent', run: { taskId: 'k2', status: null } })
  })

  it('marks an interrupted turn once, by its result, not by the "[Request interrupted by user]" message', () => {
    const items = foldTranscript([prompt('count'), delta('1 2 '), prompt('[Request interrupted by user]'), result({ isError: true, interrupted: true })])
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'text', 'result'])
    expect(items[1]).toMatchObject({ streaming: false })
  })

  it('shows hooks, notices other than prompts, and a Session error; draws nothing for bookkeeping', () => {
    const items = foldTranscript([
      { type: 'init', sdkSessionId: 's', model: 'm', permissionMode: 'default', apiKeySource: 'none', cwd: '/p', claudeCodeVersion: null, slashCommands: [] },
      { type: 'status', status: 'requesting', permissionMode: null },
      { type: 'hook', hookEvent: 'Stop', hookName: 'gate', exitCode: 2, outcome: 'error', stdout: '', stderr: 'red' },
      { type: 'notice', kind: 'local_command', text: 'compacted' },
      { type: 'unknown', sdkType: 'system/new' },
      { type: 'state', state: 'busy', error: null },
      { type: 'state', state: 'error', error: 'Claude Code exited' },
    ])
    expect(items.map((item) => item.kind)).toEqual(['hook', 'notice', 'error'])
    expect(items[2]).toMatchObject({ text: 'Claude Code exited' })
  })

  it('keys a row by the position of its event in the whole Session, so dropping older events keeps the keys', () => {
    const events = [prompt('a'), text('one'), prompt('b'), text('two')]
    const all = foldTranscript(events)
    const later = foldTranscript(events.slice(2), new Set(), 2)
    expect(later.map((item) => item.key)).toEqual(all.slice(2).map((item) => item.key))
  })

  it('gives each row the time of the event that opened it; a streamed answer takes the time of its whole block (ticket 14)', () => {
    const hook: AgentEvent = { type: 'hook', hookEvent: 'Stop', hookName: 'gate', exitCode: 0, outcome: 'success', stdout: '', stderr: '' }
    const streaming = foldTranscript([
      { ...prompt('hi'), at: NOW },
      { ...delta('Hel'), at: NOW + 1000 },
      { ...delta('lo'), at: NOW + 2000 },
    ])
    expect(streaming.map((item) => [item.kind, item.at])).toEqual([
      ['prompt', NOW],
      ['text', NOW + 1000],
    ])
    const done = foldTranscript([
      { ...prompt('hi'), at: NOW },
      { ...delta('Hel'), at: NOW + 1000 },
      { ...text('Hello'), at: NOW + 3000 },
      { ...hook, at: NOW + 4000 },
      prompt('a record without a time'),
    ])
    expect(done.map((item) => [item.kind, item.at])).toEqual([
      ['prompt', NOW],
      ['text', NOW + 3000],
      ['hook', NOW + 4000],
      ['prompt', null],
    ])
  })

  it('hands event types that a rows/ file draws to that file', () => {
    const items = foldTranscript([prompt('a'), { type: 'hook', hookEvent: 'Stop', hookName: 'g', exitCode: 0, outcome: 'success', stdout: 'ok', stderr: '' }], new Set(['hook']))
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'extension'])
  })
})

describe('prompt history', () => {
  it('lists what the user sent, oldest first, without the interruption message', () => {
    expect(promptHistory([prompt('one'), text('a'), prompt('[Request interrupted by user]'), prompt('two')])).toEqual(['one', 'two'])
  })

  it('brings back the typed text of a message with attachments, not the lines naming them', () => {
    const sent = prompt('look\n\nAttached files: /data/1/notes.txt\n\nAttached images: shot.png')
    expect(promptHistory([prompt('one'), sent, prompt('Attached images: only.png')])).toEqual(['one', 'look'])
  })

  it('steps to older prompts, stops at the oldest, and past the newest returns to an empty field', () => {
    const history = ['one', 'two', 'three']
    expect(stepHistory(history, null, 'older')).toEqual({ index: 2, text: 'three' })
    expect(stepHistory(history, 2, 'older')).toEqual({ index: 1, text: 'two' })
    expect(stepHistory(history, 0, 'older')).toEqual({ index: 0, text: 'one' })
    expect(stepHistory(history, 1, 'newer')).toEqual({ index: 2, text: 'three' })
    expect(stepHistory(history, 2, 'newer')).toEqual({ index: null, text: '' })
    expect(stepHistory(history, null, 'newer')).toBeNull()
    expect(stepHistory([], null, 'older')).toBeNull()
  })
})

describe('extension registries', () => {
  const Block = (props: RailBlockProps) => <p>{`block of ${props.nodeId}`}</p>

  it('collects rail blocks and composer items by `order`, and refuses a file without one', () => {
    expect(collectRailBlocks({ './Limits.tsx': { default: Block, order: 30 }, './Binding.tsx': { default: Block, order: 10 } }).map(({ id }) => id)).toEqual(['Binding', 'Limits'])
    expect(() => collectRailBlocks({ './Binding.tsx': { default: Block } })).toThrow(/order/)
    expect(collectComposerItems({ './Queued.tsx': { default: () => null, order: 1 } }).map(({ id }) => id)).toEqual(['Queued'])
  })

  it('collects transcript rows by event type and refuses a missing type or two files for one type', () => {
    const Row = () => null
    expect([...collectRowTypes({ './Permission.tsx': { default: Row, eventType: 'permission_request' } }).keys()]).toEqual(['permission_request'])
    expect(() => collectRowTypes({ './Permission.tsx': { default: Row } })).toThrow(/eventType/)
    expect(() => collectRowTypes({ './A.tsx': { default: Row, eventType: 'x' }, './B.tsx': { default: Row, eventType: 'x' } })).toThrow(/both draw 'x'/)
    expect(() => collectRowTypes({ './A.tsx': { eventType: 'x' } })).toThrow(/component/)
  })
})

// ---------------------------------------------------------------------------------------------
// Against a fake bridge: the store, the input field, the Session panel and the Node.

const view = (overrides: Partial<OrchestratorView> = {}): OrchestratorView => ({
  projectId: 'alpha',
  nodeId: 'orch',
  sessionId: 'pending-1',
  state: 'idle',
  error: null,
  model: 'claude-opus-5-5',
  costUsd: 0.0125,
  statusBlock: null,
  version: 1,
  ...overrides,
})

const DEFAULTS = { model: null, effort: null, permissionMode: 'bypassPermissions' } as const
const MODELS = [
  { value: null, displayName: 'Default (recommended)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', efforts: ['low', 'high'] },
  { value: 'haiku', displayName: 'Haiku', efforts: [] },
]

const asked: { channel: string; input: unknown }[] = []
const handlers = new Map<string, (payload: unknown) => void>()
let answers: Record<string, (input: unknown) => unknown>

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  handlers.clear()
  answers = {
    'orchestrator.view': () => ({ view: view() }),
    'orchestrator.open': () => view(),
    'agent.send': () => undefined,
    'agent.interrupt': () => ({ interrupted: true }),
    'agent.controls': () => ({ settings: DEFAULTS, queue: { items: [], paused: false } }),
    'agent.models': () => ({ models: MODELS }),
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const emit = (sessionId: string, event: AgentEvent) => act(() => handlers.get('agent.event')?.({ sessionId, event }))

describe('the event store', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('joins deltas, moves events to the new id on `renamed`, and drops an echo of the sent prompt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const store = await import('../../src/renderer/session/store')
    store.acceptAgentEvent({ sessionId: 'pending-1', event: { type: 'prompt', text: 'hello' } })
    store.acceptAgentEvent({ sessionId: 'pending-1', event: delta('a') })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: { type: 'renamed', from: 'pending-1' } })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: prompt('hello') })
    vi.setSystemTime(NOW + 5000)
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: delta('b') })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: delta('c') })
    const { logs } = store.useSessionLogs.getState()
    expect(logs['pending-1']).toBeUndefined()
    // Joined deltas keep the time of the first.
    expect(logs['sdk-1']?.events).toEqual([
      { ...prompt('hello'), at: NOW },
      { ...delta('abc'), at: NOW },
    ])
  })

  it('stamps a live event with the time it arrived, keeps it on the prompt row, and keeps a time the event already has (ticket 14)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const store = await import('../../src/renderer/session/store')
    store.acceptAgentEvent({ sessionId: 's', event: { type: 'prompt', text: 'hi' } })
    vi.setSystemTime(NOW + 61_000)
    store.acceptAgentEvent({ sessionId: 's', event: text('answer') })
    store.acceptAgentEvent({ sessionId: 's', event: { ...text('from a file'), at: NOW - DAY } })
    expect(store.useSessionLogs.getState().logs.s?.events.map((event) => [event.type, event.at])).toEqual([
      ['notice', NOW],
      ['text', NOW + 61_000],
      ['text', NOW - DAY],
    ])
  })

  it('keeps a prompt the user sends again after the turn ended', async () => {
    const store = await import('../../src/renderer/session/store')
    store.acceptAgentEvent({ sessionId: 's', event: { type: 'prompt', text: 'again' } })
    store.acceptAgentEvent({ sessionId: 's', event: result() })
    store.acceptAgentEvent({ sessionId: 's', event: prompt('again') })
    expect(store.useSessionLogs.getState().logs.s?.events.map((event) => event.type)).toEqual(['notice', 'result', 'notice'])
  })
})

describe('the event store: limits, queue and settings', () => {
  it('keeps the newest KEEP_EVENTS events of a Session and counts the dropped ones', async () => {
    const store = await import('../../src/renderer/session/store')
    for (let index = 0; index <= store.KEEP_EVENTS; index += 1) store.acceptAgentEvent({ sessionId: 's', event: prompt(`p${index}`) })
    const log = store.useSessionLogs.getState().logs.s
    expect(log?.events).toHaveLength(store.KEEP_EVENTS)
    expect(log?.events[0]).toMatchObject(prompt('p1'))
    expect(log?.events[store.KEEP_EVENTS - 1]).toMatchObject(prompt(`p${store.KEEP_EVENTS}`))
    expect(log?.first).toBe(1)
  })

  it('keeps only the latest queue and settings, outside the transcript, and moves them on `renamed`', async () => {
    const store = await import('../../src/renderer/session/store')
    store.acceptAgentEvent({ sessionId: 'pending-1', event: { type: 'settings', settings: DEFAULTS } })
    store.acceptAgentEvent({ sessionId: 'pending-1', event: { type: 'queue', items: [{ id: 'q1', text: 'one' }], paused: false } })
    store.acceptAgentEvent({ sessionId: 'pending-1', event: { type: 'queue', items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }], paused: true } })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: { type: 'renamed', from: 'pending-1' } })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: { type: 'settings', settings: { ...DEFAULTS, effort: 'low' } } })
    const log = store.useSessionLogs.getState().logs['sdk-1']
    expect(log?.events).toEqual([])
    expect(log?.queue).toEqual({ items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }], paused: true })
    expect(log?.settings).toEqual({ ...DEFAULTS, effort: 'low' })
  })

  it('loadControls fills in what no event brought, and never overwrites what one did', async () => {
    answers['agent.controls'] = () => ({ settings: { ...DEFAULTS, model: 'old' }, queue: { items: [{ id: 'q', text: 'from main' }], paused: false } })
    const store = await import('../../src/renderer/session/store')
    store.acceptAgentEvent({ sessionId: 's', event: { type: 'settings', settings: { ...DEFAULTS, model: 'new' } } })
    await store.loadControls('s')
    const log = store.useSessionLogs.getState().logs.s
    expect(log?.settings?.model).toBe('new')
    expect(log?.queue?.items).toEqual([{ id: 'q', text: 'from main' }])
  })
})

describe('MessageInput', () => {
  async function mountInput(props: { busy?: boolean; history?: string[]; onSend?: (message: OutgoingMessage) => Promise<string | null> } = {}) {
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const onSend = vi.fn(props.onSend ?? (() => Promise.resolve(null)))
    const onInterrupt = vi.fn()
    render(<MessageInput sessionId="s" busy={props.busy ?? false} history={props.history ?? []} recipient="Orchestrator" onSend={onSend} onInterrupt={onInterrupt} />)
    return { field: screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement, onSend, onInterrupt }
  }

  it('sends on Return and clears the field; Shift+Return does not send', async () => {
    const { field, onSend } = await mountInput()
    fireEvent.change(field, { target: { value: 'line 1' } })
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(onSend).toHaveBeenCalledWith({ text: 'line 1', attachments: [] })
    expect(field.value).toBe('')
  })

  it('does not send an empty or blank message', async () => {
    const { field, onSend } = await mountInput()
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('gives the text back with the error when sending fails', async () => {
    const { field } = await mountInput({ onSend: () => Promise.resolve('Session pending-1 is closed') })
    fireEvent.change(field, { target: { value: 'keep me' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(field.value).toBe('keep me')
    expect(screen.getByRole('alert').textContent).toBe('Session pending-1 is closed')
  })

  it('steps through the history with ↑ and ↓ in an empty field, and not over typed text', async () => {
    const { field } = await mountInput({ history: ['first', 'second'] })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.value).toBe('second')
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.value).toBe('first')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field.value).toBe('second')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field.value).toBe('')
    fireEvent.change(field, { target: { value: 'typed' } })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.value).toBe('typed')
  })

  it('while the Session is busy, shows Interrupt (Escape too) and Return queues the message', async () => {
    const { field, onSend, onInterrupt } = await mountInput({ busy: true })
    fireEvent.click(screen.getByTestId('input-interrupt'))
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Return to queue')).toBeTruthy()
    expect(screen.getByTestId('input-send').getAttribute('aria-label')).toBe('Queue message')
    fireEvent.change(field, { target: { value: 'later' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(onSend).toHaveBeenCalledWith({ text: 'later', attachments: [] })
    expect(field.value).toBe('')
  })
})

describe('composer: pickers and queue (ticket 19)', () => {
  async function mountInput(sessionId = 's') {
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    render(<MessageInput sessionId={sessionId} busy={false} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={() => undefined} />)
    // The pickers show nothing before main answered the settings and the models.
    await vi.waitFor(() => expect((screen.getByTestId('picker-model') as HTMLSelectElement).disabled).toBe(false))
    await screen.findByRole('option', { name: 'Sonnet' })
  }
  const select = (testId: string) => screen.getByTestId(testId) as HTMLSelectElement
  const options = (testId: string) => [...select(testId).options].map((option) => option.textContent)

  it('lists the models main answers and sends a picked one to agent.configure; shows what main reports back', async () => {
    answers['agent.configure'] = (input) => ({ ...DEFAULTS, ...(input as { change: object }).change })
    await mountInput()
    expect(options('picker-model')).toEqual(['Default (recommended)', 'Sonnet', 'Haiku'])
    expect(select('picker-model').value).toBe('')
    fireEvent.change(select('picker-model'), { target: { value: 'sonnet' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { model: 'sonnet' } } })
    // The picker follows main's `settings` event, not its own click.
    emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'sonnet' } })
    expect(select('picker-model').value).toBe('sonnet')
    fireEvent.change(select('picker-model'), { target: { value: '' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { model: null } } })
  })

  it("offers the picked model's effort levels; a model without effort disables the picker", async () => {
    await mountInput()
    expect(options('picker-effort')).toEqual(['effort default', 'effort low', 'effort medium', 'effort high', 'effort xhigh', 'effort max'])
    fireEvent.change(select('picker-effort'), { target: { value: 'high' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { effort: 'high' } } })
    emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'sonnet' } })
    expect(options('picker-effort')).toEqual(['effort default', 'effort low', 'effort high'])
    emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'haiku' } })
    expect(select('picker-effort').disabled).toBe(true)
    expect(options('picker-effort')).toEqual(['effort —'])
  })

  it('switching to a model that does not list the picked effort sends the effort back to default with the model', async () => {
    await mountInput()
    emit('s', { type: 'settings', settings: { ...DEFAULTS, effort: 'xhigh' } })
    fireEvent.change(select('picker-model'), { target: { value: 'sonnet' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { model: 'sonnet', effort: null } } })
    fireEvent.change(select('picker-model'), { target: { value: 'haiku' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { model: 'haiku', effort: null } } })
    // A level the new model lists stays.
    emit('s', { type: 'settings', settings: { ...DEFAULTS, effort: 'high' } })
    asked.length = 0
    fireEvent.change(select('picker-model'), { target: { value: 'sonnet' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { model: 'sonnet' } } })
  })

  it('offers the four permission modes with plain labels, bypass first', async () => {
    await mountInput()
    expect(options('picker-permissions')).toEqual(['Bypass permissions', 'Accept edits', 'Ask before tools', 'Plan only'])
    expect(select('picker-permissions').value).toBe('bypassPermissions')
    fireEvent.change(select('picker-permissions'), { target: { value: 'plan' } })
    expect(asked).toContainEqual({ channel: 'agent.configure', input: { sessionId: 's', change: { permissionMode: 'plan' } } })
  })

  it('says a change was not applied when main refuses it', async () => {
    await mountInput()
    fireEvent.change(select('picker-permissions'), { target: { value: 'acceptEdits' } })
    expect((await screen.findByTestId('pickers-error')).getAttribute('title')).toBe('no agent.configure')
  })

  it('shows "N queued" only with queued messages; each can be removed by its id', async () => {
    answers['agent.queueRemove'] = () => ({ removed: true })
    await mountInput()
    expect(screen.queryByTestId('queue-chip')).toBeNull()
    emit('s', { type: 'queue', items: [{ id: 'q1', text: 'first' }, { id: 'q2', text: 'second' }], paused: false })
    expect(screen.getByTestId('queue-chip').textContent).toBe('2 queued')
    expect(screen.queryByTestId('queue-send')).toBeNull()
    fireEvent.click(screen.getByTestId('queue-chip'))
    expect(screen.getAllByTestId('queue-item').map((item) => item.textContent)).toEqual(['first×', 'second×'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message 2' }))
    expect(asked).toContainEqual({ channel: 'agent.queueRemove', input: { sessionId: 's', id: 'q2' } })
    emit('s', { type: 'queue', items: [], paused: false })
    expect(screen.queryByTestId('queue-chip')).toBeNull()
  })

  it('a queue held after Interrupt offers Send queued', async () => {
    answers['agent.queueSend'] = () => undefined
    await mountInput()
    emit('s', { type: 'queue', items: [{ id: 'q1', text: 'first' }], paused: true })
    expect(screen.getByTestId('queue-chip').textContent).toBe('1 queued')
    fireEvent.click(screen.getByTestId('queue-send'))
    expect(asked).toContainEqual({ channel: 'agent.queueSend', input: { sessionId: 's' } })
  })
})

describe('SessionPanel', () => {
  async function mountPanel(blocks: Record<string, unknown> = {}) {
    const { SessionPanel } = await import('../../src/renderer/session/SessionView')
    const { collectRailBlocks: collect } = await import('../../src/renderer/session/rail/index')
    render(<SessionPanel projectId="alpha" projectName="alpha" nodeId="orch" blocks={collect(blocks)} />)
    await screen.findByText('claude-opus-5-5')
  }

  it('shows the header facts, sends a message as a prompt row, and draws the answer and the cost', async () => {
    await mountPanel()
    expect(screen.getByTestId('session-cost').textContent).toBe('$0.0125')
    expect(screen.queryByTestId('session-rail')).toBeNull()
    const field = screen.getByRole('textbox', { name: 'Message Orchestrator' })
    fireEvent.change(field, { target: { value: 'ответь блоком состояния' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(asked).toContainEqual({ channel: 'agent.send', input: { sessionId: 'pending-1', text: 'ответь блоком состояния' } })
    // The prompt row comes with main's `prompt` event: a queued message has none yet.
    expect(screen.queryByTestId('transcript-prompt')).toBeNull()
    emit('pending-1', { type: 'prompt', text: 'ответь блоком состояния' })
    expect(within(screen.getByTestId('transcript-prompt')).getByText('ответь блоком состояния')).toBeTruthy()

    emit('pending-1', { type: 'init', sdkSessionId: 'sdk-1', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', apiKeySource: 'none', cwd: '/p', claudeCodeVersion: null, slashCommands: [] })
    emit('pending-1', text('| a | b |\n| - | - |\n| 1 | 2 |'))
    emit('pending-1', result())
    expect(screen.getByTestId('session-permissions').textContent).toBe('bypass')
    expect(within(screen.getByTestId('transcript-text')).getByRole('table')).toBeTruthy()
    expect(screen.getByTestId('transcript-turn-done')).toBeTruthy()
  })

  it('takes the permission mode from a later system/status', async () => {
    await mountPanel()
    emit('pending-1', { type: 'init', sdkSessionId: 'sdk-1', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', apiKeySource: 'none', cwd: '/p', claudeCodeVersion: null, slashCommands: [] })
    expect(screen.getByTestId('session-permissions').textContent).toBe('bypass')
    emit('pending-1', { type: 'status', status: null, permissionMode: 'plan' })
    expect(screen.getByTestId('session-permissions').textContent).toBe('plan')
    // A status without a mode keeps the last one.
    emit('pending-1', { type: 'status', status: 'requesting', permissionMode: null })
    expect(screen.getByTestId('session-permissions').textContent).toBe('plan')
  })

  it('a message that was not sent never enters the transcript or the history', async () => {
    delete answers['agent.send']
    await mountPanel()
    const field = screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'not delivered' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(asked).toContainEqual({ channel: 'agent.send', input: { sessionId: 'pending-1', text: 'not delivered' } })
    expect(screen.getByRole('alert').textContent).toBe('no agent.send')
    expect(field.value).toBe('not delivered')
    expect(screen.queryByTestId('transcript-prompt')).toBeNull()
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.value).toBe('')
  })

  // The race left from ticket 33: the view recorded the prompt under the temporary id, `renamed`
  // moved it to the final id, and the take-back after a failed send looked under the old id, so the
  // undelivered prompt stayed in the transcript. Prompts now come only from main, after delivery.
  it('a send that fails while `renamed` arrives leaves no prompt under either id', async () => {
    let fail: (value: unknown) => void = () => undefined
    const bridge = (globalThis as unknown as { worfy: { invoke: (channel: string, input: unknown) => Promise<unknown> } }).worfy
    const invoke = bridge.invoke
    bridge.invoke = (channel, input) =>
      channel === 'agent.send'
        ? new Promise((resolve) => {
            fail = resolve
          })
        : invoke(channel, input)
    await mountPanel()
    const field = screen.getByRole('textbox', { name: 'Message Orchestrator' })
    fireEvent.change(field, { target: { value: 'lost' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    emit('sdk-1', { type: 'renamed', from: 'pending-1' })
    await act(async () => {
      fail({ ok: false, error: 'Session pending-1 is closed' })
      await Promise.resolve()
    })
    const store = await import('../../src/renderer/session/store')
    const prompts = Object.values(store.useSessionLogs.getState().logs).flatMap((log) => log.events.filter((event) => event.type === 'notice' && event.kind === 'user'))
    expect(prompts).toEqual([])
    expect(screen.getByRole('alert').textContent).toBe('Session pending-1 is closed')
  })

  it('shows the effort worfy asked for in the header, and — while it is the model default', async () => {
    await mountPanel()
    await vi.waitFor(() => expect(asked.some((each) => each.channel === 'agent.controls')).toBe(true))
    expect(screen.getByTestId('session-effort').textContent).toBe('—')
    emit('pending-1', { type: 'settings', settings: { ...DEFAULTS, effort: 'high' } })
    expect(screen.getByTestId('session-effort').textContent).toBe('high')
  })

  it('keeps the rows (and an opened Thinking) when the store drops the oldest events', async () => {
    const store = await import('../../src/renderer/session/store')
    const status: AgentEvent = { type: 'status', status: null, permissionMode: null }
    store.acceptAgentEvent({ sessionId: 'pending-1', event: status })
    store.acceptAgentEvent({ sessionId: 'pending-1', event: { type: 'thinking', text: 'a plan', messageId: 'm1', parentToolUseId: null } })
    for (let index = 2; index < store.KEEP_EVENTS; index += 1) store.acceptAgentEvent({ sessionId: 'pending-1', event: status })
    await mountPanel()
    const toggle = within(screen.getByTestId('thinking')).getByRole('button')
    fireEvent.click(toggle)
    expect(screen.getByText('a plan')).toBeTruthy()
    emit('pending-1', status)
    expect(store.useSessionLogs.getState().logs['pending-1']?.first).toBe(1)
    expect(within(screen.getByTestId('thinking')).getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('a plan')).toBeTruthy()
  })

  it('interrupts the running turn from the header', async () => {
    answers['orchestrator.view'] = () => ({ view: view({ state: 'busy' }) })
    await mountPanel()
    fireEvent.click(screen.getByTestId('session-interrupt'))
    expect(asked).toContainEqual({ channel: 'agent.interrupt', input: { sessionId: 'pending-1' } })
  })

  it('draws a rail block from a file in rail/ without any change to the panel', async () => {
    await mountPanel({ './Binding.tsx': { default: (props: RailBlockProps) => <p>{`bound to ${props.nodeId} · ${props.sessionId}`}</p>, order: 10 } })
    expect(within(screen.getByTestId('session-rail')).getByText('bound to orch · pending-1')).toBeTruthy()
  })
})

describe('opening the Session view', () => {
  it('a double click on the Orchestrator Node switches the window to its Session', async () => {
    const navigation = await import('../../src/renderer/session/navigation')
    const { default: OrchestratorNode } = await import('../../src/renderer/canvas/nodes/OrchestratorNode')
    const props = { id: 'orch', data: { node: { data: {} } }, selected: false } as unknown as CanvasNodeProps
    render(
      <ReactFlowProvider>
        <OrchestratorNode {...props} />
      </ReactFlowProvider>,
    )
    await screen.findByText('claude-opus-5-5')
    expect(navigation.useNavigation.getState().view).toBe('canvas')
    fireEvent.doubleClick(screen.getByTestId('orchestrator-node'))
    expect(navigation.useNavigation.getState()).toEqual({ view: 'session', opened: { nodeId: 'orch', projectId: 'alpha' } })
  })

  it('AppShell follows a view given from outside and reports the switch', async () => {
    const { AppShell } = await import('../../src/renderer/shell/AppShell')
    const onViewChange = vi.fn()
    const { container } = render(<AppShell view="session" onViewChange={onViewChange} canvas={<p>canvas</p>} session={<p>session</p>} />)
    expect((container.querySelector('[data-view="session"]') as HTMLElement).hidden).toBe(false)
    expect((container.querySelector('[data-view="canvas"]') as HTMLElement).hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Canvas/ }))
    expect(onViewChange).toHaveBeenCalledWith('canvas')
  })
})

describe('Transcript: following the bottom', () => {
  type Observed = { callback: () => void; element: Element | null }
  let observers: Observed[] = []
  const globals = globalThis as { ResizeObserver?: unknown }
  let had: unknown

  beforeEach(() => {
    observers = []
    had = globals.ResizeObserver
    globals.ResizeObserver = class {
      private readonly entry: Observed
      constructor(callback: () => void) {
        this.entry = { callback, element: null }
        observers.push(this.entry)
      }
      observe(element: Element) {
        this.entry.element = element
      }
      disconnect() {
        this.entry.element = null
      }
    }
  })

  afterEach(() => {
    globals.ResizeObserver = had
  })

  /** Gives the log a fixed geometry jsdom does not compute, and a scrollTop that keeps what is set. */
  function geometry(element: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) {
    let top = 0
    Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight })
    Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => sizes.clientHeight })
    Object.defineProperty(element, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => (top = value) })
  }

  const resize = () => act(() => observers.filter((entry) => entry.element !== null).forEach((entry) => entry.callback()))

  it('scrolls to the newest row when the log is shown again or resized, if the reader was at the bottom', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const { rerender } = render(<Transcript events={[prompt('a')]} />)
    const log = screen.getByTestId('transcript')
    // Hidden (the Canvas is on screen): no height, so the new row cannot be followed yet.
    const sizes = { scrollHeight: 0, clientHeight: 0 }
    geometry(log, sizes)
    rerender(<Transcript events={[prompt('a'), text('a long answer')]} />)
    expect(log.scrollTop).toBe(0)
    // Shown again: the log gets its height, and the observer brings the newest row into view.
    sizes.scrollHeight = 900
    sizes.clientHeight = 300
    resize()
    expect(log.scrollTop).toBe(900)
  })

  it('leaves the scroll alone on a resize once the reader scrolled up', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    render(<Transcript events={[prompt('a'), text('answer')]} />)
    const log = screen.getByTestId('transcript')
    geometry(log, { scrollHeight: 900, clientHeight: 300 })
    log.scrollTop = 100
    fireEvent.scroll(log)
    resize()
    expect(log.scrollTop).toBe(100)
  })
})

describe('row times (ticket 14)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // A transcript file of the fixture home: its first record is the user's prompt.
  const FIXTURE = Object.values(
    import.meta.glob<string>('../fixtures/claude-home/projects/-Users-test-projects-agents/77777777-7777-4777-8777-777777777777.jsonl', { query: '?raw', import: 'default', eager: true }),
  )[0]
  const PROMPT_AT = Date.parse('2026-06-01T10:00:00.000Z')
  const fixtureEvents = (): AgentEvent[] => mainThreadEvents(parseTranscriptLines((FIXTURE ?? '').split('\n').filter((line) => line.length > 0)))
  const two = (value: number) => String(value).padStart(2, '0')
  const clock = (at: number) => {
    const date = new Date(at)
    return `${two(date.getHours())}:${two(date.getMinutes())}`
  }
  const full = (at: number) => {
    const date = new Date(at)
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${clock(at)}:${two(date.getSeconds())}`
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  async function renderAt(now: number, events: readonly AgentEvent[]) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    render(<Transcript events={events} />)
  }

  it('shows the time of the prompt record from the transcript file, with seconds in the tooltip', async () => {
    await renderAt(PROMPT_AT + 60_000, fixtureEvents())
    const row = screen.getAllByTestId('transcript-prompt')[0] as HTMLElement
    const time = within(row).getByTestId('transcript-time')
    expect(within(time).getByTestId('transcript-clock').textContent).toBe(clock(PROMPT_AT))
    expect(within(time).queryByTestId('transcript-date')).toBeNull()
    expect(time.getAttribute('title')).toBe(full(PROMPT_AT))
    expect(time.getAttribute('datetime')).toBe('2026-06-01T10:00:00.000Z')
  })

  it('adds the date to a record older than a day, and the year to one of another year', async () => {
    const lastYear = new Date(2025, 11, 31, 23, 5, 9).getTime()
    await renderAt(PROMPT_AT + 3 * DAY, [...fixtureEvents(), { ...prompt('last year'), at: lastYear }])
    const rows = screen.getAllByTestId('transcript-prompt')
    const first = within(rows[0] as HTMLElement).getByTestId('transcript-time')
    const day = new Date(PROMPT_AT)
    expect(within(first).getByTestId('transcript-date').textContent).toBe(`${MONTHS[day.getMonth()]} ${day.getDate()}`)
    expect(within(first).getByTestId('transcript-clock').textContent).toBe(clock(PROMPT_AT))
    const old = within(rows[rows.length - 1] as HTMLElement).getByTestId('transcript-time')
    expect(within(old).getByTestId('transcript-date').textContent).toBe("Dec 31 '25")
    expect(within(old).getByTestId('transcript-clock').textContent).toBe('23:05')
    expect(old.getAttribute('title')).toBe('2025-12-31 23:05:09')
  })

  it('dates the rows of yesterday once midnight passes while the view stays open', async () => {
    const lateEvening = new Date(2026, 9, 6, 23, 59, 0).getTime()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(lateEvening)
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    render(<Transcript events={[{ ...prompt('before midnight'), at: lateEvening - 60_000 }]} />)
    const time = screen.getByTestId('transcript-time')
    expect(within(time).queryByTestId('transcript-date')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(within(screen.getByTestId('transcript-time')).getByTestId('transcript-date').textContent).toBe('Oct 6')
    expect(within(screen.getByTestId('transcript-time')).getByTestId('transcript-clock').textContent).toBe('23:58')
  })

  it('shows the time on prompt, hook, subagent and notice rows; the answer keeps it in the tooltip of its label; a row without a time shows none', async () => {
    await renderAt(NOW, [
      { ...prompt('hi'), at: NOW - 60_000 },
      { ...text('answer'), at: NOW - 50_000 },
      { type: 'hook', hookEvent: 'Stop', hookName: 'gate', exitCode: 0, outcome: 'success', stdout: '', stderr: '', at: NOW - 40_000 },
      { type: 'subagent', phase: 'started', taskId: 'k', toolUseId: null, description: 'verify-08', subagentType: null, status: null, summary: null, at: NOW - 30_000 },
      { type: 'notice', kind: 'notification', text: 'verify-08 finished', at: NOW - 20_000 },
      prompt('no time'),
    ])
    for (const [testId, at] of [
      ['transcript-hook', NOW - 40_000],
      ['transcript-subagent', NOW - 30_000],
      ['transcript-notice', NOW - 20_000],
    ] as const) {
      expect(within(screen.getByTestId(testId)).getByTestId('transcript-clock').textContent).toBe(clock(at))
    }
    const prompts = screen.getAllByTestId('transcript-prompt')
    expect(within(prompts[0] as HTMLElement).getByTestId('transcript-clock').textContent).toBe(clock(NOW - 60_000))
    expect(within(prompts[1] as HTMLElement).queryByTestId('transcript-time')).toBeNull()
    const answer = screen.getByTestId('transcript-text')
    expect(within(answer).queryByTestId('transcript-time')).toBeNull()
    expect(within(answer).getByText('claude').closest('[title]')?.getAttribute('title')).toBe(full(NOW - 50_000))
  })
})
