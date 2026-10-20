// worfy-harness ticket 40: every window learns that the Harness changed, without a reload. Main sends
// `harness.changed` to every window after each install whose answer is `done` — from the toolbar's
// `harness.install` and from the first-run screen alike, as both call appInstaller().install — and
// `harnessMigration.changed` after a move of the old Harness whose answer is `done`. Over a mocked
// `electron` with two fake windows; the installer and the move are fakes with scripted answers, so
// nothing runs `claude` and nothing reaches the real ~/.claude (WORFY_CLAUDE_HOME is a temp folder).
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { accessOf, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import type { MigrationResult } from '../../src/shared/ipc/harness-migration'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-harness-changed-')))
  // A sandbox: the installer may install (installOffered), and no path reaches the real ~/.claude.
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude')
  process.env.WORFY_HARNESS_HOME = path.join(scratch, 'harness')
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

afterAll(() => removeTestTree(env.scratch))

const electron = vi.hoisted(() => {
  const sent: { window: string; channel: string; payload: unknown }[] = []
  const windowOf = (window: string) => {
    const webContents = { send: (channel: string, payload: unknown) => sent.push({ window, channel, payload }) }
    return { isDestroyed: () => false, webContents }
  }
  const windows = [windowOf('first'), windowOf('second')]
  return { sent, windows }
})

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: {
    getAllWindows: () => electron.windows,
    fromWebContents: (webContents: unknown) => electron.windows.find((window) => window.webContents === webContents) ?? null,
  },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
}))

type InstallResult = { outcome: 'done' | 'declined' | 'nothing-to-do'; status: HarnessStatus }

/** The fake installer's script: the answer of the next run, and how many runs started. */
const installs = vi.hoisted(() => ({
  next: null as null | (() => Promise<unknown>),
  runs: 0,
  calls: 0,
}))

vi.mock('../../src/main/harness/install', async (original) => {
  const actual = await original<typeof import('../../src/main/harness/install')>()
  /** As the real one: a second call while a run is going gets the same promise. */
  class FakeInstaller {
    private running: Promise<unknown> | null = null
    status(): Promise<unknown> {
      return Promise.reject(new Error('not read in this test'))
    }
    install(): Promise<unknown> {
      if (installs.next === null) return Promise.reject(new Error('no install scripted'))
      const next = installs.next
      installs.calls++
      this.running ??= (installs.runs++, next()).finally(() => {
        this.running = null
      })
      return this.running
    }
  }
  return { ...actual, HarnessInstaller: FakeInstaller }
})

const migration = vi.hoisted(() => ({ result: null as unknown, legacy: true as boolean | 'throws' }))

vi.mock('../../src/main/harness/migrate/apply', async (original) => ({
  ...(await original<typeof import('../../src/main/harness/migrate/apply')>()),
  applyMigration: () => Promise.resolve(migration.result),
}))

vi.mock('../../src/main/harness/migrate/plan', async (original) => ({
  ...(await original<typeof import('../../src/main/harness/migrate/plan')>()),
  hasLegacyHarness: () => {
    if (migration.legacy === 'throws') throw new Error("EACCES: permission denied, scandir '/sandbox/claude'")
    return migration.legacy
  },
}))

const status = (kind: 'installed' | 'not-installed' | 'error'): HarnessStatus => ({
  state:
    kind === 'installed'
      ? { kind, version: '0.2.0+bbbbbbb', enabled: true }
      : kind === 'error'
        ? { kind, step: 'install', reason: 'claude plugin install worfy@worfy exited with 1' }
        : { kind },
  bundledVersion: '0.2.0+bbbbbbb',
  canInstall: true,
  pluginDir: '/sandbox/worfy-harness/plugin',
  dependencies: [],
})

const modules: Record<string, ModuleLoader> = {
  './harness.ts': () => import('../../src/main/ipc/harness').then((module) => module.default),
  './harness-migration.ts': () => import('../../src/main/ipc/harness-migration').then((module) => module.default),
}

/** The handlers as window `first` reaches them. */
async function firstWindowCaller(): Promise<(channel: string, input?: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { modules, isTrustedSender: () => true })
  const event = { senderFrame: { url: 'app://index.html' }, sender: electron.windows[0]?.webContents } as unknown as IpcMainInvokeEvent
  return async (channel, input) => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

const events = (channel: string) => electron.sent.filter((sent) => sent.channel === IPC_CHANNEL_PREFIX + channel).map((sent) => [sent.window, sent.payload])

beforeEach(() => {
  electron.sent.length = 0
  installs.next = null
  installs.runs = 0
  installs.calls = 0
  migration.result = null
  migration.legacy = true
})

describe('harness.changed', () => {
  it('is `local`: the Harness belongs to the machine the window runs on', async () => {
    await import('../../src/shared/ipc/harness')
    expect(accessOf('harness.changed')).toBe('local')
  })

  it('after an install from the toolbar (`harness.install`) with `done`, every window gets the status the call answered', async () => {
    const call = await firstWindowCaller()
    const installed = status('installed')
    installs.next = () => Promise.resolve({ outcome: 'done', status: installed } satisfies InstallResult)
    expect(await call('harness.install')).toStrictEqual({ ok: true, value: { outcome: 'done', status: installed } })
    expect(events('harness.changed')).toStrictEqual([
      ['first', installed],
      ['second', installed],
    ])
  })

  it('after an install from the first-run screen (appInstaller().install, not `harness.install`) with `done`, every window gets it too', async () => {
    const { appInstaller } = await import('../../src/main/ipc/harness')
    const installed = status('installed')
    installs.next = () => Promise.resolve({ outcome: 'done', status: installed } satisfies InstallResult)
    expect(await appInstaller().install(() => Promise.resolve(true))).toStrictEqual({ outcome: 'done', status: installed })
    expect(events('harness.changed')).toStrictEqual([
      ['first', installed],
      ['second', installed],
    ])
  })

  it('a step that failed after the consent answers `done` with the error state: every window gets the error', async () => {
    const { appInstaller } = await import('../../src/main/ipc/harness')
    const failed = status('error')
    installs.next = () => Promise.resolve({ outcome: 'done', status: failed } satisfies InstallResult)
    await appInstaller().install(() => Promise.resolve(true))
    expect(events('harness.changed')).toStrictEqual([
      ['first', failed],
      ['second', failed],
    ])
  })

  it.each(['declined', 'nothing-to-do'] as const)('after `%s` (Cancel in the dialog, or nothing to do) no window gets an event', async (outcome) => {
    const call = await firstWindowCaller()
    installs.next = () => Promise.resolve({ outcome, status: status('not-installed') } satisfies InstallResult)
    expect(await call('harness.install')).toMatchObject({ ok: true, value: { outcome } })
    const { appInstaller } = await import('../../src/main/ipc/harness')
    await appInstaller().install(() => Promise.resolve(false))
    expect(events('harness.changed')).toStrictEqual([])
  })

  it('an install that throws sends nothing and the caller gets the error', async () => {
    const call = await firstWindowCaller()
    installs.next = () => Promise.reject(new Error('claude is missing'))
    expect(await call('harness.install')).toMatchObject({ ok: false })
    expect(events('harness.changed')).toStrictEqual([])
  })

  it('two calls during one run (toolbar and first-run screen at once) announce that run once', async () => {
    const call = await firstWindowCaller()
    const { appInstaller } = await import('../../src/main/ipc/harness')
    const installed = status('installed')
    let finish: (result: InstallResult) => void = () => undefined
    installs.next = () => new Promise<InstallResult>((resolve) => (finish = resolve))
    const fromFirstRun = appInstaller().install(() => Promise.resolve(true))
    const fromToolbar = call('harness.install')
    // The toolbar's call goes through the IPC wrapper first; it joins the run before the run ends.
    await vi.waitFor(() => expect(installs.calls).toBe(2))
    finish({ outcome: 'done', status: installed })
    await Promise.all([fromToolbar, fromFirstRun])
    expect(installs.runs).toBe(1)
    expect(events('harness.changed')).toStrictEqual([
      ['first', installed],
      ['second', installed],
    ])
  })
})

describe('harnessMigration.changed', () => {
  const selection = { choices: {}, profiles: {} }

  it('is `local`', async () => {
    await import('../../src/shared/ipc/harness-migration')
    expect(accessOf('harnessMigration.changed')).toBe('local')
  })

  it('after a move with `done`, every window gets the new offer: nothing left to move', async () => {
    const call = await firstWindowCaller()
    migration.result = { outcome: 'done', backupDir: '/sandbox/backup', restoreCommand: 'node /sandbox/backup/restore.mjs' } satisfies MigrationResult
    migration.legacy = false
    expect(await call('harnessMigration.apply', selection)).toMatchObject({ ok: true, value: { outcome: 'done' } })
    expect(events('harnessMigration.changed')).toStrictEqual([
      ['first', { offered: false }],
      ['second', { offered: false }],
    ])
  })

  it('a move with `done` still answers the form when the new offer cannot be read; no window gets an event', async () => {
    const call = await firstWindowCaller()
    const done = { outcome: 'done', backupDir: '/sandbox/backup', restoreCommand: 'node /sandbox/backup/restore.mjs' } satisfies MigrationResult
    migration.result = done
    migration.legacy = 'throws'
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await call('harnessMigration.apply', selection)).toStrictEqual({ ok: true, value: done })
      expect(events('harnessMigration.changed')).toStrictEqual([])
      expect(String(logged.mock.calls[0]?.[0])).toContain('harnessMigration.changed was not sent')
    } finally {
      logged.mockRestore()
    }
  })

  it.each([{ outcome: 'declined' }, { outcome: 'refused', reason: 'the plugin is not installed' }] satisfies MigrationResult[])('after `$outcome` no window gets an event', async (result) => {
    const call = await firstWindowCaller()
    migration.result = result
    expect(await call('harnessMigration.apply', selection)).toMatchObject({ ok: true, value: { outcome: result.outcome } })
    expect(events('harnessMigration.changed')).toStrictEqual([])
  })
})
