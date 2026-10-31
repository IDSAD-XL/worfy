// How src/main/index.ts starts the two steps of worfy-update ticket 05, over a mocked `electron`
// (the pattern of test/contract/main-archive-wiring.test.ts): the Harness of this copy after an
// Update, after the Update checks have started (their start reads the result of the last restart),
// through the app's one installer; and the check of "Harness out of date", first once that install
// has settled, then again after each install of the app's installer that answers `done`, and no more
// after `will-quit`.
//
// Nothing runs `claude` here: the installer's install and status are replaced, and so are the two
// steps' own work (test/contract/update-harness.test.ts and test/unit/update-harness-lag.test.ts run
// them). WORFY_DATA_DIR and WORFY_CLAUDE_HOME are the sandboxes of test/setup-contract.ts.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import type { AfterUpdateOptions } from '../../src/main/update/harness-after-update'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

/** How long a test waits for the start: on a loaded machine it takes longer than the 1 s vi.waitFor waits by default. */
const START_WAIT = { timeout: ms(10_000) }

const seen = vi.hoisted(() => {
  // Update on in this run (spec R1): set before src/main/index.ts is imported.
  process.env.WORFY_UPDATE = '1'
  return {
    order: [] as string[],
    quit: [] as (() => void)[],
    createMainWindow: vi.fn(),
    afterUpdate: [] as AfterUpdateOptions[],
    settleAfterUpdate: (): void => undefined,
    lagRuns: 0,
    lagAfter: [] as Promise<unknown>[],
    installs: [] as ('done' | 'declined')[],
  }
})

const STATUS: HarnessStatus = { state: { kind: 'installed', version: '0.3.0+bbbbbbb', enabled: true }, bundledVersion: '0.3.0+bbbbbbb', canInstall: true, pluginDir: '/nowhere/plugin', dependencies: [] }

vi.mock('../../src/main/harness/install', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/harness/install')>()
  class NoClaudeInstaller extends actual.HarnessInstaller {
    override status(): Promise<HarnessStatus> {
      return Promise.resolve(STATUS)
    }

    override install(): Promise<{ outcome: 'done' | 'declined'; status: HarnessStatus }> {
      return Promise.resolve({ outcome: seen.installs.shift() ?? 'done', status: STATUS })
    }
  }
  return { ...actual, HarnessInstaller: NoClaudeInstaller }
})

vi.mock('../../src/main/ipc/update', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/ipc/update')>()
  return {
    ...actual,
    startUpdateChecks: () => {
      seen.order.push('startUpdateChecks')
      return () => undefined
    },
  }
})

vi.mock('../../src/main/update/harness-after-update', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/update/harness-after-update')>()
  return {
    ...actual,
    installHarnessAfterUpdate: (options: AfterUpdateOptions) => {
      seen.order.push('installHarnessAfterUpdate')
      seen.afterUpdate.push(options)
      return new Promise((resolve) => (seen.settleAfterUpdate = () => resolve('installed')))
    },
  }
})

vi.mock('../../src/main/update/harness-lag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/update/harness-lag')>()
  class CountedLag extends actual.HarnessLagChecks {
    override run(): Promise<void> {
      seen.lagRuns += 1
      return Promise.resolve()
    }

    override start(after: Promise<unknown>): () => void {
      seen.lagAfter.push(after)
      return super.start(after)
    }
  }
  return { ...actual, HarnessLagChecks: CountedLag }
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
      if (event === 'will-quit') seen.quit.push(listener)
    },
    exit: vi.fn(),
    getVersion: () => '1.2.3',
  },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: vi.fn(), getApplicationMenu: () => null },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

vi.mock('../../src/main/window', () => ({
  createMainWindow: seen.createMainWindow,
  installWebPolicy: vi.fn(),
  rendererEntry: () => ({ indexHtml: '/nowhere/index.html', devServerUrl: undefined }),
}))

// The mocked app is packaged: src/main/harness/bundled.ts looks in <process.resourcesPath>/harness, an empty temporary folder here.
const resources = mkdtempSync(join(tmpdir(), 'worfy-resources-'))
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

/** Lets the promises of the start run. */
const settled = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

beforeAll(async () => {
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true, writable: true })
  await import('../../src/main/index')
  await vi.waitFor(() => expect(seen.createMainWindow).toHaveBeenCalled(), START_WAIT)
}, ms(20_000))

afterAll(() => {
  for (const stop of seen.quit) stop()
  delete process.env.WORFY_UPDATE
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
  removeTestTree(resources)
})

describe('the Harness after an Update in src/main/index.ts', () => {
  it('installs after the Update checks have started, once, through the app installer, with the update folder and the state file of the data folder', async () => {
    const { appInstaller } = await import('../../src/main/ipc/harness')
    const { updateDir, updateStateFile } = await import('../../src/main/update/state')
    expect(seen.order).toEqual(['startUpdateChecks', 'installHarnessAfterUpdate'])
    const [options] = seen.afterUpdate
    expect(options?.installer).toBe(appInstaller())
    expect(options?.dir).toBe(updateDir())
    expect(options?.stateFile).toBe(updateStateFile())
  })

  it('checks the lag only once that install has settled', async () => {
    expect(seen.lagAfter).toHaveLength(1)
    await settled()
    expect(seen.lagRuns).toBe(0)
    seen.settleAfterUpdate()
    await settled()
    expect(seen.lagRuns).toBe(1)
  })

  it('checks the lag again after each install of the app installer that answers done, and not after a cancelled one', async () => {
    const { appInstaller } = await import('../../src/main/ipc/harness')
    const before = seen.lagRuns
    seen.installs.push('done')
    await appInstaller().install(() => Promise.resolve(true))
    await settled()
    expect(seen.lagRuns).toBe(before + 1)

    seen.installs.push('declined')
    await appInstaller().install(() => Promise.resolve(false))
    await settled()
    expect(seen.lagRuns).toBe(before + 1)
  })

  it('stops listening on will-quit', async () => {
    const { appInstaller } = await import('../../src/main/ipc/harness')
    for (const stop of seen.quit) stop()
    seen.quit.length = 0
    const before = seen.lagRuns
    seen.installs.push('done')
    await appInstaller().install(() => Promise.resolve(true))
    await settled()
    expect(seen.lagRuns).toBe(before)
  })
})
