// The settings of the Assistant's checks in the app settings of this Machine (`assistantSchedule`,
// worfy-assistant ticket 04): kept in app-settings.json of worfy's data folder (src/main/settings/store.ts),
// changed through the `appSettings` channels, which are `local` — a Linked machine neither reads nor
// writes them. A mocked `electron` with one fake window and a temporary WORFY_DATA_DIR.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CHECK_MARKS_FILE, checkScheduler, fileCheckMarks, startCheckScheduler } from '../../src/main/assistant/schedule/app'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { APP_SETTINGS_FILE, AppSettingsStore, appSettingsStore } from '../../src/main/settings/store'
import { readJsonFile } from '../../src/main/storage/json-file'
import { checkKindSchema, checkSettingsOf, workHoursOf } from '../../src/shared/assistant/schedule/settings'
import type { WorkHours } from '../../src/shared/assistant/schedule/work-hours'
import { appSettingsGet, appSettingsSet } from '../../src/shared/ipc/app-settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the store of the running app sits over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-assistant-schedule-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: () => undefined } }] },
}))

const settingsFile = join(env.scratch, 'data', APP_SETTINGS_FILE)
const folders: string[] = []

function freshFile(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-assistant-schedule-store-')))
  folders.push(folder)
  return join(folder, APP_SETTINGS_FILE)
}

afterAll(() => {
  for (const folder of folders.splice(0)) removeTestTree(folder)
  removeTestTree(env.scratch)
})

const EVENINGS: WorkHours = { days: ['sat', 'sun'], windows: [{ from: 18 * 60, to: 23 * 60 }], timeZone: 'Europe/Kyiv' }

describe('assistantSchedule in app-settings.json', () => {
  it('absent until chosen; a choice is written, read back after a restart and kept field by field', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(store.get().assistantSchedule).toBeUndefined()
    expect(checkSettingsOf(store.get(), 'slack')).toEqual({ enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: true })

    expect(store.set({ assistantSchedule: { checks: { slack: { enabled: true } } } })).toMatchObject({ assistantSchedule: { checks: { slack: { enabled: true } } }, revision: 1 })
    expect(store.set({ assistantSchedule: { workHours: EVENINGS, checks: { slack: { intervalMinutes: 20 } } } }).revision).toBe(2)
    expect(JSON.parse(readFileSync(file, 'utf8')).assistantSchedule).toStrictEqual({ workHours: EVENINGS, checks: { slack: { enabled: true, intervalMinutes: 20 } } })

    const reread = new AppSettingsStore(file).get()
    expect(workHoursOf(reread)).toEqual(EVENINGS)
    expect(checkSettingsOf(reread, 'slack')).toEqual({ enabled: true, intervalMinutes: 20, sleepOutsideWorkHours: true })
    // Another setting leaves it as it is; the same choice again writes nothing.
    expect(store.set({ interfaceScale: 1.2 }).assistantSchedule).toStrictEqual({ workHours: EVENINGS, checks: { slack: { enabled: true, intervalMinutes: 20 } } })
    expect(store.set({ assistantSchedule: { checks: { slack: { intervalMinutes: 20 } } } }).revision).toBe(3)
  })

  it('a field the file holds by hand that the schema refuses reads as not chosen; the rest of the file stays and is not set aside', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.1, assistantSchedule: { workHours: { days: [], windows: [] }, checks: { slack: { enabled: true, intervalMinutes: 1 }, jira: 'hourly' } } }))
    const read = new AppSettingsStore(file).get()
    expect(read.interfaceScale).toBe(1.1)
    expect(read.assistantSchedule).toStrictEqual({ checks: { slack: { enabled: true } } })

    const wrong = freshFile()
    mkdirSync(join(wrong, '..'), { recursive: true })
    writeFileSync(wrong, JSON.stringify({ interfaceScale: 1.3, assistantSchedule: 'always' }))
    expect(new AppSettingsStore(wrong).get()).toMatchObject({ interfaceScale: 1.3 })
    expect(new AppSettingsStore(wrong).get().assistantSchedule).toBeUndefined()
  })
})

const loadModule: ModuleLoader = () => import('../../src/main/ipc/app-settings').then((module) => module.default)

async function windowCaller(): Promise<(channel: string, input?: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { modules: { './app-settings.ts': loadModule }, isTrustedSender: () => true })
  const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
  return async (channel, input) => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

describe('the scheduler in the running app', () => {
  it('the marks of the checks live in assistant-check-marks.json: none without the file, kept across a new store, none from an unreadable file', () => {
    const file = join(freshFile(), '..', CHECK_MARKS_FILE)
    const marks = fileCheckMarks(file)
    expect(marks.read()).toEqual({})
    marks.write({ slack: { startedAt: 1, succeededAt: 1 } })
    expect(fileCheckMarks(file).read()).toEqual({ slack: { startedAt: 1, succeededAt: 1 } })
    writeFileSync(file, '{ not json')
    expect(fileCheckMarks(file).read()).toEqual({})
  })

  it('the count of failures in a row (ticket 22) is kept in the file; a build before it reads the file and does not set it aside; a count it refuses reads as none', () => {
    const file = join(freshFile(), '..', CHECK_MARKS_FILE)
    fileCheckMarks(file).write({ slack: { startedAt: 1, succeededAt: 1, failures: 4 } })
    expect(fileCheckMarks(file).read()).toEqual({ slack: { startedAt: 1, succeededAt: 1, failures: 4 } })
    // The schema of the marks before ticket 22, word for word.
    const before = z.partialRecord(checkKindSchema, z.object({ startedAt: z.number().optional(), succeededAt: z.number().optional() }))
    expect(readJsonFile(file, before)).toEqual({ slack: { startedAt: 1, succeededAt: 1 } })
    expect(readdirSync(dirname(file))).toEqual([CHECK_MARKS_FILE])
    writeFileSync(file, JSON.stringify({ slack: { startedAt: 1, succeededAt: 1, failures: -2 } }))
    expect(fileCheckMarks(file).read()).toEqual({ slack: { startedAt: 1, succeededAt: 1 } })
    expect(readdirSync(dirname(file))).toEqual([CHECK_MARKS_FILE])
  })

  it('startCheckScheduler plans again when the settings change, pauses while the system sleeps and lets go of both on stop', async () => {
    const power = new EventEmitter()
    const settingsListeners = appSettingsStore().listenerCount('changed')
    const kinds: string[] = []
    const unregister = checkScheduler().register('slack', async (context) => void kinds.push(context.kind))
    const stop = startCheckScheduler(power)
    try {
      expect(kinds).toEqual([])
      appSettingsStore().set({ assistantSchedule: { checks: { slack: { enabled: true, sleepOutsideWorkHours: false } } } })
      // The Assistant is off until the person turns it on (ticket 15): a check turned on does not go before. The
      // change plans at once, so a run it started would be there now.
      expect(kinds).toEqual([])
      expect(checkScheduler().runNow('slack')).toBe(false)
      appSettingsStore().set({ assistant: { on: true } })
      await expect.poll(() => kinds).toEqual(['slack'])
      expect(JSON.parse(readFileSync(join(env.scratch, 'data', CHECK_MARKS_FILE), 'utf8'))).toMatchObject({ slack: { startedAt: expect.any(Number) } })
      power.emit('suspend')
      expect(checkScheduler().runNow('slack')).toBe(false)
      power.emit('resume')
      await expect.poll(() => checkScheduler().running('slack')).toBe(false)
      expect(checkScheduler().runNow('slack')).toBe(true)
      await expect.poll(() => checkScheduler().running('slack')).toBe(false)
    } finally {
      stop()
    }
    // Stopped: nothing starts, runNow included; the settings and the system no longer reach it.
    expect(checkScheduler().runNow('slack')).toBe(false)
    appSettingsStore().set({ assistantSchedule: { checks: { slack: { intervalMinutes: 5 } } } })
    power.emit('resume')
    expect(checkScheduler().running('slack')).toBe(false)
    unregister()
    expect(power.listenerCount('suspend') + power.listenerCount('resume')).toBe(0)
    expect(appSettingsStore().listenerCount('changed')).toBe(settingsListeners)
  })
})

describe('the appSettings channels', () => {
  it('appSettings.set takes work hours and a check choice, and refuses an interval off its bounds, a window that meets itself and an unknown zone', async () => {
    const call = await windowCaller()
    expect(await call('appSettings.set', { assistantSchedule: { workHours: EVENINGS, checks: { jira: { enabled: true, intervalMinutes: 120 } } } })).toMatchObject({
      ok: true,
      value: { assistantSchedule: { workHours: EVENINGS, checks: { jira: { enabled: true, intervalMinutes: 120 } } } },
    })
    for (const outside of [
      { checks: { jira: { intervalMinutes: 2 } } },
      { checks: { slack: { enabled: 'yes' } } },
      { workHours: { ...EVENINGS, windows: [{ from: 600, to: 600 }] } },
      { workHours: { ...EVENINGS, timeZone: 'Nowhere/Land' } },
    ]) {
      expect((await call('appSettings.set', { assistantSchedule: outside })).ok, JSON.stringify(outside)).toBe(false)
    }
    expect(await call('appSettings.get')).toMatchObject({ ok: true, value: { assistantSchedule: { workHours: EVENINGS, checks: { jira: { enabled: true, intervalMinutes: 120 } } } } })
  })

  it('a Linked machine reaches neither channel, with access on too; nothing is written', async () => {
    expect([appSettingsGet.access, appSettingsSet.access]).toEqual(['local', 'local'])
    const linked = '55555555-5555-4555-8555-555555555555'
    const adapter = await createLinkIpc({ modules: { './app-settings.ts': loadModule }, isLinked: (id) => id === linked })
    const peer = new LinkPeer({ machineId: linked, describe: () => linked, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('all')
    const before = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null
    expect(await adapter.call(peer, 'appSettings.set', { assistantSchedule: { checks: { slack: { enabled: true } } } }, 'Beta')).toEqual({ ok: false, error: 'appSettings.set: not open to Linked machines' })
    expect(await adapter.call(peer, 'appSettings.get', undefined, 'Beta')).toEqual({ ok: false, error: 'appSettings.get: not open to Linked machines' })
    expect(existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null).toBe(before)
  })
})
