// The sidebar's Epics section while the first `workflow.open` of a Project is on its way
// (worfy-harness ticket 44, src/renderer/shell/sidebar/EpicsSection.tsx). The first read waits for
// the login shell's environment, up to 10 s; meanwhile the section shows "Reading epics…" — after
// READING_ROW_DELAY_MS, so a read that answers in ~25 ms does not flash it — and the row goes away
// with whatever main answers: the list, an empty list or an error. The real useWorkflow runs here;
// only the IPC client under it is a fake whose `workflow.open` the test answers by hand.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../src/shared/ipc/channels'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/repos/shop'
const OTHER = '/repos/blog'

interface ProjectStub {
  id: string
  name: string
  path: string
  branch: string
}
const SHOP: ProjectStub = { id: 'shop-1', name: 'shop', path: ROOT, branch: 'main' }
const BLOG: ProjectStub = { id: 'blog-1', name: 'blog', path: OTHER, branch: 'main' }

const state = vi.hoisted(() => ({
  /** The answer function of each root's pending `workflow.open`. */
  opens: new Map<string, (result: IpcResult<WorkflowModel>) => void>(),
  /** The active Project; a test switches it and renders again. */
  project: undefined as { id: string; name: string; path: string; branch: string } | undefined,
  invoke: vi.fn(),
}))

vi.mock('../../src/renderer/ipc', () => ({ invoke: state.invoke, subscribe: () => () => undefined }))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => null,
  activeProject: () => state.project,
}))
// focusEpic pulls the whole Canvas in; a click on a row is not this file's business.
vi.mock('../../src/renderer/canvas/sources/epics', () => ({ focusEpic: vi.fn() }))

const { default: EpicsSection, READING_ROW_DELAY_MS } = await import('../../src/renderer/shell/sidebar/EpicsSection')
const { useWorkflow } = await import('../../src/renderer/workflow/useWorkflow')

/** Keeps `root` open, as the Canvas does for the active Project, so its model can be ready before a switch. */
function Holder({ root }: { root: string }) {
  useWorkflow(root)
  return null
}

const READING = 'Reading epics…'

const model = (epics: string[], error: WorkflowModel['error'] = null, root = ROOT): WorkflowModel =>
  ({
    root,
    epics: epics.map((epic): Epic => ({ epic, hasSpec: true, hasMap: false, title: null })),
    tickets: epics.map((epic) => ({ epic, num: 1, state: 'open' }) as unknown as Ticket),
    error,
    branchErrors: [],
  }) as WorkflowModel

beforeEach(() => {
  vi.useFakeTimers()
  state.opens = new Map()
  state.project = SHOP
  state.invoke.mockReset()
  state.invoke.mockImplementation((channel: string, input: unknown) => {
    if (channel === 'workflow.open') return new Promise((resolve) => state.opens.set((input as { root: string }).root, resolve))
    return Promise.resolve({ ok: true, value: undefined })
  })
})

afterEach(() => {
  // Unmounting releases the root, so the next test opens it afresh.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const readingRow = () => screen.queryByText(READING)
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const answer = (result: IpcResult<WorkflowModel>, root = ROOT) => act(async () => state.opens.get(root)!(result))

describe('the Epics section during the first read', () => {
  it('shows "Reading epics…" once the read outlasts the delay, then the list in its place', async () => {
    render(<EpicsSection />)
    expect(state.invoke).toHaveBeenCalledWith('workflow.open', { root: ROOT })
    await wait(READING_ROW_DELAY_MS - 1)
    expect(readingRow()).toBeNull()
    await wait(1)
    expect(readingRow()).not.toBeNull()
    // Still there while main is reading, however long it takes (the login shell's limit is 10 s).
    await wait(10_000)
    expect(readingRow()).not.toBeNull()

    await answer({ ok: true, value: model(['shop-mvp', 'shop-daily']) })
    expect(readingRow()).toBeNull()
    expect(screen.getAllByTestId('sidebar-epic').map((row) => row.getAttribute('data-epic'))).toEqual(['shop-mvp', 'shop-daily'])
  })

  it('replaces the row with the error when workflow.open fails', async () => {
    render(<EpicsSection />)
    await wait(READING_ROW_DELAY_MS)
    expect(readingRow()).not.toBeNull()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await answer({ ok: false, error: 'epic-status exited with 1' })
    expect(readingRow()).toBeNull()
    expect(screen.getByText('The epics could not be read: epic-status exited with 1')).toBeTruthy()
    await wait(READING_ROW_DELAY_MS)
    expect(readingRow()).toBeNull()
  })

  it('replaces the row with "No epics in .scratch/" when the Project has no Epic', async () => {
    render(<EpicsSection />)
    await wait(READING_ROW_DELAY_MS)
    expect(readingRow()).not.toBeNull()

    await answer({ ok: true, value: model([]) })
    expect(readingRow()).toBeNull()
    expect(screen.getByText('No epics in .scratch/')).toBeTruthy()
  })

  it("replaces the row with the model's own error", async () => {
    render(<EpicsSection />)
    await wait(READING_ROW_DELAY_MS)
    await answer({ ok: true, value: model([], { code: 'not-found', message: 'epic-status is not installed' }) })
    expect(readingRow()).toBeNull()
    expect(screen.getByText('epic-status is not installed')).toBeTruthy()
  })

  it('never shows the row when main answers before the delay', async () => {
    render(<EpicsSection />)
    await wait(READING_ROW_DELAY_MS - 50)
    await answer({ ok: true, value: model(['shop-mvp']) })
    await wait(READING_ROW_DELAY_MS * 10)
    expect(readingRow()).toBeNull()
    expect(screen.getAllByTestId('sidebar-epic')).toHaveLength(1)
  })

  it('never shows the row when workflow.open fails before the delay', async () => {
    render(<EpicsSection />)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await answer({ ok: false, error: 'no such folder' })
    await wait(READING_ROW_DELAY_MS * 10)
    expect(readingRow()).toBeNull()
    expect(screen.getByText('The epics could not be read: no such folder')).toBeTruthy()
  })

  it('keeps the row, with no gap, when the user switches to another Project that is still being read', async () => {
    const { rerender } = render(<EpicsSection />)
    await wait(READING_ROW_DELAY_MS)
    expect(readingRow()).not.toBeNull()

    state.project = BLOG
    rerender(<EpicsSection />)
    expect(state.invoke).toHaveBeenCalledWith('workflow.open', { root: OTHER })
    expect(readingRow()).not.toBeNull()
    for (let step = 0; step < READING_ROW_DELAY_MS; step += 50) {
      await wait(50)
      expect(readingRow()).not.toBeNull()
    }

    await answer({ ok: true, value: model(['blog-mvp'], null, OTHER) }, OTHER)
    expect(readingRow()).toBeNull()
    expect(screen.getAllByTestId('sidebar-epic').map((row) => row.getAttribute('data-epic'))).toEqual(['blog-mvp'])
  })

  it('hides the row at once when the user switches to a Project whose model is ready', async () => {
    // A fresh element each time: React skips rendering an element it has already rendered.
    const both = () => (
      <>
        <EpicsSection />
        <Holder root={OTHER} />
      </>
    )
    const { rerender } = render(both())
    await answer({ ok: true, value: model(['blog-mvp'], null, OTHER) }, OTHER)
    await wait(READING_ROW_DELAY_MS)
    expect(readingRow()).not.toBeNull()

    state.project = BLOG
    rerender(both())
    expect(readingRow()).toBeNull()
    expect(screen.getAllByTestId('sidebar-epic').map((row) => row.getAttribute('data-epic'))).toEqual(['blog-mvp'])
    await wait(READING_ROW_DELAY_MS * 10)
    expect(readingRow()).toBeNull()
  })

  it('announces the row and what replaces it: both stand in a status live region', async () => {
    render(<EpicsSection />)
    await wait(READING_ROW_DELAY_MS)
    expect(screen.getByRole('status').textContent).toBe(READING)
    await answer({ ok: true, value: model([]) })
    expect(screen.getByRole('status').textContent).toBe('No epics in .scratch/')
  })
})
