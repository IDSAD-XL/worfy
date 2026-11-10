// The window's side of the PR inbox's morning digest and its switches (worfy-pr-inbox ticket 07):
// - src/renderer/pr-inbox/digest.ts asks main with `prInbox.digest` at each focus of the window, shows a `show`
//   answer as one action toast with Open, and asks again on `prInbox.changed` while main answers `pending`;
// - src/renderer/settings/PullRequestsSection.tsx shows the two switches, on by default, and sends a change as that
//   field alone.
// A fake preload stands for main; nothing reaches GitHub or a model. Every name is invented.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxDigestAnswer } from '../../src/shared/ipc/pr-inbox'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const opened = vi.hoisted(() => ({ calls: [] as { projectId: string; activeId: string | undefined }[] }))
vi.mock('../../src/renderer/pr-inbox/open', () => ({
  openPrInboxOf: (projectId: string, activeId: string | undefined) => {
    opened.calls.push({ projectId, activeId })
    return Promise.resolve(undefined)
  },
}))

interface FakeMain {
  /** What `prInbox.digest` answers next, in turn; `none` once they are used up. */
  answers: PrInboxDigestAnswer[]
  asks: number
  sets: unknown[]
  /** The listeners of each event channel, by name. */
  listeners: Map<string, ((payload: unknown) => void)[]>
}

function preload(state: AppSettings): FakeMain {
  const main: FakeMain = { answers: [], asks: 0, sets: [], listeners: new Map() }
  let next = 1
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'prInbox.digest') {
        main.asks += 1
        return Promise.resolve({ ok: true, value: main.answers.shift() ?? { state: 'none' } } as never)
      }
      if (channel === 'projects.list') return Promise.resolve({ ok: true, value: { projects: [], activeId: 'web-1', revision: 1 } } as never)
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: state } as never)
      if (channel === 'appSettings.set') {
        main.sets.push(input)
        return Promise.resolve({ ok: true, value: { ...state, ...(input as object), revision: state.revision + 1 } } as never)
      }
      return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
    },
    on: (channel, listener) => {
      main.listeners.set(channel, [...(main.listeners.get(channel) ?? []), listener as (payload: unknown) => void])
      return next++
    },
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 1,
  ...over,
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.resetModules()
  opened.calls.length = 0
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the morning digest in the window', () => {
  it('a focus asks main; a `show` answer is one action toast with Open; a second focus that main answers `none` adds none', async () => {
    const main = preload(settings())
    main.answers.push({ state: 'show', text: '2 reviews wait for you (oldest 2 days) · 1 ready to merge', projectIds: ['ops-2', 'web-1'] })
    const { installPrInboxDigest } = await import('../../src/renderer/pr-inbox/digest')
    const { toasts, shownToasts } = await import('../../src/renderer/toast/toasts')
    const stop = installPrInboxDigest()
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(main.asks).toBe(1)
    const shown = shownToasts(toasts.getState())
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ kind: 'action', testId: 'pr-inbox-digest', text: '2 reviews wait for you (oldest 2 days) · 1 ready to merge' })
    expect(shown[0]!.actions!.map((action) => action.label)).toEqual(['Open'])

    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(main.asks).toBe(2)
    expect(toasts.getState().toasts).toHaveLength(1)
    stop()
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(main.asks).toBe(2)
  })

  it('Open opens the Pull requests view of the active Project when the digest counts it, else of the first one', async () => {
    preload(settings())
    const { showDigest } = await import('../../src/renderer/pr-inbox/digest')
    const { toasts, pressToastAction } = await import('../../src/renderer/toast/toasts')
    showDigest({ state: 'show', text: '1 ready to merge', projectIds: ['ops-2', 'web-1'] }, () => 'web-1')
    pressToastAction(toasts.getState().toasts[0]!.id, 0)
    showDigest({ state: 'show', text: '1 ready to merge', projectIds: ['ops-2'] }, () => 'web-1')
    pressToastAction(toasts.getState().toasts[0]!.id, 0)
    expect(opened.calls).toEqual([
      { projectId: 'web-1', activeId: 'web-1' },
      { projectId: 'ops-2', activeId: 'web-1' },
    ])
    showDigest({ state: 'pending' }, () => 'web-1')
    showDigest({ state: 'none' }, () => 'web-1')
    expect(toasts.getState().toasts).toHaveLength(0)
  })

  it('a `pending` answer asks again at the next change of an inbox while the window has the focus, and only then', async () => {
    const main = preload(settings())
    main.answers.push({ state: 'pending' }, { state: 'show', text: '1 PR has new comments', projectIds: ['web-1'] })
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { installPrInboxDigest } = await import('../../src/renderer/pr-inbox/digest')
    const { toasts } = await import('../../src/renderer/toast/toasts')
    const stop = installPrInboxDigest()
    const changed = (): void => {
      for (const listener of main.listeners.get('prInbox.changed') ?? []) listener({ projectId: 'web-1' })
    }
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(main.asks).toBe(1)
    // The window went to the background before the inboxes were read: a change asks nothing.
    changed()
    await settle()
    expect(main.asks).toBe(1)
    hasFocus.mockReturnValue(true)
    changed()
    await settle()
    expect(main.asks).toBe(2)
    expect(toasts.getState().toasts.map((toast) => toast.text)).toEqual(['1 PR has new comments'])
    // Answered: a later change asks nothing.
    changed()
    await settle()
    expect(main.asks).toBe(2)
    stop()
    hasFocus.mockRestore()
  })
})

describe('Settings → Pull requests', () => {
  it('is a section titled Pull requests; both switches are on for a Machine that chose nothing; a change goes as its field alone', async () => {
    const main = preload(settings())
    const section = await import('../../src/renderer/settings/PullRequestsSection')
    expect(section.title).toBe('Pull requests')
    render(<section.default />)
    const notify = await screen.findByRole('switch', { name: 'Notify about new review requests and replies' })
    const digest = screen.getByRole('switch', { name: 'Morning digest' })
    await waitFor(() => expect(notify.getAttribute('aria-checked')).toBe('true'))
    expect(digest.getAttribute('aria-checked')).toBe('true')
    await act(async () => fireEvent.click(notify))
    await act(async () => fireEvent.click(digest))
    expect(main.sets).toEqual([{ prInboxNotify: false }, { prInboxDigest: false }])
  })

  it('a Machine that turned them off sees them off', async () => {
    preload(settings({ prInboxNotify: false, prInboxDigest: false }))
    const section = await import('../../src/renderer/settings/PullRequestsSection')
    render(<section.default />)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notify about new review requests and replies' }).getAttribute('aria-checked')).toBe('false'))
    expect(screen.getByRole('switch', { name: 'Morning digest' }).getAttribute('aria-checked')).toBe('false')
  })
})
