// The toast "File is on <Machine>" (src/renderer/machines/useFileElsewhere.ts; worfy-link ticket 12,
// worfy-ui ticket 16): a window on a Linked machine does not open a Project file and shows the toast
// for a few seconds; a window on this Machine opens it as before and never asks for the link state on
// its account.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const M = '7d3c1a52-0b8e-4c39-9a51-2f6d8e4b7a10'
const asked: string[] = []
let linked: { id: string; name: string }[]

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  linked = [{ id: M, name: 'Mini' }]
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => {
      asked.push(channel)
      if (channel === 'link.state') return Promise.resolve({ ok: true, value: { revision: 1, linked: linked.map((each) => ({ ...each, state: 'online', certificateChanged: false })) } })
      return Promise.resolve({ ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  window.history.replaceState(null, '', '/')
  vi.useRealTimers()
})

async function mount(machine: string | null) {
  window.history.replaceState(null, '', machine === null ? '/' : `/?machine=${machine}&project=p-00000001`)
  const { useFileElsewhere } = await import('../../src/renderer/machines/useFileElsewhere')
  const { ToastRegion } = await import('../../src/renderer/toast/ToastRegion')
  const store = await import('../../src/renderer/toast/toasts')
  store.resetToasts()
  const opened = vi.fn()
  function Probe() {
    const file = useFileElsewhere()
    return (
      <div>
        <button type="button" onClick={() => (file.elsewhere ? file.show() : opened())}>
          open
        </button>
        <ToastRegion projectId={undefined} />
      </div>
    )
  }
  render(<Probe />)
  return { opened, TOAST_MS: store.TOAST_MS }
}

const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
  })
}

describe('useFileElsewhere', () => {
  it('in a window on this Machine: not elsewhere, no toast, no link state asked', async () => {
    const { opened } = await mount(null)
    await click()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('file-elsewhere')).toBeNull()
    expect(asked).toEqual([])
  })

  it('in a window on M: shows the toast "File is on Mini" instead of opening', async () => {
    const { opened } = await mount(M)
    expect(screen.queryByTestId('file-elsewhere')).toBeNull()
    // Nothing is asked before a toast is wanted.
    expect(asked).toEqual([])
    await click()
    expect(opened).not.toHaveBeenCalled()
    // The link state is read then; the toast names the Machine once it has the name.
    await vi.waitFor(() => expect(screen.getByTestId('file-elsewhere').textContent).toBe('File is on Mini'))
    expect(asked).toEqual(['link.state'])
    // An info toast: in the polite region of the window's notifications.
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(within(region).getByRole('status').contains(screen.getByTestId('file-elsewhere'))).toBe(true)
    expect(screen.getAllByTestId('file-elsewhere')).toHaveLength(1)
  })

  it('hides the toast after TOAST_MS; another click replaces it and starts the time again', async () => {
    const { TOAST_MS } = await mount(M)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await click()
    expect(screen.queryByTestId('file-elsewhere')).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(TOAST_MS - 1)
    })
    expect(screen.queryByTestId('file-elsewhere')).not.toBeNull()
    // A second click starts the time again, with one toast on screen.
    await click()
    expect(screen.getAllByTestId('file-elsewhere')).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(TOAST_MS - 1)
    })
    expect(screen.queryByTestId('file-elsewhere')).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('file-elsewhere')).toBeNull()
  })

  it('names the Machine "the Linked machine" while the link state does not know it', async () => {
    linked = []
    await mount(M)
    await click()
    await vi.waitFor(() => expect(asked).toContain('link.state'))
    await act(async () => {})
    expect(screen.getByTestId('file-elsewhere').textContent).toBe('File is on the Linked machine')
  })
})
