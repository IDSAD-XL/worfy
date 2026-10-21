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
// a header of constant screen size, and its Tickets are blocks without text. The level is the
// `data-zoom-level` attribute of the React Flow root (overlays/ZoomLevel.tsx). The lowest zoom of the
// Canvas is ZOOM_MIN, 0.2 (src/shared/layout/types.ts), so the far view is checked there. A temporary
// WORFY_CLAUDE_HOME stands in for ~/.claude.

const PROJECT = 'alpha-0000000a'
const SESSION = '66666666-6666-4666-8666-666666666666'
const AGENT = 'a0000000000000606'
const EPIC = 'semantic-zoom-demo'

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

/** epic-status answers one Epic with three Tickets, so the Canvas has a frame of two columns. */
function writeEpic(): void {
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = (num: number, state: string, blockedNums: number[]) => ({
    epic: EPIC,
    num,
    slug: `t${num}`,
    title: `0${num} — Ticket ${num} of the demo`,
    statusRaw: state,
    state,
    blockedRaw: blockedNums.length ? blockedNums.map((each) => `0${each}`).join(', ') : '—',
    blockedNums,
    blockedParsed: true,
  })
  const tickets = [ticket(1, 'open', []), ticket(2, 'open', []), ticket(3, 'open', [1])]
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
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
  ]
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
      terminal: window.locator('.react-flow__node[data-id="zoom-terminal"]').getByTestId('terminal-node'),
      epic: window.getByTestId('epic-frame'),
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
    // The Terminal is not stopped below its header.
    await expect(nodes.terminal).toHaveAttribute('data-state', 'running')
    const zoomed = await nodes.session.boundingBox()
    expect(zoomed && sessionBox ? zoomed.width / sessionBox.width : 0).toBeCloseTo((await zoomOf(window)) / 0.6, 1)
    // An Epic frame and its Tickets are as in full.
    await expect(body.ticketMeta).toBeVisible()
    await expect(body.columnLabel).toBeVisible()
    await snapshotThemes(window, 'zoom-compact')

    // far (below 0.3): each Node a block of its kind with a large title; the Epic's name and progress readable.
    const farZoom = await zoomOutBelow(window, 0.21)
    expect(farZoom).toBeLessThan(0.3)
    await expect(root).toHaveAttribute('data-zoom-level', 'far')
    const far = await readings(window, {
      epicTitle: `[data-testid="epic-frame"][data-epic="${EPIC}"] .w-epic__title`,
      epicProgress: `[data-testid="epic-frame"][data-epic="${EPIC}"] [data-testid="epic-progress"]`,
      epicHeader: `[data-testid="epic-frame"][data-epic="${EPIC}"] .w-epic__header`,
      columnLabel: `[data-testid="epic-frame"][data-epic="${EPIC}"] [data-testid="epic-column"]`,
      ticketTitle: `[data-testid="rf__node-ticket:${EPIC}/1"] .w-ticket__title`,
      orchestrator: '[data-testid="orchestrator-node"] [data-node-title]',
      session: `[data-testid="session-node"][data-session-id="${SESSION}"] [data-node-title]`,
      sessionStatus: `[data-testid="session-node"][data-session-id="${SESSION}"] [data-testid="session-node-status"]`,
      subagent: `[data-testid="subagent-node"][data-subagent-id="${AGENT}"] [data-node-title]`,
      note: '.react-flow__node[data-id="zoom-note"] [data-node-title]',
      noteText: '.react-flow__node[data-id="zoom-note"] textarea',
      terminal: '.react-flow__node[data-id="zoom-terminal"] [data-node-title]',
    })
    // The frame's header keeps its screen size (24 px), whatever the zoom.
    expect(far.epicHeader?.height).toBeCloseTo(24, 0)
    expect(far.epicTitle).toMatchObject({ shown: true, whole: true, text: EPIC })
    expect(far.epicTitle?.height).toBeGreaterThanOrEqual(16)
    expect(far.epicProgress).toMatchObject({ shown: true, text: '0/3' })
    expect(far.columnLabel?.shown).toBe(false)
    expect(far.ticketTitle?.shown).toBe(false)
    // Every kind by its title, large on the screen (15 px at any zoom).
    const titles: Record<string, string> = { orchestrator: 'Orchestrator', session: 'wave-06', subagent: 'impl-06', note: 'Note', terminal: 'Terminal' }
    for (const [name, text] of Object.entries(titles)) {
      expect(far[name], name).toMatchObject({ shown: true, whole: true, text })
      expect(far[name]?.height, name).toBeGreaterThanOrEqual(17)
    }
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
