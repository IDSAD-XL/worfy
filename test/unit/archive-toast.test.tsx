// The toast of the automatic archive (src/renderer/canvas/archive-toast.ts; worfy-canvas ticket 10,
// ADR-0076, point 8): main's `layout.archived` gives the Project one toast «Archived N finished
// sessions» with Undo, which a later batch replaces; Undo asks main for `layout.restoreBatch` of that
// batch alone; a read-only screen (ADR-0066), as it is when the batch comes, gets the toast without
// Undo; the toast closes once its batch has left the archive. IPC is replaced; the toast store and its
// component (ToastRegion.tsx) are real.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveBatchEvent } from '../../src/shared/ipc/layout'
import type { LayoutNode } from '../../src/shared/layout/types'
import { answerReadOnly } from '../../src/renderer/projects/read-only-now'
import { ToastRegion } from '../../src/renderer/toast/ToastRegion'
import { MAX_SHOWN, resetToasts, showToast, toasts } from '../../src/renderer/toast/toasts'

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

const { installArchiveToasts } = await import('../../src/renderer/canvas/archive-toast')

const PROJECT = 'p1'
let uninstall: () => void

function send(channel: string, payload: unknown): void {
  const handler = ipc.handlers.get(channel)
  if (handler === undefined) throw new Error(`nothing listens to ${channel}`)
  act(() => handler(payload))
}

/** main sends one batch of its timer. */
const batch = (event: Partial<ArchiveBatchEvent> = {}): void => send('layout.archived', { projectId: PROJECT, batch: 'b1', count: 2, ...event })

/** A Session Node, archived in `inBatch` or not archived. */
const node = (id: string, inBatch: string | null): LayoutNode => ({
  id,
  kind: 'session',
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: { sessionId: id },
  archived: inBatch === null ? null : { at: 1, rule: 'idle', batch: inBatch },
})

/** main tells of a change of the Project's Layout. */
const changed = (nodes: LayoutNode[], projectId = PROJECT): void =>
  send('layout.changed', { projectId, layout: { nodes, viewport: { x: 0, y: 0, zoom: 1 } }, revision: 2, screen: null, op: { op: 'restore', ids: nodes.map((each) => each.id) } })

const mount = (): void => {
  render(<ToastRegion projectId={PROJECT} />)
}

const archiveToasts = () => screen.queryAllByTestId('archive-toast')

beforeEach(() => {
  resetToasts()
  ipc.invoke.mockReset()
  ipc.handlers.clear()
  answerReadOnly(() => null)
  uninstall = installArchiveToasts()
})

afterEach(() => {
  uninstall()
  act(() => resetToasts())
  answerReadOnly(() => null)
})

describe('the archive toast', () => {
  it('a batch gives the Project one toast «Archived N finished sessions» with Undo; it stays until closed', () => {
    mount()
    batch()
    expect(archiveToasts()).toHaveLength(1)
    expect(archiveToasts()[0]!.textContent).toContain('Archived 2 finished sessions')
    expect(within(archiveToasts()[0]!).getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(toasts.getState().toasts.map((toast) => [toast.kind, toast.projectId])).toEqual([['action', PROJECT]])
  })

  it('one Session reads in the singular', () => {
    mount()
    batch({ count: 1 })
    expect(archiveToasts()[0]!.textContent).toContain('Archived 1 finished session')
    expect(archiveToasts()[0]!.textContent).not.toContain('sessions')
  })

  it('three batches are one toast, the latest; another toast of the Project, an error, still shows', () => {
    mount()
    batch({ batch: 'b1', count: 1 })
    batch({ batch: 'b2', count: 2 })
    batch({ batch: 'b3', count: 3 })
    expect(archiveToasts()).toHaveLength(1)
    expect(archiveToasts()[0]!.textContent).toContain('Archived 3 finished sessions')
    act(() => {
      showToast({ kind: 'error', projectId: PROJECT, text: 'Could not undo the archive: disk full' })
    })
    expect(screen.getByRole('alert').textContent).toContain('Could not undo the archive: disk full')
    expect(toasts.getState().toasts.filter((toast) => toast.waiting)).toEqual([])
    expect(toasts.getState().toasts.length).toBeLessThanOrEqual(MAX_SHOWN)
  })

  it('Undo asks main to restore the batch of the toast alone, of its Project, and closes the toast', async () => {
    ipc.invoke.mockResolvedValue({ ok: true, value: { projectId: PROJECT, layout: { nodes: [] }, revision: 3 } })
    mount()
    batch({ batch: 'b1' })
    batch({ batch: 'b2', count: 4 })
    fireEvent.click(within(archiveToasts()[0]!).getByRole('button', { name: 'Undo' }))
    expect(ipc.invoke.mock.calls).toEqual([['layout.restoreBatch', { projectId: PROJECT, batch: 'b2' }]])
    await waitFor(() => expect(archiveToasts()).toHaveLength(0))
  })

  it('an Undo main refuses says why in an error toast', async () => {
    ipc.invoke.mockResolvedValue({ ok: false, error: 'layout.restoreBatch: disk full' })
    mount()
    batch()
    fireEvent.click(within(archiveToasts()[0]!).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not undo the archive: layout.restoreBatch: disk full'))
  })

  it('a read-only screen (ADR-0066) gets the toast without Undo', () => {
    answerReadOnly(() => 'Studio gives this Machine read-only access')
    mount()
    batch()
    expect(archiveToasts()).toHaveLength(1)
    expect(archiveToasts()[0]!.textContent).toContain('Archived 2 finished sessions')
    expect(within(archiveToasts()[0]!).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(toasts.getState().toasts.map((toast) => toast.kind)).toEqual(['info'])
  })

  it('read-only is asked at each batch: access that turns read-only after the window started gives no Undo', () => {
    mount()
    batch({ batch: 'b1' })
    expect(within(archiveToasts()[0]!).getByRole('button', { name: 'Undo' })).toBeTruthy()
    answerReadOnly(() => 'Studio gives this Machine read-only access')
    batch({ batch: 'b2' })
    expect(within(archiveToasts()[0]!).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('the toast closes once nothing of its batch is archived: Undo in another window, Restore of its Sessions', () => {
    mount()
    batch({ batch: 'b1' })
    // One Session of the batch restored: the toast stays. Another Project's change does nothing.
    changed([node('a', null), node('b', 'b1')])
    changed([node('a', null), node('b', null)], 'p2')
    expect(archiveToasts()).toHaveLength(1)
    // The last one leaves the archive (or is in another batch now): the toast closes.
    changed([node('a', null), node('b', 'b9')])
    expect(archiveToasts()).toHaveLength(0)
  })

  it('a batch of another Project waits for that Project: it is not shown on this one', () => {
    mount()
    batch({ projectId: 'p2' })
    expect(archiveToasts()).toEqual([])
    expect(toasts.getState().toasts.map((toast) => toast.projectId)).toEqual(['p2'])
  })

  it('listens before any Canvas is drawn, and stops when uninstalled', () => {
    expect(ipc.handlers.has('layout.archived')).toBe(true)
    expect(ipc.handlers.has('layout.changed')).toBe(true)
    uninstall()
    expect(ipc.handlers.has('layout.archived')).toBe(false)
    expect(ipc.handlers.has('layout.changed')).toBe(false)
    uninstall = () => undefined
  })
})
