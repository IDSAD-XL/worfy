// The component of internal toasts (src/renderer/toast/ToastRegion.tsx; worfy-ui ticket 16): the live
// regions and the landmark, the keyboard (Escape on a toast in focus, Tab to the buttons), the buttons
// of an `action` toast, the pause while the pointer or the focus is on a toast, and the focus left
// where it was when a toast appears.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLACE_MS } from '../../src/renderer/toast/placement'
import { ToastRegion } from '../../src/renderer/toast/ToastRegion'
import { resetToasts, showToast, TOAST_MS, toasts } from '../../src/renderer/toast/toasts'

const region = () => screen.getByRole('region', { name: 'Notifications' })

beforeEach(() => resetToasts())
afterEach(() => {
  act(() => resetToasts())
  vi.useRealTimers()
})

describe('ToastRegion', () => {
  it('is a landmark "Notifications" drawn on <body>, with a polite status region and an alert region', () => {
    render(<ToastRegion projectId={undefined} />)
    expect(region().parentElement).toBe(document.body)
    act(() => {
      showToast({ kind: 'info', text: 'Not undone', testId: 'undo-skipped' })
      showToast({ kind: 'success', text: 'Copied gh auth login' })
      showToast({ kind: 'error', text: 'Cannot follow workflow.changed' })
    })
    const status = within(region()).getByRole('status')
    const alert = within(region()).getByRole('alert')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(within(status).getByTestId('undo-skipped').textContent).toBe('Not undone')
    expect(within(status).getByText('Copied gh auth login')).toBeTruthy()
    expect(within(alert).getByText('Cannot follow workflow.changed')).toBeTruthy()
    expect(within(status).queryByText('Cannot follow workflow.changed')).toBeNull()
  })

  it('an action toast sits in the status region; its button runs the handler and closes the toast', () => {
    render(<ToastRegion projectId="alpha" />)
    const undo = vi.fn()
    act(() => {
      showToast({ kind: 'action', text: 'Archived 3 finished sessions', key: 'batch-1', projectId: 'alpha', actions: [{ label: 'Undo', run: undo }] })
    })
    const status = within(region()).getByRole('status')
    fireEvent.click(within(status).getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Archived 3 finished sessions')).toBeNull()
    expect(toasts.getState().toasts).toEqual([])
  })

  it('the close button closes any toast', () => {
    render(<ToastRegion projectId={undefined} />)
    act(() => {
      showToast({ kind: 'error', text: 'failed' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('failed')).toBeNull()
  })

  it('Escape on a toast in focus closes it and goes no further', () => {
    const outside = vi.fn()
    window.addEventListener('keydown', outside)
    try {
      render(<ToastRegion projectId={undefined} />)
      act(() => {
        showToast({ kind: 'action', text: 'asked', actions: [{ label: 'Undo', run: () => undefined }] })
        showToast({ kind: 'error', text: 'kept' })
      })
      const button = screen.getByRole('button', { name: 'Undo' })
      act(() => button.focus())
      fireEvent.keyDown(button, { key: 'Escape' })
      expect(screen.queryByText('asked')).toBeNull()
      expect(screen.getByText('kept')).toBeTruthy()
      expect(outside).not.toHaveBeenCalled()
      // Another key on a toast is not taken.
      fireEvent.keyDown(screen.getByRole('button', { name: 'Dismiss' }), { key: 'a' })
      expect(screen.getByText('kept')).toBeTruthy()
    } finally {
      window.removeEventListener('keydown', outside)
    }
  })

  it('a toast does not take the focus from the field the user types in; its buttons are in the Tab order', () => {
    render(
      <>
        <textarea aria-label="Message" />
        <ToastRegion projectId={undefined} />
      </>,
    )
    const field = screen.getByRole('textbox', { name: 'Message' })
    field.focus()
    act(() => {
      showToast({ kind: 'action', text: 'Archived 2 finished sessions', actions: [{ label: 'Undo', run: () => undefined }] })
      showToast({ kind: 'error', text: 'failed' })
    })
    expect(document.activeElement).toBe(field)
    for (const button of within(region()).getAllByRole('button')) expect(button.tabIndex).toBe(0)
  })

  it('the pointer and the keyboard focus on a toast stop its time; leaving starts it again', () => {
    vi.useFakeTimers()
    render(<ToastRegion projectId={undefined} />)
    act(() => {
      showToast({ kind: 'info', text: 'File is on Mini', testId: 'file-elsewhere' })
    })
    const toast = screen.getByTestId('file-elsewhere')
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(TOAST_MS * 2))
    expect(screen.queryByTestId('file-elsewhere')).not.toBeNull()
    fireEvent.mouseLeave(toast)
    fireEvent.focus(within(toast).getByRole('button', { name: 'Dismiss' }))
    act(() => vi.advanceTimersByTime(TOAST_MS * 2))
    expect(screen.queryByTestId('file-elsewhere')).not.toBeNull()
    fireEvent.blur(within(toast).getByRole('button', { name: 'Dismiss' }))
    act(() => vi.advanceTimersByTime(TOAST_MS - 1))
    expect(screen.queryByTestId('file-elsewhere')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByTestId('file-elsewhere')).toBeNull()
  })

  it('a toast that leaves the screen under the pointer or the focus loses its pause: its time runs when it is back', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ToastRegion projectId="alpha" />)
    act(() => {
      showToast({ kind: 'info', text: 'Not undone', projectId: 'alpha', testId: 'undo-skipped' })
    })
    const toast = screen.getByTestId('undo-skipped')
    fireEvent.mouseEnter(toast)
    fireEvent.focus(within(toast).getByRole('button', { name: 'Dismiss' }))
    // A switch of Project takes it off the screen: no mouseleave, no blur.
    rerender(<ToastRegion projectId="beta" />)
    rerender(<ToastRegion projectId="alpha" />)
    expect(screen.queryByTestId('undo-skipped')).not.toBeNull()
    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(screen.queryByTestId('undo-skipped')).toBeNull()
  })

  it('Escape or Dismiss on a toast in focus gives the focus back to where it was before', () => {
    render(
      <>
        <textarea aria-label="Message" />
        <ToastRegion projectId={undefined} />
      </>,
    )
    const field = screen.getByRole('textbox', { name: 'Message' })
    act(() => {
      showToast({ kind: 'error', text: 'first' })
      showToast({ kind: 'error', text: 'second' })
    })
    const [first, second] = screen.getAllByRole('button', { name: 'Dismiss' })
    // Tab from the field onto the first toast's button.
    act(() => field.focus())
    act(() => first!.focus())
    fireEvent.focus(first!, { relatedTarget: field })
    fireEvent.keyDown(first!, { key: 'Escape' })
    expect(screen.queryByText('first')).toBeNull()
    expect(document.activeElement).toBe(field)

    act(() => second!.focus())
    fireEvent.focus(second!, { relatedTarget: field })
    fireEvent.click(second!)
    expect(screen.queryByText('second')).toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it("shows a Project's toast only while that Project is the window's active one", () => {
    const { rerender } = render(<ToastRegion projectId="alpha" />)
    act(() => {
      showToast({ kind: 'info', text: 'Not undone', projectId: 'alpha' })
    })
    expect(screen.queryByText('Not undone')).not.toBeNull()
    rerender(<ToastRegion projectId="beta" />)
    expect(screen.queryByText('Not undone')).toBeNull()
    rerender(<ToastRegion projectId="alpha" />)
    expect(screen.queryByText('Not undone')).not.toBeNull()
  })

  it('places the stack below what it keeps clear of in its column, measures again while a toast is shown, and stops with none', () => {
    vi.useFakeTimers()
    // jsdom lays nothing out: each element's box is given here, in window px.
    const boxes = new Map<Element, DOMRect>()
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return boxes.get(this) ?? new DOMRect(0, 0, 0, 0)
    })
    const mark = (attributes: Record<string, string>, box: DOMRect): HTMLElement => {
      const element = document.body.appendChild(document.createElement('div'))
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
      boxes.set(element, box)
      return element
    }
    const added: HTMLElement[] = []
    try {
      // The toolbar and a focused Ticket's header in the right column (x 904..1264 of a 1280 px window).
      added.push(mark({ 'data-toast-keep-out': '' }, new DOMRect(0, 0, 1280, 52)))
      added.push(mark({ 'data-toast-keep-out': '' }, new DOMRect(700, 74, 560, 162)))
      // Outside the column: kept clear of by nobody.
      added.push(mark({ 'data-toast-keep-out': '' }, new DOMRect(0, 260, 400, 300)))
      render(<ToastRegion projectId={undefined} />)
      const section = region()
      boxes.set(section, new DOMRect(904, 64, 360, 0))
      Object.defineProperty(section, 'scrollHeight', { configurable: true, value: 50 })
      expect(section.style.top).toBe('')
      act(() => {
        showToast({ kind: 'error', text: 'boom' })
      })
      expect(section.style.top).toBe(`${236 + 12}px`)

      // A dialog opens over the column: the next measure puts the stack below it.
      const dialog = mark({ role: 'dialog' }, new DOMRect(360, 60, 560, 440))
      added.push(dialog)
      act(() => {
        vi.advanceTimersByTime(PLACE_MS)
      })
      expect(section.style.top).toBe(`${500 + 12}px`)
      // A dialog that lets toasts over it (the ADR panel) does not count.
      dialog.setAttribute('data-toast-over', '')
      act(() => {
        vi.advanceTimersByTime(PLACE_MS)
      })
      expect(section.style.top).toBe('248px')
      dialog.removeAttribute('data-toast-over')
      // A popup over the whole column: the stack keeps its place in toast.css, over it.
      boxes.set(dialog, new DOMRect(360, 0, 920, 768))
      act(() => {
        vi.advanceTimersByTime(PLACE_MS)
      })
      expect(section.style.top).toBe('')

      // With no toast shown nothing is measured any more.
      boxes.set(dialog, new DOMRect(0, 0, 0, 0))
      act(() => resetToasts())
      const calls = measured.mock.calls.length
      act(() => {
        vi.advanceTimersByTime(PLACE_MS * 3)
      })
      expect(measured.mock.calls.length).toBe(calls)
    } finally {
      for (const element of added) element.remove()
      measured.mockRestore()
    }
  })

  it("keeps clear of the Session's message field and of the minimap at the bottom while the Command palette is open", async () => {
    ;(globalThis as { worfy?: unknown }).worfy = {
      invoke: () => Promise.resolve({ ok: false, error: 'no bridge' }),
      on: () => 1,
      off: () => undefined,
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boxes = new Map<Element, DOMRect>()
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return boxes.get(this) ?? new DOMRect(0, 0, 0, 0)
    })
    try {
      const { MessageInput } = await import('../../src/renderer/session/MessageInput')
      const { ReactFlowProvider } = await import('@xyflow/react')
      const { default: MiniMapOverlay } = await import('../../src/renderer/canvas/overlays/MiniMapOverlay')
      const { container } = render(
        <>
          <MessageInput sessionId="s" busy={false} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={() => undefined} />
          <ReactFlowProvider>
            <MiniMapOverlay />
          </ReactFlowProvider>
          <div role="dialog" aria-label="Command palette" />
          <ToastRegion projectId={undefined} />
        </>,
      )
      const section = region()
      boxes.set(section, new DOMRect(904, 64, 360, 0))
      Object.defineProperty(section, 'scrollHeight', { configurable: true, value: 150 })
      // The Command palette takes y 60..500 of the column (x 904..1264 of a 1280 x 768 window).
      boxes.set(screen.getByRole('dialog', { name: 'Command palette' }), new DOMRect(360, 60, 560, 440))
      const field = screen.getByTestId('message-input')
      const minimap = container.querySelector('.react-flow__minimap')
      expect(minimap).not.toBeNull()

      // The message field with Send at y 600..768: the stack takes the band above it, cut to it.
      boxes.set(field, new DOMRect(0, 600, 1280, 168))
      act(() => {
        showToast({ kind: 'error', text: 'boom' })
      })
      expect(section.style.top).toBe('512px')
      expect(section.style.maxHeight).toBe(`${600 - 12 - 512}px`)

      // The minimap at y 580..768 in its corner: the same.
      boxes.delete(field)
      boxes.set(minimap!, new DOMRect(1040, 580, 225, 188))
      act(() => {
        showToast({ kind: 'error', text: 'boom again' })
      })
      expect(section.style.top).toBe('512px')
      expect(section.style.maxHeight).toBe(`${580 - 12 - 512}px`)
    } finally {
      measured.mockRestore()
      vi.restoreAllMocks()
      delete (globalThis as { worfy?: unknown }).worfy
    }
  })
})

// A subscription of a renderer hook that fails (worfy-ui ticket 16, item 8): the failure used to go to
// the console alone. With a preload whose `on` throws, each hook shows one `error` toast per channel,
// and the same failure again (useClaudeHome tries again on its next user) does not stack up.
describe('IPC subscription failures', () => {
  afterEach(() => {
    delete (globalThis as { worfy?: unknown }).worfy
  })

  it('a throwing subscribe shows one error toast per channel; a repeat replaces it', async () => {
    vi.resetModules()
    ;(globalThis as { worfy?: unknown }).worfy = {
      invoke: () => new Promise(() => undefined),
      on: () => {
        throw new Error('the bridge is closed')
      },
      off: () => undefined,
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { renderHook } = await import('@testing-library/react')
      const store = await import('../../src/renderer/toast/toasts')
      const { useClaudeHome } = await import('../../src/renderer/claude-home/useClaudeHome')
      const { useWorkflow } = await import('../../src/renderer/workflow/useWorkflow')
      store.resetToasts()
      const errors = () => store.toasts.getState().toasts.filter((toast) => toast.kind === 'error')

      const first = renderHook(() => useClaudeHome('/repo'))
      expect(errors()).toMatchObject([{ id: 'ipc:claudeHome.changed', text: 'Updates stopped: cannot subscribe to claudeHome.changed (the bridge is closed)' }])
      first.unmount()
      // useClaudeHome subscribes again for its next user, fails again: still one toast, shown afresh.
      renderHook(() => useClaudeHome('/repo'))
      expect(errors()).toHaveLength(1)
      expect(errors()[0]!.version).toBe(2)

      renderHook(() => useWorkflow('/repo'))
      expect(errors().map((toast) => toast.id)).toEqual(['ipc:claudeHome.changed', 'ipc:workflow.changed'])
      // The console still has it.
      expect(logged).toHaveBeenCalledWith('workflow.changed: cannot subscribe', expect.any(Error))
      store.resetToasts()
    } finally {
      logged.mockRestore()
    }
  })

  it('useDocs and useLayout: a throwing subscribe shows an error toast for each channel', async () => {
    vi.resetModules()
    ;(globalThis as { worfy?: unknown }).worfy = {
      invoke: () => new Promise(() => undefined),
      on: () => {
        throw new Error('the bridge is closed')
      },
      off: () => undefined,
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { renderHook } = await import('@testing-library/react')
      const store = await import('../../src/renderer/toast/toasts')
      const { useDocs } = await import('../../src/renderer/docs/useDocs')
      const { useLayout } = await import('../../src/renderer/canvas/useLayout')
      store.resetToasts()
      renderHook(() => useDocs('alpha'))
      renderHook(() => useLayout('alpha'))
      expect(store.toasts.getState().toasts).toMatchObject([
        { id: 'ipc:docs.changed', kind: 'error', text: 'Updates stopped: cannot subscribe to docs.changed (the bridge is closed)' },
        { id: 'ipc:layout.changed', kind: 'error', text: 'Updates stopped: cannot subscribe to layout.changed (the bridge is closed)' },
      ])
      expect(logged).toHaveBeenCalledWith('docs.changed: cannot subscribe', expect.any(Error))
      expect(logged).toHaveBeenCalledWith('layout.changed: cannot subscribe', expect.any(Error))
      store.resetToasts()
    } finally {
      logged.mockRestore()
    }
  })

  it('claudeHome.live: a failure is one error toast; a poll that fails the same way neither announces it again nor brings back a closed one; a success takes it down', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let live: { ok: true; value: { live: unknown[] } } | { ok: false; error: string } = { ok: false, error: 'claudeHome.live: Mini is unreachable' }
    const session = { sessionId: 's1', pid: 1, cwd: '/repo', startedAt: 1, kind: 'interactive' }
    ;(globalThis as { worfy?: unknown }).worfy = {
      invoke: (channel: string) => {
        if (channel === 'claudeHome.sessions') return Promise.resolve({ ok: true, value: { live: [session], history: [{ sessionId: 's1', title: 'one' }] } })
        if (channel === 'claudeHome.live') return Promise.resolve(live)
        return new Promise(() => undefined)
      },
      on: () => 1,
      off: () => undefined,
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { renderHook } = await import('@testing-library/react')
      const store = await import('../../src/renderer/toast/toasts')
      const { useClaudeHome, LIVE_POLL_MS } = await import('../../src/renderer/claude-home/useClaudeHome')
      store.resetToasts()
      const errors = () => store.toasts.getState().toasts.filter((toast) => toast.kind === 'error')
      const poll = () => act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_POLL_MS)
      })
      renderHook(() => useClaudeHome('/repo'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await poll()
      expect(errors()).toMatchObject([{ id: 'ipc:claudeHome.live', text: 'Live Sessions not read: Mini is unreachable', version: 1 }])
      await poll()
      expect(errors()).toMatchObject([{ version: 1 }])
      // Closed by the user: the same failure does not bring it back.
      store.dismissToast('ipc:claudeHome.live')
      await poll()
      expect(errors()).toEqual([])
      // An answer in between, then the failure again: shown again.
      live = { ok: true, value: { live: [session] } }
      await poll()
      live = { ok: false, error: 'claudeHome.live: Mini is unreachable' }
      await poll()
      expect(errors()).toHaveLength(1)
      // A success takes it down.
      live = { ok: true, value: { live: [session] } }
      await poll()
      expect(errors()).toEqual([])
      store.resetToasts()
    } finally {
      logged.mockRestore()
    }
  })

  it('claudeHome.live of two roots: when the root whose reason is shown answers and the other still fails, the toast shows the reason of the other', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const failing = (reason: string) => ({ ok: false as const, error: `claudeHome.live: ${reason}` })
    const live: Record<string, { ok: true; value: { live: unknown[] } } | { ok: false; error: string }> = { '/a': failing('A is unreachable'), '/b': failing('B is unreachable') }
    const session = (cwd: string) => ({ sessionId: `s${cwd}`, pid: 1, cwd, startedAt: 1, kind: 'interactive' })
    ;(globalThis as { worfy?: unknown }).worfy = {
      invoke: (channel: string, input: { projectRoot: string }) => {
        const root = input.projectRoot
        if (channel === 'claudeHome.sessions') return Promise.resolve({ ok: true, value: { live: [session(root)], history: [{ sessionId: `s${root}`, title: 'one' }] } })
        if (channel === 'claudeHome.live') return Promise.resolve(live[root])
        return new Promise(() => undefined)
      },
      on: () => 1,
      off: () => undefined,
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { renderHook } = await import('@testing-library/react')
      const store = await import('../../src/renderer/toast/toasts')
      const { useClaudeHome, LIVE_POLL_MS } = await import('../../src/renderer/claude-home/useClaudeHome')
      store.resetToasts()
      const texts = () => store.toasts.getState().toasts.filter((toast) => toast.kind === 'error').map((toast) => toast.text)
      const poll = () => act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_POLL_MS)
      })
      renderHook(() => useClaudeHome('/a'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await poll()
      expect(texts()).toEqual(['Live Sessions not read: A is unreachable'])
      renderHook(() => useClaudeHome('/b'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await poll()
      expect(texts()).toEqual(['Live Sessions not read: B is unreachable'])
      // B answers, A still fails: the toast says A's reason, not B's stale one.
      live['/b'] = { ok: true, value: { live: [session('/b')] } }
      await poll()
      expect(texts()).toEqual(['Live Sessions not read: A is unreachable'])
      // B fails again: its reason. Closed by the user, the toast is not brought back with A's reason when B answers.
      live['/b'] = failing('B is unreachable')
      await poll()
      expect(texts()).toEqual(['Live Sessions not read: B is unreachable'])
      store.dismissToast('ipc:claudeHome.live')
      live['/b'] = { ok: true, value: { live: [session('/b')] } }
      await poll()
      expect(texts()).toEqual([])
      store.resetToasts()
    } finally {
      logged.mockRestore()
    }
  })
})
