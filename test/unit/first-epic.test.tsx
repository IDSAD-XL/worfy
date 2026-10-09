// The "No epics yet" panel of the Canvas (worfy-harness ticket 24, src/renderer/canvas/overlays/FirstEpic.tsx):
// shown when the active Project's workflow was read without an error and has no Epic, hidden while it
// is read, on an error and once the first Epic is there; "Plan first epic" opens the Orchestrator
// and sends it nothing.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Epic, WorkflowModel } from '../../src/shared/workflow/types'
import type { WorkflowEntry } from '../../src/renderer/workflow/useWorkflow'

const state = vi.hoisted(() => ({
  project: { id: 'shop-1', name: 'shop', path: '/repos/shop', branch: 'main' } as { id: string; name: string; path: string; branch: string } | undefined,
  entry: { model: undefined, error: undefined } as WorkflowEntry,
  invoke: vi.fn(),
  openSession: vi.fn(),
  asked: [] as (string | undefined)[],
}))

vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => null,
  activeProject: () => state.project,
}))
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({
  useWorkflow: (root: string | undefined) => {
    state.asked.push(root)
    return state.entry
  },
}))
vi.mock('../../src/renderer/ipc', () => ({ invoke: state.invoke }))
vi.mock('../../src/renderer/session/navigation', () => ({ openSession: state.openSession }))

const { default: FirstEpic } = await import('../../src/renderer/canvas/overlays/FirstEpic')

const model = (epics: Partial<Epic>[], error: WorkflowModel['error'] = null): WorkflowModel =>
  ({ root: '/repos/shop', epics: epics as Epic[], tickets: [], error, branchErrors: [] }) as WorkflowModel

beforeEach(() => {
  state.project = { id: 'shop-1', name: 'shop', path: '/repos/shop', branch: 'main' }
  state.entry = { model: model([]), error: undefined }
  state.invoke.mockReset()
  state.openSession.mockReset()
  state.asked = []
})

afterEach(cleanup)

describe('the "No epics yet" panel', () => {
  it('shows when the workflow was read without an error and has no Epic', () => {
    render(<FirstEpic />)
    expect(screen.getByRole('heading', { name: 'No epics yet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Plan first epic' })).toBeTruthy()
    expect(state.asked).toContain('/repos/shop')
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

  it('"Plan first epic" opens the Orchestrator of the Project and sends it nothing', async () => {
    state.invoke.mockResolvedValue({ ok: true, value: { nodeId: 'orch-1', projectId: 'shop-1' } })
    render(<FirstEpic />)
    fireEvent.click(screen.getByRole('button', { name: 'Plan first epic' }))
    await waitFor(() => expect(state.openSession).toHaveBeenCalledWith({ nodeId: 'orch-1', projectId: 'shop-1' }))
    expect(state.invoke.mock.calls).toEqual([['orchestrator.open', { projectId: 'shop-1' }]])
  })

  it('a failure to open the Orchestrator is said under the button', async () => {
    state.invoke.mockResolvedValue({ ok: false, error: 'no Orchestrator' })
    render(<FirstEpic />)
    fireEvent.click(screen.getByRole('button', { name: 'Plan first epic' }))
    expect((await screen.findByRole('alert')).textContent).toBe('no Orchestrator')
    expect(state.openSession).not.toHaveBeenCalled()
  })
})
