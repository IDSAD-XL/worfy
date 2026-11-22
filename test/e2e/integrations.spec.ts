import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { startOAuthStub } from '../fixtures/integrations/oauth-stub'
import { STUB_TOOLS, startServiceStub, type ServiceStub } from '../fixtures/integrations/service-stub'
import { launchApp } from './helpers'

// The Integrations section of Project settings (worfy-integrations ticket 08) against the built app. A stand-in of a
// service's MCP server (test/fixtures/integrations/service-stub.ts) on 127.0.0.1 knows two made-up tokens, each
// opening a dataset of its own. In the Project alpha, Add integration → Custom server on the stub's address with the
// first token: the dialog checks the sign-in and counts the tools, and the row reads signed-in with «6 tools · ~N
// tokens». A Session of alpha (the fake agent, which lists the Project's Integrations as Claude Code lists worfy's
// SDK servers) shows the Integration's row in its chip «MCP n/m». In the Project beta a second Integration on the
// same address with the second token signs in on its own: the stub answered each sign-in from its own dataset, and
// neither token is in the files worfy keeps outside its secret store. The section is shot in the light and the dark
// theme; with WORFY_EVIDENCE_DIR set, the shots are copied there.
//
// worfy-integrations ticket 09: Sign in with OAuth in worfy's own window against the OAuth stub
// (test/fixtures/integrations/oauth-stub.ts), an Integration turned on while a Session runs reaching it on Restart, and
// a refused refresh read as «Sign-in needed» in the row, in the chip «MCP n/m» and in Settings → Health.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'

/** As in test/e2e/snapshots.ts: the translucent sidebar gets its opaque token while a shot is taken. */
const VIBRANCY_BACKDROP = 'html { background: var(--sidebar) !important; }'

let scratch: string
let dataDir: string
let claudeHome: string
let stub: ServiceStub
// Made-up tokens, new on every run: the stub knows them and nothing else does.
const tokens = { alpha: `stub-${randomUUID()}`, beta: `stub-${randomUUID()}` }

test.beforeEach(async () => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-integrations-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  const projects = [
    { id: ALPHA, name: 'alpha', path: join(scratch, 'alpha') },
    { id: BETA, name: 'beta', path: join(scratch, 'beta') },
  ]
  for (const project of projects) {
    mkdirSync(project.path)
    mkdirSync(join(dataDir, project.id), { recursive: true })
  }
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects, activeId: ALPHA }))
  stub = await startServiceStub({ bearer: { [tokens.alpha]: 'alpha', [tokens.beta]: 'beta' } })
})

test.afterEach(async () => {
  await stub.close()
  await removeDir(scratch)
})

/** Project settings of `name`, on its Integrations tab. */
async function openIntegrations(window: Page, name: string): Promise<Locator> {
  await window.getByTestId('project-row').filter({ hasText: name }).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Project settings…' }).click()
  const settings = window.getByRole('dialog', { name: 'Project settings' })
  await expect(settings).toBeVisible()
  await settings.getByTestId('project-settings-tab-integrations').click()
  await expect(settings.getByTestId('integrations-section')).toBeVisible()
  return settings
}

/** Add integration → Custom server on the stub's address, signed in with `token`; the result, then Done. */
async function addCustom(window: Page, settings: Locator, label: string, token: string): Promise<void> {
  await settings.getByTestId('integrations-add').click()
  const dialog = window.getByTestId('add-integration')
  await dialog.getByTestId('add-integration-catalogue').getByText('Custom server').click()
  const form = dialog.getByTestId('add-integration-form')
  await form.getByLabel('Label', { exact: true }).fill(label)
  await form.getByLabel('Address', { exact: true }).fill(stub.url)
  await form.getByRole('radio', { name: 'Token', exact: true }).check()
  await form.getByLabel('API token', { exact: true }).fill(token)
  await dialog.getByTestId('add-integration-save').click()
  // The check of the sign-in (ticket 04) and the tools the proxy listed (ticket 06).
  await expect(dialog.getByTestId('add-integration-result-status')).toHaveText(new RegExp(`^Signed in · ${STUB_TOOLS.length} tools · ~\\d+ tokens$`, 'u'))
  await dialog.getByTestId('add-integration-done').click()
  await expect(dialog).toHaveCount(0)
}

/** The section in both themes, as <test output>/integrations/<name>-<scheme>.png, copied to the evidence folder as <ticket>-<name>-<scheme>.png. */
async function shoot(window: Page, section: Locator, name: string, ticket = '08'): Promise<void> {
  const folder = join(test.info().project.outputDir, 'snapshots', 'integrations')
  mkdirSync(folder, { recursive: true })
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const path = join(folder, `${name}-${scheme}.png`)
      await section.screenshot({ path, animations: 'disabled', style: VIBRANCY_BACKDROP })
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(path, join(EVIDENCE_DIR, `${ticket}-${name}-${scheme}.png`))
      }
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

test('Add integration signs in to a custom server, a second Project signs in to the same address as itself, and a new Session of the Project lists its Integration', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-mcp' }
  const app = await launchApp({ env })
  try {
    const { window } = app
    const settings = await openIntegrations(window, 'alpha')
    await expect(settings.getByTestId('integrations-empty')).toBeVisible()
    await addCustom(window, settings, 'Builds A', tokens.alpha)

    const row = settings.getByTestId('integration-row')
    await expect(row).toHaveCount(1)
    await expect(row).toHaveAttribute('data-status', 'signed-in')
    await expect(row.getByTestId('integration-status')).toHaveText('Signed in')
    await expect(row.getByTestId('integration-cost')).toHaveText(new RegExp(`^${STUB_TOOLS.length} tools · ~\\d+ tokens$`, 'u'))
    await expect(row.getByRole('checkbox', { name: 'Enabled in this Project: Builds A' })).toBeChecked()
    // Owner's answer Q7: an Integration is not available to Autopilot until the user says so.
    await expect(row.getByRole('checkbox', { name: 'Available to Autopilot: Builds A' })).not.toBeChecked()
    await shoot(window, settings, 'integrations-section')
    await settings.getByRole('button', { name: 'Close' }).click()
    await expect(settings).toHaveCount(0)

    // beta: the Machine's Integration is offered for reuse, but this Project signs in to the same address as itself.
    const other = await openIntegrations(window, 'beta')
    await other.getByTestId('integrations-add').click()
    await expect(window.getByTestId('add-integration').getByTestId('add-integration-reuse')).toContainText('Use in this Project: Builds A')
    await window.getByTestId('add-integration').getByRole('button', { name: 'Cancel' }).click()
    await addCustom(window, other, 'Builds B', tokens.beta)
    const rowB = other.getByTestId('integration-row')
    await expect(rowB).toHaveCount(1)
    await expect(rowB).toHaveAttribute('data-status', 'signed-in')
    await expect(rowB.getByTestId('integration-status')).toHaveText('Signed in')
  } finally {
    await app.close()
  }

  // Each sign-in was answered from its own dataset, and no request reached the stub without a token it knows.
  const listed = (from = 0): string[] => stub.log.slice(from).filter((entry) => entry.method === 'tools/list').map((entry) => entry.dataset)
  expect([...new Set(listed())].sort()).toEqual(['alpha', 'beta'])
  expect(stub.log.filter((entry) => entry.dataset === 'unauthorized')).toEqual([])
  // The tokens live in the secret store only: not in the list of Integrations, not in the Projects' files.
  for (const file of [join(dataDir, 'integrations', 'integrations.json'), join(dataDir, 'projects.json')]) {
    const text = readFileSync(file, 'utf8')
    expect(text.includes(tokens.alpha) || text.includes(tokens.beta)).toBe(false)
  }

  // A new Session of alpha (an Integration turned on while a Session runs reaches it on Restart, ticket 09): the
  // Integration is a row of the chip, under its label, beside the servers of the script, and its tools came from
  // alpha's dataset only.
  const before = stub.log.length
  const again = await launchApp({ env })
  try {
    const { window } = again
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await view.getByRole('textbox', { name: 'Message Orchestrator' }).fill('check the servers')
    await view.getByRole('textbox', { name: 'Message Orchestrator' }).press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    const chip = view.getByTestId('message-input').getByTestId('session-mcp')
    // The script's three servers (one failed) and the Integration.
    await expect(chip.getByTestId('session-mcp-count')).toHaveText('3/4')
    await chip.click()
    const popover = window.getByRole('dialog', { name: 'MCP servers' })
    const builds = popover.locator('[data-testid="mcp-row"][data-name="builds-a"]')
    await expect(builds.getByTestId('mcp-row-name')).toHaveText('Builds A')
    await expect(builds.getByTestId('mcp-row-status')).toHaveText('connected')
    await expect(builds.getByTestId('mcp-row-tools')).toHaveText(`${STUB_TOOLS.length} tools`)
    await expect(popover.locator('[data-testid="mcp-row"][data-name="builds-b"]')).toHaveCount(0)
    await popover.press('Escape')
    await expect(popover).toHaveCount(0)
    expect(new Set(listed(before))).toEqual(new Set(['alpha']))
  } finally {
    await again.close()
  }
})

test('Sign in with OAuth in worfy`s window; Restart gives the Integration to the running Session; a refused refresh is «Sign-in needed» in the row, the chip and Settings → Health', async () => {
  const oauth = await startOAuthStub()
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-mcp' }
  const app = await launchApp({ env })
  try {
    const { window } = app
    // A Session of alpha runs before the Integration is added.
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    const input = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await input.fill('check the servers')
    await input.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)

    // Add integration → Custom server → «Sign in with the server»: the service's page in worfy's window, which the stub
    // approves at once; then the tools, as after a token.
    const settings = await openIntegrations(window, 'alpha')
    await settings.getByTestId('integrations-add').click()
    const dialog = window.getByTestId('add-integration')
    await dialog.getByTestId('add-integration-catalogue').getByText('Custom server').click()
    const form = dialog.getByTestId('add-integration-form')
    await form.getByLabel('Label', { exact: true }).fill('Tracker A')
    await form.getByLabel('Address', { exact: true }).fill(oauth.url)
    await form.getByRole('radio', { name: 'Sign in with the server', exact: true }).check()
    await expect(form.getByLabel('API token', { exact: true })).toHaveCount(0)
    await expect(dialog.getByTestId('add-integration-save')).toHaveText('Sign in with the server')
    await dialog.getByTestId('add-integration-save').click()
    await expect(dialog.getByTestId('add-integration-result-status')).toHaveText(/^Signed in · \d+ tools? · ~\d+ tokens$/u)
    expect(oauth.registrations).toHaveLength(1)
    expect(oauth.authorizations).toHaveLength(1)
    await dialog.getByTestId('add-integration-done').click()
    const row = settings.getByTestId('integration-row')
    await expect(row).toHaveAttribute('data-status', 'signed-in')
    // The sign-in names no account or site: the row shows where the server is.
    await expect(row.getByTestId('integration-sub')).toContainText(new URL(oauth.url).host)
    await shoot(window, settings, 'oauth-signed-in', '09')
    await settings.getByRole('button', { name: 'Close' }).click()
    await expect(settings).toHaveCount(0)

    // The running Session: the Integration is «not started» until Restart, with the same conversation, gives it.
    const chip = view.getByTestId('message-input').getByTestId('session-mcp')
    await chip.click()
    const popover = window.getByRole('dialog', { name: 'MCP servers' })
    const group = popover.getByTestId('mcp-not-started')
    await expect(group.getByRole('heading')).toHaveText('Enabled in this Project after this Session started.')
    await expect(group.locator('[data-testid="mcp-row"][data-name="tracker-a"]').getByTestId('mcp-row-name')).toHaveText('Tracker A')
    await shoot(window, popover, 'chip-not-started', '09')
    await group.getByTestId('mcp-restart').click()
    const tracker = popover.locator('[data-testid="mcp-row"][data-name="tracker-a"]')
    await expect(tracker.getByTestId('mcp-row-status')).toHaveText('connected')
    await popover.press('Escape')
    await expect(popover).toHaveCount(0)

    // The service ends every token: the next check's refresh is refused.
    oauth.expireAccessTokens()
    oauth.expireRefreshTokens()
    const again = await openIntegrations(window, 'alpha')
    const refused = again.getByTestId('integration-row')
    await expect(refused).toHaveAttribute('data-status', 'needs-sign-in')
    await expect(refused.getByTestId('integration-status')).toHaveText('Sign-in needed')
    await expect(refused.getByTestId('integration-sign-in')).toBeEnabled()
    await shoot(window, again, 'oauth-sign-in-needed', '09')
    await again.getByRole('button', { name: 'Close' }).click()
    await expect(again).toHaveCount(0)

    // The chip says so, and its Sign in is worfy's window, not Claude Code's.
    await chip.click()
    await expect(tracker.getByTestId('mcp-row-status')).toHaveText('needs auth')
    await expect(tracker.getByTestId('mcp-row-error')).toHaveText('Sign-in needed: Tracker A. Ask the user to sign in in worfy.')
    await expect(tracker.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await shoot(window, popover, 'chip-sign-in-needed', '09')
    await popover.press('Escape')

    // Settings → Health: a non-critical row of alpha with Sign in.
    await window.getByRole('navigation', { name: 'Sidebar' }).getByRole('button', { name: 'Health check', exact: true }).click()
    const settingsWindow = window.getByRole('dialog', { name: 'Settings' })
    await expect(settingsWindow.getByRole('heading', { level: 2 })).toHaveText('Health')
    const health = settingsWindow.getByTestId('settings-health').locator('[data-check="integration"]')
    await expect(health).toHaveCount(1)
    await expect(health).toContainText('Tracker A: sign-in needed')
    await expect(health).not.toHaveAttribute('data-status', 'ok')
    await expect(health.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await shoot(window, health, 'health-row', '09')
  } finally {
    await app.close()
    await oauth.close()
  }
})
