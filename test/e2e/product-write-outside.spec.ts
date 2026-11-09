import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// A Product Session's write outside its folder (worfy-polish ticket 82, the owner's decision 2026-11-09): a
// question, not a refusal. Against the built app on the fake agent (WORFY_AGENT=fake, set by launchApp), the
// script test/fixtures/agent-scripts/product-write-outside.jsonl writes context/strong/brief.md of the
// Project (outside docs/product/) in bypassPermissions; the guard the fake agent runs before canUseTool, as
// Claude Code does, asks on the Session's gate: Allow once / Always allow in <folder> / Deny. «Allow once»
// writes the file; the next turn's write elsewhere, denied, writes nothing. The screenshot of the question
// in the dark theme goes to the test's output folder. A temporary WORFY_CLAUDE_HOME stands in for ~/.claude.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-product-write-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(join(projectPath, 'docs', 'product'), { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.6 } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const sessionView = (window: Page): Locator => window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')

test('a Product Session’s write outside its folder asks first: «Allow once» writes the file, «Deny» writes nothing', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-write-outside' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    const field = view.getByRole('textbox', { name: /^Message / })
    await expect(field).toBeEnabled()
    const state = view.getByTestId('session-state')
    const brief = join(projectPath, 'context', 'strong', 'brief.md')
    const folder = join(projectPath, 'context', 'strong')

    await field.fill('Put the new brief into context/strong')
    await field.press('Enter')
    const cards = view.getByTestId('permission-card')
    await expect(cards).toHaveCount(1)
    await expect(state).toHaveText('needs permission')
    const question = cards.nth(0)
    await expect(question).toContainText(`Product Session wants to write ${brief}`)
    await expect(question.getByTestId('permission-blocked-path')).toHaveText(brief)
    await expect(question.getByRole('button')).toHaveText(['Allow once', `Always allow in ${folder}`, 'Deny'])
    expect(existsSync(brief)).toBe(false)
    // The long folder of «Always allow in» wraps inside the card, clear of «Deny».
    const [box, always, denyBox] = [(await question.boundingBox())!, (await question.getByTestId('permission-always-allow').boundingBox())!, (await question.getByTestId('permission-deny').boundingBox())!]
    expect(always.x + always.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    expect(denyBox.y).toBeGreaterThanOrEqual(always.y + always.height - 0.5)
    await question.scrollIntoViewIfNeeded()
    await view.screenshot({ path: test.info().outputPath('82-write-outside-question-dark.png') })
    await question.getByTestId('permission-allow').click()
    await expect(question).toHaveAttribute('data-resolution', 'allow')
    await expect(view.getByText('The new brief is in context/strong.').first()).toBeVisible()
    await expect.poll(() => (existsSync(brief) ? readFileSync(brief, 'utf8') : null)).toBe('# Brief, version 2\n')
    await expect(state).toHaveText('idle')

    // «Allow once» put nothing on the Project's list: the next write outside is asked about again; denied, it writes nothing.
    await field.fill('Write the plan too')
    await field.press('Enter')
    await expect(cards).toHaveCount(2)
    const second = cards.nth(1)
    await expect(second).toContainText(`Product Session wants to write ${join(projectPath, 'notes', 'plan.md')}`)
    await second.getByTestId('permission-deny').click()
    await expect(second).toHaveAttribute('data-resolution', 'deny')
    await expect(view.getByText('You kept the plan as it is.').first()).toBeVisible()
    expect(existsSync(join(projectPath, 'notes', 'plan.md'))).toBe(false)
    const settingsFile = join(dataDir, PROJECT, 'settings.json')
    const listed = existsSync(settingsFile) ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as { productWriteFolders?: string[] }).productWriteFolders : undefined
    expect(listed).toBeUndefined()
  } finally {
    await launched.close()
  }
})
