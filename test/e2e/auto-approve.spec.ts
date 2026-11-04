import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Auto-approval switch under the Orchestrator's input field (worfy-auto-approve ticket 06) against
// the built app, on the fake agent, over a temporary data folder: three positions right of Eco mode,
// Off for a Project with no entry; a click writes the Project's mode into app-settings.json of the data
// folder; an edit of that file made outside worfy shows only after the app starts again.

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
    const group = bar.getByRole('group', { name: 'Auto-approval' })
    const position = (name: string) => group.getByRole('button', { name, exact: true })

    // Three positions, Off pressed, each with its own tooltip; right of Eco mode.
    await expect(group.getByRole('button')).toHaveText(['Off', 'Shadow', 'On'])
    await expect(position('Off')).toHaveAttribute('aria-pressed', 'true')
    await expect(group).not.toHaveAttribute('aria-disabled', 'true')
    await expect(position('Off')).toHaveAttribute('title', /^Auto-approval off:/u)
    await expect(position('Shadow')).toHaveAttribute('title', /^Auto-approval shadow:/u)
    await expect(position('On')).toHaveAttribute('title', /^Auto-approval on:/u)
    const eco = bar.getByRole('switch', { name: 'Eco mode' })
    expect((await group.boundingBox())!.x).toBeGreaterThan((await eco.boundingBox())!.x)
    // One line high, as Eco mode is.
    expect(Math.round((await group.boundingBox())!.height)).toBe(Math.round((await eco.boundingBox())!.height))
    await snapshotBar(window, bar, 'auto-approval-off')

    await position('Shadow').click()
    await expect(position('Shadow')).toHaveAttribute('aria-pressed', 'true')
    await expect(group).not.toHaveAttribute('aria-busy', 'true')
    expect(modes()).toEqual({ [PROJECT]: 'shadow' })
    await snapshotBar(window, bar, 'auto-approval-shadow')

    await position('On').click()
    await expect(position('On')).toHaveAttribute('aria-pressed', 'true')
    await expect(group).not.toHaveAttribute('aria-busy', 'true')
    expect(modes()).toEqual({ [PROJECT]: 'on' })
    await snapshotBar(window, bar, 'auto-approval-on')

    // Back to Off removes the entry: no entry is Off.
    await position('Off').click()
    await expect(position('Off')).toHaveAttribute('aria-pressed', 'true')
    await expect(group).not.toHaveAttribute('aria-busy', 'true')
    expect(modes()).toBeUndefined()

    // An edit made outside worfy: the running app does not take it, even in a view opened again.
    const outside = { ...(JSON.parse(readFileSync(settingsFile, 'utf8')) as object), autoApproval: { [PROJECT]: 'shadow' } }
    writeFileSync(settingsFile, JSON.stringify(outside))
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    const again = await openSession(window)
    await expect(again.getByRole('group', { name: 'Auto-approval' }).getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await first.close()
  }

  // The next start reads the file.
  const second = await launchApp({ env })
  try {
    const view = await openSession(second.window)
    const group = view.locator('.w-composer__bar').getByRole('group', { name: 'Auto-approval' })
    await expect(group.getByRole('button', { name: 'Shadow', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await second.close()
  }
})
