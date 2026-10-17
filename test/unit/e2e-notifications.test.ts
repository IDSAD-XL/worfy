// An e2e run shows no system notification (worfy-polish ticket 31): before quiet windows every
// finished turn of a test put a banner from Electron.app — Electron's name and icon — on the screen
// of whoever used the Mac. playwright.config.ts turns quiet windows on for the whole run, and in
// quiet mode src/main/notify.ts shows no system notification (test/unit/notify.test.ts). A spec
// that turns quiet windows off for the focus (test/e2e/linked-notify.spec.ts) replaces
// Notification.prototype.show itself, so its notifications are recorded, not shown.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { quietWindows } from '../../src/main/quiet-windows'

const REPO = join(import.meta.dirname, '..', '..')
const before = process.env.WORFY_QUIET_WINDOWS

afterEach(() => {
  if (before === undefined) delete process.env.WORFY_QUIET_WINDOWS
  else process.env.WORFY_QUIET_WINDOWS = before
  vi.resetModules()
})

/** Loads playwright.config.ts afresh, as a run of `playwright test` does. */
const loadConfig = async (): Promise<void> => {
  vi.resetModules()
  await import(`${pathToFileURL(join(REPO, 'playwright.config.ts')).href}?t=${Date.now()}`)
}

describe('system notifications in an e2e run', () => {
  it('are off: the config of the run turns quiet windows on, and quiet windows show no system notification', async () => {
    delete process.env.WORFY_QUIET_WINDOWS
    await loadConfig()
    expect(process.env.WORFY_QUIET_WINDOWS).toBe('1')
    expect(quietWindows(process.env, 'darwin').systemNotifications).toBe(false)
  })

  it('stay as a run that sets the variable itself asks', async () => {
    process.env.WORFY_QUIET_WINDOWS = '0'
    await loadConfig()
    expect(process.env.WORFY_QUIET_WINDOWS).toBe('0')
  })

  it('a spec that turns quiet windows off replaces Notification.prototype.show itself', () => {
    const dir = join(REPO, 'test', 'e2e')
    const loud = readdirSync(dir)
      .filter((name) => name.endsWith('.spec.ts'))
      .filter((name) => /WORFY_QUIET_WINDOWS: '0'/.test(readFileSync(join(dir, name), 'utf8')))
    expect(loud).toContain('linked-notify.spec.ts')
    for (const name of loud) expect(readFileSync(join(dir, name), 'utf8'), name).toContain('Notification.prototype.show = function show')
  })
})
