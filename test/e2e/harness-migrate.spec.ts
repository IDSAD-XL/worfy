import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp, repoRoot } from './helpers'

// worfy-harness ticket 14: the move form opens from the Harness item of the toolbar, shows the rows
// by group and CLAUDE.md as a diff, its switches work, and after Move it shows the backup and the
// restore command. The app runs on a copy of test/fixtures/claude-home-legacy/ (WORFY_CLAUDE_HOME is
// its home/.claude, so `claude` and git get HOME and CLAUDE_CONFIG_DIR of that copy), the plugin is
// the Harness copy of this build in its worfy-harness/plugin/, `claude` is a stub that lists the
// plugin installed and enabled, and the consent dialog is replaced in main. Screenshots of the
// toolbar and the form in both themes go to the test's output; the ticket's evidence is copied from
// there to .scratch/worfy-harness/evidence/14-*.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')
const FIXTURE = join(repoRoot, 'test', 'fixtures', 'claude-home-legacy')
const bundledVersion = (): string => (JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_CLAUDE_LOG"
case "$*" in
  "plugin list --json") printf '[{"id":"worfy@worfy-harness","version":"%s","scope":"user","enabled":true,"errors":[]}]\\n' "$STUB_PLUGIN_VERSION" ;;
esac
exit 0
`

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sandbox', GIT_AUTHOR_EMAIL: 'sandbox@example.com', GIT_COMMITTER_NAME: 'Sandbox', GIT_COMMITTER_EMAIL: 'sandbox@example.com' }

function substitute(dir: string, root: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) substitute(path, root)
    else {
      const text = readFileSync(path, 'utf8')
      if (text.includes('__SANDBOX__')) writeFileSync(path, text.replaceAll('__SANDBOX__', root))
    }
  }
}

function gitCommitAll(dir: string): void {
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
    const result = spawnSync('git', ['-C', dir, ...args], { env: GIT_ENV, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  }
}

let scratch: string
let claudeHome: string
let env: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-migrate-')))
  cpSync(FIXTURE, scratch, { recursive: true })
  substitute(scratch, scratch)
  claudeHome = join(scratch, 'home', '.claude')
  renameSync(join(claudeHome, 'gitignore'), join(claudeHome, '.gitignore'))
  gitCommitAll(claudeHome)
  gitCommitAll(join(scratch, 'repos', 'worfy'))
  cpSync(bundle, join(claudeHome, 'worfy-harness', 'plugin'), { recursive: true })
  const stubDir = join(scratch, 'stub-bin')
  mkdirSync(stubDir)
  writeFileSync(join(stubDir, 'claude'), STUB)
  chmodSync(join(stubDir, 'claude'), 0o755)
  env = { WORFY_CLAUDE_HOME: claudeHome, WORFY_CLAUDE: join(stubDir, 'claude'), STUB_CLAUDE_LOG: join(scratch, 'calls.log'), STUB_PLUGIN_VERSION: bundledVersion() }
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
    await expect(open).toHaveText('Move old Harness…')
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
    const scout = form.locator('[data-testid="migration-row"][data-row="file:agents/scout.md"]')
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
    await shoot(launched, form, 'form')

    await answerDialogWith(launched, 0)
    await form.getByTestId('migration-actions').getByRole('button', { name: 'Move' }).click()
    const done = form.getByTestId('migration-done')
    await expect(done).toBeVisible()
    const backup = (await form.getByTestId('migration-backup').textContent()) ?? ''
    expect(backup).toMatch(new RegExp(`^${join(claudeHome, 'worfy-harness', 'backup-').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await expect(form.getByTestId('migration-restore-command')).toHaveText(`node ${join(backup, 'restore.mjs')}`)
    await expect(form.getByTestId('migration-actions').getByRole('button', { name: 'Move' })).toHaveCount(0)
    await shoot(launched, form, 'done')

    const [shown, ...more] = await shownDialogs(launched)
    expect(more).toEqual([])
    expect(shown?.buttons).toEqual(['Move', 'Cancel'])
    expect(shown?.message).toBe('Move the old Harness out of ~/.claude?')
    expect(shown?.detail).toContain(`To undo the move: node ${join(backup, 'restore.mjs')}`)

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
