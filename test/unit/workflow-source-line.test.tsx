// The "As of" line of the sidebar's Epics section (worfy-polish ticket 118, ADR-0107): the list is read from the
// Project's main branch, and the line shows only when that list may be old. The real useWorkflow runs; the IPC client
// under it is a fake whose `workflow.open` the test answers and whose `workflow.changed` the test sends.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../src/shared/ipc/channels'
import type { Epic, Ticket, WorkflowDelta, WorkflowModel, WorkflowSourceView } from '../../src/shared/workflow/types'

const ROOT = '/repos/shop'
const SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'

const state = vi.hoisted(() => ({
  opens: new Map<string, (result: IpcResult<WorkflowModel>) => void>(),
  changed: null as ((delta: WorkflowDelta) => void) | null,
  invoke: vi.fn(),
}))

vi.mock('../../src/renderer/ipc', () => ({
  invoke: state.invoke,
  subscribe: (_channel: string, listener: (delta: WorkflowDelta) => void) => {
    state.changed = listener
    return () => undefined
  },
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => null,
  activeProject: () => ({ id: 'shop-1', name: 'shop', path: ROOT, branch: 'main' }),
}))
vi.mock('../../src/renderer/canvas/sources/epics', () => ({ focusEpic: vi.fn() }))

const { default: EpicsSection } = await import('../../src/renderer/shell/sidebar/EpicsSection')
const { applyWorkflowDelta } = await import('../../src/renderer/workflow/useWorkflow')

const model = (source?: WorkflowSourceView): WorkflowModel =>
  ({
    root: ROOT,
    epics: [{ epic: 'shop-mvp', hasSpec: true, hasMap: false, title: null } as Epic],
    tickets: [{ epic: 'shop-mvp', num: 1, state: 'open' } as unknown as Ticket],
    error: null,
    branchErrors: [],
    ...(source === undefined ? {} : { source }),
  }) as WorkflowModel

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-11-16T12:00:00Z') })
  state.opens = new Map()
  state.invoke.mockReset()
  state.invoke.mockImplementation((channel: string, input: unknown) => {
    if (channel === 'workflow.open') return new Promise((resolve) => state.opens.set((input as { root: string }).root, resolve))
    return Promise.resolve({ ok: true, value: undefined })
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const answer = (value: WorkflowModel) => act(async () => state.opens.get(ROOT)!({ ok: true, value }))
const line = () => screen.queryByTestId('sidebar-epics-source')

describe('the "As of" line', () => {
  it('is not there while the list is current', async () => {
    render(<EpicsSection />)
    await answer(model({ ref: 'refs/remotes/origin/main', sha: SHA, updatedAt: '2026-11-16T11:59:00Z', notice: null }))
    expect(screen.getAllByTestId('sidebar-epic')).toHaveLength(1)
    expect(line()).toBeNull()
  })

  it('shows the short commit, when it was last updated and why, when fetch has failed for a while', async () => {
    render(<EpicsSection />)
    const notice = 'git fetch origin has failed for 12 min: Could not resolve host: github.com'
    await answer(model({ ref: 'refs/remotes/origin/main', sha: SHA, updatedAt: '2026-11-16T11:40:00Z', notice }))
    expect(line()?.textContent).toBe(`As of 1a2b3c4updated 20m ago${notice}`)
    // The list itself stays.
    expect(screen.getAllByTestId('sidebar-epic')).toHaveLength(1)
  })

  it('follows a delta: the line comes with a source that has a notice and goes with one that has none', async () => {
    render(<EpicsSection />)
    await answer(model({ ref: 'refs/remotes/origin/main', sha: SHA, updatedAt: null, notice: null }))
    expect(line()).toBeNull()
    const delta = (source: WorkflowSourceView): WorkflowDelta => ({ root: ROOT, epics: [], tickets: [], removedEpics: [], removedTickets: [], error: null, branchErrors: [], source })
    await act(async () => state.changed!(delta({ ref: null, sha: SHA, updatedAt: null, notice: 'neither origin/HEAD nor origin/main resolves' })))
    expect(line()?.textContent).toContain('not updated yet')
    await act(async () => state.changed!(delta({ ref: 'refs/remotes/origin/main', sha: SHA, updatedAt: '2026-11-16T12:00:00Z', notice: null })))
    expect(line()).toBeNull()
  })
})

describe('applyWorkflowDelta and the source', () => {
  it('keeps the model\'s source for a delta of an older worfy, which has none', () => {
    const source: WorkflowSourceView = { ref: 'refs/heads/main', sha: SHA, updatedAt: null, notice: null }
    const next = applyWorkflowDelta(model(source), { root: ROOT, epics: [], tickets: [], removedEpics: [], removedTickets: [], error: null, branchErrors: [] })
    expect(next.source).toEqual(source)
  })
})
