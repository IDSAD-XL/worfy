// The sticky toasts of Update (worfy-update ticket 07; spec, owner's points 5, 7 and 8, R11 and R12)
// over the real toast store (src/renderer/toast/toasts.ts) and a fake Update store: the snapshots
// and the Harness status are handed in by the test, the calls to main are recorded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
import { dismissToast, pressToastAction, resetToasts, toasts, type Toast } from '../../src/renderer/toast/toasts'
import {
  AVAILABLE_KEY,
  createUpdateToasts,
  FAILED_KEY,
  HARNESS_AFTER_UPDATE_KEY,
  HARNESS_KEY,
  READY_KEY,
  RESTART_RESULT_KEY,
  WAITING_KEY,
  type UpdateToastActions,
} from '../../src/renderer/update/toasts'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

const SHA = 'b'.repeat(40)
const VERSION = `0.6.0+${SHA.slice(0, 7)}`

const snapshot = (change: Partial<UpdateSnapshot> = {}): UpdateSnapshot => updateSnapshotSchema.parse({ enabled: true, checking: false, ...change })
const available = { sha: SHA, version: VERSION, quiet: false }
const ready = (idle: boolean, change: Partial<UpdateSnapshot> = {}): UpdateSnapshot =>
  snapshot({ available, build: { phase: 'ready', sha: SHA, version: VERSION, appPath: '/tmp/worfy.app' }, idle, ...change })

const harness = (state: HarnessStatus['state']): HarnessStatus => ({ state, bundledVersion: '1.4.0', canInstall: true, pluginDir: '/tmp/plugin', dependencies: [] })

let calls: { channel: string; input: unknown }[]
let answers: Record<string, Answer>
let openHealth: ReturnType<typeof vi.fn<() => void>>
let stored: Map<string, string>

function make(autoUpdate = false) {
  const actions: UpdateToastActions = {
    invoke: ((channel: string, input?: unknown) => {
      calls.push({ channel, input })
      return Promise.resolve(answers[channel] ?? { ok: false, error: `${channel}: not in this test` })
    }) as UpdateToastActions['invoke'],
    openHealth,
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) },
  }
  const made = createUpdateToasts(actions)
  made.autoUpdate(autoUpdate)
  return made
}

const all = (): readonly Toast[] => toasts.getState().toasts
const toast = (key: string): Toast | undefined => all().find((each) => each.id === key)
const labels = (key: string): string[] => toast(key)?.actions?.map((action) => action.label) ?? []
const press = (key: string, label: string): void => pressToastAction(key, labels(key).indexOf(label))
const channels = (): string[] => calls.map((call) => call.channel)
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  resetToasts()
  calls = []
  answers = {}
  openHealth = vi.fn<() => void>()
  stored = new Map()
})

afterEach(() => {
  resetToasts()
})

describe('ready', () => {
  it('a ready build at the start: one toast "ready" and no "available"; while not idle "Restart when idle", then "Restart now" in place', () => {
    const update = make()
    update.update(ready(false))
    expect(all().map((each) => each.id)).toEqual([READY_KEY])
    expect(toast(READY_KEY)).toMatchObject({ kind: 'action', text: `worfy ${VERSION} ready` })
    expect(labels(READY_KEY)).toEqual(['Restart when idle', 'Later'])

    update.update(ready(true))
    expect(all().map((each) => each.id)).toEqual([READY_KEY])
    expect(labels(READY_KEY)).toEqual(['Restart now', 'Later'])
    expect(toast(READY_KEY)?.version).toBe(2)

    // The same snapshot again changes nothing on screen.
    update.update(ready(true))
    expect(toast(READY_KEY)?.version).toBe(2)
  })

  it('"Restart now" asks main to restart now', async () => {
    answers['update.restart'] = { ok: true, value: { outcome: 'quitting' } }
    const update = make()
    update.update(ready(true))
    press(READY_KEY, 'Restart now')
    await settle()
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'now' } }])
    expect(all()).toEqual([])
  })

  it('"Restart when idle" asks main to wait, and an info toast says so', async () => {
    answers['update.restart'] = { ok: true, value: { outcome: 'waiting' } }
    const update = make()
    update.update(ready(false))
    press(READY_KEY, 'Restart when idle')
    await settle()
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'idle' } }])
    expect(toast(WAITING_KEY)).toMatchObject({ kind: 'info', text: 'worfy restarts when no Session is working and Autopilot has stopped' })
  })

  it('a refused restart shows its reason', async () => {
    answers['update.restart'] = { ok: true, value: { outcome: 'refused', reason: 'a Session is working', busy: true } }
    const update = make()
    update.update(ready(true))
    press(READY_KEY, 'Restart now')
    await settle()
    expect(all().map((each) => ({ kind: each.kind, text: each.text }))).toEqual([{ kind: 'error', text: 'a Session is working' }])
  })

  it('the build becoming ready while worfy runs shows the toast; leaving ready closes it', () => {
    const update = make()
    update.update(snapshot({ available, build: { phase: 'building', sha: SHA, version: VERSION } }))
    expect(all()).toEqual([])
    update.update(ready(true))
    expect(toast(READY_KEY)?.text).toBe(`worfy ${VERSION} ready`)
    update.update(snapshot({ available }))
    expect(toast(READY_KEY)).toBeUndefined()
  })

  it('no toast while "Restart when idle" waits', () => {
    const update = make()
    update.update(ready(false, { restartWhenIdle: true }))
    expect(all()).toEqual([])
  })
})

describe('available', () => {
  it('without "Update automatically" an Available update gets the toast; "Update" builds it', async () => {
    answers['update.install'] = { ok: true, value: snapshot({ available, build: { phase: 'building', sha: SHA, version: VERSION } }) }
    const update = make(false)
    update.update(snapshot({ available }))
    expect(toast(AVAILABLE_KEY)).toMatchObject({ kind: 'action', text: `New worfy ${VERSION} available` })
    expect(labels(AVAILABLE_KEY)).toEqual(['Update', 'Later'])
    press(AVAILABLE_KEY, 'Update')
    await settle()
    expect(channels()).toEqual(['update.install'])
  })

  it('with "Update automatically" no toast while it builds (R11); a quiet Update has none either', () => {
    const update = make(true)
    update.update(snapshot({ available }))
    update.update(snapshot({ available, build: { phase: 'building', sha: SHA, version: VERSION } }))
    expect(all()).toEqual([])

    resetToasts()
    const quiet = make(false)
    quiet.update(snapshot({ available: { ...available, quiet: true } }))
    expect(all()).toEqual([])
  })

  it('Update off for this copy: no toast at all', () => {
    const update = make(false)
    update.update(snapshot({ enabled: false, available, lastRestart: { ok: true, action: 'install', version: VERSION }, harnessAfterUpdate: 'failed' }))
    update.harness(harness({ kind: 'outdated', from: '1.3.0', to: '1.4.0', sameVersion: false }))
    update.update(ready(true, { enabled: false }))
    expect(all()).toEqual([])
  })
})

describe('Later (R12)', () => {
  it('closes the toast; a new snapshot of the same state in this run does not bring it back', () => {
    const update = make(false)
    update.update(snapshot({ available }))
    press(AVAILABLE_KEY, 'Later')
    expect(all()).toEqual([])
    update.update(snapshot({ available, checking: true }))
    update.update(snapshot({ available }))
    expect(all()).toEqual([])
    expect(calls).toEqual([])

    update.update(ready(false))
    press(READY_KEY, 'Later')
    update.update(ready(true))
    update.update(ready(false))
    expect(all()).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('available once per window load (R12, ticket item 1.1)', () => {
  it('after "Later" an Available update of a newer commit brings no toast in this window load', () => {
    const update = make(false)
    update.update(snapshot({ available }))
    press(AVAILABLE_KEY, 'Later')
    update.update(snapshot({ available: { sha: 'd'.repeat(40), version: `0.7.0+${'d'.repeat(7)}`, quiet: false } }))
    expect(all()).toEqual([])
  })
})

describe('failed', () => {
  it('a failed build shows "Update failed"; "Show log" opens the log through main', async () => {
    answers['update.showLog'] = { ok: true, value: undefined }
    const update = make(true)
    update.update(snapshot({ available, build: { phase: 'building', sha: SHA, version: VERSION } }))
    update.update(snapshot({ available, build: { phase: 'failed', sha: SHA, version: VERSION, log: 'exit code 1' } }))
    expect(toast(FAILED_KEY)).toMatchObject({ kind: 'action', text: 'Update failed' })
    expect(labels(FAILED_KEY)).toEqual(['Show log'])
    press(FAILED_KEY, 'Show log')
    await settle()
    expect(channels()).toEqual(['update.showLog'])
  })

  it('the same failure again does not bring the toast back; a new failure after a build does', () => {
    const update = make(true)
    const failed = snapshot({ available, build: { phase: 'failed', sha: SHA, version: VERSION } })
    update.update(failed)
    dismissToast(FAILED_KEY)
    update.update(failed)
    expect(toast(FAILED_KEY)).toBeUndefined()
    update.update(snapshot({ available, build: { phase: 'building', sha: SHA, version: VERSION } }))
    update.update(failed)
    expect(toast(FAILED_KEY)?.text).toBe('Update failed')
  })

  it('a log that cannot be opened shows the reason', async () => {
    answers['update.showLog'] = { ok: false, error: 'there is no build log yet: no Update was built' }
    const update = make(true)
    update.update(snapshot({ build: { phase: 'failed' } }))
    press(FAILED_KEY, 'Show log')
    await settle()
    expect(all().map((each) => ({ kind: each.kind, text: each.text }))).toEqual([{ kind: 'error', text: 'there is no build log yet: no Update was built' }])
  })
})

describe('Harness out of date', () => {
  it('an outdated Harness gets the toast; "Update" installs it through harness.install', async () => {
    answers['harness.install'] = { ok: true, value: { outcome: 'done', status: harness({ kind: 'installed', version: '1.4.0', enabled: true }) } }
    const update = make()
    update.update(snapshot())
    update.harness(harness({ kind: 'outdated', from: '1.3.0', to: '1.4.0', sameVersion: false }))
    expect(toast(HARNESS_KEY)).toMatchObject({ kind: 'action', text: 'Harness out of date: 1.3.0 → 1.4.0' })
    expect(labels(HARNESS_KEY)).toEqual(['Update', 'Later'])
    press(HARNESS_KEY, 'Update')
    await settle()
    expect(channels()).toEqual(['harness.install'])
  })

  it('harnessBehind of the Update state gets the toast too', () => {
    const update = make()
    update.harness(harness({ kind: 'outdated', from: '1.4.0', to: '1.4.0', sameVersion: true }))
    update.update(snapshot({ harnessBehind: { from: '1.4.0+aaaaaaa', to: '1.4.0+bbbbbbb' } }))
    expect(toast(HARNESS_KEY)?.text).toBe('Harness out of date: 1.4.0+aaaaaaa → 1.4.0+bbbbbbb')
  })

  it('the same semver from another commit without harnessBehind: no toast', () => {
    const update = make()
    update.update(snapshot())
    update.harness(harness({ kind: 'outdated', from: '1.4.0', to: '1.4.0', sameVersion: true }))
    expect(all()).toEqual([])
  })

  it('an install that brings the Harness up to date closes the toast', () => {
    const update = make()
    update.update(snapshot())
    update.harness(harness({ kind: 'outdated', from: '1.3.0', to: '1.4.0', sameVersion: false }))
    update.harness(harness({ kind: 'installed', version: '1.4.0', enabled: true }))
    expect(all()).toEqual([])
  })
})

describe('the end of the last restart', () => {
  it('an Update installed: success "worfy updated to …", once, not again in the next window load', () => {
    const state = snapshot({ lastRestart: { ok: true, action: 'install', version: VERSION } })
    const update = make()
    update.update(state)
    expect(toast(RESTART_RESULT_KEY)).toMatchObject({ kind: 'success', text: `worfy updated to ${VERSION}. The new Harness applies from the next Session.` })
    resetToasts()
    update.update(state)
    expect(all()).toEqual([])

    // The next window load (or the next start) with the same lastRestart in main's state.
    make().update(state)
    expect(all()).toEqual([])
  })

  it('two equal failed restarts at different times are told both; the same restart again is not', () => {
    const failure = (at: string) => snapshot({ lastRestart: { ok: false, action: 'install', version: VERSION, reason: 'EBUSY: resource busy or locked', at } })
    make().update(failure('2026-10-31T10:00:00.000Z'))
    expect(toast(RESTART_RESULT_KEY)?.kind).toBe('error')
    resetToasts()
    make().update(failure('2026-10-31T10:00:00.000Z'))
    expect(all()).toEqual([])
    make().update(failure('2026-10-31T11:00:00.000Z'))
    expect(toast(RESTART_RESULT_KEY)?.text).toBe(`worfy was not updated to ${VERSION}: EBUSY: resource busy or locked`)
  })

  it('a roll back: success "worfy is back to …"', () => {
    make().update(snapshot({ lastRestart: { ok: true, action: 'rollback', version: '0.5.0+aaaaaaa' } }))
    expect(toast(RESTART_RESULT_KEY)).toMatchObject({ kind: 'success', text: 'worfy is back to 0.5.0+aaaaaaa. Automatic updates wait for the next commit on main.' })
  })

  it('a restart that failed: an error with the reason', () => {
    make().update(snapshot({ lastRestart: { ok: false, action: 'install', version: VERSION, reason: 'process 4242 is still running after 120 s: nothing was changed' } }))
    expect(toast(RESTART_RESULT_KEY)).toMatchObject({ kind: 'error', text: `worfy was not updated to ${VERSION}: process 4242 is still running after 120 s: nothing was changed` })
    resetToasts()
    make().update(snapshot({ lastRestart: { ok: false, action: 'rollback', version: '0.5.0+aaaaaaa', reason: 'the copy is missing' } }))
    expect(toast(RESTART_RESULT_KEY)).toMatchObject({ kind: 'error', text: 'worfy was not rolled back to 0.5.0+aaaaaaa: the copy is missing' })
  })

  it('the Harness of the new copy did not install: "The Harness was not updated" with "Open Health"', () => {
    const update = make()
    update.update(snapshot({ harnessAfterUpdate: 'failed' }))
    expect(toast(HARNESS_AFTER_UPDATE_KEY)).toMatchObject({ kind: 'action', text: 'The Harness was not updated' })
    expect(labels(HARNESS_AFTER_UPDATE_KEY)).toEqual(['Open Health'])
    press(HARNESS_AFTER_UPDATE_KEY, 'Open Health')
    expect(openHealth).toHaveBeenCalledTimes(1)
    update.update(snapshot({ harnessAfterUpdate: 'failed' }))
    expect(all()).toEqual([])
  })
})
