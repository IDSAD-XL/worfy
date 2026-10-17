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

/**
 * Whether a file of test/e2e turns quiet windows off: it deletes WORFY_QUIET_WINDOWS, or gives it
 * any value but the literal '1' — '0', '', another word, a variable. Comments are left out.
 */
function turnsQuietOff(text: string): boolean {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  if (/delete\s+process\.env(\.WORFY_QUIET_WINDOWS|\[\s*['"`]WORFY_QUIET_WINDOWS['"`]\s*\])/.test(code)) return true
  const values = [...code.matchAll(/WORFY_QUIET_WINDOWS['"`]?\s*\]?\s*(?:\?\?=|=|:)\s*([^,;}\n]+)/g)].map((match) => (match[1] ?? '').trim())
  return values.some((value) => !/^(['"`])1\1$/.test(value))
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

  it('a spec that turns quiet windows off, by any spelling, replaces Notification.prototype.show itself', () => {
    const dir = join(REPO, 'test', 'e2e')
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts'))
    const loud = files.filter((name) => turnsQuietOff(readFileSync(join(dir, name), 'utf8')))
    expect(loud).toContain('linked-notify.spec.ts')
    for (const name of loud) expect(readFileSync(join(dir, name), 'utf8'), name).toContain('Notification.prototype.show = function show')
  })

  it('takes every spelling that is not quiet mode for turning it off', () => {
    for (const text of [
      "const NORMAL = { WORFY_QUIET_WINDOWS: '0' }",
      'env: { WORFY_QUIET_WINDOWS: "" }',
      "process.env.WORFY_QUIET_WINDOWS = 'no'",
      "process.env['WORFY_QUIET_WINDOWS'] = '0'",
      "{ ['WORFY_QUIET_WINDOWS']: off }",
      'delete process.env.WORFY_QUIET_WINDOWS',
      "{ WORFY_QUIET_WINDOWS: undefined }",
    ]) {
      expect(turnsQuietOff(text), text).toBe(true)
    }
    for (const text of ["const QUIET = { WORFY_QUIET_WINDOWS: '1' }", 'process.env.WORFY_QUIET_WINDOWS = "1"', '// WORFY_QUIET_WINDOWS=0 in a comment', 'no mention at all']) {
      expect(turnsQuietOff(text), text).toBe(false)
    }
  })
})
