// The record of a process that ended (src/main/diagnostics/process-gone.ts): Electron's
// `render-process-gone` and `child-process-gone` events each become one JSON line in
// <data root>/logs/process-gone.jsonl. Before it a crashed renderer left an empty window and nothing
// else. The line holds the time, the kind of process, the reason and the exit code — never a path,
// a URL or any text of a Session.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessGoneDeps } from '../../src/main/diagnostics/process-gone'
import { dataRoot } from '../../src/main/storage/paths'

type Listener = (...args: unknown[]) => void

const electron = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    listeners,
    on: (event: string, listener: (...args: unknown[]) => void): void => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    createMainWindow: vi.fn(),
  }
})

// Enough of Electron for src/main/index.ts to run its start (as in test/contract/main-ipc-wiring.test.ts).
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    setPath: vi.fn(),
    whenReady: () => Promise.resolve(),
    on: electron.on,
    exit: vi.fn(),
    getVersion: () => '1.2.3',
    // The start names the app to Windows before the first window; the other systems never call it.
    setAppUserModelId: vi.fn(),
  },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

vi.mock('../../src/main/window', () => ({
  createMainWindow: electron.createMainWindow,
  installWebPolicy: vi.fn(),
  rendererEntry: () => ({ indexHtml: '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html', devServerUrl: undefined }),
}))

vi.mock('../../src/main/link/service', () => ({
  startAppLink: () => Promise.resolve({}),
  appLinkService: () => undefined,
  appLinkProblem: () => 'the link service is replaced in this test',
  onAppLinkStart: () => () => undefined,
  stopLinkOnQuit: vi.fn(),
}))

const { installProcessGone, processGoneLogPath } = await import('../../src/main/diagnostics/process-gone')

const scratch = mkdtempSync(join(tmpdir(), 'worfy-process-gone-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

let cases = 0
/** A fake `app` that keeps its listeners, and a log file in a folder that does not exist yet. */
function setup(file?: string) {
  const listeners = new Map<string, Listener>()
  const app = {
    on: (event: string, listener: Listener): void => {
      listeners.set(event, listener)
    },
  } as unknown as ProcessGoneDeps['app']
  cases += 1
  const log = file ?? join(scratch, `case-${cases}`, 'logs', 'process-gone.jsonl')
  let tick = 0
  installProcessGone({ app, file: () => log, now: () => new Date(Date.UTC(2026, 9, 10, 12, 0, tick++)) })
  const emit = (event: string, ...args: unknown[]): void => {
    const listener = listeners.get(event)
    if (!listener) throw new Error(`no listener for ${event}`)
    listener({}, ...args)
  }
  const lines = (): unknown[] =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as unknown)
  return { emit, lines, log }
}

/** What Electron passes as the window's webContents; the record must take nothing from it. */
const window = (url: string) => ({ getURL: () => url, getTitle: () => `title of ${url}` })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installProcessGone', () => {
  it('writes one line when the process of a window ends: the time, the kind, the reason and the exit code', () => {
    const { emit, lines } = setup()
    emit('render-process-gone', window('file:///Applications/worfy.app/Contents/Resources/app.asar/out/renderer/index.html'), { reason: 'crashed', exitCode: 11 })
    expect(lines()).toEqual([{ time: '2026-10-10T12:00:00.000Z', process: 'renderer', reason: 'crashed', exitCode: 11 }])
  })

  it('writes one line when a child process ends: its type, its service, the reason and the exit code', () => {
    const { emit, lines } = setup()
    emit('child-process-gone', { type: 'GPU', reason: 'killed', exitCode: 9 })
    emit('child-process-gone', { type: 'Utility', reason: 'oom', exitCode: -1, serviceName: 'network.mojom.NetworkService', name: 'Network Service' })
    expect(lines()).toEqual([
      { time: '2026-10-10T12:00:00.000Z', process: 'GPU', reason: 'killed', exitCode: 9 },
      { time: '2026-10-10T12:00:01.000Z', process: 'Utility', reason: 'oom', exitCode: -1, service: 'network.mojom.NetworkService' },
    ])
  })

  it('appends: a later event adds a line and keeps the earlier ones, each line valid JSON on its own', () => {
    const { emit, lines, log } = setup()
    emit('render-process-gone', window('http://localhost:5173/'), { reason: 'oom', exitCode: 137 })
    emit('child-process-gone', { type: 'GPU', reason: 'crashed', exitCode: 5 })
    emit('render-process-gone', window('http://localhost:5173/'), { reason: 'killed', exitCode: 15 })
    expect(lines()).toEqual([
      { time: '2026-10-10T12:00:00.000Z', process: 'renderer', reason: 'oom', exitCode: 137 },
      { time: '2026-10-10T12:00:01.000Z', process: 'GPU', reason: 'crashed', exitCode: 5 },
      { time: '2026-10-10T12:00:02.000Z', process: 'renderer', reason: 'killed', exitCode: 15 },
    ])
    expect(readFileSync(log, 'utf8').endsWith('\n')).toBe(true)
  })

  it('keeps the URL of the window and anything else Electron sends out of the file', () => {
    const { emit, log } = setup()
    const secret = 'sk-ant-secret-token'
    emit('render-process-gone', window(`file:///Users/someone/Secret%20Project/index.html?token=${secret}#/Users/someone/notes`), {
      reason: 'crashed',
      exitCode: 11,
      // Not fields of Electron's event today; a later version adding one must not put it into the file.
      url: `https://example.com/${secret}`,
      message: `the Session said ${secret}`,
    })
    emit('child-process-gone', { type: 'Utility', reason: 'crashed', exitCode: 1, serviceName: 'node.mojom.NodeService', name: `/Users/someone/${secret}`, args: [secret] })
    const text = readFileSync(log, 'utf8')
    expect(text).not.toContain(secret)
    expect(text).not.toContain('someone')
    expect(text).not.toContain('Secret')
    const keys = text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => Object.keys(JSON.parse(line) as object))
    expect(keys).toEqual([
      ['time', 'process', 'reason', 'exitCode'],
      ['time', 'process', 'reason', 'exitCode', 'service'],
    ])
  })

  it('writes a value that is not what Electron documents as a short word, never a path or an object', () => {
    const { emit, lines } = setup()
    emit('child-process-gone', { type: { toString: () => 'object' }, reason: undefined, exitCode: 'seven', serviceName: 42 })
    emit('child-process-gone', { type: 'x'.repeat(500), reason: '/Users/someone/Secret Project\nsecond line', exitCode: 1.5, serviceName: 'C:\\Users\\someone' })
    expect(lines()).toEqual([
      { time: '2026-10-10T12:00:00.000Z', process: 'unknown', reason: 'unknown', exitCode: null },
      { time: '2026-10-10T12:00:01.000Z', process: 'x'.repeat(80), reason: '?Users?someone?Secret Project?second line', exitCode: null, service: 'C??Users?someone' },
    ])
  })

  it('a write that fails goes to console.error with the record, and nothing is thrown', () => {
    // `logs` cannot be created under a regular file.
    const blocker = join(scratch, 'a-file')
    writeFileSync(blocker, '')
    const { emit } = setup(join(blocker, 'logs', 'process-gone.jsonl'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => emit('render-process-gone', window('file:///x/index.html'), { reason: 'crashed', exitCode: 11 })).not.toThrow()
    expect(() => emit('child-process-gone', { type: 'GPU', reason: 'killed', exitCode: 9 })).not.toThrow()
    expect(error).toHaveBeenCalledTimes(2)
    const [first, second] = error.mock.calls.map(([message]) => String(message))
    expect(first).toContain('[worfy] could not record a process that ended')
    expect(first).toContain('"process":"renderer","reason":"crashed","exitCode":11')
    expect(second).toContain('"process":"GPU","reason":"killed","exitCode":9')
  })

  it('an event without details is still one line, and nothing is thrown', () => {
    const { emit, lines } = setup()
    expect(() => emit('render-process-gone', undefined, undefined)).not.toThrow()
    expect(() => emit('child-process-gone', null)).not.toThrow()
    expect(lines()).toEqual([
      { time: '2026-10-10T12:00:00.000Z', process: 'renderer', reason: 'unknown', exitCode: null },
      { time: '2026-10-10T12:00:01.000Z', process: 'unknown', reason: 'unknown', exitCode: null },
    ])
  })

  it('creates nothing until a process ends: installing it only subscribes', () => {
    const { log } = setup()
    expect(existsSync(join(log, '..'))).toBe(false)
  })
})

describe('processGoneLogPath', () => {
  it("is logs/process-gone.jsonl in worfy's data folder", () => {
    expect(processGoneLogPath('/data/worfy')).toBe(join('/data/worfy', 'logs', 'process-gone.jsonl'))
    expect(processGoneLogPath()).toBe(join(dataRoot(), 'logs', 'process-gone.jsonl'))
  })
})

describe('the start in src/main/index.ts', () => {
  // The import runs the whole start of the main process over mocked Electron, so it gets the time
  // limit of the contract tests that do the same.
  it('subscribes to both events before the first window, and their lines land in the data folder', { timeout: 15_000 }, async () => {
    const dataDir = join(scratch, 'start-data')
    const claudeDir = join(scratch, 'start-claude')
    const previous = { data: process.env.WORFY_DATA_DIR, claude: process.env.WORFY_CLAUDE_HOME }
    process.env.WORFY_DATA_DIR = dataDir
    process.env.WORFY_CLAUDE_HOME = claudeDir
    try {
      let listenersAtWindow: string[] = []
      electron.createMainWindow.mockImplementation(() => {
        listenersAtWindow = [...electron.listeners.keys()]
      })
      await import('../../src/main/index')
      await vi.waitFor(() => expect(electron.createMainWindow).toHaveBeenCalled(), { timeout: 10_000 })
      expect(listenersAtWindow).toEqual(expect.arrayContaining(['render-process-gone', 'child-process-gone']))
      expect(electron.listeners.get('render-process-gone')).toHaveLength(1)
      expect(electron.listeners.get('child-process-gone')).toHaveLength(1)

      electron.listeners.get('render-process-gone')?.[0]?.({}, window('file:///Applications/worfy.app/index.html'), { reason: 'crashed', exitCode: 11 })
      electron.listeners.get('child-process-gone')?.[0]?.({}, { type: 'GPU', reason: 'killed', exitCode: 9 })
      const written = readFileSync(join(dataDir, 'logs', 'process-gone.jsonl'), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(written).toMatchObject([
        { process: 'renderer', reason: 'crashed', exitCode: 11 },
        { process: 'GPU', reason: 'killed', exitCode: 9 },
      ])
      expect(Number.isNaN(Date.parse(String(written[0]?.time)))).toBe(false)
    } finally {
      if (previous.data === undefined) delete process.env.WORFY_DATA_DIR
      else process.env.WORFY_DATA_DIR = previous.data
      if (previous.claude === undefined) delete process.env.WORFY_CLAUDE_HOME
      else process.env.WORFY_CLAUDE_HOME = previous.claude
    }
  })
})
