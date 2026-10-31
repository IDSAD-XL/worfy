import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeSandbox } from './first-run-sandbox'
import { launchApp, type LaunchedApp } from './helpers'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// worfy-guide ticket 09 (ADR-0090): the ways into the worfy Guide from Getting started and First run.
//
// - A new user (a fresh data folder, WORFY_FIRST_RUN_AUTO=1 and WORFY_GETTING_STARTED_AUTO=1): First
//   run opens by itself on the page of the three concepts and the Getting started panel shows behind
//   it, but the Guide does not open. "worfy Guide" under the concepts opens it over First run, which
//   stays on its page; Esc closes the Guide alone. "worfy Guide" at the bottom of the panel opens it
//   too, and the panel stays.
// - An existing user (a data folder with one Project): First run goes straight to the checks, the
//   corner has the notice, and nothing else opens by itself — no Guide, no panel, no pill.
//
// Both links are --accent on --surface: the test reads their colours in each theme and asks for a
// contrast of at least 4.5:1. Screenshots of both places in both themes go to the test's output as
// 09-first-run-<theme>.png and 09-panel-<theme>.png, and with WORFY_EVIDENCE_DIR set are copied there.
//
// The checks run a login /bin/sh over the test's HOME, as getting-started-entry.spec.ts does.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const PROJECT = 'alpha-0000000a'

let scratch: string
let home: string
let dataDir: string
let sandboxEnv: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-guide-links-')))
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

const launch = (): Promise<LaunchedApp> =>
  launchApp({
    env: { WORFY_DATA_DIR: dataDir, WORFY_FIRST_RUN_AUTO: '1', WORFY_GETTING_STARTED_AUTO: '1', HOME: home, ...windowsProfileEnv(home), SHELL: '/bin/sh', ...sandboxEnv },
  })

const guideOf = (window: Page): Locator => window.getByRole('dialog', { name: 'worfy Guide' })

/** Resolves once the window's own calls made at load have been answered and a frame has been drawn. */
async function settled(window: Page): Promise<void> {
  await window.evaluate(() => (globalThis as unknown as { worfy: { invoke(channel: string): Promise<unknown> } }).worfy.invoke('gettingStarted.state'))
  await window.evaluate(() => new Promise((resolve) => (globalThis as unknown as { requestAnimationFrame(callback: () => void): void }).requestAnimationFrame(() => resolve(null))))
}

/** The contrast of `link`'s text against the first opaque background behind it (WCAG 2 formula). */
async function contrastOf(link: Locator): Promise<number> {
  const [text, back] = await link.evaluate((element) => {
    // The e2e project has no DOM types: the page's own objects are described here.
    interface Node {
      parentElement: Node | null
    }
    const styleOf = (globalThis as unknown as { getComputedStyle(node: Node): { color: string; backgroundColor: string } }).getComputedStyle
    let node: Node | null = element as unknown as Node
    let background = 'rgba(0, 0, 0, 0)'
    while (node !== null) {
      const colour = styleOf(node).backgroundColor
      if (!/rgba\(.*,\s*0\)$/.test(colour) && colour !== 'transparent') {
        background = colour
        break
      }
      node = node.parentElement
    }
    return [styleOf(element as unknown as Node).color, background]
  })
  const channels = (colour: string): number[] => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  const luminance = (colour: string): number => {
    const [r, g, b] = channels(colour).map((value) => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [light, dark] = [luminance(text), luminance(back)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

/** In both themes: the link's contrast is at least 4.5:1, and `place` is photographed as 09-<name>-<theme>.png. */
async function checkThemes(window: Page, place: Locator, link: Locator, name: string): Promise<void> {
  const evidence = process.env.WORFY_EVIDENCE_DIR
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await expect.poll(() => contrastOf(link), { message: `contrast of the link in ${name}, ${scheme}` }).toBeGreaterThanOrEqual(4.5)
      const path = test.info().outputPath(`09-${name}-${scheme}.png`)
      await place.screenshot({ path, animations: 'disabled' })
      if (evidence === undefined || evidence === '') continue
      await mkdir(evidence, { recursive: true })
      await copyFile(path, join(evidence, `09-${name}-${scheme}.png`))
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

test('a new user: nothing opens the Guide; "worfy Guide" under the concepts and in the panel opens it', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    const dialog = window.getByTestId('first-run')
    await expect(dialog).toBeVisible({ timeout: ms(30_000) })
    await expect(dialog).toHaveAttribute('data-page', 'concepts')
    const panel = window.getByTestId('getting-started')
    await expect(panel).toBeVisible()
    await settled(window)
    await expect(guideOf(window)).toHaveCount(0)

    // First run: the link under the concepts opens the Guide over it; Esc closes the Guide alone.
    const conceptsLink = dialog.getByRole('button', { name: 'worfy Guide' })
    await expect(dialog.getByTestId('first-run-guide')).toHaveText('Short visual help: worfy Guide. It is in the Help menu too.')
    await checkThemes(window, dialog, conceptsLink, 'first-run')
    await conceptsLink.click()
    const guide = guideOf(window)
    await expect(guide).toBeVisible()
    await expect(dialog).toHaveAttribute('data-page', 'concepts')
    await window.keyboard.press('Escape')
    await expect(guide).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-page', 'concepts')
    await expect(conceptsLink).toBeFocused()

    // Done with First run, the way a person leaves it.
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: ms(30_000) })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    // The panel: "worfy Guide" at its bottom opens the Guide; the panel stays as it was.
    const panelLink = panel.getByRole('button', { name: 'worfy Guide' })
    await expect(panelLink).toBeVisible()
    await checkThemes(window, panel, panelLink, 'panel')
    await panelLink.click()
    await expect(guideOf(window)).toBeVisible()
    await expect(panel).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(guideOf(window)).toHaveCount(0)
    await expect(panelLink).toBeFocused()
  } finally {
    await launched.close()
  }
})

test('an existing user: First run on the checks and the notice, and nothing else opens by itself — no Guide, no panel', async () => {
  const root = join(scratch, 'alpha')
  mkdirSync(root)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: root }], activeId: PROJECT }))

  const launched = await launch()
  try {
    const { window } = launched
    const dialog = window.getByTestId('first-run')
    await expect(dialog).toBeVisible({ timeout: ms(30_000) })
    await expect(dialog).toHaveAttribute('data-page', 'checks')
    await expect(dialog.getByRole('button', { name: 'worfy Guide' })).toHaveCount(0)
    await expect(dialog.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: ms(30_000) })
    await settled(window)
    await expect(guideOf(window)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(window.getByTestId('getting-started-notice')).toBeVisible()
    await settled(window)
    await expect(guideOf(window)).toHaveCount(0)
    await expect(window.getByTestId('getting-started')).toHaveCount(0)
    await expect(window.getByTestId('getting-started-pill')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
