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
}))

vi.mock('../../src/main/window', () => ({
  createMainWindow: electron.createMainWindow,
  rendererEntry: () => ({ indexHtml: INDEX_HTML, devServerUrl: undefined }),
}))

async function call(frameUrl: string): Promise<IpcResult<unknown>> {
  const listener = electron.handlers.get(`${IPC_CHANNEL_PREFIX}app.version`) as Listener | undefined
  if (!listener) throw new Error('app.version is not registered')
  const event = { senderFrame: { url: frameUrl } } as unknown as IpcMainInvokeEvent
  return (await listener(event, undefined)) as IpcResult<unknown>
}

beforeAll(async () => {
  await import('../../src/main/index')
  // registerIpc runs inside whenReady().then(...); the window is created right after it.
  await vi.waitFor(() => expect(electron.createMainWindow).toHaveBeenCalled())
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
