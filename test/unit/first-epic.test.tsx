// The first-Epic label of the Canvas (worfy-harness ticket 24, worfy-polish 56; src/renderer/canvas/overlays/FirstEpic.tsx):
// a text label next to the minimap, no panel, shown when the active Project's workflow was read
// without an error and has no Epic, hidden while it is read, on an error and once the first Epic is
// there; a click opens the Orchestrator and sends it nothing. It holds its box at the bottom right
// so a pinned Node keeps out of it (pinning.ts). jsdom has no layout: the ResizeObserver here is a
// stand-in that reports a given size.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Epic, WorkflowModel } from '../../src/shared/workflow/types'
import type { WorkflowEntry } from '../../src/renderer/workflow/useWorkflow'

const state = vi.hoisted(() => ({
  project: { id: 'shop-1', name: 'shop', path: '/repos/shop', branch: 'main' } as { id: string; name: string; path: string; branch: string } | undefined,
  entry: { model: undefined, error: undefined } as WorkflowEntry,
  invoke: vi.fn(),
  openSession: vi.fn(),
  asked: [] as (string | undefined)[],
  readOnly: null as string | null,
  minimap: true,
}))

vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => null,
  activeProject: () => state.project,
  useReadOnly: () => state.readOnly,
}))
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({
  useWorkflow: (root: string | undefined) => {
    state.asked.push(root)
    return state.entry
  },
}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: state.invoke,
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))
vi.mock('../../src/renderer/session/navigation', () => ({ openSession: state.openSession }))
vi.mock('../../src/renderer/canvas/overlays/minimap-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/canvas/overlays/minimap-view')>()),
  useMinimapShown: () => state.minimap,
}))

const { default: FirstEpic } = await import('../../src/renderer/canvas/overlays/FirstEpic')
const { canvasSizeOf } = await import('../../src/renderer/canvas/pinning')

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

const model = (epics: Partial<Epic>[], error: WorkflowModel['error'] = null): WorkflowModel =>
  ({ root: '/repos/shop', epics: epics as Epic[], tickets: [], error, branchErrors: [] }) as WorkflowModel

beforeEach(() => {
  state.project = { id: 'shop-1', name: 'shop', path: '/repos/shop', branch: 'main' }
  state.entry = { model: model([]), error: undefined }
  state.invoke.mockReset()
  state.openSession.mockReset()
  state.asked = []
  state.readOnly = null
  state.minimap = true
  observers.length = 0
  vi.stubGlobal('ResizeObserver', StandInObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const LABEL = 'Plan your first epic →'

describe('the first-Epic label', () => {
  it('shows when the workflow was read without an error and has no Epic: a label, not a panel', () => {
    render(<FirstEpic />)
    expect(screen.getByRole('button', { name: LABEL })).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
    expect(state.asked).toContain('/repos/shop')
  })

  it('sits above the minimap, or in its corner while the minimap is hidden, and keeps pinned Nodes out of its box', () => {
    // The minimap is 202 × 152 with its border, 15 px from the edges; the label 8 px above it.
    const { unmount } = render(<FirstEpic />)
    const label = screen.getByTestId('first-epic')
    expect(label.style.right).toBe('15px')
    expect(label.style.bottom).toBe(`${15 + 152 + 8}px`)
    act(() => resize(label, 140, 16))
    expect(canvasSizeOf({ width: 1000, height: 800 }).minimap).toEqual({ width: 15 + 140 + 15, height: 15 + 152 + 8 + 16 + 15 })
    unmount()
    expect(canvasSizeOf({ width: 1000, height: 800 }).minimap).toBeUndefined()

    state.minimap = false
    render(<FirstEpic />)
    const alone = screen.getByTestId('first-epic')
    expect(alone.style.bottom).toBe('15px')
    act(() => resize(alone, 140, 16))
    expect(canvasSizeOf({ width: 1000, height: 800 }).minimap).toEqual({ width: 15 + 140 + 15, height: 15 + 16 + 15 })
  })

  it('is hidden while the workflow is read, on a read error, on a model error and with the first Epic', () => {
    for (const entry of [
      { model: undefined, error: undefined },
      { model: undefined, error: 'epic-status failed' },
      { model: model([], { code: 'failed', message: 'the tickets could not be read' }), error: undefined },
      { model: model([{ epic: 'checkout', title: 'Checkout' }]), error: undefined },
    ] satisfies WorkflowEntry[]) {
      state.entry = entry
      const { container, unmount } = render(<FirstEpic />)
      expect(container.querySelector('[data-testid="first-epic"]')).toBeNull()
      unmount()
    }
  })

  it('is hidden without an active Project', () => {
    state.project = undefined
    const { container } = render(<FirstEpic />)
    expect(container.querySelector('[data-testid="first-epic"]')).toBeNull()
  })

  it('a click opens the Orchestrator of the Project and sends it nothing', async () => {
    state.invoke.mockResolvedValue({ ok: true, value: { nodeId: 'orch-1', projectId: 'shop-1' } })
    render(<FirstEpic />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    await waitFor(() => expect(state.openSession).toHaveBeenCalledWith({ nodeId: 'orch-1', projectId: 'shop-1' }))
    expect(state.invoke.mock.calls).toEqual([['orchestrator.open', { projectId: 'shop-1' }]])
  })

  it('is inactive while the Orchestrator opens', async () => {
    let answer: (value: unknown) => void = () => {}
    state.invoke.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    render(<FirstEpic />)
    const label = screen.getByRole('button', { name: LABEL }) as HTMLButtonElement
    fireEvent.click(label)
    await waitFor(() => expect(label.disabled).toBe(true))
    await act(async () => answer({ ok: true, value: { nodeId: 'orch-1', projectId: 'shop-1' } }))
    expect(label.disabled).toBe(false)
  })

  it('a failure to open the Orchestrator is said under the label', async () => {
    state.invoke.mockResolvedValue({ ok: false, error: 'no Orchestrator' })
    render(<FirstEpic />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    expect((await screen.findByRole('alert')).textContent).toBe('no Orchestrator')
    expect(state.openSession).not.toHaveBeenCalled()
  })

  it('on a read-only screen the label is inactive, its tooltip says why, and nothing is opened (worfy-link ticket 25)', async () => {
    state.readOnly = 'Mini gives this Machine read-only access'
    render(<FirstEpic />)
    const button = screen.getByRole('button', { name: LABEL }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId('first-epic').title).toBe('Mini gives this Machine read-only access')
    fireEvent.click(button)
    await Promise.resolve()
    expect(state.invoke).not.toHaveBeenCalled()
  })
})
