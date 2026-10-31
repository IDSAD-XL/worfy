import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// worfy-guide ticket 03 (ADR-0090): the worfy Guide against the built app, with no Project and no
// network. Nothing opens it at the start; Help ▸ worfy Guide — clicked by its id (clickMenuItem) —
// and the Command palette open it, Esc closes it; the EN / RU switch changes the text and the choice
// outlives a restart of the app. Its window is a chunk of its own: the start does not fetch it, the
// first opening does. Snapshots in both themes and both languages: test-results/e2e/snapshots/guide-*/
// (test/e2e/snapshots.ts); with WORFY_EVIDENCE_DIR set they are copied there as
// 03-guide-<language>-<theme>.png. No pixel comparison (the epic's spec, Q21).

/** GUIDE_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron. */
const GUIDE_MENU_ITEM_ID = 'help.guide'

/**
 * The scripts the page has compiled so far, by file name, as its debugger lists them: enabling the
 * debugger reports every script already parsed. (The page's resource timing lists no file:// script.)
 */
async function parsedScripts(window: Page): Promise<string[]> {
  const cdp = await window.context().newCDPSession(window)
  const urls: string[] = []
  cdp.on('Debugger.scriptParsed', (event) => urls.push(event.url))
  await cdp.send('Debugger.enable')
  await cdp.send('Debugger.disable')
  await cdp.detach()
  return urls.map((url) => url.split('/').at(-1) ?? '').filter((name) => name.endsWith('.js'))
}

/** The chunk of the Guide's window in the build e2e runs (out/renderer/assets/GuideWindow-<hash>.js). */
async function guideChunk(): Promise<string> {
  const assets = join(repoRoot, 'out', 'renderer', 'assets')
  const chunks = (await readdir(assets)).filter((name) => /^GuideWindow-.*\.js$/.test(name))
  expect(chunks, 'the build has one chunk of the Guide window').toHaveLength(1)
  return chunks[0]!
}

test('nothing opens the Guide at the start, and the start does not fetch its chunk', async () => {
  const chunk = await guideChunk()
  // The first chunk of the app does not carry the Guide's texts: they are in the Guide's chunk only.
  const assets = join(repoRoot, 'out', 'renderer', 'assets')
  const entry = (await readdir(assets)).filter((name) => /^index-.*\.js$/.test(name))
  expect(entry.length).toBeGreaterThan(0)
  for (const name of entry) expect(await readFile(join(assets, name), 'utf8'), name).not.toContain('No Topics yet.')
  expect(await readFile(join(assets, chunk), 'utf8')).toContain('No Topics yet.')

  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // Long enough for whatever the start does once the shell is on screen.
    await window.waitForTimeout(1500)
    await expect(window.getByRole('dialog', { name: 'worfy Guide' })).toHaveCount(0)
    const scripts = await parsedScripts(window)
    expect(scripts.some((name) => /^index-.*\.js$/.test(name)), 'the debugger lists the first chunk').toBe(true)
    expect(scripts).not.toContain(chunk)

    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    await expect(window.getByRole('dialog', { name: 'worfy Guide' })).toBeVisible()
    await expect.poll(() => parsedScripts(window)).toContain(chunk)
  } finally {
    await launched.close()
  }
})

test('Help ▸ worfy Guide and the palette open it, Esc closes it, and the language switch outlives a restart', async () => {
  // One data folder for both starts of the app: the choice of language is kept there.
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-e2e-guide-'))
  try {
    const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const { app, window } = launched
      const guide = window.getByRole('dialog', { name: 'worfy Guide' })
      await expect(window.getByTestId('app-shell')).toBeVisible()

      // From the menu: English by default (the tests run the app in en-US), the test Topic on screen.
      await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
      await expect(guide).toBeVisible()
      await expect(guide).toHaveAttribute('data-language', 'en')
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'skeleton')
      await expect(guide.getByRole('heading', { name: 'How the Guide works' })).toBeVisible()
      await expect(guide.getByRole('link', { name: /Full page/ })).toHaveAttribute('href', /^https:\/\/github\.com\/IDSAD-XL\/worfy\/blob\/[0-9a-f]{7,40}\/docs\/features\/app-shell\.md$/)
      await window.keyboard.press('Escape')
      await expect(guide).toHaveCount(0)

      // From the palette: the Guide's own row, and the row of a Topic.
      await window.keyboard.press('ControlOrMeta+k')
      await window.getByTestId('palette-input').fill('worfy guide')
      await expect(window.locator('[data-testid="palette-option"][data-command="guide"]')).toBeVisible()
      await window.keyboard.press('Enter')
      await expect(guide).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(guide).toHaveCount(0)
      await window.keyboard.press('ControlOrMeta+k')
      await window.getByTestId('palette-input').fill('how the guide works')
      await expect(window.locator('[data-testid="palette-option"][data-command="guide:skeleton"]')).toBeVisible()
      await window.keyboard.press('Enter')
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'skeleton')

      // The switch: Russian at once, kept in the app settings of this Machine.
      await guide.getByTestId('guide-language-ru').click()
      await expect(guide).toHaveAttribute('data-language', 'ru')
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('lang', 'ru')
      await expect.poll(async () => (JSON.parse(await readFile(join(dataDir, 'app-settings.json'), 'utf8')) as { guideLanguage?: string }).guideLanguage).toBe('ru')
      await window.keyboard.press('Escape')
      await expect(guide).toHaveCount(0)
    } finally {
      await launched.close()
    }

    // A new start of the app over the same data folder opens the Guide in Russian.
    const relaunched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await expect(relaunched.window.getByTestId('app-shell')).toBeVisible()
      await clickMenuItem(relaunched.app, GUIDE_MENU_ITEM_ID)
      await expect(relaunched.window.getByRole('dialog', { name: 'worfy Guide' })).toHaveAttribute('data-language', 'ru')
    } finally {
      await relaunched.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('snapshots of the Guide in both themes and both languages', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 800 })
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await expect(guide).toBeVisible()
    // Under the hood unfolded, so the snapshot shows the whole Topic.
    await guide.locator('summary').click()
    const evidence = process.env.WORFY_EVIDENCE_DIR
    for (const language of ['en', 'ru'] as const) {
      await guide.getByTestId(`guide-language-${language}`).click()
      await expect(guide).toHaveAttribute('data-language', language)
      const shots = await snapshotThemes(window, `guide-${language}`)
      if (evidence === undefined || evidence === '') continue
      await mkdir(evidence, { recursive: true })
      await copyFile(shots.light, join(evidence, `03-guide-${language}-light.png`))
      await copyFile(shots.dark, join(evidence, `03-guide-${language}-dark.png`))
    }
  } finally {
    await launched.close()
  }
})
