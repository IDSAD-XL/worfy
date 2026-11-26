// The Assistant's own settings (worfy-assistant tickets 15 and 25): `assistant` of app-settings.json — off until the person
// turns it on, since when it is on, the daily limit of automatic wakes, the notifications — kept by the store of main (src/main/settings/store.ts) and changed through
// the `appSettings` channels; and the channels of Settings → Assistant and of Apply in the `assistant` domain, all
// `local`. A mocked `electron` and a temporary WORFY_DATA_DIR; the section and the panel behind the handlers are fakes
// that record what they get (their behaviour is test/unit/assistant-window.test.ts and assistant-settings-panel.test.ts).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { APP_SETTINGS_FILE, AppSettingsStore } from '../../src/main/settings/store'
import { ASSISTANT_DAILY_WAKE_LIMIT } from '../../src/shared/assistant/budget'
import { assistantOn, assistantOnSince, dailyWakeLimitOf, inWindowOf, systemNoticesOf } from '../../src/shared/assistant/settings'
import { assistantApply, assistantCheckNow, assistantConfigureDuty, assistantPauseAfter, assistantResumeDuty, assistantSettings, assistantUndo } from '../../src/shared/ipc/assistant'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-assistant-settings-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: () => undefined } }] },
}))

const ON_AT = Date.UTC(2026, 10, 23, 9, 12)

const folders: string[] = []
function freshFile(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-assistant-settings-store-')))
  folders.push(folder)
  return join(folder, APP_SETTINGS_FILE)
}

afterAll(() => {
  for (const folder of folders.splice(0)) removeTestTree(folder)
  removeTestTree(env.scratch)
})

describe('assistant in app-settings.json', () => {
  it('off and the default daily limit while nothing is chosen, for a new user and for one whose file was written before the field', () => {
    expect(assistantOn(new AppSettingsStore(freshFile()).get())).toBe(false)
    const older = freshFile()
    mkdirSync(join(older, '..'), { recursive: true })
    writeFileSync(older, JSON.stringify({ interfaceScale: 1.1, assistantSchedule: { checks: { slack: { enabled: true } } }, revision: 7 }))
    const read = new AppSettingsStore(older).get()
    expect(assistantOn(read)).toBe(false)
    expect(dailyWakeLimitOf(read)).toBe(ASSISTANT_DAILY_WAKE_LIMIT)
  })

  it('a choice is written, read back after a restart and changed field by field', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file, { now: () => new Date(ON_AT) })
    expect(store.set({ assistant: { on: true } })).toMatchObject({ assistant: { on: true }, revision: 1 })
    expect(store.set({ assistant: { dailyWakeLimit: 8 } }).assistant).toStrictEqual({ on: true, onSince: ON_AT, dailyWakeLimit: 8 })
    expect(JSON.parse(readFileSync(file, 'utf8')).assistant).toStrictEqual({ on: true, onSince: ON_AT, dailyWakeLimit: 8 })
    const reread = new AppSettingsStore(file).get()
    expect([assistantOn(reread), dailyWakeLimitOf(reread)]).toEqual([true, 8])
    // The same choice again writes nothing; turning it off keeps the limit.
    expect(store.set({ assistant: { on: true } }).revision).toBe(2)
    expect(store.set({ assistant: { on: false } }).assistant).toStrictEqual({ on: false, dailyWakeLimit: 8 })
  })

  it('«On since …» (ticket 25): main stamps the time the switch turns on, keeps it while on and after a restart, drops it when off', () => {
    const file = freshFile()
    let now = ON_AT
    const store = new AppSettingsStore(file, { now: () => new Date(now) })
    store.set({ assistant: { on: true } })
    now += 3_600_000
    // Turning it on again, or another field, keeps the first time.
    store.set({ assistant: { on: true, dailyWakeLimit: 9 } })
    expect(assistantOnSince(new AppSettingsStore(file).get())).toBe(ON_AT)
    store.set({ assistant: { on: false } })
    expect(store.get().assistant).toStrictEqual({ on: false, dailyWakeLimit: 9 })
    expect(assistantOnSince(store.get())).toBeNull()
    store.set({ assistant: { on: true } })
    expect(assistantOnSince(new AppSettingsStore(file).get())).toBe(ON_AT + 3_600_000)
  })

  it('settings without the time, written before ticket 25, read: on, with no «On since …»; a patch cannot set the time', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1, assistant: { on: true, dailyWakeLimit: 8 }, revision: 3 }))
    const store = new AppSettingsStore(file, { now: () => new Date(ON_AT) })
    expect([assistantOn(store.get()), assistantOnSince(store.get())]).toEqual([true, null])
    store.set({ assistant: { on: true, onSince: 5 } as never })
    expect(assistantOnSince(store.get())).toBeNull()
  })

  it('the notifications (ticket 25): urgent and batched in the window and the system ones on while not chosen; a choice is kept', () => {
    const file = freshFile()
    const store = new AppSettingsStore(file)
    expect([inWindowOf(store.get()), systemNoticesOf(store.get())]).toEqual(['batched', true])
    store.set({ assistant: { inWindow: 'none', systemNotices: false } })
    const reread = new AppSettingsStore(file).get()
    expect([inWindowOf(reread), systemNoticesOf(reread)]).toEqual(['none', false])
    store.set({ assistant: { inWindow: 'urgent' } })
    expect([inWindowOf(store.get()), systemNoticesOf(store.get())]).toEqual(['urgent', false])
  })

  it('a field the file holds by hand that the schema refuses reads as not chosen; the file is not set aside', () => {
    const file = freshFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ interfaceScale: 1.2, assistant: { on: 'yes', dailyWakeLimit: 0 } }))
    const read = new AppSettingsStore(file).get()
    expect(read.interfaceScale).toBe(1.2)
    expect(read.assistant).toBeUndefined()
  })
})

async function caller(modules: Record<string, ModuleLoader>): Promise<(channel: string, input?: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { modules, isTrustedSender: () => true })
  const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
  return async (channel, input) => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

describe('the channels of Settings → Assistant and of Apply', () => {
  it('appSettings.set takes the switch and the daily limit, and refuses a limit off its bounds', async () => {
    const call = await caller({ './app-settings.ts': () => import('../../src/main/ipc/app-settings').then((module) => module.default) })
    expect(await call('appSettings.set', { assistant: { on: true, dailyWakeLimit: 12 } })).toMatchObject({ ok: true, value: { assistant: { on: true, dailyWakeLimit: 12 } } })
    expect(await call('appSettings.set', { assistant: { inWindow: 'urgent', systemNotices: false } })).toMatchObject({ ok: true, value: { assistant: { inWindow: 'urgent', systemNotices: false } } })
    for (const outside of [{ dailyWakeLimit: 0 }, { dailyWakeLimit: 201 }, { dailyWakeLimit: 2.5 }, { on: 'yes' }, { inWindow: 'all' }, { systemNotices: 'off' }]) {
      expect((await call('appSettings.set', { assistant: outside })).ok, JSON.stringify(outside)).toBe(false)
    }
  })

  it('every channel is local, so a Linked machine never reaches them', () => {
    expect([assistantApply, assistantUndo, assistantSettings, assistantConfigureDuty, assistantResumeDuty, assistantPauseAfter, assistantCheckNow].map((channel) => channel.access)).toEqual(['local', 'local', 'local', 'local', 'local', 'local', 'local'])
  })

  it('each reaches its function in main; a refusal comes back with its reason; a mode outside the list never reaches main', async () => {
    const got: unknown[] = []
    const section = {
      apply: (proposalId: string) => {
        if (proposalId === 'gone') throw new Error('This proposal is no longer there')
        got.push(['apply', proposalId])
      },
      undo: (proposalId: string) => {
        if (proposalId === 'moved') throw new Error('Changed since Apply, so Undo would overwrite it: Slack interval')
        got.push(['undo', proposalId])
      },
    }
    const panel = {
      view: () => ({ running: false }),
      configureDuty: (id: string, choice: unknown) => void got.push(['configure', id, choice]),
      resumeDuty: (id: string) => void got.push(['resume', id]),
      setPauseAfter: (count: number) => void got.push(['pauseAfter', count]),
      checkNow: (kind: string) => (got.push(['checkNow', kind]), kind === 'slack' ? { started: true, refused: null } : { started: false, refused: 'check-off' }),
    }
    const call = await caller({
      './assistant.ts': () => import('../../src/main/ipc/assistant').then((module) => module.assistantHandlers(() => section as never, undefined, () => panel as never)),
    })
    expect(await call('assistant.apply', { proposalId: 'p1' })).toEqual({ ok: true, value: {} })
    expect(await call('assistant.apply', { proposalId: 'gone' })).toMatchObject({ ok: false, error: expect.stringContaining('This proposal is no longer there') })
    expect(await call('assistant.undo', { proposalId: 'p1' })).toEqual({ ok: true, value: {} })
    expect(await call('assistant.undo', { proposalId: 'moved' })).toMatchObject({ ok: false, error: expect.stringContaining('Slack interval') })
    expect(await call('assistant.configureDuty', { dutyId: 'waits-for-user', modes: { 'pr-follow': 'hand-over' } })).toEqual({ ok: true, value: {} })
    expect(await call('assistant.configureDuty', { dutyId: 'waits-for-user', projects: ['p-shop'] })).toEqual({ ok: true, value: {} })
    expect(await call('assistant.configureDuty', { dutyId: 'waits-for-user', projects: 'all' })).toEqual({ ok: true, value: {} })
    expect((await call('assistant.configureDuty', { dutyId: 'waits-for-user', projects: 'some' })).ok).toBe(false)
    expect((await call('assistant.configureDuty', { dutyId: 'waits-for-user', modes: { 'pr-follow': 'always' } })).ok).toBe(false)
    expect(await call('assistant.resumeDuty', { dutyId: 'source:slack' })).toEqual({ ok: true, value: {} })
    expect(await call('assistant.pauseAfter', { count: 3 })).toEqual({ ok: true, value: {} })
    expect((await call('assistant.pauseAfter', { count: 0 })).ok).toBe(false)
    expect(await call('assistant.checkNow', { kind: 'slack' })).toEqual({ ok: true, value: { started: true, refused: null } })
    expect(await call('assistant.checkNow', { kind: 'jira' })).toEqual({ ok: true, value: { started: false, refused: 'check-off' } })
    expect(got).toEqual([
      ['apply', 'p1'],
      ['undo', 'p1'],
      ['configure', 'waits-for-user', { modes: { 'pr-follow': 'hand-over' } }],
      ['configure', 'waits-for-user', { projects: ['p-shop'] }],
      ['configure', 'waits-for-user', { projects: 'all' }],
      ['resume', 'source:slack'],
      ['pauseAfter', 3],
      ['checkNow', 'slack'],
      ['checkNow', 'jira'],
    ])
  })
})
