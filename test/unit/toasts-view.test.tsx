// The component of internal toasts (src/renderer/toast/ToastRegion.tsx; worfy-ui ticket 16): the live
// regions and the landmark, the keyboard (Escape on a toast in focus, Tab to the buttons), the buttons
// of an `action` toast, the pause while the pointer or the focus is on a toast, and the focus left
// where it was when a toast appears.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
})
