import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { clickMenuItem } from './menu'

// worfy-ui ticket 3: the interface scale against the built app. The slider of Settings → General and
// View ▸ Bigger / Smaller / Actual size zoom the whole window (webContents zoom, 80–150 %), the
// scale is kept in app-settings.json, and the strips under the window buttons keep their size in
// pixels of the window. Playwright cannot press menu accelerators, so the items are clicked by id
// (clickMenuItem); the keys themselves are a manual check. Snapshots in both themes:
// test-results/snapshots/interface-scale-150-*/ (test/e2e/snapshots.ts).

/** The ids of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS = 'app.settings'
const BIGGER = 'view.scale.bigger'
const SMALLER = 'view.scale.smaller'
const ACTUAL = 'view.scale.actual'

/** The smallest window (src/shared/window/bounds.ts): the scale has the least room there. */
const SIZE = { width: 800, height: 520 }
/** The toolbar and the room left of it for the window buttons of macOS, in pixels of the window. */
const TOOLBAR_PX = 52
const TRAFFIC_LIGHTS_PX = 80
const mac = process.platform === 'darwin'

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface PageElement {
  getBoundingClientRect(): { left: number; top: number; bottom: number; height: number }
}
interface PageGlobals {
  innerWidth: number
  document: {
    body: PageElement
    documentElement: { style: { getPropertyValue(name: string): string; setProperty(name: string, value: string): void; removeProperty(name: string): string } }
    querySelector(selector: string): PageElement | null
  }
  getComputedStyle(element: PageElement): { fontSize: string; paddingLeft: string }
}

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** A data folder with one Project of two notes, so the Canvas has something to show and to put into focus mode. */
function projectData(): { scratch: string; dataDir: string } {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-interface-scale-')))
  const PROJECT = 'alpha-0000000a'
  const dataDir = join(scratch, 'data')
  mkdirSync(join(scratch, 'alpha'))
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: join(scratch, 'alpha') }], activeId: PROJECT }))
  writeFileSync(
    join(dataDir, PROJECT, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'n1', kind: 'note', x: 40, y: 40, w: 220, h: 120, data: { text: 'one' } },
        { id: 'n2', kind: 'note', x: 300, y: 40, w: 220, h: 120, data: { text: 'two' } },
      ],
      viewport: { x: 30, y: 20, zoom: 1 },
    }),
  )
  return { scratch, dataDir }
}

/** The zoom of the app's first window, as Electron reports it. */
const zoomFactor = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)
    if (!first) throw new Error('the app has no window')
    return first.webContents.getZoomFactor()
  })

async function expectZoom(app: ElectronApplication, scale: number): Promise<void> {
  await expect.poll(() => zoomFactor(app), { message: `the zoom of the window is ${scale}` }).toBeCloseTo(scale, 5)
}

/** Whether a menu item is enabled. */
const menuItemEnabled = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`the app menu has no item ${itemId}`)
    return item.enabled
  }, id)

/** `interfaceScale` of app-settings.json; undefined while the file is not written. */
function savedScale(dataDir: string): number | undefined {
  try {
    return (JSON.parse(readFileSync(join(dataDir, 'app-settings.json'), 'utf8')) as { interfaceScale?: number }).interfaceScale
  } catch {
    return undefined
  }
}

/** What the page measures of itself, in CSS pixels. */
const pageMetrics = (window: Page): Promise<{ innerWidth: number; bodyFont: string; scale: string }> =>
  window.evaluate(() => {
    const page = globalThis as unknown as PageGlobals
    return {
      innerWidth: page.innerWidth,
      bodyFont: page.getComputedStyle(page.document.body).fontSize,
      scale: page.document.documentElement.style.getPropertyValue('--interface-scale'),
    }
  })

/** The box of the first element `selector` finds, and its left padding, in CSS pixels. */
const boxOf = (window: Page, selector: string): Promise<{ left: number; top: number; bottom: number; height: number; paddingLeft: number }> =>
  window.evaluate((query) => {
    const page = globalThis as unknown as PageGlobals
    const element = page.document.querySelector(query)
    if (!element) throw new Error(`nothing matches ${query}`)
    const { left, top, bottom, height } = element.getBoundingClientRect()
    return { left, top, bottom, height, paddingLeft: parseFloat(page.getComputedStyle(element).paddingLeft) }
  }, selector)

/**
 * snapshotThemes for a zoomed window: test-results/snapshots/<name>/light.png and dark.png, the
 * whole window in each theme. page.screenshot (and so snapshotThemes of test/e2e/snapshots.ts)
 * clips to the size of the viewport in CSS pixels, which at 150 % is two thirds of the window, so
 * it keeps only the top left of a zoomed page. The shot is asked of the page's own DevTools session
 * without a clip instead. As there, the opaque --sidebar stands in for the window's vibrancy and
 * transitions are off while the theme is switched.
 */
async function snapshotZoomed(window: Page, name: string): Promise<void> {
  const folder = join(test.info().project.outputDir, 'snapshots', name)
  mkdirSync(folder, { recursive: true })
  const session = await window.context().newCDPSession(window)
  const style = await window.addStyleTag({
    content: 'html { background: var(--sidebar) !important; } *, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const { data } = await session.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(folder, `${scheme}.png`), Buffer.from(data, 'base64'))
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
    await style.evaluate((element) => (element as unknown as { remove(): void }).remove())
    await session.detach()
  }
}

const settingsDialog = (window: Page) => window.getByRole('dialog', { name: 'Settings' })

async function openSettings(app: ElectronApplication, window: Page): Promise<void> {
  await clickMenuItem(app, SETTINGS)
  await expect(settingsDialog(window)).toBeVisible()
}

async function closeSettings(window: Page): Promise<void> {
  await window.keyboard.press('Escape')
  await expect(settingsDialog(window)).toHaveCount(0)
}

/**
 * The strips under the window buttons at `scale`: the toolbar, the strip above the sidebar and the
 * focus mode bar are 52 px of the window high, the toolbar without the sidebar and the focus mode
 * bar leave 80 px of the window on their left (macOS), and the palette opens right under the
 * toolbar. Leaves the sidebar hidden.
 */
async function expectStrips(window: Page, scale: number): Promise<void> {
  const at = `at ${scale * 100} %`
  const toggle = window.locator('.w-toolbar__icon-button').first()
  if ((await window.locator('.w-toolbar').getAttribute('data-sidebar')) === 'visible') {
    expect((await boxOf(window, '.w-sidebar__titlebar')).height * scale, `the strip above the sidebar ${at}`).toBeCloseTo(TOOLBAR_PX, 0)
    await toggle.click()
  }
  await expect(window.locator('.w-toolbar')).toHaveAttribute('data-sidebar', 'hidden')

  const toolbar = await boxOf(window, '.w-toolbar')
  expect(toolbar.height * scale, `the toolbar ${at}`).toBeCloseTo(TOOLBAR_PX, 0)
  if (mac) {
    // The first button starts where the room for the window buttons ends: not to the left of 80 px of the window.
    const first = await boxOf(window, '.w-toolbar__icon-button')
    expect(first.left * scale, `the first toolbar button ${at}`).toBeGreaterThanOrEqual(TRAFFIC_LIGHTS_PX - 0.5)
    expect(first.left * scale, `the first toolbar button ${at}`).toBeLessThan(TRAFFIC_LIGHTS_PX + 1)
  }

  // The palette hangs --space-2 (8 CSS px) under the toolbar, with no gap of the unscaled 52 px.
  await window.keyboard.press('ControlOrMeta+k')
  await expect(window.getByTestId('command-palette')).toBeVisible()
  const palette = await boxOf(window, '[data-testid="command-palette"]')
  expect(palette.top - toolbar.bottom, `the palette under the toolbar ${at}`).toBeCloseTo(8, 0)
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('command-palette')).toHaveCount(0)

  await window.locator('.react-flow__node[data-id="n1"] .w-note__header').click()
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
  await window.keyboard.press('ControlOrMeta+Enter')
  await expect(window.getByTestId('focus-mode')).toBeVisible()
  const bar = await boxOf(window, '.w-focus__bar')
  expect(bar.height * scale, `the focus mode bar ${at}`).toBeCloseTo(TOOLBAR_PX, 0)
  if (mac) expect(bar.paddingLeft * scale, `the room left of the focus mode bar ${at}`).toBeCloseTo(TRAFFIC_LIGHTS_PX, 0)
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('focus-mode')).toHaveCount(0)
}

test('the slider of Settings → General zooms the whole window when the thumb is let go, and the strips under the window buttons keep their size in pixels of the window', async () => {
  const { scratch, dataDir } = projectData()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await canvasReady(launched, { size: SIZE })

    // 100 %: the zoom is 1, and the toolbar height written on <html> is the one of the design tokens.
    await expectZoom(app, 1)
    const before = await pageMetrics(window)
    expect(before).toMatchObject({ innerWidth: SIZE.width, scale: '1' })
    const heights = await window.evaluate(() => {
      const page = globalThis as unknown as PageGlobals
      const toolbar = page.document.querySelector('.w-toolbar')
      if (!toolbar) throw new Error('no toolbar')
      const root = page.document.documentElement.style
      const written = root.getPropertyValue('--toolbar-height')
      const withScale = toolbar.getBoundingClientRect().height
      root.removeProperty('--toolbar-height')
      const withToken = toolbar.getBoundingClientRect().height
      root.setProperty('--toolbar-height', written)
      return { written, withScale, withToken }
    })
    expect(heights).toEqual({ written: `calc(${TOOLBAR_PX}px / 1)`, withScale: TOOLBAR_PX, withToken: TOOLBAR_PX })

    await openSettings(app, window)
    const dialog = settingsDialog(window)
    const slider = dialog.getByRole('slider', { name: 'Interface scale' })
    const value = dialog.getByTestId('settings-interface-scale-value')
    await expect(slider).toHaveValue('100')
    await expect(value).toHaveText('100 %')

    // The thumb dragged to the right end and held there: the value says 150 %, the window stays at 100 %.
    const track = await slider.boundingBox()
    if (!track) throw new Error('the slider has no box')
    const y = track.y + track.height / 2
    await window.mouse.move(track.x + track.width * 0.3, y)
    await window.mouse.down()
    await window.mouse.move(track.x + track.width * 0.7, y, { steps: 4 })
    await window.mouse.move(track.x + track.width + 20, y, { steps: 4 })
    await expect(value).toHaveText('150 %')
    await expect(slider).toHaveValue('150')
    expect(await zoomFactor(app)).toBeCloseTo(1, 5)
    expect(savedScale(dataDir)).toBeUndefined()
    expect((await pageMetrics(window)).innerWidth).toBe(SIZE.width)

    // Let go: the whole window is at 150 %. The page is 1.5 times narrower in CSS pixels, and its
    // text keeps its size in them — it is the pixel that grew.
    await window.mouse.up()
    await expectZoom(app, 1.5)
    await expect.poll(() => savedScale(dataDir)).toBe(1.5)
    await expect.poll(async () => (await pageMetrics(window)).scale).toBe('1.5')
    const zoomed = await pageMetrics(window)
    expect(Math.abs(zoomed.innerWidth * 1.5 - SIZE.width)).toBeLessThan(1.5)
    expect(zoomed.bodyFont).toBe(before.bodyFont)
    await expect(value).toHaveText('150 %')
    await expect(slider).toHaveValue('150')
    // At the largest scale View ▸ Bigger has no step left.
    expect([await menuItemEnabled(app, BIGGER), await menuItemEnabled(app, SMALLER)]).toEqual([false, true])

    // A step with a key applies at once: the browser reports `change` with every key.
    await slider.focus()
    await window.keyboard.press('ArrowLeft')
    await expectZoom(app, 1.4)
    await expect(value).toHaveText('140 %')
    expect(await menuItemEnabled(app, BIGGER)).toBe(true)
    await window.keyboard.press('ArrowRight')
    await expectZoom(app, 1.5)
    await expect(value).toHaveText('150 %')

    await snapshotZoomed(window, 'interface-scale-150-settings')
    await closeSettings(window)
    await snapshotZoomed(window, 'interface-scale-150-canvas')
    await expectStrips(window, 1.5)

    // The other end, set through the slider too.
    await openSettings(app, window)
    await slider.fill('80')
    await expectZoom(app, 0.8)
    await expect(value).toHaveText('80 %')
    await expect.poll(async () => (await pageMetrics(window)).scale).toBe('0.8')
    expect(Math.abs((await pageMetrics(window)).innerWidth * 0.8 - SIZE.width)).toBeLessThan(1.5)
    expect([await menuItemEnabled(app, BIGGER), await menuItemEnabled(app, SMALLER)]).toEqual([true, false])
    await closeSettings(window)
    await expectStrips(window, 0.8)

    // The menu items work under focus mode as well, and Settings follows a scale set by the menu.
    await window.locator('.react-flow__node[data-id="n1"] .w-note__header').click()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(window.getByTestId('focus-mode')).toBeVisible()
    await clickMenuItem(app, BIGGER)
    await expectZoom(app, 0.9)
    await clickMenuItem(app, SMALLER)
    await expectZoom(app, 0.8)
    await clickMenuItem(app, BIGGER)
    await expectZoom(app, 0.9)
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('focus-mode')).toHaveCount(0)
    await openSettings(app, window)
    await expect(slider).toHaveValue('90')
    await expect(value).toHaveText('90 %')
    await clickMenuItem(app, BIGGER)
    await expect(slider).toHaveValue('100')
    await expect(value).toHaveText('100 %')
  } finally {
    await launched.close()
    await removeDir(scratch)
  }
})

test('the scale is remembered: a restart over the same data folder comes back at 150 %, every load of the page puts it back, app-settings.json beats the zoom Chromium remembers, and Actual size returns to 100 %', async () => {
  const { scratch, dataDir } = projectData()
  try {
    const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await canvasReady(first, { size: SIZE })
      await openSettings(first.app, first.window)
      await settingsDialog(first.window).getByRole('slider', { name: 'Interface scale' }).fill('150')
      await expectZoom(first.app, 1.5)
      await expect.poll(() => savedScale(dataDir)).toBe(1.5)
    } finally {
      await first.close()
    }

    const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const { app, window } = second
      await expectZoom(app, 1.5)
      await expect.poll(async () => (await pageMetrics(window)).scale).toBe('1.5')
      const width = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize()[0])
      expect(width).toBe(SIZE.width)
      expect(Math.abs((await pageMetrics(window)).innerWidth * 1.5 - SIZE.width)).toBeLessThan(1.5)
      expect((await boxOf(window, '.w-toolbar')).height * 1.5).toBeCloseTo(TOOLBAR_PX, 0)
      await openSettings(app, window)
      await expect(settingsDialog(window).getByRole('slider', { name: 'Interface scale' })).toHaveValue('150')
      await closeSettings(window)

      // A zoom from elsewhere — Chromium keeps one of its own per origin — lasts until the page
      // loads: after a reload the window is back at the scale of the settings.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1))
      await expectZoom(app, 1)
      const loaded = window.waitForEvent('load')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.reload())
      await loaded
      await expectZoom(app, 1.5)
      // The page is back; at 150 % the second note is outside the Canvas and is not drawn.
      await expect(window.locator('.react-flow__node[data-id="n1"]')).toBeVisible()
      await expect.poll(async () => (await pageMetrics(window)).scale).toBe('1.5')
    } finally {
      await second.close()
    }

    // app-settings.json is the one that counts: changed while the app was closed, it beats the
    // 150 % Chromium remembers for the page in the same data folder.
    const settingsFile = join(dataDir, 'app-settings.json')
    writeFileSync(settingsFile, JSON.stringify({ ...(JSON.parse(readFileSync(settingsFile, 'utf8')) as object), interfaceScale: 1.2 }))
    const third = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const { app, window } = third
      await expectZoom(app, 1.2)
      await expect.poll(async () => (await pageMetrics(window)).scale).toBe('1.2')
      await expect(window.locator('.react-flow__node[data-id="n1"]')).toBeVisible()
      // Still 120 % once the page has settled: nothing puts Chromium's own zoom back.
      await canvasReady(third)
      expect(await zoomFactor(app)).toBeCloseTo(1.2, 5)

      await clickMenuItem(app, ACTUAL)
      await expectZoom(app, 1)
      await expect.poll(() => savedScale(dataDir)).toBe(1)
      await expect.poll(async () => (await pageMetrics(window)).innerWidth).toBe(SIZE.width)
      await expect.poll(async () => (await pageMetrics(window)).scale).toBe('1')
    } finally {
      await third.close()
    }
  } finally {
    await removeDir(scratch)
  }
})
