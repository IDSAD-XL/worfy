// The AppUserModelId of worfy on Windows (worfy-windows ticket 11): src/main/index.ts over a mocked
// `electron` module sets it before the notifications and the first window; without it Windows shows
// no notification, or one without worfy's name and icon. The steps of the start that need a real
// app are replaced, as in main-ipc-wiring.test.ts.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ID, appUserModelId } from '../../src/main/app-id'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

/** What the start did, in order: `id:<value>`, `notifications`, `window`. */
const steps = vi.hoisted((): string[] => [])
const electron = vi.hoisted(() => ({ isPackaged: true }))
/** app.on of the mock, and the function that stops the gate queue's notifications. */
const appOn = vi.hoisted(() => vi.fn())
const stopGateQueueNotices = vi.hoisted(() => (): void => undefined)
/**
 * The sources of the owner-wait notes appWaitsSources answers (the workflow hub, worfy-pipeline
 * ticket 09), and the arguments installNotifications got.
 */
const waitsSources = vi.hoisted(() => ({ hub: 'the workflow hub of appWaitsSources' }))
const notificationArgs = vi.hoisted((): unknown[][] => [])

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.isPackaged
    },
    requestSingleInstanceLock: () => true,
    // src/main/quit-listeners.ts raises the limit of the app's listeners first.
    setMaxListeners: () => undefined,
    setPath: vi.fn(),
    setAppUserModelId: (id: string) => steps.push(`id:${id}`),
    whenReady: () => Promise.resolve(),
    on: appOn,
    exit: vi.fn(),
    getVersion: () => '1.2.3',
  },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

vi.mock('../../src/main/window', () => ({
  createMainWindow: () => steps.push('window'),
  installWebPolicy: vi.fn(),
  rendererEntry: () => ({ indexHtml: join(tmpdir(), 'worfy', 'index.html'), devServerUrl: undefined }),
}))

vi.mock('../../src/main/notify', () => ({
  installNotifications: (...args: unknown[]) => {
    notificationArgs.push(args)
    steps.push('notifications')
  },
  appWaitsSources: () => waitsSources,
  installGateQueueNotifications: () => stopGateQueueNotices,
  followAppLinkPauses: () => () => undefined,
  electronNotifyDeps: {},
}))

vi.mock('../../src/main/link/service', () => ({
  startAppLink: () => Promise.resolve({}),
  appLinkService: () => undefined,
  appLinkProblem: () => 'the link service is replaced in this test',
  onAppLinkStart: () => () => undefined,
  stopLinkOnQuit: vi.fn(),
}))

const dataDir = mkdtempSync(join(tmpdir(), 'worfy-app-id-'))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

/** Runs the start of src/main/index.ts as on `system` and answers with its steps. */
async function start(system: NodeJS.Platform, packaged: boolean): Promise<string[]> {
  electron.isPackaged = packaged
  Object.defineProperty(process, 'platform', { ...platform, value: system })
  await import('../../src/main/index')
  // The start registers every IPC handler first: seconds on a loaded machine.
  await vi.waitFor(() => expect(steps).toContain('window'), { timeout: ms(12_000) })
  return [...steps]
}

beforeEach(() => {
  vi.resetModules()
  steps.length = 0
  vi.stubEnv('WORFY_DATA_DIR', dataDir)
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
})

afterAll(() => {
  removeTestTree(dataDir)
})

describe('appUserModelId', () => {
  it('on Windows is the appId of electron-builder.yml in a packaged build, and the path of electron.exe in a dev run', () => {
    const builder = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8')
    expect(/^appId:\s*(\S+)/m.exec(builder)?.[1]).toBe(APP_ID)
    const exe = 'C:\\repo\\node_modules\\electron\\dist\\electron.exe'
    expect(appUserModelId('win32', true, exe)).toBe('dev.worfy.app')
    expect(appUserModelId('win32', false, exe)).toBe(exe)
  })

  it.each(['darwin', 'linux'] as const)('on %s there is none to set', (system) => {
    expect(appUserModelId(system, true, '/Applications/worfy.app/Contents/MacOS/worfy')).toBeNull()
    expect(appUserModelId(system, false, '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')).toBeNull()
  })
})

describe('the start in src/main/index.ts', () => {
  it('on Windows sets the id of the packaged build before the notifications and the first window', async () => {
    expect(await start('win32', true)).toEqual(['id:dev.worfy.app', 'notifications', 'window'])
  })

  it('on Windows a dev run sets the path of the running electron.exe', async () => {
    expect(await start('win32', false)).toEqual([`id:${process.execPath}`, 'notifications', 'window'])
  })

  it('on macOS sets none', async () => {
    expect(await start('darwin', true)).toEqual(['notifications', 'window'])
  })

  it('gives the notes of the Tickets that wait for the owner the sources of appWaitsSources: the workflow hub, not the Stage hub (worfy-pipeline ticket 09)', async () => {
    notificationArgs.length = 0
    await start('darwin', true)
    expect(notificationArgs).toHaveLength(1)
    expect(notificationArgs[0]![4]).toBe(waitsSources)
  })

  it("stops the gate queue's notifications on quit (worfy-windows ticket 17)", async () => {
    appOn.mockClear()
    await start('darwin', true)
    expect(appOn.mock.calls).toContainEqual(['will-quit', stopGateQueueNotices])
  })
})
