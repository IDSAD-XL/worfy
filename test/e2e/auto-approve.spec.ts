import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Auto-approval switch under the Orchestrator's input field (worfy-auto-approve ticket 06) against
// the built app, on the fake agent, over a temporary data folder. Playwright drives Electron through
// its debugging port and Node inspector (it starts it with --remote-debugging-port=0 --inspect=0), so
// this run is the case the switch guards against: any local process could script the window. The
// switch therefore shows Off, unavailable, says why and which mode is saved, opens no menu and writes
// nothing; the mode saved in app-settings.json is read at start, and an edit of the file made outside
// worfy is not picked up by the running app. Choosing a position and the write are covered by
// test/unit/auto-approve-switch.test.tsx and test/contract/auto-approve-setting.test.ts. At the window
// the app opens in, the switch is as tall as Eco mode, right of it, and Send stays on the pickers' line.

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

const writeModes = (entries: Record<string, string>): void => {
  const current = existsSync(settingsFile) ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as object) : {}
  writeFileSync(settingsFile, JSON.stringify({ ...current, autoApproval: entries }))
}

test("the Orchestrator's Auto-approval switch under a debugging port: Off in force, why, the saved mode read at start, nothing written", async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' }
  const first = await launchApp({ env })
  try {
    const { window } = first
    const view = await openSession(window)
    const bar = view.locator('.w-composer__bar')
    const button = bar.getByRole('button', { name: 'Auto-approval' })

    // Off in force and saved; unavailable, with the reason.
    await expect(button).toHaveAttribute('data-mode', 'off')
    await expect(button).toHaveAttribute('data-saved', 'off')
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).toHaveAttribute('title', /^Auto-approval is off: worfy runs with a debugging port open \(--remote-debugging-port\), so any program on this Machine could turn it on\.$/u)
    // Right of Eco mode and as tall; Send still on the line of the pickers.
    const eco = bar.getByRole('switch', { name: 'Eco mode' })
    const [own, ecoBox, send, pickers] = [await button.boundingBox(), await eco.boundingBox(), await bar.getByTestId('input-send').boundingBox(), await bar.getByTestId('pickers').boundingBox()]
    expect(own!.x).toBeGreaterThan(ecoBox!.x)
    expect(Math.round(own!.height)).toBe(Math.round(ecoBox!.height))
    expect(Math.abs(send!.y + send!.height / 2 - (pickers!.y + pickers!.height / 2))).toBeLessThan(4)
    await snapshotBar(window, bar, 'auto-approval-blocked')
    // A click opens nothing, and nothing is written. Dispatched: Playwright does not click an
    // aria-disabled button, the person can.
    await button.dispatchEvent('click')
    await expect(window.getByRole('menu', { name: 'Auto-approval' })).toHaveCount(0)
    expect(existsSync(settingsFile) ? modes() : undefined).toBeUndefined()
  } finally {
    await first.close()
  }

  // A mode saved while worfy was closed: read at start, shown as saved, still not in force.
  writeModes({ [PROJECT]: 'on' })
  const second = await launchApp({ env })
  try {
    const { window } = second
    const view = await openSession(window)
    const button = view.locator('.w-composer__bar').getByRole('button', { name: 'Auto-approval' })
    await expect(button).toHaveAttribute('data-saved', 'on')
    await expect(button).toHaveAttribute('data-mode', 'off')
    await expect(button).toHaveAttribute('title', /The saved mode, On, applies once worfy starts without it\.$/u)

    // An edit made outside worfy: the running app does not take it, even in a view opened again.
    writeModes({ [PROJECT]: 'shadow' })
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    const again = await openSession(window)
    await expect(again.locator('.w-composer__bar').getByRole('button', { name: 'Auto-approval' })).toHaveAttribute('data-saved', 'on')
  } finally {
    await second.close()
  }
  expect(modes()).toEqual({ [PROJECT]: 'shadow' })
})
