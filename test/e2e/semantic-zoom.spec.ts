import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// Semantic zoom (worfy-canvas ticket 06; F-SPEC "Zoom levels"): from zoom 0.6 up a Node is drawn
// in full; from 0.3 up to 0.6 it is its header alone, with its title and status chip; below 0.3 it
// is a block in its kind's colour with a large title at a constant screen size, an Epic frame keeps
// a header of constant screen size, and its Tickets are blocks without text. A pinned Node stays full,
// a selected one keeps an accent outline, and a Terminal keeps its rows and columns. The level is the
// `data-zoom-level` attribute of the React Flow root (overlays/ZoomLevel.tsx). The lowest zoom of the
// Canvas is ZOOM_MIN, 0.2 (src/shared/layout/types.ts), so the far view is checked there. A temporary
// WORFY_CLAUDE_HOME stands in for ~/.claude.

const PROJECT = 'alpha-0000000a'
const SESSION = '66666666-6666-4666-8666-666666666666'
const AGENT = 'a0000000000000606'
const EPIC = 'semantic-zoom-demo'
/**
 * A second Epic, beside the first, with a name that fits its frame at full but is longer than the
 * frame is wide at the lowest zoom (a longer name widens the frame itself).
 */
const EPIC_LONG = 'semantic-zoom-second-epic-with-a-long-name'
/** A third Epic: with K = 2 its frame stands under the first one, in the same column. */
const EPIC_BELOW = 'semantic-zoom-third-epic-below'
const CARD_TITLE = 'A Card whose title is much longer than two hundred pixels on the screen'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

/** One Session with one Subagent running in the background, written the way Claude Code writes them. */
function writeSession(): void {
  const dir = transcriptDir(projectPath)
  const record = (fields: Record<string, unknown>) => JSON.stringify({ cwd: projectPath, sessionId: SESSION, version: '2.1.289', timestamp: '2026-10-21T10:00:00.000Z', ...fields })
  const toolUseId = 'toolu_zoom_0'
  const main = [
    record({ type: 'user', isSidechain: false, message: { role: 'user', content: 'Run the wave.' } }),
    record({ type: 'assistant', isSidechain: false, message: { id: 'm0', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'implementer', name: 'impl-06', run_in_background: true } }] } }),
    record({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId: AGENT } }),
  ]
  mkdirSync(join(dir, SESSION, 'subagents'), { recursive: true })
  writeFileSync(join(dir, SESSION, 'subagents', `agent-${AGENT}.meta.json`), JSON.stringify({ agentType: 'implementer', name: 'impl-06', toolUseId, spawnDepth: 1, requestShape: 'background' }))
  writeFileSync(join(dir, SESSION, 'subagents', `agent-${AGENT}.jsonl`), `${record({ type: 'assistant', isSidechain: true, agentId: AGENT, message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Working.' }], stop_reason: 'tool_use' } })}\n`)
  writeFileSync(join(dir, `${SESSION}.jsonl`), `${main.join('\n')}\n`)
}

/**
 * epic-status answers three Epics, of three Tickets, five and one. With K = 2 in the arrangement
 * record the first two frames stand side by side and the third under the first; the second, taller
 * frame keeps the strip near enough to 16:10 that K stays 2.
 */
function writeEpic(): void {
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = (num: number, state: string, blockedNums: number[], epic = EPIC) => ({
    epic,
    num,
    slug: `t${num}`,
    title: `0${num} — Ticket ${num} of the demo`,
    statusRaw: state,
    state,
    blockedRaw: blockedNums.length ? blockedNums.map((each) => `0${each}`).join(', ') : '—',
    blockedNums,
    blockedParsed: true,
  })
  const tickets = [ticket(1, 'open', []), ticket(2, 'open', []), ticket(3, 'open', [1]), ...[1, 2, 3, 4].map((num) => ticket(num, 'open', [], EPIC_LONG)), ticket(5, 'open', [1], EPIC_LONG), ticket(1, 'open', [], EPIC_BELOW)]
  const epics = [EPIC, EPIC_LONG, EPIC_BELOW].map((epic) => ({ epic, hasSpec: true, hasMap: false }))
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics, tickets }))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)
}

/** The zoom of the Canvas, read from the React Flow viewport's transform. */
async function zoomOf(window: Page): Promise<number> {
  const transform = await window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /scale\((-?[\d.e-]+)\)/.exec(transform)
  if (!match) throw new Error(`unexpected viewport transform: ${transform}`)
  return Number(match[1])
}

/** Zooms out with ⌘− (React Flow's step, ×1/1.2, round the middle of the Canvas) until the zoom is below `below`, or at the lowest zoom. */
async function zoomOutBelow(window: Page, below: number): Promise<number> {
  for (;;) {
    const before = await zoomOf(window)
    if (before < below) return before
    await window.keyboard.press('ControlOrMeta+Minus')
    const moved = await expect
      .poll(() => zoomOf(window))
      .toBeLessThan(before)
      .then(() => true)
      .catch(() => false)
    if (!moved) return before
  }
}

/** The size of a Terminal's screen in layout pixels and its count of rows: what its pty is sized by. */
async function terminalSize(window: Page): Promise<{ rows: number; width: number; height: number }> {
  return window.locator('.react-flow__node[data-id="zoom-terminal"] .xterm-screen').evaluate((element) => {
    const screen = element as unknown as { offsetWidth: number; offsetHeight: number; parentElement: { querySelector(selector: string): { childElementCount: number } | null } | null }
    return { rows: screen.parentElement?.querySelector('.xterm-rows')?.childElementCount ?? -1, width: screen.offsetWidth, height: screen.offsetHeight }
  })
}

/** The screen boxes of `selector`'s matches, read in one pass. */
async function boxes(window: Page, selector: string): Promise<{ left: number; right: number; top: number; bottom: number }[]> {
  return window.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = (element as unknown as { getBoundingClientRect(): { left: number; right: number; top: number; bottom: number } }).getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }),
  )
}

/** The screen box of `selector`'s only match. */
async function boxOf(window: Page, selector: string): Promise<{ left: number; right: number; top: number; bottom: number }> {
  const [only, ...rest] = await boxes(window, selector)
  if (only === undefined || rest.length > 0) throw new Error(`${selector}: ${rest.length + (only ? 1 : 0)} matches, not one`)
  return only
}

interface Reading {
  /** Not hidden, and with a box on the screen. */
  shown: boolean
  /** Its text is not cut: nothing scrolls past its width, and both its ends are on top on the screen. */
  whole: boolean
  /** Its height on the screen, in CSS pixels. */
  height: number
  text: string
}

/** Screen boxes and visibility of several elements, read in one pass. */
async function readings(window: Page, selectors: Record<string, string>): Promise<Record<string, Reading | null>> {
  return window.evaluate((targets) => {
    type Rect = { height: number; width: number }
    type Rect2 = Rect & { left: number; right: number; top: number }
    type El = { getBoundingClientRect(): Rect2; textContent: string | null; scrollWidth: number; clientWidth: number; contains(other: unknown): boolean }
    const scope = globalThis as unknown as {
      document: { querySelector(selector: string): El | null; elementFromPoint(x: number, y: number): unknown }
      getComputedStyle(target: unknown): { visibility: string; display: string }
    }
    const out: Record<string, { shown: boolean; whole: boolean; height: number; text: string } | null> = {}
    for (const [name, selector] of Object.entries(targets)) {
      const element = scope.document.querySelector(selector)
      if (element === null) {
        out[name] = null
        continue
      }
      const style = scope.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const shown = style.visibility === 'visible' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      // Not cut by its own width, nor clipped by a box round it: its left and right ends are on top.
      const middle = rect.top + rect.height / 2
      const onTop = (x: number) => element.contains(scope.document.elementFromPoint(x, middle))
      const whole = element.scrollWidth <= element.clientWidth && onTop(rect.left + 2) && onTop(rect.right - 2)
      out[name] = { shown, whole, height: rect.height, text: (element.textContent ?? '').trim() }
    }
    return out
  }, selectors)
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-semantic-zoom-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const nodes = [
    { id: 'zoom-note', kind: 'note', x: 20, y: 700, w: 240, h: 140, ...base, data: { text: 'A note with a body that hides when zoomed out' } },
    { id: 'zoom-terminal', kind: 'terminal', x: 320, y: 700, w: 400, h: 240, ...base, data: {} },
    { id: 'zoom-pinned', kind: 'note', x: 20, y: 1000, w: 240, h: 140, ...base, pinned: true, data: { text: 'A pinned note stays whole' } },
    { id: 'zoom-card', kind: 'card', x: 320, y: 1000, w: 300, h: 180, ...base, data: {} },
    { id: 'zoom-handoff', kind: 'handoff', x: 1100, y: 1000, w: 360, h: 200, ...base, locked: true, data: {} },
    // The frames' order and K = 2 columns, written today: two frames side by side, the third under the first (ADR-0075).
    { id: 'epic-arrangement', kind: 'epic-arrangement', x: 0, y: 0, w: 1, h: 1, ...base, locked: true, data: { order: [EPIC, EPIC_LONG, EPIC_BELOW], columns: 2, at: new Date().toISOString() } },
  ]
  mkdirSync(join(dataDir, PROJECT, 'cards', 'zoom-card'), { recursive: true })
  writeFileSync(join(dataDir, PROJECT, 'cards', 'zoom-card', 'index.html'), `<!doctype html><title>${CARD_TITLE}</title><p>card</p>`)
  writeFileSync(join(projectPath, 'HANDOFF.md'), '# HANDOFF\n\nNothing yet.\n')
  // The full view at its lowest zoom: every Node is on the screen side by side.
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 20, y: 40, zoom: 0.6 } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
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

test('a Node is drawn in full, as its header, or as a block of its kind by zoom; Epic names and every kind stay readable at the lowest zoom', async () => {
  writeEpic()
  writeSession()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    const root = window.locator('.react-flow')
    const nodes = {
      orchestrator: window.getByTestId('orchestrator-node'),
      session: window.locator(`[data-testid="session-node"][data-session-id="${SESSION}"]`),
      subagent: window.locator(`[data-testid="subagent-node"][data-subagent-id="${AGENT}"]`),
      note: window.locator('.react-flow__node[data-id="zoom-note"]').getByTestId('note-node'),
      pinned: window.locator('.react-flow__node[data-id="zoom-pinned"]').getByTestId('note-node'),
      card: window.getByTestId('card-node'),
      handoff: window.getByTestId('handoff-node'),
      terminal: window.locator('.react-flow__node[data-id="zoom-terminal"]').getByTestId('terminal-node'),
      epic: window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`),
      ticket: window.getByTestId(`rf__node-ticket:${EPIC}/1`),
    }
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [nodes.orchestrator, nodes.note, nodes.terminal, nodes.epic] })
    const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
    processes.push(claude)
    writeFileSync(join(claudeHome, 'sessions', `${claude.pid}.json`), JSON.stringify({ pid: claude.pid, sessionId: SESSION, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave-06' }))
    for (const node of Object.values(nodes)) await expect(node).toBeVisible()
    await expect(nodes.session).toHaveAttribute('data-status', 'busy')
    await expect(nodes.terminal).toHaveAttribute('data-state', 'running', { timeout: 15_000 })

    // full (0.6): the Nodes as they are.
    await expect(root).toHaveAttribute('data-zoom-level', 'full')
    const body = {
      noteText: nodes.note.locator('textarea'),
      terminalScreen: nodes.terminal.locator('.xterm'),
      ticketMeta: nodes.ticket.locator('.w-ticket__meta'),
      columnLabel: nodes.epic.getByTestId('epic-column').first(),
    }
    for (const part of Object.values(body)) await expect(part).toBeVisible()
    await expect(nodes.card.getByTestId('card-frame')).toBeVisible()
    const pinnedText = nodes.pinned.locator('textarea')
    await expect(pinnedText).toBeVisible()
    // The Terminal's size, which no level may change, once two reads in a row agree: xterm fits its
    // rows to the Node after it is drawn. The Note is selected, for its mark at far.
    let lastRead = ''
    await expect
      .poll(async () => {
        const read = JSON.stringify(await terminalSize(window))
        const settled = read === lastRead
        lastRead = read
        return settled
      }, { message: 'the Terminal size settles' })
      .toBe(true)
    const terminalFull = JSON.parse(lastRead) as Awaited<ReturnType<typeof terminalSize>>
    expect(terminalFull.rows).toBeGreaterThan(3)
    await nodes.note.locator('[data-node-title]').click()
    await expect(window.locator('.react-flow__node[data-id="zoom-note"]')).toHaveClass(/\bselected\b/)
    await snapshotThemes(window, 'zoom-full')

    // compact (0.3 to 0.6): the header with its title and status chip; the body is hidden, its Node keeps its size.
    const sessionBox = await nodes.session.boundingBox()
    await zoomOutBelow(window, 0.6)
    await expect(root).toHaveAttribute('data-zoom-level', 'compact')
    for (const title of [nodes.session.getByTestId('session-node-title'), nodes.subagent.getByTestId('subagent-name'), nodes.note.locator('[data-node-title]'), nodes.terminal.locator('[data-node-title]')]) await expect(title).toBeVisible()
    await expect(nodes.session.getByTestId('session-node-status')).toBeVisible()
    await expect(nodes.subagent.getByTestId('subagent-status')).toBeVisible()
    await expect(nodes.orchestrator.getByTestId('orchestrator-state')).toBeVisible()
    await expect(body.noteText).toBeHidden()
    await expect(body.terminalScreen).toBeHidden()
    // The Terminal is not stopped below its header, and its screen keeps its rows and columns.
    await expect(nodes.terminal).toHaveAttribute('data-state', 'running')
    await expect.poll(() => terminalSize(window)).toEqual(terminalFull)
    // The Card runs no page below full; a pinned Node stays full.
    await expect(nodes.card.getByTestId('card-placeholder')).toBeHidden()
    await expect(nodes.card.getByTestId('card-frame')).toHaveCount(0)
    await expect(pinnedText).toBeVisible()
    const zoomed = await nodes.session.boundingBox()
    expect(zoomed && sessionBox ? zoomed.width / sessionBox.width : 0).toBeCloseTo((await zoomOf(window)) / 0.6, 1)
    // An Epic frame and its Tickets are as in full.
    await expect(body.ticketMeta).toBeVisible()
    await expect(body.columnLabel).toBeVisible()
    await snapshotThemes(window, 'zoom-compact')

    // far (below 0.3): each Node a block of its kind with a large title; the Epic's name and progress readable.
    const firstFar = await zoomOutBelow(window, 0.3)
    await expect(root).toHaveAttribute('data-zoom-level', 'far')
    const epicHeader = `[data-testid="epic-frame"][data-epic="${EPIC}"] .w-epic__header`
    const epicProgress = `[data-testid="epic-frame"][data-epic="${EPIC}"] [data-testid="epic-progress"]`
    const progressAtFirstFar = await boxOf(window, epicProgress)
    const farZoom = await zoomOutBelow(window, 0.21)
    expect(farZoom).toBeLessThan(firstFar)
    await expect(root).toHaveAttribute('data-zoom-level', 'far')
    const far = await readings(window, {
      epicTitle: `[data-testid="epic-frame"][data-epic="${EPIC}"] .w-epic__title`,
      epicProgress,
      epicHeader,
      epicLongTitle: `[data-testid="epic-frame"][data-epic="${EPIC_LONG}"] .w-epic__title`,
      epicBelowTitle: `[data-testid="epic-frame"][data-epic="${EPIC_BELOW}"] .w-epic__title`,
      epicBelowProgress: `[data-testid="epic-frame"][data-epic="${EPIC_BELOW}"] [data-testid="epic-progress"]`,
      columnLabel: `[data-testid="epic-frame"][data-epic="${EPIC}"] [data-testid="epic-column"]`,
      ticketTitle: `[data-testid="rf__node-ticket:${EPIC}/1"] .w-ticket__title`,
      orchestrator: '[data-testid="orchestrator-node"] [data-node-title]',
      session: `[data-testid="session-node"][data-session-id="${SESSION}"] [data-node-title]`,
      sessionStatus: `[data-testid="session-node"][data-session-id="${SESSION}"] [data-testid="session-node-status"]`,
      subagent: `[data-testid="subagent-node"][data-subagent-id="${AGENT}"] [data-node-title]`,
      note: '.react-flow__node[data-id="zoom-note"] [data-node-title]',
      noteText: '.react-flow__node[data-id="zoom-note"] textarea',
      terminal: '.react-flow__node[data-id="zoom-terminal"] [data-node-title]',
      card: '[data-testid="card-node"] [data-node-title]',
      handoff: '[data-testid="handoff-node"] [data-node-title]',
      pinnedText: '.react-flow__node[data-id="zoom-pinned"] textarea',
    })
    // The Terminal still has the size it had at full; the pinned Note still shows its text.
    await expect.poll(() => terminalSize(window)).toEqual(terminalFull)
    expect(far.pinnedText?.shown).toBe(true)
    // The frame's header keeps its text at a constant screen size, whatever the zoom: the name on
    // its first rows (wrapped to the frame's width), the progress under it, as tall at any far zoom.
    const progressAtLowest = await boxOf(window, epicProgress)
    expect(progressAtLowest.bottom - progressAtLowest.top).toBeCloseTo(progressAtFirstFar.bottom - progressAtFirstFar.top, 0)
    const header = await boxOf(window, epicHeader)
    expect(progressAtLowest.top, 'the progress under the name').toBeGreaterThan((await boxOf(window, `${epicHeader} .w-epic__title`)).bottom - 1)
    expect(progressAtLowest.bottom).toBeLessThanOrEqual(header.bottom)
    // The first two frames stand side by side, the third under the first (the others are off the
    // screen at full, so they are checked here).
    const frameOf = (epic: string) => boxOf(window, `[data-testid="epic-frame"][data-epic="${epic}"]`)
    const headerOf = (epic: string) => boxOf(window, `[data-testid="epic-frame"][data-epic="${epic}"] .w-epic__header`)
    const [first, second, below] = await Promise.all([frameOf(EPIC), frameOf(EPIC_LONG), frameOf(EPIC_BELOW)])
    expect(Math.abs(first.top - second.top), 'the first two frames in one row').toBeLessThan(1)
    expect(Math.abs(first.left - below.left), 'the third frame in the first one\'s column').toBeLessThan(1)
    expect(below.top, 'the third frame under the first').toBeGreaterThan(first.bottom)
    // Each frame's header lies inside its own frame: from its top edge down, as wide as the frame.
    for (const epic of [EPIC, EPIC_LONG, EPIC_BELOW]) {
      const [frame, header] = await Promise.all([frameOf(epic), headerOf(epic)])
      expect(header.top, `${epic}: the header does not cross the frame's top`).toBeGreaterThanOrEqual(frame.top - 0.5)
      expect(header.left, `${epic}: nor its left edge`).toBeGreaterThanOrEqual(frame.left - 0.5)
      expect(header.right, `${epic}: nor its right edge`).toBeLessThanOrEqual(frame.right + 0.5)
    }
    // So the headers of a row do not overlap, and the header of the lower frame of a column touches
    // neither the upper frame nor its Tickets; it is drawn whole, over its own Tickets.
    const [leftHeader, rightHeader] = await Promise.all([headerOf(EPIC), headerOf(EPIC_LONG)])
    expect(rightHeader.left - leftHeader.right, 'the left header ends before the right one starts').toBeGreaterThanOrEqual(0)
    const belowHeader = await headerOf(EPIC_BELOW)
    expect(belowHeader.top, 'the lower header starts under the upper frame').toBeGreaterThanOrEqual(first.bottom)
    for (const ticket of await boxes(window, `[data-testid="ticket-node"][data-epic="${EPIC}"]`)) expect(belowHeader.top).toBeGreaterThanOrEqual(ticket.bottom)
    // The frame, drawn over its Tickets at far, has no ground of its own that would wash them out.
    expect(await window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`).evaluate((element) => (globalThis as unknown as { getComputedStyle(target: unknown): { backgroundColor: string } }).getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    expect(far.epicBelowTitle).toMatchObject({ shown: true, whole: true, text: EPIC_BELOW })
    expect(far.epicBelowProgress).toMatchObject({ shown: true, text: '0/1' })
    // A Ticket under no header still takes the mouse: the frame lets it through.
    const hits = await window.evaluate(
      ([epic, headerBottom]) => {
        const scope = globalThis as unknown as {
          document: {
            querySelectorAll(selector: string): ArrayLike<{ getBoundingClientRect(): { left: number; right: number; top: number; bottom: number } }>
            elementFromPoint(x: number, y: number): { closest(selector: string): unknown } | null
          }
        }
        const free = Array.from(scope.document.querySelectorAll(`.react-flow__node-ticket:has([data-epic="${epic}"])`)).filter((ticket) => ticket.getBoundingClientRect().top > headerBottom)
        return free.map((ticket) => {
          const rect = ticket.getBoundingClientRect()
          return scope.document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)?.closest('.react-flow__node-ticket') === ticket
        })
      },
      [EPIC_LONG, (await headerOf(EPIC_LONG)).bottom] as const,
    )
    expect(hits.length, 'a Ticket of the second frame under no header').toBeGreaterThan(0)
    expect(hits.every(Boolean), 'each such Ticket is the element under the mouse').toBe(true)
    expect(far.epicTitle).toMatchObject({ shown: true, whole: true, text: EPIC })
    expect(far.epicLongTitle).toMatchObject({ shown: true, whole: true, text: EPIC_LONG })
    expect(far.epicTitle?.height).toBeGreaterThanOrEqual(16)
    expect(far.epicProgress).toMatchObject({ shown: true, text: '0/3' })
    expect(far.columnLabel?.shown).toBe(false)
    expect(far.ticketTitle?.shown).toBe(false)
    // Every kind by its title, large on the screen (15 px at any zoom).
    const titles: Record<string, string> = { orchestrator: 'Orchestrator', session: 'wave-06', subagent: 'impl-06', note: 'Note', terminal: 'Terminal', handoff: 'HANDOFF' }
    for (const [name, text] of Object.entries(titles)) {
      expect(far[name], name).toMatchObject({ shown: true, whole: true, text })
      expect(far[name]?.height, name).toBeGreaterThanOrEqual(17)
    }
    // A title longer than 200 px ends in "…" and is not cut by anything round it.
    expect(far.card).toMatchObject({ shown: true, text: CARD_TITLE })
    const cardLabel = await boxOf(window, '[data-testid="card-node"] [data-node-title]')
    expect(cardLabel.right - cardLabel.left).toBeLessThanOrEqual(201)
    expect(cardLabel.right - cardLabel.left).toBeGreaterThan(150)
    const cardStyle = await window.locator('[data-testid="card-node"] [data-node-title]').evaluate((element) => {
      const scope = globalThis as unknown as { getComputedStyle(target: unknown): { textOverflow: string } }
      const box = element as unknown as { scrollWidth: number; clientWidth: number }
      return { textOverflow: scope.getComputedStyle(element).textOverflow, cut: box.scrollWidth > box.clientWidth }
    })
    expect(cardStyle).toEqual({ textOverflow: 'ellipsis', cut: true })
    // The selected Note keeps an accent outline round its block.
    const mark = await window.evaluate(() => {
      type Styled = { style: { color: string }; remove(): void }
      const scope = globalThis as unknown as {
        document: { createElement(tag: string): Styled; body: { append(child: Styled): void }; querySelector(selector: string): unknown }
        getComputedStyle(target: unknown): { color: string; outlineColor: string; outlineWidth: string; getPropertyValue(name: string): string }
      }
      const probe = scope.document.createElement('span')
      probe.style.color = 'var(--accent)'
      scope.document.body.append(probe)
      const accent = scope.getComputedStyle(probe).color
      probe.remove()
      const style = scope.getComputedStyle(scope.document.querySelector('.react-flow__node[data-id="zoom-note"] .w-node-surface'))
      const zoom = Number(scope.getComputedStyle(scope.document.querySelector('.react-flow')).getPropertyValue('--w-zoom'))
      return { accent, colour: style.outlineColor, width: parseFloat(style.outlineWidth) * zoom }
    })
    expect(mark.colour).toBe(mark.accent)
    expect(mark.width).toBeCloseTo(3, 0)
    expect(far.sessionStatus?.shown).toBe(false)
    expect(far.noteText?.shown).toBe(false)
    await snapshotThemes(window, 'zoom-far')

    // Back at full, the bodies are back, and the Terminal ran on.
    for (let step = 0; step < 12 && (await zoomOf(window)) < 0.6; step++) await window.keyboard.press('ControlOrMeta+Equal')
    await expect(root).toHaveAttribute('data-zoom-level', 'full')
    for (const part of Object.values(body)) await expect(part).toBeVisible()
    await expect(nodes.terminal).toHaveAttribute('data-state', 'running')
  } finally {
    await launched.close()
  }
})
