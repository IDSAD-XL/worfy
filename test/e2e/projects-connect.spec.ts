import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'

// worfy-harness ticket 24: "Add project" on a repository the Harness does not know opens the dialog
// that connects it — Silent mode by default, the draft of the fake agent
// (test/fixtures/agent-scripts/profile-draft.jsonl), the form with a problem under its field, then
// "Connect". The Harness is the copy of this build in the temporary Claude home's worfy-harness/plugin/,
// `claude` is a stub that lists it installed and enabled, so the real bin/project-connect and
// bin/profile write and read the temporary Harness home only. The repository stays untouched.
// Screenshots of the dialog and the "No epics yet" panel in both themes go to the test's output;
// the ticket's evidence is copied from there to .scratch/worfy-harness/evidence/24-*.png.
//
// worfy-harness ticket 25: the GitHub account step of the form, over the gh stand-in
// (test/fixtures/gh/gh-stub.mjs, GH_STUB_DIR): the accounts with their access, "Sign in with gh"
// running the stand-in's `gh auth login` in the dialog's terminal, the pick written into the Profile;
// gh failing and gh without accounts. Its screenshots are 25-*.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')
const bundledVersion = (): string => (JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

const STUB = `#!/bin/sh
case "$*" in
  "plugin list --json") printf '[{"id":"worfy@worfy-harness","version":"%s","scope":"user","enabled":true,"errors":[]}]\\n' "$STUB_PLUGIN_VERSION" ;;
esac
exit 0
`

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

async function pickNext(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}

/** Screenshots of `locator` in both themes, kept with the test's output. */
async function shoot(launched: LaunchedApp, locator: Locator, name: string, ticket = '24'): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    await locator.screenshot({ path: test.info().outputPath(`${ticket}-${name}-${scheme}.png`) })
  }
  await launched.window.emulateMedia({ colorScheme: null })
}

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-connect-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Add project connects a new repository: Silent by default, the draft, the form, Connect, then "No epics yet"', async () => {
  const shop = makeRepo(join(scratch, 'shop'))
  const stubDir = join(scratch, 'stub-bin')
  mkdirSync(stubDir)
  writeFileSync(join(stubDir, 'claude'), STUB)
  chmodSync(join(stubDir, 'claude'), 0o755)
  const agentLog = join(scratch, 'agent.jsonl')

  const launched = await launchApp({ env: { WORFY_CLAUDE: join(stubDir, 'claude'), STUB_PLUGIN_VERSION: bundledVersion(), WORFY_AGENT_LOG: agentLog } })
  try {
    const { app, window, claudeHome } = launched
    const harnessHome = join(claudeHome, 'worfy-harness')
    cpSync(bundle, join(harnessHome, 'plugin'), { recursive: true })
    mkdirSync(join(harnessHome, 'gate'), { recursive: true })
    writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
    // A profile named "other" is there already: the draft's name will collide with it in the form.
    mkdirSync(join(harnessHome, 'projects', 'other'), { recursive: true })
    writeFileSync(join(harnessHome, 'projects', 'other', 'profile.json'), '{"schema":2,"name":"other","mode":"full"}\n')

    await pickNext(app, shop)
    await window.getByRole('button', { name: 'Add project' }).click()
    const dialog = window.getByTestId('connect-project')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-step', 'mode')
    await expect(dialog.getByTestId('connect-folder')).toHaveText(shop)
    // Silent mode by default, with the default Workflow folder in the Harness home.
    await expect(dialog.getByTestId('connect-mode-silent').getByRole('radio')).toBeChecked()
    await expect(dialog.getByTestId('connect-workflow-folder')).toHaveText(`${harnessHome}/projects/<name>/workflow/`)
    await shoot(launched, dialog, 'connect-silent')
    await dialog.getByTestId('connect-mode-full').click()
    await expect(dialog.getByTestId('connect-workflow-folder')).toHaveCount(0)
    await shoot(launched, dialog, 'connect-full')
    await dialog.getByTestId('connect-mode-silent').click()
    // Nothing is written before Connect.
    expect(existsSync(join(harnessHome, 'projects', 'fake-project'))).toBe(false)
    await expect(window.getByTestId('project-row')).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Write draft' }).click()
    await expect(dialog).toHaveAttribute('data-step', 'form', { timeout: 20_000 })
    const messages = readFileSync(agentLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { draft?: boolean; kind: string; text?: string })
      .filter((call) => call.draft === true && call.kind === 'message')
    // One message: the skill, then the facts bin/project-connect --facts read (the draft has no Bash).
    expect(messages).toHaveLength(1)
    const first = messages[0]?.text ?? ''
    expect(first.startsWith(`/worfy:connect-project ${shop} silent --draft-only\n`)).toBe(true)
    expect(first).toContain(`"path": "${shop}"`)
    expect(first).toContain('"origin": null')

    // The form: the commands of the draft; the mode and the Workflow folder only shown.
    const name = dialog.getByLabel('Name')
    await expect(name).toHaveValue('fake-project')
    await expect(dialog.getByLabel('test', { exact: true })).toHaveValue('npm test')
    await expect(dialog.getByTestId('connect-form-mode')).toHaveText('silent')
    await expect(dialog.getByLabel('Reports')).toHaveAttribute('data-value', /^(ru|en)$/)
    // A taken name: its problem under the field, Connect not available.
    await name.fill('other')
    await expect(dialog.locator('[data-field="profile.name"]').getByRole('alert')).toContainText('the name is taken')
    const connect = dialog.getByRole('button', { name: 'Connect' })
    await expect(connect).toBeDisabled()
    // Out of focus, so the error border shows rather than the focus ring.
    await name.blur()
    await shoot(launched, dialog, 'connect-form-error')
    await name.fill('shop')
    await expect(dialog.locator('[data-field="profile.name"]').getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByTestId('connect-form-folder')).toHaveText(`${harnessHome}/projects/shop/workflow/`)
    await expect(connect).toBeEnabled()
    await shoot(launched, dialog, 'connect-form')
    await connect.click()

    // Connected: in the list and active; the Canvas says what to do without Epics.
    await expect(dialog).toHaveCount(0)
    const row = window.getByTestId('project-row').filter({ hasText: 'shop' })
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(existsSync(join(harnessHome, 'projects', 'shop', 'profile.json'))).toBe(true)
    expect(existsSync(join(harnessHome, 'projects', 'shop', 'workflow', '.git'))).toBe(true)
    const panel = window.getByTestId('first-epic')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('No epics yet')
    await shoot(launched, window.locator('.react-flow'), 'first-epic')
    await panel.getByRole('button', { name: 'Plan first epic' }).click()
    await expect(window.getByTestId('session-view')).toBeVisible()
    // The Orchestrator was sent nothing: the person names the first goal.
    const sent = readFileSync(agentLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { draft?: boolean; kind: string })
      .filter((call) => call.draft !== true && call.kind === 'message')
    expect(sent).toEqual([])
  } finally {
    await launched.close()
  }
  // worfy and the Harness wrote nothing into the repository, ignored files included.
  expect(git(shop, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

test('the Harness not installed: the dialog names the reason and sends the user to the first-run screen', async () => {
  const shop = makeRepo(join(scratch, 'shop'))
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await pickNext(app, shop)
    await window.getByRole('button', { name: 'Add project' }).click()
    const dialog = window.getByTestId('connect-project')
    await dialog.getByRole('button', { name: 'Write draft' }).click()
    await expect(dialog.getByTestId('connect-harness')).toHaveText('The Harness plugin is not installed. Install it on the first-run screen.')
    await shoot(launched, dialog, 'connect-harness')
    await dialog.getByRole('button', { name: 'First-run checks…' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(window.getByTestId('first-run')).toBeVisible()
  } finally {
    await launched.close()
  }
  expect(git(shop, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

// ── the GitHub account (worfy-harness ticket 25) ─────────────────────────────

/** The plugin of this build in the app's temporary Harness home, and a `claude` that lists it enabled. */
function harnessFor(launched: LaunchedApp): string {
  const harnessHome = join(launched.claudeHome, 'worfy-harness')
  cpSync(bundle, join(harnessHome, 'plugin'), { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
  return harnessHome
}

function claudeStub(): string {
  const stubDir = join(scratch, 'stub-bin')
  mkdirSync(stubDir, { recursive: true })
  writeFileSync(join(stubDir, 'claude'), STUB)
  chmodSync(join(stubDir, 'claude'), 0o755)
  return join(stubDir, 'claude')
}

const ghAccount = (login: string, active = false) => ({ active, gitProtocol: 'https', host: 'github.com', login, scopes: 'repo', state: 'success', tokenSource: 'keyring' })

/** The gh calls the stand-in logged. */
const ghCalls = (log: string): string[] =>
  readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as string[]).join(' '))

/** Up to the form of the dialog, for `repo`. */
async function toForm(launched: LaunchedApp, repo: string): Promise<Locator> {
  await pickNext(launched.app, repo)
  await launched.window.getByRole('button', { name: 'Add project' }).click()
  const dialog = launched.window.getByTestId('connect-project')
  await dialog.getByRole('button', { name: 'Write draft' }).click()
  await expect(dialog).toHaveAttribute('data-step', 'form', { timeout: 20_000 })
  return dialog
}

test('the GitHub account: the active account with access by default, "Sign in with gh" in the dialog, the pick written into the Profile', async () => {
  const shop = makeRepo(join(scratch, 'shop'))
  git(shop, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git')
  const ghDir = join(scratch, 'gh')
  mkdirSync(ghDir)
  writeFileSync(join(ghDir, 'auth-status.json'), JSON.stringify({ hosts: { 'github.com': [ghAccount('alice', true), ghAccount('bob')] } }))
  writeFileSync(join(ghDir, 'tokens.json'), JSON.stringify({ alice: 'gho_alice_E2E_SECRET', bob: 'gho_bob_E2E_SECRET' }))
  writeFileSync(join(ghDir, 'repos.json'), JSON.stringify({ 'acme/shop': { alice: true, bob: false, carol: true } }))
  // The account the stand-in's `gh auth login` adds.
  writeFileSync(join(ghDir, 'login.json'), JSON.stringify({ login: 'carol', token: 'gho_carol_E2E_SECRET' }))
  const ghLog = join(scratch, 'gh-calls.jsonl')

  const launched = await launchApp({ env: { WORFY_CLAUDE: claudeStub(), STUB_PLUGIN_VERSION: bundledVersion(), GH_STUB_DIR: ghDir, GH_STUB_LOG: ghLog } })
  try {
    const harnessHome = harnessFor(launched)
    const dialog = await toForm(launched, shop)
    const step = dialog.getByTestId('connect-github')
    const rows = step.getByTestId('connect-github-account')
    await expect(rows).toHaveCount(2, { timeout: 20_000 })
    await expect(rows.nth(0)).toHaveAttribute('data-login', 'alice')
    await expect(rows.nth(0).getByRole('radio')).toBeChecked()
    await expect(rows.nth(1).getByTestId('connect-github-reason')).toHaveText('bob has no write access to acme/shop: Tickets will close with the local finish.')
    await expect(dialog.getByLabel('Finish', { exact: true })).toHaveAttribute('data-value', 'pr-green-ci')
    await expect(dialog.getByRole('button', { name: 'Connect' })).toBeEnabled({ timeout: 10_000 })
    await shoot(launched, dialog, 'account-list', '25')

    // Sign in: the stand-in's gh auth login runs in the dialog and waits for its user.
    await step.getByRole('button', { name: 'Sign in with gh' }).click()
    const signIn = step.getByTestId('connect-signin')
    await expect(signIn).toHaveAttribute('data-state', 'running', { timeout: 20_000 })
    await expect(signIn.getByTestId('connect-signin-terminal')).toContainText('Press Enter to sign in', { timeout: 20_000 })
    expect(ghCalls(ghLog)).toContain('auth login')
    await shoot(launched, dialog, 'account-signin', '25')
    await signIn.getByTestId('connect-signin-terminal').click()
    await launched.window.keyboard.press('Enter')
    await expect(signIn).toHaveAttribute('data-state', 'exited', { timeout: 20_000 })
    // gh exited: the accounts were read again, with the one the sign-in added (now gh's active one).
    await expect(rows).toHaveCount(3, { timeout: 20_000 })
    await expect(step.locator('[data-login="carol"]').getByRole('radio')).toBeChecked()

    // The person picks bob, who cannot push: the local finish.
    await step.locator('[data-login="bob"]').getByRole('radio').check()
    await expect(dialog.getByLabel('Finish', { exact: true })).toHaveAttribute('data-value', 'local-green')
    const connect = dialog.getByRole('button', { name: 'Connect' })
    await expect(connect).toBeEnabled({ timeout: 10_000 })
    await connect.click()
    await expect(dialog).toHaveCount(0, { timeout: 20_000 })

    // The sandbox Harness only: the gate exports CLAUDE_GATE_CONFIG (its own registry) to the tests it runs.
    const outside = /^(CLAUDE_GATE_|CLAUDE_PROFILES_DIR$|PROJECT_CONNECT_|ELECTRON_RUN_AS_NODE$)/
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !outside.test(key))), HOME: join(scratch, 'home'), HARNESS_HOME: harnessHome, CLAUDE_CONFIG_DIR: launched.claudeHome }
    const field = (name: string): string => execFileSync(join(harnessHome, 'plugin', 'bin', 'profile'), ['-C', shop, '--field', name], { env, encoding: 'utf8' }).trim()
    expect(field('github.account')).toBe('bob')
    expect(field('workflow.finish')).toBe('local-green')
    // gh was asked only to read; no token was written into the Harness home.
    const calls = ghCalls(ghLog)
    expect(calls.filter((call) => !/^(auth status --json hosts|auth token -u \S+|api repos\/acme\/shop --jq \.permissions\.push --hostname github\.com|auth login)$/.test(call))).toEqual([])
    expect(readFileSync(join(harnessHome, 'projects', 'fake-project', 'profile.json'), 'utf8')).not.toMatch(/gho_/)
  } finally {
    await launched.close()
  }
  expect(git(shop, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

test('the GitHub account: gh failing says why; gh without accounts offers the sign-in', async () => {
  const shop = makeRepo(join(scratch, 'shop'))
  git(shop, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git')
  const ghDir = join(scratch, 'gh')
  mkdirSync(ghDir)
  // gh cannot reach GitHub, then answers with no accounts.
  writeFileSync(join(ghDir, 'fail'), 'error connecting to api.github.com')
  writeFileSync(join(ghDir, 'auth-status.json'), JSON.stringify({ hosts: {} }))
  const launched = await launchApp({ env: { WORFY_CLAUDE: claudeStub(), STUB_PLUGIN_VERSION: bundledVersion(), GH_STUB_DIR: ghDir } })
  try {
    harnessFor(launched)
    const dialog = await toForm(launched, shop)
    const step = dialog.getByTestId('connect-github')
    await expect(step.getByTestId('connect-github-error')).toHaveText('gh auth status failed: error connecting to api.github.com', { timeout: 20_000 })
    await expect(dialog.getByLabel('Finish', { exact: true })).toHaveAttribute('data-value', 'local-green')
    const connect = dialog.getByRole('button', { name: 'Connect' })
    await expect(connect).toBeEnabled({ timeout: 10_000 })
    // Nothing in focus: the screenshot shows the error, not a focus ring.
    await dialog.focus()
    await shoot(launched, dialog, 'account-error', '25')

    unlinkSync(join(ghDir, 'fail'))
    await step.getByRole('button', { name: 'Check again' }).click()
    await expect(step.getByTestId('connect-github-empty')).toHaveText('gh has no account for github.com. Sign in with gh, or connect without an account.', { timeout: 20_000 })
    await expect(step.getByTestId('connect-github-none').getByRole('radio')).toBeChecked()
    await expect(step.getByRole('button', { name: 'Sign in with gh' })).toBeEnabled()
    await expect(connect).toBeEnabled({ timeout: 10_000 })
    await dialog.focus()
    await shoot(launched, dialog, 'account-empty', '25')
  } finally {
    await launched.close()
  }
})
