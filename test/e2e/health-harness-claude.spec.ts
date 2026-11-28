import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { CLAUDE_STAND_IN, TOOLS, toolFile, writeSandbox } from './first-run-sandbox'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { ms } from '../time-scale'

// worfy-harness-guarantees ticket 09: the rows "Harness on Claude Code" of Settings → Health against the built app,
// in the sandbox of test/e2e/settings-health.spec.ts (HOME, the Claude home and worfy's data folder temporary, the
// stand-in tools of test/fixtures/first-run-tools/ on the PATH of the login shell). The contract set is the fake one
// of WORFY_HARNESS_CONTRACT (the agent is WORFY_AGENT=fake): worfy's copy passes, the terminal's fails the guard case,
// and no Claude Code starts. The terminal's `claude` prints 9.9.9, newer than worfy's copy, so its row links the
// changelog. On Windows the stand-in claude is a .cmd, which the set does not start: the spec runs off Windows.

test.skip(process.platform === 'win32', "the sandbox's claude is a .cmd on Windows, which the contract set does not start")

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
const TERMINAL_VERSION = '9.9.9'
const bundledClaude = (): string =>
  (JSON.parse(readFileSync(join(repoRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')) as { claudeCodeVersion: string }).claudeCodeVersion

let scratch: string
let home: string
let claudeHome: string
let dataDir: string
let bin: string
let state: string
let sandboxEnv: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-health-harness-claude-')))
  home = join(scratch, 'home')
  claudeHome = join(home, '.claude')
  dataDir = join(scratch, 'data')
  bin = join(scratch, 'bin')
  state = join(scratch, 'state')
  for (const dir of [claudeHome, dataDir, bin, state]) mkdirSync(dir, { recursive: true })
  sandboxEnv = writeSandbox({
    scratch,
    home,
    bin,
    variables: {
      FIRST_RUN_TOOLS_DIR: TOOLS,
      FIRST_RUN_TOOLS_STATE: state,
      FAKE_CLAUDE_VERSION: TERMINAL_VERSION,
      FAKE_GH_ACCOUNT: 'alice',
      XDG_CACHE_HOME: join(scratch, 'cache'),
      XDG_CONFIG_HOME: join(scratch, 'config'),
    },
  })
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> =>
  launchApp({
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      HOME: home,
      SHELL: '/bin/sh',
      WORFY_CLAUDE: CLAUDE_STAND_IN,
      WORFY_GH: toolFile(bin, 'gh'),
      FIRST_RUN_TOOLS_STATE: state,
      WORFY_HARNESS_CONTRACT: 'worfy=passed,terminal=failed:guard-reset-hard',
      ...sandboxEnv,
    },
  })

async function openHealth(launched: LaunchedApp): Promise<Locator> {
  await clickMenuItem(launched.app, SETTINGS_MENU_ITEM_ID)
  const settings = launched.window.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Health' }).click()
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Health')
  return settings.getByTestId('settings-health')
}

test('Health shows "Harness on Claude Code" for worfy\'s copy and the terminal; the failed case is a red row and a toast; the answer is kept in worfy\'s data', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    const health = await openHealth(launched)
    const worfy = health.locator('[data-check="harness-claude"]')
    const terminal = health.locator('[data-check="harness-claude-terminal"]')
    await expect(worfy).toHaveAttribute('data-status', 'ok', { timeout: ms(30_000) })
    await expect(worfy).toHaveAttribute('aria-label', 'Harness on Claude Code')
    await expect(worfy).toContainText(`${bundledClaude()} (worfy) · 6 of 6 checks · `)
    await expect(terminal).toHaveAttribute('data-status', 'fail', { timeout: ms(30_000) })
    await expect(terminal).toContainText(`${TERMINAL_VERSION} (terminal) · guard-reset-hard: the guard did not refuse`)
    for (const name of ['Run again', 'Copy details', 'Changelog']) await expect(terminal.getByRole('button', { name })).toBeVisible()

    const toast = window.getByTestId('harness-claude-failed')
    await expect(toast).toContainText(`The Harness failed a check on Claude Code ${TERMINAL_VERSION} (terminal) · guard-reset-hard`)
    await expect(toast.getByRole('button', { name: 'Open Health' })).toBeVisible()

    // One run per pair of versions, kept in worfy's data folder.
    const cacheFile = join(dataDir, 'harness-claude.json')
    expect(existsSync(cacheFile)).toBe(true)
    const kept = (): string[] => (JSON.parse(readFileSync(cacheFile, 'utf8')) as { entries: { claudeVersion: string; at: string }[] }).entries.map((each) => `${each.claudeVersion} ${each.at}`)
    const before = kept()
    expect(before.map((each) => each.split(' ')[0]).sort()).toEqual([bundledClaude(), TERMINAL_VERSION].sort())

    // "Run again" runs the terminal's pair anew: its entry is written again, still red. The buttons wait for the
    // check of the section's opening to end ("Checking…").
    await expect(health.getByRole('button', { name: 'Check again' })).toBeVisible({ timeout: ms(30_000) })
    await terminal.getByRole('button', { name: 'Run again' }).click()
    await expect.poll(() => kept().find((each) => each.startsWith(`${TERMINAL_VERSION} `)), { timeout: ms(30_000) }).not.toBe(before.find((each) => each.startsWith(`${TERMINAL_VERSION} `)))
    await expect(terminal).toHaveAttribute('data-status', 'fail')
  } finally {
    await launched.close()
  }
})
