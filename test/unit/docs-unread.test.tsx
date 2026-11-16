// The documents of a Project whose main branch git could not read yet (ADR-0107, follow-up of worfy-polish ticket
// 118): main answers `docs.open` with no documents and the reason (`readError`), and sends the first read that works
// as `docs.changed`. The HANDOFF Node says the file could not be read, not that the Project has none; and a window
// whose `docs.open` failed takes the next `docs.changed` instead of staying on the error.
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes'
import type { DocsState } from '../../src/shared/ipc/docs'

const listeners = vi.hoisted(() => new Map<string, (payload: unknown) => void>())
const invoke = vi.hoisted(() => vi.fn<(channel: string, input?: unknown) => Promise<unknown>>())
vi.mock('../../src/renderer/ipc', () => ({
  invoke,
  subscribe: (channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener)
    return () => listeners.delete(channel)
  },
  showSubscribeError: () => undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => ({ projects: [{ id: 'p1', name: 'p1', path: '/repo/p1', branch: 'main' }], activeId: 'p1', revision: 1 }),
  activeProject: (state: { projects: Array<{ id: string }>; activeId: string }) => state.projects.find((project) => project.id === state.activeId),
}))
vi.mock('../../src/renderer/canvas/useLayout', () => ({ useLayoutOps: () => ({ apply: () => undefined }) }))
vi.mock('../../src/renderer/canvas/NodeResizeClamp', () => ({ NodeResizeClamp: (): ReactNode => null }))
vi.mock('../../src/renderer/markdown/Markdown', () => ({ Markdown: ({ text }: { text: string }) => <p>{text}</p> }))

const { useDocs } = await import('../../src/renderer/docs/useDocs')
const { default: HandoffNode } = await import('../../src/renderer/canvas/nodes/HandoffNode')

const READ: DocsState = { projectId: 'p1', handoff: { path: 'HANDOFF.md', version: 'v1' }, adrs: [] }

describe('documents that main could not read yet', () => {
  it('the HANDOFF Node says the file could not be read, with the reason, until a read works', async () => {
    invoke.mockImplementation((channel) => {
      if (channel === 'docs.open') return Promise.resolve({ ok: true, value: { projectId: 'p1', handoff: null, adrs: [], readError: 'git ls-tree failed' } })
      if (channel === 'docs.read') return Promise.resolve({ ok: true, value: { text: '# Handoff from main' } })
      return Promise.resolve({ ok: true, value: { closed: true } })
    })
    // HandoffNode reads only `id` and `selected` of the Node's props.
    const props = { id: 'h1', selected: false } as unknown as CanvasNodeProps
    const shown = render(<HandoffNode {...props} />)

    await screen.findByText('HANDOFF.md could not be read: git ls-tree failed')
    expect(screen.queryByText('The Project has no HANDOFF.md')).toBeNull()

    act(() => listeners.get('docs.changed')?.(READ))
    await screen.findByText('# Handoff from main')
    shown.unmount()
  })

  it('a window whose docs.open failed takes the next docs.changed', async () => {
    invoke.mockImplementation((channel) =>
      channel === 'docs.open' ? Promise.resolve({ ok: false, error: 'the layout could not be read' }) : Promise.resolve({ ok: true, value: { closed: true } }),
    )
    const { result, unmount } = renderHook(() => useDocs('p1'))
    await waitFor(() => expect(result.current.error).toBe('the layout could not be read'))

    act(() => listeners.get('docs.changed')?.(READ))
    expect(result.current).toEqual({ state: READ, error: undefined })
    unmount()
  })

  it('a docs.changed before docs.open has answered is still left for its answer', async () => {
    let answer: (value: unknown) => void = () => undefined
    invoke.mockImplementation((channel) => (channel === 'docs.open' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve({ ok: true, value: { closed: true } })))
    const { result, unmount } = renderHook(() => useDocs('p1'))
    act(() => listeners.get('docs.changed')?.({ ...READ, handoff: null }))
    expect(result.current.state).toBeUndefined()
    await act(async () => answer({ ok: true, value: READ }))
    expect(result.current.state).toEqual(READ)
    unmount()
  })
})
