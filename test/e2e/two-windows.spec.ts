import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { epicStatusSchema } from '../../src/shared/workflow/types'
import { launchApp, openSecondWindow, repoRoot, type LaunchedApp } from './helpers'
import { catScript, profileJsonScript } from '../harness-node'
import { ms } from '../time-scale'

/**
 * A `bin/profile` stub that knows every folder: `--json` exits 0, a `--field` is absent (exit 4).
 * "Add project" then puts a repository into the list at once, without the dialog that connects a
 * new one (worfy-harness ticket 24).
 */
const KNOWS_ALL = profileJsonScript('{"name":"stub","_resolved":{"workspace":null}}')

// worfy-link ticket 03 against the built app: two windows of one worfy are two clients of main
// (src/main/clients.ts). What one window changes in the shared state — the Layout, the View menu,
// the Project list, an Epic in the Project's folder — reaches the other live, and a window that
// closed is no longer sent anything, without errors in main.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-0000000d'
const EPIC = 'worfy-mvp'
const FIXTURE = join(repoRoot, 'test', 'fixtures', 'worfy-mvp-epic')

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string
let answer: string

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

function makeRepo(path: string): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'README.md'), 'demo\n')
  git(path, 'init', '-q')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'init')
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-two-windows-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'demo')
  // The fixture Epic in the Project's folder; `epic-status` answers from a file the test edits.
  mkdirSync(join(repo, '.scratch', EPIC), { recursive: true })
  cpSync(join(FIXTURE, 'spec.md'), join(repo, '.scratch', EPIC, 'spec.md'))
  cpSync(join(FIXTURE, 'issues'), join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  makeRepo(repo)
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  answer = join(scratch, 'epic-status.json')
  cpSync(join(FIXTURE, 'epic-status.json'), answer)
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)
  writeFileSync(join(claudeHome, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

type Bridge = {
  invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }>
  on(channel: string, handler: (payload: unknown) => void): number
}
type Recorded = { __heard?: Record<string, unknown[]> }

/** Starts recording the events of `channel` the window hears. */
async function record(window: Page, channel: string): Promise<void> {
  await window.evaluate((name) => {
    const page = globalThis as unknown as Recorded & { worfy: Bridge }
    page.__heard ??= {}
    page.__heard[name] = []
    page.worfy.on(name, (payload) => page.__heard?.[name]?.push(payload))
  }, channel)
}

/** The events of `channel` the window heard since `record`. */
const heard = (window: Page, channel: string): Promise<unknown[]> =>
  window.evaluate((name) => [...((globalThis as unknown as Recorded).__heard?.[name] ?? [])], channel)

const invoke = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(({ channel, input }) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(channel, input), { channel, input })

const note = (window: Page, id: string) => window.locator(`[data-testid="note-node"][data-node-id="${id}"]`)
const createNote = (window: Page, id: string, x: number) =>
  invoke(window, 'layout.apply', { projectId: PROJECT, op: { op: 'create', node: { id, kind: 'note', x, y: 40, w: 220, h: 120, data: { text: id } } } })

/** Clicks View ▸ Show Minimap the way the menu does. */
async function toggleMinimapMenu(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('view.minimap')
    if (!item) throw new Error('View ▸ Show Minimap is missing')
    item.click()
    return item.checked
  })
}

/** Replaces the system folder picker in main: the next "Add project" gets `folder`. */
async function pickNext(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}

/** What main logged as a warning or an error, from the moment of the call. */
function mainLog(app: ElectronApplication): string[] {
  const lines: string[] = []
  app.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') lines.push(message.text())
  })
  return lines
}

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

test('two windows of one worfy: the shared state reaches both live; a closed window is sent nothing', async () => {
  const launched = await launch()
  try {
    const { app, window: one } = launched
    const log = mainLog(app)
    await expect(one.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
    const two = await openSecondWindow(launched)
    await expect(two.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)

    // The second window's calls pass the IPC sender check like the first one's.
    expect(await invoke(two, 'layout.get', { projectId: PROJECT })).toMatchObject({ ok: true })

    // The Layout: a Note created in window 1 shows in window 2.
    expect(await createNote(one, 'from-one', 40)).toMatchObject({ ok: true })
    await expect(note(one, 'from-one')).toBeVisible()
    await expect(note(two, 'from-one')).toBeVisible()

    // The View menu: Show Minimap off hides the Minimap in both windows, on shows it again.
    await expect(one.getByRole('img', { name: 'Minimap' })).toBeVisible()
    await expect(two.getByRole('img', { name: 'Minimap' })).toBeVisible()
    expect(await toggleMinimapMenu(app)).toBe(false)
    await expect(one.getByRole('img', { name: 'Minimap' })).toHaveCount(0)
    await expect(two.getByRole('img', { name: 'Minimap' })).toHaveCount(0)
    expect(await toggleMinimapMenu(app)).toBe(true)
    await expect(two.getByRole('img', { name: 'Minimap' })).toBeVisible()

    // The Project list: a Project added in window 1 shows in window 2's list.
    const other = join(scratch, 'other')
    makeRepo(other)
    await pickNext(app, other)
    await one.getByRole('button', { name: 'Add project' }).click()
    await expect(one.getByTestId('project-row').filter({ hasText: 'other' })).toHaveCount(1)
    await expect(two.getByTestId('project-row').filter({ hasText: 'other' })).toHaveCount(1)

    // An Epic in the Project's folder: both windows hear workflow.changed. Each window opens the
    // Project's workflow itself (the sidebar does); opening it again here only makes sure.
    for (const window of [one, two]) {
      await record(window, 'workflow.changed')
      expect(await invoke(window, 'workflow.open', { root: repo })).toMatchObject({ ok: true })
    }
    const snapshot = epicStatusSchema.parse(JSON.parse(readFileSync(answer, 'utf8')))
    const target = snapshot.tickets.find((ticket) => ticket.state !== 'done')
    if (!target) throw new Error('the fixture Epic has no open Ticket')
    const done = { ...target, state: 'done' as const, statusRaw: 'done — 2026-10-08' }
    writeFileSync(answer, JSON.stringify({ ...snapshot, tickets: snapshot.tickets.map((ticket) => (ticket.num === target.num ? done : ticket)) }))
    const file = readdirSync(join(repo, '.scratch', EPIC, 'issues')).find((name) => Number(name.slice(0, 2)) === target.num)
    if (!file) throw new Error(`no file of Ticket ${target.num}`)
    appendFileSync(join(repo, '.scratch', EPIC, 'issues', file), '\n')
    const doneIn = async (window: Page): Promise<boolean> =>
      (await heard(window, 'workflow.changed')).some((delta) =>
        (delta as { tickets: { epic: string; num: number; state: string }[] }).tickets.some((ticket) => ticket.epic === EPIC && ticket.num === target.num && ticket.state === 'done'),
      )
    await expect.poll(() => doneIn(one), { message: 'window 1 hears the Ticket done', timeout: ms(15_000) }).toBe(true)
    await expect.poll(() => doneIn(two), { message: 'window 2 hears the Ticket done', timeout: ms(15_000) }).toBe(true)

    // Window 2 closes: window 1 still hears layout.changed, and main logs no failed send.
    await record(one, 'layout.changed')
    await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      windows.find((each) => each.id === Math.max(...windows.map((window) => window.id)))?.close()
    })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(await createNote(one, 'after-close', 300)).toMatchObject({ ok: true })
    // Heard as an event, not only as the call's answer. The Canvas shows the added Project now, so
    // the Note is looked for in the event rather than on the screen.
    type LayoutEvent = { projectId: string; layout: { nodes: { id: string }[] } }
    const hasNote = async (): Promise<boolean> =>
      ((await heard(one, 'layout.changed')) as LayoutEvent[]).some((state) => state.projectId === PROJECT && state.layout.nodes.some((node) => node.id === 'after-close'))
    await expect.poll(hasNote, { message: 'window 1 hears layout.changed with the new Note' }).toBe(true)
    // The log does hear main: a warning written there now shows in it.
    await app.evaluate(() => console.warn('[two-windows] log check'))
    await expect.poll(() => log.includes('[two-windows] log check')).toBe(true)
    expect(log.filter((line) => /could not send|destroyed/i.test(line))).toEqual([])
  } finally {
    await launched.close()
  }
})

// browser-family.spec.ts once got a Browser's <webview> page from openSecondWindow (gate full of e6802c9e): the
// helper took the app's next page, whatever it was. Here a hidden window opens just before the second one, in the
// helper's own first call into main, so its page comes to Playwright first every time.
test('openSecondWindow gives the window it opened, not a page that opened just before it', async () => {
  const launched = await launch()
  try {
    const { app, window: one } = launched
    await expect(one.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
    await app.evaluate(({ BrowserWindow }) => {
      const original = BrowserWindow.getAllWindows
      BrowserWindow.getAllWindows = () => {
        const windows = original.call(BrowserWindow)
        // The app's own calls (a broadcast to every window) pass through: the decoy is for the helper's call.
        if (/[\\/]out[\\/]main[\\/]/.test(new Error().stack ?? '')) return windows
        BrowserWindow.getAllWindows = original
        const decoy = new BrowserWindow({ show: false, width: 640, height: 410 })
        ;(globalThis as { decoyId?: number }).decoyId = decoy.id
        void decoy.loadURL('about:blank')
        return windows
      }
    })
    const two = await openSecondWindow(launched)
    expect(two.url()).toBe(one.url())
    await expect(two.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(3)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.fromId((globalThis as { decoyId?: number }).decoyId ?? -1)?.destroy())
  } finally {
    await launched.close()
  }
})
