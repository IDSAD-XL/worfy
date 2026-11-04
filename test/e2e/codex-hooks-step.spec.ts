import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { approvePluginHooks } from '../fixtures/codex-app-server/hook-runner.mjs'
import { launchApp, type LaunchedApp } from './helpers'

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
async function shoot(launched: LaunchedApp, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    const file = test.info().outputPath(`39-codex-hooks-step-${name}-${scheme}.png`)
    await launched.window.screenshot({ path: file })
    const dir = process.env.WORFY_EVIDENCE_DIR
    if (dir !== undefined && dir !== '') {
      mkdirSync(dir, { recursive: true })
      copyFileSync(file, join(dir, `39-codex-hooks-step-${name}-${scheme}.png`))
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
    await expect(item.getByTestId('harness-codex')).toHaveText('· Codex: approve hooks')
    await expect(step.getByTestId('codex-hooks-step-steps')).toContainText('/hooks')
    await shoot(launched, 'after-install')

    const result = step.getByTestId('codex-hooks-step-result')
    await step.getByRole('button', { name: 'Check again' }).click()
    await expect(result).toHaveAttribute('data-trust', 'not-approved')
    await expect(result).toHaveText('The Harness hooks are still off in Codex. Approve them in /hooks, then check again.')
    await shoot(launched, 'not-approved')

    // The user approves them in Codex's /hooks.
    approvePluginHooks(codexHome)
    await step.getByRole('button', { name: 'Check again' }).click()
    await expect(result).toHaveAttribute('data-trust', 'approved')
    await expect(item.getByTestId('harness-codex')).toHaveCount(0)
    await shoot(launched, 'approved')
    await step.getByRole('button', { name: 'Done' }).click()
    await expect(step).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
