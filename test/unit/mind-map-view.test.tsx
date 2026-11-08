// The Mind map of a Product Session topic (src/renderer/product/MindMap.tsx, worfy-product-session
// ticket 08), drawn from a fixture topic as main reads it: the root, the Tickets of the map and the nodes
// with their kinds; a rejected Decision struck through and hidden with its branch on request; the Tree
// by default with larger text than the Graph, the choice kept per topic; the card of a node on a click;
// «Fit» bringing every node into the pane. No ELK worker in jsdom: the synchronous layout answers.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import { setElkEngine } from '../../src/renderer/canvas/elk/client'
import { MindMap } from '../../src/renderer/product/MindMap'
import { buildMindMapGraph, layoutElk, layoutSync } from '../../src/renderer/product/mind-map-layout'

const topic = (patch: Partial<ProductTopicState> = {}): ProductTopicState => ({
  name: 'demo-roadmap',
  folder: '/demo/docs/product/demo-roadmap',
  title: 'Demo roadmap',
  sections: [],
  tickets: [
    { number: 1, slug: 'market', file: '01-market.md', title: 'Map the market', status: 'open' },
    { number: 2, slug: 'screen', file: '02-screen.md', title: 'Pick the screen', status: 'done' },
  ],
  nodes: [
    { id: 'idea-teams', kind: 'idea', text: 'Sell to small teams', from: 'ticket:01', advice: true },
    { id: 'who-pays', kind: 'question', text: 'Who pays for it?', from: 'idea-teams' },
    {
      id: 'harness-first',
      kind: 'decision',
      text: 'Harness first, minimal UI',
      from: 'ticket:02',
      status: 'rejected',
      reason: 'The owner wants to see the screen',
      history: [{ status: 'accepted', reason: 'Cheaper to start', message: 'm-1' }],
    },
    { id: 'cli-only', kind: 'idea', text: 'A CLI only', from: 'harness-first' },
    {
      id: 'map-split',
      kind: 'decision',
      text: 'Mind map 60 / chat 40',
      from: 'ticket:02',
      status: 'accepted',
      reason: 'Seen in the prototype',
      replaces: 'harness-first',
      message: 'm-2',
    },
    { id: 'too-wide', kind: 'objection', text: 'Too wide for a laptop', from: 'map-split', source: 'docs/design/F-SPEC.md' },
  ],
  errors: [],
  ...patch,
})

const PANE = { width: 800, height: 600 }

const globals = globalThis as { ResizeObserver?: unknown; DOMMatrixReadOnly?: unknown }
let saved: { observer: unknown; matrix: unknown }
beforeEach(() => {
  localStorage.clear()
  saved = { observer: globals.ResizeObserver, matrix: globals.DOMMatrixReadOnly }
  // React Flow measures a node when its observer reports it (this one reports every element once), and
  // reads the zoom from the viewport's CSS transform, which jsdom cannot parse.
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
  // The pane is PANE big and a node as big as its style says; jsdom lays out nothing.
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
  vi.restoreAllMocks()
  globals.ResizeObserver = saved.observer
  globals.DOMMatrixReadOnly = saved.matrix
  if (saved.observer === undefined) delete globals.ResizeObserver
  if (saved.matrix === undefined) delete globals.DOMMatrixReadOnly
})

const nodeOf = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="mind-node"][data-id="${id}"]`)

describe('MindMap', () => {
  it('draws the topic as the root, the Tickets of the map and the nodes with their kinds; a rejected Decision is struck through', () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    expect(nodeOf('@topic')).toHaveProperty('dataset.kind', 'topic')
    expect(within(nodeOf('@topic')!).getByText('Demo roadmap')).toBeTruthy()
    expect(nodeOf('ticket:01')).toHaveProperty('dataset.kind', 'ticket')
    expect(within(nodeOf('ticket:02')!).getByText('Pick the screen')).toBeTruthy()
    expect(nodeOf('idea-teams')).toHaveProperty('dataset.kind', 'idea')
    expect(nodeOf('who-pays')).toHaveProperty('dataset.kind', 'question')
    expect(nodeOf('too-wide')).toHaveProperty('dataset.kind', 'objection')
    expect(nodeOf('map-split')).toHaveProperty('dataset.status', 'accepted')
    expect(within(nodeOf('map-split')!).getByText('✓')).toBeTruthy()
    const rejected = nodeOf('harness-first')!
    expect(rejected.dataset['status']).toBe('rejected')
    expect(within(rejected).getByText('✕')).toBeTruthy()
    // <s>: the text is no longer accurate, struck through by the browser and named so to a screen reader.
    expect(within(rejected).getByText('Harness first, minimal UI').closest('s')).not.toBeNull()
    expect(within(nodeOf('map-split')!).getByText('Mind map 60 / chat 40').closest('s')).toBeNull()
  })

  it('«Hide rejected» takes a rejected Decision and its branch off the screen, and brings them back', () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    const toggle = screen.getByRole('button', { name: 'Hide rejected' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(nodeOf('harness-first')).toBeNull()
    expect(nodeOf('cli-only')).toBeNull()
    expect(nodeOf('map-split')).not.toBeNull()
    expect(nodeOf('too-wide')).not.toBeNull()
    fireEvent.click(toggle)
    expect(nodeOf('harness-first')).not.toBeNull()
    expect(nodeOf('cli-only')).not.toBeNull()
  })

  it('opens in the Tree with larger text than the Graph, and keeps the view chosen for the topic', () => {
    const { unmount } = render(<MindMap projectId="p1" topic={topic()} />)
    const view = screen.getByRole('group', { name: 'View' })
    expect(within(view).getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true')
    const treeFont = Number.parseFloat(nodeOf('idea-teams')!.style.fontSize)
    fireEvent.click(within(view).getByRole('button', { name: 'Graph' }))
    expect(within(view).getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('true')
    const graphFont = Number.parseFloat(nodeOf('idea-teams')!.style.fontSize)
    expect(treeFont).toBeGreaterThan(graphFont)
    unmount()

    render(<MindMap projectId="p1" topic={topic()} />)
    expect(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('true')
    // Another topic opens in the Tree.
    render(<MindMap projectId="p1" topic={topic({ name: 'other-topic' })} />)
    const groups = screen.getAllByRole('group', { name: 'View' })
    expect(within(groups[1]!).getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the card of a node on a click: a Decision with its reason and history, an Objection with its source', () => {
    const show = vi.fn<(message: string) => void>()
    render(<MindMap projectId="p1" topic={topic()} onShowMessage={show} />)
    fireEvent.click(nodeOf('map-split')!)
    let card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByText('Decision · accepted')).toBeTruthy()
    expect(within(card).getByText('Seen in the prototype')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Show the message in the chat' }))
    expect(show).toHaveBeenCalledWith('m-2')
    // «Grew from» leads to the parent's card.
    fireEvent.click(within(card).getByRole('button', { name: 'Pick the screen' }))
    card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByText('Ticket 02')).toBeTruthy()

    fireEvent.click(nodeOf('harness-first')!)
    card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByText('Decision · rejected')).toBeTruthy()
    expect(within(card).getByText('accepted — Cheaper to start')).toBeTruthy()

    fireEvent.click(nodeOf('too-wide')!)
    card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByText('Objection')).toBeTruthy()
    expect(within(card).getByText('docs/design/F-SPEC.md')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Close the card' }))
    expect(screen.queryByRole('region', { name: 'Node' })).toBeNull()
  })

  it('«Fit» brings every node into the pane; «+» and «−» change the zoom shown in percent', async () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    const zoom = screen.getByTestId('mind-map-zoom')
    const before = zoom.textContent
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      await Promise.resolve()
    })
    const zoomedIn = zoom.textContent
    expect(Number.parseInt(zoomedIn!)).toBeGreaterThan(Number.parseInt(before!))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
      await Promise.resolve()
    })
    expect(Number.parseInt(zoom.textContent!)).toBeLessThan(Number.parseInt(zoomedIn!))
    // Far enough in that the map no longer fits, then «Fit».
    for (let step = 0; step < 4; step += 1) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
        await Promise.resolve()
      })
    }
    const close = zoom.textContent
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }))
    // React Flow fits on its next frame.
    await waitFor(() => expect(Number.parseInt(zoom.textContent!)).toBeLessThan(Number.parseInt(close!)))
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!
    const match = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(viewport.style.transform)
    expect(match).not.toBeNull()
    const [tx, ty, scale] = [Number(match![1]), Number(match![2]), Number(match![3])]
    expect(zoom.textContent).toBe(`${Math.round(scale * 100)}%`)
    const drawn = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
    // The topic, two Tickets and six nodes.
    expect(drawn.length).toBe(9)
    for (const element of drawn) {
      const place = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(element.style.transform)!
      const [x, y] = [Number(place[1]), Number(place[2])]
      const [width, height] = [Number.parseFloat(element.style.width), Number.parseFloat(element.style.height)]
      expect(x * scale + tx).toBeGreaterThanOrEqual(0)
      expect(y * scale + ty).toBeGreaterThanOrEqual(0)
      expect((x + width) * scale + tx).toBeLessThanOrEqual(PANE.width)
      expect((y + height) * scale + ty).toBeLessThanOrEqual(PANE.height)
    }
  })

  it('draws the right nodes of a file with errors and names the errors with their node ids above the map', () => {
    render(
      <MindMap
        projectId="p1"
        topic={topic({ errors: [{ file: 'mind-map.json', id: 'who-pays', message: 'node "who-pays": a cycle through from' }] })}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('mind-map.json')
    expect(alert.textContent).toContain('node "who-pays": a cycle through from')
    expect(nodeOf('who-pays')).toBeNull()
    expect(nodeOf('idea-teams')).not.toBeNull()
  })

  it('places a node the file places at its x and y', () => {
    const nodes = topic().nodes.map((node) => (node.id === 'too-wide' ? { ...node, x: 1234, y: 567 } : node))
    render(<MindMap projectId="p1" topic={topic({ nodes })} />)
    const element = nodeOf('too-wide')!.closest<HTMLElement>('.react-flow__node')!
    expect(element.style.transform).toMatch(/translate\(1234px, ?567px\)/)
  })

  it('draws a topic of 150 nodes on its first render (WORFY_MIND_MAP_TIMING=1 prints the time)', () => {
    const kinds = ['idea', 'question', 'objection'] as const
    const nodes = Array.from({ length: 150 }, (_, index) => {
      const kind = kinds[index % kinds.length]!
      const from = index < 20 ? 'ticket:01' : `n${(index * 7) % index}`
      return { id: `n${index}`, kind, text: `Node ${index}`, from, ...(kind === 'objection' ? { source: 'docs/roadmap.md' } : {}) }
    })
    const started = performance.now()
    render(<MindMap projectId="p1" topic={topic({ nodes })} />)
    const ms = performance.now() - started
    expect(document.querySelectorAll('[data-testid="mind-node"]')).toHaveLength(150 + 3)
    if (process.env['WORFY_MIND_MAP_TIMING'] === '1') console.info(`[mind-map] 150 nodes, first render in jsdom: ${ms.toFixed(1)} ms`)
  })

  it('moves the nodes to ELK’s layout once the window’s ELK answers; one request is out at a time, and a node added meanwhile is drawn by its parent', async () => {
    const elk = new ELK()
    const graph = buildMindMapGraph(topic(), { hideRejected: false })
    const [byElk, sync] = [(await layoutElk(graph, 'tree', elk)).get('too-wide')!, layoutSync(graph, 'tree').get('too-wide')!]
    expect([byElk.x, byElk.y]).not.toEqual([sync.x, sync.y])
    const at = (id: string) => nodeOf(id)!.closest<HTMLElement>('.react-flow__node')!.style.transform
    // ELK that answers when the test lets it, request by request; each request is listed once its
    // layout is ready, so an answer takes effect at once.
    const requests: { ids: string[]; answer: () => void }[] = []
    setElkEngine({
      layout: (input) =>
        elk.layout(input).then(
          (laidOut) =>
            new Promise((resolve) => {
              requests.push({ ids: (input.children ?? []).map((child) => child.id), answer: () => resolve(laidOut) })
            }),
        ),
    })
    const requested = async (count: number) => {
      await waitFor(() => expect(requests).toHaveLength(count))
    }
    const answer = async (index: number) => {
      await act(async () => {
        requests[index]!.answer()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    const withNodes = (...ids: string[]) => topic({ nodes: [...topic().nodes, ...ids.map((id) => ({ id, kind: 'idea' as const, text: `Added ${id}`, from: 'too-wide' }))] })
    try {
      const { rerender } = render(<MindMap projectId="p1" topic={topic()} />)
      expect(at('too-wide')).toBe(`translate(${sync.x}px,${sync.y}px)`)
      await requested(1)
      await answer(0)
      await waitFor(() => expect(at('too-wide')).toBe(`translate(${byElk.x}px,${byElk.y}px)`))
      expect(requests).toHaveLength(1)

      // The advisor adds two nodes while ELK works on the first: both are drawn at once, under their
      // parent's ELK place, and the others keep theirs.
      rerender(<MindMap projectId="p1" topic={withNodes('late-1')} />)
      rerender(<MindMap projectId="p1" topic={withNodes('late-1', 'late-2')} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(at('too-wide')).toBe(`translate(${byElk.x}px,${byElk.y}px)`)
      for (const id of ['late-1', 'late-2']) {
        expect(nodeOf(id)).not.toBeNull()
        const place = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(at(id))!
        expect(Number(place[2])).toBeGreaterThan(byElk.y)
      }
      // One request is out (the one for `late-1`); the inputs after it wait for its answer.
      await requested(2)
      expect(requests[1]!.ids).toContain('late-1')
      expect(requests[1]!.ids).not.toContain('late-2')
      await answer(1)
      // Then only the newest inputs are sent.
      await requested(3)
      expect(requests[2]!.ids).toContain('late-2')
      expect(nodeOf('late-2')).not.toBeNull()
      await answer(2)
      await waitFor(() => expect(at('late-2')).not.toBe(''))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(requests).toHaveLength(3)
    } finally {
      setElkEngine(null)
    }
  })

  it('opens a node’s card from the keyboard with Enter or Space and closes it with Escape, back on the node', () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    // The name says the kind and the status.
    const rejected = screen.getByRole('button', { name: 'Decision · rejected: Harness first, minimal UI' })
    expect(rejected.tabIndex).toBe(0)
    // React Flow's wrapper is not a second stop for Tab.
    expect(rejected.closest('.react-flow__node')!.getAttribute('tabindex')).toBeNull()
    rejected.focus()
    fireEvent.keyDown(rejected, { key: 'Enter' })
    expect(within(screen.getByRole('region', { name: 'Node' })).getByText('Decision · rejected')).toBeTruthy()
    fireEvent.keyDown(rejected, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Node' })).toBeNull()
    expect(document.activeElement).toBe(rejected)

    const objection = screen.getByRole('button', { name: 'Objection: Too wide for a laptop' })
    fireEvent.keyDown(objection, { key: ' ' })
    const card = screen.getByRole('region', { name: 'Node' })
    expect(within(card).getByText('docs/design/F-SPEC.md')).toBeTruthy()
    // Escape from inside the card too.
    fireEvent.keyDown(within(card).getByRole('button', { name: 'Close the card' }), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Node' })).toBeNull()
    expect(document.activeElement).toBe(objection)
  })

  it('keeps the zoom between 10 % and 250 % however often «+» or «−» is pressed', async () => {
    render(<MindMap projectId="p1" topic={topic()} />)
    const zoom = screen.getByTestId('mind-map-zoom')
    for (const [button, bound] of [['Zoom in', '250%'], ['Zoom out', '10%']] as const) {
      for (let step = 0; step < 40; step += 1) {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: button }))
          await Promise.resolve()
        })
      }
      expect(zoom.textContent).toBe(bound)
    }
  })
})
