import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { catScript } from '../harness-node'

// No semantic zoom (worfy-canvas ticket 20, the owner's decision of 2026-10-21; F-SPEC "Zoom"): at
// every zoom each Node is drawn whole, only scaled by the Canvas transform. Ticket 06 had drawn a
// Node as its header alone from 0.3 up to 0.6 and as a block of its kind below 0.3; here the same
// Canvas is checked at 0.6, at about 0.5, at about 0.35 and at the lowest zoom of the Canvas,
// ZOOM_MIN 0.2 (src/shared/layout/types.ts): every body is shown, neither hidden nor transparent, the Ticket cards keep their text, a Terminal
// keeps its rows and columns, and the Epic frames keep their arrangement. A Card runs its page from
// zoom 0.4 up (CardNode LIVE_ZOOM_MIN) and below it is its title in a frame, as before ticket 06.
// A temporary WORFY_CLAUDE_HOME stands in for ~/.claude.

const PROJECT = 'alpha-0000000a'
const SESSION = '66666666-6666-4666-8666-666666666666'
const AGENT = 'a0000000000000606'
const EPIC = 'zoom-demo'
/** A second Epic, beside the first, with a longer name. */
const EPIC_LONG = 'zoom-second-epic-with-a-long-name'
/** A third Epic: with K = 2 its frame stands under the first one, in the same column. */
const EPIC_BELOW = 'zoom-third-epic-below'
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

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-zoom-whole-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const nodes = [
    { id: 'zoom-note', kind: 'note', x: 20, y: 700, w: 240, h: 140, ...base, data: { text: 'A note with a body that stays when zoomed out' } },
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
  // Every Node is on the screen side by side at 0.6.
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


test('every Node is drawn whole at any zoom, down to the lowest: bodies, Ticket text, the Terminal screen at its size', async () => {
  writeEpic()
  writeSession()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
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

    // What a Node shows below its header, and what a Ticket card and an Epic frame show: all of it at every zoom.
    const whole = {
      noteText: nodes.note.locator('textarea'),
      pinnedText: nodes.pinned.locator('textarea'),
      terminalScreen: nodes.terminal.locator('.xterm'),
      sessionStatus: nodes.session.getByTestId('session-node-status'),
      sessionSource: nodes.session.getByTestId('session-node-source'),
      subagentStatus: nodes.subagent.getByTestId('subagent-status'),
      subagentKind: nodes.subagent.getByTestId('subagent-kind'),
      subagentOpen: nodes.subagent.getByTestId('subagent-open'),
      orchestratorState: nodes.orchestrator.getByTestId('orchestrator-state'),
      orchestratorModel: nodes.orchestrator.getByTestId('orchestrator-model'),
      orchestratorBlock: nodes.orchestrator.locator('[data-testid^="orchestrator-status-block"]').first(),
      handoffText: nodes.handoff.getByText('Nothing yet.'),
      ticketTitle: nodes.ticket.locator('.w-ticket__title'),
      ticketMeta: nodes.ticket.locator('.w-ticket__meta'),
      columnLabel: nodes.epic.getByTestId('epic-column').first(),
      epicTag: nodes.epic.locator('.w-epic__tag'),
      epicProgress: nodes.epic.getByTestId('epic-progress'),
    }
    // toBeVisible reads `visibility` and the box only; checkVisibility also sees an opacity of 0 on
    // the part or on anything round it (a Node, the viewport).
    const allWhole = async (zoom: string) => {
      for (const [name, part] of Object.entries(whole)) {
        await expect(part, `${name} at zoom ${zoom}`).toBeVisible()
        await expect
          .poll(() => part.evaluate((element) => (element as unknown as { checkVisibility(options: object): boolean }).checkVisibility({ opacityProperty: true, visibilityProperty: true })), { message: `${name} at zoom ${zoom}: not hidden by opacity or visibility` })
          .toBe(true)
      }
      await expect(whole.ticketTitle).toContainText('Ticket 1 of the demo')
    }

    // 0.6: the Nodes as they are; the Terminal's size once two reads in a row agree (xterm fits its
    // rows to the Node after it is drawn).
    await expect.poll(() => zoomOf(window)).toBeCloseTo(0.6, 2)
    await allWhole('0.6')
    await expect(nodes.card.getByTestId('card-frame')).toBeVisible()
    let lastRead = ''
    await expect
      .poll(async () => {
        const read = JSON.stringify(await terminalSize(window))
        const settled = read === lastRead
        lastRead = read
        return settled
      }, { message: 'the Terminal size settles' })
      .toBe(true)
    const terminalAtStart = JSON.parse(lastRead) as Awaited<ReturnType<typeof terminalSize>>
    expect(terminalAtStart.rows).toBeGreaterThan(3)
    const sessionAtStart = await nodes.session.boundingBox()

    /** The Session Node's screen size follows the zoom alone: the Canvas transform scales it, nothing else. */
    const scaledOnly = async (zoom: number) => {
      const box = await nodes.session.boundingBox()
      expect(box && sessionAtStart ? box.width / sessionAtStart.width : 0).toBeCloseTo(zoom / 0.6, 2)
      expect(box && sessionAtStart ? box.height / sessionAtStart.height : 0).toBeCloseTo(zoom / 0.6, 2)
    }

    // About 0.5 (where ticket 06 drew a Node as its header alone): everything still whole; the Card runs its page.
    const middle = await zoomOutBelow(window, 0.6)
    expect(middle).toBeGreaterThan(0.4)
    await allWhole(middle.toFixed(2))
    await expect(nodes.card.getByTestId('card-frame')).toBeVisible()
    await expect.poll(() => terminalSize(window)).toEqual(terminalAtStart)
    await scaledOnly(middle)

    // About 0.35 (where ticket 06 still drew a Node as its header alone): everything still whole;
    // below 0.4 the Card is its title in a frame (CardNode LIVE_ZOOM_MIN), as before ticket 06.
    const low = await zoomOutBelow(window, 0.36)
    expect(low).toBeGreaterThan(0.3)
    await allWhole(low.toFixed(2))
    await expect(nodes.card.getByTestId('card-placeholder')).toBeVisible()
    await expect.poll(() => terminalSize(window)).toEqual(terminalAtStart)
    await scaledOnly(low)

    // The lowest zoom (where ticket 06 drew a block of the kind and Tickets without text).
    const lowest = await zoomOutBelow(window, 0.21)
    expect(lowest).toBeLessThan(0.21)
    await allWhole(lowest.toFixed(2))
    await expect(nodes.terminal).toHaveAttribute('data-state', 'running')
    await expect.poll(() => terminalSize(window)).toEqual(terminalAtStart)
    await scaledOnly(lowest)
    // Below 0.4 the Card is its title in a frame (CardNode LIVE_ZOOM_MIN), as it was before ticket 06.
    await expect(nodes.card.getByTestId('card-placeholder')).toBeVisible()
    await expect(nodes.card.getByTestId('card-title')).toHaveText(CARD_TITLE)

    // The first two frames stand side by side, the third under the first (the others are off the
    // screen at 0.6, so they are checked here).
    const frameOf = (epic: string) => window.locator(`[data-testid="epic-frame"][data-epic="${epic}"]`).boundingBox()
    const [first, second, below] = await Promise.all([frameOf(EPIC), frameOf(EPIC_LONG), frameOf(EPIC_BELOW)])
    if (!first || !second || !below) throw new Error('an Epic frame has no box')
    expect(Math.abs(first.y - second.y), 'the first two frames in one row').toBeLessThan(1)
    expect(Math.abs(first.x - below.x), "the third frame in the first one's column").toBeLessThan(1)
    expect(below.y, 'the third frame under the first').toBeGreaterThan(first.y + first.height)
    for (const epic of [EPIC_LONG, EPIC_BELOW]) await expect(window.locator(`[data-testid="epic-frame"][data-epic="${epic}"] .w-epic__title`)).toContainText(epic)

    // Back at 0.6, the Card runs its page again, and the Terminal ran on.
    for (let step = 0; step < 12 && (await zoomOf(window)) < 0.6; step++) await window.keyboard.press('ControlOrMeta+Equal')
    await expect(nodes.card.getByTestId('card-frame')).toBeVisible()
    await expect(nodes.terminal).toHaveAttribute('data-state', 'running')
  } finally {
    await launched.close()
  }
})
