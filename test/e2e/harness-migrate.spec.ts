import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { restoreCommand } from '../../src/main/harness/migrate/restore'
import { claudePluginStub } from './claude-plugin-stub'
import { writeSandbox } from './first-run-sandbox'
import { launchApp, type LaunchedApp, repoRoot } from './helpers'
import { legacyClaudeHome } from './legacy-claude-home'

// worfy-harness ticket 14: the move form opens from the Harness item of the toolbar, shows the rows
// by group and CLAUDE.md as a diff, its switches work, and after Move it shows the backup and the
// restore command. The app runs on a copy of test/fixtures/claude-home-legacy/ (WORFY_CLAUDE_HOME is
// its home/.claude, so `claude` and git get HOME and CLAUDE_CONFIG_DIR of that copy), the plugin is
// the Harness copy of this build in its worfy-harness/plugin/, `claude` is a stub that lists the
// plugin installed and enabled, and the consent dialog is replaced in main. Screenshots of the
// toolbar and the form in both themes go to the test's output; the ticket's evidence is copied from
// there to .scratch/worfy-harness/evidence/14-*.png. Ticket 40: a move from the form the first-run
// screen opens drops "Move old Harness…" from the toolbar without a reload.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')
const bundledVersion = (): string => (JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

let scratch: string
let claudeHome: string
let env: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-migrate-')))
  claudeHome = legacyClaudeHome(scratch)
  env = { WORFY_CLAUDE_HOME: claudeHome, WORFY_CLAUDE: claudePluginStub(join(scratch, 'stub-bin')), STUB_PLUGIN_VERSION: bundledVersion() }
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Replaces the message box in main: it records its options and answers with `button`. */
async function answerDialogWith(launched: LaunchedApp, button: number): Promise<void> {
  await launched.app.evaluate(({ dialog }, response) => {
    const shown: unknown[] = []
    ;(globalThis as { shownDialogs?: unknown[] }).shownDialogs = shown
    dialog.showMessageBox = ((...args: unknown[]) => {
      shown.push(args.at(-1))
      return Promise.resolve({ response, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
  }, button)
}
const shownDialogs = (launched: LaunchedApp): Promise<{ message?: string; detail?: string; buttons?: string[] }[]> =>
  launched.app.evaluate(() => ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []) as { message?: string; detail?: string; buttons?: string[] }[])

/** Screenshots of `locator` in both themes, kept with the test's output. */
async function shoot(launched: LaunchedApp, locator: ReturnType<LaunchedApp['window']['getByTestId']>, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    await locator.screenshot({ path: test.info().outputPath(`14-${name}-${scheme}.png`) })
  }
  await launched.window.emulateMedia({ colorScheme: null })
}

test('the move form: from the toolbar, rows by group and the CLAUDE.md diff, switches, Move → the backup and the restore command', async () => {
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    const item = window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    const open = item.getByTestId('harness-migrate')
    await expect(open).toHaveAccessibleName('Move old Harness…')
    await expect(open).toHaveAttribute('title', 'Move old Harness…')
    await shoot(launched, window.getByRole('banner'), 'toolbar')

    await open.click()
    const form = window.getByTestId('migration-form')
    await expect(form.getByTestId('migration-group')).toHaveCount(7)
    await expect(form.locator('[data-testid="migration-group"]')).toHaveText([/Harness files/, /Hooks in settings.json/, /Status line/, /qmd/, /Machine state/, /CLAUDE\.md/, /Profiles/])
    await expect(form.getByTestId('migration-warning')).toContainText('restart them after the move')

    // CLAUDE.md as a diff: a rule the plugin carries is removed by default, a personal section stays.
    const diff = form.getByTestId('claude-md-diff')
    await expect(diff.locator('[data-diff="removed"]', { hasText: '### Quota' })).toHaveCount(1)
    await expect(diff.locator('[data-diff="same"]', { hasText: '## My machine' })).toHaveCount(1)

    // The switches: keep one Harness file, then a CLAUDE.md section changes the diff.
    // The row's id holds the path with this system's separator (src/main/harness/migrate/plan.ts);
    // JSON.stringify escapes a Windows backslash for the selector's string.
    const scout = form.locator(`[data-testid="migration-row"][data-row=${JSON.stringify(`file:${join('agents', 'scout.md')}`)}]`)
    await expect(scout).toHaveAttribute('data-choice', 'remove')
    await scout.getByRole('button', { name: 'Keep' }).click()
    await expect(scout).toHaveAttribute('data-choice', 'keep')
    await scout.getByRole('button', { name: 'Remove' }).click()
    await expect(scout).toHaveAttribute('data-choice', 'remove')
    const quota = form.locator('[data-testid="migration-row"][data-row^="claude-md:"][data-row$=":Quota"]')
    await quota.getByRole('button', { name: 'Keep' }).click()
    await expect(diff.locator('[data-diff="removed"]', { hasText: '### Quota' })).toHaveCount(0)
    await quota.getByRole('button', { name: 'Remove' }).click()
    await expect(diff.locator('[data-diff="removed"]', { hasText: '### Quota' })).toHaveCount(1)
    // Evidence: the top of the form, the CLAUDE.md diff and a Profile diff.
    const body = form.getByTestId('migration-body')
    await body.evaluate((element) => element.scrollTo(0, 0))
    await shoot(launched, form, 'form')
    await diff.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await shoot(launched, form, 'form-claude-md')
    await form.getByTestId('profile-diff').first().evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await shoot(launched, form, 'form-profiles')

    await answerDialogWith(launched, 0)
    await form.getByTestId('migration-actions').getByRole('button', { name: 'Move' }).click()
    const done = form.getByTestId('migration-done')
    // The move copies the backup first; on Windows that takes longer than the default 5 s.
    await expect(done).toBeVisible({ timeout: 30_000 })
    const backup = (await form.getByTestId('migration-backup').textContent()) ?? ''
    expect(backup).toMatch(new RegExp(`^${join(claudeHome, 'worfy-harness', 'backup-').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    // Quoted by the rule of the system (test/contract/harness-migrate.test.ts pins it): double
    // quotes on Windows, single quotes elsewhere for a path with a space.
    const restore = restoreCommand(backup)
    await expect(form.getByTestId('migration-restore-command')).toHaveText(restore)
    await expect(form.getByTestId('migration-actions').getByRole('button', { name: 'Move' })).toHaveCount(0)
    await shoot(launched, form, 'done')

    const [shown, ...more] = await shownDialogs(launched)
    expect(more).toEqual([])
    expect(shown?.buttons).toEqual(['Move', 'Cancel'])
    expect(shown?.message).toBe('Move the old Harness out of ~/.claude?')
    expect(shown?.detail).toContain(`To undo the move: ${restore}`)

    // On disk: the Harness is gone, the personal files stay, the backup and restore.mjs are there.
    expect(existsSync(join(claudeHome, 'agents', 'scout.md'))).toBe(false)
    expect(existsSync(join(backup, 'claude', 'agents', 'scout.md'))).toBe(true)
    expect(existsSync(join(claudeHome, 'bin', 'epic-status'))).toBe(false)
    expect(existsSync(join(claudeHome, 'bin', 'telegram-mcp'))).toBe(true)
    expect(existsSync(join(backup, 'restore.mjs'))).toBe(true)

    // Closed, the toolbar no longer offers a move: nothing of the old Harness is left to take.
    await form.getByTestId('migration-close').click()
    await expect(form).toHaveCount(0)
    await expect(item.getByTestId('harness-migrate')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('a move from the form of the first-run screen: "Move old Harness…" leaves the toolbar without a reload', async () => {
  // The first-run screen opens by itself. Its checks run a login /bin/sh over the sandbox's HOME,
  // whose .profile sets PATH to the system folders alone (as sandbox() in first-run.spec.ts does):
  // without it /etc/profile's path_helper adds /opt/homebrew/bin, and the checks would run the real
  // qmd of the machine running the test (gh comes from WORFY_GH, the stub of launchApp). Windows has
  // no login shell: there a registry stand-in gives the checks a Path of the system folders alone
  // (first-run-sandbox.ts, worfy-windows ticket 83), for the same reason.
  const home = join(scratch, 'home')
  let sandboxEnv: Record<string, string> = {}
  if (process.platform === 'win32') sandboxEnv = writeSandbox({ scratch, home, bin: join(scratch, 'no-tools'), tools: [], variables: {} })
  else writeFileSync(join(home, '.profile'), "PATH='/usr/bin:/bin'; export PATH\n")
  const launched = await launchApp({ env: { ...env, WORFY_FIRST_RUN_AUTO: '1', HOME: home, SHELL: '/bin/sh', ...sandboxEnv } })
  try {
    const { window } = launched
    const item = window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-migrate')).toHaveAccessibleName('Move old Harness…')

    const screen = window.getByTestId('first-run')
    await expect(screen).toBeVisible({ timeout: 30_000 })
    await expect(screen.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: 30_000 })
    await screen.locator('[data-check="legacy-harness"]').getByRole('button', { name: 'Move…' }).click()
    const form = window.getByTestId('migration-form')
    await expect(form.getByTestId('migration-group').first()).toBeVisible()
    await answerDialogWith(launched, 0)
    await form.getByTestId('migration-actions').getByRole('button', { name: 'Move' }).click()
    await expect(form.getByTestId('migration-done')).toBeVisible({ timeout: 30_000 })
    // The form is still open and was not opened by the toolbar: only `harnessMigration.changed` tells the toolbar.
    await expect(item.getByTestId('harness-migrate')).toHaveCount(0)
    expect(existsSync(join(claudeHome, 'agents', 'scout.md'))).toBe(false)
  } finally {
    await launched.close()
  }
})
