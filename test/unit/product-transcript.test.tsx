// The chat of a Product Session as in the prototype (worfy-product-session ticket 19, Q1, Q2 and Q5 of the
// owner's decisions of 2026-11-08): only the conversation — the owner's messages, the advisor's answers,
// a failed turn, the Session's error, permission and question cards — drawn as bubbles with the role and
// the time; the status line of the running turn at the end (ticket 29), and the live summary under it (ticket 32). Thinking, tool calls (a failed one
// too), Subagents, hooks, notices, «Turn finished» and slash commands are not drawn, and find does not
// look in them. A plain Session draws every row as before.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { foldTranscript } from '../../src/renderer/session/fold'
import { chatQueue, ProductSessionContext, type ChatQueue } from '../../src/renderer/session/product-session'
import { NARRATION_TITLE } from '../../src/renderer/session/Narration'
import { acceptAgentEvent, useSessionLogs } from '../../src/renderer/session/store'
import { Transcript } from '../../src/renderer/session/Transcript'
import { extensionTypes, rowMatches, findItems } from '../../src/renderer/session/transcript-find'

vi.mock('../../src/renderer/ipc', () => ({ invoke: vi.fn(), subscribe: () => () => undefined, showSubscribeError: () => undefined }))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))

afterEach(cleanup)

// 2026-11-08 14:05 and 14:06 local time: today's rows show the clock only.
const AT = new Date(2026, 10, 8, 14, 5).getTime()

const prompt = (text: string, at = AT): AgentEvent => ({ type: 'notice', kind: 'user', text, at })
const text = (value: string, synthetic = false, at = AT + 60_000): AgentEvent => ({ type: 'text', text: value, messageId: `m-${value}`, parentToolUseId: null, synthetic, at })
const call = (id: string, name: string, input: unknown, at = AT + 1000): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId: null, at })
const answer = (id: string, at = AT + 2000): AgentEvent => ({ type: 'tool_result', toolUseId: id, content: 'ok', isError: false, parentToolUseId: null, at })
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

function Product({ events, working, queued, narration }: { events: readonly AgentEvent[]; working?: boolean; queued?: ChatQueue | null; narration?: readonly string[] | null }) {
  return (
    <ProductSessionContext value={true}>
      <Transcript events={events} sessionId="s1" projectId="p1" working={working} queued={queued} narration={narration} />
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

  it('the status line stands at the end of the chat while a turn runs, changes at each step and goes once it ends', () => {
    const events = [prompt('What could we sell?')]
    const { rerender } = render(<Product events={events} working />)
    const thinking = screen.getByTestId('product-thinking')
    expect(screen.getByTestId('product-status').textContent).toBe('Thinking…')
    const log = screen.getByTestId('transcript')
    expect(log.lastElementChild?.contains(thinking)).toBe(true)
    // A tool call the chat hides still names the step (ticket 29).
    const reading = [...events, call('t1', 'Read', { file_path: '/Users/someone/project/docs/product/roadmap/map.md' })]
    rerender(<Product events={reading} working />)
    expect(screen.getByTestId('product-status').textContent).toBe('Reading map.md')
    expect(screen.queryByTestId('transcript-tool')).toBeNull()
    rerender(<Product events={[...reading, answer('t1'), call('t2', 'mcp__qmd__query', { searches: [] }, AT + 3000)]} working />)
    expect(screen.getByTestId('product-status').textContent).toBe('Searching the docs')
    rerender(<Product events={[...reading, text('Sell to small teams first.'), result(false)]} working={false} />)
    expect(screen.queryByTestId('product-thinking')).toBeNull()
    expect(screen.queryByTestId('product-status')).toBeNull()
  })

  // Ticket 32: the live summary — Haiku's last lines of what the advisor is doing — stands under the status line,
  // dimmed, tagged «summary», and is no row of the chat.
  it('the live summary stands under the status line, tagged and dimmed, is no chat row, and goes when the turn ends', () => {
    const events = [prompt('What could we sell?'), call('t1', 'Read', { file_path: 'map.md' })]
    const lines = ['Reads the roadmap draft to weigh it against the critic', 'Compares three sources on competitor prices to size the niche']
    const { rerender } = render(<Product events={events} working narration={lines} />)
    const end = screen.getByTestId('product-chat-end')
    const summary = within(end).getByTestId('product-narration')
    // Under the status line, in the same end row of the chat.
    expect(screen.getByTestId('product-thinking').compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(summary).getAllByTestId('product-narration-line').map((line) => line.textContent)).toEqual(lines)
    const tag = within(summary).getByTestId('product-narration-tag')
    expect(tag.textContent).toBe('summary')
    expect(tag.getAttribute('title')).toBe(NARRATION_TITLE)
    expect(summary.classList.contains('w-pmsg__narration')).toBe(true)
    // No message: the chat's rows and numbers are those without it.
    expect(screen.queryAllByTestId('product-message-bubble')).toHaveLength(1)
    expect(screen.getByTestId('transcript').querySelectorAll('[data-row]')).toHaveLength(1)

    // The answer came: the turn is over, and the lines go with the status line.
    rerender(<Product events={[...events, answer('t1'), text('Sell to small teams first.'), result(false)]} working={false} narration={lines} />)
    expect(screen.queryByTestId('product-narration')).toBeNull()
    // No lines yet: nothing under the status line.
    rerender(<Product events={events} working narration={[]} />)
    expect(screen.queryByTestId('product-status')).not.toBeNull()
    expect(screen.queryByTestId('product-narration')).toBeNull()
  })

  it('the store keeps the live summary beside the transcript, not in it, and drops it at a new message and at the result', () => {
    const id = 'narrated'
    acceptAgentEvent({ sessionId: id, event: { type: 'prompt', text: 'What could we sell?' } })
    acceptAgentEvent({ sessionId: id, event: { type: 'narration', lines: ['Reads the roadmap'] } })
    acceptAgentEvent({ sessionId: id, event: { type: 'narration', lines: ['Reads the roadmap', 'Compares prices'] } })
    const log = () => useSessionLogs.getState().logs[id]!
    expect(log().narration).toEqual(['Reads the roadmap', 'Compares prices'])
    expect(log().events.map((event) => event.type)).toEqual(['notice'])
    // Even a narration event that found its way into the events folds to no row.
    expect(foldTranscript([{ type: 'narration', lines: ['Reads the roadmap'] }], extensionTypes, 0)).toEqual([])
    acceptAgentEvent({ sessionId: id, event: result(false) })
    expect(log().narration).toEqual([])
    acceptAgentEvent({ sessionId: id, event: { type: 'narration', lines: ['Writes the answer'] } })
    acceptAgentEvent({ sessionId: id, event: { type: 'prompt', text: 'And then?' } })
    expect(log().narration).toEqual([])
  })

  it('a plain Session shows no status line', () => {
    render(<Transcript events={[prompt('Go'), call('t1', 'Read', { file_path: 'map.md' })]} sessionId="s1" projectId="p1" working />)
    expect(screen.queryByTestId('product-status')).toBeNull()
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

  it('stands last, below the status line, dimmed, with «queued» and no number; several in the order sent', () => {
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
    // The status line stands before the queued messages: the running turn comes first (tickets 28, 29).
    const thinking = screen.getByTestId('product-thinking')
    expect(within(thinking).getByTestId('product-status').textContent).toBe('Thinking…')
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
