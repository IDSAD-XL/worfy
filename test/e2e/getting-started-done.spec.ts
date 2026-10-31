import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// worfy-onboarding ticket 10: the screen Done of Getting started and the removal of the Demo project.
//
// The demo is created for real, as in getting-started-hints.spec.ts: git and bin/project-connect of
// this build's Harness in a temporary home; its Orchestrator runs on the fake agent. No agent merges
// the Ticket: the test writes its Status line `done`, which marks step 6. The native confirmation is
// replaced in main, recorded and answered by the test (Cancel first, then Confirm); the folder picker
// of "Connect your own project" too.
//
// Screenshots of the screen Done, light and dark, go to the test's output as 10-done-<theme>.png, and of
// the whole Getting started panel with it (ticket 13) as 10-panel-done-<theme>.png. The toast of the
// removal stands below the panel (ticket 13): the window with both, 10-panel-toast-<theme>.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-gs-done-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(claudeHome, { recursive: true })
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

const harnessHome = (): string => join(claudeHome, 'worfy-harness')

/** This build's Harness in the test's Claude home, with an empty gate registry. */
function installHarness(): void {
  cpSync(bundle, join(harnessHome(), 'plugin'), { recursive: true })
  mkdirSync(join(harnessHome(), 'gate'), { recursive: true })
  writeFileSync(join(harnessHome(), 'gate', 'config.json'), '{"repos":[]}\n')
}

/** getting-started.json as main writes it, before the app starts. */
function writeState(state: Record<string, unknown>): void {
  writeFileSync(join(dataDir, 'getting-started.json'), `${JSON.stringify({ user: 'new', section: 'shown', reworkSeen: true, noticeShown: false, ...state }, null, 2)}\n`)
}

const readState = (): { demo?: unknown; steps?: Record<string, string> } => JSON.parse(readFileSync(join(dataDir, 'getting-started.json'), 'utf8')) as { steps?: Record<string, string> }

const sectionOf = (window: Page): Locator => window.getByTestId('getting-started')
const stepOf = (window: Page, step: string): Locator => sectionOf(window).locator(`[data-testid="getting-started-step"][data-step="${step}"]`)
const doneOf = (window: Page): Locator => sectionOf(window).getByTestId('getting-started-done')

/** Marks the demo Ticket done, as the Orchestrator's merge would: its Status line. */
function markDone(repo: string): void {
  const file = join(repo, '.scratch', 'todo', 'issues', '01-done-command.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/mu, `Status: done ${new Date().toISOString().slice(0, 16)}Z`))
}

interface ShownDialog {
  message?: string
  detail?: string
  buttons?: string[]
  cancelId?: number
  defaultId?: number
}

/** Replaces the native message box in main: it answers `response` and records what it was asked. */
async function answerDialogs(launched: LaunchedApp, response: number): Promise<void> {
  await launched.app.evaluate(({ dialog }, answer) => {
    const shown = ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ??= [])
    dialog.showMessageBox = ((...args: unknown[]) => {
      shown.push(args.at(-1))
      return Promise.resolve({ response: answer, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
  }, response)
}
const shownDialogs = (launched: LaunchedApp): Promise<ShownDialog[]> => launched.app.evaluate(() => ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []) as ShownDialog[])

/** Light and dark screenshots of `target`, kept with the test's output. */
async function shoot(window: Page, target: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await target.screenshot({ path: test.info().outputPath(`10-${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('step 6 shows Done; Connect opens Add project; Remove asks, Cancel keeps the demo, Confirm removes it from the list and the disk', async () => {
  const env = homes()
  const at = new Date().toISOString()
  writeState({ steps: { '1': at, '3': at, '4': at, '5': at } })
  installHarness()
  const launched = await launch(env)
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))

    // The demo, created for real; its Ticket merged: step 6 is marked, the screen Done stands in place of the steps.
    await stepOf(window, '2').getByRole('button', { name: 'Create demo project' }).click()
    await expect(stepOf(window, '2')).toHaveAttribute('data-done', 'true', { timeout: ms(60_000) })
    const repo = join(env.HOME as string, 'worfy-demo')
    const projectId = (readState().demo as { projectId: string }).projectId
    const row = window.locator(`[data-testid="project-row"][data-project-id="${projectId}"]`)
    await expect(row).toHaveCount(1)
    markDone(repo)
    const done = doneOf(window)
    await expect(done).toBeVisible({ timeout: ms(20_000) })
    await expect(done.getByRole('heading', { name: 'Done — the ticket is merged' })).toBeVisible()
    await expect(done).toContainText('You took one ticket from the Orchestrator through review to main. That is the whole loop.')
    await expect(sectionOf(window).getByTestId('getting-started-step')).toHaveCount(0)
    await shoot(window, done, 'done')
    await shoot(window, sectionOf(window), 'panel-done')

    // "Show steps" brings the list back, all six marked; the panel mounts again with Done.
    await done.getByRole('button', { name: 'Show steps' }).click()
    await expect(sectionOf(window).locator('[data-testid="getting-started-step"][data-done="true"]')).toHaveCount(6)
    await window.reload()
    await expect(doneOf(window)).toBeVisible({ timeout: ms(20_000) })

    // "Connect your own project": the same system folder picker as "+" of Projects, cancelled.
    await app.evaluate(({ dialog }) => {
      const asked: unknown[] = []
      ;(globalThis as { pickerCalls?: unknown[] }).pickerCalls = asked
      dialog.showOpenDialog = ((...args: unknown[]) => {
        asked.push(args.at(-1))
        return Promise.resolve({ canceled: true, filePaths: [] })
      }) as typeof dialog.showOpenDialog
    })
    const pickerCalls = (): Promise<number> => app.evaluate(() => ((globalThis as { pickerCalls?: unknown[] }).pickerCalls ?? []).length)
    await doneOf(window).getByRole('button', { name: 'Connect your own project' }).click()
    await expect.poll(pickerCalls).toBe(1)

    // Remove, then Cancel: the dialog of the spec with the folder; nothing is touched.
    await answerDialogs(launched, 1)
    await doneOf(window).getByRole('button', { name: 'Remove the demo project' }).click()
    await expect.poll(async () => (await shownDialogs(launched)).length).toBe(1)
    const [asked] = await shownDialogs(launched)
    expect(asked).toMatchObject({
      message: 'Remove the demo project?',
      detail: `worfy closes the demo's Sessions, then deletes the folder ${repo}, and its worfy settings. This cannot be undone.`,
      buttons: ['Confirm', 'Cancel'],
      cancelId: 1,
    })
    await expect(doneOf(window).getByRole('button', { name: 'Remove the demo project' })).toBeEnabled()
    expect(existsSync(join(repo, '.git'))).toBe(true)
    await expect(row).toHaveCount(1)
    await expect(sectionOf(window).getByRole('alert')).toHaveCount(0)

    // Remove, then Confirm: out of the sidebar and off the disk, the toast, the steps back from step 2.
    await answerDialogs(launched, 0)
    await doneOf(window).getByRole('button', { name: 'Remove the demo project' }).click()
    await expect(window.getByTestId('getting-started-removed-toast')).toHaveText('The demo project was removed.', { timeout: ms(30_000) })
    // The toast came while the panel is open (ticket 13): it stands below the panel and does not cover
    // it. The panel grows as the steps come back, and the toasts are placed again every 200 ms.
    const belowPanel = async (): Promise<string> => {
      const [toast, panel] = [await window.getByTestId('getting-started-removed-toast').boundingBox(), await sectionOf(window).boundingBox()]
      if (toast === null || panel === null) return `toast ${JSON.stringify(toast)}, panel ${JSON.stringify(panel)}`
      return toast.y >= panel.y + panel.height ? 'below' : `toast at ${toast.y}, panel ends at ${panel.y + panel.height}`
    }
    await expect.poll(belowPanel, { timeout: ms(3_000) }).toBe('below')
    await shoot(window, window.locator('body'), 'panel-toast')
    await expect(row).toHaveCount(0)
    expect(existsSync(repo)).toBe(false)
    expect(readState().demo).toBeUndefined()
    await expect(doneOf(window)).toHaveCount(0)
    await expect(stepOf(window, '1')).toHaveAttribute('data-done', 'true')
    await expect(stepOf(window, '2')).toHaveAttribute('aria-current', 'step')
    await expect(stepOf(window, '2').getByRole('button', { name: 'Create demo project' })).toBeVisible()
  } finally {
    await launched.close()
  }
})

/** A start of the app over the test's data folder and Claude home. */
function launch(env: Record<string, string>): Promise<LaunchedApp> {
  return launchApp({ env: { ...env, WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_GETTING_STARTED_AUTO: '1' } })
}
