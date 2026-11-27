// worfy-layout ticket 04: the View buttons in their three zones of the built app — the header's group, the block of
// the rail under a line and the left of the footer (src/renderer/shell/ViewZone.tsx) — by the layout of the app
// settings of this Machine, the default one here (Q1): Canvas and Session in the header, Pull requests and Acceptance on
// the rail, Pipeline and Runs in the footer. In windows of 800×520 (the smallest), 1100, 1280 and 1600 px no zone
// leaves the window, and each width is shot in both themes (test-results/e2e/snapshots/04-view-buttons-<width>/).
// Ticket 05 moves them: the menu of a View button (Move to, Reset layout), the same Reset layout in Settings → General,
// and ⌥←; a second window of this Machine follows every change. Ticket 06 drags one from the footer into the header,
// with the zones lit and the marker of the gap drawn halfway (test-results/e2e/snapshots/06-view-buttons-drag/).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeSettings, launchApp, openSecondWindow, smallestWindow, viewButton, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
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

/**
 * Sizes the content of the app's first window, the one `launched.window` shows. With a second window open the order of
 * `getAllWindows()` names no first one: the lowest id is the window the app opened first (as menu.ts picks it).
 */
async function sizeWindow(launched: LaunchedApp, width: number): Promise<{ width: number; height: number }> {
  await expect
    .poll(async () => {
      const inner = await pageSize(launched.window)
      if (inner.width !== width)
        await launched.app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]?.setContentSize(wanted, 800), width)
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

/** The labels of a zone's View buttons, in order: their accessible names, whether their labels show or not. */
const namesIn = (zone: Locator): Promise<(string | null)[]> => zone.locator('[data-view-button]').evaluateAll((all) => all.map((each) => each.getAttribute('aria-label')))

test('the menu of a View button moves it to the end of another zone, ⌥← moves it within its zone, Reset layout from the menu and from Settings brings the default back; a second window follows each change', async () => {
  const launched = await launchApp()
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    const second = await openSecondWindow(launched)
    await expect(second.getByTestId('app-shell')).toBeVisible()
    // The first window takes the system focus back: a menu of the kit closes when its window loses it.
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]?.focus())

    // A right click on Pipeline in the footer: Move to with the footer checked and inactive, Reset layout inactive.
    await viewButton(window, 'pipeline').click({ button: 'right' })
    const menu = window.getByRole('menu', { name: 'Pipeline View button' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Header', 'Sidebar', 'Footer'])
    await expect(menu.getByRole('menuitemradio', { name: 'Footer' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitemradio', { name: 'Footer' })).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: 'Reset layout' })).toHaveAttribute('aria-disabled', 'true')
    await menu.getByRole('menuitemradio', { name: 'Header' }).click()
    await expect(menu).toHaveCount(0)
    // At the end of the header, focused there; the second window of this Machine shows the same.
    await expect.poll(() => namesIn(header(window))).toEqual(['Canvas', 'Session', 'Pipeline'])
    await expect(viewButton(window, 'pipeline')).toHaveAttribute('data-zone', 'header')
    await expect(viewButton(window, 'pipeline')).toBeFocused()
    expect(await namesIn(footerGroup(window))).toEqual(['Runs'])
    await expect.poll(() => namesIn(header(second))).toEqual(['Canvas', 'Session', 'Pipeline'])

    // ⌥← (Alt+← on Windows) moves it within the header and the focus stays on it; at the edge nothing happens.
    await window.keyboard.press('Alt+ArrowLeft')
    await expect.poll(() => namesIn(header(window))).toEqual(['Canvas', 'Pipeline', 'Session'])
    await expect(viewButton(window, 'pipeline')).toBeFocused()
    await expect.poll(() => namesIn(header(second))).toEqual(['Canvas', 'Pipeline', 'Session'])
    await window.keyboard.press('Alt+ArrowLeft')
    await expect.poll(() => namesIn(header(window))).toEqual(['Pipeline', 'Canvas', 'Session'])
    await window.keyboard.press('Alt+ArrowLeft')
    await expect(viewButton(window, 'pipeline')).toBeFocused()
    expect(await namesIn(header(window))).toEqual(['Pipeline', 'Canvas', 'Session'])

    // Shift+F10 on the focused Acceptance of the rail opens its menu: four buttons in the header now.
    await viewButton(window, 'acceptance').focus()
    await window.keyboard.press('Shift+F10')
    const acceptanceMenu = window.getByRole('menu', { name: 'Acceptance View button' })
    await expect(acceptanceMenu.getByRole('menuitemradio', { name: 'Sidebar' })).toHaveAttribute('aria-checked', 'true')
    await acceptanceMenu.getByRole('menuitemradio', { name: 'Header' }).click()
    await expect.poll(() => namesIn(header(window))).toEqual(['Pipeline', 'Canvas', 'Session', 'Acceptance'])
    await expect(viewButton(window, 'acceptance')).toBeFocused()
    // From four buttons on the header's labels give way under 1400 px, and are back above it (shell.css).
    await sizeWindow(launched, 1280)
    await expect(viewButton(window, 'session').locator('.w-segmented__label')).toBeHidden()
    await expectZonesInside(window, '1280 px, four buttons in the header')
    await sizeWindow(launched, 1600)
    await expect(viewButton(window, 'session').locator('.w-segmented__label')).toBeVisible()

    // Reset layout from the menu of any button: the default in both windows.
    await viewButton(window, 'canvas').click({ button: 'right' })
    const canvasMenu = window.getByRole('menu', { name: 'Canvas View button' })
    await canvasMenu.getByRole('menuitem', { name: 'Reset layout' }).click()
    await expect.poll(() => namesIn(header(window))).toEqual(['Canvas', 'Session'])
    expect(await namesIn(railBlock(window))).toEqual(['Pull requests', 'Acceptance'])
    expect(await namesIn(footerGroup(window))).toEqual(['Pipeline', 'Runs'])
    await expect.poll(() => namesIn(footerGroup(second))).toEqual(['Pipeline', 'Runs'])

    // Settings → General has the same Reset layout, inactive at the default.
    await viewButton(window, 'session').click({ button: 'right' })
    await window.getByRole('menu', { name: 'Session View button' }).getByRole('menuitemradio', { name: 'Footer' }).click()
    await expect.poll(() => namesIn(footerGroup(window))).toEqual(['Pipeline', 'Runs', 'Session'])
    await clickMenuItem(launched.app, 'app.settings')
    const dialog = window.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'General', exact: true }).click()
    const reset = dialog.getByTestId('settings-view-buttons-row').getByRole('button', { name: 'Reset layout' })
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()
    await closeSettings(window)
    await expect.poll(() => namesIn(header(window))).toEqual(['Canvas', 'Session'])
    await expect.poll(() => namesIn(footerGroup(second))).toEqual(['Pipeline', 'Runs'])
  } finally {
    await launched.close()
  }
})

/** The width of the line a button draws as the marker of a drag (its `::after`, shell.css); `auto` when none. */
const markerWidth = (button: Locator): Promise<string> =>
  button.evaluate((node) => {
    const view = globalThis as unknown as { getComputedStyle(element: unknown, pseudo: string): { width: string } }
    return view.getComputedStyle(node, '::after').width
  })

test('a drag takes Runs from the footer into the header between Canvas and Session; halfway the three zones are lit and the marker stands before Session (ticket 06)', async () => {
  const launched = await launchApp()
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // Without a Project Runs is inactive, and is dragged all the same: the layout does not depend on the Project.
    const runs = viewButton(window, 'history')
    const session = viewButton(window, 'session')
    const from = await box(runs)
    const to = await box(session)
    // A drag as Playwright's dragTo makes it, stopped halfway: over the left half of Session, the gap after Canvas.
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await window.mouse.down()
    const over = { x: to.x + to.width / 4, y: to.y + to.height / 2 }
    await window.mouse.move(over.x, over.y, { steps: 8 })
    // Playwright sends the page a drag event per move, and the element a drag enters gets its first `dragover` only on
    // the next one: small moves inside the left half of Session bring it there, as a hand that holds still does.
    let nudge = 0
    await expect
      .poll(async () => {
        nudge = (nudge % 4) + 1
        await window.mouse.move(over.x + nudge, over.y)
        return session.getAttribute('data-drop-marker')
      })
      .toBe('before')
    await expect(window.getByTestId('app-shell')).toHaveAttribute('data-view-drag', 'history')
    await expect(header(window)).toHaveAttribute('data-drop-zone', 'over')
    await expect(railBlock(window)).toHaveAttribute('data-drop-zone', 'on')
    await expect(footerGroup(window)).toHaveAttribute('data-drop-zone', 'on')
    await expect(session).toHaveAttribute('data-drop-marker', 'before')
    expect(await markerWidth(session)).toBe('2px')
    const shots = await snapshotThemes(window, '06-view-buttons-drag')
    console.log(`view buttons halfway through a drag: ${shots.light} ${shots.dark}`)
    await window.mouse.up()
    await expect.poll(() => namesIn(header(window))).toEqual(['Canvas', 'Runs', 'Session'])
    expect(await namesIn(footerGroup(window))).toEqual(['Pipeline'])
    await expect(viewButton(window, 'history')).toHaveAttribute('data-zone', 'header')
    await expect(window.getByTestId('app-shell')).not.toHaveAttribute('data-view-drag')
    await expect(window.locator('[data-drop-zone]')).toHaveCount(0)
    await expect(window.locator('[data-drop-marker]')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
