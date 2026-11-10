import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { codexHooksCommand } from '../../src/shared/ipc/harness'
import { approvePluginHooks } from '../fixtures/codex-app-server/hook-runner.mjs'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'

// worfy-multi-vendor ticket 39: after Install installs the Harness into Codex as well, the toolbar shows
// the step "Approve the Harness hooks in Codex": what to open (/hooks in Codex) and "Check again". The
// check asks the fake app-server (WORFY_CODEX=fake, which every launch sets; the real Codex never
// starts) for `hooks/list`, which lists the hooks of the plugins in CODEX_HOME with their trust. The
// test approves them the way /hooks does (approvePluginHooks), and the next check finds them approved.
//
// `claude` and `codex` are stand-ins (.mjs, started under worfy's own Node) that keep their state in a
// file outside the sandbox. The codex stand-in's `plugin add` of a local marketplace copies the plugin
// into <CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/local, where the fake finds installed plugins.
// The consent dialog is replaced in main and answers Install. With WORFY_EVIDENCE_DIR set, the
// screenshots of the step in both themes are copied there as 39-codex-hooks-step-<state>-<theme>.png.
// worfy-polish ticket 54: step 1 shows the command that starts the Codex binary worfy installs with (here
// the stand-in) from the home folder, with Copy; its screenshots are 54-codex-hooks-step-command-<theme>.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const CLAUDE_STUB = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
const path = process.env.STUB_CLAUDE_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') process.stdout.write(JSON.stringify(Object.keys(state.marketplaces).map((name) => ({ name }))) + '\\n')
else if (command === 'plugin marketplace add') state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  state.plugins[args[2]] = isAbsolute(source) ? manifest(source, 'plugin.json').version : '1.0.0'
} else if (command === 'plugin list') {
  process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, version]) => ({ id, version, scope: 'user', enabled: true, errors: [] }))) + '\\n')
}
if (!command.endsWith(' list')) writeFileSync(path, JSON.stringify(state))
`

const CODEX_STUB = `
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
const path = process.env.STUB_CODEX_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') {
  process.stdout.write(JSON.stringify({ marketplaces: Object.entries(state.marketplaces).map(([name, source]) => ({ name, root: source, marketplaceSource: { sourceType: isAbsolute(source) ? 'local' : 'git', source } })) }))
} else if (command === 'plugin marketplace add') {
  state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
} else if (command === 'plugin add') {
  const [name, market] = args[2].split('@')
  const source = state.marketplaces[market]
  if (source === undefined) {
    process.stderr.write('marketplace ' + market + ' not found\\n')
    process.exit(1)
  }
  if (isAbsolute(source)) {
    cpSync(source, join(process.env.CODEX_HOME, 'plugins', 'cache', market, name, 'local'), { recursive: true })
    state.plugins[args[2]] = manifest(source, 'plugin.json').version
  } else state.plugins[args[2]] = '1.4.0'
} else if (command === 'plugin list') {
  // The shape of the live Codex 0.166.0 (test/fixtures/codex-cli/plugin-list-0.166.0.json, ticket 46).
  const installed = Object.entries(state.plugins).map(([pluginId, version]) => ({ pluginId, name: pluginId.split('@')[0], marketplaceName: pluginId.split('@')[1], version, installed: true, enabled: true }))
  process.stdout.write(JSON.stringify({ installed, available: [] }))
} else {
  process.stderr.write('codex stand-in: unsupported command: ' + args.join(' ') + '\\n')
  process.exit(2)
}
writeFileSync(path, JSON.stringify(state))
`

let scratch: string
let codexHome: string
let env: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-codex-hooks-')))
  codexHome = join(scratch, 'codex-home')
  mkdirSync(codexHome)
  const claude = join(scratch, 'claude-stub.mjs')
  const codex = join(scratch, 'codex-stub.mjs')
  writeFileSync(claude, CLAUDE_STUB)
  writeFileSync(codex, CODEX_STUB)
  env = {
    WORFY_CLAUDE: claude,
    STUB_CLAUDE_STATE: join(scratch, 'claude-state.json'),
    WORFY_CODEX_CLI: codex,
    STUB_CODEX_STATE: join(scratch, 'codex-state.json'),
    CODEX_HOME: codexHome,
  }
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Replaces the message box in main: every dialog answers with its first button (Install). */
async function answerInstall(launched: LaunchedApp): Promise<void> {
  await launched.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (() => Promise.resolve({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
}

/** The window in both themes, kept with the test's output and copied to WORFY_EVIDENCE_DIR when it is set. */
async function shoot(launched: LaunchedApp, name: string, ticket = '39'): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    const base = `${ticket}-codex-hooks-step-${name}-${scheme}.png`
    const file = test.info().outputPath(base)
    await launched.window.screenshot({ path: file })
    const dir = process.env.WORFY_EVIDENCE_DIR
    if (dir !== undefined && dir !== '') {
      mkdirSync(dir, { recursive: true })
      copyFileSync(file, join(dir, base))
    }
  }
  await launched.window.emulateMedia({ colorScheme: null })
}

test('Install into Codex opens "Approve the Harness hooks in Codex"; Check again says they are off until approved in /hooks, then approved', async () => {
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    const item = window.getByTestId('harness-status')
    await expect(item.getByTestId('harness-action')).toHaveAccessibleName('Install')
    await answerInstall(launched)
    await item.getByTestId('harness-action').click()

    // The install brought the Harness into Codex: Codex keeps its hooks off, and the step opens by itself.
    const step = window.getByRole('dialog', { name: 'Approve the Harness hooks in Codex' })
    await expect(step).toBeVisible()
    // The Codex part is the third line of the Harness column (worfy-polish ticket 93), not on the Harness line.
    const column = window.getByTestId('harness-column')
    await expect(column.getByTestId('harness-codex')).toHaveText('Codex: approve hooks')
    await expect(item.getByTestId('harness-codex')).toHaveCount(0)
    await expect(step.getByTestId('codex-hooks-step-steps')).toContainText('/hooks')
    // Step 1: the binary the install into Codex used, started from the home folder (worfy-polish ticket 54).
    await expect(step.getByTestId('codex-hooks-step-command')).toHaveText(codexHooksCommand(env.WORFY_CODEX_CLI ?? '', process.platform === 'win32'))
    await expect(step.getByRole('button', { name: 'Copy the command' })).toBeVisible()
    await shoot(launched, 'after-install')
    await shoot(launched, 'command', '54')

    const result = step.getByTestId('codex-hooks-step-result')
    await step.getByRole('button', { name: 'Check again' }).click()
    await expect(result).toHaveAttribute('data-trust', 'not-approved')
    await expect(result).toHaveText('The Harness hooks are still off in Codex. Approve them in /hooks, then check again.')
    await shoot(launched, 'not-approved')

    // The user approves them in Codex's /hooks.
    approvePluginHooks(codexHome)
    await step.getByRole('button', { name: 'Check again' }).click()
    await expect(result).toHaveAttribute('data-trust', 'approved')
    await expect(column.getByTestId('harness-codex')).toHaveCount(0)
    await shoot(launched, 'approved')
    await step.getByRole('button', { name: 'Done' }).click()
    await expect(step).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

// worfy-polish ticket 93: "Codex: approve hooks" is the third line of the Harness column, under the app
// version, so the Harness line is whole; the three lines stay inside the 52 px toolbar at 1280 px and at
// 1600 px, next to both Vendors' Limits (Claude's from limits.json, Codex's from the fake's account-plus).
// With WORFY_EVIDENCE_DIR set, the toolbar screenshots are copied there as 93-toolbar-<width>-<theme>.png.
test('"Codex: approve hooks" is the third line of the Harness column, inside the toolbar at 1280 px and 1600 px', async () => {
  const dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
  const receivedAt = Date.now() - 60_000
  const inHours = (hours: number): number => Math.floor(Date.now() / 1000) + hours * 3600
  writeFileSync(
    join(dataDir, 'limits.json'),
    JSON.stringify({
      windows: {
        five_hour: { utilization: 1.01, resetsAt: inHours(2), status: 'allowed', receivedAt, source: 'sdk' },
        seven_day: { utilization: 0.26, resetsAt: inHours(72), status: 'allowed', receivedAt, source: 'sdk' },
      },
    }),
  )
  const launched = await launchApp({ env: { ...env, WORFY_DATA_DIR: dataDir, WORFY_CODEX_SCRIPT: 'account-plus', WORFY_CODEX_SCRIPTS: join(repoRoot, 'test', 'fixtures', 'codex-scripts') } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true)
    const item = window.getByTestId('harness-status')
    await answerInstall(launched)
    await item.getByTestId('harness-action').click()
    const step = window.getByRole('dialog', { name: 'Approve the Harness hooks in Codex' })
    await expect(step).toBeVisible()
    await step.getByTestId('codex-hooks-step-close').click()
    await expect(step).toHaveCount(0)

    const toolbar = window.getByRole('banner')
    const column = toolbar.getByTestId('harness-column')
    const codexLine = column.getByTestId('harness-codex-line')
    await expect(column).toHaveAttribute('data-lines', '3')
    await expect(codexLine).toHaveText('Codex: approve hooks')
    await expect(item).not.toContainText('Codex')
    await expect(toolbar.getByTestId('limits-meter').getByRole('group', { name: 'Codex limits' }).getByRole('meter')).toHaveCount(2)
    await expect(toolbar.getByTestId('limit-five_hour-value')).toHaveText('101%')
    await expect(toolbar.getByTestId('limit-five_hour')).toHaveAttribute('data-level', 'blocked')

    const box = async (locator: typeof column): Promise<{ x: number; y: number; width: number; height: number }> => {
      const found = await locator.boundingBox()
      if (found === null) throw new Error('not on screen')
      return found
    }
    for (const width of [1280, 1600]) {
      await expect
        .poll(async () => {
          const now = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
          if (now !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 800), width)
          return now
        })
        .toBe(width)
      const bar = await box(toolbar)
      expect(bar.height, 'the toolbar keeps its 52 px').toBe(52)
      const harness = await box(item)
      const version = await box(column.getByTestId('app-line'))
      const codex = await box(codexLine)
      expect(version.y, `the version under the Harness line at ${width} px`).toBeGreaterThanOrEqual(harness.y + harness.height - 1)
      expect(codex.y, `the Codex line under the version at ${width} px`).toBeGreaterThanOrEqual(version.y + version.height - 1)
      expect(harness.y, `the Harness line inside the toolbar at ${width} px`).toBeGreaterThanOrEqual(bar.y)
      expect(codex.y + codex.height, `the Codex line inside the toolbar at ${width} px`).toBeLessThanOrEqual(bar.y + bar.height)
      // Neither line is cut with an ellipsis: the Harness line keeps its version, the Codex line its words.
      for (const [what, locator] of [['Harness line', item.getByTestId('harness-text')], ['Codex line', codexLine.getByTestId('harness-codex')]] as const) {
        const overflow = await locator.evaluate((node) => {
          const found = node as unknown as { scrollWidth: number; clientWidth: number }
          return { scrollWidth: found.scrollWidth, clientWidth: found.clientWidth }
        })
        expect(overflow.scrollWidth, `the ${what} is whole at ${width} px (${JSON.stringify(overflow)})`).toBeLessThanOrEqual(overflow.clientWidth)
      }
      // The search field still ends inside the window.
      const search = await box(toolbar.locator('.w-toolbar__palette-hint'))
      expect(search.x + search.width, `the search field inside the window at ${width} px`).toBeLessThanOrEqual(width)
      for (const scheme of ['light', 'dark'] as const) {
        await window.emulateMedia({ colorScheme: scheme })
        const base = `93-toolbar-${width}-${scheme}.png`
        const file = test.info().outputPath(base)
        await toolbar.screenshot({ path: file })
        const dir = process.env.WORFY_EVIDENCE_DIR
        if (dir !== undefined && dir !== '') {
          mkdirSync(dir, { recursive: true })
          copyFileSync(file, join(dir, base))
        }
      }
      await window.emulateMedia({ colorScheme: null })
    }

    // The line still opens the step.
    await codexLine.getByTestId('harness-codex').click()
    await expect(step).toBeVisible()
  } finally {
    await launched.close()
  }
})
