import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, showSidebarSection, type LaunchedApp } from './helpers'

// The Assistant's section against the built app (worfy-assistant ticket 14), with the fake agent of launchApp
// (WORFY_AGENT=fake) and the Assistant off, as it is until the user turns it on:
// - the rail has the Assistant's tab first, and a window that chose no section still starts on the Projects;
// - the section lists what waits — two items of one Project that the attention core keeps in the Project's
//   assistant-items.json — each with its reason, its source and its duty;
// - like on one item is pressed and stays; dislike on the other takes it off the list, leaves its card with the rule
//   that hides it, and that rule is in the Assistant's memory file (<data>/assistant/memory.json, ticket 07); Undo
//   deletes the rule and the item waits again.

let scratch: string
let dataDir: string
let claudeHome: string

const SHOP = 'shop-0000000s'
const SLACK_ITEM = 'item-slack-1'
const JIRA_ITEM = 'item-jira-1'

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** An item of the attention core in state new, as src/main/assistant/core/store.ts keeps it. */
function item(id: string, source: 'slack' | 'jira', kind: string, text: string, label: string, at: number): Record<string, unknown> {
  return {
    id,
    source,
    projectId: SHOP,
    subject: { kind: 'message', id: `${source}/${id}`, label },
    kind,
    text,
    startedAt: at,
    lastAt: at,
    updatedAt: at,
    revision: '1',
    state: 'new',
    duty: `source:${source}`,
    events: 1,
  }
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-assistant-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome, { recursive: true })
  const repo = join(scratch, 'shop')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  mkdirSync(join(dataDir, SHOP), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: SHOP, name: 'shop', path: repo }], activeId: SHOP }))
  const now = Date.now()
  writeFileSync(
    join(dataDir, SHOP, 'assistant-items.json'),
    JSON.stringify({
      since: now - 86_400_000,
      items: [
        item(SLACK_ITEM, 'slack', 'mention', 'Teammate A asks you to look at the rate-limit change', '#shop-api', now - 3_600_000),
        item(JIRA_ITEM, 'jira', 'issue-changed', 'SHOP-12 moved to In review and is assigned to you', 'SHOP-12', now - 7_200_000),
      ],
      seen: {},
      conditions: [],
    }),
  )
})

test.afterEach(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

const rail = (window: Page): Locator => window.getByRole('navigation', { name: 'Sidebar' }).getByRole('tablist', { name: 'Sidebar sections' })
const section = (window: Page): Locator => window.getByRole('region', { name: 'Assistant', exact: true })
const card = (window: Page, id: string): Locator => section(window).locator(`[data-testid="assistant-item"][data-item-id="${id}"]`)

/** The rules of the Assistant's memory file; none while it has not been written. */
function rules(): { from: string; source: string }[] {
  const file = join(dataDir, 'assistant', 'memory.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { rules: { from: string; source: string }[] }).rules : []
}

test('the Assistant section lists what waits; like stays pressed; dislike hides the item by a rule in the memory file, and Undo brings it back', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    // First on the rail, yet the window starts on the Projects.
    await expect(rail(window).getByRole('tab').first()).toHaveAttribute('aria-label', 'Assistant')
    await expect(rail(window).getByRole('tab', { name: 'Projects', exact: true })).toHaveAttribute('aria-selected', 'true')

    await showSidebarSection(window, 'Assistant')
    await expect(section(window).getByTestId('assistant-item')).toHaveCount(2)
    // Each item: its reason, its source and its duty.
    await expect(card(window, SLACK_ITEM)).toContainText('Teammate A asks you to look at the rate-limit change')
    await expect(card(window, SLACK_ITEM)).toContainText('Slack')
    await expect(card(window, JIRA_ITEM)).toContainText('SHOP-12 moved to In review')
    await expect(card(window, JIRA_ITEM)).toContainText('Jira')
    // The Assistant is off: the list shows, the box to write is disabled.
    await expect(section(window).getByPlaceholder('Assistant is off on this machine')).toBeDisabled()

    // Like: pressed, and the item stays.
    const like = card(window, JIRA_ITEM).getByRole('button', { name: 'Like', exact: true })
    await like.click()
    await expect(like).toHaveAttribute('aria-pressed', 'true')
    await expect(section(window).getByTestId('assistant-item')).toHaveCount(2)

    // Dislike: the item leaves, its card says which rule hides it, and the rule is in the memory file.
    await card(window, SLACK_ITEM).getByRole('button', { name: 'Dislike', exact: true }).click()
    await expect(card(window, SLACK_ITEM)).toHaveCount(0)
    const gone = section(window).getByTestId('assistant-gone')
    await expect(gone).toBeVisible()
    await expect(gone).toContainText('Do not show')
    await expect.poll(() => rules().map((rule) => rule.from)).toEqual([SLACK_ITEM])
    await expect(card(window, JIRA_ITEM)).toBeVisible()

    // Undo: the rule is deleted and the item waits again.
    await gone.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(card(window, SLACK_ITEM)).toBeVisible()
    await expect.poll(() => rules()).toEqual([])
  } finally {
    await launched.close()
  }
})
