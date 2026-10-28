import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The minimap colours Nodes by kind (worfy-canvas ticket 04, ADR-0077): Session, Orchestrator and
// the Epic frame are filled with their `kind-*` colour, a Subagent is an outline in the Session's
// colour with no fill. The expected values are copied by hand from the Tokens table of
// docs/design/F-SPEC.md, so the test compares what the app draws against the design spec.
// A temporary WORFY_CLAUDE_HOME stands in for ~/.claude. With WORFY_EVIDENCE_DIR set, the minimap
// of both themes is copied there as the ticket's evidence.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

type Scheme = 'light' | 'dark'

const KIND: Record<Scheme, { orchestrator: string; session: string; epic: string }> = {
  light: { orchestrator: '#A0527F', session: '#2B8BC6', epic: '#9A7A00' },
  dark: { orchestrator: '#CC79A7', session: '#56B4E9', epic: '#F0E442' },
}

const PROJECT = 'alpha-0000000a'
const SESSION = '44444444-4444-4444-8444-444444444444'
const AGENT = 'a0000000000000404'
const NO_COLOR = 'rgba(0, 0, 0, 0)'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

/** `#RRGGBB` as the browser reports a computed colour. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** One Session with one Subagent running in the background, written the way Claude Code writes them. */
function writeSession(): void {
  const dir = transcriptDir(projectPath)
  const record = (fields: Record<string, unknown>) => JSON.stringify({ cwd: projectPath, sessionId: SESSION, version: '2.1.289', timestamp: '2026-10-19T10:00:00.000Z', ...fields })
  const toolUseId = 'toolu_minimap_0'
  const main = [
    record({ type: 'user', isSidechain: false, message: { role: 'user', content: 'Run the wave.' } }),
    record({ type: 'assistant', isSidechain: false, message: { id: 'm0', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'implementer', name: 'impl-04', run_in_background: true } }] } }),
    record({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId: AGENT } }),
  ]
  mkdirSync(join(dir, SESSION, 'subagents'), { recursive: true })
  writeFileSync(join(dir, SESSION, 'subagents', `agent-${AGENT}.meta.json`), JSON.stringify({ agentType: 'implementer', name: 'impl-04', toolUseId, spawnDepth: 1, requestShape: 'background' }))
  writeFileSync(join(dir, SESSION, 'subagents', `agent-${AGENT}.jsonl`), `${record({ type: 'assistant', isSidechain: true, agentId: AGENT, message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Working.' }], stop_reason: 'tool_use' } })}\n`)
  writeFileSync(join(dir, `${SESSION}.jsonl`), `${main.join('\n')}\n`)
}

/** epic-status answers one Epic with one open Ticket, so the Canvas has a frame from the start. */
function writeEpic(): void {
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = { epic: 'demo', num: 1, slug: 't1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: [ticket] }))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)
}

/** How the minimap draws one Node: the rectangle at the Node's place on the plane, with its computed paint. */
type Drawn = { fill: string; stroke: string; strokeWidth: string } | null

/**
 * The minimap rectangle of the Node whose React Flow wrapper is `wrapper`. The minimap draws each
 * Node at its absolute place on the plane, the place the wrapper is translated to.
 */
async function drawnOf(wrapper: Locator): Promise<Drawn> {
  return wrapper.evaluate((element) => {
    type Box = { getAttribute(name: string): string | null }
    type Doc = { querySelectorAll(selector: string): Iterable<Box> }
    type Style = { fill: string; stroke: string; strokeWidth: string; transform: string }
    const scope = globalThis as unknown as { document: Doc; getComputedStyle(target: unknown): Style }
    const matrix = /matrix\(([^)]+)\)/.exec(scope.getComputedStyle(element).transform)?.[1]?.split(',').map(Number)
    if (!matrix) return null
    const [x, y] = [matrix[4] ?? Number.NaN, matrix[5] ?? Number.NaN]
    for (const rect of scope.document.querySelectorAll('.react-flow__minimap-node')) {
      if (Math.abs(Number(rect.getAttribute('x')) - x) < 0.5 && Math.abs(Number(rect.getAttribute('y')) - y) < 0.5) {
        const style = scope.getComputedStyle(rect)
        return { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth }
      }
    }
    return null
  })
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-minimap-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  // Zoomed out, so that every Node is on the screen: React Flow renders only the visible ones, and
  // the test reads each one's place from its wrapper.
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.45 } }))
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

test('the minimap draws Session, Orchestrator and the Epic frame in their kind colour, a Subagent as an outline in the Session colour', async () => {
  writeEpic()
  writeSession()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
    processes.push(claude)
    writeFileSync(
      join(claudeHome, 'sessions', `${claude.pid}.json`),
      JSON.stringify({ pid: claude.pid, sessionId: SESSION, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave-04' }),
    )

    const wrapper = (inner: string): Locator => window.locator('.react-flow__node').filter({ has: window.locator(inner) })
    const nodes = {
      orchestrator: wrapper('[data-testid="orchestrator-node"]'),
      session: wrapper(`[data-testid="session-node"][data-session-id="${SESSION}"]`),
      subagent: wrapper(`[data-testid="subagent-node"][data-subagent-id="${AGENT}"]`),
      epic: window.getByTestId('rf__node-epic:demo'),
    }
    for (const node of Object.values(nodes)) await expect(node).toBeVisible()
    await expect(window.locator('.react-flow__minimap')).toBeVisible()

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const colour = KIND[scheme]
      const filled = (hex: string) => ({ fill: rgb(hex), stroke: NO_COLOR, strokeWidth: '0px' })
      await expect.poll(() => drawnOf(nodes.orchestrator), { message: `${scheme}: Orchestrator` }).toEqual(filled(colour.orchestrator))
      await expect.poll(() => drawnOf(nodes.session), { message: `${scheme}: Session` }).toEqual(filled(colour.session))
      await expect.poll(() => drawnOf(nodes.epic), { message: `${scheme}: Epic frame` }).toEqual(filled(colour.epic))
      await expect.poll(() => drawnOf(nodes.subagent), { message: `${scheme}: Subagent` }).toEqual({ fill: NO_COLOR, stroke: rgb(colour.session), strokeWidth: '1.5px' })
    }

    // Reference look for the reviewer: the window, and the minimap alone, in both themes.
    await snapshotThemes(window, 'minimap-kinds')
    const minimap = window.locator('.react-flow__minimap')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const path = test.info().outputPath(`minimap-kinds-${scheme}.png`)
      await minimap.screenshot({ path, animations: 'disabled' })
      if (EVIDENCE_DIR) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(path, join(EVIDENCE_DIR, `04-minimap-kinds-${scheme}.png`))
      }
    }
    await window.emulateMedia({ colorScheme: null })
  } finally {
    await launched.close()
  }
})
