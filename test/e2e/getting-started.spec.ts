import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { ms } from '../time-scale'

// worfy-onboarding ticket 07: the Getting started section at the top of the sidebar.
//
// A fresh data folder with WORFY_GETTING_STARTED_AUTO=1 is a new user: the section shows, first in
// the sidebar. "Create demo project" runs the real creation (src/main/getting-started/demo.ts) — git,
// and bin/project-connect of this build's Harness copied into the temporary Claude home — in a
// temporary home folder: HOME of the app is a folder of the test, with its own .gitconfig, and the
// app's temporary folder (TMPDIR) another one, since the demo is never created inside the temporary
// folder of the system. The Orchestrator runs on the fake agent; nothing reaches Claude Code.
//
// Step 1 is marked from the first-run checks, which this spec does not run (first-run.spec.ts does):
// the spec writes the mark into getting-started.json, the way main would, and Skip and the Command
// palette's "Getting started" bring the section back with it read again.
//
// Screenshots of the section in both themes (steps 1–2 marked; all six marked) go to the test's
// output as 07-section-<what>-<theme>.png.

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

/** The app's home folder and temporary folder, side by side in the test's scratch folder: the home is not inside the temporary one. */
function homes(): Record<string, string> {
  const home = join(scratch, 'home')
  const temp = join(scratch, 'tmp')
  mkdirSync(home, { recursive: true })
  mkdirSync(temp, { recursive: true })
  // The demo's first commit needs an author; git reads it from this home's global config.
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Demo Tester\n\temail = demo@example.com\n')
  return { HOME: home, USERPROFILE: home, TMPDIR: temp, TEMP: temp, TMP: temp }
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

/** Runs a command of the Command palette by its title. */
async function paletteCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('ControlOrMeta+k')
  const input = window.getByTestId('palette-input')
  await expect(input).toBeVisible()
  await input.fill(title)
  await expect(window.locator('[data-testid="palette-option"][data-active="true"]')).toHaveAttribute('data-command', 'getting-started')
  await input.press('Enter')
}

/** "Skip", then the palette's "Getting started": the section comes back with the state read again. */
async function skipAndReopen(window: Page): Promise<void> {
  await sectionOf(window).getByRole('button', { name: 'Skip' }).click()
  await expect(sectionOf(window)).toHaveCount(0)
  await paletteCommand(window, 'Getting started')
  await expect(sectionOf(window)).toBeVisible()
}

/** Screenshots of the section in both themes, kept with the test's output. */
async function shoot(launched: LaunchedApp, name: string): Promise<void> {
  const section = sectionOf(launched.window)
  // The whole section, not a part of a body that scrolls; no focus ring of the palette's focusing.
  expect(await section.locator('.w-sidebar-section__body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBe(0)
  await section.getByRole('button', { name: 'Getting started' }).blur()
  for (const scheme of ['light', 'dark'] as const) {
    await launched.window.emulateMedia({ colorScheme: scheme })
    await section.screenshot({ path: test.info().outputPath(`07-section-${name}-${scheme}.png`) })
  }
  await launched.window.emulateMedia({ colorScheme: null })
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

test('Getting started: first in the sidebar, the demo created, the Orchestrator opened with the question not sent, Skip and the palette', async () => {
  const agentLog = join(scratch, 'agent.jsonl')
  const env = homes()
  const launched = await launchApp({ env: { ...env, WORFY_GETTING_STARTED_AUTO: '1', WORFY_AGENT_LOG: agentLog } })
  try {
    const { app, window, dataDir, claudeHome } = launched
    installHarness(claudeHome)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))

    // A new user: the section shows, first of the sidebar's sections, with step 1 current.
    const section = sectionOf(window)
    await expect(section).toBeVisible()
    await expect(window.getByRole('navigation', { name: 'Sidebar' }).locator('section').first()).toHaveAttribute('data-section-id', 'GettingStartedSection')
    await expect(section.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(6)
    await expect(stepOf(window, '1')).toHaveAttribute('aria-current', 'step')
    await expect(section.getByRole('button', { name: 'Create demo project' })).toHaveCount(0)

    // Step 1's button opens the first-run checks.
    await section.getByRole('button', { name: 'Open checks' }).click()
    const checks = window.getByTestId('first-run')
    await expect(checks).toBeVisible()
    await checks.getByRole('button', { name: 'Close' }).click()
    await expect(checks).toHaveCount(0)

    // The checks passed (written as main writes them); Skip hides the section and says where it comes back from.
    markSteps(dataDir, ['1'])
    await section.getByRole('button', { name: 'Skip' }).click()
    await expect(section).toHaveCount(0)
    await expect(window.getByTestId('toasts')).toContainText(SKIPPED)
    // The palette's "Getting started" shows it again, read anew, and focuses it.
    await paletteCommand(window, 'Getting started')
    await expect(section).toBeVisible()
    await expect(section.getByRole('button', { name: 'Getting started' })).toBeFocused()
    await expect(stepOf(window, '1')).toHaveAttribute('data-done', 'true')
    await expect(stepOf(window, '2')).toHaveAttribute('aria-current', 'step')

    // Step 2: the demo is created in the home folder; main marks the step and the Project is in the list.
    await section.getByRole('button', { name: 'Create demo project' }).click()
    await expect(stepOf(window, '2')).toHaveAttribute('data-done', 'true', { timeout: ms(60_000) })
    await expect(stepOf(window, '2').getByRole('alert')).toHaveCount(0)
    await expect(window.getByRole('region', { name: 'Projects' }).getByText('worfy-demo')).toBeVisible()
    await expect(stepOf(window, '3')).toHaveAttribute('aria-current', 'step')
    await shoot(launched, 'steps-1-2')

    // Step 3: the demo's Orchestrator opens with the question ready in its field; nothing is sent.
    await stepOf(window, '3').getByRole('button', { name: 'Open the Orchestrator' }).click()
    const field = window.getByRole('textbox', { name: 'Message Orchestrator' })
    await expect(field).toHaveValue(QUESTION)
    await expect(window.getByTestId('session-view')).toBeVisible()
    await expect(field).toBeEnabled({ timeout: ms(30_000) })
    await expect(field).toHaveValue(QUESTION)
    expect(messagesSent(agentLog)).toEqual([])

    // All six marked: the section read again after Skip shows them.
    markSteps(dataDir, ['3', '4', '5', '6'])
    await skipAndReopen(window)
    await expect(section.locator('[data-testid="getting-started-step"][data-done="true"]')).toHaveCount(6)
    await expect(section.locator('[aria-current="step"]')).toHaveCount(0)
    await shoot(launched, 'all-six')
    // The question is still not sent.
    expect(messagesSent(agentLog)).toEqual([])
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
