import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot, showSidebarSection } from './helpers'

// The Vendor picker of "New session" and the VendorBadge (worfy-multi-vendor ticket 24), against the built
// app with both agents on their fakes: Claude Code on the fake agent, Codex on the fake app-server
// (WORFY_CODEX=fake, which every launch sets; the real Codex never starts). Signed in to Codex — the
// launch's CODEX_HOME exists and the fake plays test/fixtures/codex-scripts/account-plus.jsonl —
// "New session" lists both Vendors, the Project's "Default vendor" first; "Default vendor" is set and
// set back to none in Project settings. A pick of Codex runs a Codex Session on the fake's `turn`
// script: its Node, the Session view's header, the rail and the agent's messages name Codex. One
// script plays every process of the fake, so that launch has no account answer: the sign-in check
// fails, and a check that fails refuses nothing (src/main/agent/node-sessions.ts, signInRefusal).
// Without a CODEX_HOME nobody is signed in to Codex: it stays in the list, inactive, with the tooltip
// that says where to sign in. Screenshots of both themes go to the test's output folder; the
// ticket's evidence is copied from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SIZE = { width: 1400, height: 900 }

let scratch: string
let dataDir: string
let codexHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-vendor-picker-')))
  dataDir = join(scratch, 'data')
  codexHome = join(scratch, 'codex-home')
  const projectPath = join(scratch, 'alpha')
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const picker = (window: Page): Locator => window.getByRole('menu', { name: 'New session on' })
const option = (window: Page, vendor: string): Locator => picker(window).locator(`[data-testid="new-session-vendor-option"][data-vendor="${vendor}"]`)
const order = (window: Page): Promise<(string | null)[]> =>
  picker(window)
    .getByTestId('new-session-vendor-option')
    .evaluateAll((rows) => rows.map((row) => (row as unknown as { getAttribute(name: string): string | null }).getAttribute('data-vendor')))

/** Opens "Project settings…" of the Project, picks `label` for "Default vendor" and saves. */
async function chooseDefaultVendor(window: Page, label: string): Promise<void> {
  await showSidebarSection(window, 'Projects')
  await window.getByTestId('project-row').filter({ hasText: 'alpha' }).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Project settings…' }).click()
  const dialog = window.getByRole('dialog', { name: 'Project settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('project-settings-vendor').click()
  await window.getByRole('option', { name: label, exact: true }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
}

/** The window in both themes, for the ticket's evidence and the review. */
async function screenshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('signed in to Codex: the picker lists both Vendors, the Default vendor of Project settings first; "None" sets it back', async () => {
  mkdirSync(codexHome)
  const launched = await launchApp({
    env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'account-plus', WORFY_CODEX_SCRIPTS: join(repoRoot, 'test', 'fixtures', 'codex-scripts') },
  })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // No Default vendor: Claude Code first, marked default; Codex can start.
    await showSidebarSection(window, 'Sessions')
    await window.getByTestId('sidebar-new-session').click()
    await expect(option(window, 'codex')).toBeVisible()
    expect(await order(window)).toEqual(['claude', 'codex'])
    await expect(option(window, 'claude')).toContainText('default')
    await expect(option(window, 'codex')).not.toHaveAttribute('aria-disabled', 'true')
    await window.keyboard.press('Escape')
    await expect(picker(window)).toHaveCount(0)

    // Default vendor: Codex in Project settings — it comes first in the picker, marked default.
    await chooseDefaultVendor(window, 'Codex')
    expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'settings.json'), 'utf8'))).toMatchObject({ defaultVendor: 'codex' })
    await showSidebarSection(window, 'Sessions')
    await window.getByTestId('sidebar-new-session').click()
    await expect(option(window, 'codex')).toContainText('default')
    expect(await order(window)).toEqual(['codex', 'claude'])
    await screenshots(window, 'vendor-picker')

    await window.keyboard.press('Escape')

    // "None" in Project settings clears the Default vendor: Claude Code is first again.
    await chooseDefaultVendor(window, 'None (Claude Code)')
    expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'settings.json'), 'utf8'))).not.toHaveProperty('defaultVendor')
    await showSidebarSection(window, 'Sessions')
    await window.getByTestId('sidebar-new-session').click()
    await expect(option(window, 'claude')).toContainText('default')
    expect(await order(window)).toEqual(['claude', 'codex'])
    await window.keyboard.press('Escape')
  } finally {
    await launched.close()
  }
})

test('a pick of Codex runs a Codex Session: its Node, the Session view and the agent\'s messages name Codex', async () => {
  mkdirSync(codexHome)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    await showSidebarSection(window, 'Sessions')
    await window.getByTestId('sidebar-new-session').click()
    await option(window, 'codex').click()
    const live = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(live).toHaveCount(1)
    await expect(live.getByTestId('session-node-status')).toHaveText('idle')
    // The Node carries the Codex badge: the OpenAI logo in the text colour and the text (owner, 2026-11-03).
    const badge = live.getByTestId('session-node-vendor')
    await expect(badge).toHaveAttribute('data-vendor', 'codex')
    await expect(badge).toHaveText('Codex')
    await expect(badge.getByTestId('vendor-badge-icon')).toBeVisible()
    await expect(badge.getByTestId('vendor-badge-icon')).toHaveAttribute('fill', 'currentColor')
    await expect(badge.locator('path')).toHaveAttribute('d', /^M22\.2819 9\.8211/)
    // The Vendor is saved in the Node's data (identifiers only, ADR-0010); the Layout is written a moment later.
    const nodeId = (await live.getAttribute('data-node-id')) ?? ''
    const savedData = (): unknown => {
      try {
        const saved = JSON.parse(readFileSync(join(dataDir, PROJECT, 'layout.json'), 'utf8')) as { nodes: { id: string; data: Record<string, unknown> }[] }
        return saved.nodes.find((node) => node.id === nodeId)?.data
      } catch {
        return undefined
      }
    }
    await expect.poll(savedData).toMatchObject({ origin: 'worfy', vendor: 'codex' })
    await live.getByTestId('session-node-input').fill('hi')
    await live.getByTestId('session-node-input').press('Enter')
    await expect(live.getByTestId('session-node-answer')).toContainText('Hello')
    await canvasReady(launched)
    await screenshots(window, 'vendor-node')

    // The Session view: the badge after the title, the rail's Vendor block, and «codex» on the agent's answer.
    await live.getByTestId('session-node-title').dblclick()
    const view = window.getByTestId('session-view')
    await expect(view.getByTestId('session-vendor')).toHaveText('Codex')
    await expect(view.getByTestId('vendor-rail-badge')).toHaveText('Codex')
    await expect(view.getByTestId('transcript-text').first()).toContainText('codex')
    await screenshots(window, 'vendor-session-view')
  } finally {
    await launched.close()
  }
})

test('Project settings: "Default vendor" says the Orchestrator runs on it from its next start (worfy-multi-vendor ticket 37)', async () => {
  mkdirSync(codexHome)
  const launched = await launchApp({
    env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'account-plus', WORFY_CODEX_SCRIPTS: join(repoRoot, 'test', 'fixtures', 'codex-scripts') },
  })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    await showSidebarSection(window, 'Projects')
    await window.getByTestId('project-row').filter({ hasText: 'alpha' }).click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Project settings…' }).click()
    const dialog = window.getByRole('dialog', { name: 'Project settings' })
    await dialog.getByTestId('project-settings-vendor').click()
    await window.getByRole('option', { name: 'Codex', exact: true }).click()
    await expect(dialog).toContainText('The Orchestrator runs on it from its next start: New Orchestrator Session, or the next start of worfy.')
    // The dialog alone: the sidebar behind it shows the launch's temporary folders.
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await dialog.screenshot({ path: test.info().outputPath(`orchestrator-vendor-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('not signed in to Codex: Codex stays in the picker, inactive, with the tooltip that says where to sign in', async () => {
  // No CODEX_HOME: Codex was never signed in to, and nothing of it starts.
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    await showSidebarSection(window, 'Sessions')
    await window.getByTestId('sidebar-new-session').click()
    const codex = option(window, 'codex')
    await expect(codex).toHaveAttribute('aria-disabled', 'true')
    await expect(codex).toHaveAttribute('title', 'Sign in to Codex in Settings → Vendors')
    // Playwright waits for an aria-disabled button to become enabled; the click is forced, as a person's would land.
    await codex.click({ force: true })
    await expect(window.locator('[data-testid="session-node"][data-live="true"]')).toHaveCount(0)
    await expect(picker(window)).toBeVisible()
    await screenshots(window, 'vendor-picker-signed-out')

    // Claude Code starts as before, and its Node says so.
    await option(window, 'claude').click()
    const live = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(live).toHaveCount(1)
    await expect(live.getByTestId('session-node-vendor')).toHaveAttribute('data-vendor', 'claude')
    await expect(live.getByTestId('session-node-vendor')).toHaveText('Claude')
  } finally {
    await launched.close()
  }
})
