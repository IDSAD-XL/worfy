// The app settings of this Machine: app-settings.json in worfy's data folder (src/main/settings/store.ts)
// and the `appSettings` IPC domain (src/main/ipc/app-settings.ts) over a mocked `electron` with two
// fake windows and a temporary WORFY_DATA_DIR. A Linked machine reaches none of the three channels:
// they are `local`, the state of the screen's own Machine.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addClient } from '../../src/main/broadcast'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer, LinkSender } from '../../src/main/link/ipc-adapter'
import { APP_SETTINGS_FILE, AppSettingsStore } from '../../src/main/settings/store'
import { appSettingsChanged, appSettingsGet, appSettingsSet } from '../../src/shared/ipc/app-settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { AUTOPILOT_BUDGET_DEFAULTS, autopilotBudgetOf, autopilotRunOf, autoCompactWindowChosen, autoUpdateOf, BROWSER_SLEEP_DEFAULTS, browserSleepOf, clampScale, DEFAULT_APP_SETTINGS, SESSION_ARCHIVE_DEFAULTS, sessionArchiveOf, type AppSettings } from '../../src/shared/settings/app-settings'
import { removeTestTree } from '../remove'

/** The path of every readFileSync call, by the test and by the code under test. */
const disk = vi.hoisted(() => ({ reads: [] as string[] }))

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the store of the running app sits over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-app-settings-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

vi.mock('node:fs', async (importOriginal) => {
  // The real file system, with every readFileSync noted: "creating the store reads no disk" below.
  const actual = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    disk.reads.push(String(args[0]))
    return actual.readFileSync(...args)
  }) as typeof actual.readFileSync
  return { ...actual, default: { ...actual, readFileSync }, readFileSync }
})

const electron = vi.hoisted(() => {
  const sent: { window: string; channel: string; payload: unknown }[] = []
  const windowOf = (window: string) => ({
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => sent.push({ window, channel, payload }) },
  })
  return { sent, windows: [windowOf('first'), windowOf('second')] }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electron.windows },
}))

const dataDir = join(env.scratch, 'data')
const settingsFile = join(dataDir, APP_SETTINGS_FILE)

/** The folders freshFile made. */
const folders: string[] = []

/** A fresh folder with its own app-settings.json path, for a store of its own. */
function freshFile(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-app-settings-store-')))
  folders.push(folder)
  return join(folder, APP_SETTINGS_FILE)
}

// The file left its folders in the temporary folder of the user (worfy-windows ticket 26).
afterAll(() => {
  for (const folder of folders.splice(0)) removeTestTree(folder)
  removeTestTree(env.scratch)
})

const fixedNow = () => new Date('2026-10-10T07:08:09.010Z')

describe('AppSettingsStore', () => {
  it('starts from the defaults when the file does not exist, and writes nothing to read them', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(store.get()).toStrictEqual(DEFAULT_APP_SETTINGS)
    expect(store.get()).toStrictEqual({ interfaceScale: 1, sidebar: { collapsed: {}, visible: { normal: true, focus: true } }, autoCompactWindow: { orchestrator: 400_000, other: 500_000 }, memoryIndicator: true, autoUpdate: true, revision: 0 })
    expect(existsSync(file)).toBe(false)
  })

  it('writes app-settings.json on a change, and a new store over the same folder reads it back', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    const changed = store.set({ interfaceScale: 1.2, sidebar: { collapsed: { MachinesSection: true }, visible: { focus: false } } })
    expect(changed).toStrictEqual({ interfaceScale: 1.2, sidebar: { collapsed: { MachinesSection: true }, visible: { normal: true, focus: false } }, autoCompactWindow: { orchestrator: 400_000, other: 500_000 }, memoryIndicator: true, autoUpdate: true, revision: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(changed)
    expect(new AppSettingsStore(file).get()).toStrictEqual(changed)
  })

  it('the revision grows with every write and carries over to the next start', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(store.set({ interfaceScale: 1.1 }).revision).toBe(1)
    expect(store.set({ interfaceScale: 1.3 }).revision).toBe(2)
    expect(store.set({ sidebar: { visible: { normal: false } } }).revision).toBe(3)
    const next = new AppSettingsStore(file)
    expect(next.get().revision).toBe(3)
    expect(next.set({ interfaceScale: 0.9 }).revision).toBe(4)
  })

  it('a change that changes nothing writes nothing, announces nothing and keeps the revision', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    store.set({ interfaceScale: 1.2, sidebar: { collapsed: { ProjectsSection: false } } })
    const events: AppSettings[] = []
    store.on('changed', (state) => events.push(state))
    const before = readFileSync(file, 'utf8')
    expect(store.set({ interfaceScale: 1.2, sidebar: { collapsed: { ProjectsSection: false }, visible: { normal: true } } }).revision).toBe(1)
    expect(store.set({}).revision).toBe(1)
    expect(events).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('changing one section of `collapsed` keeps the others; a section can be expanded again', () => {
    const store = new AppSettingsStore(freshFile())
    store.set({ sidebar: { collapsed: { MachinesSection: true } } })
    store.set({ sidebar: { collapsed: { ProjectsSection: true } } })
    expect(store.get().sidebar.collapsed).toStrictEqual({ MachinesSection: true, ProjectsSection: true })
    store.set({ sidebar: { collapsed: { MachinesSection: false } } })
    expect(store.get().sidebar.collapsed).toStrictEqual({ MachinesSection: false, ProjectsSection: true })
    // Visibility merges by key too: the normal view's switch leaves the focus mode's alone.
    store.set({ sidebar: { visible: { focus: false } } })
    store.set({ sidebar: { visible: { normal: false } } })
    expect(store.get().sidebar.visible).toStrictEqual({ normal: false, focus: false })
  })

  it('brings interfaceScale into 0.8–1.5 by steps of 0.1, in a change and in the file', () => {
    const store = new AppSettingsStore(freshFile())
    expect(store.set({ interfaceScale: 3 }).interfaceScale).toBe(1.5)
    expect(store.set({ interfaceScale: 0.83 }).interfaceScale).toBe(0.8)
    expect(store.set({ interfaceScale: 0.1 }).interfaceScale).toBe(0.8)
    expect(store.set({ interfaceScale: 1.25 }).interfaceScale).toBe(1.3)

    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 3, sidebar: { collapsed: {}, visible: { normal: true, focus: true } }, revision: 7 }))
    expect(new AppSettingsStore(file).get()).toMatchObject({ interfaceScale: 1.5, revision: 7 })
    writeFileSync(file, JSON.stringify({ interfaceScale: 0.83, sidebar: { collapsed: {}, visible: { normal: true, focus: true } }, revision: 7 }))
    expect(new AppSettingsStore(file).get().interfaceScale).toBe(0.8)
  })

  it('keeps the two autocompact windows apart, brings each into 100K–1M by steps of 10K, and keeps "Claude Code default" (null)', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect(store.set({ autoCompactWindow: { orchestrator: 300_000 } }).autoCompactWindow).toStrictEqual({ orchestrator: 300_000, other: 500_000 })
    expect(store.set({ autoCompactWindow: { other: null } }).autoCompactWindow).toStrictEqual({ orchestrator: 300_000, other: null })
    expect(store.set({ autoCompactWindow: { orchestrator: 2_000_000 } }).autoCompactWindow.orchestrator).toBe(1_000_000)
    expect(store.set({ autoCompactWindow: { orchestrator: 95_000 } }).autoCompactWindow.orchestrator).toBe(100_000)
    expect(store.set({ autoCompactWindow: { orchestrator: 404_999 } }).autoCompactWindow.orchestrator).toBe(400_000)
    expect(store.set({ autoCompactWindow: { orchestrator: Number.NaN } }).autoCompactWindow.orchestrator).toBeNull()
    // A change that names a window as it is writes nothing.
    const revision = store.get().revision
    expect(store.set({ autoCompactWindow: { orchestrator: null, other: null } }).revision).toBe(revision)
    expect(new AppSettingsStore(file).get().autoCompactWindow).toStrictEqual({ orchestrator: null, other: null })

    // A file of an older version has no windows and takes the defaults; one out of range is brought into it.
    const old = freshFile()
    mkdirSync(join(old, '..'), { recursive: true })
    writeFileSync(old, JSON.stringify({ interfaceScale: 1, sidebar: { collapsed: {}, visible: { normal: true, focus: true } }, revision: 4 }))
    expect(new AppSettingsStore(old).get().autoCompactWindow).toStrictEqual({ orchestrator: 400_000, other: 500_000 })
    writeFileSync(old, JSON.stringify({ interfaceScale: 1, autoCompactWindow: { orchestrator: 1_234_567, other: null }, revision: 4 }))
    expect(new AppSettingsStore(old).get().autoCompactWindow).toStrictEqual({ orchestrator: 1_000_000, other: null })
  })

  it('tells a window the person chose from worfy\'s default, the default value chosen in "Custom" included (worfy-polish ticket 29)', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    const chosen = (settings: AppSettings): [boolean, boolean] => [autoCompactWindowChosen(settings, 'orchestrator'), autoCompactWindowChosen(settings, 'other')]
    // A Machine that never chose: worfy's defaults, nothing marked chosen.
    expect(chosen(store.get())).toEqual([false, false])

    // The same value as worfy's default, named by a change, is a choice: written, and read back by the next store.
    const after = store.set({ autoCompactWindow: { orchestrator: 400_000 } })
    expect(after.autoCompactWindow).toStrictEqual({ orchestrator: 400_000, other: 500_000 })
    expect(after.revision).toBe(1)
    expect(chosen(after)).toEqual([true, false])
    expect(chosen(new AppSettingsStore(file).get())).toEqual([true, false])
    // Named once more, it changes nothing.
    expect(store.set({ autoCompactWindow: { orchestrator: 400_000 } }).revision).toBe(1)

    store.set({ autoCompactWindow: { other: null } })
    expect(chosen(new AppSettingsStore(file).get())).toEqual([true, true])

    // 'worfy-default' takes a role back to worfy's default, unchosen; with neither chosen, the file carries no mark.
    const back = store.set({ autoCompactWindow: { orchestrator: 'worfy-default', other: 'worfy-default' } })
    expect(back.autoCompactWindow).toStrictEqual({ orchestrator: 400_000, other: 500_000 })
    expect(chosen(back)).toEqual([false, false])
    expect(back).not.toHaveProperty('autoCompactWindowChosen')
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('autoCompactWindowChosen')
    expect(chosen(new AppSettingsStore(file).get())).toEqual([false, false])
  })

  it.each([
    ['no windows', {}, [false, false]],
    ['the windows at worfy\'s defaults', { autoCompactWindow: { orchestrator: 400_000, other: 500_000 } }, [false, false]],
    ['a window of the person\'s own and "Claude Code default"', { autoCompactWindow: { orchestrator: 300_000, other: null } }, [true, true]],
    ['one window changed', { autoCompactWindow: { orchestrator: 400_000, other: 700_000 } }, [false, true]],
  ] as const)('a file written before the mark existed (%s): a window that differs from worfy\'s default was chosen, one equal to it was not', (_case, fields, expected) => {
    const file = freshFile()
    writeFileSync(file, JSON.stringify({ interfaceScale: 1, ...fields, revision: 4 }))
    const store = new AppSettingsStore(file)
    expect([autoCompactWindowChosen(store.get(), 'orchestrator'), autoCompactWindowChosen(store.get(), 'other')]).toEqual(expected)
    // A change elsewhere keeps what was chosen, and keeps a window not chosen at worfy's default.
    store.set({ interfaceScale: 1.2 })
    const again = new AppSettingsStore(file).get()
    expect([autoCompactWindowChosen(again, 'orchestrator'), autoCompactWindowChosen(again, 'other')]).toEqual(expected)
  })

  it('a mark that says "not chosen" for a window off worfy\'s default — a file edited by hand — reads as chosen: the window is kept', () => {
    const file = freshFile()
    writeFileSync(file, JSON.stringify({ autoCompactWindow: { orchestrator: 300_000, other: 500_000 }, autoCompactWindowChosen: { orchestrator: false, other: false } }))
    const settings = new AppSettingsStore(file).get()
    expect(settings.autoCompactWindow).toStrictEqual({ orchestrator: 300_000, other: 500_000 })
    expect([autoCompactWindowChosen(settings, 'orchestrator'), autoCompactWindowChosen(settings, 'other')]).toEqual([true, false])
  })

  it('drops a field the schema does not declare, at the top and inside `sidebar`', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({ interfaceScale: 1.1, theme: 'dark', sidebar: { collapsed: { DocsSection: true }, visible: { normal: true, focus: false, extra: 1 }, width: 300 }, revision: 2 }),
    )
    const store = new AppSettingsStore(file)
    expect(store.get()).toStrictEqual({ interfaceScale: 1.1, sidebar: { collapsed: { DocsSection: true }, visible: { normal: true, focus: false } }, autoCompactWindow: { orchestrator: 400_000, other: 500_000 }, memoryIndicator: true, autoUpdate: true, revision: 2 })
    store.set({ interfaceScale: 1.2 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      interfaceScale: 1.2,
      sidebar: { collapsed: { DocsSection: true }, visible: { normal: true, focus: false } },
      autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
      memoryIndicator: true,
      autoUpdate: true,
      revision: 3,
    })
  })

  it('a file of an older version without some fields takes the defaults for them', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.4 }))
    expect(new AppSettingsStore(file).get()).toStrictEqual({ ...DEFAULT_APP_SETTINGS, interfaceScale: 1.4 })
  })

  it('the memory figure of the toolbar is on by default, on in a file without the field, and its change is kept (worfy-ui ticket 20)', () => {
    expect(DEFAULT_APP_SETTINGS.memoryIndicator).toBe(true)
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.1, revision: 4 }))
    const store = new AppSettingsStore(file)
    expect(store.get().memoryIndicator).toBe(true)

    const events: AppSettings[] = []
    store.on('changed', (state) => events.push(state))
    expect(store.set({ memoryIndicator: false })).toMatchObject({ memoryIndicator: false, revision: 5 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ memoryIndicator: false })
    expect(new AppSettingsStore(file).get().memoryIndicator).toBe(false)
    expect(events.map((state) => state.memoryIndicator)).toEqual([false])
    // The same value again changes nothing.
    expect(store.set({ memoryIndicator: false }).revision).toBe(5)
    expect(events).toHaveLength(1)
    // A change of another setting keeps it off.
    expect(store.set({ interfaceScale: 1.2 })).toMatchObject({ interfaceScale: 1.2, memoryIndicator: false })
    expect(new AppSettingsStore(file).get().memoryIndicator).toBe(false)
    expect(store.set({ memoryIndicator: true }).memoryIndicator).toBe(true)
  })

  it('"Update automatically" is on by default and in a file without the field; off is written and read back (worfy-update ticket 03)', () => {
    expect(DEFAULT_APP_SETTINGS.autoUpdate).toBe(true)
    expect(autoUpdateOf({})).toBe(true)
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.1, memoryIndicator: false, revision: 2 }))
    const store = new AppSettingsStore(file)
    expect(store.get().autoUpdate).toBe(true)

    expect(store.set({ autoUpdate: false })).toMatchObject({ autoUpdate: false, revision: 3 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ autoUpdate: false, memoryIndicator: false })
    expect(new AppSettingsStore(file).get().autoUpdate).toBe(false)
    expect(autoUpdateOf(new AppSettingsStore(file).get())).toBe(false)
    // The same value again changes nothing; another setting keeps it off.
    expect(store.set({ autoUpdate: false }).revision).toBe(3)
    expect(store.set({ interfaceScale: 1.2 })).toMatchObject({ interfaceScale: 1.2, autoUpdate: false })
    expect(store.set({ autoUpdate: true }).autoUpdate).toBe(true)
    expect(new AppSettingsStore(file).get().autoUpdate).toBe(true)
  })

  it('the language of the worfy Guide (worfy-guide ticket 03): absent until chosen, then written, read back and kept; a language it does not know reads as not chosen', () => {
    expect(DEFAULT_APP_SETTINGS).not.toHaveProperty('guideLanguage')
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.1, revision: 2 }))
    const store = new AppSettingsStore(file)
    expect(store.get()).not.toHaveProperty('guideLanguage')

    expect(store.set({ guideLanguage: 'ru' })).toMatchObject({ guideLanguage: 'ru', revision: 3 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ guideLanguage: 'ru' })
    expect(new AppSettingsStore(file).get().guideLanguage).toBe('ru')
    // The same value again changes nothing; another setting keeps it.
    expect(store.set({ guideLanguage: 'ru' }).revision).toBe(3)
    expect(store.set({ interfaceScale: 1.2 })).toMatchObject({ interfaceScale: 1.2, guideLanguage: 'ru' })
    expect(store.set({ guideLanguage: 'en' }).guideLanguage).toBe('en')
    expect(new AppSettingsStore(file).get().guideLanguage).toBe('en')

    // A file edited by hand, or written by a newer version with a third language: not chosen, the rest stays.
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.3, guideLanguage: 'de', revision: 7 }))
    const other = new AppSettingsStore(file)
    expect(other.get()).not.toHaveProperty('guideLanguage')
    expect(other.get()).toMatchObject({ interfaceScale: 1.3, revision: 7 })
  })

  it('the archive of finished Sessions (worfy-canvas ticket 08): a file without the field gives the defaults; a choice is written, read back and kept apart from the defaults', () => {
    expect(SESSION_ARCHIVE_DEFAULTS).toEqual({ after: '24h', ticketDone: true })
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.1, revision: 2 }))
    const store = new AppSettingsStore(file)
    expect(store.get().sessionArchive).toBeUndefined()
    expect(sessionArchiveOf(store.get())).toEqual(SESSION_ARCHIVE_DEFAULTS)

    // One field chosen: only it is written, the other stays the default's.
    expect(store.set({ sessionArchive: { after: '3d' } })).toMatchObject({ sessionArchive: { after: '3d' }, revision: 3 })
    expect(JSON.parse(readFileSync(file, 'utf8')).sessionArchive).toStrictEqual({ after: '3d' })
    expect(sessionArchiveOf(new AppSettingsStore(file).get())).toEqual({ after: '3d', ticketDone: true })

    // The other field merges in; the first stays.
    expect(store.set({ sessionArchive: { ticketDone: false } }).sessionArchive).toStrictEqual({ after: '3d', ticketDone: false })
    expect(new AppSettingsStore(file).get().sessionArchive).toStrictEqual({ after: '3d', ticketDone: false })

    // «Never», the default before worfy-canvas ticket 10, chosen: kept as chosen under the 24 h default.
    expect(store.set({ sessionArchive: { after: 'never' } }).sessionArchive).toStrictEqual({ after: 'never', ticketDone: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).sessionArchive).toStrictEqual({ after: 'never', ticketDone: false })
    expect(sessionArchiveOf(new AppSettingsStore(file).get())).toEqual({ after: 'never', ticketDone: false })

    // The same choice again writes nothing; another setting keeps the choice.
    expect(store.set({ sessionArchive: { after: 'never' } }).revision).toBe(5)
    expect(store.set({ interfaceScale: 1.2 }).sessionArchive).toStrictEqual({ after: 'never', ticketDone: false })
  })

  it('an archive threshold this version does not know (a newer one wrote it) reads as not chosen; the rest of the file stays', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.3, sessionArchive: { after: '12h', ticketDone: false } }))
    const read = new AppSettingsStore(file).get()
    expect(read.interfaceScale).toBe(1.3)
    expect(read.sessionArchive).toStrictEqual({ ticketDone: false })
    expect(sessionArchiveOf(read)).toEqual({ after: '24h', ticketDone: false })
  })

  it('the Browser sleep settings (worfy-browser ticket 05): an older file without the field gives the defaults; a choice is written, read back and kept field by field', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.2, memoryIndicator: false, revision: 4 }))
    const store = new AppSettingsStore(file)
    expect(store.get().browserSleep).toBeUndefined()
    expect(browserSleepOf(store.get())).toEqual({ maxLive: 3, offscreenSeconds: 30, idleMinutes: 5, zoom: 0.4 })
    expect(BROWSER_SLEEP_DEFAULTS).toEqual({ maxLive: 3, offscreenSeconds: 30, idleMinutes: 5, zoom: 0.4 })

    expect(store.set({ browserSleep: { maxLive: 5 } })).toMatchObject({ browserSleep: { maxLive: 5 }, revision: 5 })
    expect(JSON.parse(readFileSync(file, 'utf8')).browserSleep).toStrictEqual({ maxLive: 5 })
    // A second field keeps the first; the default value chosen is kept as chosen.
    expect(store.set({ browserSleep: { offscreenSeconds: 30, idleMinutes: 15, zoom: 0.25 } }).browserSleep).toStrictEqual({ maxLive: 5, offscreenSeconds: 30, idleMinutes: 15, zoom: 0.25 })
    const read = new AppSettingsStore(file).get()
    expect(read.browserSleep).toStrictEqual({ maxLive: 5, offscreenSeconds: 30, idleMinutes: 15, zoom: 0.25 })
    expect(read.interfaceScale).toBe(1.2)
    // The same choice again changes nothing.
    expect(store.set({ browserSleep: { maxLive: 5 } }).revision).toBe(6)
    expect(store.set({ interfaceScale: 1 }).browserSleep).toStrictEqual({ maxLive: 5, offscreenSeconds: 30, idleMinutes: 15, zoom: 0.25 })
  })

  it.each([
    ['N 0', { maxLive: 0 }, { maxLive: 1 }],
    ['N 11', { maxLive: 11 }, { maxLive: 10 }],
    ['N not whole', { maxLive: 2.5 }, { maxLive: 2 }],
    ['0 s off screen', { offscreenSeconds: 0 }, { offscreenSeconds: 1 }],
    ['an hour and a second off screen', { offscreenSeconds: 3601 }, { offscreenSeconds: 3600 }],
    ['0 min unused', { idleMinutes: 0 }, { idleMinutes: 1 }],
    ['241 min unused', { idleMinutes: 241 }, { idleMinutes: 240 }],
    ['zoom 0.05', { zoom: 0.05 }, { zoom: 0.1 }],
    ['zoom 1.5', { zoom: 1.5 }, { zoom: 1 }],
  ])('a Browser sleep setting outside its bounds in the file reads as not chosen, the rest of the file stays; the bound itself is taken: %s', (_case, outside, bound) => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.3, browserSleep: { idleMinutes: 7, ...outside } }))
    const read = new AppSettingsStore(file).get()
    expect(read.interfaceScale).toBe(1.3)
    const kept = 'idleMinutes' in outside ? {} : { idleMinutes: 7 }
    expect(read.browserSleep).toStrictEqual(Object.keys(kept).length === 0 ? undefined : kept)
    // At the bound it is a choice like any other.
    const atBound = freshFile()
    mkdirSync(join(atBound, '..'), { recursive: true })
    writeFileSync(atBound, JSON.stringify({ browserSleep: bound }))
    expect(new AppSettingsStore(atBound).get().browserSleep).toStrictEqual(bound)
  })

  it('the Autopilot budget (worfy-throughput ticket 41): an older file gives the defaults, off with 15 %; a choice is kept field by field, one outside the bounds in the file reads as not chosen', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.2, revision: 4 }))
    const store = new AppSettingsStore(file)
    expect(store.get().autopilotBudget).toBeUndefined()
    expect(autopilotBudgetOf(store.get())).toEqual({ enabled: false, reservePercent: 15 })
    expect(AUTOPILOT_BUDGET_DEFAULTS).toEqual({ enabled: false, reservePercent: 15 })

    expect(store.set({ autopilotBudget: { enabled: true } })).toMatchObject({ autopilotBudget: { enabled: true }, revision: 5 })
    expect(JSON.parse(readFileSync(file, 'utf8')).autopilotBudget).toStrictEqual({ enabled: true })
    expect(store.set({ autopilotBudget: { reservePercent: 25 } }).autopilotBudget).toStrictEqual({ enabled: true, reservePercent: 25 })
    expect(new AppSettingsStore(file).get().autopilotBudget).toStrictEqual({ enabled: true, reservePercent: 25 })
    // The same choice again changes nothing.
    expect(store.set({ autopilotBudget: { reservePercent: 25 } }).revision).toBe(6)

    const outside = freshFile()
    mkdirSync(join(outside, '..'), { recursive: true })
    writeFileSync(outside, JSON.stringify({ interfaceScale: 1.1, autopilotBudget: { enabled: 'yes', reservePercent: 51 } }))
    expect(new AppSettingsStore(outside).get()).toMatchObject({ interfaceScale: 1.1 })
    expect(autopilotBudgetOf(new AppSettingsStore(outside).get())).toEqual({ enabled: false, reservePercent: 15 })
  })

  it('the default Run mode and the Start window (worfy-resource-planner ticket 04): an older file gives none chosen; a choice is kept field by field and outlives the budget switch', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.2, autopilotBudget: { enabled: true }, revision: 4 }))
    const store = new AppSettingsStore(file)
    expect(store.get().autopilotRun).toBeUndefined()
    expect(autopilotRunOf(store.get())).toEqual({ mode: 'budget-aware', window: { from: 23, to: 7 } })

    expect(store.set({ autopilotRun: { mode: 'start-window' } })).toMatchObject({ autopilotRun: { mode: 'start-window' }, revision: 5 })
    expect(JSON.parse(readFileSync(file, 'utf8')).autopilotRun).toStrictEqual({ mode: 'start-window' })
    expect(store.set({ autopilotRun: { windowFrom: 22 } }).autopilotRun).toStrictEqual({ mode: 'start-window', windowFrom: 22 })
    expect(store.set({ autopilotRun: { windowTo: 6 } }).autopilotRun).toStrictEqual({ mode: 'start-window', windowFrom: 22, windowTo: 6 })
    expect(store.set({ autopilotBudget: { enabled: false } }).autopilotRun).toStrictEqual({ mode: 'start-window', windowFrom: 22, windowTo: 6 })
    const reread = new AppSettingsStore(file).get()
    expect(autopilotRunOf(reread)).toEqual({ mode: 'start-window', window: { from: 22, to: 6 } })
    expect(reread.autopilotBudget).toStrictEqual({ enabled: false })
    // The same choice again changes nothing.
    expect(store.set({ autopilotRun: { windowTo: 6 } }).revision).toBe(8)
  })

  it('a Start window whose edges meet is refused, given both at once or one against the other in force; nothing is written', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    store.set({ autopilotRun: { windowFrom: 22 } })
    const written = readFileSync(file, 'utf8')
    // 7 against the default end 07:00, and 22 against the chosen start.
    expect(() => store.set({ autopilotRun: { windowFrom: 7 } })).toThrow('the Start window cannot start and end at the same hour')
    expect(() => store.set({ autopilotRun: { windowTo: 22 } })).toThrow('the Start window cannot start and end at the same hour')
    expect(() => store.set({ autopilotRun: { mode: 'start-window', windowFrom: 5, windowTo: 5 } })).toThrow('the Start window cannot start and end at the same hour')
    expect(readFileSync(file, 'utf8')).toBe(written)
    expect(store.get().autopilotRun).toStrictEqual({ windowFrom: 22 })
    // Moving both edges at once past each other is one change, and allowed.
    expect(store.set({ autopilotRun: { windowFrom: 7, windowTo: 22 } }).autopilotRun).toStrictEqual({ windowFrom: 7, windowTo: 22 })
  })

  it('a Run choice the file holds by hand — a mode it does not know, an hour out of range, edges that meet — reads as not chosen; the rest of the file stays', () => {
    const unknown = freshFile()
    mkdirSync(join(unknown, '..'), { recursive: true })
    writeFileSync(unknown, JSON.stringify({ interfaceScale: 1.1, autopilotBudget: { reservePercent: 20 }, autopilotRun: { mode: 'overnight', windowFrom: 24, windowTo: 6.5 } }))
    const odd = new AppSettingsStore(unknown).get()
    expect(odd).toMatchObject({ interfaceScale: 1.1, autopilotBudget: { reservePercent: 20 } })
    expect(odd.autopilotRun).toBeUndefined()
    expect(autopilotRunOf(odd)).toEqual({ mode: 'fastest', window: { from: 23, to: 7 } })
    expect(readdirSync(join(unknown, '..')).some((name) => name.includes('.unreadable-'))).toBe(false)

    const meeting = freshFile()
    mkdirSync(join(meeting, '..'), { recursive: true })
    writeFileSync(meeting, JSON.stringify({ interfaceScale: 1.3, autopilotRun: { mode: 'start-window', windowFrom: 7 } }))
    const met = new AppSettingsStore(meeting).get()
    expect(met).toMatchObject({ interfaceScale: 1.3, autopilotRun: { mode: 'start-window' } })
    expect(autopilotRunOf(met)).toEqual({ mode: 'start-window', window: { from: 23, to: 7 } })

    const wrongType = freshFile()
    mkdirSync(join(wrongType, '..'), { recursive: true })
    writeFileSync(wrongType, JSON.stringify({ interfaceScale: 1.4, autopilotRun: 'start-window' }))
    expect(new AppSettingsStore(wrongType).get()).toMatchObject({ interfaceScale: 1.4 })
    expect(new AppSettingsStore(wrongType).get().autopilotRun).toBeUndefined()
  })

  it('a Browser sleep field of the wrong type reads as not chosen, and the file is not set aside', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.1, browserSleep: { maxLive: 'many', zoom: 0.5 } }))
    expect(new AppSettingsStore(file).get()).toMatchObject({ interfaceScale: 1.1, browserSleep: { zoom: 0.5 } })
    expect(readdirSync(join(file, '..'))).toEqual([APP_SETTINGS_FILE])
  })

  it.each([
    ['not JSON', '{ "interfaceScale": '],
    ['a wrong type', JSON.stringify({ interfaceScale: 'big' })],
    // The value is a valid boolean in each of these: only the section id makes the file unreadable.
    ['a section id with a space and punctuation', JSON.stringify({ sidebar: { collapsed: { 'bad id!': true } } })],
    ['a section id that starts with an underscore', JSON.stringify({ sidebar: { collapsed: { _x: true } } })],
    ['a section id that is a path', JSON.stringify({ sidebar: { collapsed: { '../x': true } } })],
    ['an array', '[]'],
  ])('sets an unreadable file aside as app-settings.json.unreadable-<time> and starts from the defaults: %s', (_case, text) => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const store = new AppSettingsStore(file, { now: fixedNow })
      expect(store.get()).toStrictEqual(DEFAULT_APP_SETTINGS)
    } finally {
      warn.mockRestore()
    }
    const folder = join(file, '..')
    expect(readdirSync(folder)).toEqual([`${APP_SETTINGS_FILE}.unreadable-2026-10-10T07-08-09-010Z`])
    expect(readFileSync(join(folder, `${APP_SETTINGS_FILE}.unreadable-2026-10-10T07-08-09-010Z`), 'utf8')).toBe(text)
  })

  it('a write that fails changes nothing in memory and announces nothing', () => {
    const file = freshFile()
    // A folder where the file should be: the rename over it fails.
    mkdirSync(file, { recursive: true })
    // Reading a folder is an I/O error, not an unreadable file: the defaults, with a warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const store = new AppSettingsStore(file)
      const events: AppSettings[] = []
      store.on('changed', (state) => events.push(state))
      expect(() => store.set({ interfaceScale: 1.2 })).toThrow()
      expect(store.get()).toStrictEqual(DEFAULT_APP_SETTINGS)
      expect(events).toEqual([])
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  it('creating a store reads no disk; the first get reads the file, once', () => {
    const file = freshFile()
    new AppSettingsStore(file).set({ interfaceScale: 1.2 })
    disk.reads.length = 0
    const store = new AppSettingsStore(file)
    store.on('changed', () => undefined)
    expect(disk.reads).toEqual([])
    expect(store.get().interfaceScale).toBe(1.2)
    expect(disk.reads).toEqual([file])
    store.get()
    store.set({ interfaceScale: 1.3 })
    expect(disk.reads).toEqual([file])
  })

  it('announces `changed` with the new state for the modules of main', () => {
    const store = new AppSettingsStore(freshFile())
    const events: AppSettings[] = []
    store.on('changed', (state) => events.push(state))
    const state = store.set({ interfaceScale: 1.1 })
    expect(events).toStrictEqual([state])
    // The listener gets a copy: changing it does not change the store.
    events[0]!.sidebar.collapsed.Hacked = true
    expect(store.get().sidebar.collapsed).toStrictEqual({})
  })
})

describe('clampScale', () => {
  it('brings any number into 0.8–1.5 by steps of 0.1; a value that is not a number becomes 1', () => {
    expect([0.8, 0.84, 0.85, 1, 1.04, 1.15, 1.5, 1.55, 3, -1, 0].map(clampScale)).toEqual([0.8, 0.8, 0.9, 1, 1, 1.2, 1.5, 1.5, 1.5, 0.8, 0.8])
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1.5)
    // No binary tails: 0.7 + 0.2 would be 0.8999999999999999.
    for (let tenths = 8; tenths <= 15; tenths++) expect(String(clampScale(tenths / 10 + 1e-9))).toBe(String(tenths / 10))
  })
})

// ── the IPC domain ─────────────────────────────────────────────────────────────────────────────

const loadModule: ModuleLoader = () => import('../../src/main/ipc/app-settings').then((module) => module.default)

/** The handlers of src/main/ipc/app-settings.ts as the app's windows reach them. */
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

beforeEach(() => {
  electron.sent.length = 0
})

describe('appSettings channels', () => {
  // First on purpose: nothing has imported src/main/ipc/app-settings.ts yet. Were it imported
  // already, the last check would fail, the file having been read before.
  it('importing the handler module reads no disk; the first call reads app-settings.json', async () => {
    disk.reads.length = 0
    const call = await windowCaller()
    expect(disk.reads).toEqual([])
    expect(await call('appSettings.get')).toMatchObject({ ok: true })
    expect(disk.reads).toEqual([settingsFile])
  })

  it('appSettings.get answers the defaults while there is no file', async () => {
    const call = await windowCaller()
    expect(existsSync(settingsFile)).toBe(false)
    expect(await call('appSettings.get')).toStrictEqual({ ok: true, value: DEFAULT_APP_SETTINGS })
  })

  it('appSettings.set writes app-settings.json, answers the new state and sends appSettings.changed to every window', async () => {
    const call = await windowCaller()
    const answer = await call('appSettings.set', { sidebar: { collapsed: { MachinesSection: true } } })
    const state = { ...DEFAULT_APP_SETTINGS, sidebar: { collapsed: { MachinesSection: true }, visible: { normal: true, focus: true } }, revision: 1 }
    expect(answer).toStrictEqual({ ok: true, value: state })
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toStrictEqual(state)
    expect(electron.sent).toStrictEqual([
      { window: 'first', channel: `${IPC_CHANNEL_PREFIX}appSettings.changed`, payload: state },
      { window: 'second', channel: `${IPC_CHANNEL_PREFIX}appSettings.changed`, payload: state },
    ])

    // A second section does not clear the first; the scale is brought into range.
    const next = await call('appSettings.set', { interfaceScale: 3, sidebar: { collapsed: { ProjectsSection: true } } })
    expect(next).toMatchObject({ ok: true, value: { interfaceScale: 1.5, sidebar: { collapsed: { MachinesSection: true, ProjectsSection: true } }, revision: 2 } })
    expect(await call('appSettings.get')).toStrictEqual(next)
  })

  it('appSettings.set takes the archive choice and refuses a threshold outside the five (worfy-canvas ticket 08)', async () => {
    const call = await windowCaller()
    expect(await call('appSettings.set', { sessionArchive: { after: '7d', ticketDone: false } })).toMatchObject({ ok: true, value: { sessionArchive: { after: '7d', ticketDone: false } } })
    expect((await call('appSettings.set', { sessionArchive: { after: '12h' } })).ok).toBe(false)
    expect(await call('appSettings.get')).toMatchObject({ ok: true, value: { sessionArchive: { after: '7d', ticketDone: false } } })
  })

  it('appSettings.set takes the Browser sleep settings within their bounds and refuses one outside them (worfy-browser ticket 05)', async () => {
    const call = await windowCaller()
    expect(await call('appSettings.set', { browserSleep: { maxLive: 10, offscreenSeconds: 1, idleMinutes: 240, zoom: 0.1 } })).toMatchObject({
      ok: true,
      value: { browserSleep: { maxLive: 10, offscreenSeconds: 1, idleMinutes: 240, zoom: 0.1 } },
    })
    for (const outside of [{ maxLive: 0 }, { maxLive: 11 }, { maxLive: 1.5 }, { offscreenSeconds: 0 }, { offscreenSeconds: 3601 }, { idleMinutes: 0 }, { idleMinutes: 241 }, { zoom: 0.09 }, { zoom: 1.01 }]) {
      expect((await call('appSettings.set', { browserSleep: outside })).ok, JSON.stringify(outside)).toBe(false)
    }
    expect(await call('appSettings.get')).toMatchObject({ ok: true, value: { browserSleep: { maxLive: 10, offscreenSeconds: 1, idleMinutes: 240, zoom: 0.1 } } })
  })

  it('appSettings.set takes the language of the Guide, en or ru, and refuses any other (worfy-guide ticket 03)', async () => {
    const call = await windowCaller()
    expect(await call('appSettings.set', { guideLanguage: 'ru' })).toMatchObject({ ok: true, value: { guideLanguage: 'ru' } })
    for (const outside of ['de', 'RU', '', 1, null]) {
      expect((await call('appSettings.set', { guideLanguage: outside })).ok, JSON.stringify(outside)).toBe(false)
    }
    expect(await call('appSettings.get')).toMatchObject({ ok: true, value: { guideLanguage: 'ru' } })
  })

  it('appSettings.set takes the Autopilot budget within its bounds and refuses a reserve outside them (worfy-throughput ticket 41)', async () => {
    const call = await windowCaller()
    expect(await call('appSettings.set', { autopilotBudget: { enabled: true, reservePercent: 50 } })).toMatchObject({ ok: true, value: { autopilotBudget: { enabled: true, reservePercent: 50 } } })
    for (const outside of [{ reservePercent: -1 }, { reservePercent: 51 }, { reservePercent: 12.5 }, { enabled: 'no' }]) {
      expect((await call('appSettings.set', { autopilotBudget: outside })).ok, JSON.stringify(outside)).toBe(false)
    }
    expect(await call('appSettings.get')).toMatchObject({ ok: true, value: { autopilotBudget: { enabled: true, reservePercent: 50 } } })
  })

  it('appSettings.set takes the Run mode and the Start window by whole hours, and refuses a mode it does not know, an hour off 0–23 and edges that meet (worfy-resource-planner ticket 04)', async () => {
    const call = await windowCaller()
    expect(await call('appSettings.set', { autopilotRun: { mode: 'start-window', windowFrom: 22, windowTo: 6 } })).toMatchObject({ ok: true, value: { autopilotRun: { mode: 'start-window', windowFrom: 22, windowTo: 6 } } })
    for (const outside of [{ mode: 'overnight' }, { windowFrom: 24 }, { windowTo: -1 }, { windowFrom: 1.5 }, { windowFrom: 3, windowTo: 3 }, { windowFrom: 6 }]) {
      expect((await call('appSettings.set', { autopilotRun: outside })).ok, JSON.stringify(outside)).toBe(false)
    }
    expect(await call('appSettings.set', { autopilotRun: { windowTo: 22 } })).toMatchObject({ ok: false, error: 'appSettings.set failed: the Start window cannot start and end at the same hour' })
    expect(await call('appSettings.get')).toMatchObject({ ok: true, value: { autopilotRun: { mode: 'start-window', windowFrom: 22, windowTo: 6 } } })
  })

  it('a change made in main (a menu item) reaches every window too', async () => {
    await windowCaller()
    const { appSettingsStore } = await import('../../src/main/settings/store')
    const state = appSettingsStore().set({ sidebar: { visible: { normal: false } } })
    expect(electron.sent.map((sent) => [sent.window, sent.payload])).toStrictEqual([
      ['first', state],
      ['second', state],
    ])
  })

  it('appSettings.set refuses an input outside the contract and changes nothing', async () => {
    const call = await windowCaller()
    const before = await call('appSettings.get')
    for (const input of [{ interfaceScale: 'big' }, { sidebar: { collapsed: { MachinesSection: 'yes' } } }, { sidebar: { visible: { normal: 1 } } }, { sidebar: { collapsed: { '': true } } }, { autoCompactWindow: { orchestrator: 'default' } }]) {
      const answer = await call('appSettings.set', input)
      expect(answer.ok, JSON.stringify(input)).toBe(false)
    }
    // A section id that is not a file name, with a value that is a valid boolean: the id alone is refused.
    for (const id of ['bad id!', '_x', '../x', 'a'.repeat(101)]) {
      const answer = await call('appSettings.set', { sidebar: { collapsed: { [id]: true } } })
      expect(answer, id).toMatchObject({ ok: false, error: expect.stringContaining('appSettings.set: invalid input') })
    }
    // The ids a section file can have are taken.
    expect(appSettingsSet.input.safeParse({ sidebar: { collapsed: { MachinesSection: true, Docs2Section: false, 'a-b_c': true } } }).success).toBe(true)
    expect(await call('appSettings.get')).toStrictEqual(before)
    expect(electron.sent).toEqual([])
  })

  it('an own `__proto__` key in `collapsed` changes nothing, from a call and from the file', async () => {
    // Parsed from text, as a call or a file arrives: `__proto__` is then an own key, not the prototype.
    const text = '{"sidebar":{"collapsed":{"__proto__":true}}}'
    const call = await windowCaller()
    const before = await call('appSettings.get')
    const answer = await call('appSettings.set', JSON.parse(text))
    expect(answer).toStrictEqual(before)
    expect(electron.sent).toEqual([])

    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
    const { collapsed } = new AppSettingsStore(file).get().sidebar
    expect(Object.keys(collapsed)).toEqual([])
    expect(Object.getPrototypeOf(collapsed)).toBe(Object.prototype)
  })

  it('the contract drops undeclared keys of the state and refuses a missing field', () => {
    expect(appSettingsGet.output.parse({ ...DEFAULT_APP_SETTINGS, evil: 1 })).toStrictEqual(DEFAULT_APP_SETTINGS)
    expect(appSettingsChanged.payload.safeParse({ interfaceScale: 1, revision: 0 }).success).toBe(false)
    expect(appSettingsSet.input.parse({ interfaceScale: 1.1, theme: 'x' })).toStrictEqual({ interfaceScale: 1.1 })
  })
})

// ── a Linked machine ─────────────────────────────────────────────────────────────────────────────

const LINKED = '55555555-5555-4555-8555-555555555555'

describe('appSettings and a Linked machine', () => {
  it('all three channels are marked `local`', () => {
    expect([appSettingsGet.access, appSettingsSet.access, appSettingsChanged.access]).toEqual(['local', 'local', 'local'])
  })

  it('the link adapter registers neither call, and refuses both even with access on; nothing is written', async () => {
    // A `project` channel next to them, so an adapter that registered nothing would not pass.
    const sample = await import('./ipc-sample/main/sample')
    sample.echoCalls.length = 0
    const modules: Record<string, ModuleLoader> = { './app-settings.ts': loadModule, './sample.ts': async () => sample.default }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    expect(adapter.channels()).toEqual(['sample.echo'])

    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('all')
    const before = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null
    expect(await adapter.call(peer, 'appSettings.set', { interfaceScale: 1.5 }, 'Beta')).toEqual({ ok: false, error: 'appSettings.set: not open to Linked machines' })
    expect(await adapter.call(peer, 'appSettings.get', undefined, 'Beta')).toEqual({ ok: false, error: 'appSettings.get: not open to Linked machines' })
    expect(existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null).toBe(before)
    expect(await adapter.call(peer, 'sample.echo', { text: 'hi' }, 'Beta')).toEqual({ ok: true, value: { echoed: 'hi' } })
    expect(sample.echoCalls).toEqual(['hi'])
  })

  it('appSettings.changed does not reach the connection of a Linked machine', async () => {
    await windowCaller()
    const pushed: string[] = []
    const local = () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' })
    const project = new LinkSender(LINKED, 'project', (channel) => pushed.push(channel), local)
    const link = new LinkSender(LINKED, 'link', (channel) => pushed.push(channel), local)
    addClient(project)
    addClient(link)
    try {
      const { appSettingsStore } = await import('../../src/main/settings/store')
      appSettingsStore().set({ interfaceScale: appSettingsStore().get().interfaceScale === 1.1 ? 1.2 : 1.1 })
      // The windows heard it; the connection did not.
      expect(electron.sent.map((sent) => sent.window)).toEqual(['first', 'second'])
      expect(pushed).toEqual([])
    } finally {
      project.destroy()
      link.destroy()
    }
  })
})
