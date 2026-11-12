import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, innerSize, launchApp, parkPointer, repoRoot, showSidebarSection, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { printJoined } from './terminal-shell'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'
import { settled } from './wait'

// The popovers of the kit on the Canvas in the built app (worfy-ui-kit ticket 09, ADR-0106): Trash,
// the Archive and the history of a Ticket («N sessions»), each a Popover of theme/kit/Popover.tsx.
// - Over the Canvas: Trash and the Archive stand over their buttons, on top of everything, inside the
//   window; the focus goes in, and Esc closes the popover and gives the focus back to the button.
// - In a Node: the Ticket's history is a popover of its Node. A press inside it leaves the Node
//   active, a drag inside it moves neither the Node nor the Canvas, Esc closes only the popover —
//   the next Esc is the Canvas's and ends the activity.
// - At the edge of the window: under its button while there is room; near the bottom edge it flips
//   over the button and stays inside the window.
// - In focus mode: the history of a Ticket's tile is drawn over the layer; Esc closes the popover,
//   not focus mode, and the next Esc leaves focus mode.
// - Next to a Terminal and a Browser: a press inside the Browser's <webview> closes the popover (the
//   blur of the window: Base UI #5410), and a press on the Terminal's screen closes it and reaches xterm.
// The popovers of the rest of the window (worfy-ui-kit ticket 10), on the same kit Popover:
// - In the composer of a Session view: Queued messages and Effort stand at the bottom edge of the
//   window, so each flips over its button and stays inside the window, on top.
// - Esc in a composer popover while the agent's turn runs (ADR-0106, the e2e case of tickets 10 and
//   11): with the focus in the popover or on its button, Esc closes the popover and the turn goes on;
//   the next Esc in the input field interrupts the turn. No popover of this ticket opens with the focus
//   left in the field; that case is the unit test `the chat field keeps the focus while a kit popup is
//   open` (test/unit/kit-layer.test.tsx).
// - History of the sidebar and Settings: the Settings window is modal and covers the whole window, so
//   History cannot be opened over it. History opened first closes when Settings takes the focus (a
//   non-modal popover closes when the focus leaves it), and Settings is on top; once Settings is closed,
//   History opens again on top of the sidebar and the Canvas.
// The composer cases run on the fake agent with test/fixtures/agent-scripts/session-view.jsonl: turn 1
// answers at once, turn 2 holds until it is interrupted (as test/e2e/session-controls.spec.ts).
// The Project is a temporary git repository; `bin/epic-status` in a temporary WORFY_CLAUDE_HOME
// answers with one Epic of two Tickets, and a manual Binding ties an archived Session to Ticket 01.
// The Browser's page comes from a server this file starts on 127.0.0.1: no outside site.

const PROJECT_ID = 'layers-0000c09a'
const EPIC = 'demo'
const BOUND = 'aaaaaaaa-0909-4909-8909-0000000000a1'
const FREE = 'bbbbbbbb-0909-4909-8909-0000000000a2'
const WINDOW = { width: 1400, height: 900 }
const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const HISTORY = '1 session archived of ticket demo/01'

let server: Server
let pageUrl: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url !== '/page.html') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(FIXTURES, 'page.html')))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page.html`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-layers-popover-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const archivedSession = (sessionId: string, name: string, x: number, y: number, archivedAt: number) => ({
  id: `session:${sessionId}`,
  kind: 'session',
  x,
  y,
  w: 300,
  h: 120,
  data: { sessionId, origin: 'external', source: 'terminal', cwd: '/tmp', name },
  archived: { at: archivedAt, rule: 'idle', batch: 'batch-1' },
})

/**
 * The app over the Project. `workflow`: the Epic with its Tickets, a Session archived from Ticket 01
 * and one without a Binding (the Archive). `nodes`: more Nodes of the Layout.
 */
async function start({ workflow, nodes = [] }: { workflow: boolean; nodes?: Record<string, unknown>[] }): Promise<LaunchedApp> {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'demo')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  mkdirSync(home)
  mkdirSync(join(repo, '.scratch', EPIC), { recursive: true })
  if (workflow) {
    const answer = join(claudeHome, 'epic-status.json')
    const ticket = (num: number) => ({ epic: EPIC, num, slug: `t${num}`, title: `0${num} — Ticket ${num}`, statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })
    writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticket(1), ticket(2)] }))
    const script = join(claudeHome, 'bin', 'epic-status')
    writeFileSync(script, catScript(answer))
    chmodSync(script, 0o755)
    writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), `# ${EPIC}\n`)
  }
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  const project = join(dataDir, PROJECT_ID)
  mkdirSync(project, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  const now = Date.now()
  const archived = workflow ? [archivedSession(BOUND, 'Ship ticket one', 1800, 1400, now - 120_000), archivedSession(FREE, 'Spike without a ticket', 0, 1300, now - 60_000)] : []
  writeFileSync(join(project, 'layout.json'), JSON.stringify({ nodes: [...archived, ...nodes], viewport: { x: 40, y: 40, zoom: workflow ? 0.5 : 1 } }))
  if (workflow) writeFileSync(join(project, 'bindings.json'), JSON.stringify({ bindings: [{ sessionId: BOUND, agentId: null, target: { kind: 'ticket', epic: EPIC, num: 1 } }] }))

  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, HOME: home, SHELL: '/bin/sh' } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
  await canvasReady(launched, { size: WINDOW, frames: 20, timeout: ms(20_000) })
  await parkPointer(launched.window)
  return launched
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** Whether the element at the centre of `locator` is the locator's element or inside it: nothing covers it. */
const onTop = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && element.contains(hit)
  })

/** Whether the keyboard focus is inside `locator`. */
const focusInside = (locator: Locator): Promise<boolean> => locator.evaluate((element) => element.contains(element.ownerDocument.activeElement))

/** Whether `locator` lies wholly inside the page. */
async function insideWindow(window: Page, locator: Locator): Promise<boolean> {
  const at = await box(locator)
  const page = await innerSize(window)
  return at.x >= 0 && at.y >= 0 && at.x + at.width <= page.width && at.y + at.height <= page.height
}

const ticketCard = (window: Page, num: number): Locator => window.locator(`[data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="${num}"]`)
/** The React Flow element of Ticket `num`'s Node: it carries the activity class. */
const ticketFlowNode = (window: Page, num: number): Locator => window.locator('.react-flow__node', { has: ticketCard(window, num) })
const isActive = async (node: Locator): Promise<boolean> => /\bw-node--active\b/.test((await node.getAttribute('class')) ?? '')

test('over the Canvas: Trash and the Archive stand over their buttons, on top and inside the window; Esc closes the popover and gives the focus back', async () => {
  const { window } = await start({ workflow: true })
  await expect(ticketCard(window, 1)).toBeVisible({ timeout: ms(20_000) })

  const trash = window.getByRole('button', { name: /^Trash/ })
  await trash.click()
  const trashPopover = window.getByRole('dialog', { name: 'Trash' })
  await expect(trashPopover).toBeVisible()
  await expect(trashPopover).toHaveAttribute('data-testid', 'trash-popover')
  await expect(trash).toHaveAttribute('aria-expanded', 'true')
  const [trashBox, trashButton] = [await box(trashPopover), await box(trash)]
  expect(trashBox.y + trashBox.height).toBeLessThanOrEqual(trashButton.y)
  expect(Math.abs(trashBox.x + trashBox.width / 2 - (trashButton.x + trashButton.width / 2))).toBeLessThan(2)
  expect(await onTop(trashPopover)).toBe(true)
  expect(await insideWindow(window, trashPopover)).toBe(true)
  expect(await focusInside(trashPopover)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(trashPopover).toHaveCount(0)
  await expect(trash).toBeFocused()

  const archive = window.getByTestId('archive-button')
  await expect(archive).toHaveText('Archive1')
  await archive.click()
  const archivePopover = window.getByRole('dialog', { name: 'Archive' })
  await expect(archivePopover.getByTestId('archive-row')).toHaveText([/Spike without a ticket/])
  const [archiveBox, archiveButton] = [await box(archivePopover), await box(archive)]
  expect(archiveBox.y + archiveBox.height).toBeLessThanOrEqual(archiveButton.y)
  // The right edges lined up, as before the kit.
  expect(Math.abs(archiveBox.x + archiveBox.width - (archiveButton.x + archiveButton.width))).toBeLessThan(2)
  expect(await onTop(archivePopover)).toBe(true)
  expect(await insideWindow(window, archivePopover)).toBe(true)
  expect(await focusInside(archivePopover)).toBe(true)
  // A press on the Trash button is a press outside the Archive: it closes, Trash opens.
  await trash.click()
  await expect(archivePopover).toHaveCount(0)
  await expect(trashPopover).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(trashPopover).toHaveCount(0)
})

test("in a Node: a press or a drag inside a Ticket's history leaves the Node active and in place, Esc closes only the popover, the next Esc ends the activity", async () => {
  const { window } = await start({ workflow: true })
  const node = ticketFlowNode(window, 1)
  await expect(ticketCard(window, 1)).toBeVisible({ timeout: ms(20_000) })
  await ticketCard(window, 1).locator('.w-ticket__title').click()
  await expect.poll(() => isActive(node)).toBe(true)

  const badge = ticketCard(window, 1).getByRole('button', { name: HISTORY })
  await badge.click()
  const history = window.getByRole('dialog', { name: 'Archived sessions of demo/01' })
  await expect(history.getByTestId('archive-row')).toHaveText([/Ship ticket one/])
  expect(await onTop(history)).toBe(true)
  expect(await isActive(node)).toBe(true)

  // A press and a drag inside the popover: the Node stays where it is, and so does the Canvas.
  const before = await box(node)
  const heading = await box(history.locator('.w-archive__heading'))
  await window.mouse.move(heading.x + 10, heading.y + heading.height / 2)
  await window.mouse.down()
  await window.mouse.move(heading.x + 10, heading.y + heading.height / 2 + 90, { steps: 10 })
  await window.mouse.up()
  await canvasReady({ window }, { frames: 10 })
  expect(await box(node)).toEqual(before)
  await expect(history).toBeVisible()
  expect(await isActive(node)).toBe(true)

  await window.keyboard.press('Escape')
  await expect(history).toHaveCount(0)
  expect(await isActive(node)).toBe(true)
  await expect(badge).toBeFocused()
  await window.keyboard.press('Escape')
  await expect.poll(() => isActive(node)).toBe(false)
})

test("at the edge of the window: a Ticket's history hangs under its button, and near the bottom edge flips over it, inside the window", async () => {
  const { window } = await start({ workflow: true })
  await expect(ticketCard(window, 1)).toBeVisible({ timeout: ms(20_000) })
  const badge = ticketCard(window, 1).getByRole('button', { name: HISTORY })
  const history = window.getByRole('dialog', { name: 'Archived sessions of demo/01' })

  await badge.click()
  await expect(history).toBeVisible()
  const under = await box(history)
  expect(under.y).toBeGreaterThanOrEqual((await box(badge)).y + (await box(badge)).height)
  await expect(history).toHaveAttribute('data-side', 'bottom')
  await window.keyboard.press('Escape')
  await expect(history).toHaveCount(0)

  // The Canvas pans down (the wheel pans it) until the button is 40 px over the bottom edge.
  const page = await innerSize(window)
  const pane = await box(window.locator('.react-flow'))
  // How far the button moves per pixel of the wheel is measured on the way (React Flow's pan speed).
  let perPixel = -1
  for (let step = 0; step < 8; step++) {
    const at = await box(badge)
    const off = page.height - 40 - (at.y + at.height)
    if (Math.abs(off) < 12) break
    const delta = Math.max(-600, Math.min(600, off / perPixel))
    await window.mouse.move(pane.x + 8, pane.y + pane.height - 8)
    await window.mouse.wheel(0, delta)
    await canvasReady({ window }, { frames: 10 })
    const moved = (await box(badge)).y - at.y
    if (Math.abs(moved) > 1) perPixel = moved / delta
  }
  const near = await box(badge)
  expect(page.height - (near.y + near.height)).toBeLessThan(60)
  expect(page.height - (near.y + near.height)).toBeGreaterThan(20)

  await badge.click()
  await expect(history).toBeVisible()
  await expect(history).toHaveAttribute('data-side', 'top')
  const over = await box(history)
  expect(over.y + over.height).toBeLessThanOrEqual(near.y)
  expect(await insideWindow(window, history)).toBe(true)
  expect(await onTop(history)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(history).toHaveCount(0)
})

test("in focus mode: a Ticket tile's history is drawn over the layer, Esc closes the popover and not focus mode, the next Esc leaves it", async () => {
  const { window } = await start({ workflow: true })
  await expect(ticketCard(window, 1)).toBeVisible({ timeout: ms(20_000) })
  await ticketCard(window, 1).locator('.w-ticket__title').click()
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
  await window.keyboard.press('ControlOrMeta+Enter')
  const focus = window.getByTestId('focus-mode')
  await expect(focus).toBeVisible()

  const badge = focus.getByRole('button', { name: HISTORY })
  await badge.click()
  const history = window.getByRole('dialog', { name: 'Archived sessions of demo/01' })
  await expect(history).toBeVisible()
  expect(await onTop(history)).toBe(true)
  expect(await focusInside(history)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(history).toHaveCount(0)
  await expect(focus).toBeVisible()
  await expect(badge).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(focus).toHaveCount(0)
})

test('next to a Terminal and a Browser: a press inside the <webview> closes the popover, a press on the Terminal closes it and reaches xterm', async () => {
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const { window, app } = await start({
    workflow: false,
    nodes: [
      { id: 'term', kind: 'terminal', x: 40, y: 40, w: 480, h: 260, ...base, data: {} },
      { id: 'b1', kind: 'browser', x: 600, y: 40, w: 560, h: 340, ...base, data: { url: pageUrl } },
    ],
  })
  const terminal = window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
  await expect(terminal).toHaveAttribute('data-state', 'running', { timeout: ms(15_000) })
  const webview = window.locator('webview[data-browser-id="b1"]')
  await expect(webview).toHaveCount(1)
  await expect
    .poll(
      () =>
        app.evaluate(async ({ webContents }) => {
          const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
          return guest ? ((await guest.executeJavaScript('document.body?.dataset.ready')) as string | undefined) : undefined
        }),
      { timeout: ms(15_000), message: 'the fixture page has loaded in the <webview>' },
    )
    .toBe('yes')

  const trash = window.getByRole('button', { name: /^Trash/ })
  const popover = window.getByRole('dialog', { name: 'Trash' })

  // A press inside the page of the Browser: Base UI does not see it, the blur of the window closes the popover.
  await trash.click()
  await expect(popover).toBeVisible()
  const page = await box(webview)
  await window.mouse.click(page.x + page.width / 2, page.y + page.height * 0.7)
  await expect(popover).toHaveCount(0)

  // A press on the Terminal's screen: the popover closes, and what is typed next reaches the shell.
  await trash.click()
  await expect(popover).toBeVisible()
  await terminal.getByTestId('terminal-screen').click()
  await expect(popover).toHaveCount(0)
  await window.keyboard.type(printJoined('layers', '-typed'))
  await window.keyboard.press('Enter')
  await expect(terminal.getByTestId('terminal-screen')).toContainText('layers-typed', { timeout: ms(10_000) })
})

const SESSION_PROJECT = 'alpha-0000c10a'

/** The app over a plain Project folder, its Sessions on the fake agent; answers the Orchestrator's Session view, idle. */
async function startSession(): Promise<{ window: Page; view: Locator }> {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const path = join(scratch, 'alpha')
  mkdirSync(claudeHome, { recursive: true })
  mkdirSync(path)
  mkdirSync(join(dataDir, SESSION_PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: SESSION_PROJECT, name: 'alpha', path }], activeId: SESSION_PROJECT }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view', WORFY_AGENT_LOG: join(scratch, 'agent.log') } })
  const { window } = launched
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle', { timeout: ms(20_000) })
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return { window, view }
}

/** Starts the turn that holds until it is interrupted, and queues one message behind it. Answers the input field. */
async function busyWithQueue(view: Locator): Promise<Locator> {
  const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
  await field.fill('first')
  await field.press('Enter')
  await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
  await field.fill('hold')
  await field.press('Enter')
  await expect(view.getByTestId('session-state')).toHaveText('busy')
  await field.fill('queued one')
  await field.press('Enter')
  await expect(view.getByTestId('queue-chip')).toHaveText('1 queued')
  return field
}

test('in the composer: Queued messages and Effort, at the bottom edge of the window, flip over their buttons and stay inside the window, on top', async () => {
  const { window, view } = await startSession()
  await busyWithQueue(view)
  const page = await innerSize(window)

  const chip = view.getByTestId('queue-chip')
  const queue = window.getByRole('dialog', { name: 'Queued messages' })
  await chip.click()
  await expect(queue).toBeVisible()
  await expect(queue).toHaveAttribute('data-testid', 'queue-list')
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  // No room under the chip: it is on the last lines of the window.
  const chipBox = await box(chip)
  expect(page.height - (chipBox.y + chipBox.height)).toBeLessThan((await box(queue)).height)
  await expect(queue).toHaveAttribute('data-side', 'top')
  expect((await box(queue)).y + (await box(queue)).height).toBeLessThanOrEqual(chipBox.y + 1)
  expect(await insideWindow(window, queue)).toBe(true)
  expect(await onTop(queue)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(queue).toHaveCount(0)

  const effort = view.getByTestId('picker-effort')
  const popover = window.getByRole('dialog', { name: 'Effort' })
  await effort.click()
  await expect(popover).toBeVisible()
  await expect(popover).toHaveAttribute('data-testid', 'effort-popover')
  const effortBox = await box(effort)
  expect(page.height - (effortBox.y + effortBox.height)).toBeLessThan((await box(popover)).height)
  await expect(popover).toHaveAttribute('data-side', 'top')
  expect((await box(popover)).y + (await box(popover)).height).toBeLessThanOrEqual(effortBox.y + 1)
  expect(await insideWindow(window, popover)).toBe(true)
  expect(await onTop(popover)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})

test('Esc in a composer popover during a turn closes the popover and leaves the turn running; the next Esc in the input field interrupts it', async () => {
  const { window, view } = await startSession()
  const field = await busyWithQueue(view)
  const state = view.getByTestId('session-state')
  /** The turn goes on: main had every request the renderer sent, and the Session is still busy. */
  const turnRuns = async (): Promise<void> => {
    await settled(window)
    await expect(state).toHaveText('busy')
    await expect(view.getByTestId('input-interrupt')).toBeVisible()
  }

  // Queued messages, the focus in the popover.
  const chip = view.getByTestId('queue-chip')
  const queue = window.getByRole('dialog', { name: 'Queued messages' })
  await chip.click()
  await expect(queue).toBeVisible()
  expect(await focusInside(queue)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(queue).toHaveCount(0)
  await expect(chip).toBeFocused()
  await turnRuns()

  // Queued messages, the focus back on its chip while the popover is open.
  await chip.click()
  await expect(queue).toBeVisible()
  await chip.focus()
  await expect(queue).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(queue).toHaveCount(0)
  await turnRuns()

  // Effort, the focus on its slider.
  const effort = view.getByTestId('picker-effort')
  const popover = window.getByRole('dialog', { name: 'Effort' })
  await effort.click()
  await expect(popover).toBeVisible()
  await expect(window.getByTestId('effort-slider')).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(effort).toBeFocused()
  await turnRuns()
  // Nothing of the queue went either.
  await expect(chip).toHaveText('1 queued')

  // No popover open: Esc in the input field is the field's, and interrupts the turn.
  await field.focus()
  await window.keyboard.press('Escape')
  await expect(state).toHaveText('idle')
})

test('History of the sidebar and Settings: Settings taking the focus closes History and is on top; after Settings, History opens on top of the sidebar and the Canvas', async () => {
  const { window, app } = await start({ workflow: false })
  await showSidebarSection(window, 'Sessions')
  const button = window.getByTestId('sidebar-history')
  const history = window.getByRole('dialog', { name: 'History' })

  await button.click()
  await expect(history).toBeVisible()
  await expect(history).toHaveAttribute('data-testid', 'history-popover')
  expect(await focusInside(history)).toBe(true)
  expect(await onTop(history)).toBe(true)

  // Settings, from the app menu as a person opens it: the focus goes into its window, History closes.
  await clickMenuItem(app, 'app.settings')
  const settings = window.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(history).toHaveCount(0)
  expect(await focusInside(settings)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  // History again: on top of everything, inside the window; Esc closes it and gives the focus back.
  await button.click()
  await expect(history).toBeVisible()
  expect(await onTop(history)).toBe(true)
  expect(await insideWindow(window, history)).toBe(true)
  await window.keyboard.press('Escape')
  await expect(history).toHaveCount(0)
  await expect(button).toBeFocused()
})
