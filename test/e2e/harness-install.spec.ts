import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp, repoRoot } from './helpers'

// worfy-harness ticket 13: the Harness item of the toolbar and the consent dialog. The app runs with
// the temporary Claude home of launchApp (WORFY_CLAUDE_HOME, so the install is offered in this dev
// build) and a stub `claude` (WORFY_CLAUDE) that logs its calls and keeps Claude Code's side in a
// file outside that home. The dialog is replaced in main: it records what it was shown and answers
// with the given button.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')
const bundledVersion = (): string => (JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version
const OLD = '0.1.0+0000000'

const STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_CLAUDE_LOG, args.join(' ') + '\\n')
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (process.env.STUB_CLAUDE_FAIL === command) {
  process.stderr.write('Installing worfy@worfy-harness…\\n✘ ' + command + ' failed: stub error\\n')
  process.exit(1)
}
const statePath = process.env.STUB_CLAUDE_STATE
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplace: null, installed: null }
const folderVersion = () => JSON.parse(readFileSync(join(state.marketplace, '.claude-plugin', 'plugin.json'), 'utf8')).version
if (command === 'plugin marketplace add') state.marketplace = args[3]
else if (command === 'plugin install' || command === 'plugin update') state.installed = folderVersion()
else if (command === 'plugin list') {
  const list = state.installed === null ? [] : [{ id: 'worfy@worfy-harness', version: state.installed, scope: 'user', enabled: true, errors: [] }]
  process.stdout.write(JSON.stringify(list) + '\\n')
}
writeFileSync(statePath, JSON.stringify(state))
`

let scratch: string
let stub: { env: Record<string, string>; log: string; state: string }

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-harness-')))
  writeFileSync(join(scratch, 'claude-stub.mjs'), STUB)
  const claude = join(scratch, 'claude')
  writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${join(scratch, 'claude-stub.mjs')}" "$@"\n`)
  chmodSync(claude, 0o755)
  const log = join(scratch, 'calls.log')
  const state = join(scratch, 'state.json')
  stub = { env: { WORFY_CLAUDE: claude, STUB_CLAUDE_LOG: log, STUB_CLAUDE_STATE: state }, log, state }
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const calls = (): string[] => (existsSync(stub.log) ? readFileSync(stub.log, 'utf8').trim().split('\n').filter(Boolean) : [])

/** Files of a tree with their bytes' hash and mode. */
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(dir, path)] = `${createHash('sha256').update(readFileSync(path)).digest('hex')} ${(statSync(path).mode & 0o777).toString(8)}`
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

interface ShownDialog {
  message?: string
  detail?: string
  buttons?: string[]
}

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
const shownDialogs = (launched: LaunchedApp): Promise<ShownDialog[]> =>
  launched.app.evaluate(() => ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []) as ShownDialog[])

/** Screenshots of the toolbar in both themes, kept with the test's output. */
async function shoot(launched: LaunchedApp, name: string): Promise<void> {
  const toolbar = launched.window.getByRole('banner')
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    await toolbar.screenshot({ path: test.info().outputPath(`13-harness-${name}-${scheme}.png`) })
  }
  await launched.window.emulateMedia({ colorScheme: null })
}

test('"Harness not installed" → Install → the dialog names the folder, the commands and the dependency → "Harness <version>"', async () => {
  const launched = await launchApp({ env: stub.env })
  try {
    const { window, claudeHome } = launched
    const pluginDir = join(claudeHome, 'worfy-harness', 'plugin')
    const item = window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-text')).toHaveText('Harness not installed')
    await expect(item.getByTestId('harness-action')).toHaveText('Install')
    // Reading the state ran no `claude` and wrote nothing.
    expect(calls()).toEqual([])
    expect(existsSync(join(claudeHome, 'worfy-harness'))).toBe(false)
    await shoot(launched, 'not-installed')

    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    await expect(item.getByTestId('harness-action')).toHaveCount(0)
    await shoot(launched, 'installed')

    const [shown, ...more] = await shownDialogs(launched)
    expect(more).toEqual([])
    expect(shown?.buttons).toEqual(['Install', 'Cancel'])
    expect(shown?.message).toBe(`Install the worfy Harness ${bundledVersion()}?`)
    expect(shown?.detail).toContain(`claude plugin marketplace add ${pluginDir}`)
    expect(shown?.detail).toContain('claude plugin install worfy@worfy-harness --scope user')
    expect(shown?.detail).toContain('mattpocock-skills@claude-plugins-official')

    expect(calls()).toEqual([`plugin marketplace add ${pluginDir}`, 'plugin install worfy@worfy-harness --scope user', 'plugin list --json'])
    expect(treeOf(pluginDir)).toEqual(treeOf(bundle))
  } finally {
    await launched.close()
  }
})

test('Cancel in the dialog writes nothing and runs no claude', async () => {
  const launched = await launchApp({ env: stub.env })
  try {
    const item = launched.window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-action')).toHaveText('Install')
    await answerDialogWith(launched, 1)
    await item.getByTestId('harness-action').click()
    await expect.poll(async () => (await shownDialogs(launched)).length).toBe(1)
    await expect(item.getByTestId('harness-text')).toHaveText('Harness not installed')
    expect(calls()).toEqual([])
    expect(existsSync(join(launched.claudeHome, 'worfy-harness'))).toBe(false)
  } finally {
    await launched.close()
  }
})

test('another version installed: "Update Harness" → the dialog shows from → to → `plugin update`', async () => {
  // Claude Code lists the plugin with an older version, and the copy in the plugin folder is that version.
  const launched = await launchApp({ env: stub.env })
  try {
    const pluginDir = join(launched.claudeHome, 'worfy-harness', 'plugin')
    cpSync(bundle, pluginDir, { recursive: true })
    const manifest = join(pluginDir, '.claude-plugin', 'plugin.json')
    writeFileSync(manifest, JSON.stringify({ ...(JSON.parse(readFileSync(manifest, 'utf8')) as object), version: OLD }))
    writeFileSync(join(pluginDir, 'bin', 'dropped-in-the-new-version'), '#!/bin/sh\n')
    writeFileSync(stub.state, JSON.stringify({ marketplace: pluginDir, installed: OLD }))
    await launched.window.reload()

    const item = launched.window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-action')).toHaveText('Update Harness')
    await expect(item.getByTestId('harness-action')).toHaveAttribute('title', `${OLD} → ${bundledVersion()}`)
    await shoot(launched, 'update')

    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    const [shown] = await shownDialogs(launched)
    expect(shown?.buttons).toEqual(['Update', 'Cancel'])
    expect(shown?.message).toBe(`Update the worfy Harness ${OLD} → ${bundledVersion()}?`)
    expect(shown?.detail).toContain('claude plugin update worfy@worfy-harness --scope user')
    expect(calls()).toContain('plugin update worfy@worfy-harness --scope user')
    expect(existsSync(join(pluginDir, 'bin', 'dropped-in-the-new-version'))).toBe(false)
    expect(treeOf(pluginDir)).toEqual(treeOf(bundle))
  } finally {
    await launched.close()
  }
})

test('a failing `claude plugin install` shows the step, with the tail of stderr in the tooltip', async () => {
  const launched = await launchApp({ env: { ...stub.env, STUB_CLAUDE_FAIL: 'plugin install' } })
  try {
    const item = launched.window.getByTestId('harness-status')
    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText('Harness error: install')
    await expect(item.getByTestId('harness-text')).toHaveAttribute('title', /plugin install failed: stub error/)
    await expect(item.getByTestId('harness-action')).toHaveText('Retry')
    await shoot(launched, 'error')
  } finally {
    await launched.close()
  }
})
