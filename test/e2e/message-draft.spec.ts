import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, newSessionOn } from './helpers'

// The draft of a chat input field (worfy-polish ticket 95) against the built app, on the fake agent
// (test/fixtures/agent-scripts/turn.jsonl): a text typed and not sent stays in the Session view's
// field across another view, another Session picked and back, and a restart of worfy over the same
// data folder; so does the text in a Session Node's field on the Canvas. Send clears the draft.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const DRAFT = 'first line of the draft\nsecond line, not sent yet'
const NODE_DRAFT = 'typed on the Canvas'

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-message-draft-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const sessionViewOf = (window: Page): Locator => window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
const tabsOf = (window: Page): Locator => window.getByRole('group', { name: 'View', exact: true })
const fieldOf = (view: Locator): Locator => view.getByRole('textbox', { name: 'Message Orchestrator' })

/** Opens the Orchestrator's Session view with a double click on its Node, once it is idle. */
async function openOrchestrator(window: Page): Promise<Locator> {
  await tabsOf(window).getByRole('button', { name: 'Canvas' }).click()
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = sessionViewOf(window)
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

/** The drafts the window keeps in its storage, by key. */
const storedDrafts = (window: Page): Promise<Record<string, string>> =>
  window.evaluate(() => {
    const storage = (globalThis as unknown as { localStorage: { length: number; key(index: number): string | null; getItem(key: string): string | null } }).localStorage
    const found: Record<string, string> = {}
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index)
      if (name?.startsWith('worfy.draft:')) found[name.slice('worfy.draft:'.length)] = storage.getItem(name) ?? ''
    }
    return found
  })

test('a draft stays across views, another Session and a restart; Send clears it (worfy-polish 95)', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' }

  const first = await launchApp({ env })
  try {
    const { window } = first
    await canvasReady(first, { size: { width: 1400, height: 900 } })
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // A second Session, and a draft in its Node's field on the Canvas.
    await newSessionOn(window)
    const live = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(live).toHaveCount(1)
    await live.getByTestId('session-node-input').fill(NODE_DRAFT)

    // A draft of several lines in the Orchestrator's field.
    const view = await openOrchestrator(window)
    const field = fieldOf(view)
    await field.fill(DRAFT)

    // Other views and back.
    const tabs = tabsOf(window)
    for (const name of ['Pipeline', 'Runs', 'Canvas']) {
      await tabs.getByRole('button', { name, exact: true }).click()
      await expect(tabs.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    await tabs.getByRole('button', { name: 'Session', exact: true }).click()
    await expect(field).toHaveValue(DRAFT)

    // Another Session in the picker — its own field, empty — and back.
    const picker = view.getByTestId('session-picker')
    await picker.click()
    const options = window.getByTestId('session-picker-list').getByRole('option')
    await expect(options).toHaveCount(2)
    await options.filter({ hasNotText: 'Orchestrator' }).click()
    await expect(view.getByRole('textbox', { name: 'Message Session' })).toHaveValue('')
    await picker.click()
    await options.filter({ hasText: 'Orchestrator' }).click()
    await expect(fieldOf(view)).toHaveValue(DRAFT)

    // The storage has both drafts before the quit.
    await expect.poll(async () => Object.values(await storedDrafts(window)).sort()).toEqual([DRAFT, NODE_DRAFT].sort())
  } finally {
    await first.close()
  }

  // worfy starts again over the same data folder: both drafts are there.
  const second = await launchApp({ env })
  try {
    const { window } = second
    await canvasReady(second, { size: { width: 1400, height: 900 } })
    await expect(window.locator('[data-testid="session-node"]').getByTestId('session-node-input')).toHaveValue(NODE_DRAFT)
    const view = await openOrchestrator(window)
    const field = fieldOf(view)
    await expect(field).toHaveValue(DRAFT)

    // Send: the message goes, the field is empty, and stays empty after another view; the draft is gone from the storage.
    await field.press('Enter')
    await expect(field).toHaveValue('')
    await expect(view.getByTestId('transcript-text').last()).toContainText('Hello from the fake agent')
    await tabsOf(window).getByRole('button', { name: 'Pipeline', exact: true }).click()
    await tabsOf(window).getByRole('button', { name: 'Session', exact: true }).click()
    await expect(field).toHaveValue('')
    await expect.poll(async () => Object.values(await storedDrafts(window))).toEqual([NODE_DRAFT])
  } finally {
    await second.close()
  }
})
