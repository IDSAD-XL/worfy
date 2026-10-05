// src/main/index.ts over a mocked `electron` module: the handlers it registers on ipcMain answer
// only the renderer location the window loads (rendererEntry), not any frame that asks.
import type { IpcMainInvokeEvent } from 'electron'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  return {
    handlers,
    ipcMain: { handle: (channel: string, listener: (event: unknown, input: unknown) => unknown) => handlers.set(channel, listener) },
    createMainWindow: vi.fn(),
    installWebPolicy: vi.fn(),
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  }
})

vi.mock('electron', () => ({
  app: {
    setPath: vi.fn(),
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    exit: vi.fn(),
    getVersion: () => '1.2.3',
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: electron.ipcMain,
  protocol: electron.protocol,
}))

vi.mock('../../src/main/window', () => ({
  createMainWindow: electron.createMainWindow,
  installWebPolicy: electron.installWebPolicy,
  rendererEntry: () => ({ indexHtml: INDEX_HTML, devServerUrl: undefined }),
}))

async function call(frameUrl: string): Promise<IpcResult<unknown>> {
  const listener = electron.handlers.get(`${IPC_CHANNEL_PREFIX}app.version`) as Listener | undefined
  if (!listener) throw new Error('app.version is not registered')
  const event = { senderFrame: { url: frameUrl } } as unknown as IpcMainInvokeEvent
  return (await listener(event, undefined)) as IpcResult<unknown>
}

const startup: {
  schemes: unknown[]
  served: unknown[]
  servedBeforeWindow: boolean
  policies: ((url: string) => boolean)[]
  policyBeforeWindow: boolean
} = { schemes: [], served: [], servedBeforeWindow: false, policies: [], policyBeforeWindow: false }

beforeAll(async () => {
  await import('../../src/main/index')
  // registerIpc runs inside whenReady().then(...); the window is created right after it.
  await vi.waitFor(() => expect(electron.createMainWindow).toHaveBeenCalled())
  // Taken now: mock call records do not outlive this hook.
  startup.schemes = electron.protocol.registerSchemesAsPrivileged.mock.calls.map((args) => args[0])
  startup.served = electron.protocol.handle.mock.calls.map((args) => args[0])
  startup.servedBeforeWindow =
    (electron.protocol.handle.mock.invocationCallOrder[0] ?? Infinity) < (electron.createMainWindow.mock.invocationCallOrder[0] ?? -Infinity)
  startup.policies = electron.installWebPolicy.mock.calls.map((args) => args[0] as (url: string) => boolean)
  startup.policyBeforeWindow =
    (electron.installWebPolicy.mock.invocationCallOrder[0] ?? Infinity) < (electron.createMainWindow.mock.invocationCallOrder[0] ?? -Infinity)
})

describe('IPC wiring in src/main/index.ts', () => {
  it('answers a call from the window the app loads', async () => {
    expect(await call(`file://${INDEX_HTML}`)).toEqual({ ok: true, value: { version: '1.2.3' } })
  })

  it('rejects a call from any other frame', async () => {
    for (const frameUrl of ['https://example.com/', 'file:///tmp/other/index.html']) {
      const result = await call(frameUrl)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/untrusted/)
    }
  })
})

describe('Card protocol wiring in src/main/index.ts', () => {
  it('registers worfy-card:// as a standard, secure scheme and serves it before the first window', () => {
    expect(startup.schemes).toEqual([[{ scheme: 'worfy-card', privileges: { standard: true, secure: true } }]])
    expect(startup.served).toEqual(['worfy-card'])
    expect(startup.servedBeforeWindow).toBe(true)
  })
})

describe('web policy wiring in src/main/index.ts', () => {
  it('installs the policy once, before the first window, with the same renderer matcher as IPC', () => {
    expect(startup.policies).toHaveLength(1)
    expect(startup.policyBeforeWindow).toBe(true)
    const isAppUrl = startup.policies[0]
    expect(isAppUrl?.(`file://${INDEX_HTML}`)).toBe(true)
    expect(isAppUrl?.('worfy-card://c1.0a1b2c3d/index.html')).toBe(false)
    expect(isAppUrl?.('https://example.com/')).toBe(false)
  })
})
