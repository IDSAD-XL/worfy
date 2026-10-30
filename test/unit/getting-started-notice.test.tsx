// The notice in the corner for an existing user (worfy-onboarding ticket 08; spec, decision 7 and
// owner's point 3), over the real toast store and its component (ToastRegion.tsx) and a fake preload: an existing user whose notice was
// never shown gets one `action` toast "New: Getting started — a guided demo of worfy." with "Open"
// and "Not now"; any way it leaves — either button, or Escape on it — tells main `gettingStarted.noticeSeen`, once. "Open" shows the section. A new
// user, or one whose notice was shown, gets nothing.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import type { AppSettings } from '../../src/shared/settings/app-settings'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

const TEXT = 'New: Getting started — a guided demo of worfy.'
const KEY = 'getting-started-notice'

const snapshot = (change: Partial<GettingStartedSnapshot> = {}): GettingStartedSnapshot => ({
  user: 'existing',
  section: 'hidden',
  steps: {},
  reworkSeen: false,
  noticeShown: false,
  demo: null,
  ...change,
})

const appSettings: AppSettings = {
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 0,
}

let invoke: ReturnType<typeof vi.fn<(channel: string, input?: unknown) => Promise<Answer>>>
const callsOf = (channel: string): unknown[] => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

function preload(state: GettingStartedSnapshot): void {
  const answers: Record<string, (input: unknown) => Answer> = {
    'gettingStarted.state': () => ({ ok: true, value: state }),
    'gettingStarted.noticeSeen': () => ({ ok: true, value: { ...state, noticeShown: true } }),
    'gettingStarted.setSection': (input) => ({ ok: true, value: { ...state, ...(input as object) } }),
    'appSettings.get': () => ({ ok: true, value: appSettings }),
    'appSettings.set': () => ({ ok: true, value: appSettings }),
  }
  invoke = vi.fn((channel: string, input?: unknown) => Promise.resolve(answers[channel]?.(input) ?? { ok: false, error: `${channel}: not in this test` }))
  ;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge
}

/** The modules of one window load: the notice installed over a fresh toast store, the toasts on screen. */
async function windowWith(state: GettingStartedSnapshot) {
  preload(state)
  const toasts = await import('../../src/renderer/toast/toasts')
  const { ToastRegion } = await import('../../src/renderer/toast/ToastRegion')
  const notice = await import('../../src/renderer/getting-started/notice')
  const store = await import('../../src/renderer/getting-started/store')
  render(<ToastRegion projectId={undefined} />)
  notice.installGettingStartedNotice()
  await waitFor(() => expect(callsOf('gettingStarted.state')).toHaveLength(1))
  // Let the answer of the read reach the notice.
  await act(flush)
  return { toasts, notice, store }
}

const noticeOnScreen = () => screen.queryByTestId(KEY)

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

describe('the notice for an existing user', () => {
  it('an existing user without noticeShown: one action toast with "Open" and "Not now"', async () => {
    const { toasts, notice } = await windowWith(snapshot())
    const shown = toasts.toasts.getState().toasts
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ id: KEY, kind: 'action', text: TEXT })
    const element = noticeOnScreen()
    expect(element?.textContent).toContain(TEXT)
    // Its two buttons, then the toast's own "Dismiss".
    expect(within(element!).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Open', 'Not now', 'Dismiss'])
    // Showing is not seeing: main is told only once it leaves.
    expect(callsOf('gettingStarted.noticeSeen')).toEqual([])
    // A second install in the same window load shows nothing more and reads nothing more.
    notice.installGettingStartedNotice()
    await act(flush)
    expect(toasts.toasts.getState().toasts).toHaveLength(1)
    expect(callsOf('gettingStarted.state')).toHaveLength(1)
  })

  it('"Not now": the toast goes and main hears noticeSeen once; the section is not touched', async () => {
    await windowWith(snapshot())
    fireEvent.click(within(noticeOnScreen()!).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(noticeOnScreen()).toBeNull())
    await act(flush)
    expect(callsOf('gettingStarted.noticeSeen')).toHaveLength(1)
    expect(callsOf('gettingStarted.setSection')).toEqual([])
  })

  it('closed with Escape: main hears noticeSeen once, and later toasts say nothing more', async () => {
    const { toasts } = await windowWith(snapshot())
    fireEvent.keyDown(noticeOnScreen()!, { key: 'Escape' })
    await waitFor(() => expect(noticeOnScreen()).toBeNull())
    await act(flush)
    expect(callsOf('gettingStarted.noticeSeen')).toHaveLength(1)
    act(() => {
      toasts.showToast({ kind: 'info', text: 'other' })
      toasts.resetToasts()
    })
    await act(flush)
    expect(callsOf('gettingStarted.noticeSeen')).toHaveLength(1)
  })

  it('"Open": the section is shown and focused, and main hears noticeSeen', async () => {
    const { store } = await windowWith(snapshot())
    fireEvent.click(within(noticeOnScreen()!).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(callsOf('gettingStarted.setSection')).toEqual([{ section: 'shown' }]))
    await waitFor(() => expect(store.useGettingStartedStore.getState().focusAsked).toBe(1))
    expect(callsOf('gettingStarted.noticeSeen')).toHaveLength(1)
    expect(noticeOnScreen()).toBeNull()
  })

  it('noticeShown true: no toast', async () => {
    const { toasts } = await windowWith(snapshot({ noticeShown: true }))
    expect(toasts.toasts.getState().toasts).toEqual([])
    expect(noticeOnScreen()).toBeNull()
    expect(callsOf('gettingStarted.noticeSeen')).toEqual([])
  })

  it('a new user: no toast', async () => {
    const { toasts } = await windowWith(snapshot({ user: 'new', section: 'shown' }))
    expect(toasts.toasts.getState().toasts).toEqual([])
    expect(callsOf('gettingStarted.noticeSeen')).toEqual([])
  })
})
