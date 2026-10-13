import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// worfy-ui ticket 6: Settings → Health against the built app, in the sandbox of
// test/e2e/first-run.spec.ts — HOME, the Claude home and worfy's data folder are temporary, the
// shell is /bin/sh, and $HOME/.profile puts the stand-in tools of test/fixtures/first-run-tools/
// first on the PATH, so the checks see them and nothing of the machine running the tests. First run
// does not open by itself here (launchApp), and the data folder starts without its mark.
// Snapshots in both themes: test-results/snapshots/settings-health*/ (test/e2e/snapshots.ts).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const TOOLS = join(repoRoot, 'test', 'fixtures', 'first-run-tools')
/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
/** The Claude Code version this build carries: the stand-in `claude --version` prints the same. */
const bundledClaude = (): string =>
  (JSON.parse(readFileSync(join(repoRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')) as { claudeCodeVersion: string }).claudeCodeVersion

let scratch: string
let home: string
let claudeHome: string
let dataDir: string
let bin: string
let state: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-settings-health-')))
  home = join(scratch, 'home')
  claudeHome = join(home, '.claude')
  dataDir = join(scratch, 'data')
  bin = join(scratch, 'bin')
  state = join(scratch, 'state')
  log = join(scratch, 'calls.log')
  for (const dir of [claudeHome, dataDir, bin, state]) mkdirSync(dir, { recursive: true })
  for (const name of ['claude', 'gh', 'node', 'jq', 'git', 'npm', 'qmd']) symlinkSync(join(TOOLS, name), join(bin, name))
  const variables: Record<string, string> = {
    PATH: `${bin}:/usr/bin:/bin`,
    FIRST_RUN_TOOLS_LOG: log,
    FIRST_RUN_TOOLS_DIR: TOOLS,
    FIRST_RUN_TOOLS_STATE: state,
    FAKE_CLAUDE_VERSION: bundledClaude(),
    FAKE_GH_ACCOUNT: 'alice',
    FAKE_NPM_BIN: bin,
    FAKE_NPM_PREFIX: join(scratch, 'npm-prefix'),
    npm_config_prefix: join(scratch, 'npm-prefix'),
    XDG_CACHE_HOME: join(scratch, 'cache'),
    XDG_CONFIG_HOME: join(scratch, 'config'),
  }
  writeFileSync(join(home, '.profile'), Object.entries(variables).map(([key, value]) => `${key}='${value}'; export ${key}\n`).join(''))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> =>
  launchApp({
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, HOME: home, SHELL: '/bin/sh', WORFY_CLAUDE: join(TOOLS, 'claude'), FIRST_RUN_TOOLS_STATE: state, FIRST_RUN_TOOLS_LOG: log },
  })

const calls = (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
/** How many times the checks ran: each run asks the stand-in qmd for its version. */
const checkRuns = (): number => calls().filter((line) => line === 'qmd --version').length
const mark = (): string => join(dataDir, 'first-run.json')

const CHECK_IDS = ['claude-login', 'claude-version', 'git', 'gh', 'node', 'jq', 'gh-auth', 'harness', 'harness-dependencies', 'legacy-harness', 'qmd', 'qmd-models', 'qmd-collections']

/** The rows of `place` once its checks are in: the id, the name and the status of each. */
async function checksOf(place: Locator): Promise<{ id: string | null; name: string | null; status: string | null }[]> {
  await expect(place.locator('[data-check]')).toHaveCount(CHECK_IDS.length, { timeout: 30_000 })
  await expect(place.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: 30_000 })
  return place.locator('[data-check]').evaluateAll((rows) => rows.map((each) => ({ id: each.getAttribute('data-check'), name: each.getAttribute('aria-label'), status: each.getAttribute('data-status') })))
}

/** Opens Settings from the app menu and goes to Health. */
async function openHealth(launched: LaunchedApp): Promise<{ settings: Locator; health: Locator }> {
  const { app, window } = launched
  await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
  const settings = window.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  const sections = settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')
  // General stays the first section; Health comes right after it.
  await expect(sections.nth(0)).toHaveText('General')
  await expect(sections.nth(1)).toHaveText('Health')
  await sections.nth(1).click()
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Health')
  return { settings, health: settings.getByTestId('settings-health') }
}

/** Resolves once main has handled everything the window sent before this call. */
const mainCaughtUp = (window: Page): Promise<unknown> =>
  window.evaluate(() => (globalThis as unknown as { worfy: { invoke(channel: string): Promise<unknown> } }).worfy.invoke('firstRun.startup'))

// The e2e typecheck has no DOM library: the page's own objects are reached through globalThis.
interface PageElement {
  contains(other: unknown): boolean
  closest(selector: string): unknown
}
interface PageGlobals {
  document: { activeElement: unknown; elementFromPoint(x: number, y: number): PageElement | null }
  innerWidth: number
  innerHeight: number
  getComputedStyle(element: unknown): { zIndex: string }
}
interface PageNode {
  setAttribute(name: string, value: string): void
  append(node: PageNode): void
}
interface PageControl {
  ownerDocument: { createElement(tag: string): PageNode }
  closest(selector: string): PageNode | null
  addEventListener(type: string, listener: () => void, options: { once: boolean }): void
}

const zIndexOf = (locator: Locator): Promise<number> => locator.evaluate((element) => Number((globalThis as unknown as PageGlobals).getComputedStyle(element).zIndex))
const focusIsIn = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => (element as unknown as PageElement).contains((globalThis as unknown as PageGlobals).document.activeElement))

test('Settings → Health shows the checks of the First run dialog; closing Settings writes no mark, closing the dialog does', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // First run did not open by itself, and nothing has checked yet.
    await expect(window.getByTestId('first-run')).toHaveCount(0)
    expect(checkRuns()).toBe(0)

    const { settings, health } = await openHealth(launched)
    const inHealth = await checksOf(health)
    expect(inHealth.map((each) => each.id)).toEqual(CHECK_IDS)
    expect(checkRuns()).toBe(1)
    // What First run shows on a first start (test/e2e/first-run.spec.ts): one failed, two warnings.
    await expect(health.getByTestId('first-run-summary')).toHaveText('1 failed · 2 warnings')
    await expect(health.locator('[data-check="harness"]')).toHaveAttribute('data-status', 'fail')
    await expect(health.locator('[data-check="harness"]').getByRole('button', { name: 'Install' })).toBeVisible()
    await expect(health.getByRole('button', { name: 'Check again' })).toBeVisible()
    // Checking only reads: no install, no download.
    expect(calls().filter((line) => /^claude plugin (marketplace|install|update)|^npm install|^qmd pull/.test(line))).toEqual([])
    await snapshotThemes(window, 'settings-health')

    // "Check again" runs the checks once more.
    await health.getByRole('button', { name: 'Check again' }).click()
    await expect.poll(checkRuns, { timeout: 30_000 }).toBe(2)
    expect(await checksOf(health)).toEqual(inHealth)

    // Close: there was no mark, and there still is none.
    await settings.getByRole('button', { name: 'Close' }).click()
    await expect(settings).toHaveCount(0)
    await mainCaughtUp(window)
    expect(existsSync(mark())).toBe(false)

    // The First run dialog, from the palette as before: the same rows, checked afresh.
    await window.keyboard.press('Meta+k')
    const input = window.getByTestId('palette-input')
    await input.fill('First-run checks')
    await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'first-run')
    await input.press('Enter')
    const dialog = window.getByTestId('first-run')
    await expect(dialog).toBeVisible()
    expect(await checksOf(dialog)).toEqual(inHealth)
    expect(checkRuns()).toBe(3)

    // Health over the open dialog shows the dialog's checks, and closing it leaves the dialog and no mark.
    const over = await openHealth(launched)
    expect(await checksOf(over.health)).toEqual(inHealth)
    await window.keyboard.press('Escape')
    await expect(over.settings).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await mainCaughtUp(window)
    expect(existsSync(mark())).toBe(false)

    // Only the dialog's own Close writes it.
    await expect(dialog.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: 30_000 })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => existsSync(mark())).toBe(true)
    expect(JSON.parse(readFileSync(mark(), 'utf8'))).toMatchObject({ failing: ['harness'] })
  } finally {
    await launched.close()
  }
})

test('"Move…" in Health opens the move form above Settings; the keyboard stays in the form; Esc closes the form and leaves Settings open', async () => {
  // What makes the old Harness check offer "Move…": a file of the old Harness in the Claude home.
  mkdirSync(join(claudeHome, 'bin'))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), '#!/bin/sh\n')
  const launched = await launch()
  try {
    const { window } = launched
    const { settings, health } = await openHealth(launched)
    await checksOf(health)
    const legacy = health.locator('[data-check="legacy-harness"]')
    await expect(legacy).toHaveAttribute('data-status', 'warn')
    const move = legacy.getByRole('button', { name: 'Move…' })
    await move.click()

    const form = window.getByTestId('migration-form')
    // The form as it is once main answered with the plan: its buttons are in.
    await expect(form.getByTestId('migration-actions')).toBeVisible({ timeout: 30_000 })
    // Above the window: its layer is higher, and it is what the middle of the window shows.
    const formLayer = await zIndexOf(form.locator('xpath=..'))
    expect(formLayer).toBeGreaterThan(await zIndexOf(window.locator('.w-settings__backdrop')))
    expect(
      await window.evaluate(() => {
        const page = globalThis as unknown as PageGlobals
        const hit = page.document.elementFromPoint(page.innerWidth / 2, page.innerHeight / 2)
        return hit !== null && hit.closest('[data-testid="migration-form"]') !== null
      }),
    ).toBe(true)
    await snapshotThemes(window, 'settings-health-move')

    // The keyboard is the form's: the focus is in it and Tab, either way, never leaves it for the window under it.
    expect(await focusIsIn(form)).toBe(true)
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await window.keyboard.press(key)
      expect(await focusIsIn(form), key).toBe(true)
    }

    // A click on text of the form, which takes no focus, does not hand the keyboard to the window
    // under it: the focus is back on the control that had it, and Tab still turns inside the form.
    const heading = form.getByRole('heading', { level: 2 })
    const keep = form.getByRole('button', { name: 'Keep' })
    const cancel = form.getByTestId('migration-close')
    await cancel.focus()
    await heading.click()
    await expect(cancel).toBeFocused()
    await window.keyboard.press('Tab')
    expect(await focusIsIn(form), 'Tab after a click on the heading').toBe(true)

    // A click on a control of the form puts the focus on it, as anywhere.
    await keep.click()
    await expect(keep).toBeFocused()

    // A control pressed in the very moment the form redraws keeps the press: the focus goes where
    // the mouse went, not back to the control it left. The redraw is forced from the page: a
    // handler of the control losing the focus adds an element to the form.
    await keep.evaluate((element) => {
      const control = element as unknown as PageControl
      control.addEventListener(
        'blur',
        () => {
          const mark = control.ownerDocument.createElement('span')
          mark.setAttribute('data-test-redraw', '')
          control.closest('[data-testid="migration-form"]')?.append(mark)
        },
        { once: true },
      )
    })
    const box = (await cancel.boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await expect(cancel).toBeFocused()
    // Let go off the button, so the press is not a click that closes the form.
    await window.mouse.move(box.x + box.width / 2, box.y - 60)
    await window.mouse.up()
    await expect(form).toBeVisible()
    await expect(form.locator('[data-test-redraw]')).toHaveCount(1)

    // After one more click on text, Esc is still the form's.
    await heading.click()
    expect(await focusIsIn(form), 'a click on the heading before Esc').toBe(true)

    // Esc closes the form only; Settings stays on Health, the focus is back on "Move…", and the checks run again.
    const runs = checkRuns()
    await window.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(settings).toBeVisible()
    await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Health')
    await expect(move).toBeFocused()
    await expect.poll(checkRuns, { timeout: 30_000 }).toBe(runs + 1)
    await checksOf(health)

    // The next Esc is the window's.
    await window.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await mainCaughtUp(window)
    expect(existsSync(mark())).toBe(false)
  } finally {
    await launched.close()
  }
})
