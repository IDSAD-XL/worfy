import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { FRAME_GAP, ROW_GAP, TICKETS_TOP } from '../../src/renderer/canvas/epic-layout'
import { ORCHESTRATOR_WIDTH } from '../../src/shared/ipc/orchestrator'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { settled } from './wait'
import { catScript } from '../harness-node'

// worfy-week ticket 11 (ADR-0039): opening the done stack of an Epic frame does not move the open
// columns. The Epic follows notifications-telegram of Auction: more done Tickets than open ones,
// and the Tickets of Level 1–3 blocked by done Tickets low in the done column. Before the fix ELK
// pulled those Tickets down to their done blockers once the stack opened.

const EPIC = 'telegram'
const PROJECT_ID = 'demo-0000000d'
/**
 * The frames' column starts right of the Orchestrator Node at (40, 40) (ADR-0032). At zoom 0.5 the
 * whole frame with the open stack is on screen: React Flow draws no Node off the Canvas, and a
 * Ticket pulled down to its done blocker must still be there to be measured.
 */
const ZOOM = 0.5
const FRAMES_IN_VIEW = { x: 40 - (40 + ORCHESTRATOR_WIDTH + FRAME_GAP) * ZOOM, y: 40, zoom: ZOOM }
const OPEN = [11, 12, 13, 14, 15, 16]

/** Number → its blockers: done 01–10 in a chain, open 11–16 on three levels with done blockers. */
const BLOCKERS: Record<number, number[]> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i ? [i] : []])),
  11: [9],
  12: [10],
  13: [11, 8],
  14: [12, 10],
  15: [13, 9],
  16: [14, 6],
}

let scratch: string

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** The Project's repository, its Ticket files, and a Claude home whose bin/epic-status prints the matching answer. */
function makeFixture(): { dataDir: string; claudeHome: string } {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), `# ${EPIC}: done blockers\n`)
  const answer = { ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [] as unknown[] }
  for (const [key, blockers] of Object.entries(BLOCKERS)) {
    const num = Number(key)
    const nn = String(num).padStart(2, '0')
    const state = num <= 10 ? 'done' : 'open'
    const blockedRaw = blockers.length ? blockers.map((b) => String(b).padStart(2, '0')).join(', ') : '—'
    writeFileSync(join(issues, `${nn}-t${num}.md`), [`# ${nn} — Ticket ${num}`, '', `Status: ${state}`, `Blocked by: ${blockedRaw}`, ''].join('\n'))
    answer.tickets.push({ epic: EPIC, num, slug: `t${num}`, title: `Ticket ${num}`, statusRaw: state, state, blockedRaw, blockedNums: blockers, blockedParsed: true })
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes: [], viewport: FRAMES_IN_VIEW }))

  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answerFile = join(scratch, 'epic-status.json')
  writeFileSync(answerFile, JSON.stringify(answer))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answerFile))
  chmodSync(script, 0o755)
  return { dataDir, claudeHome }
}

/** The node's place on the Canvas, from React Flow's transform. */
async function flowPosition(window: Page, id: string): Promise<{ x: number; y: number }> {
  const transform = await window.getByTestId(`rf__node-${id}`).evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`no translate in ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** The open Tickets' places relative to the frame. */
async function openPlaces(window: Page): Promise<Record<number, { x: number; y: number }>> {
  const frame = await flowPosition(window, `epic:${EPIC}`)
  const places: Record<number, { x: number; y: number }> = {}
  for (const num of OPEN) {
    const ticket = await flowPosition(window, `ticket:${EPIC}/${num}`)
    places[num] = { x: Math.round(ticket.x - frame.x), y: Math.round(ticket.y - frame.y) }
  }
  return places
}

const ticketNode = (window: Page, num: number) => window.locator(`[data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="${num}"]`)

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-done-stack-')))
})

test.afterEach(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('opening the done stack leaves the open Tickets where they stood with the stack folded', async () => {
  const { dataDir, claudeHome } = makeFixture()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1400, height: 1000 }, visible: [window.getByTestId('done-stack'), ticketNode(window, 11)] })
    const folded = await openPlaces(window)
    const top = Math.min(...OPEN.map((num) => folded[num]!.y))
    expect(top - TICKETS_TOP).toBeLessThanOrEqual(ROW_GAP)
    const foldedShots = await snapshotThemes(window, 'done-stack-folded')

    await window.getByTestId('done-stack').click()
    await expect(window.getByTestId('done-stack')).toHaveCount(0)
    await canvasReady(launched, { visible: [ticketNode(window, 1), ticketNode(window, 10)] })
    const open = await openPlaces(window)
    for (const num of OPEN) {
      expect(Math.abs(open[num]!.x - folded[num]!.x), `ticket ${num} x`).toBeLessThanOrEqual(ROW_GAP)
      expect(Math.abs(open[num]!.y - folded[num]!.y), `ticket ${num} y`).toBeLessThanOrEqual(ROW_GAP)
    }
    expect(Math.min(...OPEN.map((num) => open[num]!.y)) - top).toBeLessThanOrEqual(ROW_GAP)
    const openShots = await snapshotThemes(window, 'done-stack-open')
    console.log(`done stack: folded ${foldedShots.light} ${foldedShots.dark}; open ${openShots.light} ${openShots.dark}`)
  } finally {
    await launched.close()
  }
})

// worfy-week ticket 15: the open stack folds by the Collapse button in the place of Expand, and by
// Esc once nothing else takes the press — a selection, a menu — one press, one action. Opening and
// folding are not steps of ⌘Z (ticket 08).
test('the open done stack folds by Collapse in the place of Expand, and by Esc once nothing else takes the press', async () => {
  const { dataDir, claudeHome } = makeFixture()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    const card = window.getByTestId('done-stack')
    const toggle = window.getByTestId('done-stack-toggle')
    const first = ticketNode(window, 1)
    await canvasReady(launched, { size: { width: 1400, height: 1000 }, visible: [card, toggle] })
    const folded = async () => {
      await expect(card).toHaveCount(1)
      await expect(first).toHaveCount(0)
      await expect(toggle).toHaveAccessibleName(`Expand done tickets of ${EPIC}`)
    }
    const open = async () => {
      await expect(card).toHaveCount(0)
      await expect(first).toBeVisible()
      await expect(toggle).toHaveAccessibleName(`Collapse done tickets of ${EPIC}`)
    }
    await expect(card).toHaveAccessibleName(`10 done tickets of ${EPIC}`)
    const foldedShots = await snapshotThemes(window, 'done-stack-toggle-folded')

    // The card opens the stack; the focus it had goes to Collapse, a bordered button with an icon
    // that is legible at zoom 0.5.
    await card.click()
    await open()
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toBeVisible()
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(9.5)
    await expect(toggle).toHaveCSS('border-top-width', '1px')
    await expect(toggle.locator('svg')).toHaveCount(1)
    await expect(window.getByTestId('done-stack-region')).toBeVisible()
    const openShots = await snapshotThemes(window, 'done-stack-toggle-open')
    await toggle.click()
    await folded()

    // A bare Esc folds it.
    await toggle.click()
    await open()
    await window.keyboard.press('Escape')
    await folded()

    // With a Ticket selected, the first Esc only takes the selection off; the second folds.
    await toggle.click()
    await open()
    const firstNode = window.getByTestId(`rf__node-ticket:${EPIC}/1`)
    await first.click()
    await expect(firstNode).toHaveClass(/\bselected\b/)
    await window.keyboard.press('Escape')
    await expect(firstNode).not.toHaveClass(/\bselected\b/)
    await open()
    await window.keyboard.press('Escape')
    await folded()

    // With the Canvas menu open, the first Esc only closes the menu; the second folds.
    await toggle.click()
    await open()
    const pane = window.locator('.react-flow__pane')
    const size = (await pane.boundingBox())!
    await pane.click({ button: 'right', position: { x: size.width - 120, y: size.height / 2 } })
    const menu = window.getByRole('menu', { name: 'Canvas' })
    await expect(menu).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await open()
    await window.keyboard.press('Escape')
    await folded()

    // ⌘Z does not fold it: the stack is not a step of the history.
    await toggle.click()
    await open()
    await window.keyboard.press('ControlOrMeta+z')
    // An undo that folded the stack would have done it by now, through main or not.
    await settled(window)
    await open()
    console.log(`done stack toggle: folded ${foldedShots.light} ${foldedShots.dark}; open ${openShots.light} ${openShots.dark}`)
  } finally {
    await launched.close()
  }
})
