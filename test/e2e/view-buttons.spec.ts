// worfy-layout ticket 04: the View buttons in their three zones of the built app — the header's group, the block of
// the rail under a line and the left of the footer (src/renderer/shell/ViewZone.tsx) — by the layout of the app
// settings of this Machine, the default one here (Q1): Canvas and Session in the header, Pull requests and Acceptance on
// the rail, Pipeline and Runs in the footer. In windows of 800×520 (the smallest), 1100, 1280 and 1600 px no zone
// leaves the window, and each width is shot in both themes (test-results/e2e/snapshots/04-view-buttons-<width>/).
// Moving buttons (the menu, the keys, a drag) is the spec of worfy-layout tickets 05 and 06.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, smallestWindow, viewButton, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error(`${locator.toString()} is not on screen`)
  return found
}

const pageSize = (window: Page): Promise<{ width: number; height: number }> =>
  window.evaluate(() => {
    const view = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return { width: view.innerWidth, height: view.innerHeight }
  })

async function sizeWindow(launched: LaunchedApp, width: number): Promise<{ width: number; height: number }> {
  await expect
    .poll(async () => {
      const inner = await pageSize(launched.window)
      if (inner.width !== width) await launched.app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 800), width)
      return inner.width
    })
    .toBe(width)
  return pageSize(launched.window)
}

const header = (window: Page): Locator => window.getByRole('banner').getByRole('group', { name: 'View', exact: true })
const railBlock = (window: Page): Locator => window.getByRole('navigation', { name: 'Sidebar' }).locator('.w-view-zone--rail')
const footerGroup = (window: Page): Locator => window.getByTestId('footer').locator('.w-view-zone--footer')

/** Each zone, and each of its buttons, lies wholly inside the window; the header and the footer draw no wider than they are. */
async function expectZonesInside(window: Page, what: string): Promise<void> {
  const page = await pageSize(window)
  // The rail scrolls when the window is low (shell.css): its block is brought into view first, as a person scrolls to it.
  await railBlock(window).scrollIntoViewIfNeeded()
  for (const [zone, locator] of [
    ['header', header(window)],
    ['rail', railBlock(window)],
    ['footer', footerGroup(window)],
  ] as const) {
    const zoneBox = await box(locator)
    for (const part of [zoneBox, ...(await Promise.all((await locator.locator('[data-view-button]').all()).map(box)))]) {
      expect(part.x, `${what}: the ${zone} starts inside the window`).toBeGreaterThanOrEqual(0)
      expect(part.y, `${what}: the ${zone} starts inside the window`).toBeGreaterThanOrEqual(0)
      expect(part.x + part.width, `${what}: the ${zone} ends inside the window (${page.width} px)`).toBeLessThanOrEqual(page.width + 0.5)
      expect(part.y + part.height, `${what}: the ${zone} ends inside the window (${page.height} px)`).toBeLessThanOrEqual(page.height + 0.5)
    }
  }
  for (const strip of [window.locator('.w-toolbar'), window.getByTestId('footer')]) {
    const widths = await strip.evaluate((node) => {
      const found = node as unknown as { scrollWidth: number; clientWidth: number }
      return { scrollWidth: found.scrollWidth, clientWidth: found.clientWidth }
    })
    expect(widths.scrollWidth, `${what}: ${strip.toString()} draws no wider than it is`).toBeLessThanOrEqual(widths.clientWidth)
  }
}

test('the default layout: Canvas and Session in the header, Pull requests and Acceptance on the rail under a line, Pipeline and Runs in the footer; no zone leaves a window of 800×520, 1100, 1280 or 1600 px', async () => {
  const launched = await launchApp()
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect(header(window).getByRole('button')).toHaveText(['Canvas', 'Session'])
    await expect(railBlock(window)).toHaveAttribute('role', 'group')
    await expect(railBlock(window)).toHaveAccessibleName('Views')
    expect(await railBlock(window).locator('[data-view-button]').evaluateAll((all) => all.map((each) => each.getAttribute('aria-label')))).toEqual(['Pull requests', 'Acceptance'])
    // The block is no part of the sections' tablist, and each of its buttons carries the «window» mark.
    await expect(window.getByRole('tablist', { name: 'Sidebar sections' }).locator('[data-view-button]')).toHaveCount(0)
    await expect(railBlock(window).getByTestId('view-button-window')).toHaveCount(2)
    expect(await footerGroup(window).locator('[data-view-button]').evaluateAll((all) => all.map((each) => each.getAttribute('aria-label')))).toEqual(['Pipeline', 'Runs'])

    // The button of the view on screen is pressed in whatever zone it stands.
    await expect(viewButton(window, 'canvas')).toHaveAttribute('aria-pressed', 'true')
    await viewButton(window, 'pipeline').click()
    await expect(window.getByRole('main', { name: 'Pipeline' })).toBeVisible()
    await expect(viewButton(window, 'pipeline')).toHaveAttribute('aria-pressed', 'true')
    await expect(viewButton(window, 'canvas')).toHaveAttribute('aria-pressed', 'false')
    await viewButton(window, 'acceptance').click()
    await expect(window.getByRole('main', { name: 'Acceptance' })).toBeVisible()
    await expect(viewButton(window, 'acceptance')).toHaveAttribute('aria-pressed', 'true')
    await viewButton(window, 'canvas').click()

    // The smallest window first, then the three widths.
    const smallest = await smallestWindow(launched)
    await expectZonesInside(window, `${smallest.width}×${smallest.height}`)
    const shots = await snapshotThemes(window, '04-view-buttons-800')
    console.log(`view buttons 800×520: ${shots.light} ${shots.dark}`)
    for (const width of [1100, 1280, 1600]) {
      const size = await sizeWindow(launched, width)
      await expectZonesInside(window, `${size.width}×${size.height}`)
      // Labels: the header's two buttons keep theirs down to 1100 px; at 1100 px and narrower the header and the
      // footer show icons and badges alone (shell.css).
      const labels = width > 1100
      await expect(viewButton(window, 'session').locator('.w-segmented__label'))[labels ? 'toBeVisible' : 'toBeHidden']()
      await expect(viewButton(window, 'history').locator('.w-view-button__label'))[labels ? 'toBeVisible' : 'toBeHidden']()
      const widthShots = await snapshotThemes(window, `04-view-buttons-${width}`)
      console.log(`view buttons ${width} px: ${widthShots.light} ${widthShots.dark}`)
    }
  } finally {
    await launched.close()
  }
})

test('with the sidebar hidden the rail buttons stand at the end of the header after a line, and the header stays inside the smallest window', async () => {
  const launched = await launchApp()
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.getByRole('navigation', { name: 'Sidebar' }).getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(window.getByRole('navigation', { name: 'Sidebar' })).toHaveCount(0)
    await expect(header(window).getByRole('button')).toHaveText(['Canvas', 'Session', 'Pull requests', 'Acceptance'])
    await expect(header(window).locator('.w-view-zone__line')).toHaveCount(1)
    await expect(viewButton(window, 'acceptance')).toHaveAttribute('data-zone', 'rail')
    // Drawn in the header, they have its look: no «window» mark.
    await expect(header(window).getByTestId('view-button-window')).toHaveCount(0)
    const smallest = await smallestWindow(launched)
    const page = await pageSize(window)
    for (const part of [await box(header(window)), await box(footerGroup(window))]) {
      expect(part.x + part.width, `${smallest.width}×${smallest.height}: inside the window`).toBeLessThanOrEqual(page.width + 0.5)
    }
    const shots = await snapshotThemes(window, '04-view-buttons-sidebar-hidden')
    console.log(`view buttons, sidebar hidden: ${shots.light} ${shots.dark}`)
  } finally {
    await launched.close()
  }
})
