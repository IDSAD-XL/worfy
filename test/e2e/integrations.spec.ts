import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** The section in both themes, as <test output>/integrations/<name>-<scheme>.png, copied to the evidence folder. */
async function shoot(window: Page, section: Locator, name: string): Promise<void> {
  const folder = join(test.info().project.outputDir, 'snapshots', 'integrations')
  mkdirSync(folder, { recursive: true })
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const path = join(folder, `${name}-${scheme}.png`)
      await section.screenshot({ path, animations: 'disabled', style: VIBRANCY_BACKDROP })
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(path, join(EVIDENCE_DIR, `08-${name}-${scheme}.png`))
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
