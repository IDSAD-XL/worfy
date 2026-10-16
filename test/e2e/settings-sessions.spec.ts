import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeSettings, launchApp, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { NO_ZSH, NO_ZSH_ON_WINDOWS, zshPath } from './zsh'

// Settings → Sessions (worfy-polish ticket 24) against the built app: the autocompact window of the
// Orchestrator and of the other Sessions — the defaults, a window of the user's own and "Claude
// Code default" kept in app-settings.json — and the line that names CLAUDE_CODE_AUTO_COMPACT_WINDOW
// when the login shell sets it. In both themes; with WORFY_EVIDENCE_DIR set, a screenshot of the
// Settings window in each.
//
// SHELL is the zsh of the machine and HOME a temporary folder with its own startup files, so the
// environment main captures for Sessions comes from them alone. Windows has no zsh: there the app
// keeps its own shell, and the test of the login shell's variable is skipped.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
/** Where the screenshots of the section go when the run is asked for them (the evidence of the ticket). */
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

let scratch: string
let home: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-sessions-')))
  home = join(scratch, 'home')
  mkdirSync(home)
  for (const file of ['.zshrc', '.zprofile', '.zshenv']) writeFileSync(join(home, file), '')
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { ...(NO_ZSH ? {} : { SHELL: zshPath() }), HOME: home, skip_global_compinit: '1' } })

/** Opens Settings → Sessions the way a person does: "Settings…" of the app menu, then the row of the section list. */
async function openSessions(launched: Pick<LaunchedApp, 'app' | 'window'>): Promise<Locator> {
  await clickMenuItem(launched.app, SETTINGS_MENU_ITEM_ID)
  const dialog = launched.window.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Sessions', exact: true }).click()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Sessions')
  return dialog
}

async function inBothThemes(window: Page, dialog: Locator, shot: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    if (EVIDENCE_DIR !== undefined) await dialog.screenshot({ path: join(EVIDENCE_DIR, `${shot}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

const field = (dialog: Locator, label: string): Locator => dialog.getByRole('spinbutton', { name: `${label} autocompact window, thousands of tokens` })
const mode = (dialog: Locator, label: string): Locator => dialog.getByRole('combobox', { name: `${label} autocompact window` })

test('the windows: the defaults, a window of the user\'s own and "Claude Code default", kept in app-settings.json', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const dialog = await openSessions(launched)
    await expect(field(dialog, 'Orchestrator')).toHaveValue('400')
    await expect(field(dialog, 'Other Sessions')).toHaveValue('500')
    await expect(dialog.getByText('Autocompact runs a little below this: Claude Code keeps room for the summary.')).toBeVisible()
    await expect(dialog.getByTestId('settings-autocompact-orchestrator-row')).toContainText('Applies after restarting the Session.')
    await expect(dialog.getByTestId('settings-autocompact-shell-override')).toHaveCount(0)
    await inBothThemes(window, dialog, '24-sessions-default')

    await field(dialog, 'Orchestrator').fill('250')
    await field(dialog, 'Orchestrator').press('Enter')
    await mode(dialog, 'Other Sessions').click()
    await window.getByRole('listbox', { name: 'Other Sessions autocompact window' }).getByRole('option', { name: 'Claude Code default' }).click()
    await expect(field(dialog, 'Other Sessions')).toHaveCount(0)
    await expect(mode(dialog, 'Other Sessions')).toContainText('Claude Code default')
    await expect(field(dialog, 'Orchestrator')).toHaveValue('250')
    await expect
      .poll(() => (JSON.parse(readFileSync(join(launched.dataDir, 'app-settings.json'), 'utf8')) as { autoCompactWindow?: unknown }).autoCompactWindow)
      .toEqual({ orchestrator: 250_000, other: null })
    await inBothThemes(window, dialog, '24-sessions-custom')
    await closeSettings(window)
  } finally {
    await launched.close()
  }
})

test('names CLAUDE_CODE_AUTO_COMPACT_WINDOW when the login shell sets it', async () => {
  test.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)
  writeFileSync(join(home, '.zshenv'), 'export CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000\n')
  const launched = await launch()
  try {
    const { window } = launched
    const dialog = await openSessions(launched)
    await expect(dialog.getByTestId('settings-autocompact-shell-override')).toHaveText('Overridden by CLAUDE_CODE_AUTO_COMPACT_WINDOW in your shell (300000).', { timeout: 15_000 })
    await inBothThemes(window, dialog, '24-sessions-shell-override')
    await closeSettings(window)
  } finally {
    await launched.close()
  }
})
