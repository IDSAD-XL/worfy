import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { axeViolations, expectAccessible, failingViolations } from './axe'
import { canvasReady, closeSettings, launchApp } from './helpers'
import { clickMenuItem } from './menu'
import { openTerminal, terminalAiSandbox } from './terminal-ai-helpers'
import { NO_ZSH, NO_ZSH_ON_WINDOWS } from '../zsh'
import { ms } from '../time-scale'

// axe on the main screens of the built app (worfy-ui-kit ticket 18): the Canvas, the Command palette,
// Settings, the worfy Guide and the Session view, and the two places that keep their own markup rather
// than the kit (the owner's decision of 2026-11-12, Q3): the Command request panel of Terminal AI and
// the Mind map of a Product Session with a node's card open; and the Story view of a Code story
// (worfy-code-stories ticket 09). A screen fails on an axe violation of
// impact critical or serious (test/e2e/axe.ts); each check is soft, so one run lists every screen's.
// The app runs on the fake agent (WORFY_AGENT=fake, set by launchApp) with a temporary data folder
// and a temporary stand-in for ~/.claude.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const TOPIC = 'roadmap'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-a11y-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('the Canvas, the Command palette, Settings, the Guide and the Session view have no serious axe violations', async () => {
  test.setTimeout(ms(120_000))
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } })
  try {
    const { app, window } = launched
    const node = window.getByTestId('orchestrator-node')
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [node] })
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await expectAccessible(window, 'Canvas')

    // The check itself: a window without a name, put on the Canvas, is a serious violation.
    await window.evaluate(
      "(() => { const box = document.createElement('div'); box.setAttribute('role', 'dialog'); box.setAttribute('data-a11y-probe', ''); box.textContent = 'A window without a name'; document.body.append(box) })()",
    )
    const probe = await axeViolations(window, { include: '[data-a11y-probe]' })
    // Through the same filter as every scan below: the window lands among the violations that fail a screen.
    expect(failingViolations(probe).map((violation) => violation.id)).toContain('aria-dialog-name')
    await window.locator('[data-a11y-probe]').evaluate((box) => box.remove())

    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await expectAccessible(window, 'Command palette')
    await window.keyboard.press('Escape')
    await expect(palette).toBeHidden()

    await clickMenuItem(app, 'app.settings')
    await expect(window.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expectAccessible(window, 'Settings')
    await closeSettings(window)

    await clickMenuItem(app, 'help.guide')
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await expect(guide).toBeVisible()
    await expectAccessible(window, 'Guide')
    await window.keyboard.press('Escape')
    await expect(guide).toBeHidden()

    // The Session view with one finished turn: a prompt, the answer as markdown and a tool call.
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first prompt')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expectAccessible(window, 'Session')
  } finally {
    await launched.close()
  }
})

test('the Mind map of a Product Session, with a node card open, has no serious axe violations', async () => {
  test.setTimeout(ms(120_000))
  const topicDir = join(projectPath, 'docs', 'product', TOPIC)
  const mapFile = join(topicDir, 'mind-map.json')
  mkdirSync(topicDir, { recursive: true })
  writeFileSync(join(topicDir, 'map.md'), '# Roadmap of alpha\n\n## Destination\n\nA calmer week.\n')
  writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: [] }, null, 2)}\n`)
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.6 } }))
  const message = '00000000-0000-4000-8000-000000000901'
  const nodes = [
    { id: 'root-idea', kind: 'idea', text: 'A screen for product work: the map of decisions beside the conversation', from: null, advice: true, message },
    { id: 'who', kind: 'question', text: 'Who decides when the advisor and the critic disagree?', from: 'root-idea', message },
    { id: 'split', kind: 'decision', text: 'Mind map and chat side by side', from: 'root-idea', status: 'accepted', reason: 'seen in the prototype', message },
    { id: 'laptop', kind: 'objection', text: 'The agent edits the file, not the owner', from: 'split', source: 'docs/design/F-SPEC.md', message },
  ]

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-mind-map' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const map = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view').getByTestId('product-session-map')
    await expect(map.getByTestId('product-session-map-empty')).toBeVisible()
    writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes }, null, 2)}\n`)
    // The topic and its nodes.
    await expect(map.getByTestId('mind-node')).toHaveCount(nodes.length + 1)
    await map.locator('[data-testid="mind-node"][data-id="split"]').click()
    await expect(map.getByRole('region', { name: 'Node' })).toBeVisible()
    await expectAccessible(window, 'Mind map with a node card open')
  } finally {
    await launched.close()
  }
})

test('the Command request panel of Terminal AI has no serious axe violations', async () => {
  test.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)
  test.setTimeout(ms(120_000))
  const sandbox = terminalAiSandbox()
  try {
    sandbox.answers([{ feature: 'request', answer: 'echo never-asked' }])
    const launched = await launchApp({ env: sandbox.env })
    try {
      const { window } = launched
      const node = await openTerminal(window)
      const panel = node.getByRole('dialog', { name: 'Command request' })
      await expect(async () => {
        await node.getByTestId('terminal-screen').click()
        await window.keyboard.press('Meta+I')
        await expect(panel).toBeVisible({ timeout: ms(1_000) })
      }).toPass({ timeout: ms(15_000) })
      await expectAccessible(window, 'Command request', { include: '[data-testid="terminal-ai-request"]' })
    } finally {
      await launched.close()
    }
  } finally {
    await sandbox.remove()
  }
})

// The Story view (worfy-code-stories ticket 09) on the fixture Epic's story, opened through the page's
// `__worfyStory` (src/renderer/stories/open.ts) until its entries exist: its first screen, a code step with the
// code card and the field tabs, and the step "Seams between tickets" with its diagram.
test('the Story view has no serious axe violations', async () => {
  test.setTimeout(ms(120_000))
  const epic = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'code-story-answers', 'epic-ru.json'), 'utf8')) as Record<string, unknown>
  const story = { kind: 'epic', header: { epic: 'demo-cart', language: 'ru' }, ...epic }
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900))
    await app.context().addInitScript(() => {
      ;(globalThis as unknown as { __worfyStory: object }).__worfyStory = {}
    })
    await window.reload()
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => window.evaluate(() => typeof (globalThis as unknown as { __worfyStory?: { open?: unknown } }).__worfyStory?.open)).toBe('function')
    await window.evaluate(([project, shown]) => (globalThis as unknown as { __worfyStory: { open: (p: string, s: unknown) => void } }).__worfyStory.open(project, shown), [PROJECT, story] as const)
    const view = window.getByTestId('story-view')
    await expect(view).toBeVisible()
    await expectAccessible(window, 'Story view')
    await window.keyboard.press('ArrowRight')
    await expect(view.getByTestId('md-story-code')).toBeVisible()
    await expectAccessible(window, 'Story view, a code step')
    await view.locator('[data-testid="story-chapter"][data-chapter="seams"]').click()
    await expect(view.getByTestId('story-seams-diagram')).toBeVisible()
    await expectAccessible(window, 'Story view, Seams between tickets')
  } finally {
    await launched.close()
  }
})
