// The camera of a Project's Canvas end to end in main (worfy-link ticket 06): src/main/ipc/viewport.ts
// registered through registerIpc (the same wrapper the app uses) over a mocked `electron` and a
// temporary WORFY_DATA_DIR, and the store of src/main/layout/viewports.ts with a recorder for its
// writes. The camera is kept per machine in viewports.json, not in the Project's layout.json.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { Viewport } from '../../src/shared/layout/types'
import type { ViewportsFile } from '../../src/main/layout/viewports'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const ALPHA = 'alpha-0a1b2c3d'
const BETA = 'beta-0a1b2c3e'
const SAVED_IN_LAYOUT: Viewport = { x: -120, y: 48, zoom: 0.75 }

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const quitListeners: (() => void)[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, quitListeners, window }
})

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: () => void) => {
      if (event === 'will-quit') electron.quitListeners.push(listener)
    },
  },
  BrowserWindow: { getAllWindows: () => [electron.window], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let handlers: Map<string, Listener>

/** Loads src/main/ipc/layout.ts and src/main/ipc/viewport.ts afresh, as an app start does. */
async function start(): Promise<void> {
  vi.resetModules()
  electron.quitListeners.length = 0
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: {
        './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default),
        './viewport.ts': () => import('../../src/main/ipc/viewport').then((module) => module.default),
      },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
}

async function call(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: `file://${INDEX_HTML}` }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function value(channel: string, input?: unknown): Promise<unknown> {
  const result = await call(channel, input)
  if (!result.ok) throw new Error(`${channel} failed: ${result.error}`)
  return result.value
}

const cameraOf = (projectId: string) => value('viewport.get', { projectId })
const viewportsFile = () => join(dataDir, 'viewports.json')
const onDisk = (): ViewportsFile => JSON.parse(readFileSync(viewportsFile(), 'utf8')) as ViewportsFile
const layoutFile = (projectId: string) => join(dataDir, projectId, 'layout.json')
const quit = () => {
  for (const listener of electron.quitListeners) listener()
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-viewports-')))
  dataDir = join(scratch, 'data')
  const projects = [ALPHA, BETA].map((id) => {
    const path = join(scratch, id)
    mkdirSync(path)
    mkdirSync(join(dataDir, id), { recursive: true })
    return { id, name: id.split('-')[0] ?? id, path }
  })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects, activeId: ALPHA }))
  // ALPHA was saved by a worfy that kept the camera in the Layout; BETA has no layout.json.
  writeFileSync(layoutFile(ALPHA), JSON.stringify({ nodes: [], viewport: SAVED_IN_LAYOUT }))
  electron.sent.length = 0
  await start()
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.WORFY_DATA_DIR
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('viewport store: over IPC', () => {
  it('a Project without its own camera opens at the viewport of its layout.json, or at the default without one', async () => {
    expect(await cameraOf(ALPHA)).toEqual(SAVED_IN_LAYOUT)
    expect(await cameraOf(BETA)).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(existsSync(viewportsFile())).toBe(false)
  })

  it('viewport.set saves the camera in viewports.json; the Layout, its revision and layout.json stay as they were, and no window hears of it', async () => {
    const layoutBefore = readFileSync(layoutFile(ALPHA), 'utf8')
    const revisionBefore = ((await value('layout.get', { projectId: ALPHA })) as { revision: number }).revision
    const camera = { x: 300, y: -40, zoom: 1.5 }

    expect(await call('viewport.set', { projectId: ALPHA, viewport: camera })).toEqual({ ok: true, value: undefined })
    expect(await cameraOf(ALPHA)).toEqual(camera)
    expect(await cameraOf(BETA)).toEqual({ x: 0, y: 0, zoom: 1 })

    quit()
    expect(onDisk()).toEqual({ [ALPHA]: camera })
    const layoutAfter = (await value('layout.get', { projectId: ALPHA })) as { revision: number; layout: { viewport: Viewport } }
    expect(layoutAfter.revision).toBe(revisionBefore)
    expect(layoutAfter.layout.viewport).toEqual(SAVED_IN_LAYOUT)
    expect(readFileSync(layoutFile(ALPHA), 'utf8')).toBe(layoutBefore)
    expect(electron.sent).toEqual([])

    // A restarted main reads the camera back.
    await start()
    expect(await cameraOf(ALPHA)).toEqual(camera)
  })

  it.each([
    ['a zoom above 2.5', { x: 0, y: 0, zoom: 3 }],
    ['a zoom below 0.2', { x: 0, y: 0, zoom: 0.1 }],
    ['a string coordinate', { x: '1', y: 0, zoom: 1 }],
  ])('refuses %s, over IPC and from a direct call', async (_name, viewport) => {
    expect(await call('viewport.set', { projectId: ALPHA, viewport })).toEqual({ ok: false, error: expect.stringMatching(/viewport\.set: invalid input/) })
    const { viewportStore } = await import('../../src/main/layout/viewports')
    expect(() => viewportStore().set(ALPHA, viewport as Viewport)).toThrow(/invalid viewport/)
    expect(await cameraOf(ALPHA)).toEqual(SAVED_IN_LAYOUT)
    quit()
    expect(existsSync(viewportsFile())).toBe(false)
  })

  it('refuses a Project that is not in the list', async () => {
    expect(await call('viewport.get', { projectId: 'ghost-0a1b2c3f' })).toEqual({ ok: false, error: expect.stringMatching(/No Project with id ghost-0a1b2c3f/) })
    expect(await call('viewport.set', { projectId: 'ghost-0a1b2c3f', viewport: { x: 1, y: 1, zoom: 1 } })).toEqual({
      ok: false,
      error: expect.stringMatching(/No Project with id ghost-0a1b2c3f/),
    })
    quit()
    expect(existsSync(viewportsFile())).toBe(false)
  })

  it('a Project removed from the list loses its camera, in memory and in viewports.json', async () => {
    await value('viewport.set', { projectId: ALPHA, viewport: { x: 1, y: 2, zoom: 1 } })
    await value('viewport.set', { projectId: BETA, viewport: { x: 3, y: 4, zoom: 2 } })
    quit()
    expect(Object.keys(onDisk()).sort()).toEqual([ALPHA, BETA].sort())

    const { projectStore } = await import('../../src/main/projects/store')
    projectStore().remove(ALPHA)
    quit()
    expect(onDisk()).toEqual({ [BETA]: { x: 3, y: 4, zoom: 2 } })
    expect(await call('viewport.get', { projectId: ALPHA })).toEqual({ ok: false, error: expect.stringMatching(/No Project with id/) })
  })

  it('an entry of a Project that left the list while the app was not running is dropped on the first read', async () => {
    writeFileSync(viewportsFile(), JSON.stringify({ [BETA]: { x: 5, y: 6, zoom: 1 }, 'gone-0a1b2c40': { x: 7, y: 8, zoom: 1 } }))
    await start()
    expect(await cameraOf(BETA)).toEqual({ x: 5, y: 6, zoom: 1 })
    quit()
    expect(onDisk()).toEqual({ [BETA]: { x: 5, y: 6, zoom: 1 } })
  })
})

describe('viewport store: writes', () => {
  it('writes after a quiet period, once for a burst of pans, not again for the same camera, and right away on flush', async () => {
    vi.useFakeTimers()
    const { ViewportStore } = await import('../../src/main/layout/viewports')
    const { LAYOUT_SAVE_DELAY_MS } = await import('../../src/main/layout/store')
    const writes: { file: string; viewports: ViewportsFile }[] = []
    const local = new ViewportStore({
      file: viewportsFile(),
      projectIds: () => [ALPHA, BETA],
      fallback: () => SAVED_IN_LAYOUT,
      write: (file, viewports) => writes.push({ file, viewports }),
    })

    local.set(ALPHA, { x: 1, y: 1, zoom: 1 })
    vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS - 1)
    local.set(ALPHA, { x: 2, y: 2, zoom: 1 })
    vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS - 1)
    expect(writes).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(writes).toEqual([{ file: viewportsFile(), viewports: { [ALPHA]: { x: 2, y: 2, zoom: 1 } } }])

    // The same camera again (a click on the plane ends a "move" too): nothing to write.
    local.set(ALPHA, { x: 2, y: 2, zoom: 1 })
    vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS)
    expect(writes).toHaveLength(1)

    // flush() writes what is pending at once, and the timer then has nothing left.
    local.set(BETA, { x: 3, y: 3, zoom: 0.5 })
    local.flush()
    expect(writes.at(-1)?.viewports).toEqual({ [ALPHA]: { x: 2, y: 2, zoom: 1 }, [BETA]: { x: 3, y: 3, zoom: 0.5 } })
    vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS)
    local.flush()
    expect(writes).toHaveLength(2)
  })

  it('a failed write keeps the camera unsaved: the next flush writes it', async () => {
    const { ViewportStore } = await import('../../src/main/layout/viewports')
    const writes: ViewportsFile[] = []
    let failures = 1
    const local = new ViewportStore({
      file: viewportsFile(),
      projectIds: () => [ALPHA],
      fallback: () => SAVED_IN_LAYOUT,
      write: (_file, viewports) => {
        if (failures > 0) {
          failures -= 1
          throw new Error('ENOSPC: no space left on device')
        }
        writes.push(viewports)
      },
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      local.set(ALPHA, { x: 9, y: 9, zoom: 1 })
      local.flush()
      expect(writes).toHaveLength(0)
      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/could not save the cameras/), expect.any(Error))
      local.flush()
      expect(writes).toEqual([{ [ALPHA]: { x: 9, y: 9, zoom: 1 } }])
    } finally {
      logged.mockRestore()
    }
  })
})

describe('viewport store: Projects of Linked machines (worfy-link ticket 09)', () => {
  const M = '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11'

  it("keeps the camera of M's Project apart from this machine's Project with the same id, and has none before the first pan", async () => {
    const { ViewportStore } = await import('../../src/main/layout/viewports')
    const writes: ViewportsFile[] = []
    const local = new ViewportStore({ file: viewportsFile(), projectIds: () => [ALPHA], fallback: () => SAVED_IN_LAYOUT, write: (_file, viewports) => writes.push(viewports) })
    // M's Layout is on M: nothing to fall back on here.
    expect(local.get(ALPHA, M)).toBeNull()
    local.set(ALPHA, { x: 5, y: 5, zoom: 1 }, M)
    local.set(ALPHA, { x: 7, y: 7, zoom: 0.5 })
    expect(local.get(ALPHA, M)).toEqual({ x: 5, y: 5, zoom: 1 })
    expect(local.get(ALPHA)).toEqual({ x: 7, y: 7, zoom: 0.5 })
    // An id this machine does not list is fine for M: its list is not here.
    local.set(BETA, { x: 1, y: 2, zoom: 1 }, M)
    expect(local.get(BETA, M)).toEqual({ x: 1, y: 2, zoom: 1 })
    expect(() => local.get(BETA)).toThrow(/No Project/)
    local.flush()
    expect(writes.at(-1)).toEqual({ [`${M}/${ALPHA}`]: { x: 5, y: 5, zoom: 1 }, [ALPHA]: { x: 7, y: 7, zoom: 0.5 }, [`${M}/${BETA}`]: { x: 1, y: 2, zoom: 1 } })
  })

  it("a change of this machine's list does not wipe the cameras of a Linked machine's Projects", async () => {
    const { ViewportStore } = await import('../../src/main/layout/viewports')
    let listed = [ALPHA]
    const local = new ViewportStore({ file: viewportsFile(), projectIds: () => listed, fallback: () => SAVED_IN_LAYOUT, write: () => undefined })
    local.set(ALPHA, { x: 5, y: 5, zoom: 1 }, M)
    local.set(ALPHA, { x: 7, y: 7, zoom: 0.5 })
    listed = []
    local.prune()
    expect(local.get(ALPHA, M)).toEqual({ x: 5, y: 5, zoom: 1 })
    listed = [ALPHA]
    expect(local.get(ALPHA)).toEqual(SAVED_IN_LAYOUT)
  })
})
