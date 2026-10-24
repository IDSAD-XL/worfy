// How src/main/index.ts starts the automatic archive of finished Sessions (worfy-canvas tickets 07
// and 08, ADR-0076), over a mocked `electron`: the archive registry under the Claude home, the
// Sessions worfy runs as live, the Setting of Settings → Canvas read at every run, the timer started
// once with WORFY_ARCHIVE_TICK_MS, the archiver «Archive finished sessions now» asks, and its stop on
// `will-quit`. The archiver's own start is replaced: no run touches a Layout here
// (test/contract/layout-archive.test.ts runs it).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AutoArchiveDeps } from '../../src/main/layout/archive'
import { removeTestTree } from '../remove'

/** How long a test waits for the start: on a loaded machine it takes longer than the 1 s vi.waitFor waits by default. */
const START_WAIT = { timeout: 10_000 }

const TICK = '4321'

const electron = vi.hoisted(() => {
  // Read by the start (archiveTickMs): set before src/main/index.ts is imported.
  process.env.WORFY_ARCHIVE_TICK_MS = '4321'
  return {
    quit: [] as (() => void)[],
    createMainWindow: vi.fn(),
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  }
})

/** What the start did with the archive. */
const seen = vi.hoisted(() => ({ homes: [] as string[], deps: [] as AutoArchiveDeps[], starts: [] as number[], stops: 0 }))

vi.mock('../../src/main/layout/archive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/layout/archive')>()
  class StartedArchiver extends actual.AutoArchiver {
    constructor(deps: AutoArchiveDeps) {
      super(deps)
      seen.deps.push(deps)
    }

    override start(everyMs?: number): () => void {
      seen.starts.push(everyMs ?? Number.NaN)
      return () => {
        seen.stops += 1
      }
    }
  }
  return {
    ...actual,
    AutoArchiver: StartedArchiver,
    archiveRegistry: (options: Parameters<typeof actual.archiveRegistry>[0]) => {
      seen.homes.push(options.home)
      return actual.archiveRegistry(options)
    },
  }
})

vi.mock('../../src/main/link/service', () => ({
  startAppLink: () => Promise.resolve({}),
  appLinkService: () => undefined,
  appLinkProblem: () => 'the link service is replaced in this test',
  onAppLinkStart: () => () => undefined,
  stopLinkOnQuit: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    // src/main/quit-listeners.ts raises the limit of the app's listeners first.
    setMaxListeners: () => undefined,
    setPath: vi.fn(),
    setAppUserModelId: vi.fn(),
    whenReady: () => Promise.resolve(),
    on: (event: string, listener: () => void) => {
      if (event === 'will-quit') electron.quit.push(listener)
    },
    exit: vi.fn(),
    getVersion: () => '1.2.3',
  },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: vi.fn(), getApplicationMenu: () => null },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: electron.protocol,
}))

vi.mock('../../src/main/window', () => ({
  createMainWindow: electron.createMainWindow,
  installWebPolicy: vi.fn(),
  rendererEntry: () => ({ indexHtml: '/nowhere/index.html', devServerUrl: undefined }),
}))

// The mocked app is packaged: src/main/harness/bundled.ts looks in <process.resourcesPath>/harness, an empty temporary folder here.
const resources = mkdtempSync(join(tmpdir(), 'worfy-resources-'))
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

beforeAll(async () => {
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true, writable: true })
  await import('../../src/main/index')
  await vi.waitFor(() => expect(electron.createMainWindow).toHaveBeenCalled(), START_WAIT)
}, 20_000)

afterAll(() => {
  delete process.env.WORFY_ARCHIVE_TICK_MS
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
  removeTestTree(resources)
})

describe('the automatic archive in src/main/index.ts', () => {
  it('reads the registry under the Claude home of the app', async () => {
    const { claudeHome } = await import('../../src/main/storage/paths')
    expect(seen.homes).toEqual([claudeHome()])
  })

  it('starts one archiver, once, with the tick of WORFY_ARCHIVE_TICK_MS, and makes it the one «Archive finished sessions now» asks', async () => {
    const { runningArchiver } = await import('../../src/main/layout/archive')
    expect(seen.deps).toHaveLength(1)
    expect(seen.starts).toEqual([Number(TICK)])
    expect(runningArchiver()).not.toBeNull()
  })

  it('archives the Projects of this Machine', async () => {
    const { projectStore } = await import('../../src/main/projects/store')
    expect(seen.deps[0]!.projects()).toEqual(projectStore().list())
  })

  it('counts the Sessions worfy runs as live: both ids of a resumed one, none of a closed one', async () => {
    const { sharedRegistry } = await import('../../src/main/agent/app-registry')
    const list = vi.spyOn(sharedRegistry(), 'list').mockReturnValue([
      { sessionId: 'own-1', sdkSessionId: null, state: 'idle' },
      { sessionId: 'own-2', sdkSessionId: 'sdk-2', state: 'busy' },
      { sessionId: 'own-3', sdkSessionId: 'sdk-3', state: 'closed' },
    ] as unknown as ReturnType<ReturnType<typeof sharedRegistry>['list']>)
    try {
      expect([...seen.deps[0]!.running()].sort()).toEqual(['own-1', 'own-2', 'sdk-2'])
    } finally {
      list.mockRestore()
    }
  })

  it('reads the Setting of Settings → Canvas at every run: 24 h by default, the person\'s threshold and switch after a change', async () => {
    const { appSettingsStore } = await import('../../src/main/settings/store')
    const deps = seen.deps[0]!
    expect(deps.settings('any')).toEqual({ idleMs: 24 * 3_600_000, ticketDone: true })
    appSettingsStore().set({ sessionArchive: { after: '6h', ticketDone: false } })
    expect(deps.settings('any')).toEqual({ idleMs: 6 * 3_600_000, ticketDone: false })
    appSettingsStore().set({ sessionArchive: { after: 'never' } })
    expect(deps.settings('any')).toEqual({ idleMs: null, ticketDone: false })
  })

  it('stops on will-quit, and «Archive finished sessions now» then finds no archiver', async () => {
    const { runningArchiver } = await import('../../src/main/layout/archive')
    expect(seen.stops).toBe(0)
    for (const listener of electron.quit) listener()
    expect(seen.stops).toBe(1)
    expect(runningArchiver()).toBeNull()
  })
})
