import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, settledBoxes, settledBoxLists, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The selection toolbar (Pin, Tags, Delete) over an Epic frame in the built app, at zoom 1 and 0.6:
// above a Ticket of the frame's top row it would cover the frame's header and the column labels,
// below it the Ticket of the next row, so it goes beside the Ticket; above the Ticket of the next
// row it would cover the Ticket above, so that one gets it beside too; above a Node outside the
// frame it stays on top. The Epic comes from a stub `bin/epic-status` in a temporary
// WORFY_CLAUDE_HOME that prints a ready answer. With WORFY_EVIDENCE_DIR set, the light and dark
// screenshots are copied there.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'demo-0000000d'

/**
 * The Canvas zooms and interface scales (webContents zoom, src/main/settings/interface-scale.ts) the
 * app is opened at: the Orchestrator Node at (40, 40), the frames' column right of it, the note under
 * it. The Focus button's width depends on its label and font, and text does not always scale in
 * step with the window zoom, so the button is measured at more than one interface scale.
 */
const CASES = [
  { zoom: 1, scale: 1 },
  { zoom: 0.6, scale: 1 },
  { zoom: 1, scale: 0.8 },
  { zoom: 1, scale: 1.2 },
] as const

interface Box {
  x: number
  y: number
  width: number
  height: number
}

let scratch: string
let dataDir: string
let claudeHome: string

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

function ticketText(num: number, status: string, blocked: string): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Что делаем', '', 'text', ''].join('\n')
}

/** Tickets of the Epic `demo`: 01 done (the folded stack on the left), 02 and 03 ready (one column, two rows), nothing right of them. */
const TICKETS = [
  { num: 1, status: 'done', blocked: '—', state: 'done', nums: [] as number[] },
  { num: 2, status: 'open', blocked: '—', state: 'open', nums: [] as number[] },
  { num: 3, status: 'open', blocked: '—', state: 'open', nums: [] as number[] },
]

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-toolbar-frame-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# demo: a small Epic\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `0${ticket.num}-t${ticket.num}.md`), ticketText(ticket.num, ticket.status, ticket.blocked))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  const answer = {
    ref: 'main',
    epics: [{ epic: 'demo', hasSpec: true, hasMap: false }],
    tickets: TICKETS.map((ticket) => ({
      epic: 'demo',
      num: ticket.num,
      slug: `t${ticket.num}`,
      title: `0${ticket.num} — Ticket ${ticket.num}`,
      statusRaw: ticket.status,
      state: ticket.state,
      blockedRaw: ticket.blocked,
      blockedNums: ticket.nums,
      blockedParsed: true,
    })),
  }
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answerFile = join(claudeHome, 'epic-status.json')
  writeFileSync(answerFile, JSON.stringify(answer))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answerFile))
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
})

/**
 * The Layout the app starts with: the Canvas from its origin at `zoom`, and the note outside the
 * frame far enough under the Orchestrator Node that the toolbar above it clears that Node at zoom
 * 0.6 too (12 + 34 screen pixels are 77 canvas units there).
 */
function writeLayout(zoom: number): void {
  const nodes = [{ id: 'outside', kind: 'note', x: 40, y: 360, w: 220, h: 120, data: { text: 'outside' } }]
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 0, y: 0, zoom } }))
}

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const ticketSelector = (num: number): string => `[data-testid="ticket-node"][data-epic="demo"][data-ticket="${num}"]`
const ticketNode = (window: Page, num: number): Locator => window.locator(ticketSelector(num))
const FRAME = '[data-testid="epic-frame"][data-epic="demo"]'
const TOOLBAR = '[data-testid="selection-toolbar"]'

/**
 * Selects the Ticket by a click on its title and waits for the Canvas to come to rest. A click on
 * an empty spot of the Canvas clears the selection first, so the toolbar of the last selection is
 * gone before the new one is measured.
 */
async function selectTicket(launched: LaunchedApp, num: number): Promise<void> {
  // Near the pane's bottom left, under the note: the pane is shorter at a larger interface scale.
  const pane = launched.window.locator('.react-flow__pane')
  const paneBox = await pane.boundingBox()
  if (!paneBox) throw new Error('the Canvas pane has no box')
  await pane.click({ position: { x: 20, y: paneBox.height - 40 } })
  await expect(launched.window.getByTestId('selection-toolbar')).toHaveCount(0)
  await ticketNode(launched.window, num).locator('.w-ticket__title').click()
  await expect(launched.window.locator(`.react-flow__node.selected:has([data-testid="ticket-node"][data-ticket="${num}"])`)).toHaveCount(1)
  await canvasReady(launched)
}

/**
 * The toolbar of the selected Ticket `selected` and everything it must keep clear of, all read in
 * one pass once the layout is still (helpers.ts): boxes read one by one could come from two layouts.
 */
async function toolbarAndAround(window: Page, selected: number, neighbour: number) {
  const neighbourCard = ticketSelector(neighbour)
  const lists = await settledBoxLists(
    window,
    {
      toolbar: TOOLBAR,
      selected: ticketSelector(selected),
      header: `${FRAME} .w-epic__header`,
      labels: `${FRAME} .w-epic__column-label`,
      title: `${neighbourCard} .w-ticket__title`,
      'no blockers': `${neighbourCard} .w-ticket__meta`,
      'Ship ticket': `${neighbourCard} [data-testid="action-ship-ticket"]`,
      focus: '.w-focus-entry',
      tickets: '[data-testid="ticket-node"]',
    },
    `the boxes around the toolbar of Ticket ${selected}`,
  )
  const one = (name: keyof typeof lists): Box => {
    const found = lists[name]
    expect(found, `exactly one element for ${name}`).toHaveLength(1)
    return found[0]!
  }
  return {
    toolbar: one('toolbar'),
    selected: one('selected'),
    header: one('header'),
    labels: lists.labels,
    neighbourParts: { title: one('title'), 'no blockers': one('no blockers'), 'Ship ticket': one('Ship ticket') },
    focus: one('focus'),
    tickets: lists.tickets,
  }
}

/** The interface scale of app-settings.json in the data folder; 1 writes no file. */
function writeScale(scale: number): void {
  if (scale !== 1) writeFileSync(join(dataDir, 'app-settings.json'), JSON.stringify({ interfaceScale: scale }))
}

/** The window's content size, in pixels of the window, at every interface scale. */
const WINDOW = { width: 1440, height: 900 }

/**
 * Waits for the Canvas with the window at WINDOW and the page at `scale`. canvasReady() sizes the
 * window by the page's innerWidth, which the interface scale divides, so at another scale the
 * window is sized here and the page is expected WINDOW.width / scale wide.
 */
async function windowReady(launched: LaunchedApp, scale: number): Promise<void> {
  if (scale === 1) return canvasReady(launched, { size: WINDOW })
  const { app, window } = launched
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor()), { message: 'the interface scale' }).toBeCloseTo(scale, 5)
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), WINDOW)
  await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(Math.round(WINDOW.width / scale))
  await canvasReady(launched)
}

for (const { zoom, scale } of CASES) {
  const scaled = scale === 1 ? '' : `, interface scale ${scale}`
  test(`the selection toolbar covers neither the Epic frame header nor the Tickets around it (zoom ${zoom}${scaled})`, async () => {
    writeLayout(zoom)
    writeScale(scale)
    const launched = await launch()
    try {
      const { window } = launched
      const frame = window.locator('[data-testid="epic-frame"][data-epic="demo"]')
      // The first read of the Project's Tickets can take longer than the default 5 s.
      await expect(frame).toBeVisible({ timeout: 20_000 })
      // Sized first: at a larger interface scale the Tickets are outside the window's first size, and React Flow draws only what is on screen.
      await windowReady(launched, scale)
      await expect(ticketNode(window, 2)).toBeVisible()
      await expect(ticketNode(window, 3)).toBeVisible()

      // 02 and 03 share a column; the one higher up is in the top row, the other is its neighbour below.
      const pair = await settledBoxes(window, { two: ticketSelector(2), three: ticketSelector(3) }, 'the boxes of Tickets 02 and 03')
      const [top, lower] = [
        { num: 2, box: pair.two },
        { num: 3, box: pair.three },
      ].sort((a, b) => a.box.y - b.box.y)
      expect(Math.round(top!.box.x)).toBe(Math.round(lower!.box.x))
      expect(lower!.box.y).toBeGreaterThan(top!.box.y + top!.box.height)
      // The line under the neighbour's title, whose box is read below with the toolbar's.
      await expect(ticketNode(window, lower!.num).locator('.w-ticket__meta')).toContainText('no blockers')

      // A Ticket of the top row with a neighbour below: beside it, clear of everything.
      await selectTicket(launched, top!.num)
      const { toolbar, selected, header, labels, neighbourParts, focus, tickets } = await toolbarAndAround(window, top!.num, lower!.num)
      expect(labels.length).toBeGreaterThan(0)
      const name = `selection-toolbar-frame-zoom-${String(zoom).replace('.', '_')}${scale === 1 ? '' : `-scale-${String(scale).replace('.', '_')}`}`
      const shots = await snapshotThemes(window, name)
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(shots.light, join(EVIDENCE_DIR, `14-${name}-light.png`))
        copyFileSync(shots.dark, join(EVIDENCE_DIR, `14-${name}-dark.png`))
      }
      expect(overlaps(toolbar, header), 'the toolbar covers the frame header').toBe(false)
      for (const label of labels) expect(overlaps(toolbar, label), 'the toolbar covers a column label').toBe(false)
      // What SelectionToolbar keeps off is the button's measured width (useFocusEntrySize in src/renderer/canvas/pinning.ts).
      const keptOff = Number(await window.getByTestId('selection-toolbar').getAttribute('data-focus-entry-width'))
      expect(keptOff, 'the selection toolbar reports no Focus button width').toBeGreaterThan(0)
      expect(focus.width, 'the Focus button is wider than SelectionToolbar keeps off').toBeLessThanOrEqual(keptOff)
      expect(overlaps(toolbar, focus), 'the toolbar covers the Focus button').toBe(false)
      for (const [part, rect] of Object.entries(neighbourParts)) expect(overlaps(toolbar, rect), `the toolbar covers the neighbour's ${part}`).toBe(false)
      for (const ticket of tickets) expect(overlaps(toolbar, ticket), 'the toolbar covers a Ticket').toBe(false)
      // Beside it on the right, level with its top edge.
      expect(toolbar.x).toBeGreaterThan(selected.x + selected.width)
      expect(Math.abs(toolbar.y - selected.y)).toBeLessThan(2)

      // The neighbour below: on top it would cover the Ticket above, so it goes beside it too.
      await selectTicket(launched, lower!.num)
      const around = await settledBoxLists(
        window,
        { second: TOOLBAR, above: ticketSelector(top!.num), header: `${FRAME} .w-epic__header`, tickets: '[data-testid="ticket-node"]' },
        `the boxes around the toolbar of Ticket ${lower!.num}`,
      )
      for (const name of ['second', 'above', 'header'] as const) expect(around[name], `exactly one element for ${name}`).toHaveLength(1)
      const second = around.second[0]!
      expect(overlaps(second, around.above[0]!), 'the toolbar covers the Ticket above').toBe(false)
      expect(overlaps(second, around.header[0]!)).toBe(false)
      for (const ticket of around.tickets) expect(overlaps(second, ticket), 'the toolbar covers a Ticket').toBe(false)

      // A Node outside the frame with nothing above it: the toolbar is above it.
      const note = window.locator('.react-flow__node[data-id="outside"]')
      await note.locator('.w-note__header').click()
      await expect(window.locator('.react-flow__node.selected[data-id="outside"]')).toHaveCount(1)
      await canvasReady(launched)
      const { noteToolbar, noteBox } = await settledBoxes(window, { noteToolbar: TOOLBAR, noteBox: '.react-flow__node[data-id="outside"]' }, 'the boxes of the Note and its toolbar')
      expect(noteToolbar.y + noteToolbar.height).toBeLessThan(noteBox.y)
    } finally {
      await launched.close()
    }
  })
}
