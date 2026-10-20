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
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): void
}

function fakeWindow(): FakeWindow {
  return {
    sent: [],
    destroyed: false,
    onDestroyed: [],
    send(channel, payload) {
      this.sent.push({ channel, payload })
    },
    isDestroyed() {
      return this.destroyed
    },
    once(_event, listener) {
      this.onDestroyed.push(listener)
    },
  }
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

    vi.advanceTimersByTime(MEMORY_SAMPLE_MS - 1)
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

  it('the timer stops when the last window closes the indicator or is destroyed', async () => {
    const { open, close } = await register()
    const first = fakeWindow()
    const second = fakeWindow()
    await open(first)
    await open(first) // a second open in the same window adds nothing
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
