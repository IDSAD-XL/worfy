// The «Hide tools» switch of the Session view (worfy-ui ticket 25): with tools hidden, the ordinary
// calls of a run fold into one «N tools» line that opens on a click and shows «running» while one of
// them runs; a call with an error and a call that started a Subagent stay in sight; Subagent, hook,
// thinking and permission request rows are drawn as without the switch. The choice is kept per
// Session in the window's localStorage (src/renderer/session/transcript-view.ts).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { splitTools, type ToolCall } from '../../src/renderer/session/fold'
import { Transcript } from '../../src/renderer/session/Transcript'
import { HideToolsButton } from '../../src/renderer/session/HideToolsButton'
import { hideToolsKey, useToolsHidden } from '../../src/renderer/session/transcript-view'

const toolUse = (id: string, name: string, input: unknown = {}): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId: null })
const toolResult = (toolUseId: string, content = 'ok', isError = false): AgentEvent => ({ type: 'tool_result', toolUseId, content, isError, parentToolUseId: null })
const text = (value: string): AgentEvent => ({ type: 'text', text: value, messageId: 'm1', parentToolUseId: null, synthetic: false })

/** A run of four calls: two that succeeded, one with an error, one still running. */
const run: AgentEvent[] = [
  toolUse('t1', 'Bash', { command: 'pnpm lint' }),
  toolResult('t1'),
  toolUse('t2', 'Read', { file_path: 'spec.md' }),
  toolResult('t2'),
  toolUse('t3', 'Edit', { file_path: 'fold.ts' }),
  toolResult('t3', 'old_string not found', true),
  toolUse('t4', 'Grep', { pattern: 'hideTools' }),
]

/** Every row that is not a tool call: a Subagent of its own, an Agent call with its Subagent, a hook, thinking, a permission request. */
const others: AgentEvent[] = [
  text('before'),
  { type: 'subagent', phase: 'started', taskId: 'task-1', toolUseId: null, description: 'Scout the code', subagentType: 'worfy:scout', status: null, summary: null },
  { type: 'thinking', text: 'Let me think', messageId: 'm2', parentToolUseId: null },
  toolUse('a1', 'Agent', { description: 'Review the diff' }),
  { type: 'subagent', phase: 'started', taskId: 'task-2', toolUseId: 'a1', description: 'Review the diff', subagentType: 'worfy:reviewer', status: null, summary: null },
  { type: 'hook', hookEvent: 'Stop', hookName: 'Stop', exitCode: 0, outcome: 'success', stdout: 'gate green', stderr: '' },
  {
    type: 'permission_request',
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'toolu_9',
    input: { command: 'git push' },
    title: null,
    description: 'Push the branch',
    blockedPath: null,
    alwaysAllow: false,
    suggestions: [],
  },
  text('after'),
]

const calls = () => screen.queryAllByTestId('tool-call')
const folded = () => screen.queryAllByTestId('tools-folded')

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('splitTools', () => {
  const call = (overrides: Partial<ToolCall>): ToolCall => ({ id: 'c', name: 'Bash', input: {}, result: null, subagent: null, ...overrides })

  it('keeps a call with an error and a call that starts a Subagent in sight, and folds the rest in order', () => {
    const ok = call({ id: 'ok', result: { content: '', isError: false } })
    const failed = call({ id: 'failed', result: { content: 'boom', isError: true } })
    const running = call({ id: 'running' })
    const agent = call({ id: 'agent', name: 'Agent' })
    const task = call({ id: 'task', name: 'Task' })
    const withSubagent = call({ id: 'sub', name: 'Workflow', subagent: { taskId: 't', description: null, subagentType: null, status: null, summary: null } })
    expect(splitTools([ok, failed, running, agent, task, withSubagent])).toEqual({ folded: [ok, running], shown: [failed, agent, task, withSubagent] })
  })
})

describe('the Transcript with tools hidden', () => {
  it('folds the ordinary calls of a run into one «N tools» line and keeps the call with an error as it is', () => {
    render(<Transcript events={run} hideTools />)
    expect(folded()).toHaveLength(1)
    expect(folded()[0]?.textContent).toContain('3 tools')
    // Only the call with an error is drawn, with its own status.
    expect(calls().map((each) => each.getAttribute('data-tool'))).toEqual(['Edit'])
    expect(within(calls()[0] as HTMLElement).getByTestId('tool-error')).toBeTruthy()
    expect(screen.queryAllByTestId('tool-ok')).toHaveLength(0)
  })

  it('opens the line on a click: the folded calls with their own statuses; a second click folds them again', () => {
    render(<Transcript events={run} hideTools />)
    const line = within(folded()[0] as HTMLElement).getByRole('button', { name: /3 tools/ })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(line)
    expect(line.getAttribute('aria-expanded')).toBe('true')
    expect(calls().map((each) => each.getAttribute('data-tool'))).toEqual(['Bash', 'Read', 'Grep', 'Edit'])
    expect(screen.getAllByTestId('tool-ok')).toHaveLength(2)
    expect(screen.getAllByTestId('tool-running')).toHaveLength(1)
    fireEvent.click(line)
    expect(calls().map((each) => each.getAttribute('data-tool'))).toEqual(['Edit'])
  })

  it('shows one «running» on the line while a folded call runs, and none once every call has its result', () => {
    const { rerender } = render(<Transcript events={run} hideTools />)
    expect(within(folded()[0] as HTMLElement).getByTestId('tools-running').textContent).toContain('running')
    rerender(<Transcript events={[...run, toolResult('t4')]} hideTools />)
    expect(within(folded()[0] as HTMLElement).queryByTestId('tools-running')).toBeNull()
  })

  it('names a run of one call «1 tool», and draws no line for a run of errors alone', () => {
    render(<Transcript events={[toolUse('t1', 'Bash'), toolResult('t1'), text('between'), toolUse('t2', 'Edit'), toolResult('t2', 'boom', true)]} hideTools />)
    expect(folded()).toHaveLength(1)
    expect(folded()[0]?.textContent).toContain('1 tool')
    expect(folded()[0]?.textContent).not.toContain('1 tools')
    expect(calls().map((each) => each.getAttribute('data-tool'))).toEqual(['Edit'])
  })

  it('draws every call one line each, as before, while tools are shown', () => {
    render(<Transcript events={run} />)
    expect(folded()).toHaveLength(0)
    expect(calls().map((each) => each.getAttribute('data-tool'))).toEqual(['Bash', 'Read', 'Edit', 'Grep'])
  })

  it('leaves Subagent, hook, thinking and permission request rows as they are', () => {
    const rows = () =>
      ['transcript-subagent', 'transcript-thinking', 'transcript-hook', 'permission-card', 'transcript-text'].map((id) => [id, screen.queryAllByTestId(id).map((row) => row.textContent)])
    render(<Transcript events={others} />)
    const shown = rows()
    const agentCall = calls().map((each) => each.textContent)
    cleanup()
    render(<Transcript events={others} hideTools />)
    expect(rows()).toEqual(shown)
    // The Agent call is the row of its Subagent: still drawn, with the Subagent's status.
    expect(calls().map((each) => each.textContent)).toEqual(agentCall)
    expect(calls().map((each) => each.getAttribute('data-tool'))).toEqual(['Agent'])
    expect(folded()).toHaveLength(0)
    expect(shown.every(([, texts]) => (texts as string[]).length > 0)).toBe(true)
  })
})

describe('the choice, per Session', () => {
  function Header({ storeKey }: { storeKey: string }) {
    const [hidden, setHidden] = useToolsHidden(storeKey)
    return <HideToolsButton hidden={hidden} onChange={setHidden} />
  }
  const button = () => screen.getByTestId('session-hide-tools')
  const pressed = () => button().getAttribute('aria-pressed')

  it('is off by default, has a tooltip, and is remembered for its Session after the view is mounted again', () => {
    const a = hideToolsKey('alpha-0000000a', 'node-1')
    const view = render(<Header storeKey={a} />)
    expect(pressed()).toBe('false')
    expect(button().getAttribute('title')).toMatch(/Remembered for this Session/)
    expect(screen.getByRole('button', { name: 'Hide tools' })).toBe(button())
    fireEvent.click(button())
    expect(pressed()).toBe('true')
    view.unmount()
    render(<Header storeKey={a} />)
    expect(pressed()).toBe('true')
    fireEvent.click(button())
    expect(pressed()).toBe('false')
    expect(localStorage.length).toBe(0)
  })

  it('keeps each Session and each Subagent apart', () => {
    const session = hideToolsKey('alpha-0000000a', 'node-1')
    const subagent = hideToolsKey('alpha-0000000a', 'node-1', 'agent-7')
    const other = hideToolsKey('alpha-0000000a', 'node-2')
    expect(new Set([session, subagent, other]).size).toBe(3)
    const view = render(<Header storeKey={subagent} />)
    fireEvent.click(button())
    view.unmount()
    for (const [key, expected] of [
      [session, 'false'],
      [other, 'false'],
      [subagent, 'true'],
    ] as const) {
      const each = render(<Header storeKey={key} />)
      expect(pressed()).toBe(expected)
      each.unmount()
    }
  })

  it('follows a change of the key without a remount, as the Session view does when it shows another Session', () => {
    const a = hideToolsKey('alpha-0000000a', 'node-1')
    const b = hideToolsKey('alpha-0000000a', 'node-2')
    function Switching() {
      const [key, setKey] = useState(a)
      return (
        <>
          <Header storeKey={key} />
          <button type="button" onClick={() => setKey(b)}>
            switch
          </button>
        </>
      )
    }
    render(<Switching />)
    fireEvent.click(button())
    expect(pressed()).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    expect(pressed()).toBe('false')
  })

  it('follows a change another window of worfy made', () => {
    const a = hideToolsKey('alpha-0000000a', 'node-1')
    render(<Header storeKey={a} />)
    // Another window wrote the choice: this window hears it as a `storage` event.
    const fresh = new Map<string, string>()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((name: string) => fresh.get(name) ?? null)
    fresh.set(`worfy.transcript.hideTools:${a}`, '1')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: `worfy.transcript.hideTools:${a}` }))
    })
    expect(pressed()).toBe('true')
  })

  it('still switches, for this window, when the storage cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<Header storeKey={hideToolsKey('alpha-0000000a', 'node-3')} />)
    expect(pressed()).toBe('false')
    fireEvent.click(button())
    expect(pressed()).toBe('true')
  })
})
