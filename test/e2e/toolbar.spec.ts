import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

// The toolbar with a long Project name: the name is cut with an ellipsis (full in its title), and
// the Canvas/Session switch, the Limits and the search field stay inside the window. The Limits
// are two days old, so their notes are the longest the toolbar shows ("resets … · as of …").

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
  return realpathSync(dir)
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

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-toolbar-')))
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
        if (width !== WIDTH) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setSize(wanted, 800), WIDTH)
        return width
      })
      .toBe(WIDTH)

    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, repo)
    await window.getByRole('button', { name: 'Add project' }).click()

    const toolbar = window.getByRole('banner')
    const name = toolbar.locator('.w-toolbar__name')
    const subtitle = toolbar.locator('.w-toolbar__subtitle')
    await expect(name).toHaveText(`worfy — ${LONG_NAME}`)
    await expect(subtitle).toHaveText(`${LONG_NAME} · main`)
    await expect(toolbar.getByTestId('limit-seven_day-note')).toContainText('as of')
    await expect(toolbar.getByTestId('app-version')).toBeVisible()
    // The build version from the Harness copy (out/harness, scripts/build-version.ts), longer than v0.0.0 was.
    await expect(toolbar.getByTestId('app-version')).toHaveText(new RegExp(`^v${packageVersion.replaceAll('.', '\\.')}\\+[0-9a-f]{7,}(\\.dirty)?$`))

    // Every other item of the toolbar is whole and inside the window, to the right of the title.
    const width = await innerWidth(window)
    const title = await box(toolbar.locator('.w-toolbar__title'))
    const items: Record<string, Locator> = {
      view: toolbar.getByRole('group', { name: 'View' }),
      limits: toolbar.getByTestId('limits-meter'),
      version: toolbar.getByTestId('app-version'),
      search: toolbar.locator('.w-toolbar__palette-hint'),
    }
    let previousRight = title.x + title.width
    for (const [item, locator] of Object.entries(items)) {
      const found = await box(locator)
      expect(found.x, `${item} starts after the item before it`).toBeGreaterThanOrEqual(previousRight)
      expect(found.x + found.width, `${item} ends inside the window (${width} px)`).toBeLessThanOrEqual(width)
      previousRight = found.x + found.width
    }

    // The name and the subtitle are cut with an ellipsis; the full text is their tooltip.
    for (const element of [name, subtitle.locator('.w-toolbar__subtitle-text')]) {
      const cut = await element.evaluate((node) => {
        const found = node as unknown as { scrollWidth: number; clientWidth: number; ownerDocument: { defaultView: { getComputedStyle(e: unknown): { textOverflow: string } } } }
        return { overflows: found.scrollWidth > found.clientWidth, textOverflow: found.ownerDocument.defaultView.getComputedStyle(found).textOverflow }
      })
      expect(cut).toEqual({ overflows: true, textOverflow: 'ellipsis' })
    }
    await expect(name).toHaveAttribute('title', `worfy — ${LONG_NAME}`)
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
