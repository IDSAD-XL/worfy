import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp, repoRoot } from './helpers'

// worfy-harness tickets 13 and 30: the Harness item of the toolbar and the consent dialog. The app
// runs with the temporary Claude home of launchApp (WORFY_CLAUDE_HOME, so the install is offered in
// this dev build) and a stub `claude` (WORFY_CLAUDE) that logs its calls and keeps Claude Code's
// side — the marketplaces it knows, the plugins it has installed — in a file outside that home; it
// never reaches the network. The dialog is replaced in main: it records what it was shown and
// answers with the given button.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')
const bundledVersion = (): string => (JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version
const OLD = '0.1.0+0000000'
/** The dependency out/harness declares (harness/.claude-plugin/plugin.json), and what the installer runs for it. */
const DEP = 'mattpocock-skills@claude-plugins-official'
const LIST = 'plugin list --json'
const MARKETPLACES = 'plugin marketplace list --json'
const ADD_OFFICIAL = 'plugin marketplace add anthropics/claude-plugins-official'
const INSTALL_DEP = `plugin install ${DEP} --scope user`
const INSTALL_WORFY = 'plugin install worfy@worfy-harness --scope user'

// A command fails when its line starts with STUB_CLAUDE_FAIL, or with the text of the file
// STUB_CLAUDE_FAIL_FILE while that file is there (a test removes it to let Retry through).
const STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
const line = args.join(' ')
appendFileSync(process.env.STUB_CLAUDE_LOG, line + '\\n')
appendFileSync(process.env.STUB_CLAUDE_ENV_LOG, JSON.stringify({ HOME: process.env.HOME ?? null, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null }) + '\\n')
const failFile = process.env.STUB_CLAUDE_FAIL_FILE
const failing = process.env.STUB_CLAUDE_FAIL || (failFile && existsSync(failFile) ? readFileSync(failFile, 'utf8').trim() : '')
if (failing && line.startsWith(failing)) {
  process.stderr.write('Installing…\\n✘ ' + line + ' failed: stub error\\n')
  process.exit(1)
}
const statePath = process.env.STUB_CLAUDE_STATE
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') process.stdout.write(JSON.stringify(Object.keys(state.marketplaces).map((name) => ({ name }))) + '\\n')
else if (command === 'plugin marketplace add') state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  if (source === undefined) {
    process.stderr.write('marketplace of ' + args[2] + ' not found\\n')
    process.exit(1)
  }
  state.plugins[args[2]] = isAbsolute(source) ? manifest(source, 'plugin.json').version : '1.0.0'
} else if (command === 'plugin uninstall') delete state.plugins[args[2]]
else if (command === 'plugin list') {
  process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, version]) => ({ id, version, scope: 'user', enabled: true, errors: [] }))) + '\\n')
}
writeFileSync(statePath, JSON.stringify(state))
`

let scratch: string
let stub: { env: Record<string, string>; log: string; envLog: string; state: string }

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-harness-')))
  writeFileSync(join(scratch, 'claude-stub.mjs'), STUB)
  const claude = join(scratch, 'claude')
  writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${join(scratch, 'claude-stub.mjs')}" "$@"\n`)
  chmodSync(claude, 0o755)
  const log = join(scratch, 'calls.log')
  const state = join(scratch, 'state.json')
  const envLog = join(scratch, 'env.log')
  stub = { env: { WORFY_CLAUDE: claude, STUB_CLAUDE_LOG: log, STUB_CLAUDE_ENV_LOG: envLog, STUB_CLAUDE_STATE: state }, log, envLog, state }
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const calls = (): string[] => (existsSync(stub.log) ? readFileSync(stub.log, 'utf8').trim().split('\n').filter(Boolean) : [])
/** HOME and CLAUDE_CONFIG_DIR each `claude` call got. */
const callEnvs = (): { HOME: string | null; CLAUDE_CONFIG_DIR: string | null }[] =>
  existsSync(stub.envLog)
    ? readFileSync(stub.envLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { HOME: string | null; CLAUDE_CONFIG_DIR: string | null })
    : []

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

test('"Harness not installed" → Install → one dialog names the dependency commands, the download, the folder and the Harness commands → "Harness <version>"', async () => {
  const launched = await launchApp({ env: stub.env })
  try {
    const { window, claudeHome } = launched
    const pluginDir = join(claudeHome, 'worfy-harness', 'plugin')
    const item = window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-text')).toHaveText('Harness not installed')
    await expect(item.getByTestId('harness-action')).toHaveAccessibleName('Install')
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
    // The native dialog cannot be screenshotted from Playwright: its text is kept with the test's output.
    writeFileSync(test.info().outputPath('30-harness-dialog-install.txt'), `${shown?.message ?? ''}\n\n${shown?.detail ?? ''}\n\n[${(shown?.buttons ?? []).join('] [')}]\n`)
    // The dependency first (ticket 30): its commands, where Claude Code downloads it from, then the Harness.
    const detail = shown?.detail ?? ''
    const order = [`claude ${ADD_OFFICIAL}`, `claude ${INSTALL_DEP}`, 'downloads it from GitHub (anthropics/claude-plugins-official)', `claude plugin marketplace add ${pluginDir}`, `claude ${INSTALL_WORFY}`]
    const places = order.map((text) => detail.indexOf(text))
    expect(places.every((place) => place >= 0), detail).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
    expect(detail).not.toContain('install it with')

    expect(calls()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL, INSTALL_DEP, `plugin marketplace add ${pluginDir}`, INSTALL_WORFY, LIST])
    // The app runs `claude` inside the sandbox of WORFY_CLAUDE_HOME (src/main/ipc/harness.ts,
    // claudeCommandEnv): without it the commands would register the marketplace in the real ~/.claude.
    expect(callEnvs()).toEqual(calls().map(() => ({ HOME: claudeHome, CLAUDE_CONFIG_DIR: claudeHome })))
    expect(treeOf(pluginDir)).toEqual(treeOf(bundle))
  } finally {
    await launched.close()
  }
})

test('Cancel in the dialog writes nothing: claude ran only its two reads', async () => {
  const launched = await launchApp({ env: stub.env })
  try {
    const item = launched.window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-action')).toHaveAccessibleName('Install')
    await answerDialogWith(launched, 1)
    await item.getByTestId('harness-action').click()
    await expect.poll(async () => (await shownDialogs(launched)).length).toBe(1)
    await expect(item.getByTestId('harness-text')).toHaveText('Harness not installed')
    expect(calls()).toEqual([LIST, MARKETPLACES])
    expect(JSON.parse(readFileSync(stub.state, 'utf8'))).toEqual({ marketplaces: {}, plugins: {} })
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
    writeFileSync(
      stub.state,
      JSON.stringify({
        marketplaces: { 'worfy-harness': pluginDir, 'claude-plugins-official': 'anthropics/claude-plugins-official' },
        plugins: { 'worfy@worfy-harness': OLD, [DEP]: '1.0.0' },
      }),
    )
    await launched.window.reload()

    const item = launched.window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-action')).toHaveAccessibleName('Update Harness')
    await expect(item.getByTestId('harness-action')).toHaveAttribute('title', `Update Harness: ${OLD} → ${bundledVersion()}`)
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${OLD}`)
    await shoot(launched, 'update')

    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    await shoot(launched, 'updated')
    const [shown] = await shownDialogs(launched)
    // The native dialog cannot be screenshotted from Playwright: its text is kept with the test's output.
    await test.info().attach('13-harness-dialog-update.json', { body: JSON.stringify(shown, null, 2), contentType: 'application/json' })
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

test('a failing `claude plugin install` of worfy shows the step, with the tail of stderr in the tooltip', async () => {
  const launched = await launchApp({ env: { ...stub.env, STUB_CLAUDE_FAIL: 'plugin install worfy@' } })
  try {
    const item = launched.window.getByTestId('harness-status')
    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText('Harness error: install')
    await expect(item.getByTestId('harness-text')).toHaveAttribute('title', /plugin install worfy@worfy-harness --scope user failed: stub error/)
    await expect(item.getByTestId('harness-action')).toHaveAccessibleName('Retry')
    await shoot(launched, 'error')
  } finally {
    await launched.close()
  }
})

test('a failing install of the dependency: "Harness error: dependency install", no Harness copy and no worfy; Retry installs what is left', async () => {
  const failFile = join(scratch, 'fail')
  writeFileSync(failFile, `plugin install ${DEP}\n`)
  const launched = await launchApp({ env: { ...stub.env, STUB_CLAUDE_FAIL_FILE: failFile } })
  try {
    const pluginDir = join(launched.claudeHome, 'worfy-harness', 'plugin')
    const item = launched.window.getByTestId('harness-status')
    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText('Harness error: dependency install')
    await expect(item.getByTestId('harness-text')).toHaveAttribute('title', new RegExp(`plugin install ${DEP} --scope user failed: stub error`))
    const retry = item.getByTestId('harness-action')
    await expect(retry).toHaveAccessibleName('Retry')
    // Retry installs the dependency itself: its hint names no command to run by hand.
    expect(await retry.getAttribute('title')).not.toContain('claude plugin install')
    expect(existsSync(join(launched.claudeHome, 'worfy-harness'))).toBe(false)
    expect(calls()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL, INSTALL_DEP])
    await shoot(launched, 'dependency-error')

    await rm(failFile)
    await retry.click()
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    const shown = await shownDialogs(launched)
    expect(shown).toHaveLength(2)
    // The marketplace went in at the first attempt: the second dialog does not add it again.
    expect(shown[1]?.detail).not.toContain(`claude ${ADD_OFFICIAL}`)
    expect(shown[1]?.detail).toContain(`claude ${INSTALL_DEP}`)
    expect(calls().slice(4)).toEqual([LIST, MARKETPLACES, INSTALL_DEP, `plugin marketplace add ${pluginDir}`, INSTALL_WORFY, LIST])
    expect(treeOf(pluginDir)).toEqual(treeOf(bundle))
  } finally {
    await launched.close()
  }
})

test('worfy installed without its dependency: "Harness error: dependency install" → Retry → a dialog with the dependency commands alone → "Harness <version>"', async () => {
  const launched = await launchApp({ env: stub.env })
  try {
    const pluginDir = join(launched.claudeHome, 'worfy-harness', 'plugin')
    // What the installer of ticket 13 left: the copy, its marketplace and worfy — no dependency.
    cpSync(bundle, pluginDir, { recursive: true })
    writeFileSync(stub.state, JSON.stringify({ marketplaces: { 'worfy-harness': pluginDir }, plugins: { 'worfy@worfy-harness': bundledVersion() } }))
    await launched.window.reload()

    const item = launched.window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-text')).toHaveText('Harness error: dependency install')
    await expect(item.getByTestId('harness-text')).toHaveAttribute('title', new RegExp(DEP))
    await answerDialogWith(launched, 0)
    await item.getByTestId('harness-action').click()
    await expect(item.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    const [shown, ...more] = await shownDialogs(launched)
    expect(more).toEqual([])
    writeFileSync(test.info().outputPath('30-harness-dialog-dependency.txt'), `${shown?.message ?? ''}\n\n${shown?.detail ?? ''}\n\n[${(shown?.buttons ?? []).join('] [')}]\n`)
    expect(shown?.buttons).toEqual(['Install', 'Cancel'])
    expect(shown?.message).toBe(`Install ${DEP} for the worfy Harness?`)
    expect(shown?.detail).toContain(`claude ${ADD_OFFICIAL}`)
    expect(shown?.detail).toContain(`claude ${INSTALL_DEP}`)
    expect(shown?.detail).not.toContain('worfy@worfy-harness')
    expect(calls().filter((line) => line !== LIST && line !== MARKETPLACES)).toEqual([ADD_OFFICIAL, INSTALL_DEP])
  } finally {
    await launched.close()
  }
})
