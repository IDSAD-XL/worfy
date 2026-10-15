import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

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

/** The zooms the Canvas is opened at: the Orchestrator Node at (40, 40), the frames' column right of it, the note under it. */
const ZOOMS = [1, 0.6] as const

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
  writeFileSync(script, `#!/bin/sh\ncat '${answerFile}'\n`)
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

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const ticketNode = (window: Page, num: number): Locator => window.locator(`[data-testid="ticket-node"][data-epic="demo"][data-ticket="${num}"]`)

/**
 * Selects the Ticket by a click on its title and waits for the toolbar to stand still. A click on
 * an empty spot of the Canvas clears the selection first, so the toolbar of the last selection is
 * gone before the new one is measured.
 */
async function selectTicket(launched: LaunchedApp, num: number): Promise<Box> {
  await launched.window.locator('.react-flow__pane').click({ position: { x: 20, y: 760 } })
  await expect(launched.window.getByTestId('selection-toolbar')).toHaveCount(0)
  await ticketNode(launched.window, num).locator('.w-ticket__title').click()
  await expect(launched.window.locator(`.react-flow__node.selected:has([data-testid="ticket-node"][data-ticket="${num}"])`)).toHaveCount(1)
  await canvasReady(launched)
  return box(launched.window.getByTestId('selection-toolbar'))
}

/** The rectangles of all the elements `locator` finds, as the page has them. */
function boxesOf(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = (element as unknown as { getBoundingClientRect(): Box }).getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }),
  )
}

/** The Focus button's width that SelectionToolbar keeps off (FOCUS_ENTRY_SIZE in src/renderer/canvas/pinning.ts). */
const FOCUS_ENTRY_WIDTH = 96

for (const zoom of ZOOMS) {
  test(`the selection toolbar covers neither the Epic frame header nor the Tickets around it (zoom ${zoom})`, async () => {
    writeLayout(zoom)
    const launched = await launch()
    try {
      const { window } = launched
      const frame = window.locator('[data-testid="epic-frame"][data-epic="demo"]')
      // The first read of the Project's Tickets can take longer than the default 5 s.
      await expect(frame).toBeVisible({ timeout: 20_000 })
      await expect(ticketNode(window, 2)).toBeVisible()
      await expect(ticketNode(window, 3)).toBeVisible()
      await canvasReady(launched, { size: { width: 1440, height: 900 } })

      // 02 and 03 share a column; the one higher up is in the top row, the other is its neighbour below.
      const [top, lower] = (await Promise.all([2, 3].map(async (num) => ({ num, box: await box(ticketNode(window, num)) })))).sort((a, b) => a.box.y - b.box.y)
      expect(Math.round(top!.box.x)).toBe(Math.round(lower!.box.x))
      expect(lower!.box.y).toBeGreaterThan(top!.box.y + top!.box.height)

      const header = await box(frame.locator('.w-epic__header'))
      const labels = await boxesOf(frame.locator('.w-epic__column-label'))
      expect(labels.length).toBeGreaterThan(0)
      const neighbour = ticketNode(window, lower!.num)
      const neighbourParts = {
        title: await box(neighbour.locator('.w-ticket__title')),
        'no blockers': await box(neighbour.getByText('no blockers')),
        'Ship ticket': await box(neighbour.getByTestId('action-ship-ticket')),
      }

      // A Ticket of the top row with a neighbour below: beside it, clear of everything.
      const toolbar = await selectTicket(launched, top!.num)
      const name = `selection-toolbar-frame-zoom-${String(zoom).replace('.', '_')}`
      const shots = await snapshotThemes(window, name)
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(shots.light, join(EVIDENCE_DIR, `14-${name}-light.png`))
        copyFileSync(shots.dark, join(EVIDENCE_DIR, `14-${name}-dark.png`))
      }
      expect(overlaps(toolbar, header), 'the toolbar covers the frame header').toBe(false)
      for (const label of labels) expect(overlaps(toolbar, label), 'the toolbar covers a column label').toBe(false)
      const focus = await box(window.locator('.w-focus-entry'))
      expect(focus.width, 'the Focus button is wider than SelectionToolbar keeps off').toBeLessThanOrEqual(FOCUS_ENTRY_WIDTH)
      expect(overlaps(toolbar, focus), 'the toolbar covers the Focus button').toBe(false)
      for (const [part, rect] of Object.entries(neighbourParts)) expect(overlaps(toolbar, rect), `the toolbar covers the neighbour's ${part}`).toBe(false)
      for (const ticket of await boxesOf(window.locator('[data-testid="ticket-node"]'))) expect(overlaps(toolbar, ticket), 'the toolbar covers a Ticket').toBe(false)
      // Beside it on the right, level with its top edge.
      expect(toolbar.x).toBeGreaterThan(top!.box.x + top!.box.width)
      expect(Math.abs(toolbar.y - top!.box.y)).toBeLessThan(2)

      // The neighbour below: on top it would cover the Ticket above, so it goes beside it too.
      const second = await selectTicket(launched, lower!.num)
      expect(overlaps(second, top!.box), 'the toolbar covers the Ticket above').toBe(false)
      expect(overlaps(second, header)).toBe(false)
      for (const ticket of await boxesOf(window.locator('[data-testid="ticket-node"]'))) expect(overlaps(second, ticket), 'the toolbar covers a Ticket').toBe(false)

      // A Node outside the frame with nothing above it: the toolbar is above it.
      const note = window.locator('.react-flow__node[data-id="outside"]')
      await note.locator('.w-note__header').click()
      await expect(window.locator('.react-flow__node.selected[data-id="outside"]')).toHaveCount(1)
      await canvasReady(launched)
      const noteToolbar = await box(window.getByTestId('selection-toolbar'))
      expect(noteToolbar.y + noteToolbar.height).toBeLessThan((await box(note)).y)
    } finally {
      await launched.close()
    }
  })
}
