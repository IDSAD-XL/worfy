// The Auto-continue setting of a Project (worfy-retry ticket 02): `autoContinue` of app-settings.json
// in worfy's data folder (src/main/settings/store.ts, ADR-0005) and the `autoContinue` IPC domain
// (src/main/ipc/auto-continue.ts) over a mocked `electron` and a temporary WORFY_DATA_DIR. No entry —
// off; anything outside the schema — off; on writes the Project's entry, off removes it, and a write of
// one Project leaves every other Project and every other setting as it was. A file of an older worfy
// without the field reads as off everywhere. Every window of this Machine hears a change at once
// (`autoContinue.changed`). A Linked machine with full access reads and sets it through the link, with
// read-only access it only reads it (worfy-retry ticket 13).
// autoContinueOn(projectId) is the reader of main for the retry of tickets 04–06.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { projectId } from '../../src/main/projects/store'
import { APP_SETTINGS_FILE, AppSettingsStore, autoContinueOn } from '../../src/main/settings/store'
import type { ContinueWait } from '../../src/main/agent/orchestrator-continue'
import type { ContinueWaits, ManualWaits } from '../../src/main/ipc/auto-continue'
import type { LimitWindow } from '../../src/shared/agent/limits'
import {
  autoContinueCancel,
  autoContinueChanged,
  autoContinueRead,
  autoContinueRetryNow,
  autoContinueSet,
  autoContinueWait,
  autoContinueWaitChanged,
} from '../../src/shared/ipc/auto-continue'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { appSettingsSchema, autoContinueOf, DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/shared/settings/app-settings'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the store of the running app sits over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-auto-continue-setting-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

const electron = vi.hoisted(() => ({ sent: [] as { channel: string; payload: unknown }[] }))
vi.mock('electron', () => ({
  app: { commandLine: { hasSwitch: () => false } },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) } }] },
}))

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const STRANGER = 'gamma-0000000c'
const LINKED = '55555555-5555-4555-8555-555555555555'

const folders: string[] = []

/** A fresh folder with its own app-settings.json path, for a store of its own. */
function freshFile(content?: unknown): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-auto-continue-store-')))
  folders.push(folder)
  const file = join(folder, APP_SETTINGS_FILE)
  if (content !== undefined) writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
  return file
}

afterAll(() => {
  for (const folder of folders.splice(0)) removeTestTree(folder)
  removeTestTree(env.scratch)
})

beforeEach(() => {
  electron.sent.length = 0
})

/** Everything but Auto-continue and the revision. */
const rest = (settings: AppSettings) => Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'autoContinue' && key !== 'revision'))

describe('autoContinue in app-settings.json', () => {
  it('no file: off for every Project, and nothing written to say so', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(store.autoContinue(ALPHA)).toBe(false)
    expect(store.get()).toStrictEqual(DEFAULT_APP_SETTINGS)
    expect(autoContinueOf(store.get(), ALPHA)).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('a file of an older worfy without the field: off everywhere, the other settings as written', () => {
    const store = new AppSettingsStore(freshFile({ interfaceScale: 1.2, memoryIndicator: false, autoApproval: { [ALPHA]: 'on' }, revision: 4 }))
    expect(store.autoContinue(ALPHA)).toBe(false)
    expect(store.autoContinue(BETA)).toBe(false)
    expect(store.get()).toMatchObject({ interfaceScale: 1.2, memoryIndicator: false, autoApproval: { [ALPHA]: 'on' }, revision: 4 })
    expect(store.get().autoContinue).toBeUndefined()
  })

  it('reads on as written, per Project', () => {
    const store = new AppSettingsStore(freshFile({ autoContinue: { [ALPHA]: true }, revision: 2 }))
    expect([store.autoContinue(ALPHA), store.autoContinue(BETA)]).toEqual([true, false])
  })

  it('garbage reads as off: a value other than true, a key that is no Project id, a field that is not a record; the rest of the file stays', () => {
    const garbage: unknown[] = [true, 'on', 7, null, [ALPHA], { [ALPHA]: 'true' }, { [ALPHA]: 1 }, { [ALPHA]: false }, { [ALPHA]: { on: true } }, { 'not-a-project': true }]
    for (const autoContinue of garbage) {
      const store = new AppSettingsStore(freshFile(`{"interfaceScale":1.3,"autoContinue":${JSON.stringify(autoContinue) ?? 'null'},"revision":1}`))
      expect(store.autoContinue(ALPHA), JSON.stringify(autoContinue)).toBe(false)
      expect(store.autoContinue('__proto__'), JSON.stringify(autoContinue)).toBe(false)
      expect(store.get().interfaceScale, JSON.stringify(autoContinue)).toBe(1.3)
      expect(store.get().autoContinue, JSON.stringify(autoContinue)).toBeUndefined()
    }
    // A raw `__proto__` key of JSON is dropped too, and pollutes nothing.
    const store = new AppSettingsStore(freshFile(`{"autoContinue":{"__proto__":true,"${ALPHA}":true,"${BETA}":"yes"}}`))
    expect(store.get().autoContinue).toStrictEqual({ [ALPHA]: true })
    expect(store.autoContinue(BETA)).toBe(false)
    expect(({} as Record<string, unknown>).toString).toBe(Object.prototype.toString)
  })

  it('a Project the state does not know reads as off, also through the prototype', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, autoContinue: { [ALPHA]: true as const } }
    expect(autoContinueOf(settings, ALPHA)).toBe(true)
    expect(autoContinueOf(settings, 'toString')).toBe(false)
    expect(autoContinueOf(settings, 'constructor')).toBe(false)
    expect(autoContinueOf(DEFAULT_APP_SETTINGS, ALPHA)).toBe(false)
  })

  it('on writes the entry of the Project, off removes it; the other Projects and every other setting stay as they were', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    // Every field off its default, so a write that resets one to the default shows.
    store.set({ interfaceScale: 1.2, sidebar: { collapsed: { MachinesSection: true }, visible: { focus: false } }, autoCompactWindow: { orchestrator: 300_000, other: null }, memoryIndicator: false, autoUpdate: false, sessionArchive: { after: '3d' }, browserSleep: { maxLive: 5 }, autopilotBudget: { enabled: true }, autopilotRun: { mode: 'fastest' }, guideLanguage: 'ru' })
    store.setAutoApproval(ALPHA, 'shadow')
    const before = store.get()
    const beta = store.setAutoContinue(BETA, true)
    expect(beta.autoContinue).toStrictEqual({ [BETA]: true })
    expect(rest(beta)).toStrictEqual(rest(before))
    const both = store.setAutoContinue(ALPHA, true)
    expect(both.autoContinue).toStrictEqual({ [ALPHA]: true, [BETA]: true })
    expect(rest(both)).toStrictEqual(rest(before))
    expect(both.revision).toBe(before.revision + 2)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(both)
    // A restart is a new store over the same file: the state is the same.
    expect(new AppSettingsStore(file).get()).toStrictEqual(both)
    expect(new AppSettingsStore(file).autoContinue(ALPHA)).toBe(true)

    const off = store.setAutoContinue(BETA, false)
    expect(off.autoContinue).toStrictEqual({ [ALPHA]: true })
    expect(rest(off)).toStrictEqual(rest(before))
    store.setAutoContinue(ALPHA, false)
    expect(store.get().autoContinue).toBeUndefined()
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('autoContinue')
    expect(store.get().autoApproval).toStrictEqual({ [ALPHA]: 'shadow' })
  })

  it('a write that changes nothing writes nothing, announces nothing and keeps the revision', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    store.setAutoContinue(ALPHA, true)
    const events: AppSettings[] = []
    store.on('changed', (state) => events.push(state))
    const before = readFileSync(file, 'utf8')
    expect(store.setAutoContinue(ALPHA, true).revision).toBe(1)
    expect(store.setAutoContinue(BETA, false).revision).toBe(1)
    expect(events).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('other settings changed later keep the setting, and a change through appSettings.set cannot carry it', () => {
    const store = new AppSettingsStore(freshFile())
    store.setAutoContinue(ALPHA, true)
    store.set({ interfaceScale: 1.4, autopilotRun: { mode: 'fastest' } })
    store.setAutoApproval(BETA, 'on')
    expect(store.get().autoContinue).toStrictEqual({ [ALPHA]: true })
    store.set({ interfaceScale: 1.1, autoContinue: { [BETA]: true } } as never)
    expect(store.autoContinue(BETA)).toBe(false)
  })

  it('refuses an id that is no Project id and a value that is not a boolean; nothing written', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(() => store.setAutoContinue('__proto__', true)).toThrow()
    expect(() => store.setAutoContinue(ALPHA, 'yes' as never)).toThrow()
    expect(existsSync(file)).toBe(false)
  })

  it('every id projectId() makes is a key the setting keeps', () => {
    for (const root of ['/tmp/demo', '/tmp/demo folder', 'C:/work/Проект', '/', '/tmp/__proto__']) {
      const id = projectId(root)
      const store = new AppSettingsStore(freshFile())
      store.setAutoContinue(id, true)
      expect(store.autoContinue(id), id).toBe(true)
    }
  })

  it('the schema of the state takes only true as a value', () => {
    expect(appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, autoContinue: { [ALPHA]: true } }).success).toBe(true)
    expect(appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, autoContinue: { [ALPHA]: false } }).success).toBe(false)
  })
})

// ── the IPC domain ───────────────────────────────────────────────────────────────────────────────

const dataFile = join(env.scratch, 'data', APP_SETTINGS_FILE)

const projects = () => [{ id: ALPHA }, { id: BETA }]

async function handlerModule() {
  const { autoContinueHandlers } = await import('../../src/main/ipc/auto-continue')
  return autoContinueHandlers({ projects })
}

const loadModule: ModuleLoader = async () => handlerModule()

/** The handlers as the app's windows reach them. */
async function windowCaller(): Promise<(channel: string, input?: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { modules: { './auto-continue.ts': loadModule }, isTrustedSender: () => true })
  const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
  return async (channel, input) => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

const changes = () => electron.sent.filter((sent) => sent.channel === `${IPC_CHANNEL_PREFIX}autoContinue.changed`).map((sent) => sent.payload)

describe('autoContinue channels', () => {
  it('read answers off for a Project with no entry; set writes app-settings.json of the data folder, answers the setting and tells every window', async () => {
    const call = await windowCaller()
    expect(await call('autoContinue.read', { projectId: ALPHA })).toEqual({ ok: true, value: { on: false } })
    expect(await call('autoContinue.set', { projectId: ALPHA, on: true })).toEqual({ ok: true, value: { on: true } })
    expect(await call('autoContinue.read', { projectId: ALPHA })).toEqual({ ok: true, value: { on: true } })
    expect(await call('autoContinue.read', { projectId: BETA })).toEqual({ ok: true, value: { on: false } })
    expect(JSON.parse(readFileSync(dataFile, 'utf8')).autoContinue).toStrictEqual({ [ALPHA]: true })
    expect(changes()).toEqual([{ projectId: ALPHA, on: true }])

    expect(await call('autoContinue.set', { projectId: ALPHA, on: false })).toEqual({ ok: true, value: { on: false } })
    expect(JSON.parse(readFileSync(dataFile, 'utf8'))).not.toHaveProperty('autoContinue')
    expect(changes()).toEqual([
      { projectId: ALPHA, on: true },
      { projectId: ALPHA, on: false },
    ])
    // A write that changes nothing tells nobody.
    await call('autoContinue.set', { projectId: ALPHA, on: false })
    expect(changes()).toHaveLength(2)
  })

  it('autoContinueOn(projectId) — the reader of main for the retry — answers what the menu wrote, off without an entry', async () => {
    const call = await windowCaller()
    await call('autoContinue.set', { projectId: BETA, on: true })
    expect(autoContinueOn(BETA)).toBe(true)
    expect(autoContinueOn(ALPHA)).toBe(false)
    expect(autoContinueOn(STRANGER)).toBe(false)
    await call('autoContinue.set', { projectId: BETA, on: false })
    expect(autoContinueOn(BETA)).toBe(false)
  })

  it('a Project that is not one of this Machine: refused, nothing written, nobody told', async () => {
    const call = await windowCaller()
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await call('autoContinue.set', { projectId: STRANGER, on: true })).toMatchObject({ ok: false, error: expect.stringMatching(/not a Project of this Machine/u) })
    expect(await call('autoContinue.read', { projectId: STRANGER })).toMatchObject({ ok: false, error: expect.stringMatching(/not a Project of this Machine/u) })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
    expect(changes()).toEqual([])
  })

  it('an input outside the schema is refused before the handler', async () => {
    const call = await windowCaller()
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await call('autoContinue.set', { projectId: ALPHA, on: 'yes' })).toMatchObject({ ok: false })
    expect(await call('autoContinue.set', { on: true })).toMatchObject({ ok: false })
    expect(await call('autoContinue.set', { projectId: '__proto__', on: true })).toMatchObject({ ok: false })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
  })
})

// worfy-retry ticket 13: a Linked machine with full access sets the setting, with read-only access it
// only reads it and hears its changes. The whole flow over two Machines is test/contract/modes-linked.test.ts.
describe('autoContinue and a Linked machine', () => {
  it('the read and the change are `project` and `read`, the write `project` and `write`', () => {
    expect([autoContinueRead.access, autoContinueRead.use]).toEqual(['project', 'read'])
    expect([autoContinueSet.access, autoContinueSet.use]).toEqual(['project', 'write'])
    expect([autoContinueChanged.access, autoContinueChanged.use]).toEqual(['project', 'read'])
  })

  it('the link adapter registers the read and the write; read-only access reads, and its write is refused with nothing written', async () => {
    const modules: Record<string, ModuleLoader> = { './auto-continue.ts': loadModule }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    expect([...adapter.channels()].sort()).toEqual(['autoContinue.cancel', 'autoContinue.read', 'autoContinue.retryNow', 'autoContinue.set', 'autoContinue.wait'])

    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('read')
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await adapter.call(peer, 'autoContinue.read', { projectId: ALPHA }, 'Beta')).toEqual({ ok: true, value: { on: autoContinueOn(ALPHA) } })
    expect(await adapter.call(peer, 'autoContinue.set', { projectId: ALPHA, on: !autoContinueOn(ALPHA) }, 'Beta')).toEqual({ ok: false, error: readOnlyRefusal('Beta') })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
  })
})

// worfy-retry ticket 07: the wait for the countdown over the Orchestrator's input field, and its buttons.
// The sources are the test's: the waits of the Autopilot runs and of the manual turns, as
// test/contract/autopilot-retry.test.ts and test/contract/orchestrator-continue.test.ts check them.
describe('the wait of the Orchestrator and its buttons (worfy-retry ticket 07)', () => {
  const MINUTE = 60_000
  const AT = 1_791_180_600_000

  function sources() {
    const run = new Map<string, ContinueWait>()
    const manual = new Map<string, ContinueWait>()
    const calls: string[] = []
    const listeners = new Set<(projectId: string) => void>()
    const runs: ContinueWaits = {
      wait: (projectId) => run.get(projectId) ?? null,
      retryNow: (projectId) => {
        calls.push(`run.retryNow ${projectId}`)
        return Promise.resolve(true)
      },
      cancel: (projectId) => {
        calls.push(`run.cancel ${projectId}`)
        return Promise.resolve(true)
      },
    }
    const manualWaits: ManualWaits = {
      wait: (projectId) => manual.get(projectId) ?? null,
      retryNow: (projectId) => {
        calls.push(`manual.retryNow ${projectId}`)
        return true
      },
      cancel: (projectId) => {
        calls.push(`manual.cancel ${projectId}`)
        return true
      },
      observeWaits: (listener) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    }
    // A Codex window as its driver labels it (src/main/vendors/codex/limits.ts).
    const windows = [{ vendor: 'codex', id: 'secondary', label: 'weekly' } as LimitWindow]
    const module = async () => {
      const { autoContinueHandlers } = await import('../../src/main/ipc/auto-continue')
      return autoContinueHandlers({ projects, runs: () => Promise.resolve(runs), manual: () => Promise.resolve(manualWaits), windows: () => Promise.resolve(windows) })
    }
    return { run, manual, calls, listeners, module }
  }

  async function caller(s: ReturnType<typeof sources>) {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { modules: { './auto-continue.ts': s.module }, isTrustedSender: () => true })
    const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
    return async (channel: string, input?: unknown): Promise<IpcResult<unknown>> => (await handlers.get(IPC_CHANNEL_PREFIX + channel)!(event, input)) as IpcResult<unknown>
  }

  const waitChanges = () => electron.sent.filter((sent) => sent.channel === `${IPC_CHANNEL_PREFIX}autoContinue.waitChanged`).map((sent) => sent.payload)

  it("read: null while nothing waits; a manual turn's retry; a run's wait before a manual one; the window by its label", async () => {
    const s = sources()
    const call = await caller(s)
    expect(await call('autoContinue.wait', { projectId: ALPHA })).toEqual({ ok: true, value: null })

    s.manual.set(ALPHA, { kind: 'retry', attempt: 2, of: 5, error: 'overloaded', until: AT + 4 * MINUTE })
    expect(await call('autoContinue.wait', { projectId: ALPHA })).toEqual({ ok: true, value: { kind: 'retry', attempt: 2, of: 5, error: 'overloaded', at: AT + 4 * MINUTE, source: 'manual' } })

    s.run.set(ALPHA, { kind: 'limits', window: 'seven_day', until: AT + 120 * MINUTE })
    expect(await call('autoContinue.wait', { projectId: ALPHA })).toEqual({ ok: true, value: { kind: 'limits', window: '7-day', at: AT + 120 * MINUTE, source: 'run' } })
    s.run.set(ALPHA, { kind: 'limits', window: 'secondary', until: AT })
    expect(await call('autoContinue.wait', { projectId: ALPHA })).toMatchObject({ ok: true, value: { window: 'weekly' } })
    s.run.set(ALPHA, { kind: 'limits', window: null, until: AT + 30 * MINUTE })
    expect(await call('autoContinue.wait', { projectId: ALPHA })).toEqual({ ok: true, value: { kind: 'limits', window: null, at: AT + 30 * MINUTE, source: 'run' } })
    expect(await call('autoContinue.wait', { projectId: BETA })).toEqual({ ok: true, value: null })
    expect(await call('autoContinue.wait', { projectId: STRANGER })).toMatchObject({ ok: false, error: expect.stringMatching(/not a Project of this Machine/u) })
  })

  it("the window's label: the one a Vendor's known window has, else Claude's by the name's start, else the name with spaces", async () => {
    const { windowLabel } = await import('../../src/main/ipc/auto-continue')
    const codex = [{ vendor: 'codex', id: 'primary', label: '5h' } as LimitWindow]
    expect(windowLabel('five_hour', [])).toBe('5-hour')
    expect(windowLabel('seven_day', [])).toBe('7-day')
    expect(windowLabel('seven_day_opus', [])).toBe('7-day opus')
    expect(windowLabel('overage', [])).toBe('overage')
    expect(windowLabel('some_window', [])).toBe('some window')
    expect(windowLabel('primary', codex)).toBe('5h')
  })

  it('Retry now goes to whoever waits — the run first — and only for a retry; Cancel to whoever waits; nothing waits — nothing done', async () => {
    const s = sources()
    const call = await caller(s)
    expect(await call('autoContinue.retryNow', { projectId: ALPHA })).toEqual({ ok: true, value: { done: false } })
    expect(s.calls).toEqual([])

    s.manual.set(ALPHA, { kind: 'retry', attempt: 1, of: 5, error: 'api-500', until: AT })
    expect(await call('autoContinue.retryNow', { projectId: ALPHA })).toEqual({ ok: true, value: { done: true } })
    expect(await call('autoContinue.cancel', { projectId: ALPHA })).toEqual({ ok: true, value: { done: true } })
    expect(s.calls).toEqual([`manual.retryNow ${ALPHA}`, `manual.cancel ${ALPHA}`])

    s.run.set(ALPHA, { kind: 'retry', attempt: 3, of: 5, error: 'connection', until: AT })
    expect(await call('autoContinue.retryNow', { projectId: ALPHA })).toEqual({ ok: true, value: { done: true } })
    expect(await call('autoContinue.cancel', { projectId: ALPHA })).toEqual({ ok: true, value: { done: true } })
    expect(s.calls.slice(2)).toEqual([`run.retryNow ${ALPHA}`, `run.cancel ${ALPHA}`])

    // A Limits wait has only Cancel.
    s.run.set(ALPHA, { kind: 'limits', window: 'seven_day', until: AT })
    expect(await call('autoContinue.retryNow', { projectId: ALPHA })).toEqual({ ok: true, value: { done: false } })
    expect(s.calls).toHaveLength(4)
    expect(await call('autoContinue.cancel', { projectId: STRANGER })).toMatchObject({ ok: false })
    expect(await call('autoContinue.retryNow', { projectId: STRANGER })).toMatchObject({ ok: false })
    expect(s.calls).toHaveLength(4)
  })

  it('a change of a manual wait reaches every window with the wait as it is now, from the first read on', async () => {
    const s = sources()
    const call = await caller(s)
    expect(s.listeners.size).toBe(0)
    await call('autoContinue.wait', { projectId: ALPHA })
    await call('autoContinue.wait', { projectId: BETA })
    expect(s.listeners.size).toBe(1)

    s.manual.set(ALPHA, { kind: 'limits', window: 'five_hour', until: AT })
    for (const listener of s.listeners) listener(ALPHA)
    await vi.waitFor(() => expect(waitChanges()).toHaveLength(1))
    expect(waitChanges()).toEqual([{ projectId: ALPHA, wait: { kind: 'limits', window: '5-hour', at: AT, source: 'manual' } }])
    s.manual.delete(ALPHA)
    for (const listener of s.listeners) listener(ALPHA)
    await vi.waitFor(() => expect(waitChanges()).toHaveLength(2))
    expect(waitChanges()[1]).toEqual({ projectId: ALPHA, wait: null })
  })

  it('the wait and its change are `project` and `read`, Retry now and Cancel `project` and `write`: read-only access reads the wait, its buttons are refused', async () => {
    expect([autoContinueWait.access, autoContinueWait.use]).toEqual(['project', 'read'])
    expect([autoContinueWaitChanged.access, autoContinueWaitChanged.use]).toEqual(['project', 'read'])
    expect([autoContinueRetryNow.access, autoContinueRetryNow.use]).toEqual(['project', 'write'])
    expect([autoContinueCancel.access, autoContinueCancel.use]).toEqual(['project', 'write'])

    const s = sources()
    s.manual.set(ALPHA, { kind: 'retry', attempt: 1, of: 5, error: 'api-500', until: AT })
    const adapter = await createLinkIpc({ modules: { './auto-continue.ts': s.module }, isLinked: (id) => id === LINKED })
    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('read')
    expect(await adapter.call(peer, 'autoContinue.wait', { projectId: ALPHA }, 'Beta')).toMatchObject({ ok: true, value: { kind: 'retry', source: 'manual' } })
    expect(await adapter.call(peer, 'autoContinue.retryNow', { projectId: ALPHA }, 'Beta')).toEqual({ ok: false, error: readOnlyRefusal('Beta') })
    expect(await adapter.call(peer, 'autoContinue.cancel', { projectId: ALPHA }, 'Beta')).toEqual({ ok: false, error: readOnlyRefusal('Beta') })
    expect(s.calls).toEqual([])
  })
})
