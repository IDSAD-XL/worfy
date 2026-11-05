// The Auto-approval mode of a Project (worfy-auto-approve ticket 06): `autoApproval` of
// app-settings.json in worfy's data folder (src/main/settings/store.ts, ADR-0005) and the
// `autoApproval` IPC domain (src/main/ipc/auto-approve.ts) over a mocked `electron` and a temporary
// WORFY_DATA_DIR. No entry — Off; anything outside the schema — Off; a write of one Project leaves
// every other Project and every other setting as it was. A Linked machine with full access reads and
// sets the mode through the link, with read-only access it only reads it (worfy-retry ticket 13). The store reads the file once:
// an edit of the file made outside worfy shows only after a restart (spec, "security", item 5). While
// worfy runs with a debugging port or the Node inspector open, any local process can call the
// window's IPC: then Shadow and On are refused and the mode in force is Off.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { projectId } from '../../src/main/projects/store'
import { APP_SETTINGS_FILE, AppSettingsStore, autoApprovalMode, debugAccessOf } from '../../src/main/settings/store'
import { autoApprovalBlockedHere, autoApprovalChanged, autoApprovalRead, autoApprovalSet } from '../../src/shared/ipc/auto-approve'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { appSettingsSchema, autoApprovalOf, autoApprovalProjectIdSchema, DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/shared/settings/app-settings'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the store of the running app sits over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-auto-approve-setting-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

const electron = vi.hoisted(() => ({ sent: [] as { channel: string; payload: unknown }[], switches: [] as string[] }))
vi.mock('electron', () => ({
  app: { commandLine: { hasSwitch: (name: string) => electron.switches.includes(name) } },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) } }] },
}))

// The Node inspector of main: closed until a test opens it, after main's modules have loaded.
const inspector = vi.hoisted(() => ({ address: undefined as string | undefined }))
vi.mock('node:inspector', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:inspector')>()), url: () => inspector.address }))

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const STRANGER = 'gamma-0000000c'
const LINKED = '55555555-5555-4555-8555-555555555555'

const folders: string[] = []

/** A fresh folder with its own app-settings.json path, for a store of its own. */
function freshFile(content?: unknown): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-auto-approve-store-')))
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
  debug.reason = null
})

/** Everything but the Auto-approval modes and the revision. */
const rest = (settings: AppSettings) => Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'autoApproval' && key !== 'revision'))

describe('autoApproval in app-settings.json', () => {
  it('no file: Off for every Project, and nothing written to say so', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(store.autoApproval(ALPHA)).toBe('off')
    expect(store.get()).toStrictEqual(DEFAULT_APP_SETTINGS)
    expect(autoApprovalOf(store.get(), ALPHA)).toBe('off')
    expect(existsSync(file)).toBe(false)
  })

  it('a file of an older worfy without the field: Off, the other settings as written', () => {
    const store = new AppSettingsStore(freshFile({ interfaceScale: 1.2, memoryIndicator: false, revision: 4 }))
    expect(store.autoApproval(ALPHA)).toBe('off')
    expect(store.get()).toMatchObject({ interfaceScale: 1.2, memoryIndicator: false, revision: 4 })
  })

  it('reads Shadow and On as written, per Project', () => {
    const store = new AppSettingsStore(freshFile({ autoApproval: { [ALPHA]: 'on', [BETA]: 'shadow' }, revision: 2 }))
    expect([store.autoApproval(ALPHA), store.autoApproval(BETA), store.autoApproval(STRANGER)]).toEqual(['on', 'shadow', 'off'])
  })

  it('garbage reads as Off: a mode outside the schema, a key that is no Project id, a field that is not a record; the rest of the file stays', () => {
    const garbage: unknown[] = ['on', 7, null, ['on'], { [ALPHA]: 'ON' }, { [ALPHA]: true }, { [ALPHA]: { mode: 'on' } }, { 'not-a-project': 'on' }]
    for (const autoApproval of garbage) {
      const store = new AppSettingsStore(freshFile(`{"interfaceScale":1.3,"autoApproval":${JSON.stringify(autoApproval) ?? 'null'},"revision":1}`))
      expect(store.autoApproval(ALPHA), JSON.stringify(autoApproval)).toBe('off')
      expect(store.autoApproval('__proto__'), JSON.stringify(autoApproval)).toBe('off')
      expect(store.get().interfaceScale, JSON.stringify(autoApproval)).toBe(1.3)
      expect(store.get().autoApproval, JSON.stringify(autoApproval)).toBeUndefined()
    }
    // A raw `__proto__` key of JSON is dropped too, and pollutes nothing.
    const store = new AppSettingsStore(freshFile(`{"autoApproval":{"__proto__":"on","${ALPHA}":"shadow","${BETA}":"maybe"}}`))
    expect(store.get().autoApproval).toStrictEqual({ [ALPHA]: 'shadow' })
    expect(store.autoApproval(BETA)).toBe('off')
    expect(({} as Record<string, unknown>).toString).toBe(Object.prototype.toString)
  })

  it('a mode of a Project the state does not know reads as Off, also through the prototype', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, autoApproval: { [ALPHA]: 'on' as const } }
    expect(autoApprovalOf(settings, ALPHA)).toBe('on')
    expect(autoApprovalOf(settings, 'toString')).toBe('off')
    expect(autoApprovalOf(settings, 'constructor')).toBe('off')
    expect(autoApprovalOf(DEFAULT_APP_SETTINGS, ALPHA)).toBe('off')
  })

  it('a write of one Project leaves the other Projects and every other setting as they were', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    // Every field off its default, so a write that resets one to the default shows.
    store.set({ interfaceScale: 1.2, sidebar: { collapsed: { MachinesSection: true }, visible: { focus: false } }, autoCompactWindow: { orchestrator: 300_000, other: null }, memoryIndicator: false, autoUpdate: false, sessionArchive: { after: '3d' }, browserSleep: { maxLive: 5 }, autopilotBudget: { enabled: true }, autopilotRun: { mode: 'fastest' }, guideLanguage: 'ru' })
    // Taken before the first write of a mode: every write of a mode is checked, the first one too.
    const before = store.get()
    const shadow = store.setAutoApproval(BETA, 'shadow')
    expect(rest(shadow)).toStrictEqual(rest(before))
    const after = store.setAutoApproval(ALPHA, 'on')
    expect(after.autoApproval).toStrictEqual({ [ALPHA]: 'on', [BETA]: 'shadow' })
    // Every other field — worfy-retry's `autoContinue` too, once the state has it — is unchanged.
    expect(rest(after)).toStrictEqual(rest(before))
    expect(after.revision).toBe(before.revision + 2)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(after)
    expect(new AppSettingsStore(file).get()).toStrictEqual(after)

    // Off removes the entry: no entry is Off.
    const off = store.setAutoApproval(BETA, 'off')
    expect(off.autoApproval).toStrictEqual({ [ALPHA]: 'on' })
    expect(rest(off)).toStrictEqual(rest(before))
    store.setAutoApproval(ALPHA, 'off')
    expect(store.get().autoApproval).toBeUndefined()
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('autoApproval')
  })

  it('a write that changes nothing writes nothing, announces nothing and keeps the revision', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    store.setAutoApproval(ALPHA, 'shadow')
    const events: AppSettings[] = []
    store.on('changed', (state) => events.push(state))
    const before = readFileSync(file, 'utf8')
    expect(store.setAutoApproval(ALPHA, 'shadow').revision).toBe(1)
    expect(store.setAutoApproval(BETA, 'off').revision).toBe(1)
    expect(events).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('a write announces the new state, as every change of the settings does', () => {
    const store = new AppSettingsStore(freshFile())
    const events: AppSettings[] = []
    store.on('changed', (state) => events.push(state))
    store.setAutoApproval(ALPHA, 'on')
    expect(events.map((state) => state.autoApproval)).toEqual([{ [ALPHA]: 'on' }])
  })

  it('other settings changed later keep the modes', () => {
    const store = new AppSettingsStore(freshFile())
    store.setAutoApproval(ALPHA, 'on')
    store.set({ interfaceScale: 1.4, autopilotRun: { mode: 'fastest' } })
    expect(store.get().autoApproval).toStrictEqual({ [ALPHA]: 'on' })
  })

  it('a change through appSettings.set cannot carry a mode: the patch has no such field', () => {
    const store = new AppSettingsStore(freshFile())
    store.set({ interfaceScale: 1.1, autoApproval: { [ALPHA]: 'on' } } as never)
    expect(store.autoApproval(ALPHA)).toBe('off')
  })

  it('refuses a mode outside the three and an id that is no Project id; nothing written', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(() => store.setAutoApproval(ALPHA, 'always' as never)).toThrow()
    expect(() => store.setAutoApproval('__proto__', 'on')).toThrow()
    expect(existsSync(file)).toBe(false)
  })

  it('every id projectId() makes is a key the setting keeps: a change of the id format cannot turn the modes Off unseen', () => {
    for (const root of ['/tmp/demo', '/tmp/demo folder', 'C:/work/Проект', '/', '/tmp/__proto__']) {
      const id = projectId(root)
      expect(autoApprovalProjectIdSchema.safeParse(id).success, id).toBe(true)
      const store = new AppSettingsStore(freshFile())
      store.setAutoApproval(id, 'shadow')
      expect(store.autoApproval(id), id).toBe('shadow')
    }
  })

  it('the schema of the state refuses a mode outside the three', () => {
    expect(appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, autoApproval: { [ALPHA]: 'on' } }).success).toBe(true)
    expect(appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, autoApproval: { [ALPHA]: 'always' } }).success).toBe(false)
  })

  // The answer to "security", item 5 of the spec: the store reads app-settings.json once, on first
  // use, and keeps the state in memory. An edit of the file made outside worfy (a Bash command of an
  // agent) is not seen by the running app; the next write of the app overwrites it; a restart reads it.
  it('an edit of the file made outside worfy is not picked up until a restart, and the next write of the app replaces it', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    store.setAutoApproval(ALPHA, 'shadow')
    const outside = { ...JSON.parse(readFileSync(file, 'utf8')), autoApproval: { [ALPHA]: 'on', [BETA]: 'on' } }
    writeFileSync(file, JSON.stringify(outside))
    expect(store.autoApproval(ALPHA)).toBe('shadow')
    expect(store.autoApproval(BETA)).toBe('off')
    // A restart is a new store over the same file.
    expect(new AppSettingsStore(file).autoApproval(BETA)).toBe('on')
    store.set({ interfaceScale: 1.2 })
    expect(JSON.parse(readFileSync(file, 'utf8')).autoApproval).toStrictEqual({ [ALPHA]: 'shadow' })
  })
})

// ── the IPC domain ───────────────────────────────────────────────────────────────────────────────

const dataFile = join(env.scratch, 'data', APP_SETTINGS_FILE)

const projects = () => [{ id: ALPHA }, { id: BETA }]

/** What the stand-in for the debugging port check answers: null — no port open. */
const debug = { reason: null as string | null }
const debugAccess = () => debug.reason
const PORT_OPEN = 'worfy runs with a debugging port open (--remote-debugging-port)'

async function handlerModule() {
  const { autoApprovalHandlers } = await import('../../src/main/ipc/auto-approve')
  return autoApprovalHandlers({ projects, debugAccess })
}

const loadModule: ModuleLoader = async () => handlerModule()

/** The handlers as the app's windows reach them. */
async function windowCaller(): Promise<(channel: string, input?: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { modules: { './app-settings.ts': () => import('../../src/main/ipc/app-settings').then((module) => module.default), './auto-approve.ts': loadModule }, isTrustedSender: () => true })
  const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
  return async (channel, input) => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

describe('autoApproval channels', () => {
  it('read answers Off for a Project with no entry; set writes app-settings.json of the data folder and answers the mode', async () => {
    const call = await windowCaller()
    expect(await call('autoApproval.read', { projectId: ALPHA })).toEqual({ ok: true, value: { mode: 'off', saved: 'off', blocked: null } })
    expect(await call('autoApproval.set', { projectId: ALPHA, mode: 'shadow' })).toEqual({ ok: true, value: { mode: 'shadow', saved: 'shadow', blocked: null } })
    expect(await call('autoApproval.read', { projectId: ALPHA })).toEqual({ ok: true, value: { mode: 'shadow', saved: 'shadow', blocked: null } })
    expect(await call('autoApproval.read', { projectId: BETA })).toEqual({ ok: true, value: { mode: 'off', saved: 'off', blocked: null } })
    expect(JSON.parse(readFileSync(dataFile, 'utf8')).autoApproval).toStrictEqual({ [ALPHA]: 'shadow' })
    // Every window hears the new state, as with any change of the settings.
    expect(electron.sent.filter((sent) => sent.channel === `${IPC_CHANNEL_PREFIX}appSettings.changed`).length).toBeGreaterThan(0)
  })

  it('autoApprovalMode(projectId) — for the driver of a Run — answers what the switch wrote', async () => {
    const call = await windowCaller()
    await call('autoApproval.set', { projectId: BETA, mode: 'on' })
    expect(autoApprovalMode(BETA, debugAccess)).toBe('on')
    await call('autoApproval.set', { projectId: BETA, mode: 'off' })
    expect(autoApprovalMode(BETA, debugAccess)).toBe('off')
    expect(autoApprovalMode(STRANGER, debugAccess)).toBe('off')
  })

  it('a debugging port open: Shadow and On are refused and nothing is written, Off goes through; the read says Off in force and why, the saved mode stays', async () => {
    const call = await windowCaller()
    await call('autoApproval.set', { projectId: ALPHA, mode: 'shadow' })
    debug.reason = PORT_OPEN
    const before = readFileSync(dataFile, 'utf8')
    for (const mode of ['on', 'shadow'] as const) {
      expect(await call('autoApproval.set', { projectId: BETA, mode })).toMatchObject({ ok: false, error: expect.stringContaining(`Auto-approval stays off: ${PORT_OPEN}`) })
    }
    expect(await call('autoApproval.set', { projectId: ALPHA, mode: 'on' })).toMatchObject({ ok: false })
    expect(readFileSync(dataFile, 'utf8')).toBe(before)
    expect(await call('autoApproval.read', { projectId: ALPHA })).toEqual({ ok: true, value: { mode: 'off', saved: 'shadow', blocked: PORT_OPEN } })
    // Off stays possible: it only takes approval away.
    expect(await call('autoApproval.set', { projectId: ALPHA, mode: 'off' })).toEqual({ ok: true, value: { mode: 'off', saved: 'off', blocked: PORT_OPEN } })
    expect(JSON.parse(readFileSync(dataFile, 'utf8')).autoApproval).toBeUndefined()
  })

  it('autoApprovalMode(projectId) is Off while a debugging port is open, whatever was saved; the saved mode is back once it is closed', async () => {
    const call = await windowCaller()
    await call('autoApproval.set', { projectId: BETA, mode: 'on' })
    debug.reason = PORT_OPEN
    expect(autoApprovalMode(BETA, debugAccess)).toBe('off')
    debug.reason = null
    expect(autoApprovalMode(BETA, debugAccess)).toBe('on')
    await call('autoApproval.set', { projectId: BETA, mode: 'off' })
  })

  it('a Project that is not one of this Machine: refused, nothing written', async () => {
    const call = await windowCaller()
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await call('autoApproval.set', { projectId: STRANGER, mode: 'on' })).toMatchObject({ ok: false, error: expect.stringMatching(/not a Project of this Machine/u) })
    expect(await call('autoApproval.read', { projectId: STRANGER })).toMatchObject({ ok: false, error: expect.stringMatching(/not a Project of this Machine/u) })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
  })

  it('an input outside the schema is refused before the handler: a fourth mode, no Project', async () => {
    const call = await windowCaller()
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await call('autoApproval.set', { projectId: ALPHA, mode: 'always' })).toMatchObject({ ok: false })
    expect(await call('autoApproval.set', { mode: 'on' })).toMatchObject({ ok: false })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
  })
})

// worfy-retry ticket 13: a Linked machine with full access sets the mode, with read-only access it only
// reads it. The whole flow over two Machines is test/contract/modes-linked.test.ts.
describe('autoApproval and a Linked machine', () => {
  it('the read and the change are `project` and `read`, the write `project` and `write`; why this Machine holds it back is `local`', () => {
    expect([autoApprovalRead.access, autoApprovalRead.use]).toEqual(['project', 'read'])
    expect([autoApprovalSet.access, autoApprovalSet.use]).toEqual(['project', 'write'])
    expect([autoApprovalChanged.access, autoApprovalChanged.use]).toEqual(['project', 'read'])
    expect([autoApprovalBlockedHere.access, autoApprovalBlockedHere.use]).toEqual(['local', null])
  })

  it('the link adapter registers the read and the write; read-only access reads, and its write is refused with nothing written', async () => {
    const modules: Record<string, ModuleLoader> = { './auto-approve.ts': loadModule }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    expect([...adapter.channels()].sort()).toEqual(['autoApproval.read', 'autoApproval.set'])

    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('read')
    const before = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null
    expect(await adapter.call(peer, 'autoApproval.read', { projectId: ALPHA }, 'Beta')).toMatchObject({ ok: true, value: { saved: autoApprovalMode(ALPHA, () => null) } })
    expect(await adapter.call(peer, 'autoApproval.set', { projectId: ALPHA, mode: 'on' }, 'Beta')).toEqual({ ok: false, error: readOnlyRefusal('Beta') })
    expect(existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : null).toBe(before)
    expect(autoApprovalMode(ALPHA, debugAccess)).not.toBe('on')
  })
})

describe('the debugging port check', () => {
  it('a debugging port or pipe on the command line, in any spelling Chromium takes, blocks Auto-approval', () => {
    for (const argv of [
      ['/app/worfy', '--remote-debugging-port=9351'],
      ['/app/worfy', '--remote-debugging-port', '9351'],
      ['/app/worfy', '-remote-debugging-port=0'],
      ['/app/worfy', '--remote-debugging-pipe'],
      ['C:\\worfy.exe', '/REMOTE-DEBUGGING-PORT=9222'],
      ['/app/worfy', '--Remote-Debugging-Port=1'],
    ]) {
      expect(debugAccessOf(argv, undefined), argv.join(' ')).toMatch(/debugging (port|pipe)/u)
    }
  })

  it("a port Chromium has though the command line of main no longer shows it (a loader can rewrite process.argv, as Playwright's does) blocks it", () => {
    const has = (names: readonly string[]) => (name: string) => names.includes(name)
    expect(debugAccessOf(['/app/worfy'], undefined, has(['remote-debugging-port']))).toMatch(/debugging port/u)
    expect(debugAccessOf(['/app/worfy'], undefined, has(['remote-debugging-pipe']))).toMatch(/debugging pipe/u)
    expect(debugAccessOf(['/app/worfy'], undefined, has(['disable-gpu']))).toBeNull()
  })

  it('the Node inspector of main open — by a flag or opened later — blocks it too', () => {
    expect(debugAccessOf(['/app/worfy'], 'ws://127.0.0.1:9229/0000')).toMatch(/Node inspector/u)
    expect(debugAccessOf(['/app/worfy', '--inspect=0'], undefined)).toMatch(/Node inspector/u)
    expect(debugAccessOf(['/app/worfy', '--inspect-brk'], undefined)).toMatch(/Node inspector/u)
  })

  it('a plain start blocks nothing; a word that only contains the switch is no switch', () => {
    expect(debugAccessOf(['/app/worfy'], undefined)).toBeNull()
    expect(debugAccessOf(['/app/worfy', '--no-sandbox', '/tmp/remote-debugging-port-notes'], undefined)).toBeNull()
  })

  it('the check of the running app asks Chromium for both switches', async () => {
    const { debugAccess: running } = await import('../../src/main/settings/store')
    electron.switches = []
    expect(running()).toBeNull()
    electron.switches = ['remote-debugging-port']
    expect(running()).toMatch(/debugging port/u)
    electron.switches = ['remote-debugging-pipe']
    expect(running()).toMatch(/debugging pipe/u)
    electron.switches = []
  })

  it('the check of the running app asks for the inspector each time: one opened after start (SIGUSR1) blocks it, one closed again does not', async () => {
    const { debugAccess: running } = await import('../../src/main/settings/store')
    expect(running()).toBeNull()
    inspector.address = 'ws://127.0.0.1:9229/0000'
    try {
      expect(running()).toMatch(/Node inspector/u)
      expect(autoApprovalMode(ALPHA)).toBe('off')
    } finally {
      inspector.address = undefined
    }
    expect(running()).toBeNull()
  })
})
