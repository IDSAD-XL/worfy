// The renderer's copy of the app settings (src/renderer/settings/useAppSettings.ts): the first
// `appSettings.get` answer, then `appSettings.changed` by revision, so an answer and an event that
// arrive out of order do not roll the settings back; `setAppSettings` calls `appSettings.set`.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, interfaceScale: number, collapsed: Record<string, boolean> = {}): AppSettings => ({
  interfaceScale,
  sidebar: { collapsed, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  revision,
})

interface FakeBridge {
  calls: { channel: string; input: unknown }[]
  /** Answers the pending `appSettings.get`. */
  answerGet: (state: AppSettings) => void
  /** What `appSettings.set` answers. */
  setAnswer: IpcResult<unknown>
  /** Fires `appSettings.changed`. */
  changed: (state: AppSettings) => void
  subscribed: string[]
}

let fake: FakeBridge

beforeEach(() => {
  vi.resetModules()
  const handlers = new Map<string, (payload: unknown) => void>()
  let answerGet: (state: AppSettings) => void = () => undefined
  const current: FakeBridge = {
    calls: [],
    answerGet: (state) => answerGet(state),
    setAnswer: { ok: true, value: settings(9, 1.2) },
    changed: (state) => handlers.get('appSettings.changed')?.(state),
    subscribed: [],
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      current.calls.push({ channel, input })
      if (channel === 'appSettings.get') return new Promise((resolve) => (answerGet = (value) => resolve({ ok: true, value })))
      return Promise.resolve(current.setAnswer)
    },
    on: (channel, handler) => {
      current.subscribed.push(channel)
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  }
  fake = current
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount() {
  const module = await import('../../src/renderer/settings/useAppSettings')
  const hook = renderHook(() => module.useAppSettings())
  return { ...module, hook }
}

describe('useAppSettings', () => {
  it('holds the defaults until main answers, then takes the answer of appSettings.get', async () => {
    const { hook } = await mount()
    expect(hook.result.current).toStrictEqual(DEFAULT_APP_SETTINGS)
    expect(fake.calls).toEqual([{ channel: 'appSettings.get', input: undefined }])
    expect(fake.subscribed).toEqual(['appSettings.changed'])
    await act(async () => fake.answerGet(settings(4, 1.3, { MachinesSection: true })))
    expect(hook.result.current).toStrictEqual(settings(4, 1.3, { MachinesSection: true }))
  })

  it('takes an answer whose revision equals the one it holds: revision 0 of a file never written by worfy', async () => {
    const { hook } = await mount()
    // The defaults carry revision 0 too; a file edited by hand, or one without `revision`, answers 0.
    await act(async () => fake.answerGet(settings(0, 1.3, { DocsSection: true })))
    expect(hook.result.current).toStrictEqual(settings(0, 1.3, { DocsSection: true }))
  })

  it('an event with a newer revision changes the settings; one with an older revision does not', async () => {
    const { hook } = await mount()
    await act(async () => fake.answerGet(settings(4, 1.3)))
    act(() => fake.changed(settings(5, 1.4)))
    expect(hook.result.current).toStrictEqual(settings(5, 1.4))
    act(() => fake.changed(settings(3, 0.9)))
    expect(hook.result.current).toStrictEqual(settings(5, 1.4))
  })

  it('a get answer that comes back after a newer event is ignored', async () => {
    const { hook } = await mount()
    act(() => fake.changed(settings(6, 1.1)))
    await act(async () => fake.answerGet(settings(5, 0.8)))
    expect(hook.result.current).toStrictEqual(settings(6, 1.1))
  })

  it('setAppSettings calls appSettings.set with the change it is given and takes the answer', async () => {
    const { hook, setAppSettings } = await mount()
    const patch = { sidebar: { collapsed: { ProjectsSection: true } } }
    let error: string | undefined = 'not called'
    await act(async () => {
      error = await setAppSettings(patch)
    })
    expect(error).toBeUndefined()
    expect(fake.calls.at(-1)).toEqual({ channel: 'appSettings.set', input: patch })
    expect(hook.result.current).toStrictEqual(settings(9, 1.2))
  })

  it('setAppSettings answers the reason when main refuses, and keeps the settings', async () => {
    const { hook, setAppSettings } = await mount()
    await act(async () => fake.answerGet(settings(2, 1.1)))
    fake.setAnswer = { ok: false, error: 'appSettings.set failed: disk full' }
    let error: string | undefined
    await act(async () => {
      error = await setAppSettings({ interfaceScale: 1.5 })
    })
    expect(error).toBe('appSettings.set failed: disk full')
    expect(hook.result.current).toStrictEqual(settings(2, 1.1))
  })

  it('takes a part of the settings with a selector', async () => {
    const module = await import('../../src/renderer/settings/useAppSettings')
    const hook = renderHook(() => module.useAppSettings((state) => state.sidebar.visible.focus))
    expect(hook.result.current).toBe(true)
    act(() => fake.changed({ ...settings(1, 1), sidebar: { collapsed: {}, visible: { normal: true, focus: false } } }))
    expect(hook.result.current).toBe(false)
  })

  it('asks main once, however many components use the settings', async () => {
    const module = await import('../../src/renderer/settings/useAppSettings')
    renderHook(() => module.useAppSettings())
    renderHook(() => module.useAppSettings((state) => state.interfaceScale))
    await waitFor(() => expect(fake.calls).toHaveLength(1))
    expect(fake.subscribed).toEqual(['appSettings.changed'])
  })
})

describe('useAppSettings without the preload bridge', () => {
  it('gives the defaults and asks nothing (unit tests of components)', async () => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
    const error = vi.spyOn(console, 'error')
    const { hook } = await mount()
    expect(hook.result.current).toStrictEqual(DEFAULT_APP_SETTINGS)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hook.result.current).toStrictEqual(DEFAULT_APP_SETTINGS)
    expect(fake.calls).toEqual([])
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
