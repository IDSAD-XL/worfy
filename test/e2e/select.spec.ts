import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'

// The shared Select (src/renderer/theme/Select.tsx) in the two forms that had a native select:
// the Profile form of "Add project" (the same path as test/e2e/projects-connect.spec.ts: a
// repository the Harness does not know, the draft of the fake agent, the form) and the Profile
// fields of the form that moves the old Harness (the same sandbox as test/e2e/harness-migrate.spec.ts).
// A field opens from the keyboard, typed letters and Enter choose a value, the draft follows; Esc on
// an open list closes only the list. Screenshots in both themes go to the test's output; the
// ticket's evidence is copied from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')
const bundledVersion = (): string => (JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

const STUB = `#!/bin/sh
case "$*" in
  "plugin list --json") printf '[{"id":"worfy@worfy-harness","version":"%s","scope":"user","enabled":true,"errors":[]},{"id":"mattpocock-skills@claude-plugins-official","version":"1.0.0","scope":"user","enabled":true,"errors":[]}]\\n' "$STUB_PLUGIN_VERSION" ;;
esac
exit 0
`

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-select-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  writeFileSync(join(path, 'package.json'), '{"name":"shop","scripts":{"lint":"eslint .","test":"vitest run"}}\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'init')
  return realpathSync(path)
}

function claudeStub(): string {
  const stubDir = join(scratch, 'stub-bin')
  mkdirSync(stubDir, { recursive: true })
  writeFileSync(join(stubDir, 'claude'), STUB)
  chmodSync(join(stubDir, 'claude'), 0o755)
  return join(stubDir, 'claude')
}

/** Screenshots of the window region that holds every one of `locators`, in both themes. */
async function shoot(launched: LaunchedApp, locators: Locator[], name: string): Promise<void> {
  const boxes = await Promise.all(locators.map((locator) => locator.boundingBox()))
  const shown = boxes.filter((box) => box !== null)
  const left = Math.min(...shown.map((box) => box.x))
  const top = Math.min(...shown.map((box) => box.y))
  const right = Math.max(...shown.map((box) => box.x + box.width))
  const bottom = Math.max(...shown.map((box) => box.y + box.height))
  const clip = { x: Math.max(0, left - 8), y: Math.max(0, top - 8), width: right - left + 16, height: bottom - top + 16 }
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    // A page screenshot: a locator screenshot scrolls, and a scroll under an open list closes it.
    await launched.window.screenshot({ path: test.info().outputPath(`08-${name}-${scheme}.png`), clip })
  }
  await launched.window.emulateMedia({ colorScheme: null })
}

/** The label of the option under the keyboard cursor of `field`. */
const activeOption = (field: Locator): Promise<string | null> =>
  field.evaluate((element) => {
    const id = element.getAttribute('aria-activedescendant')
    return id === null ? null : (element.ownerDocument.getElementById(id)?.getAttribute('data-value') ?? null)
  })

test('the Profile form of "Add project": a field opens from the keyboard, letters and Enter choose, Esc closes only the list', async () => {
  const shop = makeRepo(join(scratch, 'shop'))
  const launched = await launchApp({ env: { WORFY_CLAUDE: claudeStub(), STUB_PLUGIN_VERSION: bundledVersion() } })
  try {
    const { app, window, claudeHome } = launched
    const harnessHome = join(claudeHome, 'worfy-harness')
    cpSync(bundle, join(harnessHome, 'plugin'), { recursive: true })
    mkdirSync(join(harnessHome, 'gate'), { recursive: true })
    writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, shop)
    await window.getByRole('button', { name: 'Add project' }).click()
    const dialog = window.getByTestId('connect-project')
    await dialog.getByRole('button', { name: 'Write draft' }).click()
    await expect(dialog).toHaveAttribute('data-step', 'form', { timeout: 20_000 })

    // The draft of the fake agent writes the reports in English.
    const reports = dialog.getByRole('combobox', { name: 'Reports' })
    await expect(reports).toHaveAttribute('data-value', 'en')
    await expect(reports).toHaveAttribute('aria-expanded', 'false')
    const json = dialog.getByTestId('connect-json')
    await expect(json).toContainText('"reports": "en"')
    const languages = dialog.getByRole('region', { name: 'Language' })
    await languages.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await reports.focus()
    await shoot(launched, [languages], 'select-closed')
    await shoot(launched, [dialog], 'connect-form')

    // ↓ opens the list on the chosen value; the focus stays on the field.
    await window.keyboard.press('ArrowDown')
    const list = window.getByRole('listbox', { name: 'Reports' })
    await expect(list).toBeVisible()
    await expect(reports).toHaveAttribute('aria-expanded', 'true')
    await expect(list.getByRole('option')).toHaveText(['ru', 'en'])
    await expect(list.getByRole('option', { name: 'en' })).toHaveAttribute('aria-selected', 'true')
    expect(await activeOption(reports)).toBe('en')
    await expect(reports).toBeFocused()
    // Drawn over the dialog, in document.body: the dialog's scrolling body does not cut it.
    expect(await list.evaluate((element) => element.parentElement === element.ownerDocument.body)).toBe(true)
    await shoot(launched, [languages, list], 'select-open')

    // "r" goes to "ru"; Enter chooses it and closes the list.
    await window.keyboard.press('r')
    await expect.poll(() => activeOption(reports)).toBe('ru')
    await shoot(launched, [languages, list], 'select-keyboard')
    await window.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(reports).toHaveAttribute('data-value', 'ru')
    await expect(reports).toBeFocused()
    await expect(json).toContainText('"reports": "ru"')

    // Esc on an open list closes the list only: the dialog stays, the value too.
    await window.keyboard.press('ArrowDown')
    await expect(list).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(reports).toHaveAttribute('data-value', 'ru')
    await expect(reports).toBeFocused()

    // The mouse: the button opens the list, a click on an option chooses it.
    const finish = dialog.getByRole('combobox', { name: 'Finish' })
    await finish.click()
    await window.getByRole('listbox', { name: 'Finish' }).getByRole('option', { name: 'pr-green-ci' }).click()
    await expect(finish).toHaveAttribute('data-value', 'pr-green-ci')
    await expect(json).toContainText('"finish": "pr-green-ci"')
  } finally {
    await launched.close()
  }
  expect(git(shop, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

// ── the form that moves the old Harness ─────────────────────────────────────

const FIXTURE = join(repoRoot, 'test', 'fixtures', 'claude-home-legacy')
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

test('the Profile fields of the move form: chosen through the Select, inactive while the Profile is kept', async () => {
  cpSync(FIXTURE, scratch, { recursive: true })
  substitute(scratch, scratch)
  const claudeHome = join(scratch, 'home', '.claude')
  renameSync(join(claudeHome, 'gitignore'), join(claudeHome, '.gitignore'))
  gitCommitAll(claudeHome)
  gitCommitAll(join(scratch, 'repos', 'worfy'))
  cpSync(bundle, join(claudeHome, 'worfy-harness', 'plugin'), { recursive: true })
  const launched = await launchApp({ env: { WORFY_CLAUDE_HOME: claudeHome, WORFY_CLAUDE: claudeStub(), STUB_PLUGIN_VERSION: bundledVersion() } })
  try {
    const { window } = launched
    await window.getByTestId('harness-status').getByTestId('harness-migrate').click()
    const form = window.getByTestId('migration-form')
    const fields = form.getByTestId('profile-fields').first()
    await expect(fields).toBeVisible({ timeout: 20_000 })
    const row = form.locator('[data-testid="migration-row"][data-row^="profile:"]').first()
    await fields.evaluate((element) => element.scrollIntoView({ block: 'center' }))

    const mode = fields.getByTestId('profile-mode')
    const before = await mode.getAttribute('data-value')
    const other = before === 'full' ? 'silent' : 'full'
    await mode.click()
    const list = window.getByRole('listbox', { name: 'mode' })
    await expect(list).toBeVisible()
    await shoot(launched, [row, list], 'migration-open')
    // Esc closes the list, not the form.
    await window.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(form).toBeVisible()
    await mode.click()
    await list.getByRole('option', { name: other }).click()
    await expect(mode).toHaveAttribute('data-value', other)
    await expect(row.getByTestId('profile-diff').first()).toContainText(`"mode": "${other}"`)
    await shoot(launched, [row], 'migration-form')

    // A kept Profile: its fields are inactive and do not open.
    await row.getByRole('button', { name: 'Keep' }).click()
    await expect(mode).toBeDisabled()
    await mode.click({ force: true })
    await expect(window.getByRole('listbox')).toHaveCount(0)
    await shoot(launched, [fields], 'select-disabled')
  } finally {
    await launched.close()
  }
})
