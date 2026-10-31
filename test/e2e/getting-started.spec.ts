import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, smallestWindow } from './helpers'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// worfy-onboarding tickets 07 and 13: Getting started, a panel in the top right corner of the window.
//
// A fresh data folder with WORFY_GETTING_STARTED_AUTO=1 is a new user: the panel shows, under the
// toolbar at the right edge, and the sidebar has no Getting started section. "Create demo project" runs the real creation (src/main/getting-started/demo.ts) — git,
// and bin/project-connect of this build's Harness copied into the temporary Claude home — in a
// temporary home folder: HOME of the app is a folder of the test, with its own .gitconfig, and the
// app's temporary folder (TMPDIR) another one, since the demo is never created inside the temporary
// folder of the system. The Orchestrator runs on the fake agent; nothing reaches Claude Code.
//
// Step 1 is marked from the first-run checks, which this spec does not run (first-run.spec.ts does):
// the spec writes the mark into getting-started.json, the way main would, and Skip and the Command
// palette's "Getting started" bring the panel back with it read again.
//
// The panel is a layer of <body> under the dialogs (ticket 13, owner's decision Q13): a click beside
// it reaches the Canvas and the toolbar, and First run, the Command palette and Settings open over it
// (a toast below it: getting-started-done.spec.ts). Collapsed, it is a pill that a restart keeps.
// In the Session view it stands under the Session's header and the place of its ⌘F find bar
// (owner's decision Q22): Hide tools, Interrupt and the find bar are not covered.
//
// Screenshots of the panel in both themes (steps 1–2 marked; step 4 with its hint; all six marked;
// the pill; the smallest window; the whole window in the Session view and on the Canvas) go to the
// test's output as 13-panel-<what>-<theme>.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')

const QUESTION = 'What is planned in this project?'
const SKIPPED = 'Getting started is hidden. Reopen it from the Command palette: Getting started.'

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-getting-started-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/**
 * The app's home folder and temporary folder, side by side in the test's scratch folder: the home is
 * not inside the temporary one. On Windows the app's git does not see HOME: worfy builds the
 * environment of what it runs from the registry and the session's profile variables (USERPROFILE,
 * HOMEDRIVE + HOMEPATH; src/main/agent/env.ts), so the whole profile moves to the home folder.
 */
function homes(): Record<string, string> {
  const home = join(scratch, 'home')
  const temp = join(scratch, 'tmp')
  mkdirSync(home, { recursive: true })
  mkdirSync(temp, { recursive: true })
  // The demo's first commit needs an author; git reads it from this home's global config.
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Demo Tester\n\temail = demo@example.com\n')
  return { HOME: home, ...windowsProfileEnv(home), TMPDIR: temp, TEMP: temp, TMP: temp }
}

/** This build's Harness in the temporary Claude home, with an empty gate registry. */
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

const sectionOf = (window: Page): Locator => window.getByTestId('getting-started')
const stepOf = (window: Page, step: string): Locator => sectionOf(window).locator(`[data-testid="getting-started-step"][data-step="${step}"]`)

/** Runs a command of the Command palette by its title; `command` is its id. */
async function paletteCommand(window: Page, title: string, command = 'getting-started'): Promise<void> {
  await window.keyboard.press('ControlOrMeta+k')
  const input = window.getByTestId('palette-input')
  await expect(input).toBeVisible()
  await input.fill(title)
  await expect(window.locator('[data-testid="palette-option"][data-active="true"]')).toHaveAttribute('data-command', command)
  await input.press('Enter')
}

/** "Skip", then the palette's "Getting started": the panel comes back with the state read again. */
async function skipAndReopen(window: Page): Promise<void> {
  await sectionOf(window).getByRole('button', { name: 'Skip' }).click()
  await expect(sectionOf(window)).toHaveCount(0)
  await paletteCommand(window, 'Getting started')
  await expect(sectionOf(window)).toBeVisible()
}

/** How far the panel's body scrolls: 0 while it shows all its content. */
const overflowOf = (window: Page): Promise<number> => sectionOf(window).getByTestId('getting-started-body').evaluate((body) => body.scrollHeight - body.clientHeight)

/**
 * Screenshots of `target` (the panel by default) in both themes, kept with the test's output. With
 * `whole`, the body of the panel must not scroll: the screenshot is the whole panel.
 */
async function shoot(window: Page, name: string, { whole = true, target = sectionOf(window) }: { whole?: boolean; target?: Locator } = {}): Promise<void> {
  // The whole panel, not a part of a body that scrolls; no focus ring of the palette's focusing.
  if (whole) expect(await overflowOf(window)).toBe(0)
  await window.evaluate(() => (globalThis as unknown as { document: { activeElement: { blur?: () => void } | null } }).document.activeElement?.blur?.())
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await target.screenshot({ path: test.info().outputPath(`13-panel-${name}-${scheme}.png`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** The size of the window's page, in CSS pixels. */
const viewport = (window: Page): Promise<{ width: number; height: number }> =>
  window.evaluate(() => {
    const page = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return { width: page.innerWidth, height: page.innerHeight }
  })

/** The Session view of the window's main area (not a Session of focus mode). */
const sessionViewOf = (window: Page): Locator => window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')

/**
 * The panel stands in the top right corner, its right edge at the window's, about 320 px wide. Its
 * top is under the toolbar; in the Session view (`under: 'session'`, owner's decision Q22) under the
 * Session's header and the place of its ⌘F find bar (8 px below the header, 32 px high).
 */
async function expectInCorner(window: Page, under: 'toolbar' | 'session' = 'toolbar'): Promise<void> {
  const panel = await sectionOf(window).boundingBox()
  const above = under === 'toolbar' ? await window.locator('.w-toolbar').boundingBox() : await sessionViewOf(window).locator('.w-session__header').boundingBox()
  const page = await viewport(window)
  expect(panel).not.toBeNull()
  expect(above).not.toBeNull()
  if (panel === null || above === null) return
  const top = above.y + above.height + (under === 'session' ? 8 + 32 : 0)
  expect(panel.y).toBeGreaterThanOrEqual(top)
  expect(panel.y).toBeLessThanOrEqual(top + 24)
  // The right edge at the window's, with the margin the toasts keep (16 px).
  expect(page.width - (panel.x + panel.width)).toBeGreaterThanOrEqual(0)
  expect(page.width - (panel.x + panel.width)).toBeLessThanOrEqual(24)
  expect(Math.abs(panel.width - 320)).toBeLessThanOrEqual(3)
}

/**
 * Whether the point at the centre of the element `selector` finds hits that element itself, or what is
 * inside it: nothing covers it there. False when there is no such element.
 */
const hitsAtCentre = (window: Page, selector: string): Promise<boolean> =>
  window.evaluate((selector) => {
    type El = { contains(other: unknown): boolean; getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
    const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): El | null; querySelector(selector: string): El | null } }).document
    const own = doc.querySelector(selector)
    if (own === null) return false
    const box = own.getBoundingClientRect()
    const hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && own.contains(hit)
  }, selector)

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

test('Getting started: the panel in the top right corner, the demo created, the Orchestrator opened with the question not sent, Skip and the palette', async () => {
  const agentLog = join(scratch, 'agent.jsonl')
  const env = homes()
  const launched = await launchApp({ env: { ...env, WORFY_GETTING_STARTED_AUTO: '1', WORFY_AGENT_LOG: agentLog } })
  try {
    const { app, window, dataDir, claudeHome } = launched
    installHarness(claudeHome)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))

    // A new user: the panel shows in the top right corner, with step 1 current; the sidebar has no Getting started section.
    const section = sectionOf(window)
    await expect(section).toBeVisible()
    await expect(section).toHaveAttribute('role', 'region')
    await expect(section).toHaveAccessibleName('Getting started')
    await expectInCorner(window)
    const sidebar = window.getByRole('navigation', { name: 'Sidebar' })
    await expect(sidebar.getByRole('region', { name: 'Projects' })).toBeVisible()
    await expect(sidebar.locator('[data-section-id="GettingStartedSection"], [data-section="GettingStartedSection"]')).toHaveCount(0)
    await expect(sidebar.getByText('Getting started')).toHaveCount(0)
    await expect(window.getByTestId('getting-started-pill')).toHaveCount(0)
    await expect(section.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(6)
    await expect(stepOf(window, '1')).toHaveAttribute('aria-current', 'step')
    await expect(section.getByRole('button', { name: 'Create demo project' })).toHaveCount(0)

    // Step 1's button opens the first-run checks.
    await section.getByRole('button', { name: 'Open checks' }).click()
    const checks = window.getByTestId('first-run')
    await expect(checks).toBeVisible()
    await checks.getByRole('button', { name: 'Close' }).click()
    await expect(checks).toHaveCount(0)

    // The checks passed (written as main writes them); Skip hides the panel, pill and all, and says where it comes back from.
    markSteps(dataDir, ['1'])
    await section.getByRole('button', { name: 'Skip' }).click()
    await expect(section).toHaveCount(0)
    await expect(window.getByTestId('getting-started-pill')).toHaveCount(0)
    await expect(window.getByTestId('toasts')).toContainText(SKIPPED)
    // The palette's "Getting started" shows it again, read anew, and focuses its heading.
    await paletteCommand(window, 'Getting started')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Getting started' })).toBeFocused()
    await expect(stepOf(window, '1')).toHaveAttribute('data-done', 'true')
    await expect(stepOf(window, '2')).toHaveAttribute('aria-current', 'step')

    // Step 2: the demo is created in the home folder; main marks the step and the Project is in the list.
    await section.getByRole('button', { name: 'Create demo project' }).click()
    // Marked, or refused: a refusal is the received value, so a failed run says why.
    const step2 = stepOf(window, '2')
    const outcome = async (): Promise<string> => {
      if ((await step2.getAttribute('data-done')) === 'true') return 'marked'
      const alert = step2.getByRole('alert')
      return (await alert.count()) > 0 ? await alert.innerText() : 'creating'
    }
    await expect.poll(outcome, { timeout: ms(60_000), message: 'step 2 is marked after Create demo project' }).toBe('marked')
    await expect(step2.getByRole('alert')).toHaveCount(0)
    await expect(window.getByRole('region', { name: 'Projects' }).getByText('worfy-demo')).toBeVisible()
    await expect(stepOf(window, '3')).toHaveAttribute('aria-current', 'step')
    await shoot(window, 'steps-1-2')

    // Step 3: the demo's Orchestrator opens with the question ready in its field; nothing is sent.
    await stepOf(window, '3').getByRole('button', { name: 'Open the Orchestrator' }).click()
    const field = window.getByRole('textbox', { name: 'Message Orchestrator' })
    await expect(field).toHaveValue(QUESTION)
    await expect(window.getByTestId('session-view')).toBeVisible()
    await expect(field).toBeEnabled({ timeout: ms(30_000) })
    await expect(field).toHaveValue(QUESTION)
    expect(messagesSent(agentLog)).toEqual([])

    // In the Session view the panel stands under the Session's header (owner's decision Q22): at
    // 1280 px Hide tools, Interrupt and the ⌘F find bar are not covered — the point at the centre of
    // each hits the control itself. On the Canvas it is back under the toolbar.
    await expect.poll(async () => (await viewport(window)).width).toBe(1280)
    const session = sessionViewOf(window)
    await expectInCorner(window, 'session')
    const inSession = (testId: string): string => `.w-shell__view[data-view="session"] [data-testid="${testId}"]`
    expect(await hitsAtCentre(window, inSession('session-hide-tools'))).toBe(true)
    expect(await hitsAtCentre(window, inSession('session-interrupt'))).toBe(true)
    await window.keyboard.press('ControlOrMeta+f')
    const find = session.getByTestId('session-find')
    await expect(find).toBeVisible()
    expect(await hitsAtCentre(window, inSession('session-find'))).toBe(true)
    // The toast of Skip moves below the panel there too (toasts are placed again every 200 ms). It hides itself
    // after 4 s and creating the demo can take longer, so it is shown afresh and held under the pointer.
    await skipAndReopen(window)
    const skipped = window.getByTestId('toasts').getByText(SKIPPED)
    await skipped.hover()
    await expect
      .poll(async () => {
        const [toast, panel] = [await skipped.boundingBox(), await sectionOf(window).boundingBox()]
        if (toast === null || panel === null) return `toast ${JSON.stringify(toast)}, panel ${JSON.stringify(panel)}`
        return toast.y >= panel.y + panel.height ? 'below' : `toast at ${toast.y}, panel ends at ${panel.y + panel.height}`
      })
      .toBe('below')
    await shoot(window, 'session-view', { whole: false, target: window.locator('body') })
    await session.getByTestId('session-find-input').press('Escape')
    await expect(find).toHaveCount(0)
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    await expectInCorner(window)
    await shoot(window, 'canvas', { whole: false, target: window.locator('body') })
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Session' }).click()
    await expect(session).toBeVisible()

    // The Orchestrator has answered (written as main writes it): the hint of step 3 stands under step 4,
    // the cost switch under step 2. In a 1200 × 900 window the panel shows all of it without scrolling.
    markSteps(dataDir, ['3'])
    await skipAndReopen(window)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 900))
    await expect.poll(async () => (await viewport(window)).height).toBe(900)
    await expect(stepOf(window, '4').getByTestId('getting-started-hint')).toHaveAttribute('data-hint', 'epic-ticket', { timeout: ms(20_000) })
    await expect(stepOf(window, '2').getByTestId('getting-started-cost')).toBeVisible()
    await expectInCorner(window, 'session')
    expect(await overflowOf(window)).toBe(0)
    await shoot(window, 'step-4-hint')

    // All six marked: the panel read again after Skip shows the screen Done (ticket 10), and "Show steps" all six.
    markSteps(dataDir, ['4', '5', '6'])
    await skipAndReopen(window)
    await expect(section.getByTestId('getting-started-done')).toBeVisible()
    await shoot(window, 'done')
    await section.getByTestId('getting-started-done').getByRole('button', { name: 'Show steps' }).click()
    await expect(section.locator('[data-testid="getting-started-step"][data-done="true"]')).toHaveCount(6)
    await expect(section.locator('[aria-current="step"]')).toHaveCount(0)
    // Under "Show steps" the steps stand with the line of the last step's hint, and step 5 says the
    // review found nothing; the body may scroll: each step is checked to be visible instead.
    for (const step of await section.getByTestId('getting-started-step').all()) {
      await step.scrollIntoViewIfNeeded()
      await expect(step).toBeVisible()
    }
    await shoot(window, 'all-six', { whole: false })
    // The question is still not sent.
    expect(messagesSent(agentLog)).toEqual([])
  } finally {
    await launched.close()
  }
})

test('the panel is a layer under the dialogs: clicks beside it reach the Canvas and the toolbar, First run, the palette and Settings open over it; the smallest window scrolls inside it', async () => {
  const launched = await launchApp({ env: { ...homes(), WORFY_GETTING_STARTED_AUTO: '1' } })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))
    const panel = sectionOf(window)
    await expect(panel).toBeVisible()
    await expectInCorner(window)
    const box = (await panel.boundingBox())!

    // Not modal: no backdrop, no dialog, and the focus stays where it was.
    await expect(window.getByRole('dialog')).toHaveCount(0)
    await expect(panel.locator(':focus')).toHaveCount(0)

    // A click just left of the panel, at its middle, reaches the Canvas under it.
    await window.evaluate(() => {
      const page = globalThis as unknown as { pressedViews: string[]; document: { addEventListener(type: string, listener: (event: { target: unknown }) => void, capture: boolean): void } }
      page.pressedViews = []
      page.document.addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target as { closest(selector: string): { getAttribute(name: string): string | null } | null }
          page.pressedViews.push(target.closest('[data-testid="getting-started"]') !== null ? 'panel' : (target.closest('[data-view]')?.getAttribute('data-view') ?? 'other'))
        },
        true,
      )
    })
    const pressed = (): Promise<string[]> => window.evaluate(() => (globalThis as unknown as { pressedViews: string[] }).pressedViews)
    await window.mouse.click(box.x - 12, box.y + box.height / 2)
    // And one just under it.
    await window.mouse.click(box.x + box.width / 2, box.y + box.height + 12)
    expect(await pressed()).toEqual(['canvas', 'canvas'])
    // The toolbar's "Search or run…" over the panel takes its click: the palette opens.
    await window.getByTestId('palette-trigger').click()
    await expect(window.getByTestId('command-palette')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('command-palette')).toHaveCount(0)

    // What stands at the panel's centre once a dialog is open: the dialog or its backdrop, not the panel.
    const atPanelCentre = (dialog: string): Promise<{ inPanel: boolean; inDialog: boolean }> =>
      window.evaluate(
        ({ dialog, x, y }) => {
          type El = { contains(other: unknown): boolean; previousElementSibling: unknown }
          const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): El | null; querySelector(selector: string): El | null } }).document
          const hit = doc.elementFromPoint(x, y)
          const layer = doc.querySelector(`[data-testid="${dialog}"]`)
          const own = doc.querySelector('[data-testid="getting-started"]')
          return {
            inPanel: hit !== null && own !== null && own.contains(hit),
            inDialog: hit !== null && layer !== null && (layer.contains(hit) || hit.contains(layer) || layer.previousElementSibling === hit),
          }
        },
        { dialog, x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )

    // First run, opened by the panel's own "Open checks" (step 1 is current).
    await panel.getByRole('button', { name: 'Open checks' }).click()
    await expect(window.getByTestId('first-run')).toBeVisible()
    expect(await atPanelCentre('first-run')).toEqual({ inPanel: false, inDialog: true })
    await window.getByTestId('first-run').getByRole('button', { name: 'Close' }).click()
    await expect(window.getByTestId('first-run')).toHaveCount(0)

    await window.keyboard.press('ControlOrMeta+k')
    await expect(window.getByTestId('command-palette')).toBeVisible()
    expect(await atPanelCentre('command-palette')).toEqual({ inPanel: false, inDialog: true })
    await window.keyboard.press('Escape')

    await paletteCommand(window, 'Settings…', 'settings')
    await expect(window.getByTestId('settings')).toBeVisible()
    expect(await atPanelCentre('settings')).toEqual({ inPanel: false, inDialog: true })
    await window.getByTestId('settings-close').click()
    await expect(window.getByTestId('settings')).toHaveCount(0)

    // The smallest window worfy allows: the panel takes at most 70 % of its height, and its content scrolls inside.
    const smallest = await smallestWindow(launched)
    await expect.poll(async () => ((await panel.boundingBox())?.height ?? Infinity) <= 0.7 * smallest.height + 1).toBe(true)
    expect(await overflowOf(window)).toBeGreaterThan(0)
    await expectInCorner(window)
    await shoot(window, 'smallest-window', { whole: false, target: window.locator('body') })
  } finally {
    await launched.close()
  }
})

test('Collapse leaves the pill "Getting started · n/6"; a restart keeps the pill; the palette\'s "Getting started" expands the panel', async () => {
  const dataDir = join(scratch, 'data')
  mkdirSync(dataDir, { recursive: true })
  const env = { ...homes(), WORFY_GETTING_STARTED_AUTO: '1', WORFY_DATA_DIR: dataDir }
  let launched = await launchApp({ env })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))
    await expect(sectionOf(window)).toBeVisible()
    markSteps(dataDir, ['1'])
    await skipAndReopen(window)
    await expect(stepOf(window, '1')).toHaveAttribute('data-done', 'true')

    const collapse = sectionOf(window).getByRole('button', { name: 'Collapse' })
    await expect(collapse).toHaveAttribute('title', 'Collapse')
    await collapse.click()
    const pill = window.getByTestId('getting-started-pill')
    await expect(pill).toHaveText('Getting started · 1/6')
    await expect(sectionOf(window)).toHaveCount(0)
    await expect(pill).toBeFocused()
    // The pill stands in the same corner.
    const shown = (await pill.boundingBox())!
    const page = await viewport(window)
    expect(page.width - (shown.x + shown.width)).toBeLessThanOrEqual(24)
    await shoot(window, 'pill', { whole: false, target: pill })
  } finally {
    await launched.close()
  }

  launched = await launchApp({ env })
  try {
    const { window } = launched
    const pill = window.getByTestId('getting-started-pill')
    await expect(pill).toHaveText('Getting started · 1/6')
    await expect(sectionOf(window)).toHaveCount(0)
    await paletteCommand(window, 'Getting started')
    await expect(sectionOf(window)).toBeVisible()
    await expect(pill).toHaveCount(0)
    await expect(sectionOf(window).getByRole('heading', { name: 'Getting started' })).toBeFocused()
    // Collapse again, then the pill: expanded, with the focus on the heading.
    await sectionOf(window).getByRole('button', { name: 'Collapse' }).click()
    await pill.click()
    await expect(sectionOf(window)).toBeVisible()
    await expect(sectionOf(window).getByRole('heading', { name: 'Getting started' })).toBeFocused()
  } finally {
    await launched.close()
  }
})

test('"Connect…" opens the same Add project as "+" of Projects: the system folder picker', async () => {
  const launched = await launchApp({ env: { ...homes(), WORFY_GETTING_STARTED_AUTO: '1' } })
  try {
    const { app, window } = launched
    // The picker of this Machine, recorded and cancelled.
    await app.evaluate(({ dialog }) => {
      const asked: unknown[] = []
      ;(globalThis as { pickerCalls?: unknown[] }).pickerCalls = asked
      dialog.showOpenDialog = ((...args: unknown[]) => {
        asked.push(args.at(-1))
        return Promise.resolve({ canceled: true, filePaths: [] })
      }) as typeof dialog.showOpenDialog
    })
    const calls = (): Promise<string[]> => app.evaluate(() => ((globalThis as { pickerCalls?: unknown[] }).pickerCalls ?? []).map((options) => JSON.stringify(options)))

    await expect(sectionOf(window)).toBeVisible()
    await window.getByRole('button', { name: 'Add project' }).click()
    await expect.poll(calls).toHaveLength(1)
    await sectionOf(window).getByRole('button', { name: 'Connect…' }).click()
    await expect.poll(calls).toHaveLength(2)
    const [plus, connect] = await calls()
    expect(connect).toBe(plus)
  } finally {
    await launched.close()
  }
})
