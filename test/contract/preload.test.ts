// The preload bridge (src/preload/index.ts) over a mocked `electron` module: what window.worfy
// sends to ipcRenderer, and that `off` removes the very listener `on` added.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => electron.exposed.set(key, api) },
  ipcRenderer: electron.ipcRenderer,
}))

type Listener = (event: unknown, payload: unknown) => void

let bridge: WorfyBridge

beforeAll(async () => {
  await import('../../src/preload/index')
  bridge = electron.exposed.get('worfy') as WorfyBridge
})

beforeEach(() => {
  vi.clearAllMocks()
})

/** The listener the preload handed to ipcRenderer.on in its n-th call since the last reset. */
const addedListener = (n = 0): [string, Listener] => electron.ipcRenderer.on.mock.calls[n] as [string, Listener]

describe('preload bridge', () => {
  it('exposes window.worfy and invokes under the worfy: prefix', async () => {
    expect(bridge).toBeDefined()
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: { version: '1.0.0' } })
    expect(await bridge.invoke('app.version', 42)).toEqual({ ok: true, value: { version: '1.0.0' } })
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('worfy:app.version', 42)
  })

  it('subscribes under the worfy: prefix and hands the handler only the payload', () => {
    const handler = vi.fn()
    bridge.on('sample.ticked', handler)
    const [channel, listener] = addedListener()
    expect(channel).toBe('worfy:sample.ticked')
    listener({ sender: 'the Electron event' }, { n: 1 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]).toEqual([{ n: 1 }])
  })

  it('off(id) removes exactly the listener that on() added, once', () => {
    const first = bridge.on('sample.ticked', vi.fn())
    const second = bridge.on('sample.ticked', vi.fn())
    expect(first).not.toBe(second)
    const [, firstListener] = addedListener(0)
    const [, secondListener] = addedListener(1)

    bridge.off(first)
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledTimes(1)
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith('worfy:sample.ticked', firstListener)

    bridge.off(first)
    bridge.off(12345)
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledTimes(1)

    bridge.off(second)
    expect(electron.ipcRenderer.removeListener).toHaveBeenLastCalledWith('worfy:sample.ticked', secondListener)
  })
})
