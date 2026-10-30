import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeSandbox } from './first-run-sandbox'
import { launchApp, type LaunchedApp } from './helpers'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// worfy-onboarding ticket 08: the ways into Getting started.
//
// - A new user (a fresh data folder): First run opens by itself on the page of the three concepts
//   (decision 8), "Next" goes to the checks, and "Start Getting started" next to "Close" (decision 9)
//   closes First run, writing its mark as "Close" does, and shows the section with the focus on it.
//   WORFY_GETTING_STARTED_AUTO stays 0 (test/e2e/launch-env.ts), so the section starts hidden and only
//   the button shows it.
// - An existing user (a data folder with one Project and no getting-started.json, WORFY_GETTING_STARTED_AUTO=1):
//   First run, opened by itself since there is no mark, goes straight to the checks; the corner has
//   the notice with "Open" and "Not now"; after "Not now" no later start shows it, and the section stays hidden.
//
// The checks run a login /bin/sh over the test's HOME, whose .profile sets PATH to the system folders
// alone, as harness-migrate.spec.ts does; on Windows a registry stand-in gives them a Path of the
// system folders alone (first-run-sandbox.ts), and the profile folders move to that HOME
// (windowsProfileEnv). Screenshots of the concepts page and of the notice in both themes go to the
// test's output as 08-concepts-<theme>.png and 08-notice-<theme>.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const PROJECT = 'alpha-0000000a'
const NOTICE = 'New: Getting started — a guided demo of worfy.'

let scratch: string
let home: string
let dataDir: string
let sandboxEnv: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-gs-entry-')))
  home = join(scratch, 'home')
  dataDir = join(scratch, 'data')
  mkdirSync(home, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  if (process.platform === 'win32') sandboxEnv = writeSandbox({ scratch, home, bin: join(scratch, 'no-tools'), tools: [], variables: {} })
  else {
    sandboxEnv = {}
    writeFileSync(join(home, '.profile'), "PATH='/usr/bin:/bin'; export PATH\n")
  }
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (extra: Record<string, string> = {}): Promise<LaunchedApp> =>
  launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_FIRST_RUN_AUTO: '1', HOME: home, ...windowsProfileEnv(home), SHELL: '/bin/sh', ...sandboxEnv, ...extra } })

const sectionOf = (window: Page): Locator => window.getByTestId('getting-started')
const readJson = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as Record<string, unknown>

/** Screenshots of `locator` in both themes, kept with the test's output. */
async function shoot(window: Page, locator: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await locator.screenshot({ path: test.info().outputPath(`08-${name}-${scheme}.png`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** Resolves once the window's own calls made at load have been answered: main answers one window's calls in order. */
const caughtUp = (window: Page): Promise<unknown> =>
  window.evaluate(() => (globalThis as unknown as { worfy: { invoke(channel: string): Promise<unknown> } }).worfy.invoke('gettingStarted.state'))

test('a new user: the three concepts, "Next" to the checks, "Start Getting started" closes First run and shows the section in focus', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const dialog = window.getByTestId('first-run')
    await expect(dialog).toBeVisible({ timeout: ms(30_000) })
    await expect(dialog).toHaveAttribute('data-page', 'concepts')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Welcome to worfy')
    await expect(dialog.getByRole('list', { name: 'Three things to know' }).getByRole('heading')).toHaveText(['Project + Harness', 'Orchestrator', 'Canvas'])
    await expect(dialog.getByRole('button', { name: 'Start Getting started' })).toHaveCount(0)
    // The section is hidden (WORFY_GETTING_STARTED_AUTO=0): only the button below shows it.
    await expect(sectionOf(window)).toHaveCount(0)
    await shoot(window, dialog, 'concepts')

    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog).toHaveAttribute('data-page', 'checks')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('First run')
    await expect(dialog.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: ms(30_000) })
    const start = dialog.getByRole('button', { name: 'Start Getting started' })
    await expect(start).toBeVisible()
    await start.click()

    await expect(dialog).toHaveCount(0)
    const section = sectionOf(window)
    await expect(section).toBeVisible()
    await expect(section.getByRole('button', { name: 'Getting started' })).toBeFocused()
    // Closed as by "Close": main wrote the mark.
    expect(readJson('first-run.json')).toHaveProperty('failing')
    expect(readJson('getting-started.json')).toMatchObject({ user: 'new', section: 'shown' })
  } finally {
    await launched.close()
  }
})

test('an existing user: First run without the concepts, the notice in the corner; after "Not now" no notice and no section on the next start', async () => {
  const root = join(scratch, 'alpha')
  mkdirSync(root)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: root }], activeId: PROJECT }))

  let launched = await launch({ WORFY_GETTING_STARTED_AUTO: '1' })
  try {
    const { window } = launched
    // No mark, so First run opens by itself, but on the checks: an existing user is not shown the concepts.
    const dialog = window.getByTestId('first-run')
    await expect(dialog).toBeVisible({ timeout: ms(30_000) })
    await expect(dialog).toHaveAttribute('data-page', 'checks')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('First run')
    await expect(dialog.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: ms(30_000) })
    await expect(dialog.getByRole('button', { name: 'Start Getting started' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    const notice = window.getByTestId('getting-started-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(NOTICE)
    // Its two buttons, then the toast's own "Dismiss".
    const buttons = notice.getByRole('button')
    await expect(buttons).toHaveCount(3)
    await expect(buttons.nth(0)).toHaveAccessibleName('Open')
    await expect(buttons.nth(1)).toHaveAccessibleName('Not now')
    await expect(buttons.nth(2)).toHaveAccessibleName('Dismiss')
    await shoot(window, notice, 'notice')
    await expect(sectionOf(window)).toHaveCount(0)

    await notice.getByRole('button', { name: 'Not now' }).click()
    await expect(notice).toHaveCount(0)
    await expect.poll(() => readJson('getting-started.json').noticeShown).toBe(true)
    await expect(sectionOf(window)).toHaveCount(0)
  } finally {
    await launched.close()
  }

  launched = await launch({ WORFY_GETTING_STARTED_AUTO: '1' })
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // The window's own read of the state at load has been answered and the toast store has settled.
    await caughtUp(window)
    await window.evaluate(() => new Promise((resolve) => (globalThis as unknown as { requestAnimationFrame(callback: () => void): void }).requestAnimationFrame(() => resolve(null))))
    await expect(window.getByTestId('getting-started-notice')).toHaveCount(0)
    await expect(sectionOf(window)).toHaveCount(0)
    expect(readJson('getting-started.json')).toMatchObject({ user: 'existing', section: 'hidden', noticeShown: true })
  } finally {
    await launched.close()
  }
})
