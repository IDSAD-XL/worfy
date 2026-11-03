import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { canvasReady, closeSettings, launchApp, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'

// Onboarding and the sign-in to Codex (worfy-multi-vendor ticket 29), against the built app with both
// agents on their fakes: Claude Code on the fake agent, Codex on the fake app-server (WORFY_CODEX=fake,
// which every launch sets; the real Codex never starts, and nothing here signs in anywhere).
//
// - Fake `login`: Getting started offers "Use Codex too", whose button opens Settings → Vendors; there
//   «Sign in to Codex» runs the fake's ChatGPT sign-in. Its page reaches only a recorder that replaces
//   shell.openExternal in main — no browser opens, no OpenAI page loads. The row then shows the account
//   the sign-in ended with. The fake plays one script from its start for every process and keeps no
//   sign-in, where the real Codex keeps it in CODEX_HOME: after the sign-in the spec switches the fake to
//   `account-plus`, a Codex signed in, and "New session" offers Codex.
// - Fake `signed-out`, and a build without Codex (WORFY_CODEX=absent, which starts nothing, as on a
//   platform without a Codex package): no toast and no error dialog, native or in the window; Codex stays
//   in the picker of "New session", inactive, with the tooltip that says where to sign in. Settings →
//   Vendors offers the sign-in, or says Codex is not in this build; Getting started offers no "Use Codex
//   too" without it.
//
// Screenshots of both themes go to the test's output folder; the ticket's evidence is copied from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SIZE = { width: 1400, height: 900 }
const SIGN_IN_PAGE = 'https://auth.openai.com/oauth/authorize?client_id=fake&state=login_fake_1'
const HINT = 'Sign in to Codex in Settings → Vendors'

let scratch: string
let dataDir: string
let codexHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-onboarding-codex-')))
  dataDir = join(scratch, 'data')
  codexHome = join(scratch, 'codex-home')
  const projectPath = join(scratch, 'alpha')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
  // Getting started shows, as for a new user who has not finished it (getting-started.json as main writes it).
  writeFileSync(join(dataDir, 'getting-started.json'), `${JSON.stringify({ user: 'new', section: 'shown', reworkSeen: false, noticeShown: false }, null, 2)}\n`)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (env: Record<string, string>): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome, ...env } })

/**
 * Replaces in main what would leave the window: shell.openExternal records the address instead of
 * opening a browser, and every native message or error box records itself instead of showing.
 */
async function recordOutside(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, shell }) => {
    const seen: { opened: string[]; dialogs: unknown[] } = { opened: [], dialogs: [] }
    ;(globalThis as { outside?: typeof seen }).outside = seen
    shell.openExternal = async (url: string) => {
      seen.opened.push(url)
    }
    dialog.showMessageBox = ((...args: unknown[]) => {
      seen.dialogs.push(args.at(-1))
      return Promise.resolve({ response: 0, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      seen.dialogs.push(args.at(-1))
      return 0
    }) as typeof dialog.showMessageBoxSync
    dialog.showErrorBox = (title: string, content: string) => {
      seen.dialogs.push({ title, content })
    }
  })
}

const outside = (app: ElectronApplication): Promise<{ opened: string[]; dialogs: unknown[] }> =>
  app.evaluate(() => (globalThis as unknown as { outside: { opened: string[]; dialogs: unknown[] } }).outside)

/** No toast and no error dialog: neither in the window nor a native one. */
async function nothingPoppedUp(launched: LaunchedApp): Promise<void> {
  await expect(launched.window.locator('[data-testid="toasts"] .w-toast')).toHaveCount(0)
  await expect(launched.window.getByRole('alertdialog')).toHaveCount(0)
  expect((await outside(launched.app)).dialogs).toEqual([])
}

/** Opens Settings → Vendors the way a person does: "Settings…" of the app menu, then the row "Vendors". */
async function openVendors(launched: LaunchedApp): Promise<Locator> {
  await clickMenuItem(launched.app, 'app.settings')
  const dialog = launched.window.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Vendors', exact: true }).click()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Vendors')
  return dialog
}

const vendorRow = (scope: Locator, vendor: string): Locator => scope.locator(`[data-testid="vendor-row"][data-vendor="${vendor}"]`)
const picker = (window: Page): Locator => window.getByRole('menu', { name: 'New session on' })
const option = (window: Page, vendor: string): Locator => picker(window).locator(`[data-testid="new-session-vendor-option"][data-vendor="${vendor}"]`)

/** `target` in both themes, for the ticket's evidence and the review. */
async function screenshots(window: Page, target: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await target.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('fake `login`: Getting started → Settings → Vendors → «Sign in to Codex» → signed in, the page only recorded, Codex in "New session"', async () => {
  const launched = await launch({ WORFY_CODEX_SCRIPT: 'login' })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: SIZE })
    await recordOutside(app)

    // Getting started offers Codex, apart from its six steps.
    const panel = window.getByTestId('getting-started')
    const useCodex = panel.locator('[data-testid="getting-started-vendor"][data-vendor="codex"]')
    await expect(useCodex).toContainText('Use Codex too')
    await expect(panel.getByTestId('getting-started-step')).toHaveCount(6)
    await screenshots(window, panel, '29-getting-started')
    await useCodex.getByRole('button', { name: 'Sign in to Codex…' }).click()

    // Its button opens Settings on Vendors: Claude Code signed in (the fake agent's account), Codex not.
    const dialog = window.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Vendors')
    await expect(vendorRow(dialog, 'claude')).toHaveAttribute('data-state', 'signed-in')
    await expect(vendorRow(dialog, 'claude').getByTestId('vendor-account')).toHaveText('Signed in: Claude Max')
    const codex = vendorRow(dialog, 'codex')
    await expect(codex.getByTestId('vendor-signed-out')).toBeVisible()
    await screenshots(window, dialog, '29-vendors-signed-out')

    await codex.getByRole('button', { name: 'Sign in to Codex' }).click()
    await expect(codex).toHaveAttribute('data-state', 'signed-in')
    await expect(codex.getByTestId('vendor-account')).toHaveText('Signed in: user@example.com · plus')
    // The sign-in page went to the recorder only: no browser, no OpenAI page.
    expect((await outside(app)).opened).toEqual([SIGN_IN_PAGE])
    await screenshots(window, dialog, '29-vendors-signed-in')
    await closeSettings(window)

    // Codex now keeps the sign-in, as the real one does in CODEX_HOME: "New session" can start Codex.
    await app.evaluate(() => {
      process.env.WORFY_CODEX_SCRIPT = 'account-plus'
    })
    await window.getByTestId('sidebar-new-session').click()
    await expect(option(window, 'codex')).toBeVisible()
    await expect(option(window, 'codex')).not.toHaveAttribute('aria-disabled', 'true')
    await window.keyboard.press('Escape')
    await nothingPoppedUp(launched)
  } finally {
    await launched.close()
  }
})

test('fake `signed-out`: no toast, no error dialog; Codex inactive in "New session" with its tooltip, «Sign in to Codex» in Settings', async () => {
  const launched = await launch({ WORFY_CODEX_SCRIPT: 'signed-out' })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: SIZE })
    await recordOutside(app)

    await window.getByTestId('sidebar-new-session').click()
    await expect(option(window, 'codex')).toHaveAttribute('aria-disabled', 'true')
    await expect(option(window, 'codex')).toHaveAttribute('title', HINT)
    await window.keyboard.press('Escape')

    const dialog = await openVendors(launched)
    const codex = vendorRow(dialog, 'codex')
    await expect(codex.getByTestId('vendor-signed-out')).toHaveText('Not signed in. Sign in to start Sessions on Codex too.')
    await expect(codex.getByRole('button', { name: 'Sign in to Codex' })).toBeVisible()
    await closeSettings(window)
    await nothingPoppedUp(launched)
  } finally {
    await launched.close()
  }
})

test('a build without Codex: no toast, no error dialog; Codex inactive in "New session" with its tooltip, "not part of this build" in Settings, no "Use Codex too"', async () => {
  const launched = await launch({ WORFY_CODEX: 'absent' })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: SIZE })
    await recordOutside(app)

    const panel = window.getByTestId('getting-started')
    await expect(panel.getByTestId('getting-started-step')).toHaveCount(6)
    await expect(panel.getByTestId('getting-started-vendor')).toHaveCount(0)

    await window.getByTestId('sidebar-new-session').click()
    await expect(option(window, 'codex')).toHaveAttribute('aria-disabled', 'true')
    await expect(option(window, 'codex')).toHaveAttribute('title', HINT)
    await screenshots(window, picker(window), '29-picker-without-codex')
    await window.keyboard.press('Escape')

    const dialog = await openVendors(launched)
    const codex = vendorRow(dialog, 'codex')
    await expect(codex).toHaveAttribute('data-state', 'absent')
    await expect(codex.getByTestId('vendor-absent')).toHaveText('Codex is not part of this build of worfy.')
    await expect(codex.getByRole('button')).toHaveCount(0)
    await screenshots(window, dialog, '29-vendors-without-codex')
    await closeSettings(window)
    await nothingPoppedUp(launched)
  } finally {
    await launched.close()
  }
})
