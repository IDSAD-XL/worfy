// worfy's own memory in main end to end: MemorySampler (src/main/diagnostics/memory.ts) tied to the
// `memoryIndicator` setting of a real AppSettingsStore over a temporary app-settings.json, and the
// `memory` channels registered through registerIpc, the same wrapper the app uses. The metrics are a
// stub of app.getAppMetrics(); the timers are vitest's fake ones, so "no timer runs" is counted.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followMemorySetting, MEMORY_SAMPLE_MS, MemorySampler } from '../../src/main/diagnostics/memory'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { memoryHandlers } from '../../src/main/ipc/memory'
import { APP_SETTINGS_FILE, AppSettingsStore } from '../../src/main/settings/store'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { memoryChanged, memoryClose, memoryOpen } from '../../src/shared/ipc/memory'
import type { ProcessMemoryMetric } from '../../src/shared/memory'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

interface FakeWindow {
  sent: { channel: string; payload: unknown }[]
  destroyed: boolean
  onDestroyed: (() => void)[]
  /** The listeners of the other events of a webContents, by event name. */
  listeners: Map<string, ((...args: unknown[]) => void)[]>
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

function fakeWindow(): FakeWindow {
  return {
    sent: [],
    destroyed: false,
    onDestroyed: [],
    listeners: new Map(),
    send(channel, payload) {
      this.sent.push({ channel, payload })
    },
    isDestroyed() {
      return this.destroyed
    },
    once(_event, listener) {
      this.onDestroyed.push(listener)
    },
    on(event, listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    },
  }
}

/** Emits a webContents event to the window's listeners, as Electron does. */
function fire(window: FakeWindow, event: string, ...args: unknown[]): void {
  for (const listener of window.listeners.get(event) ?? []) listener(...args)
}

/** A main-frame navigation to a new document that commits: View > Reload, a dev server reload. */
function reload(window: FakeWindow): void {
  fire(window, 'did-start-navigation', { isMainFrame: true, isSameDocument: false })
  fire(window, 'did-navigate', {}, APP_URL, -1, '')
}

function destroy(window: FakeWindow): void {
  window.destroyed = true
  for (const listener of window.onDestroyed.splice(0)) listener()
}

const METRICS: ProcessMemoryMetric[] = [
  { type: 'Browser', memory: { workingSetSize: 200_000 } },
  { type: 'Tab', memory: { workingSetSize: 150_000 } },
  { type: 'GPU', memory: { workingSetSize: 50_000 } },
]

let scratch: string
let store: AppSettingsStore
let read: ReturnType<typeof vi.fn<() => ProcessMemoryMetric[]>>
let sampler: MemorySampler

beforeEach(() => {
  vi.useFakeTimers()
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-memory-')))
  store = new AppSettingsStore(join(scratch, APP_SETTINGS_FILE))
  read = vi.fn(() => METRICS)
  sampler = new MemorySampler({ read, enabled: store.get().memoryIndicator, now: () => 7 })
  followMemorySetting(sampler, store)
})

afterEach(() => {
  sampler.stop()
  vi.useRealTimers()
  removeTestTree(scratch)
})

async function register(): Promise<{ open: (window: FakeWindow) => Promise<IpcResult<unknown>>; close: (window: FakeWindow) => Promise<IpcResult<unknown>> }> {
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './memory.ts': async () => memoryHandlers(() => sampler) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  const call = (name: string) => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${name}`)
    if (!listener) throw new Error(`${name} is not registered`)
    return async (window: FakeWindow) => (await listener({ senderFrame: { url: APP_URL }, sender: window } as unknown as IpcMainInvokeEvent, undefined)) as IpcResult<unknown>
  }
  return { open: call('memory.open'), close: call('memory.close') }
}

const changes = (window: FakeWindow) => window.sent.filter((each) => each.channel === `${IPC_CHANNEL_PREFIX}memory.changed`)

describe('MemorySampler and the memoryIndicator setting', () => {
  it('runs no timer and reads no metrics while no window shows the indicator, the setting on', () => {
    expect(store.get().memoryIndicator).toBe(true)
    vi.advanceTimersByTime(5 * MEMORY_SAMPLE_MS)
    expect(read).not.toHaveBeenCalled()
    expect(sampler.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a window that opens the indicator gets a sample at once, then one every 5 s', async () => {
    const { open } = await register()
    const window = fakeWindow()
    const answer = await open(window)
    expect(answer).toEqual({ ok: true, value: { totalKb: 400_000, byKind: { main: 200_000, windows: 150_000, gpu: 50_000, other: 0 }, sampledAt: 7 } })
    expect(read).toHaveBeenCalledTimes(1)
    expect(changes(window)).toHaveLength(1)

    expect(MEMORY_SAMPLE_MS).toBe(5_000)
    vi.advanceTimersByTime(4_999)
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(changes(window)).toHaveLength(2)
    vi.advanceTimersByTime(2 * MEMORY_SAMPLE_MS)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('turning the setting off stops the timer; turning it on starts it again', async () => {
    const { open } = await register()
    const window = fakeWindow()
    await open(window)
    expect(sampler.running).toBe(true)

    store.set({ memoryIndicator: false })
    expect(sampler.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    const reads = read.mock.calls.length
    vi.advanceTimersByTime(10 * MEMORY_SAMPLE_MS)
    expect(read).toHaveBeenCalledTimes(reads)
    expect(sampler.snapshot()).toBeNull()

    store.set({ memoryIndicator: true })
    expect(sampler.running).toBe(true)
    expect(read).toHaveBeenCalledTimes(reads + 1)
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS)
    expect(read).toHaveBeenCalledTimes(reads + 2)
  })

  it('with the setting off, opening the indicator answers null and starts nothing', async () => {
    store.set({ memoryIndicator: false })
    const { open } = await register()
    const window = fakeWindow()
    expect(await open(window)).toEqual({ ok: true, value: null })
    vi.advanceTimersByTime(10 * MEMORY_SAMPLE_MS)
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(window.sent).toEqual([])
  })

  it('a window that opens the figure twice stays subscribed until it closes it twice', async () => {
    const { open, close } = await register()
    const window = fakeWindow()
    await open(window)
    await open(window) // a second view in the same window: one listener, no second sample
    expect(read).toHaveBeenCalledTimes(1)
    expect(changes(window)).toHaveLength(1)

    await close(window)
    expect(sampler.running).toBe(true)
    vi.advanceTimersByTime(5_000)
    expect(changes(window)).toHaveLength(2)

    await close(window)
    expect(sampler.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5_000)
    expect(changes(window)).toHaveLength(2)
    // A close more than the opens changes nothing.
    await close(window)
    await open(window)
    expect(sampler.running).toBe(true)
  })

  it('the timer stops when the last window closes the indicator or is destroyed', async () => {
    const { open, close } = await register()
    const first = fakeWindow()
    const second = fakeWindow()
    await open(first)
    await open(second)
    expect(read).toHaveBeenCalledTimes(1)

    await close(first)
    expect(sampler.running).toBe(true)
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS)
    expect(changes(first)).toHaveLength(1)
    expect(changes(second)).toHaveLength(1)

    destroy(second)
    expect(sampler.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    const reads = read.mock.calls.length
    vi.advanceTimersByTime(10 * MEMORY_SAMPLE_MS)
    expect(read).toHaveBeenCalledTimes(reads)
  })

  it('a window destroyed with the figure open twice, never closed, stops the sampler', async () => {
    const { open } = await register()
    const window = fakeWindow()
    await open(window)
    await open(window)
    destroy(window)
    expect(sampler.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a reload of the window drops its opens: the new page opens once and one close stops the sampler', async () => {
    const { open, close } = await register()
    const window = fakeWindow()
    await open(window)
    // A same-document navigation and one of a frame inside the page keep the figure open.
    fire(window, 'did-start-navigation', { isMainFrame: true, isSameDocument: true })
    fire(window, 'did-navigate-in-page', {}, `${APP_URL}#x`, true)
    fire(window, 'did-start-navigation', { isMainFrame: false, isSameDocument: false })
    fire(window, 'did-frame-navigate', {}, 'about:blank', -1, '', false, 1, 1)
    expect(sampler.running).toBe(true)

    // The reload: the old page sends no memory.close.
    reload(window)
    expect(sampler.running).toBe(false)
    await open(window)
    expect(sampler.running).toBe(true)
    await close(window)
    expect(sampler.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(window.listeners.get('did-navigate')).toHaveLength(1)
  })

  it('a navigation that starts but never commits keeps the figure of the page that stays', async () => {
    const { open, close } = await register()
    const window = fakeWindow()
    await open(window)
    // A refused URL (will-frame-navigate, src/main/window.ts), a 204, a download: the start comes,
    // then the stop and no fail event (Electron 44.5.1); the old page stays up with its figure open.
    fire(window, 'did-start-navigation', { isMainFrame: true, isSameDocument: false })
    fire(window, 'did-stop-loading')
    expect(sampler.running).toBe(true)
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS)
    expect(changes(window)).toHaveLength(2)
    // The page that stayed closes the figure as usual, and that stops the sampler.
    await close(window)
    expect(sampler.running).toBe(false)
  })

  it('an error page in the main frame drops the opens; a failure inside a frame does not', async () => {
    const { open } = await register()
    const window = fakeWindow()
    await open(window)
    // A frame inside the page fails: the page stays.
    fire(window, 'did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/', false, 1, 2)
    fire(window, 'did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/', false, 1, 2)
    expect(sampler.running).toBe(true)
    // View > Reload with the dev server down: Electron commits an error page and emits no
    // did-navigate, only did-fail-provisional-load and then did-fail-load. The old page is gone.
    fire(window, 'did-start-navigation', { isMainFrame: true, isSameDocument: false })
    fire(window, 'did-fail-provisional-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:5173/', true, 1, 1)
    expect(sampler.running).toBe(false)
    fire(window, 'did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:5173/', true, 1, 1)
    expect(sampler.running).toBe(false)
  })

  it('a main-frame load that fails after the commit keeps the opens of the new page', async () => {
    const { open, close } = await register()
    const window = fakeWindow()
    await open(window)
    reload(window)
    expect(sampler.running).toBe(false)
    // The new page opens the figure, then the rest of its body never arrives: Electron 44 emits
    // did-fail-load -354 for the main frame after did-navigate and shows no error page.
    await open(window)
    fire(window, 'did-fail-load', {}, -354, 'ERR_CONTENT_LENGTH_MISMATCH', APP_URL, true, 1, 1)
    expect(sampler.running).toBe(true)
    await close(window)
    expect(sampler.running).toBe(false)
  })

  it('an open from a window already destroyed subscribes nothing', async () => {
    const { open } = await register()
    const window = fakeWindow()
    window.destroyed = true
    expect(await open(window)).toEqual({ ok: true, value: null })
    expect(sampler.running).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(window.onDestroyed).toHaveLength(0)
  })

  it('a window that is destroyed but has not reported it yet gets no sample', async () => {
    const { open } = await register()
    const window = fakeWindow()
    await open(window)
    expect(changes(window)).toHaveLength(1)
    window.destroyed = true // `destroyed` comes later
    vi.advanceTimersByTime(5_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(changes(window)).toHaveLength(1)
  })

  it('a window that closes and opens again listens for its destruction once', async () => {
    const { open, close } = await register()
    const window = fakeWindow()
    for (let round = 0; round < 3; round += 1) {
      await open(window)
      await close(window)
    }
    expect(window.onDestroyed).toHaveLength(1)
  })

  it('a read that throws skips that sample with one warning and keeps the timer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      read.mockImplementation(() => {
        throw new Error('no metrics')
      })
      const { open } = await register()
      const window = fakeWindow()
      expect(await open(window)).toEqual({ ok: true, value: null })
      vi.advanceTimersByTime(2 * MEMORY_SAMPLE_MS)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(sampler.running).toBe(true)
      read.mockImplementation(() => METRICS)
      vi.advanceTimersByTime(MEMORY_SAMPLE_MS)
      expect(changes(window)).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('memory channels', () => {
  it('are `local`: a Linked machine never reaches them', () => {
    expect([memoryOpen.access, memoryClose.access, memoryChanged.access]).toEqual(['local', 'local', 'local'])
  })
})
