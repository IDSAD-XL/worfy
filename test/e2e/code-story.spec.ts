import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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
//
// A question about a line (ticket 12): lines selected in the code of a step open the question field after them; the
// fake agent (test/fixtures/agent-scripts/story-answer.jsonl) holds the answer until the test lets it go, so the
// progress bar shows in the field's place; the answer then shows after the same line, with its source and the line it
// quotes, no Session Node is drawn, and the answer is there again after worfy starts anew.

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

    // No story.md yet: "Code story" on the frame builds the story so far (ticket 11, the test below); no toast for what
    // the Project already had.
    const epicStory = frame.getByTestId('action-epic-story')
    await expect(epicStory).toHaveAttribute('title', 'Build the Code story of demo-cart so far, from the stories of its merged PRs', { timeout: ms(15_000) })
    await expect(window.getByTestId('story-ready-toast')).toHaveCount(0)

    // The Epic's story comes: one toast, and "Open" opens it.
    copyFileSync(join(STORY_FIXTURES, 'epic-ru.md'), join(repo, '.scratch', 'demo-cart', 'story.md'))
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'the story of the Epic')
    const toast = window.getByTestId('story-ready-toast')
    await expect(toast).toBeVisible({ timeout: ms(20_000) })
    await expect(toast).toContainText('The Code story of Epic demo-cart is ready')
    await expect(epicStory).toHaveAttribute('title', 'Open the Code story of demo-cart')
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

test('a question about a line of a step: the field, the progress bar, the answer after the line; no Session Node; the answer after a restart', async () => {
  test.setTimeout(ms(180_000))
  const env = prepare()
  // The Project is a git repository: the lines an answer quotes are kept as links path:line@<its HEAD>.
  const projectPath = join(scratch, 'demo-cart')
  mkdirSync(join(projectPath, 'src'), { recursive: true })
  writeFileSync(join(projectPath, 'src', 'money.ts'), 'export type Cents = number\n')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=worfy e2e', '-c', 'user.email=worfy-e2e', '-c', 'commit.gpgsign=false', ...args], { cwd: projectPath, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  const head = git('rev-parse', 'HEAD').trim()
  const log = join(scratch, 'agent.log')
  const launchEnv = { ...env, WORFY_AGENT_LOG: log }

  const toStep = async (window: Page) => {
    await openStory(window, STORY)
    const view = window.getByTestId('story-view')
    await expect(view).toBeVisible()
    await window.keyboard.press('ArrowRight')
    await expect(view.getByTestId('story-position')).toHaveText('2 of 11')
    return view
  }

  let launched = await launchApp({ env: launchEnv })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900))
    await withStoryHook(launched)
    const view = await toStep(window)

    // Select line 7 with the mouse: the field opens after it.
    const line = view.locator('[data-line="7"] .w-md__story-text')
    await line.selectText()
    await line.dispatchEvent('mouseup')
    await expect(view.locator('[data-line="7"]')).toHaveAttribute('data-selected', 'true')
    const field = view.getByRole('textbox', { name: 'Вопрос о строке 7' })
    await expect(field).toBeFocused()
    await field.fill('Почему цена с тремя цифрами после точки — ошибка?')
    await view.getByRole('button', { name: 'Спросить', exact: true }).click()

    // The agent holds its answer: the progress bar stands in the field's place, with its lines.
    const progress = view.getByTestId('line-question-progress')
    await expect(progress).toHaveAttribute('data-state', 'running')
    await expect(progress.getByRole('progressbar')).toBeVisible()
    await expect(field).toBeHidden()
    await snapshotThemes(window, 'code-story-line-question-progress')
    // The request has reached the fake agent before its answer is let through.
    await expect.poll(() => existsSync(log) && readFileSync(log, 'utf8').includes('Почему цена с тремя цифрами'), { timeout: ms(30_000) }).toBe(true)
    await app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('story-answer'))

    const answer = view.getByTestId('line-answer')
    await expect(answer).toBeVisible()
    await expect(answer).toHaveAttribute('data-source', 'code')
    await expect(answer).toContainText('регулярное выражение принимает только такие строки')
    await expect(answer).toContainText('src/money.ts:7')
    await expect(progress).toBeHidden()
    // After line 7, before line 8.
    const [line7, shown, line8] = await Promise.all([view.locator('[data-line="7"]').boundingBox(), answer.boundingBox(), view.locator('[data-line="8"]').boundingBox()])
    expect(shown!.y).toBeGreaterThanOrEqual(line7!.y + line7!.height - 1)
    expect(line8!.y).toBeGreaterThanOrEqual(shown!.y + shown!.height - 1)
    await snapshotThemes(window, 'code-story-line-answer')

    // The question went to the invisible agent with the selected line and the question.
    const asked = readFileSync(log, 'utf8')
    expect(asked).toContain('Почему цена с тремя цифрами после точки')
    expect(asked).toContain('src/money.ts, line 7, step 1')

    // No Session Node: the Canvas behind the view has none.
    await window.keyboard.press('Escape')
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
    await expect(window.getByTestId('session-node')).toHaveCount(0)
  } finally {
    await launched.close()
  }

  // The answer is kept in worfy's data folder, not in the Project, and shows again after a restart.
  const kept = readFileSync(join(env.WORFY_DATA_DIR ?? '', PROJECT, 'stories.json'), 'utf8')
  expect(kept).toContain(`src/money.ts:7@${head}`)
  expect(existsSync(join(projectPath, 'stories.json'))).toBe(false)
  expect(git('status', '--porcelain')).toBe('')
  launched = await launchApp({ env: launchEnv })
  try {
    await withStoryHook(launched)
    const view = await toStep(launched.window)
    await expect(view.getByTestId('line-answer')).toContainText('регулярное выражение принимает только такие строки')
  } finally {
    await launched.close()
  }
})

test('"Check yourself" and the read marks: the answer hidden until answered, a link to its step; marks and answers after a restart, the repository unchanged', async () => {
  test.setTimeout(ms(180_000))
  const env = prepare()
  // The Project is a git repository: nothing of the reading may change it.
  const projectPath = join(scratch, 'demo-cart')
  writeFileSync(join(projectPath, 'README.md'), 'demo-cart\n')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=worfy e2e', '-c', 'user.email=worfy-e2e', '-c', 'commit.gpgsign=false', ...args], { cwd: projectPath, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  const kept = join(env.WORFY_DATA_DIR ?? '', PROJECT, 'stories.json')
  const keptText = () => (existsSync(kept) ? readFileSync(kept, 'utf8') : '')
  /** The read marks kept for any story, as `<ticket>/<step>` or the screen's name. */
  const keptMarks = (): string[] => {
    const read = (JSON.parse(keptText() || '{}') as { read?: Record<string, { ticket?: string | null; step?: number; screen?: string }[]> }).read ?? {}
    return Object.values(read)
      .flat()
      .map((mark) => mark.screen ?? `${String(mark.ticket)}/${String(mark.step)}`)
  }
  const open = async (window: Page) => {
    await openStory(window, STORY)
    const view = window.getByTestId('story-view')
    await expect(view).toBeVisible()
    return view
  }

  let launched = await launchApp({ env })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900))
    await withStoryHook(launched)
    const view = await open(window)
    // Start and the two steps of Ticket 03 are read.
    await window.keyboard.press('ArrowRight')
    await window.keyboard.press('ArrowRight')
    await expect(view.getByTestId('story-position')).toHaveText('3 of 11')

    // The last screen: the questions, no right answer yet.
    await view.getByTestId('story-segment').nth(10).click()
    await expect(view.getByTestId('story-screen')).toHaveAttribute('data-kind', 'check-yourself')
    const first = view.getByTestId('self-check-question').first()
    await expect(view.getByTestId('self-check-question')).toHaveCount(2)
    await expect(view.getByTestId('self-check-answer')).toHaveCount(0)
    await expect(view).not.toContainText('возвращает меньшее из скидки')
    await snapshotThemes(window, 'code-story-self-check')

    // An answer in the person's words: the right one shows, with its lines.
    const field = first.getByRole('textbox', { name: 'Ваш ответ на вопрос 1' })
    await field.click()
    await expect(field).toBeFocused()
    await field.fill('Скидка не больше итога.')
    await first.getByRole('button', { name: 'Проверить', exact: true }).click()
    const answer = first.getByTestId('self-check-answer')
    await expect(answer).toBeVisible()
    await expect(answer).toContainText('возвращает меньшее из скидки')
    await expect(answer).toBeFocused()
    await expect(first.getByTestId('self-check-mine')).toContainText('Скидка не больше итога.')
    await snapshotThemes(window, 'code-story-self-check-answer')
    await expect.poll(keptText, { timeout: ms(10_000) }).toContain('Скидка не больше итога.')

    // A line of the answer opens the step that shows it: the first step of Ticket 05.
    await answer.getByRole('button', { name: 'src/coupon.ts:14' }).click()
    await expect(view.getByTestId('story-position')).toHaveText('5 of 11')
    await expect(view.getByTestId('story-code').first()).toHaveAttribute('data-path', 'src/coupon.ts')
    await expect.poll(keptMarks, { timeout: ms(10_000) }).toContain('05/1')
  } finally {
    await launched.close()
  }

  // Kept in worfy's data folder, never in the Project.
  expect(keptMarks().sort()).toEqual(['03/1', '03/2', '05/1', 'check-yourself', 'start'])
  expect(existsSync(join(projectPath, 'stories.json'))).toBe(false)
  expect(git('status', '--porcelain', '--ignored')).toBe('')

  launched = await launchApp({ env })
  try {
    await withStoryHook(launched)
    const view = await open(launched.window)
    const segments = view.getByTestId('story-segment')
    // Read before the restart: Start, both steps of 03, the first step of 05 and "Check yourself"; not the step of 04.
    for (const at of [1, 2, 4, 10]) await expect(segments.nth(at)).toHaveAttribute('data-state', 'read')
    for (const at of [3, 5, 6]) await expect(segments.nth(at)).toHaveAttribute('data-state', 'unread')
    await segments.nth(10).click()
    const [first, second] = [view.getByTestId('self-check-question').first(), view.getByTestId('self-check-question').nth(1)]
    await expect(first.getByTestId('self-check-answer')).toContainText('возвращает меньшее из скидки')
    await expect(first.getByTestId('self-check-mine')).toContainText('Скидка не больше итога.')
    await expect(second.getByTestId('self-check-answer')).toHaveCount(0)
    await expect(second.getByRole('textbox', { name: 'Ваш ответ на вопрос 2' })).toBeVisible()
  } finally {
    await launched.close()
  }
  expect(git('status', '--porcelain', '--ignored')).toBe('')
})

// A Code story made by the button (worfy-code-stories ticket 11) on the Project of the entries: gh also holds PR #300 of
// an ordinary Session (no Ticket names it) and what `gh pr view` and `gh pr diff` answer for it and for #212
// (pulls.json of the gh stub). The fake agent plays story-hold for a PR — it waits for the test's release, so the
// progress bar is seen — and story-epic for the Epic; WORFY_AGENT_LOG counts its requests. The build is invisible:
// no Session Node comes, as the contract test of the MCP inventory request checks (worfy-mcp-live ticket 14).

/** The entries' Project with PR #300 of an ordinary Session and the single-PR answers of gh; the fake agent's log. */
function prepareButton(): { env: Record<string, string>; log: string } {
  const { env, repo } = prepareEntries()
  const ghDir = env.GH_STUB_DIR!
  const head = git(repo, 'rev-parse', 'HEAD')
  const graph = JSON.parse(readFileSync(join(ghDir, 'graphql.json'), 'utf8')) as { pulls: { number: number; updatedAt: string; headRefOid: string; pull: Record<string, unknown> }[] }
  const first = graph.pulls[0]!
  graph.pulls.push({ ...first, number: 300, headRefOid: head, pull: { ...first.pull, title: 'Tidy the README', url: `https://github.com/${CART_REPO}/pull/300`, headRefName: 'session/readme' } })
  writeFileSync(join(ghDir, 'graphql.json'), JSON.stringify(graph))
  const view = (number: number, title: string, branch: string) => ({ title, body: `The text of PR #${String(number)}.`, author: { login: 'dev-me' }, headRefOid: head, headRefName: branch, comments: [] })
  writeFileSync(
    join(ghDir, 'pulls.json'),
    JSON.stringify({
      [`${CART_REPO}#300`]: { view: view(300, 'Tidy the README', 'session/readme'), diff: 'diff --git a/README.md b/README.md\n+Tidy the README\n' },
      [`${CART_REPO}#212`]: { view: view(212, 'Cart total in cents', 'demo-cart/04'), diff: 'diff --git a/src/cart.ts b/src/cart.ts\n+  if (line.quantity <= 0) continue\n' },
    }),
  )
  const log = join(scratch, 'agent.log')
  writeFileSync(log, '')
  return { env: { ...env, WORFY_AGENT_LOG: log, WORFY_STORY_SCRIPT: 'story-hold' }, log }
}

/** The requests the fake agent got: one `start` line each. */
const requestsIn = (log: string): number => readFileSync(log, 'utf8').split('\n').filter((line) => line.includes('"story":true') && line.includes('"kind":"start"')).length

test('Code story by the button: the Epic so far with its Tickets not ready marked in Start, a Session PR with the progress bar; a kept story opens with no request; no Session Node', async () => {
  test.setTimeout(ms(150_000))
  const { env, log } = prepareButton()
  const launched = await launchApp({ env })
  try {
    const { app, window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="demo-cart"]')
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame] })
    const sessionNodes = window.getByTestId('session-node')
    await expect(sessionNodes).toHaveCount(0)

    // The Epic has no story.md: "Code story" builds its story so far.
    const epicStory = frame.getByTestId('action-epic-story')
    await expect(epicStory).toHaveAttribute('aria-disabled', 'false', { timeout: ms(15_000) })
    await epicStory.click()
    const view = window.getByTestId('story-view')
    await expect(view).toBeVisible({ timeout: ms(20_000) })
    const screen = view.getByTestId('story-screen')
    await expect(screen).toHaveAttribute('data-kind', 'start')
    await expect(screen).toContainText('Not ready yet: Tickets 05, 06.')
    await expect(view.locator('[data-testid="story-chapter"].w-story__chapter-button--not-ready')).toHaveCount(2)
    expect(requestsIn(log)).toBe(1)
    await window.keyboard.press('Escape')
    await expect(view).toBeHidden()
    await expect(sessionNodes).toHaveCount(0)

    // Again: the story kept opens with no new request.
    await epicStory.click()
    await expect(view).toBeVisible()
    await expect(view.getByTestId('story-screen')).toHaveAttribute('data-kind', 'start')
    expect(requestsIn(log)).toBe(1)
    await window.keyboard.press('Escape')
    await expect(view).toBeHidden()

    // Pull requests: PR #300 of an ordinary Session, no Ticket: "Code story" → the progress bar → the Story view.
    const views = window.getByRole('group', { name: 'View', exact: true })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    const row = window.locator(`[data-testid="pr-inbox-row"][data-repo="${CART_REPO}"][data-number="300"]`)
    await expect(row).toBeVisible({ timeout: ms(40_000) })
    await row.getByRole('button').first().click()
    const pane = window.getByTestId('pr-inbox-pane')
    await pane.getByTestId('pr-inbox-code-story').click()
    const progress = pane.getByTestId('pr-inbox-code-story-progress')
    await expect(progress).toBeVisible()
    await expect(progress.getByTestId('story-progress-lines')).toContainText('Grep cartTotal', { timeout: ms(20_000) })
    await app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('story'))
    await expect(view).toBeVisible({ timeout: ms(20_000) })
    await expect(view.getByTestId('story-screen')).toHaveAttribute('data-kind', 'step')
    await expect(view).toContainText('Tidy the README')
    expect(requestsIn(log)).toBe(2)
    await window.keyboard.press('Escape')
    await expect(view).toBeHidden()

    // Again on that PR: the kept story, no new request; "Rebuild story" is there now.
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await row.getByRole('button').first().click()
    await expect(pane.getByTestId('pr-inbox-code-story-rebuild')).toBeVisible()
    await pane.getByTestId('pr-inbox-code-story').click()
    await expect(view).toBeVisible()
    expect(requestsIn(log)).toBe(2)
    await window.keyboard.press('Escape')
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
    // No build left a Session Node.
    await expect(sessionNodes).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

// worfy-polish 122 (the owner's bug report of 2026-11-17): a build by the button runs to its end whatever PR is open.
// The story of PR #300 (A) builds — the fake agent holds it after its first lines — while PR #301 (B, another Session PR
// with no story, added to the gh stub here) is open: B shows its own "Code story" button, idle, no bar. Back on A the bar
// is there with the lines main kept; after a reload of the window too. The release ends the one build: the story opens
// on A, and A has a story kept ("Rebuild story"). The fake agent was asked once.
test('a story by the button builds on while another PR is open and after a reload; it ends on its own PR with one request', async () => {
  test.setTimeout(ms(150_000))
  const { env, log } = prepareButton()
  const graphFile = join(env.GH_STUB_DIR!, 'graphql.json')
  const graph = JSON.parse(readFileSync(graphFile, 'utf8')) as { pulls: { number: number; pull: Record<string, unknown> }[] }
  const a = graph.pulls.find((one) => one.number === 300)!
  graph.pulls.push({ ...a, number: 301, pull: { ...a.pull, title: 'Fix the footer', url: `https://github.com/${CART_REPO}/pull/301`, headRefName: 'session/footer' } })
  writeFileSync(graphFile, JSON.stringify(graph))
  const launched = await launchApp({ env })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [window.locator('[data-testid="epic-frame"][data-epic="demo-cart"]')] })
    const views = window.getByRole('group', { name: 'View', exact: true })
    const pane = window.getByTestId('pr-inbox-pane')
    const progress = pane.getByTestId('pr-inbox-code-story-progress')
    const rowOf = (number: number) => window.locator(`[data-testid="pr-inbox-row"][data-repo="${CART_REPO}"][data-number="${String(number)}"]`)
    const openPr = async (number: number) => {
      await expect(rowOf(number)).toBeVisible({ timeout: ms(40_000) })
      await rowOf(number).getByRole('button').first().click()
    }

    await views.getByRole('button', { name: 'Pull requests' }).click()
    await openPr(300)
    await pane.getByTestId('pr-inbox-code-story').click()
    await expect(progress.getByTestId('story-progress-lines')).toContainText('Grep cartTotal', { timeout: ms(20_000) })

    // B: its own state — its build button, idle, and no bar.
    await openPr(301)
    await expect(pane.getByTestId('pr-inbox-code-story')).toHaveAttribute('aria-disabled', 'false')
    await expect(progress).toHaveCount(0)

    // Back on A: the bar of the build under way, with the lines main kept.
    await openPr(300)
    await expect(progress.getByTestId('story-progress-lines')).toContainText('Grep cartTotal')

    // A reload of the window: main still builds, and A shows it again.
    await window.reload()
    await expect(window.getByTestId('app-shell')).toBeVisible({ timeout: ms(20_000) })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await openPr(300)
    await expect(progress.getByTestId('story-progress-lines')).toContainText('Grep cartTotal', { timeout: ms(20_000) })

    await app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('story'))
    const view = window.getByTestId('story-view')
    await expect(view).toBeVisible({ timeout: ms(20_000) })
    await expect(view).toContainText('Tidy the README')
    expect(requestsIn(log)).toBe(1)
    await window.keyboard.press('Escape')
    await expect(view).toBeHidden()

    // The story is A's: kept under its key, so A has "Rebuild story" now.
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await openPr(300)
    await expect(pane.getByTestId('pr-inbox-code-story-rebuild')).toBeVisible()
    expect(requestsIn(log)).toBe(1)
  } finally {
    await launched.close()
  }
})

// The look of the bar of a story made by the button (worfy-code-stories ticket 11, review round 1): on the Epic frame
// and on a Ticket card, while it builds and once it failed, in both themes (snapshotThemes: CI keeps the pictures under
// test-results/e2e/snapshots/code-story-button-{epic,ticket}-{building,failed}/{light,dark}.png). Ticket 05 gets PR #213,
// whose story file is not there, so its card builds it. The fake agent plays story-hold-fail for both: it holds after
// its first line until the test lets it go, then answers what does not fit a Code story, so the build fails.

test('the bar of a story by the button on the Epic frame and on a Ticket card: building and failed, drawn over the Canvas, Close gives the focus back', async () => {
  test.setTimeout(ms(150_000))
  const { env } = prepareButton()
  const statusFile = join(env.WORFY_CLAUDE_HOME!, 'epic-status.json')
  const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { tickets: { num: number; pr?: number }[] }
  status.tickets = status.tickets.map((one) => (one.num === 5 ? { ...one, pr: 213 } : one))
  writeFileSync(statusFile, JSON.stringify(status))
  const pullsFile = join(env.GH_STUB_DIR!, 'pulls.json')
  const pulls = JSON.parse(readFileSync(pullsFile, 'utf8')) as Record<string, { view: Record<string, unknown>; diff: string }>
  const of212 = pulls[`${CART_REPO}#212`]!
  pulls[`${CART_REPO}#213`] = { view: { ...of212.view, title: 'Coupons', headRefName: 'demo-cart/05' }, diff: 'diff --git a/src/coupon.ts b/src/coupon.ts\n+export const coupon = 0\n' }
  writeFileSync(pullsFile, JSON.stringify(pulls))
  const launched = await launchApp({ env: { ...env, WORFY_STORY_SCRIPT: 'story-hold-fail', WORFY_STORY_EPIC_SCRIPT: 'story-hold-fail' } })
  try {
    const { app, window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="demo-cart"]')
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame] })
    const release = () => app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('story'))

    const cases = [
      { name: 'epic', button: frame.getByTestId('action-epic-story'), bar: window.getByTestId('action-epic-story-progress') },
      { name: 'ticket', button: window.locator('[data-testid="ticket-node"][data-ticket="5"]').getByTestId('action-ticket-story'), bar: window.getByTestId('action-ticket-story-progress') },
    ]
    for (const { name, button, bar } of cases) {
      await expect(button).toHaveAttribute('aria-disabled', 'false', { timeout: ms(15_000) })
      await button.click()
      await expect(bar).toBeVisible()
      await expect(bar.getByTestId('story-progress-lines')).toContainText('Grep cartTotal', { timeout: ms(20_000) })
      await expect(bar).toContainText('Building story…')
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      // Its whole width, over the card (240px) and the frame: nothing cuts it, whatever the Canvas's zoom.
      expect(Math.round((await bar.boundingBox())!.width)).toBe(320)
      await snapshotThemes(window, `code-story-button-${name}-building`)
      await release()
      await expect(bar.getByTestId('story-progress')).toHaveAttribute('data-state', 'failed', { timeout: ms(20_000) })
      await expect(bar).toContainText('Failed')
      await expect(bar.getByTestId('story-progress-reason')).toContainText('does not fit the Code story format')
      await snapshotThemes(window, `code-story-button-${name}-failed`)
      await bar.getByRole('button', { name: 'Close' }).click()
      await expect(bar).toHaveCount(0)
      await expect(button).toBeFocused()
    }
    await expect(window.getByTestId('session-node')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
