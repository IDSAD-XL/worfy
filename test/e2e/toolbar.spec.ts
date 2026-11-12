import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildNumber } from '../../scripts/build-version'
import { animatedText, launchApp, repoRoot, smallestWindow, type LaunchedApp } from './helpers'
import { profileJsonScript } from '../harness-node'

/**
 * A `bin/profile` stub that knows every folder: `--json` exits 0, a `--field` is absent (exit 4).
 * "Add project" then puts a repository into the list at once, without the dialog that connects a
 * new one (worfy-harness ticket 24).
 */
const KNOWS_ALL = profileJsonScript('{"name":"stub","_resolved":{"workspace":null}}')

// The toolbar with a long Project name: the name is cut with an ellipsis (full in its title), and
// the Canvas/Session switch, the Limits, the Harness item and the search field stay inside the
// window. The Limits are two days old, so their notes are the longest the toolbar shows
// ("resets … · as of …").

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** 80 characters: the folder name of the repository is the Project's name. */
const LONG_NAME = 'a-project-with-a-very-long-name-that-does-not-fit-into-the-toolbar-of-the-window'
const WIDTH = 1280
const packageVersion = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version

function makeRepo(parent: string, name: string): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), name)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return realpathSync.native(dir)
}

/** limits.json with both windows received two days ago. */
function staleLimits(dataDir: string): void {
  const receivedAt = Date.now() - 2 * 24 * 60 * 60 * 1000
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 24 * 3600
  const window = (utilization: number) => ({ utilization, resetsAt, status: null, receivedAt, source: 'sdk' })
  writeFileSync(join(dataDir, 'limits.json'), JSON.stringify({ windows: { five_hour: window(0.62), seven_day: window(0.38) } }))
}

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error(`${locator.toString()} is not on screen`)
  return found
}

const innerWidth = (window: Page): Promise<number> => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)

/** Adds the repository at `repo` as a Project through "Add project", with a `bin/profile` stub that knows it. */
async function addProject(launched: LaunchedApp, repo: string): Promise<void> {
  mkdirSync(join(launched.claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(launched.claudeHome, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
  await launched.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, repo)
  await launched.window.getByRole('button', { name: 'Add project' }).click()
}

/** The window's content to `width` × `height` px, once the page has taken that width. */
async function sizeWindow({ app, window }: LaunchedApp, width: number, height: number): Promise<void> {
  await expect
    .poll(async () => {
      const now = await innerWidth(window)
      if (now !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), { width, height })
      return now
    })
    .toBe(width)
}

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-toolbar-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('a Project name of 80 characters is cut with an ellipsis and the rest of the toolbar stays in a 1280 px window', async () => {
  expect(LONG_NAME).toHaveLength(80)
  const repo = makeRepo(scratch, LONG_NAME)
  staleLimits(dataDir)

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true)
    // Set the size once the window is on screen (macOS fits a window shown later into the display).
    await expect
      .poll(async () => {
        const width = await innerWidth(window)
        if (width !== WIDTH) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 800), WIDTH)
        return width
      })
      .toBe(WIDTH)

    await addProject(launched, repo)

    const toolbar = window.getByRole('banner')
    const name = toolbar.locator('.w-toolbar__name')
    const subtitle = toolbar.locator('.w-toolbar__subtitle')
    await expect(name).toHaveText(LONG_NAME)
    await expect(subtitle).toHaveText(`${LONG_NAME} · main`)
    // Old data: the bar is dimmed with "as of" as its tooltip, and no "as of" line (worfy-ui ticket 18).
    await expect(toolbar.getByTestId('limit-seven_day')).toHaveAttribute('title', / · as of /)
    await expect(toolbar.getByTestId('limit-seven_day')).not.toContainText('as of')
    await expect(toolbar.getByTestId('app-version')).toBeVisible()
    await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness not installed')
    await expect(toolbar.getByTestId('harness-action')).toHaveAccessibleName('Install')
    // The build version from the Harness copy (out/harness, scripts/build-version.ts), longer than v0.0.0 was;
    // numbered `v<major>.<minor>.<N>` where the checkout has its whole history (worfy-update ticket 14).
    const number = buildNumber(repoRoot)
    const [major, minor] = packageVersion.split('.')
    await expect(toolbar.getByTestId('app-version')).toHaveText(
      number === null ? new RegExp(`^v${packageVersion.replaceAll('.', '\\.')}\\+[0-9a-f]{7,}(\\.dirty)?$`) : new RegExp(`^v${major}\\.${minor}\\.${number}(\\.dirty)?$`),
    )
    // worfy's own memory after the version, on the same line of the Harness column (worfy-ui ticket 20):
    // the column measured below carries it.
    await expect(toolbar.getByTestId('app-line').getByTestId('app-memory')).toHaveText(/^\d+(\.\d)? (MB|GB)$/)

    // Every other item of the toolbar is whole and inside the window, to the right of the title.
    const width = await innerWidth(window)
    const title = await box(toolbar.locator('.w-toolbar__title'))
    const items: Record<string, Locator> = {
      view: toolbar.getByRole('group', { name: 'View', exact: true }),
      limits: toolbar.getByTestId('limits-meter'),
      // worfy-harness ticket 13: "Harness not installed" with its Install button (the Claude home of launchApp is a sandbox),
      // and the app version under it in one column (worfy-ui ticket 18).
      harness: toolbar.getByTestId('harness-column'),
      search: toolbar.locator('.w-toolbar__palette-hint'),
    }
    let previousRight = title.x + title.width
    for (const [item, locator] of Object.entries(items)) {
      const found = await box(locator)
      expect(found.x, `${item} starts after the item before it`).toBeGreaterThanOrEqual(previousRight)
      expect(found.x + found.width, `${item} ends inside the window (${width} px)`).toBeLessThanOrEqual(width)
      previousRight = found.x + found.width
    }
    // The version is the second line of the Harness column: below the Harness line, inside the toolbar.
    const harnessLine = await box(toolbar.getByTestId('harness-status'))
    const version = await box(toolbar.getByTestId('app-version'))
    const bar = await box(toolbar)
    expect(version.y, 'the version is under the Harness line').toBeGreaterThanOrEqual(harnessLine.y + harnessLine.height - 1)
    expect(harnessLine.y, 'the Harness line is inside the toolbar').toBeGreaterThanOrEqual(bar.y)
    expect(version.y + version.height, 'the version is inside the toolbar').toBeLessThanOrEqual(bar.y + bar.height)

    // The name and the subtitle are cut with an ellipsis; the full text is their tooltip.
    for (const element of [name, subtitle.locator('.w-toolbar__subtitle-text')]) {
      const cut = await element.evaluate((node) => {
        const found = node as unknown as { scrollWidth: number; clientWidth: number; ownerDocument: { defaultView: { getComputedStyle(e: unknown): { textOverflow: string } } } }
        return { overflows: found.scrollWidth > found.clientWidth, textOverflow: found.ownerDocument.defaultView.getComputedStyle(found).textOverflow }
      })
      expect(cut).toEqual({ overflows: true, textOverflow: 'ellipsis' })
    }
    await expect(name).toHaveAttribute('title', LONG_NAME)
    await expect(subtitle).toHaveAttribute('title', `${LONG_NAME} · main`)

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await toolbar.screenshot({ path: test.info().outputPath(`toolbar-long-name-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
  } finally {
    await launched.close()
  }
})

// worfy-polish ticket 48: the smallest window (800×520) with the sidebar open, where the toolbar is
// narrowest. The toolbar is no wider than the window: the Limits show their percents alone (the
// window names and reset lines are the tooltip), the search field its icon and shortcut, the Harness
// line ends with an ellipsis, and the step of an Update build is cut the same way. The order and the
// set of items stay. At 1600 px everything is spelled out again.

/** limits.json with both windows received now: each bar has its reset line. */
function freshLimits(dataDir: string): void {
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 24 * 3600
  const window = (utilization: number) => ({ utilization, resetsAt, status: 'allowed', receivedAt: Date.now(), source: 'sdk' })
  writeFileSync(join(dataDir, 'limits.json'), JSON.stringify({ windows: { five_hour: window(0.62), seven_day: window(0.38) } }))
}

const NEWER = 'b'.repeat(40)

/** Main's snapshot of an Update build held at `pnpm install`, as update.changed sends it. */
const buildingSnapshot = () => ({
  enabled: true,
  checking: false,
  restartWhenIdle: false,
  lastCheck: { at: new Date().toISOString(), result: 'ok' },
  available: { sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}`, quiet: false },
  build: { phase: 'building', sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}`, step: 'install', steps: 3, startedAt: new Date().toISOString(), stepStartedAt: new Date().toISOString() },
  idle: true,
  previous: null,
  rolledBackFrom: null,
  harnessBehind: null,
  running: null,
  lastRestart: null,
  harnessAfterUpdate: null,
})

/** How wide the toolbar draws and how wide it is, and where it ends in the window. */
const toolbarWidths = (toolbar: Locator) =>
  toolbar.evaluate((element) => {
    const node = element as unknown as { scrollWidth: number; clientWidth: number; getBoundingClientRect(): { right: number }; ownerDocument: { defaultView: { innerWidth: number } } }
    return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, right: node.getBoundingClientRect().right, window: node.ownerDocument.defaultView.innerWidth }
  })

/** The toolbar draws no wider than the window, and each item is whole, after the one before it and inside the window. */
async function expectItemsInside(window: Page, toolbar: Locator, what: string): Promise<void> {
  const widths = await toolbarWidths(toolbar)
  expect(widths.scrollWidth, `${what}: the toolbar draws no wider than it is`).toBeLessThanOrEqual(widths.clientWidth)
  expect(widths.right, `${what}: the toolbar ends inside the window`).toBeLessThanOrEqual(widths.window)
  const width = await innerWidth(window)
  let previousRight = (await box(toolbar.locator('.w-toolbar__title'))).x
  for (const [item, locator] of Object.entries({
    view: toolbar.getByRole('group', { name: 'View', exact: true }),
    limits: toolbar.getByTestId('limits-meter'),
    harness: toolbar.getByTestId('harness-column'),
    search: toolbar.getByTestId('palette-trigger'),
  })) {
    const found = await box(locator)
    expect(found.x, `${what}: ${item} starts after the item before it`).toBeGreaterThanOrEqual(previousRight - 0.5)
    expect(found.x + found.width, `${what}: ${item} ends inside the window (${width} px)`).toBeLessThanOrEqual(width)
    previousRight = found.x + found.width
  }
}

/** Whether the text of `locator` is cut, and how. */
const cutWithEllipsis = (locator: Locator) =>
  locator.evaluate((element) => {
    const node = element as unknown as { scrollWidth: number; clientWidth: number; ownerDocument: { defaultView: { getComputedStyle(e: unknown): { textOverflow: string } } } }
    return { overflows: node.scrollWidth > node.clientWidth, textOverflow: node.ownerDocument.defaultView.getComputedStyle(node).textOverflow }
  })

/** The contrast of the text of `locator` with the first opaque background under it (WCAG 2). */
function contrast(locator: Locator): Promise<number> {
  // The page's own types: the e2e tests compile without the DOM library.
  type Styled = { parentElement: Styled | null }
  return locator.evaluate((element: Styled) => {
    const style = (each: Styled) => (globalThis as unknown as { getComputedStyle(of: Styled): { color: string; backgroundColor: string } }).getComputedStyle(each)
    const rgb = (value: string): number[] => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
    }
    const luminance = (color: number[]): number => {
      const channel = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channel(color[0] ?? 0) + 0.7152 * channel(color[1] ?? 0) + 0.0722 * channel(color[2] ?? 0)
    }
    let fill = [255, 255, 255, 1]
    for (let back: Styled | null = element; back !== null; back = back.parentElement) {
      const color = rgb(style(back).backgroundColor)
      if (color[3] === 1) {
        fill = color
        break
      }
    }
    // A text colour with alpha is drawn over the background.
    const text = rgb(style(element).color)
    const alpha = text[3] ?? 1
    const drawn = [0, 1, 2].map((at) => (text[at] ?? 0) * alpha + (fill[at] ?? 0) * (1 - alpha))
    const [a, b] = [luminance(drawn), luminance(fill)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

test('in the smallest window with the sidebar open the toolbar is no wider than the window, during an Update build too; at 1600 px the labels are back', async () => {
  const repo = makeRepo(scratch, LONG_NAME)
  freshLimits(dataDir)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true)
    await addProject(launched, repo)
    const toolbar = window.getByRole('banner')
    await expect(toolbar.locator('.w-toolbar__name')).toHaveText(LONG_NAME)
    await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness not installed')
    await expect(window.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
    const fiveHour = toolbar.getByTestId('limit-five_hour')
    const percent = fiveHour.getByTestId('limit-five_hour-value')
    const search = toolbar.getByTestId('palette-trigger')

    const smallest = await smallestWindow(launched)
    expect(smallest.width, 'the content of an 800 px window').toBeLessThanOrEqual(800)
    await expectItemsInside(window, toolbar, 'smallest window')
    // The Limits: the percents alone; the window's name and its reset line are the tooltip of the percent.
    await expect(animatedText(percent)).toHaveText('62%')
    await expect(fiveHour.getByText('5h', { exact: true })).toBeHidden()
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toBeHidden()
    await expect(toolbar.getByTestId('limits-meter').getByText('Limits', { exact: true })).toBeHidden()
    await expect(percent).toHaveAttribute('title', /^5-hour: 62% · resets ([A-Z][a-z]{2} )?\d\d:\d\d$/u)
    // The search field: its icon and its shortcut; its name stays.
    await expect(search.locator('.w-toolbar__palette-text')).toBeHidden()
    await expect(search.locator('kbd')).toBeVisible()
    await expect(search).toHaveAccessibleName('Search or run…')
    // The Harness line may end with an ellipsis: its whole text is the tooltip.
    await expect(toolbar.getByTestId('harness-text')).toHaveAttribute('title', 'Harness not installed')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      for (const [what, text] of Object.entries({ percent, shortcut: search.locator('kbd'), version: toolbar.getByTestId('app-version') })) {
        expect(await contrast(text), `${what} in the ${scheme} theme`).toBeGreaterThanOrEqual(4.5)
      }
      await toolbar.screenshot({ path: test.info().outputPath(`48-header-800x520-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // An Update builds: the step on the chip ends with an ellipsis, its whole text in the tooltip.
    await app.evaluate(({ BrowserWindow }, payload) => {
      for (const each of BrowserWindow.getAllWindows()) each.webContents.send('worfy:update.changed', payload)
    }, buildingSnapshot())
    const chip = toolbar.getByTestId('app-version')
    const step = chip.locator('.w-toolbar__version-step')
    await expect(chip).toHaveText('Updating · 2/3 Installing dependencies')
    await expect(chip).toHaveAttribute('title', /^Updating · 2\/3 Installing dependencies\n/u)
    expect(await cutWithEllipsis(step)).toEqual({ overflows: true, textOverflow: 'ellipsis' })
    await expectItemsInside(window, toolbar, 'smallest window, an Update building')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      expect(await contrast(step), `the step in the ${scheme} theme`).toBeGreaterThanOrEqual(4.5)
      await toolbar.screenshot({ path: test.info().outputPath(`48-header-800x520-building-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // 1600 px: the labels, the reset lines and the words of the search field are back.
    await sizeWindow(launched, 1600, 900)
    await expectItemsInside(window, toolbar, '1600 px')
    await expect(fiveHour.getByText('5h', { exact: true })).toBeVisible()
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toBeVisible()
    await expect(search.locator('.w-toolbar__palette-text')).toBeVisible()
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await toolbar.screenshot({ path: test.info().outputPath(`48-header-1600-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
  } finally {
    await launched.close()
  }
})
