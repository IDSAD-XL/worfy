import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectBorderedChipsFit } from './chip-fit'
import { CHECK_IDS, CLAUDE_STAND_IN, TOOLS, toolFile, writeSandbox } from './first-run-sandbox'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// worfy-harness ticket 19: the first-run screen against the built app, in a sandbox. HOME, the
// Claude home (WORFY_CLAUDE_HOME, so the Harness install is offered in this dev build) and worfy's
// data folder are temporary; the shell is /bin/sh, and $HOME/.profile puts the stand-in tools of
// test/fixtures/first-run-tools/ first on the PATH of the login shell, so every check and the
// Terminal see them and nothing of the machine running the tests. The Harness installer runs the
// stand-in `claude` (WORFY_CLAUDE), which keeps the plugin state in a file outside that home and
// never reaches the network: the dependency of the Harness plugin (ticket 30) is "installed" there
// too. The agent is the fake one (launchApp), so the sign-in check gets a subscription login. The
// dialog of each action is replaced in main: it records what it was shown and answers with the given button.
// Ticket 40: the Harness item of the toolbar follows an install made from this screen without a reload.
// On Windows the sandbox is a registry stand-in instead of .profile (first-run-sandbox.ts, worfy-windows ticket 81).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const PROJECT = 'alpha-0000000a'
/** The Claude Code version this build carries: the stand-in `claude --version` prints the same, so that check is ok. */
const bundledClaude = (): string =>
  (JSON.parse(readFileSync(join(repoRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')) as { claudeCodeVersion: string }).claudeCodeVersion
const bundledHarness = (): string => (JSON.parse(readFileSync(join(repoRoot, 'out', 'harness', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version
/** The dependency out/harness declares (harness/.claude-plugin/plugin.json). */
const DEP = 'mattpocock-skills@claude-plugins-official'

let scratch: string
let home: string
let claudeHome: string
let dataDir: string
let bin: string
let state: string
let log: string
/** What the app needs in its environment to see the sandbox: the registry stand-in on Windows. */
let sandboxEnv: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-first-run-')))
  home = join(scratch, 'home')
  claudeHome = join(home, '.claude')
  dataDir = join(scratch, 'data')
  bin = join(scratch, 'bin')
  state = join(scratch, 'state')
  log = join(scratch, 'calls.log')
  sandboxEnv = {}
  for (const dir of [claudeHome, dataDir, bin, state]) mkdirSync(dir, { recursive: true })
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** The tools on the PATH and the stand-ins' settings, as the checks see them (first-run-sandbox.ts). */
function sandbox(options: { tools?: string[]; ghAccount?: string } = {}): void {
  const variables: Record<string, string> = {
    FIRST_RUN_TOOLS_LOG: log,
    FIRST_RUN_TOOLS_DIR: TOOLS,
    FIRST_RUN_TOOLS_STATE: state,
    FAKE_CLAUDE_VERSION: bundledClaude(),
    // The stand-in node runs the Harness scripts with the node running this test (ticket 37).
    FAKE_NODE_REAL: process.execPath,
    FAKE_GH_ACCOUNT: options.ghAccount ?? 'alice',
    FAKE_NPM_BIN: bin,
    FAKE_NPM_PREFIX: join(scratch, 'npm-prefix'),
    npm_config_prefix: join(scratch, 'npm-prefix'),
    XDG_CACHE_HOME: join(scratch, 'cache'),
    XDG_CONFIG_HOME: join(scratch, 'config'),
  }
  sandboxEnv = writeSandbox({ scratch, home, bin, tools: options.tools, variables })
}

function withProject(): void {
  const root = join(scratch, 'alpha')
  mkdirSync(root)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: root }], activeId: PROJECT }))
}

/** What launchd gives an app started from Finder: no node on it (worfy-harness ticket 37). */
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

const launch = (extra: Record<string, string> = {}): Promise<LaunchedApp> =>
  launchApp({
    env: {
      WORFY_FIRST_RUN_AUTO: '1',
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      HOME: home,
      SHELL: '/bin/sh',
      WORFY_CLAUDE: CLAUDE_STAND_IN,
      // The gh rows run WORFY_GH (worfy-windows ticket 80): the sandbox's own gh, missing when
      // sandbox() leaves it out, as on the login shell's PATH. The rest of the app gets it too: the
      // sandbox gh answers only the first-run commands, so a test with a Project here gets gh errors
      // (on Windows earlier still: ghRunner refuses a .cmd WORFY_GH). The sign-in types
      // `gh auth login` into a Terminal Node, whose shell finds the sandbox's gh on its own PATH.
      WORFY_GH: toolFile(bin, 'gh'),
      FIRST_RUN_TOOLS_STATE: state,
      FIRST_RUN_TOOLS_LOG: log,
      ...sandboxEnv,
      ...extra,
    },
  })

const calls = (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])

interface ShownDialog {
  message?: string
  detail?: string
  buttons?: string[]
}

/** Replaces the message box in main: it records its options and answers with `button` (0 — Confirm, 1 — Cancel). */
async function answerDialogWith(launched: LaunchedApp, button: number): Promise<void> {
  await launched.app.evaluate(({ dialog }, response) => {
    const shown = ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ??= [])
    dialog.showMessageBox = ((...args: unknown[]) => {
      shown.push(args.at(-1))
      return Promise.resolve({ response, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
  }, button)
}
const shownDialogs = (launched: LaunchedApp): Promise<ShownDialog[]> =>
  launched.app.evaluate(() => ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []) as ShownDialog[])

/** Starts recording, in the page, every `harness.changed` this window hears (worfy-harness ticket 40). */
async function listenForHarnessChanged(window: Page): Promise<void> {
  await window.evaluate(() => {
    const page = globalThis as unknown as { heard?: unknown[]; worfy: { on(channel: string, handler: (payload: unknown) => void): number } }
    const heard: unknown[] = []
    page.heard = heard
    page.worfy.on('harness.changed', (payload) => heard.push(payload))
  })
}
const heardHarnessChanged = (window: Page): Promise<{ state: { kind: string } }[]> =>
  window.evaluate(() => ((globalThis as unknown as { heard?: unknown[] }).heard ?? []) as { state: { kind: string } }[])

/** The Harness item of the toolbar (src/renderer/shell/toolbar/HarnessStatus.tsx). */
const toolbarHarness = (window: Page): Locator => window.getByTestId('harness-status')

/**
 * The screen, once its checks are in. `concepts`: it opened by itself on a new user's first start (no
 * mark, no Project), so the page of the three concepts comes first and "Next" leaves it
 * (worfy-onboarding ticket 08); `checks`: it opened on the checks.
 */
async function screen(window: Page, first: 'concepts' | 'checks'): Promise<Locator> {
  const dialog = window.getByTestId('first-run')
  await expect(dialog).toBeVisible({ timeout: ms(30_000) })
  await expect(dialog).toHaveAttribute('data-page', first)
  if (first === 'concepts') {
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Welcome to worfy')
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog).toHaveAttribute('data-page', 'checks')
  }
  await expect(dialog.locator('[data-check]')).toHaveCount(CHECK_IDS.length, { timeout: ms(30_000) })
  await expect(dialog.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: ms(30_000) })
  return dialog
}
const row = (dialog: Locator, id: string): Locator => dialog.locator(`[data-check="${id}"]`)

/**
 * Snapshots of the window in both themes, in test-results/e2e/snapshots/<name>/ (snapshots.ts), to
 * compare with F-SPEC "First run"; the tickets keep copies as .scratch/worfy-harness/evidence/19-*.png
 * and 30-*.png.
 */
async function keep(window: Page, name: string): Promise<void> {
  await snapshotThemes(window, name)
}

test.describe('first-run screen', () => {
  test('the first start shows every check; Install and Skip go through Confirm; the next start with everything ok shows no screen', async () => {
    sandbox()
    let launched = await launch()
    try {
      const dialog = await screen(launched.window, 'concepts')
      expect(await dialog.locator('[data-check]').evaluateAll((rows) => rows.map((each) => each.getAttribute('data-check')))).toEqual(CHECK_IDS)
      // The status chips and the summary chip have a 1 px border: their text stays inside it.
      await expectBorderedChipsFit(dialog, 'the first-run screen')
      for (const id of ['claude-login', 'claude-version', 'git', 'git-identity', 'gh', 'node', 'jq', 'gh-auth', 'legacy-harness', 'qmd', 'qmd-collections']) {
        await expect(row(dialog, id), id).toHaveAttribute('data-status', 'ok')
      }
      await expect(row(dialog, 'harness')).toHaveAttribute('data-status', 'fail')
      // The dependencies come from the same `claude plugin list` as the plugin: nothing is listed before it is installed.
      await expect(row(dialog, 'harness-dependencies')).toHaveAttribute('data-status', 'warn')
      await expect(row(dialog, 'harness-dependencies')).toContainText('Plugin dependencies')
      await expect(row(dialog, 'harness-dependencies')).toContainText('checked when the Harness plugin is installed')
      await expect(row(dialog, 'harness-dependencies').getByRole('button')).toHaveCount(0)
      // No Harness yet: its scripts are checked once it is installed.
      await expect(row(dialog, 'harness-scripts')).toHaveAttribute('data-status', 'warn')
      await expect(row(dialog, 'harness-scripts')).toContainText('checked when the Harness plugin is installed')
      await expect(row(dialog, 'qmd-models')).toHaveAttribute('data-status', 'warn')
      // The line under the title is one line next to the summary chip, and nothing of it is cut (F-SPEC "First run").
      const subtitle = dialog.getByTestId('first-run-subtitle')
      // The e2e typecheck has no DOM library: the page's getComputedStyle is reached through globalThis.
      const box = await subtitle.evaluate((element) => {
        const style = (globalThis as unknown as { getComputedStyle(e: unknown): { lineHeight: string; fontSize: string } }).getComputedStyle(element)
        return { height: element.getBoundingClientRect().height, line: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3, scroll: element.scrollWidth, width: element.clientWidth }
      })
      expect(box.height).toBeLessThan(box.line * 1.5)
      expect(box.scroll).toBeLessThanOrEqual(box.width)
      // Nothing ran by itself: no install, no download.
      expect(calls().filter((line) => /^claude plugin (marketplace|install|update)|^npm install|^qmd pull/.test(line))).toEqual([])
      await keep(launched.window, 'first-run')

      // The toolbar item read `not-installed` when the window opened (worfy-harness ticket 40).
      const toolbar = toolbarHarness(launched.window)
      await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness not installed')
      await expect(toolbar.getByTestId('harness-action')).toHaveAccessibleName('Install')
      await listenForHarnessChanged(launched.window)

      // Install → one dialog with Confirm → the dependency and the Harness are installed and both rows are ok.
      await answerDialogWith(launched, 0)
      await row(dialog, 'harness').getByRole('button', { name: 'Install' }).click()
      await expect(row(dialog, 'harness')).toHaveAttribute('data-status', 'ok', { timeout: ms(30_000) })
      await expect(row(dialog, 'harness')).toContainText(bundledHarness())
      // The toolbar learns of the install from main's `harness.changed`, without a reload: one event, the installed state.
      await expect(toolbar.getByTestId('harness-text')).toHaveText(`Harness ${bundledHarness()}`)
      await expect(toolbar.getByTestId('harness-action')).toHaveCount(0)
      expect((await heardHarnessChanged(launched.window)).map((status) => status.state.kind)).toEqual(['installed'])
      await expect(row(dialog, 'harness-dependencies')).toHaveAttribute('data-status', 'ok')
      await expect(row(dialog, 'harness-dependencies')).toContainText('OK')
      await expect(row(dialog, 'harness-dependencies')).toContainText(`${DEP} 1.0.0`)
      await expect(row(dialog, 'harness-scripts')).toHaveAttribute('data-status', 'ok')
      await expect(row(dialog, 'harness-scripts')).toContainText('profile --help answered')
      let shown = await shownDialogs(launched)
      expect(shown).toHaveLength(1)
      expect(shown[0]).toMatchObject({ buttons: ['Confirm', 'Cancel'], message: `Install the worfy Harness ${bundledHarness()}?` })
      // The native dialog cannot be screenshotted from Playwright: its text is kept with the test's output.
      writeFileSync(test.info().outputPath('30-first-run-dialog-install.txt'), `${shown[0]?.message ?? ''}\n\n${shown[0]?.detail ?? ''}\n\n[${(shown[0]?.buttons ?? []).join('] [')}]\n`)
      expect(shown[0]?.detail).toContain(join(claudeHome, 'worfy-harness', 'plugin'))
      expect(shown[0]?.detail).toContain('claude plugin marketplace add anthropics/claude-plugins-official')
      expect(shown[0]?.detail).toContain(`claude plugin install ${DEP} --scope user`)
      expect(shown[0]?.detail).toContain('downloads it from GitHub (anthropics/claude-plugins-official)')
      // With a dependency to download, the dialog does not say that nothing is.
      expect(shown[0]?.detail).not.toContain('Nothing is downloaded')
      const writes = calls().filter((line) => /^claude plugin (marketplace add|install|update|uninstall)/.test(line))
      expect(writes).toEqual([
        'claude plugin marketplace add anthropics/claude-plugins-official',
        `claude plugin install ${DEP} --scope user`,
        `claude plugin marketplace add ${join(claudeHome, 'worfy-harness', 'plugin')}`,
        'claude plugin install worfy@worfy-harness --scope user',
      ])
      // Download → the dialog names the size of the models; Cancel → nothing is downloaded.
      await answerDialogWith(launched, 1)
      await row(dialog, 'qmd-models').getByRole('button', { name: 'Download…' }).click()
      await expect.poll(async () => (await shownDialogs(launched)).length).toBe(2)
      shown = await shownDialogs(launched)
      expect(shown[1]?.buttons).toEqual(['Confirm', 'Cancel'])
      expect(shown[1]?.message).toMatch(/^Download the qmd models \(\d+\.\d GiB\)\?$/)
      expect(shown[1]?.detail).toContain('qmd pull')
      expect(shown[1]?.detail).toContain(join(scratch, 'cache', 'qmd', 'models'))
      await expect(row(dialog, 'qmd-models')).toHaveAttribute('data-status', 'warn')
      expect(calls().filter((line) => line.startsWith('qmd pull'))).toEqual([])

      // Skip → Confirm → the models are "skipped".
      await answerDialogWith(launched, 0)
      await row(dialog, 'qmd-models').getByRole('button', { name: 'Skip…' }).click()
      await expect(row(dialog, 'qmd-models')).toHaveAttribute('data-status', 'ok', { timeout: ms(30_000) })
      await expect(row(dialog, 'qmd-models')).toContainText('skipped')
      expect(readFileSync(join(claudeHome, 'worfy-harness', 'qmd-models'), 'utf8')).toBe('skipped\n')
      // Two rows of the machine stay warnings on Windows, which has nothing to do with qmd: Limits (a development
      // build has no bridge) and PowerShell (no pwsh on the sandbox's Path). A third warning is red, and so is
      // another one in place of these two: they are read by name, not only counted.
      await expect(dialog.getByTestId('first-run-summary')).toHaveText(process.platform === 'win32' ? '2 warnings' : 'Everything is ready')
      const warnings = await dialog.locator('[data-check][data-status="warn"]').evaluateAll((rows) => rows.map((each) => each.getAttribute('data-check')))
      expect(warnings).toEqual(process.platform === 'win32' ? ['limits', 'powershell'] : [])
      if (process.platform === 'win32') {
        await expect(row(dialog, 'limits')).toContainText('A development build has no bridge of its own')
        await expect(row(dialog, 'powershell')).toContainText('Terminal uses Windows PowerShell')
      }
      await keep(launched.window, 'first-run-ready')

      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toBeHidden()
      expect(JSON.parse(readFileSync(join(dataDir, 'first-run.json'), 'utf8'))).toMatchObject({ failing: [] })
    } finally {
      await launched.close()
    }

    // The second start: no check failed and the mark there — main runs the checks and the screen stays shut.
    const before = calls().length
    launched = await launch()
    try {
      await expect(launched.window.getByTestId('app-shell')).toBeVisible()
      await expect.poll(() => calls().slice(before).includes('qmd --version'), { timeout: ms(30_000) }).toBe(true)
      const startup = await launched.window.evaluate(() =>
        (globalThis as unknown as { worfy: { invoke(c: string, i?: unknown): Promise<{ ok: boolean; value: { show: boolean } }> } }).worfy.invoke('firstRun.startup'),
      )
      expect(startup).toMatchObject({ ok: true, value: { show: false } })
      await expect(launched.window.getByTestId('first-run')).toHaveCount(0)
    } finally {
      await launched.close()
    }
  })

  test('an install from the screen that fails on a step: the toolbar shows "Harness error: install" and Retry without a reload', async () => {
    sandbox()
    const launched = await launch({ FAKE_CLAUDE_FAIL: 'plugin install worfy@' })
    try {
      const dialog = await screen(launched.window, 'concepts')
      const toolbar = toolbarHarness(launched.window)
      await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness not installed')
      await answerDialogWith(launched, 0)
      await row(dialog, 'harness').getByRole('button', { name: 'Install' }).click()
      await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness error: install', { timeout: ms(30_000) })
      await expect(toolbar.getByTestId('harness-text')).toHaveAttribute('title', /plugin install worfy@worfy-harness --scope user failed/)
      await expect(toolbar.getByTestId('harness-action')).toHaveAccessibleName('Retry')
      expect(calls()).toContain('claude plugin install worfy@worfy-harness --scope user')
    } finally {
      await launched.close()
    }
  })

  test('Cancel in the dialog of the screen\'s Install: the toolbar keeps "Harness not installed" and Install, and no harness.changed is sent', async () => {
    sandbox()
    const launched = await launch()
    try {
      const dialog = await screen(launched.window, 'concepts')
      const toolbar = toolbarHarness(launched.window)
      await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness not installed')
      await listenForHarnessChanged(launched.window)
      await answerDialogWith(launched, 1)
      const install = row(dialog, 'harness').getByRole('button', { name: 'Install' })
      await install.click()
      await expect.poll(async () => (await shownDialogs(launched)).length).toBe(1)
      // The action is over once the row offers Install again.
      await expect(install).toBeEnabled({ timeout: ms(30_000) })
      await expect(row(dialog, 'harness')).toHaveAttribute('data-status', 'fail')
      await expect(toolbar.getByTestId('harness-text')).toHaveText('Harness not installed')
      await expect(toolbar.getByTestId('harness-action')).toHaveAccessibleName('Install')
      expect(await heardHarnessChanged(launched.window)).toEqual([])
      expect(calls().filter((line) => /^claude plugin (marketplace add|install|update)/.test(line))).toEqual([])
    } finally {
      await launched.close()
    }
  })

  test('the other way round: an install from the toolbar, then the screen opened from the palette shows "Harness plugin" ok', async () => {
    sandbox()
    const launched = await launch({ WORFY_FIRST_RUN_AUTO: '0' })
    try {
      const { window } = launched
      const toolbar = toolbarHarness(window)
      await expect(toolbar.getByTestId('harness-action')).toHaveAccessibleName('Install')
      await answerDialogWith(launched, 0)
      await toolbar.getByTestId('harness-action').click()
      await expect(toolbar.getByTestId('harness-text')).toHaveText(`Harness ${bundledHarness()}`, { timeout: ms(30_000) })
      await expect(toolbar.getByTestId('harness-action')).toHaveCount(0)

      await window.keyboard.press('ControlOrMeta+k')
      const input = window.getByTestId('palette-input')
      await input.fill('First-run checks')
      await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'first-run')
      await input.press('Enter')
      const dialog = await screen(window, 'checks')
      await expect(row(dialog, 'harness')).toHaveAttribute('data-status', 'ok')
      await expect(row(dialog, 'harness')).toContainText(bundledHarness())
    } finally {
      await launched.close()
    }
  })

  test('worfy installed without its dependency: "Plugin dependencies" is Failed with Install…, which asks with the dependency commands alone and makes the row OK', async () => {
    sandbox()
    // What the installer before ticket 30 left: the copy and worfy in Claude Code's list, no dependency.
    const pluginDir = join(claudeHome, 'worfy-harness', 'plugin')
    cpSync(join(repoRoot, 'out', 'harness'), pluginDir, { recursive: true })
    writeFileSync(join(state, 'marketplace'), `${pluginDir}\n`)
    writeFileSync(join(state, 'plugin-version'), `${bundledHarness()}\n`)
    const launched = await launch()
    try {
      const dialog = await screen(launched.window, 'concepts')
      const dependencies = row(dialog, 'harness-dependencies')
      await expect(dependencies).toHaveAttribute('data-status', 'fail')
      await expect(dependencies).toContainText('not installed')
      await expect(dependencies).toContainText(`without ${DEP}`)
      await expect(dependencies.getByRole('button', { name: 'Install…' })).toBeVisible()
      await expect(row(dialog, 'harness')).toHaveAttribute('data-status', 'fail')
      await expect(row(dialog, 'harness')).toContainText('error at dependency install')
      await keep(launched.window, 'first-run-dependency-missing')

      await answerDialogWith(launched, 0)
      await dependencies.getByRole('button', { name: 'Install…' }).click()
      await expect(dependencies).toHaveAttribute('data-status', 'ok', { timeout: ms(30_000) })
      await expect(dependencies).toContainText('OK')
      await expect(dependencies).toContainText(`${DEP} 1.0.0`)
      await expect(row(dialog, 'harness')).toHaveAttribute('data-status', 'ok')
      const shown = await shownDialogs(launched)
      expect(shown).toHaveLength(1)
      writeFileSync(test.info().outputPath('30-first-run-dialog-dependency.txt'), `${shown[0]?.message ?? ''}\n\n${shown[0]?.detail ?? ''}\n\n[${(shown[0]?.buttons ?? []).join('] [')}]\n`)
      expect(shown[0]).toMatchObject({ buttons: ['Confirm', 'Cancel'], message: `Install ${DEP} for the worfy Harness?` })
      expect(shown[0]?.detail).toContain(`claude plugin install ${DEP} --scope user`)
      expect(shown[0]?.detail).toContain('downloads it from GitHub (anthropics/claude-plugins-official)')
      expect(shown[0]?.detail).not.toContain('worfy@worfy-harness')
      expect(shown[0]?.detail).not.toContain('Nothing is downloaded')
      expect(calls().filter((line) => /^claude plugin (marketplace add|install|update|uninstall)/.test(line))).toEqual([
        'claude plugin marketplace add anthropics/claude-plugins-official',
        `claude plugin install ${DEP} --scope user`,
      ])
      await keep(launched.window, 'first-run-dependency-installed')
    } finally {
      await launched.close()
    }
  })

  // worfy-harness ticket 37: the row runs the Harness's own `profile --help` the way the Epics read
  // runs the Harness scripts. The app gets the PATH of Finder, which has no node; node, when there
  // is one, is only on the PATH of the login shell.
  test('Harness scripts: the app PATH has no node and the login shell has — OK; the login shell has none either — Failed: node not found in PATH', async () => {
    const pluginDir = join(claudeHome, 'worfy-harness', 'plugin')
    cpSync(join(repoRoot, 'out', 'harness'), pluginDir, { recursive: true })
    writeFileSync(join(state, 'marketplace'), `${pluginDir}\n`)
    writeFileSync(join(state, 'plugin-version'), `${bundledHarness()}\n`)
    sandbox()
    let launched = await launch({ PATH: SYSTEM_PATH })
    try {
      const scripts = row(await screen(launched.window, 'concepts'), 'harness-scripts')
      await expect(scripts).toHaveAttribute('data-status', 'ok')
      await expect(scripts).toContainText('Harness scripts')
      await expect(scripts).toContainText('profile --help answered')
      // On Windows worfy runs the script with node.exe from the Path, never the node.cmd stand-in
      // (first-run-sandbox.ts), so the stand-in does not log it.
      if (process.platform !== 'win32') expect(calls()).toContain(`node ${join(pluginDir, 'bin', 'profile')} --help`)
      expect(await launched.app.evaluate(() => process.env.PATH)).toBe(SYSTEM_PATH)
    } finally {
      await launched.close()
    }

    // The same tools but node, in a new folder; sandbox() writes .profile again. Its PATH is that
    // folder, /usr/bin and /bin: the premise is that neither system folder has a node.
    expect(['/usr/bin/node', '/bin/node'].filter((path) => existsSync(path))).toEqual([])
    bin = join(scratch, 'bin-without-node')
    mkdirSync(bin)
    sandbox({ tools: ['claude', 'gh', 'jq', 'git', 'npm', 'qmd'] })
    launched = await launch({ PATH: SYSTEM_PATH })
    try {
      const dialog = await screen(launched.window, 'concepts')
      const scripts = row(dialog, 'harness-scripts')
      await expect(scripts).toHaveAttribute('data-status', 'fail')
      // The detail itself names node, not only the fixed hint below it: worfy finds no node to run the script with.
      await expect(scripts).toContainText('profile --help: node not found in PATH')
      await expect(scripts).toContainText('worfy cannot run the Harness scripts, so it reads no Epics: they need node on the PATH of your login shell')
      await keep(launched.window, 'first-run-harness-scripts-no-node')
    } finally {
      await launched.close()
    }
  })

  test('without a Project, the GitHub sign-in is a command to copy', async () => {
    sandbox({ ghAccount: '' })
    const launched = await launch()
    try {
      const dialog = await screen(launched.window, 'concepts')
      const accounts = row(dialog, 'gh-auth')
      await expect(accounts).toHaveAttribute('data-status', 'fail')
      await expect(accounts.locator('code')).toHaveText('gh auth login')
      await expect(accounts.getByRole('button', { name: 'Copy gh auth login' })).toBeVisible()
      await expect(accounts.getByRole('button', { name: 'Sign in…' })).toHaveCount(0)
      await expect(accounts).toContainText('No Project is connected yet')
      await keep(launched.window, 'first-run-no-project')
    } finally {
      await launched.close()
    }
  })

  test('with a Project, Sign in → Confirm opens a Terminal Node on its Canvas that runs gh auth login', async () => {
    sandbox({ ghAccount: '' })
    withProject()
    const launched = await launch()
    try {
      const dialog = await screen(launched.window, 'checks')
      const accounts = row(dialog, 'gh-auth')
      await expect(accounts).toHaveAttribute('data-status', 'fail')

      // Cancel: no Terminal.
      await answerDialogWith(launched, 1)
      await accounts.getByRole('button', { name: 'Sign in…' }).click()
      await expect.poll(async () => (await shownDialogs(launched)).length).toBe(1)
      await expect(dialog).toBeVisible()
      await expect(launched.window.getByTestId('terminal-node')).toHaveCount(0)

      await answerDialogWith(launched, 0)
      await accounts.getByRole('button', { name: 'Sign in…' }).click()
      await expect(dialog).toBeHidden({ timeout: ms(15_000) })
      const shown = await shownDialogs(launched)
      expect(shown[1]?.detail).toContain('gh auth login')
      expect(shown[1]?.detail).toContain('alpha')
      const terminal = launched.window.getByTestId('terminal-node')
      await expect(terminal).toHaveCount(1)
      await expect(terminal.locator('.xterm-rows')).toContainText('fake gh: auth login started', { timeout: ms(15_000) })
      expect(calls()).toContain('gh auth login')
      // The screen is closed for good: the mark has the failing GitHub check, so the next start does not open it for that.
      expect((JSON.parse(readFileSync(join(dataDir, 'first-run.json'), 'utf8')) as { failing: string[] }).failing).toContain('gh-auth')
    } finally {
      await launched.close()
    }
  })
})
