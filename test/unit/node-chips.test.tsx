// The chips of Mind map nodes under the messages of a Product Session's chat (src/renderer/product/NodeChips.tsx,
// node-chips.ts; worfy-product-session tickets 09 and 22). The chips come from the `mind_map_*` calls,
// whose answer is the node as written; a node's chip stands under the message that made it — the last
// message drawn before its call: under an answer followed by two `mind_map_add` calls there are two chips. A click on a chip selects the node on the Mind map (its card opens), the pointer on a chip
// lights the node; a node's «Show in the chat» brings the chat to the row its message came in. A plain
// Session's chat shows no chips.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import { MindMap } from '../../src/renderer/product/MindMap'
import { CHIPS_AT_END, messageQuote, quoteLabel, showMessage, transcriptChips, useMindMapFocus } from '../../src/renderer/product/node-chips'
import { invoke } from '../../src/renderer/ipc'
import { foldTranscript } from '../../src/renderer/session/fold'
import { ProductSessionContext, shownInProductChat } from '../../src/renderer/session/product-session'
import { Transcript } from '../../src/renderer/session/Transcript'

vi.mock('../../src/renderer/ipc', () => ({ invoke: vi.fn(), subscribe: () => () => undefined, showSubscribeError: () => undefined }))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))

const ADD = 'mcp__worfy-mind-map__mind_map_add'
const DECIDE = 'mcp__worfy-mind-map__mind_map_decide'
const UPDATE = 'mcp__worfy-mind-map__mind_map_update'

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

/** A turn with the answer and the two mind_map_add calls after it, then a turn with a plain call only. */
const events: AgentEvent[] = [
  prompt('What could we sell?'),
  text('Two nodes: an idea and the question it raises.', 'msg-1'),
  call('t1', ADD, { topic: 'demo-roadmap', kind: 'idea', text: TEAMS.text, from: 'ticket:01', advice: true }),
  answer('t1', TEAMS),
  call('t2', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
  answer('t2', WHO),
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
  it('an answer followed by two mind_map_add calls has two chips; a turn without them has none', () => {
    render(<ProductBody />)
    const lists = screen.getAllByTestId('node-chips')
    expect(lists).toHaveLength(1)
    const chips = within(lists[0]!).getAllByTestId('node-chip')
    expect(chips.map((chip) => chip.dataset['id'])).toEqual(['idea-teams', 'who-pays'])
    expect(chips.map((chip) => chip.textContent)).toEqual(['+ Idea: Sell to small teams', '+ Question: Who pays for it?'])
    // Under the turn's answer, not under its prompt nor the next turn's.
    expect(screen.getByText('What could we sell?').closest('[data-item]')!.querySelector('[data-testid="node-chips"]')).toBeNull()
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

  it('a node written twice under one message is one chip, as its last call left it; a refused call makes none', () => {
    const decided = { ...WHO, kind: 'decision', status: 'rejected', reason: 'No one pays', message: 'uuid-3' }
    const items = foldTranscript([
      prompt('Decide'),
      text('Rejected.', 'msg-1'),
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'question', text: WHO.text, from: 'idea-teams' }),
      answer('t1', WHO),
      call('t2', DECIDE, { topic: 'demo-roadmap', id: 'who-pays', status: 'rejected', reason: 'No one pays' }),
      answer('t2', decided),
      call('t3', ADD, { topic: 'demo-roadmap', kind: 'idea', text: 'x', from: 'nowhere' }),
      answer('t3', 'The change is refused, nothing was written', true),
    ])
    const { byRow, rowOfMessage } = transcriptChips(items, shownInProductChat)
    // Added under this message, then decided: one chip, added, as the decision left it.
    expect([...byRow.values()].map((chips) => chips.map((chip) => [chip.topic, chip.node.id, chip.node.status, chip.change]))).toEqual([[['demo-roadmap', 'who-pays', 'rejected', 'added']]])
    expect([...rowOfMessage.entries()]).toEqual([
      ['uuid-2', 'e1'],
      ['uuid-3', 'e1'],
    ])
  })

  // worfy-product-session ticket 22: the prototype puts each node's chip under the message that made it,
  // not all of a turn's chips under its last answer.
  it('each node’s chip stands under the message drawn before its call: a call before any answer under the prompt', () => {
    const IDEA = { id: 'idea-1', kind: 'idea', text: 'One map for a solo author', from: null, message: 'uuid-a' }
    const QUESTION = { id: 'q-1', kind: 'question', text: 'Who decides?', from: 'idea-1', message: 'uuid-b' }
    const OBJECTION = { id: 'o-1', kind: 'objection', text: 'Teams differ', from: 'idea-1', source: 'PR #1', message: 'uuid-c' }
    const DECISION = { id: 'd-1', kind: 'decision', text: 'The human decides', from: 'q-1', status: 'accepted', reason: 'Owner said so', message: 'uuid-c' }
    const turn: AgentEvent[] = [
      prompt('A tool for a solo author'),
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'idea', text: IDEA.text, from: null }),
      answer('t1', IDEA),
      text('I propose one map.', 'msg-2'),
      call('t2', ADD, { topic: 'demo-roadmap', kind: 'question', text: QUESTION.text, from: 'idea-1' }),
      answer('t2', QUESTION),
      text('Two things to weigh.', 'msg-3'),
      call('t3', ADD, { topic: 'demo-roadmap', kind: 'objection', text: OBJECTION.text, from: 'idea-1', source: 'PR #1' }),
      answer('t3', OBJECTION),
      call('t4', ADD, { topic: 'demo-roadmap', kind: 'decision', text: DECISION.text, from: 'q-1', status: 'accepted', reason: 'Owner said so' }),
      answer('t4', DECISION),
    ]
    const { byRow, rowOfMessage } = transcriptChips(foldTranscript(turn), shownInProductChat)
    expect([...byRow].map(([row, chips]) => [row, chips.map((chip) => chip.node.id)])).toEqual([
      ['e0', ['idea-1']],
      ['e3', ['q-1']],
      ['e6', ['o-1', 'd-1']],
    ])
    expect(rowOfMessage.get('uuid-a')).toBe('e0')
    expect(rowOfMessage.get('uuid-b')).toBe('e3')
    render(<ProductBody shown={turn} />)
    const chipsUnder = (message: string) =>
      within(screen.getByText(message).closest<HTMLElement>('[data-item]')!)
        .queryAllByTestId('node-chip')
        .map((chip) => chip.textContent)
    expect(chipsUnder('A tool for a solo author')).toEqual(['+ Idea: One map for a solo author'])
    expect(chipsUnder('I propose one map.')).toEqual(['+ Question: Who decides?'])
    expect(chipsUnder('Two things to weigh.')).toEqual(['+ Objection: Teams differ', '+ Decision ✓: The human decides'])
  })

  it('a chip names the kind: «+» for a node added, none for one changed, a red «↺ … → rejected» for an overturned Decision', () => {
    const ACCEPTED = { id: 'd-1', kind: 'decision', text: 'Harness first', from: null, status: 'accepted', reason: 'Fast', message: 'uuid-1' }
    const OVERTURNED = { ...ACCEPTED, status: 'rejected', reason: 'Users first', history: [{ status: 'accepted', reason: 'Fast', message: 'uuid-1' }], message: 'uuid-2' }
    const RENAMED = { ...TEAMS, text: 'Sell to solo authors', message: 'uuid-3' }
    const turns: AgentEvent[] = [
      prompt('Start'),
      text('Harness first.', 'msg-1'),
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'decision', text: ACCEPTED.text, from: null, status: 'accepted', reason: 'Fast' }),
      answer('t1', ACCEPTED),
      prompt('No, users first'),
      text('Overturned.', 'msg-2'),
      call('t2', DECIDE, { topic: 'demo-roadmap', id: 'd-1', status: 'rejected', reason: 'Users first' }),
      answer('t2', OVERTURNED),
      call('t3', UPDATE, { topic: 'demo-roadmap', id: 'idea-teams', text: RENAMED.text }),
      answer('t3', RENAMED),
    ]
    render(<ProductBody shown={turns} />)
    const chipsUnder = (message: string) => within(screen.getByText(message).closest<HTMLElement>('[data-item]')!).getAllByTestId('node-chip')
    const [added] = chipsUnder('Harness first.')
    expect(added!.textContent).toBe('+ Decision ✓: Harness first')
    expect(added!.className).toContain('w-chips__chip--decision')
    const [overturned, changed] = chipsUnder('Overturned.')
    expect(overturned!.textContent).toBe('↺ “Harness first” → rejected')
    expect(overturned!.className).toContain('w-chips__chip--overturned')
    expect(overturned!.dataset['change']).toBe('overturned')
    expect(overturned!.getAttribute('aria-label')).toBe('Show on the Mind map: ↺ “Harness first” → rejected')
    expect(changed!.textContent).toBe('Idea: Sell to solo authors')
    expect(changed!.dataset['change']).toBe('changed')
  })

  it('a plain Session’s chat shows no chips', () => {
    render(<Transcript events={events} projectId="p1" />)
    expect(screen.queryAllByTestId('node-chip')).toEqual([])
  })

  // worfy-product-session ticket 24 (N5): as the prototype's selection, a chip's click rings the message the
  // chip stands under, with the ring «Show in the chat» gives; the chat does not move, the message is on screen.
  it('a click on a chip also rings the message it stands under, and asks the chat not to scroll', () => {
    render(<ProductBody />)
    expect(document.querySelector('[data-item][data-shown]')).toBeNull()
    // The scrolls of the chat's log to a message: each row stands 500 px down the log, so bringing a row into
    // view sets the log's scrollTop to 500. (Following the end sets it to the log's height, 0 here.)
    const log = screen.getByTestId('transcript')
    const rect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.hasAttribute('data-item') ? DOMRect.fromRect({ x: 0, y: 500, width: 100, height: 40 }) : rect.call(this)
    })
    const scrolls: number[] = []
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, value: number) {
      if (this === log && value === 500) scrolls.push(value)
    })
    act(() => fireEvent.click(screen.getAllByTestId('node-chip')[1]!))
    expect(useMindMapFocus.getState().shown).toMatchObject({ projectId: 'p1', message: 'uuid-2', scroll: false })
    const shown = document.querySelector<HTMLElement>('[data-item][data-shown]')
    expect(shown).not.toBeNull()
    expect(within(shown!).getByTestId('transcript-text').textContent).toContain('Two nodes: an idea and the question it raises.')
    expect(nodeOf('who-pays')!.className).toContain('w-mind__node--selected')
    expect(scrolls).toEqual([])

    // The card's «Show in the chat» for the same message does scroll the log to it.
    act(() => fireEvent.click(within(screen.getByRole('region', { name: 'Node' })).getByRole('button', { name: 'Show the message in the chat' })))
    expect(scrolls).toEqual([500])
  })

  // Ticket 24, row 14 of the comparison: the card's «Message» quotes the message — «#2 Advisor: “…”» — as the
  // prototype does, when the loaded chat has it; else it keeps «Show in the chat».
  it('a node card quotes its message with the number and the author when the chat has it, and keeps the link when not', () => {
    const { unmount } = render(<ProductBody />)
    fireEvent.click(nodeOf('who-pays')!)
    let card = screen.getByRole('region', { name: 'Node' })
    const link = within(card).getByRole('button', { name: 'Show the message in the chat' })
    expect(link.textContent).toBe('#2 Advisor')
    expect(link.closest('dd')!.textContent).toBe('#2 Advisor: “Two nodes: an idea and the question it raises.”')
    act(() => fireEvent.click(link))
    expect(within(document.querySelector<HTMLElement>('[data-item][data-shown]')!).getByTestId('transcript-text').textContent).toContain('Two nodes')
    unmount()

    // The chat holds only the first call: the second node's message is not in it.
    render(<ProductBody shown={events.slice(0, 4)} />)
    fireEvent.click(nodeOf('who-pays')!)
    card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByRole('button', { name: 'Show the message in the chat' }).textContent).toBe('Show in the chat')
  })

  // worfy-product-session ticket 25 (R1 of the final comparison): as the prototype's selectNode(null) clears
  // highlightMsg, closing the node card takes the ring off the chat's message, whichever way the card closes;
  // another chip moves the ring.
  it('closing the node card takes the ring off the message: the close button, Escape, a click on the empty map', () => {
    render(<ProductBody />)
    const ringed = () => document.querySelector<HTMLElement>('[data-item][data-shown]')
    const card = () => screen.queryByRole('region', { name: 'Node' })
    const [first, second] = screen.getAllByTestId('node-chip')

    act(() => fireEvent.click(first!))
    expect(ringed()).not.toBeNull()
    act(() => fireEvent.click(within(card()!).getByRole('button', { name: 'Close the card' })))
    expect(card()).toBeNull()
    expect(ringed()).toBeNull()

    act(() => fireEvent.click(second!))
    expect(ringed()).not.toBeNull()
    act(() => fireEvent.keyDown(card()!, { key: 'Escape' }))
    expect(card()).toBeNull()
    expect(ringed()).toBeNull()

    act(() => fireEvent.click(first!))
    expect(ringed()).not.toBeNull()
    act(() => fireEvent.click(document.querySelector('.react-flow__pane')!))
    expect(card()).toBeNull()
    expect(ringed()).toBeNull()

    // A node's own «Show in the chat» rings while its card is open; picking another chip keeps a ring.
    act(() => fireEvent.click(nodeOf('who-pays')!))
    act(() => fireEvent.click(within(card()!).getByRole('button', { name: 'Show the message in the chat' })))
    expect(ringed()).not.toBeNull()
    act(() => fireEvent.click(first!))
    expect(card()).not.toBeNull()
    expect(ringed()).not.toBeNull()
  })

  // Ticket 25, review round 2: a chip whose node is in a folded branch, clicked while another card is open. The
  // node is selected before the branch unfolds and is drawn only after main's change comes back; that wait is not
  // a closed card, so the ring the chip asked for stays, and stays once the card opens.
  it('a chip of a node in a folded branch, clicked while another card is open, keeps its ring while the branch unfolds', () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, value: null })
    try {
      const folded: ProductTopicState = { ...topic, nodes: topic.nodes.map((node) => (node.id === 'idea-teams' ? { ...node, collapsed: true } : node)) }
      const body = (shown: ProductTopicState) => (
        <>
          <MindMap projectId="p1" topic={shown} />
          <ProductSessionContext value={true}>
            <Transcript events={events} projectId="p1" />
          </ProductSessionContext>
        </>
      )
      const { rerender } = render(body(folded))
      const ringed = () => document.querySelector<HTMLElement>('[data-item][data-shown]')
      const [teams, who] = screen.getAllByTestId('node-chip')
      act(() => fireEvent.click(teams!))
      expect(screen.getByRole('region', { name: 'Node' })).toBeTruthy()
      expect(nodeOf('who-pays')).toBeNull()
      act(() => fireEvent.click(who!))
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('product.layout', { projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: false })
      expect(ringed()).not.toBeNull()
      // main's change: the branch is unfolded, the node is drawn and its card opens with the ring still on.
      rerender(body(topic))
      expect(nodeOf('who-pays')!.className).toContain('w-mind__node--selected')
      expect(within(screen.getByRole('region', { name: 'Node' })).getByText('Who pays for it?')).toBeTruthy()
      expect(ringed()).not.toBeNull()
    } finally {
      vi.mocked(invoke).mockReset()
    }
  })

  // Ticket 25, review round 2: only a card that was open and closed takes the ring off. A Mind map mounted, or
  // switched to another topic, with no card open leaves a ring «Show in the chat» set.
  it('a Mind map mounted or switched to another topic with no card open leaves the ring on', () => {
    // The chat keeps its place in the tree: a chat mounted again takes the last request as done (ticket 09).
    const body = (map: ProductTopicState | null) => (
      <>
        {map === null ? null : <MindMap key={map.name} projectId="p1" topic={map} />}
        <ProductSessionContext value={true}>
          <Transcript events={events} projectId="p1" />
        </ProductSessionContext>
      </>
    )
    const { rerender } = render(body(null))
    const ringed = () => document.querySelector<HTMLElement>('[data-item][data-shown]')
    act(() => showMessage('p1', 'uuid-2'))
    expect(ringed()).not.toBeNull()
    rerender(body(topic))
    expect(ringed()).not.toBeNull()
    // Another topic: a new Mind map is mounted in place of the first.
    rerender(body({ ...topic, name: 'other-topic', title: 'Other topic' }))
    expect(ringed()).not.toBeNull()
  })

  // Ticket 25, row 14 of the comparison: the card's History numbers its steps by the chat's message numbers —
  // «step 2:», «step 4:» — as the prototype numbers them; without the chat the list keeps its plain order.
  it('a Decision’s History names each step by its message’s number in the chat, and keeps the plain order without it', () => {
    const ACCEPTED = { id: 'd-1', kind: 'decision', text: 'Harness first', from: null, status: 'accepted', reason: 'Fast', message: 'uuid-1' }
    const OVERTURNED = { ...ACCEPTED, status: 'rejected', reason: 'Users first', history: [{ status: 'accepted', reason: 'Fast', message: 'uuid-1' }], message: 'uuid-2' }
    const turns: AgentEvent[] = [
      prompt('Start'),
      text('Harness first.', 'msg-1'),
      call('t1', ADD, { topic: 'demo-roadmap', kind: 'decision', text: ACCEPTED.text, from: null, status: 'accepted', reason: 'Fast' }),
      answer('t1', ACCEPTED),
      prompt('No, users first'),
      text('Overturned.', 'msg-2'),
      call('t2', DECIDE, { topic: 'demo-roadmap', id: 'd-1', status: 'rejected', reason: 'Users first' }),
      answer('t2', OVERTURNED),
    ]
    const decided: ProductTopicState = { ...topic, nodes: [OVERTURNED as ProductTopicState['nodes'][number]] }
    const steps = () => within(screen.getByRole('region', { name: 'Node' })).getAllByRole('listitem').map((item) => item.textContent)

    const { unmount } = render(
      <>
        <MindMap projectId="p1" topic={decided} />
        <ProductSessionContext value={true}>
          <Transcript events={turns} projectId="p1" />
        </ProductSessionContext>
      </>,
    )
    fireEvent.click(nodeOf('d-1')!)
    expect(steps()).toEqual(['step 2: accepted — Fast', 'step 4: rejected — Users first'])
    unmount()

    // The chat has loaded the first step's message only: no step is named by a number, the list keeps its order.
    const { unmount: unmountPart } = render(
      <>
        <MindMap projectId="p1" topic={decided} />
        <ProductSessionContext value={true}>
          <Transcript events={turns.slice(0, 4)} projectId="p1" />
        </ProductSessionContext>
      </>,
    )
    fireEvent.click(nodeOf('d-1')!)
    expect(steps()).toEqual(['accepted — Fast', 'rejected — Users first'])
    unmountPart()

    render(<MindMap projectId="p1" topic={decided} />)
    fireEvent.click(nodeOf('d-1')!)
    expect(steps()).toEqual(['accepted — Fast', 'rejected — Users first'])
  })

  it('a quoted message is cut to 60 characters, an owner’s prompt is «You», the whitespace of an answer is one space', () => {
    expect(messageQuote(3, 'you', 'Short')).toEqual({ number: 3, who: 'you', text: 'Short' })
    const long = 'A'.repeat(40) + ' ' + 'B'.repeat(30)
    expect(messageQuote(1, 'advisor', long).text).toBe(long.slice(0, 58) + '…')
    expect(messageQuote(1, 'advisor', '**Two** lines\n\n- and a list').text).toBe('Two lines - and a list')
    expect(quoteLabel({ number: 5, who: 'advisor', text: 'x' })).toBe('#5 Advisor')
    expect(quoteLabel({ number: 1, who: 'you', text: 'x' })).toBe('#1 You')
  })
})
