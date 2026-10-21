import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocsState } from '../../src/shared/ipc/docs'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import { openAdr, useCanvasRequests } from '../../src/renderer/find/canvas-requests'
import AdrSection from '../../src/renderer/shell/sidebar/AdrSection'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'

// "Go to ADR" in the command palette (ticket 31) leaves a request that the sidebar's ADR section
// carries out. The Project list, the ADR list and the ADR text come from main; here they are fixed.

const projects: { state: ProjectsState | undefined } = { state: undefined }

vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => projects.state,
  activeProject: (state: ProjectsState | undefined) => state?.projects.find((project) => project.id === state.activeId),
}))

const docs: DocsState = {
  projectId: 'p1',
  handoff: null,
  adrs: [
    { path: 'docs/adr/0001-a.md', number: '0001', title: 'First', status: 'принят', version: 'v1' },
    { path: 'docs/adr/0002-b.md', number: '0002', title: 'Second', status: 'принят', version: 'v1' },
  ],
}

vi.mock('../../src/renderer/docs/useDocs', () => ({
  useDocs: () => ({ state: docs, error: undefined }),
  useDocText: () => ({ text: 'text', error: undefined }),
}))

vi.mock('../../src/renderer/markdown/Markdown', () => ({ Markdown: ({ text }: { text: string }) => <p>{text}</p> }))

// The window's Machine: null — this Machine; an id — a window on that Linked machine (worfy-link ticket 12).
const shown: { machine: string | null } = { machine: null }
// shell.openInEditor answers with the path it opened, as main does; other outcomes when a test sets one.
const invoke = vi.hoisted(() => vi.fn<(channel: string, input?: unknown) => Promise<{ ok: true; value: unknown }>>(() => Promise.resolve({ ok: true, value: { path: 'opened', outcome: 'opened' } })))
vi.mock('../../src/renderer/ipc', () => ({ invoke, windowMachine: () => shown.machine }))
vi.mock('../../src/renderer/machines/useMachines', () => ({
  useMachines: () => ({ linked: [{ id: 'machine-m', name: 'Mini' }] }),
  linkStateNow: () => ({ linked: [{ id: 'machine-m', name: 'Mini' }] }),
  refreshLinkState: () => Promise.resolve(),
}))

const project = (id: string) => ({ id, name: id, path: `/repo/${id}`, branch: 'main' })
const panelPath = () => screen.queryByTestId('adr-panel')?.getAttribute('data-path') ?? null

beforeEach(() => {
  resetToasts()
  shown.machine = null
  invoke.mockClear()
  projects.state = { projects: [project('p1'), project('p2')], activeId: 'p1', revision: 1 }
  useCanvasRequests.setState({ adr: null, adrHandled: 0 })
})

describe('ADR section, opened from the palette', () => {
  it('opens every request it gets, not only the first one', () => {
    render(<AdrSection />)
    expect(panelPath()).toBeNull()
    act(() => openAdr('p1', 'docs/adr/0001-a.md'))
    expect(panelPath()).toBe('docs/adr/0001-a.md')
    act(() => openAdr('p1', 'docs/adr/0002-b.md'))
    expect(panelPath()).toBe('docs/adr/0002-b.md')
    // Closed, then asked for again.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(panelPath()).toBeNull()
    act(() => openAdr('p1', 'docs/adr/0002-b.md'))
    expect(panelPath()).toBe('docs/adr/0002-b.md')
  })

  it('carries out a request made while the sidebar was hidden once it is shown, and only once', () => {
    act(() => openAdr('p1', 'docs/adr/0001-a.md'))
    const first = render(<AdrSection />)
    expect(panelPath()).toBe('docs/adr/0001-a.md')
    first.unmount()
    // The sidebar shown again does not open the same ADR a second time.
    render(<AdrSection />)
    expect(panelPath()).toBeNull()
  })

  it('waits for the Project list before it carries a request out', () => {
    projects.state = undefined
    const view = render(<AdrSection />)
    act(() => openAdr('p1', 'docs/adr/0002-b.md'))
    expect(panelPath()).toBeNull()
    projects.state = { projects: [project('p1')], activeId: 'p1', revision: 2 }
    view.rerender(<AdrSection />)
    expect(panelPath()).toBe('docs/adr/0002-b.md')
  })

  it('drops a request for another Project, and leaves the open ADR as it is', () => {
    render(<AdrSection />)
    act(() => openAdr('p1', 'docs/adr/0002-b.md'))
    expect(panelPath()).toBe('docs/adr/0002-b.md')
    act(() => openAdr('p2', 'docs/adr/0001-a.md'))
    expect(panelPath()).toBe('docs/adr/0002-b.md')
    expect(useCanvasRequests.getState().adrHandled).toBe(2)
  })
})

// worfy-link ticket 12: the ADR file lies on the Project's Machine. "Open in Editor" in a window on
// a Linked machine shows "File is on <Machine>" instead of calling shell.openInEditor.
describe('ADR panel: Open in Editor', () => {
  const openInEditor = async () => {
    render(<AdrSection />)
    act(() => openAdr('p1', 'docs/adr/0001-a.md'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }))
    })
  }

  it('in a window on this Machine calls shell.openInEditor with the ADR path, and shows no toast', async () => {
    await openInEditor()
    expect(invoke).toHaveBeenCalledWith('shell.openInEditor', { projectId: 'p1', path: 'docs/adr/0001-a.md' })
    expect(toasts.getState().toasts).toEqual([])
  })

  // worfy-polish ticket 35: a symlinked ADR that leads to anything but a document is shown, not opened.
  it('says why when main showed the file in Finder instead of opening it', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { path: '/p1/run.term', outcome: 'revealed', revealedIn: 'darwin' } })
    await openInEditor()
    expect(toasts.getState().toasts).toMatchObject([{ kind: 'info', text: 'Shown in Finder: not a document', testId: 'file-revealed' }])
  })

  it('in a window on a Linked machine shows "File is on Mini" and calls nothing', async () => {
    shown.machine = 'machine-m'
    await openInEditor()
    // The toast of the window (toast/ToastRegion.tsx) shows it, not the panel.
    expect(toasts.getState().toasts).toMatchObject([{ kind: 'info', text: 'File is on Mini', testId: 'file-elsewhere' }])
    expect(invoke).not.toHaveBeenCalled()
  })
})
