// The chips of Mind map nodes under the advisor's messages (src/renderer/product/NodeChips.tsx,
// node-chips.ts; worfy-product-session ticket 09). The chips come from the turn's `mind_map_*` calls,
// whose answer is the node as written: under a message of a turn with two `mind_map_add` calls there are
// two chips. A click on a chip selects the node on the Mind map (its card opens), the pointer on a chip
// lights the node; a node's «Show in the chat» brings the chat to the row its message came in. A plain
// Session's chat shows no chips.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import { MindMap } from '../../src/renderer/product/MindMap'
import { CHIPS_AT_END, transcriptChips, useMindMapFocus } from '../../src/renderer/product/node-chips'
import { foldTranscript } from '../../src/renderer/session/fold'
import { ProductSessionContext, shownInProductChat } from '../../src/renderer/session/product-session'
import { Transcript } from '../../src/renderer/session/Transcript'

vi.mock('../../src/renderer/ipc', () => ({ invoke: vi.fn(), subscribe: () => () => undefined, showSubscribeError: () => undefined }))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))

const ADD = 'mcp__worfy-mind-map__mind_map_add'
const DECIDE = 'mcp__worfy-mind-map__mind_map_decide'

const prompt = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const text = (value: string, messageId: string): AgentEvent => ({ type: 'text', text: value, messageId, parentToolUseId: null, synthetic: false })
const call = (id: string, name: string, input: unknown): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId: null })
const answer = (toolUseId: string, content: unknown, isError = false): AgentEvent => ({
  type: 'tool_result',
  toolUseId,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  isError,
  parentToolUseId: null,
})

const TEAMS = { id: 'idea-teams', kind: 'idea', text: 'Sell to small teams', from: 'ticket:01', advice: true, message: 'uuid-1' }
const WHO = { id: 'who-pays', kind: 'question', text: 'Who pays for it?', from: 'idea-teams', message: 'uuid-2' }

/** A turn with two mind_map_add calls and the answer, then a turn with a plain call only. */
const events: AgentEvent[] = [
  prompt('What could we sell?'),
  call('t1', ADD, { topic: 'demo-roadmap', kind: 'idea', text: TEAMS.text, from: 'ticket:01', advice: true }),
  answer('t1', TEAMS),
  call('t2', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
  answer('t2', WHO),
  text('Two nodes: an idea and the question it raises.', 'msg-1'),
  prompt('Thanks'),
  call('t3', 'Bash', { command: 'ls' }),
  answer('t3', 'a.md'),
  text('Nothing to add.', 'msg-2'),
]

const topic: ProductTopicState = {
  name: 'demo-roadmap',
  folder: '/demo/docs/product/demo-roadmap',
  title: 'Demo roadmap',
  sections: [],
  tickets: [{ number: 1, slug: 'market', file: '01-market.md', title: 'Map the market', status: 'open' }],
  nodes: [
    { id: 'idea-teams', kind: 'idea', text: 'Sell to small teams', from: 'ticket:01', advice: true, message: 'uuid-1' },
    { id: 'who-pays', kind: 'question', text: 'Who pays for it?', from: 'idea-teams', message: 'uuid-2' },
  ],
  errors: [],
}

const PANE = { width: 800, height: 600 }
const globals = globalThis as { ResizeObserver?: unknown; DOMMatrixReadOnly?: unknown }
let saved: { observer: unknown; matrix: unknown }
beforeEach(() => {
  localStorage.clear()
  useMindMapFocus.setState({ picked: null, lit: null, litMessage: [], shown: null, chats: {} })
  saved = { observer: globals.ResizeObserver, matrix: globals.DOMMatrixReadOnly }
  globals.ResizeObserver = class {
    constructor(private readonly report: (entries: { target: Element; contentRect: DOMRect }[], observer: unknown) => void) {}
    observe(target: Element): void {
      queueMicrotask(() => this.report([{ target, contentRect: target.getBoundingClientRect() }], this))
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globals.DOMMatrixReadOnly = class {
    readonly m22 = 1
  }
  const size = (element: HTMLElement, side: 'width' | 'height'): number =>
    element.classList.contains('react-flow') ? PANE[side] : element.classList.contains('react-flow__node') ? Number.parseFloat(element.style[side]) || 0 : 0
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return size(this, 'width')
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return size(this, 'height')
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globals.ResizeObserver = saved.observer
  globals.DOMMatrixReadOnly = saved.matrix
  if (saved.observer === undefined) delete globals.ResizeObserver
  if (saved.matrix === undefined) delete globals.DOMMatrixReadOnly
})

const nodeOf = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="mind-node"][data-id="${id}"]`)

/** A Product Session's body as ProductSessionPanel draws it: the Mind map and the chat. */
function ProductBody({ shown = events }: { shown?: readonly AgentEvent[] }) {
  return (
    <>
      <MindMap projectId="p1" topic={topic} />
      <ProductSessionContext value={true}>
        <Transcript events={shown} projectId="p1" />
      </ProductSessionContext>
    </>
  )
}

describe('chips of Mind map nodes under a message', () => {
  it('a message of a turn with two mind_map_add calls has two chips; a turn without them has none', () => {
    render(<ProductBody />)
    const lists = screen.getAllByTestId('node-chips')
    expect(lists).toHaveLength(1)
    const chips = within(lists[0]!).getAllByTestId('node-chip')
    expect(chips.map((chip) => chip.dataset['id'])).toEqual(['idea-teams', 'who-pays'])
    expect(chips.map((chip) => chip.textContent)).toEqual(['✦Sell to small teams', '?Who pays for it?'])
    // Under the turn's answer, not under the next turn's.
    const answerRow = screen.getByText('Two nodes: an idea and the question it raises.').closest('[data-item]')!
    expect(answerRow.contains(lists[0]!)).toBe(true)
    expect(screen.getByText('Nothing to add.').closest('[data-item]')!.querySelector('[data-testid="node-chips"]')).toBeNull()
  })

  it('a click on a chip selects the node on the Mind map: its card opens', () => {
    render(<ProductBody />)
    expect(screen.queryByRole('region', { name: 'Node' })).toBeNull()
    act(() => fireEvent.click(screen.getAllByTestId('node-chip')[1]!))
    const card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByText('Who pays for it?')).toBeTruthy()
    expect(nodeOf('who-pays')!.className).toContain('w-mind__node--selected')
  })

  it('the pointer on a chip lights its node, and leaving the chip puts the light out', () => {
    render(<ProductBody />)
    const chip = screen.getAllByTestId('node-chip')[0]!
    act(() => fireEvent.mouseEnter(chip))
    expect(nodeOf('idea-teams')!.dataset['lit']).toBe('true')
    expect(nodeOf('who-pays')!.dataset['lit']).toBeUndefined()
    act(() => fireEvent.mouseLeave(chip))
    expect(nodeOf('idea-teams')!.dataset['lit']).toBeUndefined()
  })

  it('a node’s «Show in the chat» brings the chat to the message that carries its chip: the calls are not drawn', () => {
    render(<ProductBody />)
    fireEvent.click(nodeOf('who-pays')!)
    const card = screen.getByRole('region', { name: 'Node' })
    act(() => fireEvent.click(within(card).getByRole('button', { name: 'Show the message in the chat' })))
    const shown = document.querySelector<HTMLElement>('[data-item][data-shown]')
    expect(shown).not.toBeNull()
    expect(within(shown!).queryAllByTestId('tool-call')).toEqual([])
    expect(within(shown!).getByTestId('transcript-text').textContent).toContain('Two nodes: an idea and the question it raises.')
    expect(within(shown!).getAllByTestId('node-chip').map((chip) => chip.dataset['id'])).toEqual(['idea-teams', 'who-pays'])
  })

  // worfy-product-session ticket 19: the calls are not drawn, so a turn that wrote nodes and gave no
  // answer shows its chips under its prompt, and «Show in the chat» goes there.
  it('a turn without an answer shows its chips under its prompt, and «Show in the chat» goes to that prompt', () => {
    const silent: AgentEvent[] = [
      prompt('Map the question'),
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
      answer('t1', WHO),
    ]
    const { byRow, rowOfMessage } = transcriptChips(foldTranscript(silent), shownInProductChat)
    expect([...byRow.keys()]).toEqual(['e0'])
    expect(rowOfMessage.get('uuid-2')).toBe('e0')
    render(<ProductBody shown={silent} />)
    const row = screen.getByTestId('transcript-prompt').closest<HTMLElement>('[data-item]')!
    expect(within(row).getAllByTestId('node-chip').map((chip) => chip.dataset['id'])).toEqual(['who-pays'])
    fireEvent.click(nodeOf('who-pays')!)
    act(() => fireEvent.click(within(screen.getByRole('region', { name: 'Node' })).getByRole('button', { name: 'Show the message in the chat' })))
    expect(document.querySelector<HTMLElement>('[data-item][data-shown]')).toBe(row)
  })

  // Review of PR #1695: a turn whose rows in the window are all hidden (the window starts in its calls).
  it('a turn with no row drawn hangs its chips on the next row drawn, and «Show in the chat» goes there', () => {
    const midTurn: AgentEvent[] = [
      { type: 'thinking', text: 'Mapping', messageId: 'th', parentToolUseId: null },
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
      answer('t1', WHO),
      prompt('Next question'),
      text('Noted.', 'msg-9'),
    ]
    const { byRow, rowOfMessage } = transcriptChips(foldTranscript(midTurn), shownInProductChat)
    expect([...byRow.keys()]).toEqual(['e3'])
    expect(rowOfMessage.get('uuid-2')).toBe('e3')
    render(<ProductBody shown={midTurn} />)
    const row = screen.getByTestId('transcript-prompt').closest<HTMLElement>('[data-item]')!
    expect(within(row).getAllByTestId('node-chip').map((chip) => chip.dataset['id'])).toEqual(['who-pays'])
    fireEvent.click(nodeOf('who-pays')!)
    act(() => fireEvent.click(within(screen.getByRole('region', { name: 'Node' })).getByRole('button', { name: 'Show the message in the chat' })))
    expect(document.querySelector<HTMLElement>('[data-item][data-shown]')).toBe(row)
  })

  it('a turn with no row drawn and none after it shows its chips at the end of the chat, and «Show in the chat» goes there', () => {
    const lastTurn: AgentEvent[] = [
      { type: 'thinking', text: 'Mapping', messageId: 'th', parentToolUseId: null },
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
      answer('t1', WHO),
    ]
    const { byRow, rowOfMessage } = transcriptChips(foldTranscript(lastTurn), shownInProductChat)
    expect([...byRow.keys()]).toEqual([CHIPS_AT_END])
    expect(rowOfMessage.get('uuid-2')).toBe(CHIPS_AT_END)
    render(
      <>
        <MindMap projectId="p1" topic={topic} />
        <ProductSessionContext value={true}>
          <Transcript events={lastTurn} projectId="p1" working />
        </ProductSessionContext>
      </>,
    )
    const end = screen.getByTestId('product-chat-end')
    expect(within(end).getByTestId('product-thinking')).toBeTruthy()
    expect(within(end).getAllByTestId('node-chip').map((chip) => chip.dataset['id'])).toEqual(['who-pays'])
    act(() => fireEvent.mouseEnter(end))
    expect(nodeOf('who-pays')!.dataset['lit']).toBe('true')
    act(() => fireEvent.mouseLeave(end))
    fireEvent.click(nodeOf('who-pays')!)
    act(() => fireEvent.click(within(screen.getByRole('region', { name: 'Node' })).getByRole('button', { name: 'Show the message in the chat' })))
    expect(end.hasAttribute('data-shown')).toBe(true)
  })

  it('the pointer on a message lights every node of its chips on the Mind map; leaving it puts the light out', () => {
    render(<ProductBody />)
    const message = screen.getByText('Two nodes: an idea and the question it raises.').closest<HTMLElement>('[data-item]')!
    act(() => fireEvent.mouseEnter(message))
    expect(nodeOf('idea-teams')!.dataset['lit']).toBe('true')
    expect(nodeOf('who-pays')!.dataset['lit']).toBe('true')
    act(() => fireEvent.mouseLeave(message))
    expect(nodeOf('idea-teams')!.dataset['lit']).toBeUndefined()
    expect(nodeOf('who-pays')!.dataset['lit']).toBeUndefined()
    // A message without chips lights nothing.
    act(() => fireEvent.mouseEnter(screen.getByText('Nothing to add.').closest<HTMLElement>('[data-item]')!))
    expect(document.querySelectorAll('[data-testid="mind-node"][data-lit]')).toHaveLength(0)
  })

  it('a chat opened again after «Show in the chat» does not act on that request again: nothing is marked, the log stays at its end', () => {
    const { unmount } = render(<ProductBody />)
    fireEvent.click(nodeOf('who-pays')!)
    act(() => fireEvent.click(within(screen.getByRole('region', { name: 'Node' })).getByRole('button', { name: 'Show the message in the chat' })))
    expect(document.querySelector('[data-item][data-shown]')).not.toBeNull()
    unmount()
    render(<ProductBody />)
    expect(document.querySelector('[data-item][data-shown]')).toBeNull()
    // A new request still acts.
    fireEvent.click(nodeOf('idea-teams')!)
    act(() => fireEvent.click(within(screen.getByRole('region', { name: 'Node' })).getByRole('button', { name: 'Show the message in the chat' })))
    expect(document.querySelector('[data-item][data-shown]')).not.toBeNull()
  })

  it('a decision written twice in one turn is one chip, as its last call left it; a refused call makes none', () => {
    const decided = { ...WHO, kind: 'decision', status: 'rejected', reason: 'No one pays', message: 'uuid-3' }
    const items = foldTranscript([
      prompt('Decide'),
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
      answer('t1', WHO),
      call('t2', DECIDE, { topic: 'demo-roadmap', id: 'who-pays', status: 'rejected', reason: 'No one pays' }),
      answer('t2', decided),
      call('t3', ADD, { topic: 'demo-roadmap', kind: 'idea', text: 'x', from: 'nowhere' }),
      answer('t3', 'The change is refused, nothing was written', true),
      text('Rejected.', 'msg-1'),
    ])
    const { byRow, rowOfMessage } = transcriptChips(items, shownInProductChat)
    expect([...byRow.values()].map((chips) => chips.map((chip) => [chip.topic, chip.node.id, chip.node.status]))).toEqual([[['demo-roadmap', 'who-pays', 'rejected']]])
    expect([...rowOfMessage.entries()]).toEqual([
      ['uuid-2', 'e7'],
      ['uuid-3', 'e7'],
    ])
  })

  it('a plain Session’s chat shows no chips', () => {
    render(<Transcript events={events} projectId="p1" />)
    expect(screen.queryAllByTestId('node-chip')).toEqual([])
  })
})
