// The Session view (src/renderer/session/): folding a Session's events into transcript rows, the
// renderer's event store, the input field's keys and prompt history, the rail made of files in
// rail/, and opening the view by a double click on the Orchestrator's Node.
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

  it('hands event types that a rows/ file draws to that file', () => {
    const items = foldTranscript([prompt('a'), { type: 'hook', hookEvent: 'Stop', hookName: 'g', exitCode: 0, outcome: 'success', stdout: 'ok', stderr: '' }], new Set(['hook']))
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'extension'])
  })
})

describe('prompt history', () => {
  it('lists what the user sent, oldest first, without the interruption message', () => {
    expect(promptHistory([prompt('one'), text('a'), prompt('[Request interrupted by user]'), prompt('two')])).toEqual(['one', 'two'])
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
  it('joins deltas, moves events to the new id on `renamed`, and drops an echo of the sent prompt', async () => {
    const store = await import('../../src/renderer/session/store')
    store.recordPrompt('pending-1', 'hello')
    store.acceptAgentEvent({ sessionId: 'pending-1', event: delta('a') })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: { type: 'renamed', from: 'pending-1' } })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: prompt('hello') })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: delta('b') })
    store.acceptAgentEvent({ sessionId: 'sdk-1', event: delta('c') })
    const { logs } = store.useSessionLogs.getState()
    expect(logs['pending-1']).toBeUndefined()
    expect(logs['sdk-1']?.events).toEqual([prompt('hello'), delta('abc')])
  })

  it('keeps a prompt the user sends again after the turn ended', async () => {
    const store = await import('../../src/renderer/session/store')
    store.recordPrompt('s', 'again')
    store.acceptAgentEvent({ sessionId: 's', event: result() })
    store.acceptAgentEvent({ sessionId: 's', event: prompt('again') })
    expect(store.useSessionLogs.getState().logs.s?.events.map((event) => event.type)).toEqual(['notice', 'result', 'notice'])
  })
})

describe('MessageInput', () => {
  async function mountInput(props: { busy?: boolean; history?: string[]; onSend?: (text: string) => Promise<string | null> } = {}) {
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
    expect(onSend).toHaveBeenCalledWith('line 1')
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

  it('while the Session is busy, shows Interrupt instead of send; Escape interrupts too', async () => {
    const { field, onSend, onInterrupt } = await mountInput({ busy: true })
    expect(screen.queryByTestId('input-send')).toBeNull()
    fireEvent.click(screen.getByTestId('input-interrupt'))
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    fireEvent.change(field, { target: { value: 'later' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
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
    expect(within(screen.getByTestId('transcript-prompt')).getByText('ответь блоком состояния')).toBeTruthy()

    emit('pending-1', { type: 'init', sdkSessionId: 'sdk-1', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', apiKeySource: 'none', cwd: '/p', claudeCodeVersion: null, slashCommands: [] })
    emit('pending-1', text('| a | b |\n| - | - |\n| 1 | 2 |'))
    emit('pending-1', result())
    expect(screen.getByTestId('session-permissions').textContent).toBe('bypass')
    expect(within(screen.getByTestId('transcript-text')).getByRole('table')).toBeTruthy()
    expect(screen.getByTestId('transcript-turn-done')).toBeTruthy()
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
