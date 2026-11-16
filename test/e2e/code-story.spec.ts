import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Story } from '../../src/shared/stories/schema'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// The Story view (worfy-code-stories ticket 09) in the built app, on the story of the fixture Epic of ticket 01
// (test/fixtures/code-story-answers/epic-ru.json, the answer of harness/bin/tests/fixtures/code-story/epic-ru.md).
// The entries into the view come with ticket 10 and the reader of story files with ticket 08, so the test opens it
// through the page's `__worfyStory` (src/renderer/stories/open.ts), which an init script defines before the app's
// scripts run; the view shows the story's own code. It turns the screens with the keyboard and the mouse, takes the
// look in both themes for the review — a code step wide, the step "Seams between tickets", a code step narrow —
// and goes back to the Canvas with Esc.
//
// The entries into the view (ticket 10) run on a Project of their own: a git repository with the fixture Epic
// `demo-cart` whose PR story of Ticket 04 is committed, `epic-status` a script under the temporary Claude home that
// prints a fixed answer, and gh the stub of launchApp over a graphql.json with the PR of Ticket 04. The Epic's
// story.md is committed while the app runs: the toast comes, and the view opens from it, from the Epic frame, from the
// Epic's "⋯", from the Ticket card, from the Command palette and from Pull requests; Esc goes back to the Canvas each
// time. The fake agent (WORFY_AGENT=fake, as every e2e run) is never asked: opening a story reads files only.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const PROJECT = 'demo-cart-0000000c'
const EPIC = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'code-story-answers', 'epic-ru.json'), 'utf8')) as Record<string, unknown>
const STORY = { kind: 'epic', header: { epic: 'demo-cart', language: 'ru' }, ...EPIC } as unknown as Story

let scratch: string
test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-code-story-')))
})
test.afterEach(async () => {
  await removeDir(scratch)
})

/** A data folder with one Project, the active one. */
function prepare(): Record<string, string> {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const projectPath = join(scratch, 'demo-cart')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo-cart', path: projectPath }], activeId: PROJECT }))
  return { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome }
}

/** Defines the page's hook before the app's scripts run, loads the window again, and waits for the shell. */
async function withStoryHook(launched: LaunchedApp): Promise<void> {
  await launched.app.context().addInitScript(() => {
    ;(globalThis as unknown as { __worfyStory: object }).__worfyStory = {}
  })
  await launched.window.reload()
  await expect(launched.window.getByTestId('app-shell')).toBeVisible()
  await expect.poll(() => launched.window.evaluate(() => typeof (globalThis as unknown as { __worfyStory?: { open?: unknown } }).__worfyStory?.open)).toBe('function')
}

const openStory = (window: Page, story: Story) =>
  window.evaluate(([project, shown]) => (globalThis as unknown as { __worfyStory: { open: (p: string, s: unknown) => void } }).__worfyStory.open(project, shown), [PROJECT, story] as const)

test('the Story view on the fixture Epic: chapters, segments, keys and halves, the code, the seams diagram, a narrow window; Esc back to the Canvas', async () => {
  test.setTimeout(ms(120_000))
  const launched = await launchApp({ env: prepare() })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900))
    await withStoryHook(launched)
    await openStory(window, STORY)

    const view = window.getByTestId('story-view')
    await expect(view).toBeVisible()
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeHidden()
    await expect(view).toBeFocused()
    await expect(view.getByTestId('story-chapter')).toHaveCount(9)
    await expect(view.getByTestId('story-segment')).toHaveCount(11)
    await expect(view.getByTestId('story-position')).toHaveText('1 of 11')
    await expect(view.getByTestId('story-screen')).toHaveAttribute('data-kind', 'start')

    // → goes on; the first segment is then marked as seen.
    await window.keyboard.press('ArrowRight')
    await expect(view.getByTestId('story-position')).toHaveText('2 of 11')
    await expect(view.getByTestId('story-segment').first()).toHaveAttribute('data-state', 'read')
    await expect(view.getByRole('heading', { level: 2 })).toHaveText('Цена, набранная человеком, становится целыми центами')
    const code = view.getByTestId('md-story-code')
    await expect(code.locator('[data-line]')).toHaveCount(7)
    await expect(code.locator('[data-line="6"]')).toBeVisible()
    await expect(code.locator('[data-key="true"]')).toHaveCount(2)
    // Wide: the code on the left of the text.
    await expect(view).toHaveAttribute('data-layout', 'wide')
    const codeBox = await view.getByTestId('story-code-column').boundingBox()
    const textBox = await view.getByTestId('story-text-column').boundingBox()
    expect(codeBox!.x + codeBox!.width).toBeLessThanOrEqual(textBox!.x)
    await snapshotThemes(window, 'code-story-code-step')

    // A click on the right half goes on, on the left half back; ← back too.
    const stage = view.getByTestId('story-stage')
    const stageBox = (await stage.boundingBox())!
    await window.mouse.click(stageBox.x + stageBox.width - 120, stageBox.y + stageBox.height - 40)
    await expect(view.getByTestId('story-position')).toHaveText('3 of 11')
    await window.mouse.click(stageBox.x + 120, stageBox.y + stageBox.height - 40)
    await expect(view.getByTestId('story-position')).toHaveText('2 of 11')
    await window.keyboard.press('ArrowLeft')
    await expect(view.getByTestId('story-position')).toHaveText('1 of 11')

    // The step "Seams between tickets": its diagram, the dropped handoff dashed.
    await view.locator('[data-testid="story-chapter"][data-chapter="seams"]').click()
    await expect(view.getByTestId('story-screen')).toHaveAttribute('data-kind', 'seams')
    const diagram = view.getByTestId('story-seams-diagram')
    await expect(diagram.getByTestId('story-seams-ticket')).toHaveCount(3)
    await expect(diagram.locator('[data-testid="story-seams-arrow"][data-done="no"]')).toHaveAttribute('stroke-dasharray', '6 4')
    await snapshotThemes(window, 'code-story-seams')

    // A narrow window: one column, the text over the code.
    await view.locator('[data-testid="story-chapter"][data-chapter="ticket-04"]').click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(820, 900))
    await expect(view).toHaveAttribute('data-layout', 'narrow')
    const narrowText = await view.getByTestId('story-text-column').boundingBox()
    const narrowCode = await view.getByTestId('story-code-column').boundingBox()
    expect(narrowText!.y + narrowText!.height).toBeLessThanOrEqual(narrowCode!.y)
    // The code follows the text closely: the rows are as tall as their content, not stretched over the screen.
    const panel = await view.getByTestId('story-field-panel').boundingBox()
    expect(narrowCode!.y - (panel!.y + panel!.height)).toBeLessThan(60)
    await snapshotThemes(window, 'code-story-narrow')

    await window.keyboard.press('Escape')
    await expect(view).toBeHidden()
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
  } finally {
    await launched.close()
  }
})

const STORY_FIXTURES = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')
const ENTRIES_PROJECT = 'demo-cart-0000010e'
const CART_REPO = 'example-org/demo-cart'

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** Tickets 04 (in work, its PR #212 has its story), 05 and 06 (open) of the fixture Epic demo-cart. */
const CART_TICKETS = [
  { num: 4, slug: 'cart-total', status: 'claimed — 2026-11-10', state: 'work', pr: 212 },
  { num: 5, slug: 'coupon', status: 'open', state: 'open', pr: null },
  { num: 6, slug: 'receipt', status: 'open', state: 'open', pr: null },
] as const
const nn = (num: number): string => String(num).padStart(2, '0')

/**
 * The Project of the entries: the repository with Epic demo-cart and the story of Ticket 04's PR, committed on main; the
 * Claude home whose epic-status prints the Epic; gh's PR #212 of branch demo-cart/04; the Canvas at a zoom that shows
 * the frame and its cards. Returns the environment of the app and the repository.
 */
function prepareEntries(): { env: Record<string, string>; repo: string } {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const ghDir = join(scratch, 'gh')
  const repo = join(scratch, 'demo-cart')
  const epic = join(repo, '.scratch', 'demo-cart')
  mkdirSync(join(epic, 'issues'), { recursive: true })
  mkdirSync(join(epic, 'stories'), { recursive: true })
  writeFileSync(join(epic, 'spec.md'), '# Demo cart\n')
  for (const ticket of CART_TICKETS) {
    const lines = [`# ${nn(ticket.num)} — Ticket ${ticket.num}`, '', 'Type: task', `Status: ${ticket.status}`, 'Blocked by: —', ...(ticket.pr === null ? [] : [`PR: #${ticket.pr}`]), '']
    writeFileSync(join(epic, 'issues', `${nn(ticket.num)}-${ticket.slug}.md`), lines.join('\n'))
  }
  copyFileSync(join(STORY_FIXTURES, 'pr-en.md'), join(epic, 'stories', '04-cart-total.md'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', `https://github.com/${CART_REPO}.git`)

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: 'demo-cart', hasSpec: true, hasMap: false }],
      tickets: CART_TICKETS.map((ticket) => ({
        epic: 'demo-cart',
        num: ticket.num,
        slug: ticket.slug,
        title: `${nn(ticket.num)} — Ticket ${ticket.num}`,
        statusRaw: ticket.status,
        state: ticket.state,
        blockedRaw: '—',
        blockedNums: [],
        blockedParsed: true,
        ...(ticket.pr === null ? {} : { pr: ticket.pr }),
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(ghDir, { recursive: true })
  const at = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  const pull = {
    title: 'Cart total in cents',
    url: `https://github.com/${CART_REPO}/pull/212`,
    state: 'OPEN',
    isDraft: false,
    createdAt: at(30),
    author: { login: 'dev-me' },
    headRefName: 'demo-cart/04',
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    additions: 40,
    deletions: 6,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
  }
  writeFileSync(join(ghDir, 'graphql.json'), JSON.stringify({ viewer: 'dev-me', pulls: [{ repo: CART_REPO, number: 212, updatedAt: at(1), headRefOid: 'sha212', reviewRequested: false, involves: true, pull }] }))

  mkdirSync(join(dataDir, ENTRIES_PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: ENTRIES_PROJECT, name: 'demo-cart', path: repo }], activeId: ENTRIES_PROJECT }))
  writeFileSync(join(dataDir, ENTRIES_PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.7 } }))
  return { env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, GH_STUB_DIR: ghDir }, repo }
}

/** The Story view is on screen with a story of `kind`, then Esc takes the window back to the Canvas. */
async function seenThenEsc(window: Page, kind: 'epic' | 'pr'): Promise<void> {
  const view = window.getByTestId('story-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('story-screen')).toHaveAttribute('data-kind', kind === 'epic' ? 'start' : 'step')
  await expect(view.getByTestId('story-chapter')).toHaveCount(kind === 'epic' ? 9 : 0)
  await window.keyboard.press('Escape')
  await expect(view).toBeHidden()
  await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
}

test('the entries into the Story view: the toast once its story.md comes, the Epic frame, its "⋯", the Ticket card, the Command palette and Pull requests; Esc back to the Canvas each time', async () => {
  test.setTimeout(ms(150_000))
  const { env, repo } = prepareEntries()
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="demo-cart"]')
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame] })

    // No story.md yet: "Story" on the frame is inactive and says why; no toast for what the Project already had.
    const epicStory = frame.getByTestId('action-epic-story')
    await expect(epicStory).toHaveAttribute('aria-disabled', 'true', { timeout: ms(15_000) })
    await expect(epicStory).toHaveAttribute('title', 'No Code story of demo-cart yet: it is written when the last PR of the Epic is merged')
    await expect(window.getByTestId('story-ready-toast')).toHaveCount(0)

    // The Epic's story comes: one toast, and "Open" opens it.
    copyFileSync(join(STORY_FIXTURES, 'epic-ru.md'), join(repo, '.scratch', 'demo-cart', 'story.md'))
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'the story of the Epic')
    const toast = window.getByTestId('story-ready-toast')
    await expect(toast).toBeVisible({ timeout: ms(20_000) })
    await expect(toast).toContainText('The Code story of Epic demo-cart is ready')
    await expect(epicStory).toHaveAttribute('aria-disabled', 'false')
    await snapshotThemes(window, 'code-story-entries-toast')
    await toast.getByRole('button', { name: 'Open' }).click()
    await seenThenEsc(window, 'epic')

    // The Epic frame.
    await epicStory.click()
    await seenThenEsc(window, 'epic')

    // The Epic's "⋯".
    await frame.getByTestId('action-autopilot-more').click()
    await window.getByRole('menuitem', { name: 'Code story' }).click()
    await seenThenEsc(window, 'epic')

    // The Ticket card: Ticket 04 has the story of its PR.
    const ticketStory = window.locator('[data-testid="ticket-node"][data-ticket="4"]').getByTestId('action-ticket-story')
    await expect(ticketStory).toHaveAttribute('aria-disabled', 'false')
    await ticketStory.click()
    await seenThenEsc(window, 'pr')

    // The Command palette.
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('code story demo-cart/04')
    await expect(window.locator('[data-testid="palette-option"][data-command="code-story:demo-cart/04"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    await seenThenEsc(window, 'pr')

    // Pull requests: the PR of Ticket 04 has "Code story" beside "Open on GitHub".
    const views = window.getByRole('group', { name: 'View', exact: true })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    const row = window.locator(`[data-testid="pr-inbox-row"][data-repo="${CART_REPO}"][data-number="212"]`)
    await expect(row).toBeVisible({ timeout: ms(40_000) })
    await row.getByRole('button').first().click()
    const codeStory = window.getByTestId('pr-inbox-pane').getByTestId('pr-inbox-code-story')
    await expect(codeStory).toBeVisible()
    await snapshotThemes(window, 'code-story-entries-pr')
    await codeStory.click()
    await seenThenEsc(window, 'pr')
    // No second toast for the Epic after every read of it: "Open" closed the one it had.
    await expect(window.getByTestId('story-ready-toast')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
