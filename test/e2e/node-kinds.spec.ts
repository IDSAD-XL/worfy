import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { canvasReady, launchApp, parkPointer } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The kind of a Node in its header (worfy-canvas ticket 05, ADR-0077; F-SPEC "Node header"):
// Session, Orchestrator and the Epic frame carry a 4 px band in their `kind-*` colour on the pale
// `tint` of their kind, a Subagent a dashed band in the Session's colour, a Ticket neither. A
// finished Session is drawn at lower opacity; hovering it gives the full opacity back. The expected
// values are copied by hand from the Tokens table of docs/design/F-SPEC.md, so the test compares
// what the app draws against the design spec. A temporary WORFY_CLAUDE_HOME stands in for ~/.claude.

type Scheme = 'light' | 'dark'

const KIND: Record<Scheme, { orchestrator: string; orchestratorTint: string; session: string; sessionTint: string; epic: string; epicTint: string }> = {
  light: { orchestrator: '#A0527F', orchestratorTint: '#F6EAF1', session: '#2B8BC6', sessionTint: '#E6F2FA', epic: '#9A7A00', epicTint: '#F6F0D9' },
  dark: { orchestrator: '#CC79A7', orchestratorTint: '#2D2028', session: '#56B4E9', sessionTint: '#1B2730', epic: '#F0E442', epicTint: '#2A2716' },
}

const PROJECT = 'alpha-0000000a'
const SESSION = '55555555-5555-4555-8555-555555555555'
const AGENT = 'a0000000000000505'

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
  const toolUseId = 'toolu_kinds_0'
  const main = [
    record({ type: 'user', isSidechain: false, message: { role: 'user', content: 'Run the wave.' } }),
    record({ type: 'assistant', isSidechain: false, message: { id: 'm0', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'implementer', name: 'impl-05', run_in_background: true } }] } }),
    record({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId: AGENT } }),
  ]
  mkdirSync(join(dir, SESSION, 'subagents'), { recursive: true })
  writeFileSync(join(dir, SESSION, 'subagents', `agent-${AGENT}.meta.json`), JSON.stringify({ agentType: 'implementer', name: 'impl-05', toolUseId, spawnDepth: 1, requestShape: 'background' }))
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

/** The paint of a Node's kind band and of its header ground, as the browser computes them. */
async function headerPaint(node: Locator): Promise<{ band: string; dashed: boolean; ground: string } | null> {
  return node.evaluate((element) => {
    type El = { querySelector(selector: string): El | null; parentElement: El | null }
    type Style = { backgroundColor: string; borderTopStyle: string; borderTopColor: string }
    const scope = globalThis as unknown as { getComputedStyle(target: unknown): Style }
    const band = (element as unknown as El).querySelector('[data-testid="kind-band"]')
    if (!band?.parentElement) return null
    const style = scope.getComputedStyle(band)
    const dashed = style.borderTopStyle === 'dashed'
    return { band: dashed ? style.borderTopColor : style.backgroundColor, dashed, ground: scope.getComputedStyle(band.parentElement).backgroundColor }
  })
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-node-kinds-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  // Zoomed out, so that every Node is on the screen side by side.
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.6 } }))
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

test('node headers carry the band and the ground of their kind; a finished Session is dimmed until hovered', async () => {
  writeEpic()
  writeSession()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
    processes.push(claude)
    const registry = join(claudeHome, 'sessions', `${claude.pid}.json`)
    writeFileSync(registry, JSON.stringify({ pid: claude.pid, sessionId: SESSION, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave-05' }))

    const nodes = {
      orchestrator: window.getByTestId('orchestrator-node'),
      session: window.locator(`[data-testid="session-node"][data-session-id="${SESSION}"]`),
      subagent: window.locator(`[data-testid="subagent-node"][data-subagent-id="${AGENT}"]`),
      epic: window.getByTestId('epic-frame'),
      ticket: window.getByTestId('rf__node-ticket:demo/1'),
    }
    for (const node of Object.values(nodes)) await expect(node).toBeVisible()
    await expect(nodes.session).toHaveAttribute('data-status', 'busy')
    await expect(nodes.ticket.getByTestId('kind-band')).toHaveCount(0)
    await expect(nodes.ticket.getByTestId('kind-icon')).toHaveCount(0)
    await expect(nodes.orchestrator).toHaveAccessibleName('Orchestrator')
    await expect(nodes.session).toHaveAccessibleName('Session wave-05')
    await expect(nodes.subagent).toHaveAccessibleName('Subagent impl-05')
    // The kind icon in the Epic tag leaves the Epic's name whole in the header (HEADER_CHROME_WIDTH, epic-layout.ts).
    await expect(nodes.epic.getByTestId('kind-icon')).toBeVisible()
    const fits = await nodes.epic.locator('.w-epic__title').evaluate((element) => {
      const box = element as unknown as { scrollWidth: number; clientWidth: number }
      return box.scrollWidth - box.clientWidth
    })
    expect(fits).toBeLessThanOrEqual(0)

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const colour = KIND[scheme]
      await expect.poll(() => headerPaint(nodes.orchestrator), { message: `${scheme}: Orchestrator` }).toEqual({ band: rgb(colour.orchestrator), dashed: false, ground: rgb(colour.orchestratorTint) })
      await expect.poll(() => headerPaint(nodes.session), { message: `${scheme}: Session` }).toEqual({ band: rgb(colour.session), dashed: false, ground: rgb(colour.sessionTint) })
      await expect.poll(() => headerPaint(nodes.epic), { message: `${scheme}: Epic frame` }).toEqual({ band: rgb(colour.epic), dashed: false, ground: rgb(colour.epicTint) })
      await expect.poll(async () => (await headerPaint(nodes.subagent))?.band, { message: `${scheme}: Subagent` }).toBe(rgb(colour.session))
      expect((await headerPaint(nodes.subagent))?.dashed).toBe(true)
      // The status chip keeps its status colours: its text is never the kind's band.
      const chipColour = await nodes.session.getByTestId('session-node-status').locator('.w-chip').evaluate((chip) => (globalThis as unknown as { getComputedStyle(target: unknown): { color: string } }).getComputedStyle(chip).color)
      expect(chipColour).not.toBe(rgb(colour.session))
    }
    await window.emulateMedia({ colorScheme: null })

    // Reference look for the reviewer: the Nodes side by side, in both themes.
    await snapshotThemes(window, 'node-kinds')

    // The Session ends: its Node stays, finished, at lower opacity; hovering it gives the full opacity back.
    rmSync(registry)
    claude.kill('SIGTERM')
    await expect(nodes.session).toHaveAttribute('data-status', 'finished', { timeout: 15_000 })
    const opacity = () => nodes.session.evaluate((element) => Number((globalThis as unknown as { getComputedStyle(target: unknown): { opacity: string } }).getComputedStyle(element).opacity))
    // The machine's own cursor may rest over the Node and give it the full opacity: the test's pointer goes away first.
    await parkPointer(window)
    await expect.poll(opacity).toBeCloseTo(0.6, 2)
    await nodes.session.getByTestId('session-node-title').hover()
    await expect.poll(opacity).toBe(1)
    await window.mouse.move(2, 450)
    await expect.poll(opacity).toBeCloseTo(0.6, 2)
    await snapshotThemes(window, 'node-kinds-finished')
  } finally {
    await launched.close()
  }
})
