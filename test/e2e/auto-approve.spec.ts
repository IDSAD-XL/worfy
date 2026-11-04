import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Auto-approval switch under the Orchestrator's input field (worfy-auto-approve ticket 06) against
// the built app, on the fake agent, over a temporary data folder: a button as narrow as Eco mode right
// of it, Off for a Project with no entry; its menu holds the three positions; choosing one writes the
// Project's mode into app-settings.json of the data folder; an edit of that file made outside worfy
// shows only after the app starts again. At the window the app opens in, Send stays on the line of
// the pickers.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string
let settingsFile: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-auto-approve-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'alpha')
  for (const dir of [join(dataDir, PROJECT), claudeHome, repo]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  settingsFile = join(dataDir, 'app-settings.json')
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Opens the Orchestrator's Session view with a double click on its Node. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

/** The bar under the input field in the light and the dark theme, into the test's output folder. */
async function snapshotBar(window: Page, bar: Locator, name: string): Promise<void> {
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await bar.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`), animations: 'disabled' })
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

const modes = (): unknown => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { autoApproval?: unknown }).autoApproval

test("the Orchestrator's Auto-approval switch: Off by default, a click writes the Project's mode, an outside edit shows after a restart", async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' }
  const first = await launchApp({ env })
  try {
    const { window } = first
    const view = await openSession(window)
    const bar = view.locator('.w-composer__bar')
    const button = bar.getByRole('button', { name: 'Auto-approval' })
    const menu = window.getByRole('menu', { name: 'Auto-approval' })
    const position = (name: string) => menu.getByRole('menuitemradio', { name: new RegExp(`^${name}`, 'u') })
    const choose = async (name: string, mode: string) => {
      await button.click()
      await position(name).click()
      await expect(menu).toHaveCount(0)
      await expect(button).toHaveAttribute('data-mode', mode)
      await expect(button).not.toHaveAttribute('aria-busy', 'true')
    }

    // Off, usable, right of Eco mode and as tall; Send still on the line of the pickers.
    await expect(button).toHaveAttribute('data-mode', 'off')
    await expect(button).not.toHaveAttribute('aria-disabled', 'true')
    await expect(button).toHaveAttribute('title', /^Auto-approval off:/u)
    const eco = bar.getByRole('switch', { name: 'Eco mode' })
    const [own, ecoBox, send, pickers] = [await button.boundingBox(), await eco.boundingBox(), await bar.getByTestId('input-send').boundingBox(), await bar.getByTestId('pickers').boundingBox()]
    expect(own!.x).toBeGreaterThan(ecoBox!.x)
    expect(Math.round(own!.height)).toBe(Math.round(ecoBox!.height))
    expect(Math.abs(send!.y + send!.height / 2 - (pickers!.y + pickers!.height / 2))).toBeLessThan(4)
    await snapshotBar(window, bar, 'auto-approval-off')

    // The menu: three positions, each with its own tooltip, Off checked.
    await button.click()
    await expect(menu.getByRole('menuitemradio')).toHaveCount(3)
    await expect(position('Off')).toHaveAttribute('aria-checked', 'true')
    await expect(position('Off')).toHaveAttribute('title', /^Auto-approval off:/u)
    await expect(position('Shadow')).toHaveAttribute('title', /^Auto-approval shadow:/u)
    await expect(position('On')).toHaveAttribute('title', /^Auto-approval on:/u)
    await expect(position('Off')).toBeFocused()
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`auto-approval-menu-${scheme}.png`), animations: 'disabled' })
    }
    await window.emulateMedia({ colorScheme: null })
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    await choose('Shadow', 'shadow')
    expect(modes()).toEqual({ [PROJECT]: 'shadow' })
    await snapshotBar(window, bar, 'auto-approval-shadow')

    await choose('On', 'on')
    expect(modes()).toEqual({ [PROJECT]: 'on' })
    await snapshotBar(window, bar, 'auto-approval-on')

    // Back to Off removes the entry: no entry is Off.
    await choose('Off', 'off')
    expect(modes()).toBeUndefined()

    // An edit made outside worfy: the running app does not take it, even in a view opened again.
    const outside = { ...(JSON.parse(readFileSync(settingsFile, 'utf8')) as object), autoApproval: { [PROJECT]: 'shadow' } }
    writeFileSync(settingsFile, JSON.stringify(outside))
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    const again = await openSession(window)
    await expect(again.locator('.w-composer__bar').getByRole('button', { name: 'Auto-approval' })).toHaveAttribute('data-mode', 'off')
  } finally {
    await first.close()
  }

  // The next start reads the file.
  const second = await launchApp({ env })
  try {
    const view = await openSession(second.window)
    await expect(view.locator('.w-composer__bar').getByRole('button', { name: 'Auto-approval' })).toHaveAttribute('data-mode', 'shadow')
  } finally {
    await second.close()
  }
})
