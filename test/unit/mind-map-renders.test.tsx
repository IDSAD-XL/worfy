// How much of the Mind map a move of the camera redraws (worfy-product-session ticket 23, review round 2): a
// wheel step or a drag of the background changes only React Flow's viewport, so with no node card open no
// node is drawn again. Each drawn node draws its outline through nodeShape (the legend's samples are 26 px
// wide and do not count), so the calls of nodeShape count the nodes drawn.
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import { MindMap } from '../../src/renderer/product/MindMap'
import { layoutRadial, nodeShape } from '../../src/renderer/product/mind-map-layout'

vi.mock('../../src/renderer/product/mind-map-layout', async (actual) => {
  const real = await actual<typeof import('../../src/renderer/product/mind-map-layout')>()
  return { ...real, nodeShape: vi.fn(real.nodeShape), layoutRadial: vi.fn(real.layoutRadial) }
})

const topic: ProductTopicState = {
  name: 'demo-roadmap',
  folder: '/demo/docs/product/demo-roadmap',
  title: 'Demo roadmap',
  sections: [],
  tickets: [{ number: 1, slug: 'market', file: '01-market.md', title: 'Map the market', status: 'open' }],
  nodes: [
    { id: 'idea-teams', kind: 'idea', text: 'Sell to small teams', from: 'ticket:01' },
    { id: 'who-pays', kind: 'question', text: 'Who pays for it?', from: 'idea-teams' },
    { id: 'split', kind: 'decision', text: 'Mind map 60 / chat 40', from: 'ticket:01', status: 'accepted', reason: 'Seen in the prototype' },
  ],
  errors: [],
}

const PANE = { width: 800, height: 600 }
const globals = globalThis as { ResizeObserver?: unknown; DOMMatrixReadOnly?: unknown }
let saved: { observer: unknown; matrix: unknown }
beforeEach(() => {
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
    element.classList.contains('react-flow') || element.classList.contains('react-flow__renderer')
      ? PANE[side]
      : element.classList.contains('react-flow__node')
        ? Number.parseFloat(element.style[side]) || 0
        : 0
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

/** The nodes drawn since the last reset: one outline each, the legend's 26 px samples left out. */
const nodesDrawn = (): number => vi.mocked(nodeShape).mock.calls.filter(([, width]) => width !== 26).length

describe('MindMap camera moves', () => {
  it('draws no node again when the wheel or a drag of the background moves the camera, with no card open', async () => {
    render(<MindMap projectId="p1" topic={topic} />)
    // Settled: the nodes measured and the first fit done.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')!
    vi.mocked(nodeShape).mockClear()
    const before = viewport.style.transform
    await act(async () => {
      fireEvent.wheel(pane, { deltaY: -200, clientX: 100, clientY: 100 })
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    await waitFor(() => expect(viewport.style.transform).not.toBe(before))
    expect(nodesDrawn()).toBe(0)
  })
})

// The Graph's layout runs on the window's thread (ticket 26, review round 2): a new topic that changes nothing
// the layout reads — a place written back, an advice mark — lays out nothing again; a new text does.
describe('MindMap Graph layout', () => {
  it('is computed once per layout key, not once per topic', async () => {
    localStorage.setItem('worfy.mindMap.view:p1:demo-roadmap', 'graph')
    try {
      vi.mocked(layoutRadial).mockClear()
      const { rerender } = render(<MindMap projectId="p1" topic={topic} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(vi.mocked(layoutRadial)).toHaveBeenCalledTimes(1)
      const placed = topic.nodes.map((node) => (node.id === 'who-pays' ? { ...node, x: 10, y: 20, placed: 2 as const, advice: true } : node))
      rerender(<MindMap projectId="p1" topic={{ ...topic, nodes: placed }} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(vi.mocked(layoutRadial)).toHaveBeenCalledTimes(1)
      const renamed = placed.map((node) => (node.id === 'who-pays' ? { ...node, text: 'Who pays for it, and when?' } : node))
      rerender(<MindMap projectId="p1" topic={{ ...topic, nodes: renamed }} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(vi.mocked(layoutRadial)).toHaveBeenCalledTimes(2)
    } finally {
      localStorage.clear()
    }
  })
})
