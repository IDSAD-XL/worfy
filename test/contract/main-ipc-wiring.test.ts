// src/main/index.ts over a mocked `electron` module: the handlers it registers on ipcMain answer
// only the renderer location the window loads (rendererEntry), not any frame that asks.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

/** The menus set as the app menu (a plain list: mock call records are cleared between tests). */
const appMenus = vi.hoisted((): unknown[] => [])

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    setPath: vi.fn(),
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    exit: vi.fn(),
    getVersion: () => '1.2.3',
  },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: (menu: unknown) => appMenus.push(menu) },
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

// The mocked app is packaged, so src/main/harness/bundled.ts looks for the Harness copy of the build
// in <process.resourcesPath>/harness: a temporary folder the tests fill or leave empty.
const resources = mkdtempSync(join(tmpdir(), 'worfy-resources-'))
const pluginJson = join(resources, 'harness', '.claude-plugin', 'plugin.json')
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

function bundleHarness(manifest: Record<string, unknown>): void {
  mkdirSync(join(resources, 'harness', '.claude-plugin'), { recursive: true })
  writeFileSync(pluginJson, JSON.stringify(manifest))
}

afterAll(() => {
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
  rmSync(resources, { recursive: true, force: true })
})

beforeAll(async () => {
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true, writable: true })
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

  it('sets the app menu (src/main/menu.ts) once the app is ready, View ▸ Show Minimap included', () => {
    expect(appMenus).toHaveLength(1)
    const { template } = appMenus[0] as { template: { label?: string; submenu?: { id?: string }[] }[] }
    expect(template.find((item) => item.label === 'View')?.submenu?.some((item) => item.id === 'view.minimap')).toBe(true)
  })
})

describe('app.version in src/main/index.ts', () => {
  afterEach(() => {
    rmSync(join(resources, 'harness'), { recursive: true, force: true })
  })

  it('answers the version of the Harness copy bundled with the build', async () => {
    bundleHarness({ name: 'worfy', version: '0.2.0+abc1234' })
    expect(await call(`file://${INDEX_HTML}`)).toEqual({ ok: true, value: { version: '0.2.0+abc1234' } })
  })

  it('falls back to app.getVersion() when the build has no Harness copy', async () => {
    expect(await call(`file://${INDEX_HTML}`)).toEqual({ ok: true, value: { version: '1.2.3' } })
  })

  it('falls back to app.getVersion() when the copy has no version or an unreadable plugin.json', async () => {
    bundleHarness({ name: 'worfy' })
    expect(await call(`file://${INDEX_HTML}`)).toEqual({ ok: true, value: { version: '1.2.3' } })
    bundleHarness({ name: 'worfy', version: '' })
    expect(await call(`file://${INDEX_HTML}`)).toEqual({ ok: true, value: { version: '1.2.3' } })
    writeFileSync(pluginJson, '{ not json')
    expect(await call(`file://${INDEX_HTML}`)).toEqual({ ok: true, value: { version: '1.2.3' } })
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
