import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Story } from '../../src/shared/stories/schema'
import { launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// The Story view (worfy-code-stories ticket 09) in the built app, on the story of the fixture Epic of ticket 01
// (test/fixtures/code-story-answers/epic-ru.json, the answer of harness/bin/tests/fixtures/code-story/epic-ru.md).
// The entries into the view come with ticket 10 and the reader of story files with ticket 08, so the test opens it
// through the page's `__worfyStory` (src/renderer/stories/open.ts), which an init script defines before the app's
// scripts run; the view shows the story's own code. It turns the screens with the keyboard and the mouse, takes the
// look in both themes for the review — a code step wide, the step "Seams between tickets", a code step narrow —
// and goes back to the Canvas with Esc.

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
    await snapshotThemes(window, 'code-story-narrow')

    await window.keyboard.press('Escape')
    await expect(view).toBeHidden()
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
  } finally {
    await launched.close()
  }
})
