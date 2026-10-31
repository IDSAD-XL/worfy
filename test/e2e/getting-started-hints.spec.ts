import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// worfy-onboarding ticket 09: the hints of the demo Ticket's Stages, the cost switch of the demo's
// Orchestrator and the recorded example of a rework round.
//
// The demo is created for real, as in getting-started.spec.ts: git and bin/project-connect of this
// build's Harness in a temporary home; its Orchestrator runs on the fake agent. No agent moves the
// Ticket: the test writes what the Harness would — the Ticket's Status line, its branch, and the
// marks file of `bin/ticket mark` (<Harness home>/runs/worfy-demo/marks/todo-01.json; the demo has
// no origin, so its marks are kept there). Each change of the marks file is followed by a new time on
// the Status line, so the workflow model changes and the Stages are read again at once.
//
// Every toast of a hint is recorded as it is added to the page (recordHintToasts): each hint is one
// toast, and a restart of the app shows none of those already shown.
//
// Screenshots of the cost switch, of a hint line and of the example, light and dark, go to the test's output as
// 09-<what>-<theme>.png; the whole Getting started panel (ticket 13) with step 5's example open as
// 09-panel-review-example-<theme>.png; in Implementing and in the rework round as
// 09-panel-implementing-<theme>.png and 09-panel-rework-<theme>.png.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundle = join(repoRoot, 'out', 'harness')

const HINTS = {
  'epic-ticket': 'An Epic is a goal; a Ticket is one piece of work in it. Both are files in the project, under .scratch/.',
  implementing: 'The Orchestrator started the work in its own worktree — a separate checkout, so main stays untouched.',
  'agent-review': "The reviewer started. It reads the change and runs the project's checks itself.",
  rework: 'The reviewer found a problem — this is the rework round. The Orchestrator fixes it on the same branch.',
  'gate-merge': "Review passed. The Orchestrator runs the Gate — the project's full checks — and merges.",
  done: 'Merged. The ticket is done.',
} as const

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-gs-hints-')))
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
  writeFileSync(join(dataDir, 'getting-started.json'), `${JSON.stringify({ user: 'new', section: 'shown', reworkSeen: false, noticeShown: false, ...state }, null, 2)}\n`)
}

const readState = (): { hintsSeen?: string[]; reworkSeen?: boolean; steps?: Record<string, string> } =>
  JSON.parse(readFileSync(join(dataDir, 'getting-started.json'), 'utf8')) as { hintsSeen?: string[] }

/** A start of the app over the test's data folder and Claude home: the same ones after a restart. */
function launch(env: Record<string, string>): Promise<LaunchedApp> {
  return launchApp({ env: { ...env, WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_GETTING_STARTED_AUTO: '1' } })
}

/**
 * Records the text of every hint toast added to the page from now on, in `window.hintToasts`: the
 * recorder is installed for each new document, and the window is loaded again to get it.
 */
async function recordHintToasts(launched: LaunchedApp): Promise<void> {
  await launched.app.context().addInitScript(() => {
    const seen = new WeakSet<object>()
    const texts: string[] = []
    ;(globalThis as unknown as { hintToasts: string[] }).hintToasts = texts
    const doc = (globalThis as unknown as { document: { querySelectorAll(selector: string): Iterable<{ textContent: string | null }> } }).document
    const Observer = (globalThis as unknown as { MutationObserver: new (callback: () => void) => { observe(target: unknown, options: object): void } }).MutationObserver
    new Observer(() => {
      for (const toast of doc.querySelectorAll('[data-testid="getting-started-hint-toast"]')) {
        if (seen.has(toast)) continue
        seen.add(toast)
        texts.push(toast.textContent ?? '')
      }
    }).observe(doc, { childList: true, subtree: true })
  })
  await launched.window.reload()
}

const hintToasts = (window: Page): Promise<string[]> => window.evaluate(() => [...(globalThis as unknown as { hintToasts?: string[] }).hintToasts ?? []])

const sectionOf = (window: Page): Locator => window.getByTestId('getting-started')
const stepOf = (window: Page, step: string): Locator => sectionOf(window).locator(`[data-testid="getting-started-step"][data-step="${step}"]`)

/** Runs git in the demo's repository and answers its output. */
const git = (repo: string, ...args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim()

/** The demo Ticket's file, todo 01. */
const ticketFile = (repo: string): string => join(repo, '.scratch', 'todo', 'issues', '01-done-command.md')

let statusTick = 0

/** Rewrites the Ticket's Status line, with a new time each call: the workflow model changes. */
function setStatus(repo: string, state: 'claimed' | 'done'): void {
  statusTick += 1
  const file = ticketFile(repo)
  const at = `2026-10-30T10:${String(statusTick).padStart(2, '0')}Z`
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/mu, `Status: ${state} ${at}`))
}

/** Appends a `review` mark on `sha` to the Ticket's marks file, as `bin/ticket mark` does. */
function markReview(sha: string, verdict: 'pending' | 'failure' | 'success'): void {
  const file = join(harnessHome(), 'runs', 'worfy-demo', 'marks', 'todo-01.json')
  mkdirSync(join(harnessHome(), 'runs', 'worfy-demo', 'marks'), { recursive: true })
  let marks: unknown[] = []
  try {
    marks = (JSON.parse(readFileSync(file, 'utf8')) as { marks: unknown[] }).marks
  } catch {
    // The first mark: no file yet.
  }
  writeFileSync(file, `${JSON.stringify({ epic: 'todo', num: 1, marks: [...marks, { kind: 'review', verdict, sha, at: new Date().toISOString() }] }, null, 2)}\n`)
}

/** The hint line of the panel: under `step`, with this hint. */
async function expectHint(window: Page, step: string, id: keyof typeof HINTS): Promise<void> {
  const line = sectionOf(window).getByTestId('getting-started-hint')
  await expect(line).toHaveCount(1, { timeout: ms(20_000) })
  await expect(line).toHaveAttribute('data-hint', id, { timeout: ms(20_000) })
  await expect(line).toHaveText(HINTS[id])
  await expect(stepOf(window, step).getByTestId('getting-started-hint')).toHaveCount(1)
}

/** The saved picks of the demo's Orchestrator Node: the one session-settings.json under the data folder. */
function savedOrchestratorSettings(): unknown {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else if (entry.name === 'session-settings.json') found.push(join(dir, entry.name))
    }
  }
  walk(dataDir)
  if (found.length !== 1) return found
  return Object.values((JSON.parse(readFileSync(found[0] as string, 'utf8')) as { nodes: Record<string, unknown> }).nodes)
}

/** Light and dark screenshots of `target`, kept with the test's output. */
async function shoot(window: Page, target: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await target.screenshot({ path: test.info().outputPath(`09-${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('each Stage of the demo Ticket gives its hint as a line and one toast; the cost switch changes the Orchestrator; a restart shows no toast again', async () => {
  const env = homes()
  // The checks passed and the Orchestrator has answered (steps mark in any order): step 2 is current.
  const marked = new Date().toISOString()
  writeState({ steps: { '1': marked, '3': marked } })
  installHarness()
  let launched: LaunchedApp | null = await launch(env)
  try {
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))
    await recordHintToasts(launched)
    let window = launched.window
    await expect(stepOf(window, '2')).toHaveAttribute('aria-current', 'step')
    await expect(sectionOf(window).getByTestId('getting-started-cost')).toHaveCount(0)

    // The demo, created for real: its Ticket waits in Queued, step 4 is current.
    await stepOf(window, '2').getByRole('button', { name: 'Create demo project' }).click()
    await expect(stepOf(window, '2')).toHaveAttribute('data-done', 'true', { timeout: ms(60_000) })
    const repo = join(env.HOME as string, 'worfy-demo')
    await expectHint(window, '4', 'epic-ticket')

    // The cost switch under step 2: cheaper by default; Opus saved for the Orchestrator's Node, and back.
    const cost = stepOf(window, '2').getByTestId('getting-started-cost')
    await expect(stepOf(window, '2').getByRole('group', { name: 'Demo agents' })).toBeVisible()
    const cheaper = cost.getByRole('radio', { name: 'Sonnet — a bit cheaper' })
    const expensive = cost.getByRole('radio', { name: 'Opus — a bit more expensive' })
    await expect(cheaper).toBeChecked()
    await shoot(window, cost, 'cost-switch')
    await expensive.check()
    await expect(cost).toHaveAttribute('data-cost', 'more-expensive')
    await expect(expensive).toBeChecked()
    expect(savedOrchestratorSettings()).toEqual([{ model: 'opus', effort: null, permissionMode: 'bypassPermissions' }])
    await cheaper.check()
    await expect(cost).toHaveAttribute('data-cost', 'cheaper')
    expect(savedOrchestratorSettings()).toEqual([{ model: 'sonnet', effort: 'medium', permissionMode: 'bypassPermissions' }])

    // Implementing: claimed, its branch at the first commit.
    git(repo, 'branch', 'todo/01')
    const sha = git(repo, 'rev-parse', 'todo/01')
    setStatus(repo, 'claimed')
    await expectHint(window, '4', 'implementing')
    await shoot(window, sectionOf(window), 'panel-implementing')

    // Agent review: a `review` mark on the head, not yet a verdict.
    markReview(sha, 'pending')
    setStatus(repo, 'claimed')
    await expectHint(window, '5', 'agent-review')

    // The rework round: REJECTED, Implementing again.
    markReview(sha, 'failure')
    setStatus(repo, 'claimed')
    await expectHint(window, '5', 'rework')
    await expect.poll(() => readState().reworkSeen).toBe(true)
    await shoot(window, stepOf(window, '5'), 'hint-line')
    // The whole panel in the rework round: step 5's line and the hint under it.
    await shoot(window, sectionOf(window), 'panel-rework')

    // Gate & merge: VERIFIED.
    markReview(sha, 'success')
    setStatus(repo, 'claimed')
    await expectHint(window, '6', 'gate-merge')
    await expect(stepOf(window, '5')).toHaveAttribute('data-done', 'true')
    // The review found something: no fallback in step 5.
    await expect(sectionOf(window).getByTestId('getting-started-review-example')).toHaveCount(0)

    // One toast per hint, in order.
    await expect.poll(() => hintToasts(window)).toEqual([HINTS['epic-ticket'], HINTS.implementing, HINTS['agent-review'], HINTS.rework, HINTS['gate-merge']])

    // A restart: the line is there again, the toast is not.
    const first = launched
    launched = null
    await first.close()
    launched = await launch(env)
    await recordHintToasts(launched)
    window = launched.window
    await expectHint(window, '6', 'gate-merge')

    // Done: its toast is the only one of this run, so the gate-merge one would have come before it.
    setStatus(repo, 'done')
    // All six marked: the screen Done stands in place of the steps (ticket 10); under "Show steps" the line stays under the last step.
    await sectionOf(window).getByTestId('getting-started-done').getByRole('button', { name: 'Show steps' }).click({ timeout: ms(20_000) })
    await expect(sectionOf(window).locator('[data-testid="getting-started-step"][data-done="true"]')).toHaveCount(6)
    await expectHint(window, '6', 'done')
    await expect.poll(() => hintToasts(window)).toEqual([HINTS.done])
    await expect(window.getByTestId('toasts')).toContainText(HINTS.done)
    expect([...(readState().hintsSeen ?? [])].sort()).toEqual(Object.keys(HINTS).sort())
  } finally {
    await launched?.close()
  }
})

test('step 5 marked without a rework round says the review found nothing and opens the recorded example', async () => {
  const at = new Date().toISOString()
  writeState({ steps: { '1': at, '2': at, '3': at, '4': at, '5': at }, reworkSeen: false })
  const launched = await launch(homes())
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000))
    const fallback = stepOf(window, '5').getByTestId('getting-started-review-example')
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('This time the review found nothing.')
    // In place of what the step was to show; no other step has it.
    await expect(stepOf(window, '5')).not.toContainText('A reviewer checks the work.')
    await expect(sectionOf(window).getByTestId('getting-started-review-example')).toHaveCount(1)

    await fallback.getByRole('button', { name: 'Show an example' }).click()
    const example = fallback.getByRole('list', { name: 'Example of a rework round' })
    await expect(example).toBeFocused()
    await expect(example.getByRole('listitem')).toHaveCount(3)
    await expect(example.getByRole('listitem').nth(0)).toContainText('REJECTED')
    await expect(example.getByRole('listitem').nth(0)).toContainText('done 2 on a task that is already done exits 0 and says nothing')
    await expect(example.getByRole('listitem').nth(1)).toContainText("+if (task.done)\n+ throw Error('Not open')")
    // In the demo the Orchestrator fixes what the review found: no implementer (owner's decision, 2026-10-31).
    await expect(example.getByRole('listitem').nth(1)).toContainText('Orchestrator')
    await expect(example.getByLabel("The Orchestrator's fix")).toBeVisible()
    await expect(example).not.toContainText(/implementer/iu)
    await expect(example.getByRole('listitem').nth(2)).toContainText('VERIFIED')
    await expect(fallback.getByRole('button', { name: 'Show an example' })).toHaveCount(0)
    await example.evaluate((node) => (node as unknown as { blur(): void }).blur())
    await shoot(window, fallback, 'review-example')
    // The whole panel with the example open (ticket 13).
    await shoot(window, sectionOf(window), 'panel-review-example')
  } finally {
    await launched.close()
  }
})
