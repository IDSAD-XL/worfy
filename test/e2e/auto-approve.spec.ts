import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { captureScreenshot } from './evidence-capture'
import { launchApp } from './helpers'

// Auto-approval in the Modes menu under the Orchestrator's input field (worfy-auto-approve ticket 06,
// worfy-retry ticket 12) against the built app, on the fake agent, over a temporary data folder.
// Playwright drives Electron through its debugging port and Node inspector (it starts it with
// --remote-debugging-port=0 --inspect=0), so this run is the case the setting guards against: any local
// process could script the window. The menu therefore shows Off, its three positions unavailable with
// why and which mode is saved, and a choice writes nothing; the mode saved in app-settings.json is read
// at start, and an edit of the file made outside worfy is not picked up by the running app. Choosing a
// position and the write are covered by test/unit/modes-menu.test.tsx and
// test/contract/auto-approve-setting.test.ts. At the window the app opens in, the Modes button is 24 px
// tall, right of the pickers, and Send stays on the pickers' line.

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

const modes = (): unknown => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { autoApproval?: unknown }).autoApproval

const writeModes = (entries: Record<string, string>): void => {
  const current = existsSync(settingsFile) ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as object) : {}
  writeFileSync(settingsFile, JSON.stringify({ ...current, autoApproval: entries }))
}

/** The Modes button of the Orchestrator's bar in Session view `view`, and its Auto-approval icon. */
const modesOf = (view: Locator) => {
  const button = view.locator('.w-composer__bar').getByRole('button', { name: 'Modes' })
  return { button, icon: button.locator('[data-mode-item="auto-approval"]') }
}

test("Auto-approval in the Orchestrator's Modes menu under a debugging port: Off in force, why, the saved mode read at start, nothing written", async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' }
  const first = await launchApp({ env })
  try {
    const { window } = first
    const view = await openSession(window)
    const bar = view.locator('.w-composer__bar')
    const { button, icon } = modesOf(view)
    const menu = window.getByRole('menu', { name: 'Modes' })
    const position = (name: string): Locator => menu.getByRole('menuitemradio', { name: new RegExp(`^${name}`, 'u') })

    // Off in force and saved: the icon shows Off.
    await expect(icon).toHaveAttribute('data-state', 'off')
    await expect(icon).toHaveAttribute('data-saved', 'off')
    await expect(button).toHaveAttribute('title', /Auto-approval: Off\.$/u)
    // Right of the pickers and as tall as before; Send still on the line of the pickers.
    const [own, permissions, send, pickers] = [await button.boundingBox(), await bar.getByTestId('picker-permissions').boundingBox(), await bar.getByTestId('input-send').boundingBox(), await bar.getByTestId('pickers').boundingBox()]
    expect(own!.x).toBeGreaterThan(permissions!.x)
    expect(Math.round(own!.height)).toBe(24)
    expect(Math.abs(send!.y + send!.height / 2 - (pickers!.y + pickers!.height / 2))).toBeLessThan(4)

    // In the menu the three positions are unavailable, with the reason; Off is checked.
    await button.click()
    await expect(menu.getByRole('group', { name: 'Auto-approval' })).toBeVisible()
    for (const name of ['Off', 'Shadow', 'On']) {
      await expect(position(name)).toHaveAttribute('aria-disabled', 'true')
      await expect(position(name)).toHaveAttribute('title', /^Auto-approval is off: worfy runs with a debugging port open \(--remote-debugging-port\), so any program on this Machine could turn it on\.$/u)
    }
    await expect(position('Off')).toHaveAttribute('aria-checked', 'true')
    await captureScreenshot(menu, 'modes-menu-auto-approval-blocked')
    // A choice writes nothing. Dispatched: Playwright does not click an aria-disabled item, the person can.
    await position('On').dispatchEvent('click')
    await expect(icon).toHaveAttribute('data-state', 'off')
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
    const { button, icon } = modesOf(view)
    await expect(icon).toHaveAttribute('data-saved', 'on')
    await expect(icon).toHaveAttribute('data-state', 'off')
    await button.click()
    await expect(window.getByRole('menu', { name: 'Modes' }).getByRole('menuitemradio', { name: /^On/u })).toHaveAttribute('title', /The saved mode, On, applies once worfy starts without it\.$/u)
    await window.keyboard.press('Escape')

    // An edit made outside worfy: the running app does not take it, even in a view opened again.
    writeModes({ [PROJECT]: 'shadow' })
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    const again = await openSession(window)
    await expect(modesOf(again).icon).toHaveAttribute('data-saved', 'on')
  } finally {
    await second.close()
  }
  expect(modes()).toEqual({ [PROJECT]: 'shadow' })
})
