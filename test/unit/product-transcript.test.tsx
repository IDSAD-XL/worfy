// The chat of a Product Session as in the prototype (worfy-product-session ticket 19, Q1, Q2 and Q5 of the
// owner's decisions of 2026-11-08): only the conversation — the owner's messages, the advisor's answers,
// a failed turn, the Session's error, permission and question cards — drawn as bubbles with the role and
// the time; «the advisor is thinking» at the end while a turn runs. Thinking, tool calls (a failed one
// too), Subagents, hooks, notices, «Turn finished» and slash commands are not drawn, and find does not
// look in them. A plain Session draws every row as before.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { foldTranscript } from '../../src/renderer/session/fold'
import { chatQueue, ProductSessionContext, type ChatQueue } from '../../src/renderer/session/product-session'
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

function Product({ events, working, queued }: { events: readonly AgentEvent[]; working?: boolean; queued?: ChatQueue | null }) {
  return (
    <ProductSessionContext value={true}>
      <Transcript events={events} sessionId="s1" projectId="p1" working={working} queued={queued} />
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

  // worfy-product-session ticket 22: «Advisor · 14:03 · #2», as the prototype numbers the messages.
  it('each message’s meta line carries its number in the chat; the rows left out take none', () => {
    render(<Product events={EVERY_ROW} />)
    const numbers = (testId: string) => screen.getAllByTestId(testId).map((row) => within(row).getByTestId('product-message-number').textContent)
    // The prompts are messages 1, 3 and 4; the one answer drawn (not the synthetic one) is 2.
    expect(numbers('transcript-prompt')).toEqual(['#1', '#3', '#4'])
    expect(numbers('transcript-text')).toEqual(['#2'])
    expect(screen.getAllByTestId('transcript-text')[0]!.querySelector('.w-pmsg__meta')!.textContent).toMatch(/^AAdvisor·.+·#2$/u)
  })

  it('a plain Session’s rows carry no message number', () => {
    render(<Transcript events={EVERY_ROW} sessionId="s1" projectId="p1" />)
    expect(screen.queryAllByTestId('product-message-number')).toEqual([])
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

// worfy-product-session ticket 28 (owner, 2026-11-09): a message sent while the advisor works waits in the
// Session's queue (src/main/agent/queue.ts); the chat shows it at once, last, dimmed, with «queued», until
// main delivers it (a `prompt` event) and it becomes an ordinary message at its place.
describe('a queued message in the chat of a Product Session', () => {
  const QUEUED = { items: [{ id: 'q-1', text: 'And for solo founders?' }], paused: false }
  const two = { items: [...QUEUED.items, { id: 'q-2', text: 'Also: pricing' }], paused: false }

  it('chatQueue: none without items; «queued» while it goes on its own, «held» after Interrupt, «not-sent» once the Session is closed', () => {
    expect(chatQueue(null, 'busy')).toBeNull()
    expect(chatQueue({ items: [], paused: false }, 'busy')).toBeNull()
    expect(chatQueue(QUEUED, 'busy')).toEqual({ items: QUEUED.items, status: 'queued' })
    expect(chatQueue({ ...QUEUED, paused: true }, 'idle')).toEqual({ items: QUEUED.items, status: 'held' })
    expect(chatQueue({ ...QUEUED, paused: true }, 'error')).toEqual({ items: QUEUED.items, status: 'held' })
    expect(chatQueue(QUEUED, 'closed')).toEqual({ items: QUEUED.items, status: 'not-sent' })
    expect(chatQueue({ ...QUEUED, paused: true }, 'closed')).toEqual({ items: QUEUED.items, status: 'not-sent' })
  })

  it('stands last, below «the advisor is thinking», dimmed, with «queued» and no number; several in the order sent', () => {
    render(<Product events={[prompt('What could we sell?')]} working queued={chatQueue(two, 'busy')} />)
    const queued = screen.getAllByTestId('product-queued')
    expect(queued.map((row) => within(row).getByTestId('product-message-bubble').textContent)).toEqual(['And for solo founders?', 'Also: pricing'])
    for (const row of queued) {
      expect(row.className).toContain('w-pmsg--queued')
      expect(row.dataset['who']).toBe('you')
      expect(within(row).getByTestId('product-queued-label').textContent).toBe('queued')
      expect(within(row).queryByTestId('product-message-number')).toBeNull()
    }
    const log = screen.getByTestId('transcript')
    expect(log.lastElementChild?.contains(queued[1]!)).toBe(true)
    // «Advisor is thinking» stands before the queued messages: the running turn comes first.
    const thinking = screen.getByTestId('product-thinking')
    expect(thinking.compareDocumentPosition(queued[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Only one message of the chat carries a number: the one delivered.
    expect(screen.getAllByTestId('product-message-number').map((n) => n.textContent)).toEqual(['#1'])
  })

  it('stays last as the advisor’s answer arrives, and becomes an ordinary message once delivered', () => {
    const events = [prompt('What could we sell?')]
    const { rerender } = render(<Product events={events} working queued={chatQueue(QUEUED, 'busy')} />)
    const answered = [...events, text('Sell to small teams first.'), result(false)]
    rerender(<Product events={answered} working queued={chatQueue(QUEUED, 'busy')} />)
    const log = screen.getByTestId('transcript')
    expect(log.lastElementChild?.contains(screen.getByTestId('product-queued'))).toBe(true)
    // main took it out of the queue and gave it to the agent: an empty queue and a `prompt`.
    rerender(<Product events={[...answered, prompt('And for solo founders?', AT + 120_000)]} working queued={chatQueue({ items: [], paused: false }, 'busy')} />)
    expect(screen.queryByTestId('product-queued')).toBeNull()
    const prompts = screen.getAllByTestId('transcript-prompt')
    expect(prompts).toHaveLength(2)
    expect(within(prompts[1]!).getByTestId('product-message-bubble').textContent).toBe('And for solo founders?')
    expect(within(prompts[1]!).getByTestId('product-message-number').textContent).toBe('#3')
  })

  it('held after Interrupt: «queued · held», «Send queued» lets the queue go, × takes one out', async () => {
    const { invoke } = await import('../../src/renderer/ipc')
    const call = vi.mocked(invoke)
    call.mockReset()
    call.mockResolvedValue({ ok: true, value: undefined } as never)
    render(<Product events={[prompt('What could we sell?'), result(false, true)]} queued={chatQueue({ ...two, paused: true }, 'idle')} />)
    for (const label of screen.getAllByTestId('product-queued-label')) expect(label.textContent).toBe('queued · held')
    fireEvent.click(screen.getByTestId('product-queue-send'))
    expect(call).toHaveBeenCalledWith('agent.queueSend', { sessionId: 's1' })
    fireEvent.click(screen.getAllByTestId('product-queued-remove')[1]!)
    expect(call).toHaveBeenCalledWith('agent.queueRemove', { sessionId: 's1', id: 'q-2' })
    // The log still ends with the queue: the button stands after the last held message.
    expect(screen.getByTestId('transcript').lastElementChild?.contains(screen.getByTestId('product-queue-send'))).toBe(true)
  })

  it('while it goes on its own there is no «Send queued»; × still takes it out', () => {
    render(<Product events={[prompt('What could we sell?')]} working queued={chatQueue(QUEUED, 'busy')} />)
    expect(screen.queryByTestId('product-queue-send')).toBeNull()
    expect(screen.getAllByTestId('product-queued-remove')).toHaveLength(1)
  })

  it('a closed Session never sends it: «not sent», still last, with no actions', () => {
    render(<Product events={[prompt('What could we sell?')]} queued={chatQueue(QUEUED, 'closed')} />)
    const row = screen.getByTestId('product-queued')
    expect(row.dataset['status']).toBe('not-sent')
    expect(within(row).getByTestId('product-queued-label').textContent).toBe('not sent')
    expect(screen.queryByTestId('product-queue-send')).toBeNull()
    expect(screen.queryByTestId('product-queued-remove')).toBeNull()
  })

  it('a plain Session draws no queued message in its log: its queue is the chip in the input field', () => {
    render(<Transcript events={[prompt('What could we sell?')]} sessionId="s1" projectId="p1" working queued={chatQueue(QUEUED, 'busy')} />)
    expect(screen.queryByTestId('product-queued')).toBeNull()
  })
})
