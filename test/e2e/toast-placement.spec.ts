import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { catScript, loginProfileWithNode } from '../harness-node'
import { canvasReady, launchApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// Where the toasts go (worfy-ui ticket 16), in the built app at 1280×800 and 1024×768: an `error`
// toast stays until it is closed, so wherever it sits it covers what is under it. With one on
// screen, the test opens what the user works with in the right column — focus mode on a Ticket
// whose title takes two lines and that has a blockers line, the Command palette with its results,
// the Settings window, the Session view — and checks every control there: its box does not meet a
// toast's box, and the element at its centre (document.elementFromPoint) is the control itself, not
// a toast. The error is a real one: main's `claudeHome.live` answers with a failure, as when the
// Claude home cannot be read, for a Project with a live Session (a `sleep` process in its registry).

test.setTimeout(180_000)

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-00000016'
const EPIC = 'demo'
const SESSION = 'e0000000-0000-4000-8000-000000000016'
const SETTINGS_MENU_ITEM_ID = 'app.settings'
const TITLE =
  'Rate limit the bids of every lot across the auction house, the night queue and the moderation screens, so that one seller who floods the queue never pushes the others out of the morning wave'
const LIVE_FAILURE = 'the e2e test refuses the live list'

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const

let scratch: string
const processes: ChildProcess[] = []

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-toast-placement-')))
})

test.afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    child.kill('SIGTERM')
    await exited
  }
  await removeDir(scratch)
})

/** What one check found: the controls it looked at, the ones a toast covers, and the toasts' boxes. */
interface Clearance {
  toasts: number
  checked: string[]
  covered: string[]
}

/**
 * Runs in the page (as text: the e2e typecheck has no DOM library). Every visible control inside
 * the elements matching `selector`: a toast's box must not meet the part of it that can be seen,
 * and the element at the centre of that part must not be inside the toasts' region. With `withRoots`
 * the matching elements themselves are checked too (a header).
 */
const CLEARANCE = `(selector, withRoots) => {
  const region = document.querySelector('[data-testid="toasts"]')
  const toasts = [...region.querySelectorAll('.w-toast')].map((toast) => toast.getBoundingClientRect())
  const controls = [...document.querySelectorAll(selector)].flatMap((root) => [
    ...(withRoots ? [root] : []),
    ...root.querySelectorAll('button, input, textarea, select, a[href], [role="option"], [role="menuitem"], [role="switch"], [role="tab"]'),
  ])
  const checked = []
  const covered = []
  // The part of a control that can be seen: a list that scrolls (the palette's results) cuts the rest.
  const visibleBox = (element) => {
    const own = element.getBoundingClientRect()
    let box = { left: own.left, top: own.top, right: own.right, bottom: own.bottom }
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const clip = parent.getBoundingClientRect()
      box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) }
    }
    box = { left: Math.max(box.left, 0), top: Math.max(box.top, 0), right: Math.min(box.right, innerWidth), bottom: Math.min(box.bottom, innerHeight) }
    return { ...box, width: box.right - box.left, height: box.bottom - box.top }
  }
  for (const control of controls) {
    const box = visibleBox(control)
    if (box.width <= 0 || box.height <= 0) continue
    const name = (control.getAttribute('aria-label') || control.textContent || control.getAttribute('placeholder') || control.tagName).trim().slice(0, 40)
    checked.push(name)
    const meets = toasts.some((toast) => toast.left < box.right && toast.right > box.left && toast.top < box.bottom && toast.bottom > box.top)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (meets || (hit !== null && region.contains(hit))) covered.push(name + ' @' + Math.round(box.left) + ',' + Math.round(box.top))
  }
  return { toasts: toasts.length, checked, covered }
}`

async function clearance(window: Page, selector: string, withRoots: boolean): Promise<Clearance> {
  return (await window.evaluate(`(${CLEARANCE})(${JSON.stringify(selector)}, ${String(withRoots)})`)) as Clearance
}

/** Polls until no control under `selector` is covered (the stack is measured again every 200 ms), then returns the last check. */
async function expectClear(window: Page, selector: string, what: string, withRoots = false): Promise<Clearance> {
  let last: Clearance = { toasts: 0, checked: [], covered: [] }
  await expect
    .poll(
      async () => {
        last = await clearance(window, selector, withRoots)
        return last.covered
      },
      { timeout: 5000, message: `controls of ${what} that a toast covers` },
    )
    .toEqual([])
  expect(last.toasts, `the error toast is on screen over ${what}`).toBe(1)
  return last
}

async function resize(app: ElectronApplication, window: Page, size: { width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setSize(wanted.width, wanted.height), size)
  await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(size.width)
}

async function failLiveSessions(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, error) => {
    ipcMain.removeHandler('worfy:claudeHome.live')
    ipcMain.handle('worfy:claudeHome.live', () => ({ ok: false, error: `claudeHome.live: ${error}` }))
  }, LIVE_FAILURE)
}

test('an error toast that stays covers no control: focus mode on a Ticket, the Command palette, Settings and the Session view, at 1280×800 and 1024×768', async () => {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '02-queue.md'), ['# 02 — Queue', '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  writeFileSync(
    join(issues, '07-rate-limit.md'),
    [`# 07 — ${TITLE}`, '', 'Type: task', 'Status: open', 'Blocked by: 02', '', '## Что делаем', '', 'Limit the bids.', ''].join('\n'),
  )

  const home = join(scratch, 'home')
  mkdirSync(home)
  loginProfileWithNode(home)
  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [
        { epic: EPIC, num: 2, slug: 'queue', title: '02 — Queue', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true },
        { epic: EPIC, num: 7, slug: 'rate-limit', title: `07 — ${TITLE}`, statusRaw: 'open', state: 'open', blockedRaw: '02', blockedNums: [2], blockedParsed: true },
      ],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  // A Claude Code started in a terminal in the Project: its transcript, then its registry entry.
  const transcripts = join(claudeHome, 'projects', repo.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(transcripts, { recursive: true })
  writeFileSync(
    join(transcripts, `${SESSION}.jsonl`),
    `${JSON.stringify({ type: 'user', uuid: 'u1', sessionId: SESSION, isSidechain: false, timestamp: '2026-10-21T10:00:00.000Z', cwd: repo, message: { role: 'user', content: 'Look at the queue' } })}\n`,
  )
  const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(claude)
  writeFileSync(
    join(claudeHome, 'sessions', `${claude.pid}.json`),
    JSON.stringify({ pid: claude.pid, sessionId: SESSION, cwd: repo, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'queue-look' }),
  )

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))

  const launched = await launchApp({
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'),
      HARNESS_HOME: join(scratch, 'no-harness-home'),
      HOME: home,
      SHELL: '/bin/sh',
    },
  })
  try {
    const { app, window } = launched
    await failLiveSessions(app)
    const card = window.locator(`.react-flow__node [data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="7"]`)
    await canvasReady(launched, { size: SIZES[0] })
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('1 live')

    // The poll of the live Sessions fails: one error toast, and it stays.
    const toast = window.getByTestId('toasts').getByRole('alert').locator('.w-toast')
    await expect(toast).toHaveText(`Live Sessions not read: claudeHome.live: ${LIVE_FAILURE}`, { timeout: 10_000 })
    await expect(toast).toHaveAttribute('data-kind', 'error')

    // The Session view: the Orchestrator's (Interrupt at the right end of its header) and the live
    // Session's (a header without buttons). The header itself and its controls stay clear, at both sizes.
    const sessionView = window.locator('.w-shell__view[data-view="session"]')
    const header = '.w-shell__view[data-view="session"] .w-session__header'
    const palette = window.getByTestId('command-palette')
    const toCanvas = async (): Promise<void> => {
      await window.keyboard.press('ControlOrMeta+k')
      await palette.getByRole('combobox').fill('Switch to Canvas')
      await expect(palette.getByRole('option').first()).toHaveText(/Switch to Canvas/)
      await window.keyboard.press('Enter')
      await expect(sessionView).toBeHidden()
    }
    await window.getByTestId('orchestrator-node').locator('.w-orchestrator__header').dblclick()
    await expect(sessionView.getByTestId('session-interrupt')).toBeVisible()
    for (const size of [...SIZES].reverse()) {
      await resize(app, window, size)
      const inHeader = await expectClear(window, header, `the Orchestrator's header at ${size.width}×${size.height}`, true)
      expect(inHeader.checked.length, 'the header and its Interrupt button').toBeGreaterThanOrEqual(2)
    }
    await toCanvas()
    await window.locator(`[data-testid="sidebar-session"][data-session-id="${SESSION}"]`).click()
    await window.locator(`[data-testid="session-node"][data-session-id="${SESSION}"]`).getByTestId('session-node-title').dblclick()
    await expect(sessionView.getByTestId('session-view')).toHaveAttribute('data-session-id', SESSION)
    for (const size of SIZES) {
      await resize(app, window, size)
      await expectClear(window, header, `the live Session's header at ${size.width}×${size.height}`, true)
    }
    await toCanvas()

    for (const size of SIZES) {
      const label = `${size.width}×${size.height}`
      await canvasReady(launched, { size })
      // The Session Node moved the Epic frame aside: "Go to" in the palette brings the Ticket into view.
      await window.keyboard.press('ControlOrMeta+k')
      await window.locator(`[data-testid="palette-option"][data-command="ticket:${EPIC}/07"]`).click()
      await expect(card).toBeVisible()

      // Focus mode on the Ticket: the title takes two lines and the blockers line is under it.
      await card.dblclick()
      const layer = window.getByTestId('focus-mode')
      await expect(layer).toBeVisible()
      const focused = layer.getByTestId('ticket-node')
      await expect(focused).toHaveAttribute('data-focused', 'true')
      const title = focused.locator('.w-ticket__title')
      const lines = await title.evaluate((element) => {
        const box = (element as unknown as { getBoundingClientRect(): { height: number } }).getBoundingClientRect()
        const style = (globalThis as unknown as { getComputedStyle(e: unknown): { lineHeight: string } }).getComputedStyle(element)
        return Math.round(box.height / Number.parseFloat(style.lineHeight))
      })
      expect(lines, `the title takes two lines or more at ${label}`).toBeGreaterThanOrEqual(2)
      await expect(focused.locator('.w-ticket__meta')).toContainText('02')
      await expect(focused.getByRole('button', { name: 'Ship ticket' })).toBeVisible()
      const inFocus = await expectClear(window, '[data-testid="focus-mode"]', `focus mode at ${label}`)
      expect(inFocus.checked).toEqual(expect.arrayContaining(['Open in editor', 'Ship ticket']))
      await snapshotThemes(window, `toast-focus-${size.width}`)
      await window.keyboard.press('Escape')
      await expect(layer).toHaveCount(0)

      // The Command palette with its results.
      await window.keyboard.press('ControlOrMeta+k')
      await expect(palette).toBeVisible()
      await expect.poll(() => palette.getByRole('option').count(), { message: 'results in the palette' }).toBeGreaterThanOrEqual(6)
      const inPalette = await expectClear(window, '[data-testid="command-palette"]', `the Command palette at ${label}`)
      expect(inPalette.checked.length, 'the field and six results at least').toBeGreaterThanOrEqual(7)
      await window.keyboard.press('Escape')
      await expect(palette).toHaveCount(0)

      // The Settings window: its rows and its buttons.
      await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
      const settings = window.getByTestId('settings')
      await expect(settings).toBeVisible()
      const inSettings = await expectClear(window, '[data-testid="settings"]', `Settings at ${label}`)
      expect(inSettings.checked.length, 'the controls of Settings').toBeGreaterThanOrEqual(3)
      await window.keyboard.press('Escape')
      await expect(settings).toHaveCount(0)
    }

    await expect(toast).toHaveCount(1)
  } finally {
    await launched.close()
  }
})
