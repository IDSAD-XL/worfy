// The toast of a batch of the automatic archive (src/renderer/canvas/overlays/ArchiveToast.tsx;
// worfy-canvas ticket 10, ADR-0076, point 8): main's `layout.archived` gives one toast «Archived N
// finished sessions» with Undo, keyed by its batch; Undo asks main for `layout.restoreBatch` of that
// batch alone; a read-only screen (ADR-0066) gets the toast without Undo. IPC is replaced; the toast
// store and its component (ToastRegion.tsx) are real.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveBatchEvent } from '../../src/shared/ipc/layout'
import { answerReadOnly } from '../../src/renderer/projects/read-only-now'
import { ToastRegion } from '../../src/renderer/toast/ToastRegion'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (payload: unknown) => void>(),
}))

vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: ipc.invoke,
  subscribe: (channel: string, handler: (payload: unknown) => void) => {
    ipc.handlers.set(channel, handler)
    return () => ipc.handlers.delete(channel)
  },
}))

const { default: ArchiveToast } = await import('../../src/renderer/canvas/overlays/ArchiveToast')

const PROJECT = 'p1'

/** main sends one batch of its timer. */
function batch(event: Partial<ArchiveBatchEvent> = {}): void {
  const handler = ipc.handlers.get('layout.archived')
  if (handler === undefined) throw new Error('ArchiveToast does not listen to layout.archived')
  act(() => handler({ projectId: PROJECT, batch: 'b1', count: 2, ...event }))
}

function mount(): void {
  render(
    <>
      <ToastRegion projectId={PROJECT} />
      <ArchiveToast />
    </>,
  )
}

const shownToasts = () => screen.queryAllByTestId('archive-toast')

beforeEach(() => {
  resetToasts()
  ipc.invoke.mockReset()
  ipc.handlers.clear()
  answerReadOnly(() => null)
})

afterEach(() => {
  act(() => resetToasts())
  answerReadOnly(() => null)
})

describe('ArchiveToast', () => {
  it('a batch gives one toast «Archived N finished sessions» with Undo; the same batch again does not add another', () => {
    mount()
    batch()
    expect(shownToasts()).toHaveLength(1)
    expect(shownToasts()[0]!.textContent).toContain('Archived 2 finished sessions')
    expect(within(shownToasts()[0]!).getByRole('button', { name: 'Undo' })).toBeTruthy()
    batch()
    expect(shownToasts()).toHaveLength(1)
    // It stays until closed: an Undo has no time limit.
    expect(toasts.getState().toasts.map((toast) => [toast.kind, toast.projectId])).toEqual([['action', PROJECT]])
  })

  it('one Session reads in the singular; two batches are two toasts', () => {
    mount()
    batch({ batch: 'b1', count: 1 })
    batch({ batch: 'b2', count: 3 })
    expect(shownToasts().map((toast) => toast.textContent)).toEqual([
      expect.stringContaining('Archived 1 finished session'),
      expect.stringContaining('Archived 3 finished sessions'),
    ])
    expect(shownToasts()[0]!.textContent).not.toContain('sessions')
  })

  it('Undo asks main to restore that batch alone, of its Project, and closes the toast', async () => {
    ipc.invoke.mockResolvedValue({ ok: true, value: { projectId: PROJECT, layout: { nodes: [] }, revision: 3 } })
    mount()
    batch({ batch: 'b1' })
    batch({ batch: 'b2', count: 4 })
    fireEvent.click(within(shownToasts()[0]!).getByRole('button', { name: 'Undo' }))
    expect(ipc.invoke.mock.calls).toEqual([['layout.restoreBatch', { projectId: PROJECT, batch: 'b1' }]])
    await waitFor(() => expect(shownToasts()).toHaveLength(1))
    expect(shownToasts()[0]!.textContent).toContain('Archived 4 finished sessions')
  })

  it('an Undo main refuses says why in an error toast', async () => {
    ipc.invoke.mockResolvedValue({ ok: false, error: 'layout.restoreBatch: disk full' })
    mount()
    batch()
    fireEvent.click(within(shownToasts()[0]!).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not undo the archive: layout.restoreBatch: disk full'))
  })

  it('a read-only screen (ADR-0066) gets the toast without Undo', () => {
    answerReadOnly(() => 'Studio gives this Machine read-only access')
    mount()
    batch()
    expect(shownToasts()).toHaveLength(1)
    expect(shownToasts()[0]!.textContent).toContain('Archived 2 finished sessions')
    expect(within(shownToasts()[0]!).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(toasts.getState().toasts.map((toast) => toast.kind)).toEqual(['info'])
  })

  it('a batch of another Project waits for that Project: it is not shown on this one', () => {
    mount()
    batch({ projectId: 'p2' })
    expect(shownToasts()).toEqual([])
    expect(toasts.getState().toasts.map((toast) => toast.projectId)).toEqual(['p2'])
  })

  it('stops listening when it leaves', () => {
    const { unmount } = render(<ArchiveToast />)
    expect(ipc.handlers.has('layout.archived')).toBe(true)
    unmount()
    expect(ipc.handlers.has('layout.archived')).toBe(false)
  })
})
