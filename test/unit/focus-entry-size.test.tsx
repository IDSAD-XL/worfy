// The Focus button's real size and the selection toolbar that keeps off it (src/renderer/canvas/pinning.ts,
// overlays/FocusEntry.tsx, overlays/SelectionToolbar.tsx). The button's label differs by platform
// ("Focus ⌘↩" on macOS, "Focus Ctrl+Enter" elsewhere) and by font, so a fixed width was too narrow on
// Windows (104.5 px against 96). FocusEntry measures the button; SelectionToolbar keeps off what was
// measured. jsdom has no layout: the ResizeObserver here is a stand-in that reports a given size.
import { act, cleanup, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOCUS_ENTRY_SIZE, useFocusEntrySize } from '../../src/renderer/canvas/pinning'
import FocusEntry from '../../src/renderer/canvas/overlays/FocusEntry'
import SelectionToolbar from '../../src/renderer/canvas/overlays/SelectionToolbar'
import type { LayoutNode } from '../../src/shared/layout/types'

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ projects: [{ id: 'p', name: 'p', path: '/p', branch: 'main' }], activeId: 'p', revision: 1 }),
}))

type Callback = (entries: unknown[], observer: unknown) => void

/** Every stand-in observer made, with the elements it observes. */
const observers: { callback: Callback; targets: Element[] }[] = []

class StandInObserver {
  private readonly record: { callback: Callback; targets: Element[] }
  constructor(callback: Callback) {
    this.record = { callback, targets: [] }
    observers.push(this.record)
  }
  observe(target: Element): void {
    this.record.targets.push(target)
  }
  unobserve(): void {}
  disconnect(): void {
    this.record.targets = []
  }
}

/** Reports `width` × `height` as the border box of `element` to every observer that watches it. */
function resize(element: Element, width: number, height: number): void {
  for (const { callback, targets } of observers) {
    if (targets.includes(element)) callback([{ target: element, borderBoxSize: [{ inlineSize: width, blockSize: height }] }], null)
  }
}

let hadObserver = false
beforeEach(() => {
  const globals = globalThis as { ResizeObserver?: unknown }
  hadObserver = 'ResizeObserver' in globals
  globals.ResizeObserver = StandInObserver
  observers.length = 0
  useFocusEntrySize.setState(FOCUS_ENTRY_SIZE, true)
})
afterEach(() => {
  cleanup()
  useFocusEntrySize.setState(FOCUS_ENTRY_SIZE, true)
  if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

const layoutNode = (id: string): LayoutNode => ({ id, kind: 'note', x: 0, y: 0, w: 90, h: 10, hidden: false, locked: false, pinned: false, tags: [], data: {} })
const flowNode = (id: string, x: number, y: number, width: number, height: number, selected: boolean): Node => ({
  id,
  position: { x, y },
  width,
  height,
  selected,
  data: { node: layoutNode(id) },
})

/**
 * A narrow, short selection (90 × 10 at the origin, zoom 1) with a Node just above it, so the toolbar
 * (200 × 34 until measured) cannot stand on top. Beside it on the right (x 102–302, y 0–34) it clears
 * a Focus button up to 114 px wide (centred at x 45, 12 px below: y 22–50); a wider button reaches
 * under it, and the toolbar goes below the button instead.
 */
const NODES = [flowNode('s', 0, 0, 90, 10, true), flowNode('above', 0, -40, 90, 20, false)]

function renderCanvas(): void {
  render(
    <ReactFlowProvider>
      <ReactFlow nodes={NODES} edges={[]}>
        <FocusEntry />
        <SelectionToolbar />
      </ReactFlow>
    </ReactFlowProvider>,
  )
}

/** The transform of the element that places the selection toolbar (planeToolbarStyle() in pinning.ts). */
const toolbarTransform = (): string => (screen.getByTestId('selection-toolbar').parentElement as HTMLElement).style.transform

describe('the Focus button size the selection toolbar keeps off', () => {
  it('is what FocusEntry measures, rounded up to whole pixels', () => {
    renderCanvas()
    const button = screen.getByRole('button', { name: /^Focus/ })
    act(() => resize(button, 104.515625, 28))
    expect(useFocusEntrySize.getState()).toEqual({ width: 105, height: 28 })
    // A size of zero (the button not laid out) leaves the last one.
    act(() => resize(button, 0, 0))
    expect(useFocusEntrySize.getState()).toEqual({ width: 105, height: 28 })
  })

  it('a button that fits beside the selection leaves the toolbar on the right', () => {
    renderCanvas()
    act(() => resize(screen.getByRole('button', { name: /^Focus/ }), 96, 28))
    expect(toolbarTransform()).toBe('translate(102px, 0px) scale(1) translate(0%, 0%)')
  })

  it('a wider and taller button sends the toolbar below it, past its measured height', () => {
    renderCanvas()
    act(() => resize(screen.getByRole('button', { name: /^Focus/ }), 140, 40))
    // Below the button: 12 px under the selection, the button's 40 px, then 8 px: y = 10 + 60.
    expect(toolbarTransform()).toBe('translate(45px, 70px) scale(1) translate(-50%, 0%)')
    expect(screen.getByTestId('selection-toolbar').dataset.focusEntryWidth).toBe('140')
  })
})
