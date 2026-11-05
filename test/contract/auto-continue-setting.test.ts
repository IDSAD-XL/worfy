// The Auto-continue setting of a Project (worfy-retry ticket 02): `autoContinue` of app-settings.json
// in worfy's data folder (src/main/settings/store.ts, ADR-0005) and the `autoContinue` IPC domain
// (src/main/ipc/auto-continue.ts) over a mocked `electron` and a temporary WORFY_DATA_DIR. No entry —
// off; anything outside the schema — off; on writes the Project's entry, off removes it, and a write of
// one Project leaves every other Project and every other setting as it was. A file of an older worfy
// without the field reads as off everywhere. Every window of this Machine hears a change at once
// (`autoContinue.changed`), and the channels are `local`: a Linked machine reaches none of them.
// autoContinueOn(projectId) is the reader of main for the retry of tickets 04–06.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { projectId } from '../../src/main/projects/store'
import { APP_SETTINGS_FILE, AppSettingsStore, autoContinueOn } from '../../src/main/settings/store'
import { autoContinueChanged, autoContinueRead, autoContinueSet } from '../../src/shared/ipc/auto-continue'
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

describe('autoContinue and a Linked machine', () => {
  it('every channel is marked `local`', () => {
    expect([autoContinueRead.access, autoContinueSet.access, autoContinueChanged.access]).toEqual(['local', 'local', 'local'])
  })

  it('the link adapter registers neither, and refuses both even with full access; nothing is written', async () => {
    // A `project` channel next to them, so an adapter that registered nothing would not pass.
    const sample = await import('./ipc-sample/main/sample')
    sample.echoCalls.length = 0
    const modules: Record<string, ModuleLoader> = { './auto-continue.ts': loadModule, './sample.ts': async () => sample.default }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    expect(adapter.channels()).toEqual(['sample.echo'])

    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('all')
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await adapter.call(peer, 'autoContinue.set', { projectId: ALPHA, on: true }, 'Beta')).toEqual({ ok: false, error: 'autoContinue.set: not open to Linked machines' })
    expect(await adapter.call(peer, 'autoContinue.read', { projectId: ALPHA }, 'Beta')).toEqual({ ok: false, error: 'autoContinue.read: not open to Linked machines' })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
    expect(autoContinueOn(ALPHA)).toBe(false)
  })
})
