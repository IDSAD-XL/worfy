// The chat of a Product Session as in the prototype (worfy-product-session ticket 19, Q1, Q2 and Q5 of the
// owner's decisions of 2026-11-08): only the conversation — the owner's messages, the advisor's answers,
// a failed turn, the Session's error, permission and question cards — drawn as bubbles with the role and
// the time; «the advisor is thinking» at the end while a turn runs. Thinking, tool calls (a failed one
// too), Subagents, hooks, notices, «Turn finished» and slash commands are not drawn, and find does not
// look in them. A plain Session draws every row as before.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { foldTranscript } from '../../src/renderer/session/fold'
import { ProductSessionContext } from '../../src/renderer/session/product-session'
import { Transcript } from '../../src/renderer/session/Transcript'
import { extensionTypes, rowMatches, findItems } from '../../src/renderer/session/transcript-find'

vi.mock('../../src/renderer/ipc', () => ({ invoke: vi.fn(), subscribe: () => () => undefined, showSubscribeError: () => undefined }))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))

afterEach(cleanup)

// 2026-11-08 14:05 and 14:06 local time: today's rows show the clock only.
const AT = new Date(2026, 10, 8, 14, 5).getTime()

const prompt = (text: string, at = AT): AgentEvent => ({ type: 'notice', kind: 'user', text, at })
const text = (value: string, synthetic = false, at = AT + 60_000): AgentEvent => ({ type: 'text', text: value, messageId: `m-${value}`, parentToolUseId: null, synthetic, at })
const usage = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
const result = (isError: boolean, interrupted = false): AgentEvent => ({
  type: 'result',
  subtype: isError ? 'error_during_execution' : 'success',
  isError,
  error: isError ? 'The API answered 500' : null,
  text: null,
  costUsd: 0,
  durationMs: 1200,
  numTurns: 1,
  usage,
  terminalReason: null,
  interrupted,
})
const PERMISSION: AgentEvent = {
  type: 'permission_request',
  requestId: 'r-1',
  subject: 'WebFetch',
  toolName: 'WebFetch',
  toolUseId: null,
  input: { url: 'https://example.com' },
  title: null,
  description: null,
  blockedPath: null,
  suggestions: [],
  options: [
    { id: 'allow', label: 'Allow', kind: 'allow' },
    { id: 'deny', label: 'Deny', kind: 'deny' },
  ],
}
const QUESTION: AgentEvent = {
  type: 'question_request',
  requestId: 'q-1',
  toolUseId: null,
  questions: [{ question: 'Which market first?', header: 'Market', multiSelect: false, options: [{ label: 'Teams', description: 'Small teams', preview: null }, { label: 'Solo', description: 'One person', preview: null }] }],
}

/** One of every row: what a Product Session draws and what it leaves out. */
const EVERY_ROW: AgentEvent[] = [
  prompt('What could we sell?'),
  { type: 'thinking', text: 'Weighing the markets', messageId: 'th-1', parentToolUseId: null },
  { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls docs/product' }, parentToolUseId: null },
  { type: 'tool_result', toolUseId: 't1', content: 'roadmap', isError: false, parentToolUseId: null },
  { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'missing.md' }, parentToolUseId: null },
  { type: 'tool_result', toolUseId: 't2', content: 'File does not exist', isError: true, parentToolUseId: null },
  { type: 'subagent', phase: 'started', taskId: 'task-1', toolUseId: null, description: 'Critic reviews the plan', subagentType: 'worfy:critic', status: null, summary: null },
  { type: 'hook', hookEvent: 'Stop', hookName: 'rules', exitCode: 2, outcome: 'blocked', stdout: '', stderr: 'blocked by a rule' },
  { type: 'notice', kind: 'synthetic', text: 'Added by Claude Code' },
  { type: 'notice', kind: 'notification', text: 'Compacting the conversation' },
  { type: 'command', name: '/compact', args: '' },
  text('A reminder Claude Code added', true),
  text('Sell to small teams first.'),
  PERMISSION,
  QUESTION,
  result(false),
  prompt('And then?'),
  result(true),
  prompt('Stop'),
  result(false, true),
  { type: 'state', state: 'error', error: 'The Session stopped: the process exited' },
]

const HIDDEN = ['transcript-thinking', 'transcript-tools', 'tool-call', 'tool-error', 'transcript-subagent', 'transcript-hook', 'transcript-notice', 'transcript-command', 'transcript-turn-done']

function Product({ events, working }: { events: readonly AgentEvent[]; working?: boolean }) {
  return (
    <ProductSessionContext value={true}>
      <Transcript events={events} sessionId="s1" projectId="p1" working={working} />
    </ProductSessionContext>
  )
}

describe('the chat of a Product Session', () => {
  it('draws the prompts, the answer, the failed and the interrupted turn, the error, the permission and the question card', () => {
    render(<Product events={EVERY_ROW} />)
    expect(screen.getAllByTestId('transcript-prompt').map((row) => row.textContent)).toEqual([expect.stringContaining('What could we sell?'), expect.stringContaining('And then?'), expect.stringContaining('Stop')])
    expect(screen.getAllByTestId('transcript-text').map((row) => row.textContent)).toEqual([expect.stringContaining('Sell to small teams first.')])
    expect(screen.getByTestId('transcript-turn-error').textContent).toContain('The API answered 500')
    expect(screen.getByTestId('transcript-interrupted')).toBeTruthy()
    expect(screen.getByTestId('transcript-error').textContent).toContain('the process exited')
    expect(screen.getByTestId('permission-card')).toBeTruthy()
    expect(screen.getByTestId('question-card')).toBeTruthy()
  })

  it('does not draw thinking, tool calls (the failed one too), the Subagent, the hook, notices, slash commands, the synthetic message or «Turn finished»', () => {
    render(<Product events={EVERY_ROW} />)
    for (const testId of HIDDEN) expect(screen.queryAllByTestId(testId), testId).toEqual([])
    const log = screen.getByTestId('transcript')
    for (const words of ['Weighing the markets', 'ls docs/product', 'File does not exist', 'Critic reviews the plan', 'blocked by a rule', 'Compacting', '/compact', 'A reminder Claude Code added', 'Turn finished']) {
      expect(log.textContent, words).not.toContain(words)
    }
  })

  it('a plain Session draws every row as before', () => {
    render(<Transcript events={EVERY_ROW} sessionId="s1" projectId="p1" working />)
    for (const testId of ['transcript-thinking', 'transcript-tools', 'tool-error', 'transcript-subagent', 'transcript-hook', 'transcript-notice', 'transcript-command', 'transcript-turn-done']) {
      expect(screen.queryAllByTestId(testId).length, testId).toBeGreaterThan(0)
    }
    expect(screen.getAllByTestId('transcript-text')).toHaveLength(2)
    expect(screen.queryByTestId('product-thinking')).toBeNull()
    expect(screen.getAllByTestId('transcript-prompt')[0]!.querySelector('.w-tr__prompt')).not.toBeNull()
  })

  it('a message is a bubble with its role and time: «You» on the right, «Advisor» on the left', () => {
    render(<Product events={[prompt('What could we sell?'), text('Sell to small teams first.')]} />)
    const mine = screen.getByTestId('transcript-prompt')
    const theirs = screen.getByTestId('transcript-text')
    expect(mine.dataset['who']).toBe('you')
    expect(theirs.dataset['who']).toBe('advisor')
    expect(mine.className).toContain('w-pmsg--you')
    expect(theirs.className).toContain('w-pmsg--advisor')
    expect(within(mine).getByTestId('product-message-role').textContent).toBe('You')
    expect(within(theirs).getByTestId('product-message-role').textContent).toBe('Advisor')
    expect(within(mine).getByTestId('transcript-clock').textContent).toBe('14:05')
    expect(within(theirs).getByTestId('transcript-clock').textContent).toBe('14:06')
    expect(within(mine).getByTestId('product-message-bubble').textContent).toBe('What could we sell?')
    expect(within(theirs).getByTestId('product-message-bubble').textContent).toContain('Sell to small teams first.')
  })

  it('«the advisor is thinking» stands at the end of the chat while a turn runs and goes once it ends', () => {
    const events = [prompt('What could we sell?')]
    const { rerender } = render(<Product events={events} working />)
    const thinking = screen.getByTestId('product-thinking')
    expect(thinking.textContent).toContain('Advisor is thinking')
    const log = screen.getByTestId('transcript')
    expect(log.lastElementChild?.contains(thinking)).toBe(true)
    rerender(<Product events={[...events, text('Sell to small teams first.'), result(false)]} working={false} />)
    expect(screen.queryByTestId('product-thinking')).toBeNull()
  })

  it('find does not look in the rows the chat leaves out', () => {
    const plain = findItems(EVERY_ROW, 0, false)
    const product = findItems(EVERY_ROW, 0, true)
    expect(plain).toEqual(foldTranscript(EVERY_ROW, extensionTypes, 0))
    for (const needle of ['weighing', 'docs/product', 'critic reviews', 'rules']) {
      expect(rowMatches(plain, needle, false).length, needle).toBeGreaterThan(0)
      expect(rowMatches(product, needle, false), needle).toEqual([])
    }
    expect(rowMatches(product, 'small teams', false)).toHaveLength(1)
  })
})
