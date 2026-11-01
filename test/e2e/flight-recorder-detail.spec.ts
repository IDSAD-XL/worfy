import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { projectDirName } from '../../src/main/claude-home/registry'
import { ms } from '../time-scale'
import { launchApp, type LaunchedApp } from './helpers'
import { relocatedJsonText } from './relocate-fixture'

// The details of the Run history screen (worfy-flight-recorder ticket 19) in the built app on the fake agent,
// over the night Run of test/fixtures/flight-recorder/night-run/: its Journal, its transcripts as
// WORFY_CLAUDE_HOME, its gate logs as the Harness home, gh through the fixture's stand-in (WORFY_GH). The
// fixture is copied with its root replaced by a folder of the test, which is a git repository whose remote
// `origin` is an SSH address: main gives the screen its page, https://github.com/someone/worfy.
//
// gh fails first (the stand-in's FR_GH_FAIL file is there): «GitHub did not answer» with «Retry»; a «Retry»
// while gh still fails keeps it, one after gh answers takes it away. Then a click on a bar opens the panel
// — Overview, Links, Source — the PR opens in the browser (shell.openExternal is replaced by a recorder in
// main), the transcript of an agent in its Subagent's view; selecting the retry #2 outlines its cause, a
// Wait and an Orchestrator turn mark the rows of their Tickets; «Problems only» and the filter by Ticket
// change the tree and give it back.

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'flight-recorder')
const NIGHT = join(FIXTURES, 'night-run')
const STAND_IN = join(FIXTURES, 'gh-night-run.mjs')
const NIGHT_ROOT = '/Users/someone/Stuff/CanvasForAI'
const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
const PROJECT = 'CanvasForAI-38cb72ec'
const SESSION = 'f6ab7045-416c-471a-a78d-433567aefa5a'
const IMPL_07_RETRY = 'agent:a60e687cd0ab6803e#2'
const VERIFY_07 = 'agent:adb147aa44e4451c4#1'
const IMPL_03 = 'agent:a4f4ef600ce73b83a#1'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-fr-detail-')))
})
test.afterEach(async () => {
  await removeDir(scratch)
})

/** Copies a folder of the fixture with the night Run's root replaced in every name and file, as JSON spells it. */
function copyRelocated(from: string, to: string, root: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const source = join(from, entry)
    const target = join(to, entry.replaceAll(projectDirName(NIGHT_ROOT), projectDirName(root)))
    if (statSync(source).isDirectory()) copyRelocated(source, target, root)
    else writeFileSync(target, relocatedJsonText(readFileSync(source, 'utf8'), NIGHT_ROOT, root))
  }
}

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, env, stdio: 'ignore' })
}

/** The night Run's Project in a folder of the test, a git repository with an SSH origin; gh failing until `heal`. */
function prepareNight() {
  const root = join(scratch, 'CanvasForAI')
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q')
  git(root, 'remote', 'add', 'origin', 'git@github.com:someone/worfy.git')
  const dataDir = join(scratch, 'data')
  copyRelocated(join(NIGHT, 'data'), dataDir, root)
  copyRelocated(join(NIGHT, 'claude'), join(scratch, 'claude'), root)
  copyRelocated(join(NIGHT, 'harness'), join(scratch, 'harness'), root)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'CanvasForAI', path: root }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
  const log = join(scratch, 'gh.jsonl')
  writeFileSync(log, '')
  const fail = join(scratch, 'gh-fail')
  writeFileSync(fail, 'error connecting to api.github.com')
  const env = {
    WORFY_DATA_DIR: dataDir,
    WORFY_CLAUDE_HOME: join(scratch, 'claude'),
    WORFY_HARNESS_HOME: join(scratch, 'harness'),
    WORFY_GH: STAND_IN,
    FR_GH_DIR: join(NIGHT, 'gh'),
    FR_GH_LOG: log,
    FR_GH_FAIL: fail,
    FR_GH_ACCOUNT: 'owner',
    FR_GH_TOKEN: 'token',
    // No token of the developer's shell reaches the stand-in, which logs it.
    GH_TOKEN: '',
  }
  /** The calls gh got so far, but the keyring's `auth token`. */
  const ghCalls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '' && (JSON.parse(line) as { args: string[] }).args.join(' ') !== 'auth token').length
  return { env, heal: () => rm(fail, { force: true }), ghCalls }
}

/** Defines the page's hook before the app's scripts run, loads the window again, and waits for the shell. */
async function withHook(launched: LaunchedApp): Promise<void> {
  await launched.app.context().addInitScript(() => {
    ;(globalThis as unknown as { __worfyRunHistory: object }).__worfyRunHistory = {}
  })
  await launched.window.reload()
  await expect(launched.window.getByTestId('app-shell')).toBeVisible()
  await expect.poll(() => launched.window.evaluate(() => typeof (globalThis as unknown as { __worfyRunHistory?: { open?: unknown } }).__worfyRunHistory?.open)).toBe('function')
}

const openHistory = (window: Page) =>
  window.evaluate(([project, run]) => (globalThis as unknown as { __worfyRunHistory: { open: (p: string, r?: string) => Promise<void> } }).__worfyRunHistory.open(project, run), [PROJECT, NIGHT_RUN] as const)

const EVIDENCE = (name: string) => test.info().outputPath(`19-${name}.png`)

/** The screen in both themes, kept with the test's output for the review. */
async function snapshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.getByTestId('run-history').screenshot({ path: EVIDENCE(`${name}-${scheme}`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** The contrast of the filter's placeholder on the field's ground (WCAG), in the theme shown. */
const placeholderContrast = (window: Page): Promise<number> =>
  window.getByTestId('run-history-filter').evaluate((input) => {
    // The spec has no DOM types: the page's own, as narrow as needed.
    interface Box {
      parentElement: Box | null
    }
    const { getComputedStyle } = globalThis as unknown as { getComputedStyle: (element: Box, pseudo?: string) => { color: string; backgroundColor: string } }
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number)
    let ground: Box | null = input as unknown as Box
    let back = rgb(getComputedStyle(ground).backgroundColor)
    while (ground !== null && (back.length === 4 && back[3] === 0)) {
      ground = ground.parentElement
      back = ground === null ? [255, 255, 255] : rgb(getComputedStyle(ground).backgroundColor)
    }
    const luminance = ([r, g, b]: number[]) => {
      const channel = (value: number) => {
        const c = value / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
    }
    const [a, b] = [luminance(rgb(getComputedStyle(input as unknown as Box, '::placeholder').color)), luminance(back)].sort((x, y) => y - x)
    return (a! + 0.05) / (b! + 0.05)
  })

const rowOf = (window: Page, id: string): Locator => window.locator(`[data-testid="run-history-row"][data-row-id="${id}"]`)
const ticketRows = (window: Page) => window.locator('[data-testid="run-history-row"][data-kind="ticket"]')

test('the detail panel, «Retry» of GitHub, the outline of a retry cause, the rows of a Wait and a turn, «Problems only» and the filter', async () => {
  test.setTimeout(ms(180_000))
  const { env, heal, ghCalls } = prepareNight()
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    // The browser is not opened: main keeps the addresses it was asked to open.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { opened: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    const opened = () => app.evaluate(() => [...(globalThis as unknown as { opened: string[] }).opened])
    await withHook(launched)
    await openHistory(window)
    await expect(window.getByTestId('run-history-epic')).toHaveText('worfy-pipeline')

    // gh fails: the notice with «Retry», and the CI bars of the Tickets labelled.
    const notice = window.getByTestId('run-history-github')
    await expect(notice).toContainText('GitHub did not answer: ')
    await expect(notice).toContainText('error connecting to api.github.com')
    await expect(window.locator('.w-fr-bar--lost.w-fr-bar--ci').first()).toBeVisible()
    await expect(window.getByTestId('run-history-rows')).toContainText('GitHub did not answer')
    await snapshots(window, 'github-did-not-answer')
    // «Retry» while gh still fails: gh is asked again, and the label stays.
    const before = ghCalls()
    await notice.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(ghCalls).toBeGreaterThan(before)
    await expect(notice.getByRole('button', { name: 'Retry' })).toBeEnabled()
    await expect(notice).toBeVisible()
    // gh answers: after «Retry» the label is gone.
    await heal()
    await notice.getByRole('button', { name: 'Retry' }).click()
    await expect(notice).toBeHidden()
    await expect(window.locator('.w-fr-bar--lost.w-fr-bar--ci')).toHaveCount(0)
    await expect(window.getByTestId('run-history-rows')).not.toContainText('GitHub did not answer')

    // A click on a bar opens the panel on its span: the retry #2 of impl-07, Overview.
    await window.getByRole('button', { name: 'Expand all', exact: true }).click()
    const panel = window.getByTestId('run-history-detail')
    await expect(panel).toContainText('Click a bar or a row to see its details')
    const retryRow = rowOf(window, IMPL_07_RETRY)
    await retryRow.scrollIntoViewIfNeeded()
    await retryRow.locator(`[data-testid="run-history-bar"][data-span-id="${IMPL_07_RETRY}"]`).click()
    await expect(panel).toHaveAttribute('data-span-id', IMPL_07_RETRY)
    await expect(panel.getByTestId('run-history-detail-kind')).toContainText('Agent (implementer)')
    await expect(panel.getByTestId('run-history-detail-attempt')).toContainText('#2 — retry of verify-07 (rejected)')
    await expect(panel.getByTestId('run-history-detail-path')).toContainText('Run 58e783 › Wave 1 › Ticket 07 › Agent review + Gate & merge › impl-07')
    for (const name of ['start', 'end', 'duration', 'self-time', 'outcome', 'reason']) await expect(panel.getByTestId(`run-history-detail-${name}`)).toBeVisible()
    // The cause of the retry, outlined dashed: verify-07, rejected.
    const cause = rowOf(window, VERIFY_07)
    await expect(cause).toHaveAttribute('data-cause', 'true')
    await expect(cause.locator(`[data-testid="run-history-bar"][data-span-id="${VERIFY_07}"]`)).toHaveClass(/is-cause/)
    const outline = await cause.locator('.w-fr-bar.is-cause').evaluate((bar) => (globalThis as unknown as { getComputedStyle(element: unknown): { outlineStyle: string } }).getComputedStyle(bar).outlineStyle)
    expect(outline).toBe('dashed')
    await snapshots(window, 'overview-retry-cause')

    // Links: the PR at the repository page in the browser.
    await panel.getByRole('tab', { name: 'Links' }).click()
    await snapshots(window, 'links')
    await panel.getByRole('button', { name: 'PR #460' }).click()
    await expect.poll(opened).toEqual(['https://github.com/someone/worfy/pull/460'])
    // Source of the retry.
    await panel.getByRole('tab', { name: 'Source' }).click()
    await expect(panel.getByTestId('run-history-detail-start-source')).toContainText('a transcript')
    await expect(panel.getByTestId('run-history-detail-end-source')).toContainText('a transcript')
    await snapshots(window, 'source')

    // Selecting a Wait: the rows of its Tickets are marked; an Orchestrator turn too.
    await window.locator('[data-testid="run-history-row"][data-row-id="wait:background-tasks:10"] .w-fr-row__tree').click()
    await expect(window.locator('[data-testid="run-history-row"][data-related="true"]')).toHaveCount(2)
    await expect(rowOf(window, 'ticket:worfy-pipeline/04')).toHaveAttribute('data-related', 'true')
    await expect(rowOf(window, 'ticket:worfy-pipeline/05')).toHaveAttribute('data-related', 'true')
    await window.locator(`[data-testid="run-history-row"][data-row-id="turn:${SESSION}:3"] .w-fr-row__tree`).click()
    await expect(window.locator('[data-testid="run-history-row"][data-related="true"]')).toHaveCount(2)
    await expect(rowOf(window, 'ticket:worfy-pipeline/03')).toHaveAttribute('data-related', 'true')
    await expect(rowOf(window, 'ticket:worfy-pipeline/07')).toHaveAttribute('data-related', 'true')
    // The marked Ticket rows on screen for the picture: the lanes and Tickets closed, the turn still selected.
    await window.getByRole('button', { name: 'Collapse', exact: true }).click()
    await expect(rowOf(window, 'ticket:worfy-pipeline/03')).toHaveAttribute('data-related', 'true')
    await snapshots(window, 'turn-related')
    await window.getByRole('button', { name: 'Expand all', exact: true }).click()

    // «Problems only»: the first implementer of 03 ended well and goes; the retry stays. Pressed again, all is back.
    const rows = window.getByTestId('run-history-row')
    const all = await rows.count()
    await expect(rowOf(window, IMPL_03)).toHaveCount(1)
    await window.getByTestId('run-history-problems').click()
    await expect(rowOf(window, IMPL_03)).toHaveCount(0)
    await expect(rowOf(window, IMPL_07_RETRY)).toHaveCount(1)
    await expect(rowOf(window, VERIFY_07)).toHaveCount(1)
    await rowOf(window, IMPL_07_RETRY).scrollIntoViewIfNeeded()
    await snapshots(window, 'problems-only')
    await window.getByTestId('run-history-problems').click()
    await expect(rows).toHaveCount(all)
    // The filter by Ticket: only 05 among the Tickets; cleared, all is back.
    // The placeholder reads in both themes (4.5:1 for text).
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      expect(await placeholderContrast(window)).toBeGreaterThanOrEqual(4.5)
    }
    await window.emulateMedia({ colorScheme: null })
    await window.getByTestId('run-history-filter').fill('05')
    await expect(ticketRows(window)).toHaveCount(1)
    await expect(rowOf(window, 'ticket:worfy-pipeline/05')).toHaveCount(1)
    await snapshots(window, 'filter-ticket')
    await window.getByTestId('run-history-filter').fill('')
    await expect(ticketRows(window)).toHaveCount(4)
    await expect(rows).toHaveCount(all)

    // The transcript of the retry's agent opens in its Subagent's view.
    await retryRow.scrollIntoViewIfNeeded()
    await retryRow.locator('.w-fr-row__tree').click()
    await panel.getByRole('tab', { name: 'Links' }).click()
    await panel.getByRole('button', { name: 'The transcript of impl-07' }).click()
    const session = window.getByTestId('session-view')
    await expect(window.locator('.w-shell__view[data-view="session"]')).toBeVisible()
    await expect(session).toHaveAttribute('data-session-id', SESSION)
    await expect(session).toHaveAttribute('data-agent-id', 'a60e687cd0ab6803e')
    // Its first message, read from its file.
    await expect(session).toContainText('skills `epic-wave`')
  } finally {
    await launched.close()
  }
})
