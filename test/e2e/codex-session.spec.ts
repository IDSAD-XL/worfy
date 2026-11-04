import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// The pickers, the permission dialog and the slash menu of a Codex Session read its Vendor's
// capabilities (worfy-multi-vendor ticket 25), against the built app with Codex on the fake app-server
// (WORFY_CODEX=fake, which every launch sets; the real Codex never starts). The fake plays
// test/fixtures/codex-scripts/session-controls.jsonl: a thread, the skills of `skills/list`, then a turn
// whose command asks for approval. The permission picker lists Codex's three presets and the pick goes
// to the next `turn/start`; the slash menu lists the scenario's skills and the commands the app-server
// runs, with the line that says the list is not complete; the approval shows the command, its folder
// and Codex's four answers, and the one picked reaches the fake (WORFY_CODEX_LOG keeps what worfy sent
// it). Screenshots of both themes go to the test's output folder; the ticket's evidence is copied
// from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SIZE = { width: 1400, height: 900 }

let scratch: string
let dataDir: string
let codexHome: string
let codexLog: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-codex-session-')))
  dataDir = join(scratch, 'data')
  codexHome = join(scratch, 'codex-home')
  codexLog = join(scratch, 'codex-log.jsonl')
  const projectPath = join(scratch, 'alpha')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** What worfy sent the fake, in order: every process of the fake appends to one log. */
function sent(): { method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> }[] {
  if (!existsSync(codexLog)) return []
  return readFileSync(codexLog, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> })
}

/** The Session view in both themes, for the ticket's evidence and the review: the sidebar would show the machine's temporary folder. */
async function screenshots(window: Page, name: string, view: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await view.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('a Codex Session: its presets, its slash menu and its approval with four answers, the answer reaching Codex', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'session-controls', WORFY_CODEX_LOG: codexLog } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    await window.getByTestId('sidebar-new-session').click()
    await window.getByRole('menu', { name: 'New session on' }).locator('[data-testid="new-session-vendor-option"][data-vendor="codex"]').click()
    const live = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(live).toHaveCount(1)
    await expect(live.getByTestId('session-node-status')).toHaveText('idle')
    await live.getByTestId('session-node-title').dblclick()
    const view = window.getByTestId('session-view')
    await expect(view.getByTestId('session-vendor')).toHaveText('Codex')

    // The permission picker: Codex's presets in its words. A new Session starts on "Full access", the
    // preset that stands for the default bypassPermissions.
    const mode = view.getByTestId('picker-permissions')
    await expect(mode).toBeEnabled()
    await expect(mode).toHaveAttribute('data-value', 'full-access')
    await expect(mode).toContainText('Full access')
    await mode.click()
    const list = window.getByTestId('picker-permissions-list')
    await expect(list.getByRole('option')).toHaveText(['Read only', 'Auto', 'Full access'])
    await expect(list.getByRole('option', { name: 'Auto' })).toHaveAttribute('title', /project folder/)
    await screenshots(window, 'codex-presets', view)
    await list.getByRole('option', { name: 'Auto' }).click()
    await expect(mode).toHaveAttribute('data-value', 'auto')
    await expect(mode).toContainText('Auto')

    // The slash menu: the commands the app-server runs and the scenario's enabled skills, and the line
    // that says Codex's own terminal has more.
    const field = view.getByTestId('message-input').getByRole('textbox')
    await field.fill('/')
    const menu = view.getByTestId('slash-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByTestId('slash-item')).toHaveCount(4)
    expect(await menu.getByTestId('slash-item').evaluateAll((rows) => rows.map((row) => (row as unknown as { getAttribute(name: string): string | null }).getAttribute('data-name')))).toEqual([
      'compact',
      'review',
      'release-notes',
      'triage',
    ])
    await expect(menu.locator('[data-testid="slash-item"][data-name="release-notes"]')).toContainText('skill')
    await expect(menu.getByTestId('slash-incomplete')).toHaveAttribute('title', /only in its own terminal/)
    await screenshots(window, 'codex-slash-menu', view)
    await field.press('Escape')
    await field.fill('')

    // A turn whose command asks for approval: the turn runs on the picked preset, and the card shows the
    // command, its folder and Codex's four answers.
    await field.fill('run the tests')
    await field.press('Enter')
    const card = view.getByTestId('permission-card')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('permission-tool')).toHaveText('pnpm test')
    await expect(card.getByTestId('permission-input')).toHaveText('pnpm test')
    await expect(card.getByTestId('permission-cwd')).toHaveText('in /fake/project')
    await expect(card.getByRole('button')).toHaveText(['Accept', 'Accept for this Session', 'Decline', 'Decline and stop the turn'])
    const turn = sent().find((message) => message.method === 'turn/start')
    expect(turn?.params).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } })
    await screenshots(window, 'codex-approval', view)

    await card.locator('[data-option-id="accept"]').click()
    await expect(card).toHaveAttribute('data-resolution', 'accept')
    await expect(card.getByTestId('permission-resolution')).toHaveText('Allowed')
    await expect.poll(() => sent().some((message) => message.result?.['decision'] === 'accept')).toBe(true)
    await expect(view.getByTestId('transcript-text').last()).toContainText('Ran the tests.')
  } finally {
    await launched.close()
  }
})

// worfy-polish 52: a thread that names no model (thread/start answers an empty one) on Default model and
// effort. The header names the model the turn runs on, Codex's default of `model/list`, and the
// effort that model runs at, marked as the default; the tooltip speaks of Codex, not Claude Code.
// The fake plays test/fixtures/codex-scripts/default-model.jsonl.
test('a Codex Session on Default: the header names the default model and its default effort', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'turn', CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'default-model', WORFY_CODEX_LOG: codexLog } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    await window.getByTestId('sidebar-new-session').click()
    await window.getByRole('menu', { name: 'New session on' }).locator('[data-testid="new-session-vendor-option"][data-vendor="codex"]').click()
    const live = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(live).toHaveCount(1)
    await expect(live.getByTestId('session-node-status')).toHaveText('idle')
    await live.getByTestId('session-node-title').dblclick()
    const view = window.getByTestId('session-view')
    await expect(view.getByTestId('session-vendor')).toHaveText('Codex')
    const effort = view.getByTestId('session-effort')
    await expect(effort).toHaveText('medium')
    await expect(effort).toHaveAttribute('data-default', 'true')
    await expect(effort.locator('..')).toHaveAttribute('title', /Codex runs the model's default level/)

    const field = view.getByTestId('message-input').getByRole('textbox')
    await field.fill('hi')
    await field.press('Enter')
    await expect(view.getByTestId('session-model')).toHaveText('gpt-5.5-codex')
    await expect(effort).toHaveText('medium')
    await expect(effort).toHaveAttribute('data-default', 'true')
    expect(sent().filter((message) => message.method === 'turn/start').map((message) => message.params?.['model'])).toEqual([undefined])
    await screenshots(window, 'codex-default-header', view.locator('.w-session__header'))

    // At the default window, 1280 px (src/shared/window/bounds.ts), the model's name gives way but keeps
    // some room: a mark such as « (default)» in the effort's text took all of it, and the cell read empty.
    await launched.app.evaluate(({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows()
      win?.setContentSize(1280, win.getContentSize()[1] ?? 800)
    })
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(1280)
    await expect.poll(() => view.getByTestId('session-model').evaluate((element) => element.clientWidth)).toBeGreaterThan(20)
  } finally {
    await launched.close()
  }
})
