// The Mind map by hand (src/renderer/product/MindMap.tsx, worfy-product-session ticket 09): a node of
// mind-map.json dragged and let go asks main to write its new `x` and `y` through `product.layout`; the
// fold mark of a node with children asks it to write `collapsed`, and a folded branch is off the screen
// until it is unfolded. Nothing else is changed by hand: the card has no field to type in, only the hint
// to ask the advisor. On a read-only screen (a Linked machine) nothing is dragged or folded. No ELK
// worker in jsdom: the synchronous layout answers.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import { MindMap } from '../../src/renderer/product/MindMap'
import { lightNode, pickNode, useMindMapFocus } from '../../src/renderer/product/node-chips'

const invoke = vi.hoisted(() => vi.fn<(channel: string, input?: unknown) => Promise<unknown>>())
vi.mock('../../src/renderer/ipc', () => ({ invoke, subscribe: () => () => undefined, showSubscribeError: () => undefined }))
const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => readOnly.hint }))

const topic = (patch: Partial<ProductTopicState> = {}): ProductTopicState => ({
  name: 'demo-roadmap',
  folder: '/demo/docs/product/demo-roadmap',
  title: 'Demo roadmap',
  sections: [],
  tickets: [{ number: 1, slug: 'market', file: '01-market.md', title: 'Map the market', status: 'open' }],
  nodes: [
    { id: 'idea-teams', kind: 'idea', text: 'Sell to small teams', from: 'ticket:01', advice: true },
    { id: 'who-pays', kind: 'question', text: 'Who pays for it?', from: 'idea-teams' },
    { id: 'per-seat', kind: 'idea', text: 'Per seat', from: 'who-pays' },
  ],
  errors: [],
  ...patch,
})

const PANE = { width: 800, height: 600 }

const globals = globalThis as { ResizeObserver?: unknown; DOMMatrixReadOnly?: unknown }
let saved: { observer: unknown; matrix: unknown }
beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ ok: true, value: null })
  readOnly.hint = null
  useMindMapFocus.setState({ picked: null, lit: null, shown: null, chats: {} })
  localStorage.clear()
  saved = { observer: globals.ResizeObserver, matrix: globals.DOMMatrixReadOnly }
  // React Flow measures a node when its observer reports it, and reads the zoom from the viewport's CSS
  // transform, which jsdom cannot parse (as in mind-map-view.test.tsx).
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
const wrapperOf = (id: string): HTMLElement => nodeOf(id)!.closest<HTMLElement>('.react-flow__node')!
const zoomOf = (): number => Number.parseInt(screen.getByTestId('mind-map-zoom').textContent ?? '100', 10) / 100

/** Where React Flow draws a node now, from its wrapper's transform. */
function placeOf(id: string): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(wrapperOf(id).style.transform)
  if (match === null) throw new Error(`node ${id} has no place: ${wrapperOf(id).style.transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** A mouse event with `view`, which d3-drag listens on for the moves; jsdom refuses it in the event's init. */
function mouse(type: string, init: MouseEventInit): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'view', { value: window })
  return event
}

/** How far the pointer goes before the drag starts. */
const STARTED = 2

/** A drag of the node by (dx, dy) screen pixels with the mouse, as d3-drag under React Flow reads it. */
async function drag(id: string, dx: number, dy: number): Promise<void> {
  const target = nodeOf(id)!
  await act(async () => {
    fireEvent(target, mouse('mousedown', { clientX: 100, clientY: 100, button: 0 }))
    // React Flow starts the drag once the pointer is past its threshold (1 px), from where it is then.
    fireEvent(window, mouse('mousemove', { clientX: 100 + STARTED, clientY: 100, buttons: 1 }))
    fireEvent(window, mouse('mousemove', { clientX: 100 + dx, clientY: 100 + dy, buttons: 1 }))
    fireEvent(window, mouse('mouseup', { clientX: 100 + dx, clientY: 100 + dy }))
    // d3-drag swallows the click that follows a drag until its next task: the next test's clicks wait for it.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const layoutCalls = () => invoke.mock.calls.filter(([channel]) => channel === 'product.layout').map(([, input]) => input)

/** Turns «Move nodes» on (ticket 31): nodes are dragged only while it is. */
const moveOn = (): void => {
  const toggle = screen.getByRole('button', { name: 'Move nodes' })
  if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
}

describe('MindMap by hand', () => {
  it('a drag of a node writes its new x and y through product.layout when it is let go, and the node stays there', async () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const before = placeOf('who-pays')
    const zoom = zoomOf()
    moveOn()
    await drag('who-pays', 80, 40)
    await waitFor(() => expect(layoutCalls()).toHaveLength(1))
    const [written] = layoutCalls() as { projectId: string; name: string; id: string; x: number; y: number }[]
    expect(written).toEqual({ projectId: 'p1', name: 'demo-roadmap', id: 'who-pays', x: expect.any(Number), y: expect.any(Number) })
    expect(written!.x).toBeCloseTo(before.x + (80 - STARTED) / zoom, 0)
    expect(written!.y).toBeCloseTo(before.y + 40 / zoom, 0)
    // Until main's change comes back the node stays where it was let go, not back at the layout's place.
    expect(placeOf('who-pays')).toEqual({ x: written!.x, y: written!.y })
  })

  it('the topic and the Tickets are not dragged: they are not in mind-map.json', async () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('ticket:01').style.transform).toMatch(/translate/))
    moveOn()
    await drag('ticket:01', 80, 40)
    await drag('@topic', 80, 40)
    expect(layoutCalls()).toEqual([])
  })

  it('the fold mark of a node with children writes collapsed: true; a folded branch is off the screen and unfolds with collapsed: false', () => {
    const { rerender } = render(<MindMap projectId="p1" topic={topic()} />)
    // A node with no children has no fold mark.
    expect(within(nodeOf('per-seat')!).queryByRole('button')).toBeNull()
    const fold = within(nodeOf('idea-teams')!).getByRole('button', { name: 'Fold the branch' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    // The node stays the one stop for Tab (ticket 08): the mark is reached by the pointer.
    expect(fold.tabIndex).toBe(-1)
    fireEvent.click(fold)
    expect(layoutCalls()).toEqual([{ projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: true }])
    // The click on the mark does not open the node's card.
    expect(screen.queryByRole('region', { name: 'Node' })).toBeNull()

    const folded = topic().nodes.map((node) => (node.id === 'idea-teams' ? { ...node, collapsed: true } : node))
    rerender(<MindMap projectId="p1" topic={topic({ nodes: folded })} />)
    expect(nodeOf('who-pays')).toBeNull()
    expect(nodeOf('per-seat')).toBeNull()
    const unfold = within(nodeOf('idea-teams')!).getByRole('button', { name: 'Unfold the branch: 2 nodes' })
    expect(unfold.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(unfold)
    expect(layoutCalls()).toEqual([
      { projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: true },
      { projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: false },
    ])
  })

  it('from the keyboard: ArrowLeft folds the focused node’s branch and ArrowRight unfolds it; Enter still opens the card', () => {
    const { rerender } = render(<MindMap projectId="p1" topic={topic()} />)
    const node = screen.getByRole('button', { name: 'Idea: Sell to small teams' })
    node.focus()
    fireEvent.keyDown(node, { key: 'ArrowRight' })
    expect(layoutCalls()).toEqual([])
    fireEvent.keyDown(node, { key: 'ArrowLeft' })
    expect(layoutCalls()).toEqual([{ projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: true }])
    const folded = topic().nodes.map((each) => (each.id === 'idea-teams' ? { ...each, collapsed: true } : each))
    rerender(<MindMap projectId="p1" topic={topic({ nodes: folded })} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Idea: Sell to small teams' }), { key: 'ArrowRight' })
    expect(layoutCalls()).toHaveLength(2)
    expect(layoutCalls()[1]).toEqual({ projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: false })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Idea: Sell to small teams' }), { key: 'Enter' })
    expect(screen.getByRole('region', { name: 'Node' })).toBeTruthy()
  })

  it('the card of a node has no field to type in, only the hint to ask the advisor', () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    fireEvent.click(nodeOf('who-pays')!)
    const card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).queryAllByRole('textbox')).toEqual([])
    expect(card.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0)
    expect(within(card).getByText('To change this node, ask the advisor in the chat.')).toBeTruthy()
  })

  it('a refused write puts the node back at its place and says why', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'The Mind map has no node "who-pays".' })
    render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const before = placeOf('who-pays')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    moveOn()
    await drag('who-pays', 80, 40)
    await waitFor(() => expect(screen.getByTestId('mind-map-write-error').textContent).toContain('The Mind map has no node "who-pays".'))
    expect(placeOf('who-pays')).toEqual(before)
  })

  it('on a read-only screen nothing is dragged or folded: the fold mark is inactive and says why', async () => {
    readOnly.hint = 'Studio gives this Machine read-only access'
    render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const before = placeOf('who-pays')
    // «Move nodes» cannot be turned on: it is inactive and says why.
    const toggle = screen.getByRole('button', { name: 'Move nodes' })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    expect(toggle.title).toBe('Studio gives this Machine read-only access')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await drag('who-pays', 80, 40)
    // The node does not follow the pointer either.
    expect(placeOf('who-pays')).toEqual(before)
    const fold = within(nodeOf('idea-teams')!).getByRole('button', { name: 'Fold the branch' })
    expect(fold.getAttribute('aria-disabled')).toBe('true')
    expect(fold.title).toBe('Studio gives this Machine read-only access')
    fireEvent.click(fold)
    fireEvent.keyDown(nodeOf('idea-teams')!, { key: 'ArrowLeft' })
    expect(layoutCalls()).toEqual([])
  })

  it('a dragged node stays where it was let go while topics without its place arrive, and follows the file once the file has it', async () => {
    const { rerender } = render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    moveOn()
    await drag('who-pays', 80, 40)
    await waitFor(() => expect(layoutCalls()).toHaveLength(1))
    const [written] = layoutCalls() as { x: number; y: number }[]
    const at = { x: written!.x, y: written!.y }
    // The advisor changed another node before main's write came back: that topic has no place for who-pays.
    const other = topic().nodes.map((node) => (node.id === 'per-seat' ? { ...node, text: 'Per seat, monthly' } : node))
    rerender(<MindMap projectId="p1" topic={topic({ nodes: other })} />)
    expect(placeOf('who-pays')).toEqual(at)
    // The write is back.
    const placed = other.map((node) => (node.id === 'who-pays' ? { ...node, ...at, placed: 2 as const } : node))
    rerender(<MindMap projectId="p1" topic={topic({ nodes: placed })} />)
    expect(placeOf('who-pays')).toEqual(at)
    // Moved again elsewhere (another window): the screen follows the file, not the old drag.
    const elsewhere = placed.map((node) => (node.id === 'who-pays' ? { ...node, x: 900, y: 700 } : node))
    rerender(<MindMap projectId="p1" topic={topic({ nodes: elsewhere })} />)
    expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 })
  })
})

// The Graph by hand (ticket 26, review round 2): a place in the file is the Tree's (left to right from the
// topic) and the Graph lays out round the topic, so the Graph neither applies nor writes one. A drag there
// moves the node until the next layout.
describe('MindMap by hand in the Graph', () => {
  const inGraph = () => localStorage.setItem('worfy.mindMap.view:p1:demo-roadmap', 'graph')

  it('a drag writes nothing: the node stays where it was let go until the next layout, then the layout places it', async () => {
    inGraph()
    const { rerender } = render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    expect(screen.getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('true')
    const before = placeOf('who-pays')
    const zoom = zoomOf()
    moveOn()
    await drag('who-pays', 80, 40)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(layoutCalls()).toEqual([])
    const at = placeOf('who-pays')
    expect(at.x).toBeCloseTo(before.x + (80 - STARTED) / zoom, 0)
    expect(at.y).toBeCloseTo(before.y + 40 / zoom, 0)
    // A new topic that changes nothing the layout reads (the advice mark): the node stays where it was let go.
    rerender(<MindMap projectId="p1" topic={topic({ nodes: topic().nodes.map((node) => ({ ...node, advice: false })) })} />)
    expect(placeOf('who-pays')).toEqual(at)
    // A text of the same length: a new layout, the same places, and the drag is gone.
    rerender(<MindMap projectId="p1" topic={topic({ nodes: topic().nodes.map((node) => (node.id === 'per-seat' ? { ...node, text: 'Per user' } : node)) })} />)
    expect(placeOf('who-pays')).toEqual(before)
  })

  it('a place saved in the file (by a drag in the Tree) does not move the node in the Graph; the Tree still uses it', async () => {
    inGraph()
    const { unmount } = render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const laidOut = placeOf('who-pays')
    unmount()
    const placed = topic().nodes.map((node) => (node.id === 'who-pays' ? { ...node, x: 900, y: 700, placed: 2 as const } : node))
    render(<MindMap projectId="p1" topic={topic({ nodes: placed })} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    expect(placeOf('who-pays')).toEqual(laidOut)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    await waitFor(() => expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 }))
  })
})

describe('a chip’s node the screen hides', () => {
  const folded = (...ids: string[]) => topic().nodes.map((node) => (ids.includes(node.id) ? { ...node, collapsed: true } : node))
  const ask = (id: string) => act(() => pickNode({ projectId: 'p1', topic: 'demo-roadmap', id }))

  it('in folded branches: every folded node above it is unfolded through product.layout, and its card opens once it is drawn', () => {
    const { rerender } = render(<MindMap projectId="p1" topic={topic({ nodes: folded('idea-teams', 'who-pays') })} />)
    expect(nodeOf('per-seat')).toBeNull()
    ask('per-seat')
    expect(layoutCalls()).toEqual([
      { projectId: 'p1', name: 'demo-roadmap', id: 'who-pays', collapsed: false },
      { projectId: 'p1', name: 'demo-roadmap', id: 'idea-teams', collapsed: false },
    ])
    rerender(<MindMap projectId="p1" topic={topic()} />)
    expect(nodeOf('per-seat')!.className).toContain('w-mind__node--selected')
    expect(within(screen.getByRole('region', { name: 'Node' })).getByText('Per seat')).toBeTruthy()
    expect(screen.queryByTestId('mind-map-pick-note')).toBeNull()
  })

  it('under «Hide rejected»: the switch is turned off and its card opens', () => {
    const nodes = [
      ...topic().nodes,
      { id: 'per-user', kind: 'decision' as const, text: 'Per user', from: 'who-pays', status: 'rejected' as const, reason: 'Too fiddly' },
      { id: 'per-user-note', kind: 'question' as const, text: 'Per active user?', from: 'per-user' },
    ]
    render(<MindMap projectId="p1" topic={topic({ nodes })} />)
    const hide = screen.getByRole('button', { name: 'Hide rejected' })
    fireEvent.click(hide)
    expect(nodeOf('per-user-note')).toBeNull()
    ask('per-user-note')
    expect(hide.getAttribute('aria-pressed')).toBe('false')
    expect(within(screen.getByRole('region', { name: 'Node' })).getByText('Per active user?')).toBeTruthy()
    expect(layoutCalls()).toEqual([])
  })

  it('on a read-only screen: nothing is unfolded; the folded node above it is selected, and the note says why', () => {
    readOnly.hint = 'Studio gives this Machine read-only access'
    render(<MindMap projectId="p1" topic={topic({ nodes: folded('idea-teams') })} />)
    ask('per-seat')
    expect(layoutCalls()).toEqual([])
    expect(nodeOf('idea-teams')!.className).toContain('w-mind__node--selected')
    expect(within(screen.getByRole('region', { name: 'Node' })).getByText('Sell to small teams')).toBeTruthy()
    expect(screen.getByTestId('mind-map-pick-note').textContent).toContain('folded branch')
  })

  it('the pointer on its chip lights the folded node it is under; a node not in the topic says so', () => {
    render(<MindMap projectId="p1" topic={topic({ nodes: folded('idea-teams') })} />)
    act(() => lightNode({ projectId: 'p1', topic: 'demo-roadmap', id: 'per-seat' }))
    expect(nodeOf('idea-teams')!.dataset['lit']).toBe('true')
    act(() => lightNode(null))
    expect(nodeOf('idea-teams')!.dataset['lit']).toBeUndefined()
    ask('gone-node')
    expect(screen.getByTestId('mind-map-pick-note').textContent).toBe('This node is no longer on the Mind map.')
    expect(screen.queryByRole('region', { name: 'Node' })).toBeNull()
  })
})

// «Move nodes» and «Prettify» (ticket 31): nodes move only while «Move nodes» is on, and it is off each time
// the map opens; a drag on a node then pans the map. «Prettify» drops the places moved by hand in the view
// shown — the Tree's in the file, through `product.layout` with `clearPlaces`, after a short question (the
// map has no undo); the Graph's on the screen, without a question — and draws the automatic layout.
describe('MindMap «Move nodes» and «Prettify»', () => {
  const inGraph = () => localStorage.setItem('worfy.mindMap.view:p1:demo-roadmap', 'graph')
  const prettify = () => screen.getByRole('button', { name: 'Prettify' }) as HTMLButtonElement
  const placedAt = (x: number, y: number) => topic().nodes.map((node) => (node.id === 'who-pays' ? { ...node, x, y, placed: 2 as const } : node))

  it('«Move nodes» is off when the map opens: a drag on a node moves nothing and saves nothing, and a click still opens its card', async () => {
    const { unmount } = render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const toggle = screen.getByRole('button', { name: 'Move nodes' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    const before = placeOf('who-pays')
    await drag('who-pays', 80, 40)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(placeOf('who-pays')).toEqual(before)
    expect(layoutCalls()).toEqual([])
    fireEvent.click(nodeOf('who-pays')!)
    expect(screen.getByRole('region', { name: 'Node' })).toBeTruthy()
    // Turned on, then the map opened again: it is off again (not remembered).
    moveOn()
    unmount()
    render(<MindMap projectId="p1" topic={topic()} />)
    expect(screen.getByRole('button', { name: 'Move nodes' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('«Prettify» is inactive while no node has a place moved by hand, in the Tree and in the Graph', async () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    expect(prettify().disabled).toBe(true)
    expect(prettify().title).toBe('No node was moved by hand in this view')
    fireEvent.click(screen.getByRole('button', { name: 'Graph' }))
    expect(prettify().disabled).toBe(true)
    fireEvent.click(prettify())
    expect(layoutCalls()).toEqual([])
  })

  it('in the Tree, «Prettify» asks first, then drops the places of the file in one write and draws the automatic layout; «Cancel» writes nothing', async () => {
    const { unmount } = render(<MindMap projectId="p1" topic={topic()} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const laidOut = placeOf('who-pays')
    unmount()
    const { rerender } = render(<MindMap projectId="p1" topic={topic({ nodes: placedAt(900, 700) })} />)
    await waitFor(() => expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 }))
    expect(prettify().disabled).toBe(false)
    fireEvent.click(prettify())
    const question = screen.getByRole('group', { name: 'Prettify' })
    expect(question.textContent).toContain('Drop 1 moved place?')
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect(layoutCalls()).toEqual([])
    expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 })

    fireEvent.click(prettify())
    fireEvent.click(within(screen.getByRole('group', { name: 'Prettify' })).getByRole('button', { name: 'Prettify' }))
    expect(layoutCalls()).toEqual([{ projectId: 'p1', name: 'demo-roadmap', clearPlaces: true }])
    // The screen draws the layout at once, before main's change comes back.
    await waitFor(() => expect(placeOf('who-pays')).toEqual(laidOut))
    // The change is back: no place in the file, the button is inactive again.
    rerender(<MindMap projectId="p1" topic={topic()} />)
    expect(placeOf('who-pays')).toEqual(laidOut)
    expect(prettify().disabled).toBe(true)
  })

  it('a refused «Prettify» puts the places back and says why', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'mind-map.json has errors' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<MindMap projectId="p1" topic={topic({ nodes: placedAt(900, 700) })} />)
    await waitFor(() => expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 }))
    fireEvent.click(prettify())
    fireEvent.click(within(screen.getByRole('group', { name: 'Prettify' })).getByRole('button', { name: 'Prettify' }))
    await waitFor(() => expect(screen.getByTestId('mind-map-write-error').textContent).toContain('mind-map.json has errors'))
    expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 })
  })

  it('in the Graph, «Prettify» drops the moves of the Graph without a question and writes nothing: the Tree’s places in the file stay', async () => {
    inGraph()
    render(<MindMap projectId="p1" topic={topic({ nodes: placedAt(900, 700) })} />)
    await waitFor(() => expect(wrapperOf('who-pays').style.transform).toMatch(/translate/))
    const laidOut = placeOf('who-pays')
    // The Tree's place in the file is no manual place of the Graph.
    expect(prettify().disabled).toBe(true)
    moveOn()
    await drag('who-pays', 80, 40)
    await waitFor(() => expect(placeOf('who-pays')).not.toEqual(laidOut))
    expect(prettify().disabled).toBe(false)
    fireEvent.click(prettify())
    expect(screen.queryByRole('group', { name: 'Prettify' })).toBeNull()
    await waitFor(() => expect(placeOf('who-pays')).toEqual(laidOut))
    expect(layoutCalls()).toEqual([])
    expect(prettify().disabled).toBe(true)
    // The Tree still has the place of the file.
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    await waitFor(() => expect(placeOf('who-pays')).toEqual({ x: 900, y: 700 }))
  })

  it('on a read-only screen «Prettify» is inactive even with places in the file, and says why', () => {
    readOnly.hint = 'Studio gives this Machine read-only access'
    render(<MindMap projectId="p1" topic={topic({ nodes: placedAt(900, 700) })} />)
    expect(prettify().disabled).toBe(true)
    expect(prettify().title).toBe('Studio gives this Machine read-only access')
  })
})
