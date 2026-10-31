import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// worfy-onboarding ticket 14: a ring of the accent colour marks the one element to press next in
// Getting started (src/renderer/getting-started/highlight.ts). Every check counts the elements with
// `data-getting-started-ring` in the whole window: one, on the right element, or none.
//
// The demo is created for real, as in getting-started.spec.ts: git and bin/project-connect of this
// build's Harness in a temporary home. Its Orchestrator runs on the fake agent's `interrupt` script:
// a sent message starts a turn that stands until Interrupt, so the moment between "sent" and "step
// marked" can be looked at; Interrupt ends the turn and main marks step 3. No agent moves the demo
// Ticket: the test writes what the Harness would — the Ticket's Status line, its branch and the marks
// file of `bin/ticket mark` — as getting-started-hints.spec.ts does.
//
// Screenshots, light and dark, go to the test's output as 14-ring-<what>-<theme>.png: the ring on the
// step's button in the panel, on "Check again" of First run, on Send of the Orchestrator's field, and
// the step's button with reduced motion.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')

const QUESTION = 'What is planned in this project?'
const SHIP = '/worfy:ship-ticket todo 01'
const EDITED = 'What is planned here, in two lines?'

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-gs-highlight-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** The app's home and temporary folders side by side (getting-started.spec.ts, homes()). */
function homes(): Record<string, string> {
  const home = join(scratch, 'home')
  const temp = join(scratch, 'tmp')
  mkdirSync(home, { recursive: true })
  mkdirSync(temp, { recursive: true })
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Demo Tester\n\temail = demo@example.com\n')
  return { HOME: home, ...windowsProfileEnv(home), TMPDIR: temp, TEMP: temp, TMP: temp }
}

/** This build's Harness in the test's Claude home, with an empty gate registry. */
function installHarness(claudeHome: string): void {
  const harnessHome = join(claudeHome, 'worfy-harness')
  cpSync(bundle, join(harnessHome, 'plugin'), { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
}

/** Marks `steps` in the state file, as main does: the next read of the state has them. */
function markSteps(dataDir: string, steps: readonly string[]): void {
  const file = join(dataDir, 'getting-started.json')
  const state = JSON.parse(readFileSync(file, 'utf8')) as { steps?: Record<string, string> }
  const at = new Date().toISOString()
  state.steps = { ...state.steps, ...Object.fromEntries(steps.map((step) => [step, state.steps?.[step] ?? at])) }
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

/** Runs git in the demo's repository and answers its output. */
const git = (repo: string, ...args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim()

let statusTick = 0

/** Rewrites the demo Ticket's Status line, with a new time each call: the workflow model changes. */
function setStatus(repo: string, state: 'claimed' | 'done'): void {
  statusTick += 1
  const file = join(repo, '.scratch', 'todo', 'issues', '01-done-command.md')
  const at = `2026-10-31T10:${String(statusTick).padStart(2, '0')}Z`
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/mu, `Status: ${state} ${at}`))
}

/** Appends a `review` mark on `sha` to the demo Ticket's marks file, as `bin/ticket mark` does. */
function markReview(claudeHome: string, sha: string, verdict: 'pending' | 'success'): void {
  const dir = join(claudeHome, 'worfy-harness', 'runs', 'worfy-demo', 'marks')
  const file = join(dir, 'todo-01.json')
  mkdirSync(dir, { recursive: true })
  let marks: unknown[] = []
  try {
    marks = (JSON.parse(readFileSync(file, 'utf8')) as { marks: unknown[] }).marks
  } catch {
    // The first mark: no file yet.
  }
  writeFileSync(file, `${JSON.stringify({ epic: 'todo', num: 1, marks: [...marks, { kind: 'review', verdict, sha, at: new Date().toISOString() }] }, null, 2)}\n`)
}

/** The messages the fake agent was sent, from its log (WORFY_AGENT_LOG). */
function messagesSent(log: string): string[] {
  let text: string
  try {
    text = readFileSync(log, 'utf8')
  } catch {
    // No log yet: the fake agent was asked nothing.
    return []
  }
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

const sectionOf = (window: Page): Locator => window.getByTestId('getting-started')
const stepOf = (window: Page, step: string): Locator => sectionOf(window).locator(`[data-testid="getting-started-step"][data-step="${step}"]`)
const ringOf = (window: Page): Locator => window.locator('[data-getting-started-ring]')
const sessionViewOf = (window: Page): Locator => window.locator('.w-shell__view[data-view="session"]')

/** The ring is on exactly one element of the window: the button of `step` in the panel, labelled `label`. */
async function expectRingOnStep(window: Page, step: string, label: string): Promise<void> {
  const ring = ringOf(window)
  await expect(ring).toHaveCount(1, { timeout: ms(20_000) })
  await expect(ring).toHaveAttribute('data-getting-started-target', `step-${step}`)
  await expect(ring).toHaveText(label)
  await expect(stepOf(window, step).locator('[data-getting-started-ring]')).toHaveCount(1)
}

/** The ring is on exactly one element: Send of the Orchestrator's field in the Session view, enabled. */
async function expectRingOnSend(window: Page): Promise<void> {
  const ring = ringOf(window)
  await expect(ring).toHaveCount(1, { timeout: ms(30_000) })
  await expect(ring).toHaveAttribute('data-testid', 'input-send')
  await expect(sessionViewOf(window).locator('[data-getting-started-ring]')).toHaveCount(1)
  await expect(ring).toBeEnabled()
}

/** No ring anywhere, and none two frames later either (the panel puts the ring at most a frame after a change of the DOM). */
async function expectNoRing(window: Page): Promise<void> {
  await expect(ringOf(window)).toHaveCount(0, { timeout: ms(20_000) })
  await window.evaluate(() => {
    const frame = (globalThis as unknown as { requestAnimationFrame(callback: () => void): number }).requestAnimationFrame
    return new Promise<void>((resolve) => frame(() => frame(() => resolve())))
  })
  await expect(ringOf(window)).toHaveCount(0)
}

/** Runs a command of the Command palette by its title. */
async function paletteCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('ControlOrMeta+k')
  const input = window.getByTestId('palette-input')
  await expect(input).toBeVisible()
  await input.fill(title)
  await expect(window.locator('[data-testid="palette-option"][data-active="true"]')).toHaveAttribute('data-command', 'getting-started')
  await input.press('Enter')
}

/** "Skip" (no ring then), then the palette's "Getting started": the panel comes back with the state read again. */
async function skipAndReopen(window: Page): Promise<void> {
  await sectionOf(window).getByRole('button', { name: 'Skip' }).click()
  await expect(sectionOf(window)).toHaveCount(0)
  await expectNoRing(window)
  await paletteCommand(window, 'Getting started')
  await expect(sectionOf(window)).toBeVisible()
}

/** Whether the point at the centre of the ringed element hits that element: nothing covers it and a click there reaches it. */
const ringHitAtCentre = (window: Page): Promise<boolean> =>
  window.evaluate(() => {
    type El = { contains(other: unknown): boolean; getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
    const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): El | null; querySelector(selector: string): El | null } }).document
    const own = doc.querySelector('[data-getting-started-ring]')
    if (own === null) return false
    const box = own.getBoundingClientRect()
    const hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && own.contains(hit)
  })

/** The name of the CSS animation on the ringed element: `none` with reduced motion. */
const ringAnimation = (window: Page): Promise<string> => ringOf(window).evaluate((element) => (globalThis as unknown as { getComputedStyle(element: unknown): { animationName: string } }).getComputedStyle(element).animationName)

/** Light and dark screenshots of `target`, kept with the test's output; the animation stands at its first frame, the full ring. */
async function shoot(window: Page, target: Locator, name: string): Promise<void> {
  await window.evaluate(() => (globalThis as unknown as { document: { activeElement: { blur?: () => void } | null } }).document.activeElement?.blur?.())
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await target.screenshot({ path: test.info().outputPath(`14-ring-${name}-${scheme}.png`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('the ring walks the demo: "Open checks", "Check again", "Create demo project", the step button and Send of steps 3 and 4 (an edited or emptied field, the pill), none after sending and in steps 5–6', async () => {
  const agentLog = join(scratch, 'agent.jsonl')
  const env = homes()
  const launched = await launchApp({ env: { ...env, WORFY_GETTING_STARTED_AUTO: '1', WORFY_AGENT_LOG: agentLog, WORFY_AGENT_SCRIPT: 'interrupt' } })
  try {
    const { app, window, dataDir, claudeHome } = launched
    installHarness(claudeHome)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))
    await expect(sectionOf(window)).toBeVisible()

    // Step 1: "Open checks"; pressed through the ring, it opens First run, where "Check again" carries the ring.
    await expectRingOnStep(window, '1', 'Open checks')
    await expect.poll(() => ringAnimation(window)).toBe('w-getting-started-ring')
    await shoot(window, sectionOf(window), 'step-button')
    expect(await ringHitAtCentre(window)).toBe(true)
    await ringOf(window).click()
    const firstRun = window.getByTestId('first-run')
    await expect(firstRun).toBeVisible()
    await expect(ringOf(window)).toHaveCount(1)
    await expect(firstRun.locator('[data-getting-started-ring]')).toHaveText('Check again')
    // Over the panel, in the layer of First run: a click on it reaches it.
    expect(await ringHitAtCentre(window)).toBe(true)
    await shoot(window, firstRun, 'check-again')
    await firstRun.getByRole('button', { name: 'Close' }).click()
    await expect(firstRun).toHaveCount(0)
    await expectRingOnStep(window, '1', 'Open checks')

    // Step 2 (step 1 marked as main writes it): "Create demo project".
    markSteps(dataDir, ['1'])
    await skipAndReopen(window)
    await expectRingOnStep(window, '2', 'Create demo project')
    await ringOf(window).click()
    await expect(stepOf(window, '2')).toHaveAttribute('data-done', 'true', { timeout: ms(60_000) })
    await expect(stepOf(window, '2').getByRole('alert')).toHaveCount(0)

    // Step 3: "Open the Orchestrator", then Send of the demo Orchestrator's field with the question in it.
    await expectRingOnStep(window, '3', 'Open the Orchestrator')
    await ringOf(window).click()
    const field = sessionViewOf(window).getByRole('textbox', { name: 'Message Orchestrator' })
    await expect(field).toHaveValue(QUESTION, { timeout: ms(30_000) })
    await expect(field).toBeEnabled({ timeout: ms(30_000) })
    await expectRingOnSend(window)
    await shoot(window, sessionViewOf(window).getByTestId('message-input'), 'send')

    // The question edited, then the Session view closed: the Send is hidden, the step's button that opens
    // it again takes the ring. Pressed, it keeps the edit in the field, and the ring is back on Send.
    await field.fill(EDITED)
    const views = window.getByRole('group', { name: 'View', exact: true })
    await views.getByRole('button', { name: 'Canvas' }).click()
    await expectRingOnStep(window, '3', 'Open the Orchestrator')
    await ringOf(window).click()
    await expect(sessionViewOf(window).getByTestId('session-view')).toBeVisible()
    await expect(field).toHaveValue(EDITED)
    await expectRingOnSend(window)

    // Collapsed into the pill with the text in the field: no ring; expanded: on Send again.
    await sectionOf(window).getByRole('button', { name: 'Collapse' }).click()
    await expect(window.getByTestId('getting-started-pill')).toBeVisible()
    await expectNoRing(window)
    await window.getByTestId('getting-started-pill').click()
    await expectRingOnSend(window)

    // Send pressed through the ring sends the edited question as without it; while the turn runs, no ring.
    expect(await ringHitAtCentre(window)).toBe(true)
    await ringOf(window).click()
    await expect.poll(() => messagesSent(agentLog), { timeout: ms(20_000) }).toEqual([EDITED])
    await expectNoRing(window)
    await expect(stepOf(window, '3')).toHaveAttribute('aria-current', 'step')

    // The turn ends: main marks step 3, and "Ship the ticket" takes the ring; then Send with the command.
    await sessionViewOf(window).getByTestId('input-interrupt').click()
    await expect(stepOf(window, '3')).toHaveAttribute('data-done', 'true', { timeout: ms(20_000) })
    await expectRingOnStep(window, '4', 'Ship the ticket')
    await ringOf(window).click()
    await expect(field).toHaveValue(SHIP, { timeout: ms(30_000) })
    await expectRingOnSend(window)
    // The field emptied by hand: the step's button takes the ring and puts the command back.
    await field.fill('')
    await expectRingOnStep(window, '4', 'Ship the ticket')
    await ringOf(window).click()
    await expect(field).toHaveValue(SHIP)
    await expectRingOnSend(window)
    await views.getByRole('button', { name: 'Canvas' }).click()
    await expectRingOnStep(window, '4', 'Ship the ticket')
    await views.getByRole('button', { name: 'Session' }).click()
    await expectRingOnSend(window)
    await ringOf(window).click()
    await expect.poll(() => messagesSent(agentLog), { timeout: ms(20_000) }).toEqual([EDITED, SHIP])
    await expectNoRing(window)

    // Steps 5 and 6, then Done: no ring. The Ticket passes Implementing (a pending review), then Agent review.
    const repo = join(env.HOME as string, 'worfy-demo')
    git(repo, 'branch', 'todo/01')
    const sha = git(repo, 'rev-parse', 'todo/01')
    markReview(claudeHome, sha, 'pending')
    setStatus(repo, 'claimed')
    await expect(stepOf(window, '5')).toHaveAttribute('aria-current', 'step', { timeout: ms(20_000) })
    await expectNoRing(window)
    markReview(claudeHome, sha, 'success')
    setStatus(repo, 'claimed')
    await expect(stepOf(window, '6')).toHaveAttribute('aria-current', 'step', { timeout: ms(20_000) })
    await expectNoRing(window)
    setStatus(repo, 'done')
    await expect(sectionOf(window).getByTestId('getting-started-done')).toBeVisible({ timeout: ms(20_000) })
    await expectNoRing(window)
  } finally {
    await launched.close()
  }
})

test('no ring before an existing user opens the panel, on the pill or after Skip; with reduced motion the ring stands still', async () => {
  const dataDir = join(scratch, 'data')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'getting-started.json'), `${JSON.stringify({ user: 'existing', section: 'hidden', steps: {}, reworkSeen: false, noticeShown: true }, null, 2)}\n`)
  const launched = await launchApp({ env: { ...homes(), WORFY_DATA_DIR: dataDir, WORFY_GETTING_STARTED_AUTO: '1' } })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))
    await expect(window.getByTestId('app-shell')).toBeVisible()

    // An existing user before the panel was ever opened: no panel, no ring.
    await expect(sectionOf(window)).toHaveCount(0)
    await expectNoRing(window)

    // Opened from the palette: the ring on step 1's button.
    await paletteCommand(window, 'Getting started')
    await expect(sectionOf(window)).toBeVisible()
    await expectRingOnStep(window, '1', 'Open checks')

    // Reduced motion: the ring is there and does not move; without it, it pulses.
    await window.emulateMedia({ reducedMotion: 'reduce' })
    await expect(ringOf(window)).toHaveCount(1)
    await expect.poll(() => ringAnimation(window)).toBe('none')
    await shoot(window, sectionOf(window), 'reduced-motion')
    await window.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(() => ringAnimation(window)).toBe('w-getting-started-ring')

    // Collapsed into the pill: no ring; expanded again: the ring is back.
    await sectionOf(window).getByRole('button', { name: 'Collapse' }).click()
    await expect(window.getByTestId('getting-started-pill')).toBeVisible()
    await expectNoRing(window)
    await window.getByTestId('getting-started-pill').click()
    await expectRingOnStep(window, '1', 'Open checks')

    // Skip: no ring anywhere.
    await sectionOf(window).getByRole('button', { name: 'Skip' }).click()
    await expect(sectionOf(window)).toHaveCount(0)
    await expectNoRing(window)
  } finally {
    await launched.close()
  }
})
