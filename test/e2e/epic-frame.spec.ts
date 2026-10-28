import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { codeSection } from '../../src/main/workflow/reader'
import ELK from 'elkjs/lib/elk.bundled.js'
import { FRAME_GAP, layoutEpic, MIN_FRAME_WIDTH, stackFrames, type EpicLayout, type Rect } from '../../src/renderer/canvas/epic-layout'
import { layoutEpicElk } from '../../src/renderer/canvas/elk/layout'
import { ORCHESTRATOR_WIDTH } from '../../src/shared/ipc/orchestrator'
import { onThePlane } from '../../src/shared/layout/derived'
import { epicStatusSchema, type Ticket } from '../../src/shared/workflow/types'
import { readyWave, ticketLevels } from '../../src/shared/workflow/waves'
import { canvasReady, expectSettledWithoutOverlaps, flowPositionsInOnePass, launchApp, oneBoxEachInOnePass, parkPointer, repoRoot, settledBoxes, settledRead, ticketCardCuts, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { measuresReference, RUNNER_START_CAP_MS, START_RATIO, startBudget } from './start-budget'
import { settled } from './wait'
import { catScript } from '../harness-node'

// Epic frames on the Canvas of the built app, over Projects in temporary git repositories and a
// stub `bin/epic-status` in a temporary WORFY_CLAUDE_HOME that reads the Ticket files the way the
// real script does: the one-fact-per-line header of harness/bin/TICKETS.md (`Status: <word> [<time>]`,
// `Blocked reason:`, `Waits:`, `PR: #N`). Projects are written into projects.json up front.

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface PageGlobals {
  document: { documentElement: object }
  getComputedStyle: (element: object) => { getPropertyValue: (name: string) => string; backgroundColor: string; color: string }
  requestAnimationFrame: (callback: (now: number) => void) => number
  performance: { now: () => number }
}

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const STUB_JS = String.raw`
const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 })
let files
if (ref) {
  files = git('ls-tree', '-r', '--name-only', ref, '--', '.scratch').split('\n').filter(Boolean).map((p) => [p, () => git('show', ref + ':' + p)])
} else {
  files = []
  if (existsSync('.scratch')) for (const epic of readdirSync('.scratch').sort()) {
    if (existsSync(join('.scratch', epic, 'spec.md'))) files.push([join('.scratch', epic, 'spec.md'), () => ''])
    const dir = join('.scratch', epic, 'issues')
    if (existsSync(dir)) for (const f of readdirSync(dir).sort()) files.push([join(dir, f), () => readFileSync(join(dir, f), 'utf8')])
  }
}
const epics = new Map()
const tickets = []
for (const [path, read] of files) {
  // join() writes backslashes on Windows, git ls-tree writes slashes: split on both.
  const parts = path.split(/[\\/]/)
  const epic = parts[1]
  if (!epics.has(epic)) epics.set(epic, { epic, hasSpec: false, hasMap: false })
  if (parts.length === 3 && parts[2] === 'spec.md') epics.get(epic).hasSpec = true
  if (parts.length !== 4 || parts[2] !== 'issues' || !parts[3].endsWith('.md')) continue
  const m = /^(\d+)-(.*)\.md$/.exec(parts[3])
  if (!m) continue
  // A checkout with CRLF line ends (core.autocrlf on Windows) reads as lines all the same.
  const text = read()
  const last = (name) => { let v = null; for (const l of text.split(/\r?\n/)) { const x = new RegExp('^' + name + ':\\s*(.*)$', 'i').exec(l); if (x) v = x[1] } return v }
  const first = (name) => { for (const l of text.split(/\r?\n/)) { const x = new RegExp('^' + name + ':\\s*(.*)$').exec(l); if (x) return x[1].trim() } return null }
  const line = text.split(/\r?\n/).find((l) => /^\**status\**\s*:/i.test(l)) ?? null
  const status = line === null ? null : line.replace(/^[^:]*:\s*/, '')
  const fmt = line === null ? null : /^Status: (open|claimed|blocked|done)(?: (\S+))?$/.exec(line)
  const state = fmt === null ? 'none' : fmt[1] === 'claimed' ? 'work' : fmt[1]
  const pr = fmt && /^#(\d+)$/.exec(first('PR') ?? '')
  const facts = { statusAt: fmt?.[2] ?? null, statusError: line !== null && fmt === null ? 'old header' : null,
    blockedReason: fmt ? first('Blocked reason') : null, waits: fmt ? first('Waits') : null, pr: pr ? Number(pr[1]) : null }
  const blocked = last('Blocked by')
  const nums = blocked && !/^[—-]$/.test(blocked.trim()) ? blocked.split(',').map((s) => Number(s.trim())) : []
  tickets.push({ epic, num: Number(m[1]), slug: m[2], title: (text.split(/\r?\n/)[0] || '').replace(/^#\s*/, ''), statusRaw: status, state, ...facts,
    blockedRaw: blocked, blockedNums: nums.filter((n) => !Number.isNaN(n)), blockedParsed: nums.every((n) => !Number.isNaN(n)) })
}
process.stdout.write(JSON.stringify({ ref: ref ?? 'main', epics: [...epics.values()], tickets }))
`

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

let scratch: string
let dataDir: string
let claudeHome: string

/** A Claude home whose bin/epic-status is the stub above, or `cat` of a ready answer; `delay` seconds before it answers. */
function makeClaudeHome(answer?: string, delay = 0): void {
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const js = join(claudeHome, 'stub.cjs')
  writeFileSync(js, STUB_JS)
  const script = join(claudeHome, 'bin', 'epic-status')
  // A Node script: worfy runs the Harness scripts as `node <script>`. The stub gets the same arguments.
  const run = answer === undefined ? `import(${JSON.stringify(pathToFileURL(js).href)})` : catScript(answer).trim()
  writeFileSync(script, delay ? `setTimeout(() => ${run}, ${delay * 1000})\n` : `${run}\n`)
  chmodSync(script, 0o755)
}

const PROJECT_ID = 'demo-0000000d'

/**
 * main places the Orchestrator Node at (40, 40), so the frames' column starts right of it
 * (ADR-0032); the Canvas starts with the column's left edge 40 px from the Canvas's left edge, at
 * zoom 1, so that screen pixels are canvas units.
 */
const FRAMES_IN_VIEW = { x: 40 - (40 + ORCHESTRATOR_WIDTH + FRAME_GAP), y: 40, zoom: 1 }

/** A git repository with a `.scratch`, listed as the only and active Project; the Canvas starts at `viewport` with the saved `nodes`. */
function makeProject(fill: (scratchDir: string) => void, viewport = FRAMES_IN_VIEW, nodes: unknown[] = []): string {
  const repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch'), { recursive: true })
  fill(join(repo, '.scratch'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes, viewport }))
  return repo
}

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

function ticketText(num: number, status: string, blocked: string): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Что делаем', '', 'text', ''].join('\n')
}

/** The Status value of a blocked Ticket with its reason on the next header line, as `ticket block` writes them. */
const blockedWith = (reason: string): string => `blocked 2026-10-17T09:41Z\nBlocked reason: ${reason}`

/** Rewrites the Status line of a Ticket file, as `ticket claim` / `ticket done` do. */
function setStatus(file: string, status: string): void {
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^Status: .*$/m, `Status: ${status}`))
}

/** The node's place on the Canvas, from React Flow's transform (absolute canvas units). */
async function flowPosition(window: Page, id: string): Promise<{ x: number; y: number }> {
  const transform = await window.getByTestId(`rf__node-${id}`).evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`no translate in ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** A Ticket's place relative to its frame, the two read in one pass (helpers.ts). */
async function inFrame(window: Page, epic: string, num: number): Promise<{ x: number; y: number }> {
  return (await inFrameAll(window, epic, [num]))[num]!
}

/** The places of several Tickets relative to their frame, the frame and all the Tickets read in one pass. */
async function inFrameAll(window: Page, epic: string, nums: readonly number[]): Promise<Record<number, { x: number; y: number }>> {
  const read = await flowPositionsInOnePass(window, [`epic:${epic}`, ...nums.map((num) => `ticket:${epic}/${num}`)])
  const frame = read[`epic:${epic}`]!
  const places: Record<number, { x: number; y: number }> = {}
  for (const num of nums) {
    const ticket = read[`ticket:${epic}/${num}`]!
    places[num] = { x: Math.round(ticket.x - frame.x), y: Math.round(ticket.y - frame.y) }
  }
  return places
}

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  hidden: boolean
  pinned: boolean
  data: Record<string, unknown>
}

async function layoutNodes(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke(
        'layout.get',
        { projectId: id },
      ),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}

/** The Nodes on the plane in the saved Layout: the frames' column keeps clear of them (ADR-0032). */
async function planeRects(window: Page): Promise<Rect[]> {
  return (await layoutNodes(window)).filter(onThePlane).map(({ x, y, w, h }) => ({ x, y, w, h }))
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

const ticketNode = (window: Page, num: number) => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-epics-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

// ── the worfy-mvp Epic ──────────────────────────────────────────────────────

const FIXTURE = join(repoRoot, 'test', 'fixtures', 'worfy-mvp-epic')

/** The fixture copy of the worfy-mvp Epic, every Ticket open, read the way the reader reads it. */
function fixtureTickets(): Ticket[] {
  const snapshot = epicStatusSchema.parse(JSON.parse(readFileSync(join(FIXTURE, 'epic-status.json'), 'utf8')))
  const issues = readdirSync(join(FIXTURE, 'issues'))
  return snapshot.tickets.map((t) => {
    const file = issues.find((name) => name === `${String(t.num).padStart(2, '0')}-${t.slug}.md`)
    if (!file) throw new Error(`no issue file for ${t.num}`)
    const section = codeSection(readFileSync(join(FIXTURE, 'issues', file), 'utf8'))
    return { ...t, files: section.files, filesListed: section.listed, fromBranch: null }
  })
}

test('the worfy-mvp Epic: columns by level, places and routes by ELK in a worker, ready Tickets marked by a chip, blocking arrows as "Blocked by" says, a status change shown within a second', async () => {
  makeClaudeHome()
  const repo = makeProject(
    (dir) => {
      mkdirSync(join(dir, 'worfy-mvp'))
      cpSync(join(FIXTURE, 'spec.md'), join(dir, 'worfy-mvp', 'spec.md'))
      cpSync(join(FIXTURE, 'issues'), join(dir, 'worfy-mvp', 'issues'), { recursive: true })
    },
    // Zoomed out so the whole frame is on screen: React Flow draws only visible Nodes.
    { x: 20, y: 20, zoom: 0.3 },
  )
  const tickets = fixtureTickets()
  const launched = await launch()
  // The window's workers, those started before this line included.
  const layoutWorkers: string[] = []
  launched.window.on('worker', (worker) => layoutWorkers.push(worker.url()))
  layoutWorkers.push(...launched.window.workers().map((worker) => worker.url()))
  try {
    const { window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="worfy-mvp"]')
    await expect(frame).toBeVisible()
    await expect(window.getByTestId('epic-progress')).toHaveText(`0/${tickets.length}`)
    await expect(window.getByTestId('ticket-node')).toHaveCount(tickets.length)

    // Columns: one x per dependency level, left to right in level order.
    const levels = ticketLevels(tickets, 'worfy-mvp')
    const xByLevel = new Map<number, number>()
    const placed = await settledRead(() => inFrameAll(window, 'worfy-mvp', tickets.map((ticket) => ticket.num)), 'the places of the Tickets in the frame')
    for (const ticket of tickets) {
      const level = levels.get(ticket.num)
      if (level?.kind !== 'level') throw new Error(`ticket ${ticket.num} has no level`)
      const { x } = placed[ticket.num]!
      const known = xByLevel.get(level.level)
      if (known === undefined) xByLevel.set(level.level, x)
      else expect(x, `ticket ${ticket.num}`).toBe(known)
    }
    const ordered = [...xByLevel].sort(([a], [b]) => a - b).map(([, x]) => x)
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b))
    expect(new Set(ordered).size).toBe(ordered.length)

    // The ready Wave: exactly the Tickets of Wave 1, each with its "Ready" chip (ADR-0037); no box
    // around them, the column's "Ready wave · N" chip stays.
    const ready = readyWave(tickets, 'worfy-mvp').ready.map((entry) => entry.num)
    expect(ready.length).toBeGreaterThan(0)
    const marked = await window.locator('[data-testid="ticket-node"][data-ready="true"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-ticket'))))
    expect(marked.sort((a, b) => a - b)).toEqual(ready)
    const chips = await window.locator('[data-testid="ticket-node"]:has([data-testid="ticket-ready"])').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-ticket'))))
    expect(chips.sort((a, b) => a - b)).toEqual(ready)
    await expect(frame.getByText(`Ready wave · ${ready.length}`)).toBeVisible()
    await expect(window.getByTestId('ready-wave')).toHaveCount(0)

    // One arrow per "Blocked by" entry, from the blocker to the blocked Ticket.
    const expected = tickets.flatMap((t) => t.blockedNums.map((b) => `rf__edge-blocks:worfy-mvp/${b}->${t.num}`)).sort()
    expect(expected.length).toBeGreaterThan(20)
    await expect
      .poll(async () => (await window.locator('[data-testid^="rf__edge-blocks:"]').evaluateAll((edges) => edges.map((e) => e.getAttribute('data-testid')))).sort())
      .toEqual(expected)

    // ELK lays the frame out in a worker of the built app (ADR-0037): the worker runs, every Ticket
    // gets ELK's place and every arrow its route.
    expect(layoutWorkers.some((url) => url.includes('elk-worker')), layoutWorkers.join(', ')).toBe(true)
    const elkLayout = await layoutEpicElk({ tickets, doneExpanded: false, name: 'worfy-mvp' }, new ELK())
    await expect
      .poll(() => inFrameAll(window, 'worfy-mvp', elkLayout.tickets.map((t) => t.num)))
      .toEqual(Object.fromEntries(elkLayout.tickets.map((t) => [t.num, { x: Math.round(t.x), y: Math.round(t.y) }])))
    await expect.poll(() => window.locator('[data-testid^="rf__edge-blocks:"] path.react-flow__edge-path[data-routed="true"]').count()).toBe(expected.length)
    // Rounded corners: every route ELK bent has a quadratic curve at each corner.
    const paths = await window.locator('[data-testid^="rf__edge-blocks:"] path.react-flow__edge-path').evaluateAll((edges) => edges.map((e) => e.getAttribute('d') ?? ''))
    expect(paths.some((d) => d.includes('Q'))).toBe(true)
    for (const d of paths) expect(d, d).toMatch(/^M [\d.-]+ [\d.-]+( L [\d.-]+ [\d.-]+( Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+)?)+$/)
    // By default only the Edges from blockers that are not done are drawn (worfy-week ticket 05),
    // all of them pale: here no Ticket is done yet, so every one. Hiding the Edges from done
    // blockers and lighting a chain are in edges.spec.ts.
    const notDone = new Set(tickets.filter((t) => t.state !== 'done').map((t) => t.num))
    const drawnByDefault = tickets.flatMap((t) => t.blockedNums.filter((b) => notDone.has(b)).map((b) => `blocks:worfy-mvp/${b}->${t.num}`)).sort()
    expect(drawnByDefault).toEqual(expected.map((id) => id.replace(/^rf__edge-/, '')))
    await window.mouse.move(0, 0)
    await expect
      .poll(async () => (await window.locator('[data-testid^="rf__edge-blocks:"] path.react-flow__edge-path[data-focus="pale"]').evaluateAll((edges) => edges.map((e) => e.getAttribute('id')))).sort())
      .toEqual(drawnByDefault)
    const shots = await snapshotThemes(window, 'epic-frame-elk')
    console.log(`epic frame by ELK: ${shots.light} ${shots.dark}`)

    // `ticket claim` rewrites the Status line; the Card follows without a restart.
    const first = join(repo, '.scratch', 'worfy-mvp', 'issues', readdirSync(join(repo, '.scratch', 'worfy-mvp', 'issues')).find((f) => f.startsWith('01-'))!)
    // The moment the Card's state changes (its data-state, which the stepper follows) is taken inside
    // the page by a MutationObserver, so the polling interval of Playwright's assertions is not
    // counted. Both clocks are this machine's.
    await window.evaluate(() => {
      const page = globalThis as unknown as {
        document: { querySelector(selector: string): object | null; body: object }
        MutationObserver: new (callback: () => void) => { observe(target: object, options: object): void; disconnect(): void }
        claimedAt?: number
      }
      const shown = () => page.document.querySelector('[data-testid="ticket-node"][data-ticket="1"][data-state="work"]') !== null
      const observer = new page.MutationObserver(() => {
        if (page.claimedAt === undefined && shown()) {
          page.claimedAt = Date.now()
          observer.disconnect()
        }
      })
      observer.observe(page.document.body, { attributes: true, childList: true, subtree: true })
    })
    const started = Date.now()
    setStatus(first, 'claimed 2026-10-05T09:41Z')
    await expect(ticketNode(window, 1)).toHaveAttribute('data-state', 'work', { timeout: 5_000 })
    const shownAt = await window.evaluate(() => (globalThis as unknown as { claimedAt?: number }).claimedAt)
    expect(shownAt).toBeDefined()
    const elapsed = shownAt! - started
    console.log(`status change shown after ${elapsed} ms`)
    expect(elapsed).toBeLessThanOrEqual(1_000)
    // The Card names the Stage the claim moved it to (worfy-pipeline ticket 05), not the status word.
    await expect(ticketNode(window, 1)).toHaveAttribute('aria-label', 'Ticket 01, Implementing')
    // Wave 1 is taken: nothing is ready now.
    await expect(window.getByTestId('ticket-ready')).toHaveCount(0)
    await expect(window.locator('[data-testid="ticket-node"][data-ready="true"]')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

// ── nothing inside a frame is dragged (ADR-0037) ────────────────────────────

/** Tickets of the small Epic `demo` as the stub reports them. */
function demoTickets(states: Record<number, Ticket['state']>): Ticket[] {
  const blockers: Record<number, number[]> = { 1: [], 2: [1], 3: [1], 4: [2] }
  return [1, 2, 3, 4].map((num) => ({
    epic: 'demo',
    num,
    slug: `t${num}`,
    title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
    statusRaw: states[num] ?? 'open',
    state: states[num] ?? 'open',
    blockedRaw: blockers[num]!.length ? blockers[num]!.join(', ') : '—',
    blockedNums: blockers[num]!,
    blockedParsed: true,
    files: [],
    filesListed: false,
    fromBranch: null,
  }))
}

function writeDemo(dir: string): void {
  const issues = join(dir, 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(dir, 'demo', 'spec.md'), '# demo: a small Epic\n')
  for (const t of demoTickets({})) writeFileSync(join(issues, `${String(t.num).padStart(2, '0')}-t${t.num}.md`), ticketText(t.num, 'open', t.blockedRaw!))
}

/** A second, smaller Epic below `demo`: its frame's automatic place depends on demo's height. */
function writeZeta(dir: string): void {
  const issues = join(dir, 'zeta', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(dir, 'zeta', 'spec.md'), '# zeta: the Epic below\n')
  writeFileSync(join(issues, '01-z1.md'), ticketText(1, 'open', '—'))
}

/** demo's frame as ELK lays it out, with the done stack folded and open (the open one is the frames' column's reserve, ADR-0032). */
async function demoByElk(states: Record<number, Ticket['state']>): Promise<{ folded: EpicLayout; open: EpicLayout }> {
  const elk = new ELK()
  const tickets = demoTickets(states)
  return {
    folded: await layoutEpicElk({ tickets, doneExpanded: false, name: 'demo' }, elk),
    open: await layoutEpicElk({ tickets, doneExpanded: true, name: 'demo' }, elk),
  }
}

test('a Ticket is not dragged and keeps its ELK place; a frame dragged by its header keeps its offset after a restart and after a neighbour changes', async () => {
  makeClaudeHome()
  const repo = makeProject((dir) => {
    writeDemo(dir)
    writeZeta(dir)
  })
  const issues = join(repo, '.scratch', 'demo', 'issues')

  const placeOf = (layout: EpicLayout, num: number) => {
    const placed = layout.tickets.find((t) => t.num === num)!
    return { x: Math.round(placed.x), y: Math.round(placed.y) }
  }
  /** The automatic place of zeta's frame: under demo's frame, in the column clear of the Nodes on the plane (ADR-0032). */
  const zetaAuto = async (window: Page, states: Record<number, Ticket['state']>, demoCollapsed = false) => {
    const demo = await demoByElk(states)
    const collapsed = layoutEpic({ tickets: demoTickets(states), collapsed: true, doneExpanded: false, name: 'demo' })
    return stackFrames(
      [
        demoCollapsed
          ? { epic: 'demo', width: collapsed.width, height: collapsed.height }
          : { epic: 'demo', width: demo.folded.width, height: demo.folded.height, reserve: demo.open.height },
        { epic: 'zeta', width: MIN_FRAME_WIDTH, height: 0 },
      ],
      await planeRects(window),
    ).get('zeta')!.auto
  }
  let frameOffset: { dx: number; dy: number }

  const first = await launch()
  try {
    const { window } = first
    const three = ticketNode(window, 3)
    await expect(three).toBeVisible()
    const elk = (await demoByElk({})).folded
    await expect.poll(() => inFrame(window, 'demo', 3)).toEqual(placeOf(elk, 3))
    const before = await layoutNodes(window)

    // Dragged 200 px at zoom 1 (screen pixels are canvas units): the Ticket stays, nothing is saved.
    const start = await box(three.locator('.w-ticket__title'))
    await window.mouse.move(start.x + 20, start.y + 5)
    await window.mouse.down()
    await window.mouse.move(start.x + 20 + 200, start.y + 5 + 200, { steps: 12 })
    await window.mouse.up()
    expect(await inFrame(window, 'demo', 3)).toEqual(placeOf(elk, 3))
    // A save the drop sent would have reached main by now: the renderer has caught up with it.
    await settled(window)
    expect(await inFrame(window, 'demo', 3)).toEqual(placeOf(elk, 3))
    expect(await layoutNodes(window)).toEqual(before)

    // The second frame, dragged by its header: the Layout keeps the shift from its automatic
    // place (below demo), not the place itself.
    await expect.poll(() => flowPosition(window, 'epic:zeta')).toEqual(await zetaAuto(window, {}))
    const handle = await box(window.locator('[data-testid="epic-frame"][data-epic="zeta"] .w-epic__drag .w-epic__tag'))
    await window.mouse.move(handle.x + 5, handle.y + 5)
    await window.mouse.down()
    await window.mouse.move(handle.x + 5 + 120, handle.y + 5 + 80, { steps: 12 })
    await window.mouse.up()
    await expect.poll(async () => (await layoutNodes(window)).find((node) => node.id === 'epic:zeta')).toBeTruthy()
    const zeta = (await layoutNodes(window)).find((node) => node.id === 'epic:zeta')!
    expect(zeta.kind).toBe('epic-frame')
    expect(zeta.data).toEqual({})
    frameOffset = { dx: zeta.x, dy: zeta.y }
    // React Flow starts the drag on the first mouse step, so the frame travels a bit less than
    // the mouse; what matters is that the saved offset is where the frame was dropped.
    expect(frameOffset.dx).toBeGreaterThan(60)
    expect(frameOffset.dy).toBeGreaterThan(40)
    const zetaPlace = await zetaAuto(window, {})
    const dropped = await flowPosition(window, 'epic:zeta')
    expect({ dx: Math.round(dropped.x - zetaPlace.x), dy: Math.round(dropped.y - zetaPlace.y) }).toEqual(frameOffset)
    // Its Ticket moved with it: the place inside the frame is the same.
    expect(await inFrame(window, 'zeta', 1)).toEqual(placeOf(await layoutEpicElk({ tickets: [{ ...demoTickets({})[0]!, epic: 'zeta' }], doneExpanded: false, name: 'zeta' }, new ELK()), 1))
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const { window } = second
    await expect(ticketNode(window, 3)).toBeVisible()
    await expect.poll(() => inFrame(window, 'demo', 3)).toEqual(placeOf((await demoByElk({})).folded, 3))
    const zetaBefore = await zetaAuto(window, {})
    await expect.poll(() => flowPosition(window, 'epic:zeta')).toEqual({ x: zetaBefore.x + frameOffset.dx, y: zetaBefore.y + frameOffset.dy })

    // Ticket 02 is done: it folds into a Done column, 04 loses its blocker and the levels move;
    // ELK's new places replace the old ones.
    setStatus(join(issues, '02-t2.md'), 'done')
    const after = (await demoByElk({ 2: 'done' })).folded
    expect(placeOf(after, 3)).not.toEqual(placeOf((await demoByElk({})).folded, 3))
    await expect.poll(() => inFrame(window, 'demo', 3), { timeout: 5_000 }).toEqual(placeOf(after, 3))
    await expect(ticketNode(window, 2)).toHaveCount(0)
    expect(await inFrame(window, 'demo', 4)).toEqual(placeOf(after, 4))
    const zetaAfterDone = await zetaAuto(window, { 2: 'done' })
    await expect.poll(() => flowPosition(window, 'epic:zeta')).toEqual({ x: zetaAfterDone.x + frameOffset.dx, y: zetaAfterDone.y + frameOffset.dy })
    // demo's frame is collapsed to its header, so zeta's automatic place moves up; zeta keeps its
    // shift from it.
    await window.getByRole('button', { name: 'Collapse epic demo' }).click()
    const zetaAfter = await zetaAuto(window, { 2: 'done' }, true)
    expect(zetaAfter.y).toBeLessThan(zetaAfterDone.y)
    await expect.poll(() => flowPosition(window, 'epic:zeta')).toEqual({ x: zetaAfter.x + frameOffset.dx, y: zetaAfter.y + frameOffset.dy })
  } finally {
    await second.close()
  }
  // Moving a frame is saved in worfy's own data, never in the repository (ADR-0005); the status
  // edit above is the test's own change to a tracked file.
  expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('M .scratch/demo/issues/02-t2.md')
})

// ── frames and the Nodes main places (ADR-0032) ─────────────────────────────

const DEMO_DONE = { 1: 'done', 2: 'done', 3: 'done' } as const

/** demo with Tickets 01–03 done, so the frame has a done stack that is taller when opened, and a HANDOFF.md, so main places a HANDOFF Node. */
function writeDemoWithHandoff(dir: string): void {
  const issues = join(dir, 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(dir, 'demo', 'spec.md'), '# demo: a small Epic\n')
  for (const t of demoTickets(DEMO_DONE)) writeFileSync(join(issues, `${String(t.num).padStart(2, '0')}-t${t.num}.md`), ticketText(t.num, t.state, t.blockedRaw!))
  writeFileSync(join(dir, '..', 'HANDOFF.md'), '# HANDOFF\n\nNothing yet.\n')
}

const area = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** The Orchestrator and HANDOFF Nodes of the Layout, once main has placed both. */
async function mainNodes(window: Page): Promise<StateNode[]> {
  await expect.poll(async () => (await layoutNodes(window)).filter((node) => node.kind === 'orchestrator' || node.kind === 'handoff').length, { timeout: 10_000 }).toBe(2)
  return (await layoutNodes(window)).filter((node) => node.kind === 'orchestrator' || node.kind === 'handoff')
}

/** The area the demo frame covers of each of `nodes`, measured on the screen: the frame and the Nodes in one pass, once the layout is still (helpers.ts). */
async function underFrame(window: Page, nodes: readonly StateNode[]): Promise<number[]> {
  const selectors: Record<string, string> = { 'epic:demo': '[data-testid="rf__node-epic:demo"]' }
  for (const node of nodes) selectors[node.id] = `[data-testid="rf__node-${node.id}"]`
  const boxes = await settledBoxes(window, selectors, 'the boxes of the demo frame and the Nodes')
  return nodes.map((node) => area(boxes['epic:demo']!, boxes[node.id]!))
}

test('Tickets that arrive after main placed the Orchestrator and HANDOFF Nodes keep their frame off both, also with the done stack open', async () => {
  // epic-status answers 2 s late: main has placed both Nodes at the top left before there is a frame.
  makeClaudeHome(undefined, 2)
  makeProject(writeDemoWithHandoff, { x: 20, y: 20, zoom: 0.5 })
  const launched = await launch()
  try {
    const { window } = launched
    const placed = await mainNodes(window)
    expect(placed.find((node) => node.kind === 'orchestrator')).toMatchObject({ x: 40, y: 40 })
    await expect(window.getByTestId('rf__node-epic:demo')).toBeVisible({ timeout: 15_000 })
    for (const node of placed) await expect(window.getByTestId(`rf__node-${node.id}`)).toBeVisible()
    // Tab moves the focus to a Node's React Flow wrapper: it has its node source's name, or its kind's.
    await expect(window.getByTestId('rf__node-epic:demo')).toHaveAttribute('aria-label', 'Epic demo')
    await expect(window.getByTestId('rf__node-ticket:demo/4')).toHaveAttribute('aria-label', 'Ticket demo/04')
    await expect(window.getByTestId(`rf__node-${placed.find((node) => node.kind === 'orchestrator')!.id}`)).toHaveAttribute('aria-label', 'Orchestrator')
    expect(await underFrame(window, placed)).toEqual([0, 0])
    const column = await flowPosition(window, 'epic:demo')
    expect(column).toEqual(
      stackFrames([{ epic: 'demo', width: layoutEpic({ tickets: demoTickets(DEMO_DONE), collapsed: false, doneExpanded: false }).width, height: 0 }], await planeRects(window)).get('demo')!.auto,
    )

    // The opened done stack makes the frame taller; it grows down its column and covers neither Node.
    const before = await box(window.getByTestId('rf__node-epic:demo'))
    await window.getByRole('button', { name: /^\d+ done tickets of demo$/ }).click()
    await expect(ticketNode(window, 1)).toBeVisible()
    await expect.poll(async () => (await box(window.getByTestId('rf__node-epic:demo'))).height).toBeGreaterThan(before.height)
    expect(await flowPosition(window, 'epic:demo')).toEqual(column)
    expect(await underFrame(window, placed)).toEqual([0, 0])
  } finally {
    await launched.close()
  }
})

test('a saved Layout with the Orchestrator and HANDOFF Nodes where the frame used to go: the frame moves, the Nodes stay', async () => {
  makeClaudeHome()
  const saved = [
    { id: 'orchestrator-saved', kind: 'orchestrator', x: 40, y: 40, w: 360, h: 200, locked: true, data: {} },
    { id: 'handoff-saved', kind: 'handoff', x: 40, y: 280, w: 360, h: 320, locked: true, data: {} },
  ]
  const repo = makeProject(writeDemoWithHandoff, { x: 20, y: 20, zoom: 0.5 }, saved)
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.getByTestId('rf__node-epic:demo')).toBeVisible()
    const placed = await mainNodes(window)
    expect(placed.map(({ id, x, y }) => ({ id, x, y }))).toEqual(saved.map(({ id, x, y }) => ({ id, x, y })))
    expect(await underFrame(window, placed)).toEqual([0, 0])
    // Nothing was moved to get there: the Layout keeps both Nodes where they were (ADR-0032, no
    // `move` of the user's Nodes), and the repository is not touched (ADR-0005). A move would have
    // been sent in the same pass that placed the frame, which is drawn: the renderer has caught up.
    await settled(window)
    expect((await mainNodes(window)).map(({ id, x, y }) => ({ id, x, y }))).toEqual(saved.map(({ id, x, y }) => ({ id, x, y })))
    expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
  } finally {
    await launched.close()
  }
})

// ── states, themes, sidebar ─────────────────────────────────────────────────

const hexToRgb = (hex: string): string => {
  const value = hex.trim().replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

test('the steppers use the F tokens in both themes and always carry a label; the done stack, collapsing and the sidebar work', async () => {
  makeClaudeHome()
  const repo = makeProject((dir) => {
    const issues = join(dir, 'demo', 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(dir, 'demo', 'spec.md'), '# demo: a small Epic\n')
    writeFileSync(join(issues, '01-t1.md'), ticketText(1, 'done', '—'))
    writeFileSync(join(issues, '02-t2.md'), ticketText(2, 'claimed 2026-10-05T09:41Z', '01'))
    writeFileSync(join(issues, '03-t3.md'), ticketText(3, blockedWith('needs Stripe test keys'), '01'))
    writeFileSync(join(issues, '04-t4.md'), ticketText(4, 'open', '02, 03'))
    writeFileSync(join(issues, '05-t5.md'), ticketText(5, 'open', 'after the release'))
  })
  const launched = await launch()
  try {
    const { window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="demo"]')
    await expect(frame).toBeVisible()
    await expect(frame.getByRole('heading')).toContainText('a small Epic')
    await expect(window.getByTestId('epic-progress')).toHaveText('1/5')

    // The done Ticket is folded into the stack; a click opens it into a column.
    await expect(ticketNode(window, 1)).toHaveCount(0)
    await window.getByTestId('done-stack').click()
    await expect(ticketNode(window, 1)).toBeVisible()

    await expect(ticketNode(window, 3).getByText('needs Stripe test keys')).toBeVisible()
    await expect(ticketNode(window, 5)).toContainText('is not a list of tickets')
    await expect(frame.getByText('Needs attention')).toBeVisible()

    // The stepper of each Card in place of the old state chip (worfy-pipeline ticket 05): the
    // Stage's name as a chip in the old chip's colours, the current dot in the F token of its state
    // (blocked: the ring), and on the blocked Card a flag with the reason.
    const steps = [
      { num: 1, stage: 'Done', bg: '--done-bg', fg: '--done-text', dot: '--ready-dot', ring: false },
      { num: 2, stage: 'Implementing', bg: '--working-bg', fg: '--working-text', dot: '--working-dot', ring: false },
      { num: 3, stage: 'Implementing', bg: '--blocked-bg', fg: '--blocked-text', dot: '--blocked-ring', ring: true },
      { num: 4, stage: 'Queued', bg: '--surface-raised', fg: '--text-secondary', dot: '--border-strong', ring: false },
    ]
    const colorsOf = (element: Locator, names: string[]) =>
      element.evaluate(
        (node, names) => {
          const { document, getComputedStyle } = globalThis as unknown as PageGlobals
          const root = getComputedStyle(document.documentElement)
          const style = getComputedStyle(node) as unknown as { backgroundColor: string; color: string; borderTopColor: string }
          return { bg: style.backgroundColor, fg: style.color, border: style.borderTopColor, tokens: names.map((name) => root.getPropertyValue(name)) }
        },
        names,
      )
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      for (const step of steps) {
        const stepper = ticketNode(window, step.num).getByTestId('ticket-stepper')
        await expect(ticketNode(window, step.num)).toHaveAttribute('aria-label', `Ticket ${String(step.num).padStart(2, '0')}, ${step.stage}`)
        const label = stepper.getByTestId('stepper-label')
        await expect(label).toHaveText(step.stage)
        // Done carries the check of the done chip (F-SPEC: done is text plus a check icon).
        await expect(label.locator('svg')).toHaveCount(step.stage === 'Done' ? 1 : 0)
        const chip = await colorsOf(label, [step.bg, step.fg])
        expect(chip.bg, `${scheme} Ticket ${step.num} Stage background`).toBe(hexToRgb(chip.tokens[0]!))
        expect(chip.fg, `${scheme} Ticket ${step.num} Stage text`).toBe(hexToRgb(chip.tokens[1]!))
        const dot = await colorsOf(stepper.locator('[data-state="current"]'), [step.dot])
        expect(step.ring ? dot.border : dot.bg, `${scheme} Ticket ${step.num} current dot`).toBe(hexToRgb(dot.tokens[0]!))
      }
      const flag = ticketNode(window, 3).getByTestId('stepper-blocked')
      await expect(flag).toHaveAttribute('title', 'blocked: needs Stripe test keys')
      const flagColors = await colorsOf(flag, ['--blocked-bg', '--blocked-text'])
      expect(flagColors.bg, `${scheme} blocked flag background`).toBe(hexToRgb(flagColors.tokens[0]!))
      expect(flagColors.fg, `${scheme} blocked flag text`).toBe(hexToRgb(flagColors.tokens[1]!))
      await window.screenshot({ path: test.info().outputPath(`epic-frame-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // The sidebar lists the Epic; a click centers the Canvas on its frame.
    const row = window.locator('[data-testid="sidebar-epic"][data-epic="demo"]')
    await expect(row).toContainText('1/5')
    await expect(row).toContainText('1 in work')
    const pane = await box(window.locator('.react-flow'))
    await window.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
    // Panned so the frame starts left of the Canvas but is still partly on screen (an off-screen
    // Node is not drawn at all).
    await window.mouse.wheel(400, 0)
    const frameAndPane = () => oneBoxEachInOnePass(window, { frame: '[data-testid="epic-frame"][data-epic="demo"]', pane: '.react-flow' })
    await expect.poll(async () => {
      const boxes = await frameAndPane()
      return boxes ? boxes.pane.x - boxes.frame.x : 0
    }).toBeGreaterThan(0)
    // The pan has ended (React Flow ends a wheel pan after a pause) before the centering starts.
    await canvasReady({ window })
    await row.click()
    await expect
      .poll(async () => {
        const boxes = await frameAndPane()
        if (!boxes) return false
        const { frame: b, pane: p } = boxes
        return Math.abs(b.x + b.width / 2 - (p.x + p.width / 2)) < 4 && Math.abs(b.y + b.height / 2 - (p.y + p.height / 2)) < 4
      })
      .toBe(true)

    // Collapsing leaves one row and is saved in the Layout.
    await frame.getByRole('button', { name: 'Collapse epic demo' }).click()
    await expect(frame).toHaveAttribute('data-collapsed', 'true')
    await expect(window.getByTestId('ticket-node')).toHaveCount(0)
    await expect.poll(async () => (await layoutNodes(window)).find((node) => node.id === 'epic:demo')?.data.collapsed).toBe(true)
    await frame.getByRole('button', { name: 'Expand epic demo' }).click()
    await expect(ticketNode(window, 2)).toBeVisible()
  } finally {
    await launched.close()
  }
  // Moving, folding and collapsing are saved in worfy's own data, never in the repository (ADR-0005).
  expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

// ── long names (worfy-daily ticket 11) ──────────────────────────────────────

interface Fit {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
  lineHeight: number
  title: string | null
}

async function fit(locator: Locator): Promise<Fit> {
  return locator.evaluate((node) => {
    const element = node as unknown as Omit<Fit, 'lineHeight' | 'title'> & { getAttribute: (name: string) => string | null }
    const { getComputedStyle } = globalThis as unknown as { getComputedStyle: (element: object) => { lineHeight: string } }
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      lineHeight: parseFloat(getComputedStyle(node).lineHeight),
      title: element.getAttribute('title'),
    }
  })
}

const overflows = (f: Fit) => f.scrollWidth > f.clientWidth || f.scrollHeight > f.clientHeight

/** Shows its whole text, or cuts it and carries the whole text in its tooltip. */
async function expectWholeOrTitled(locator: Locator, whole: string, what: string): Promise<Fit> {
  const f = await fit(locator)
  if (overflows(f)) expect(f.title, `${what} is cut (${JSON.stringify(f)}), so its tooltip holds the whole text`).toBe(whole)
  return f
}

async function expectWhole(locator: Locator, what: string): Promise<void> {
  const f = await fit(locator)
  expect(overflows(f), `${what} has no hidden overflow: ${JSON.stringify(f)}`).toBe(false)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The page, typed for the reading below: the e2e typecheck has no DOM library. */
interface RowsPage {
  requestAnimationFrame(callback: (now: number) => void): number
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(id: number): void
  performance: { now(): number }
}
interface RowsElement {
  isConnected: boolean
  getBoundingClientRect(): Box
  querySelectorAll(selector: string): ArrayLike<RowsElement>
}

/**
 * The Ticket Node's box and its rows' boxes, all read in one animation frame, once they have
 * stayed the same for two frames in a row. One reading, not one per element: ELK's answer can move
 * the Node between two separate reads, and a row read after the move then lies outside the Node
 * read before it (worfy-week ticket 06).
 *
 * Fails, rather than returning zeros that would make every row check pass, when the Node's element
 * left the page (React replaced it during the wait) or has no box (hidden, or zero size). A timer
 * ends the wait even if animation frames stop coming, so a stalled page fails with a message
 * instead of hanging until the test timeout.
 */
async function ticketRows(ticket: Locator): Promise<{ card: Box; rows: Box[] }> {
  const read = await ticket.evaluate(
    (node, ms) =>
      new Promise<{ failure: string | null; card: Box; rows: Box[] }>((done) => {
        const page = globalThis as unknown as RowsPage
        const card = node as unknown as RowsElement
        const plain = (element: RowsElement): Box => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x, y, width, height }
        }
        const measure = () => ({ card: plain(card), rows: Array.from(card.querySelectorAll(':scope > :not(.react-flow__handle)'), plain) })
        let settled = false
        let safety = 0
        let frames = 0
        // Only the first outcome counts: the animation frame loop and the safety timer both end here.
        const finish = (failure: string | null, reading: { card: Box; rows: Box[] }): void => {
          if (settled) return
          settled = true
          page.clearTimeout(safety)
          done({ failure, ...reading })
        }
        const until = page.performance.now() + ms
        let last: string | null = null
        const tick = (now: number): void => {
          if (settled) return
          frames += 1
          const current = measure()
          if (!card.isConnected) return finish('the Ticket Node element left the page (React replaced it) while its rows were being read', current)
          const signature = JSON.stringify(current)
          if (signature === last) {
            if (current.card.width === 0 || current.card.height === 0) return finish('the Ticket Node has no box (hidden, or zero width or height)', current)
            return finish(null, current)
          }
          if (now > until) return finish(`the Ticket Node kept moving for ${ms} ms`, current)
          last = signature
          page.requestAnimationFrame(tick)
        }
        safety = page.setTimeout(
          () => finish(`no settled reading within ${ms + 1_000} ms: animation frames stopped after ${frames} frame(s)`, measure()),
          ms + 1_000,
        )
        page.requestAnimationFrame(tick)
      }),
    10_000,
  )
  if (read.failure !== null) throw new Error(`${read.failure}; last reading: ${JSON.stringify({ card: read.card, rows: read.rows })}`)
  return { card: read.card, rows: read.rows }
}

/** Every row of the Ticket Node ends inside it: nothing is cut by its bottom or right edge. */
async function expectRowsInside(ticket: Locator, what: string): Promise<void> {
  const { card, rows } = await ticketRows(ticket)
  for (const b of rows) {
    if (b.height === 0) continue
    expect(b.y + b.height, `${what}: a row ends inside the Ticket Node`).toBeLessThanOrEqual(card.y + card.height + 0.5)
    expect(b.x + b.width, `${what}: a row ends inside the Ticket Node`).toBeLessThanOrEqual(card.x + card.width + 0.5)
  }
}

const LONG_EPIC = 'a-very-long-epic-name-for-the-sidebar-2026-10-06'
const LONG_SPEC_TITLE = 'An Epic whose spec title is far longer than the frame header has room for, on purpose'
/** 120 characters: the ticket's fixture for a long Ticket title. */
const LONG_TICKET_TITLE = 'Withdraw-lot button for moderators, with a reason the seller sees and an audit record kept for the support team to check'

test('long names: the Ticket title, blocked reason and blockers line are whole on cards that do not overlap; frame title, done stack and the sidebar name whole or in a tooltip, in both themes', async () => {
  expect(LONG_TICKET_TITLE).toHaveLength(120)
  makeClaudeHome()
  makeProject((dir) => {
    const issues = join(dir, LONG_EPIC, 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(dir, LONG_EPIC, 'spec.md'), `# ${LONG_SPEC_TITLE}\n`)
    for (let num = 1; num <= 33; num += 1) writeFileSync(join(issues, `${String(num).padStart(2, '0')}-done-${num}.md`), ticketText(num, 'done', '—'))
    const done = Array.from({ length: 33 }, (_, i) => String(i + 1).padStart(2, '0')).join(', ')
    writeFileSync(join(issues, '40-long.md'), ticketText(40, 'open', '—').replace('# 40 — Ticket 40', `# 40 — ${LONG_TICKET_TITLE}`))
    writeFileSync(join(issues, '41-blocked.md'), ticketText(41, blockedWith('waits for the owner to answer which payment provider the platform uses in production'), '—'))
    writeFileSync(join(issues, '42-many.md'), ticketText(42, 'open', done))
  })
  const launched = await launch()
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${LONG_EPIC}"]`)
    await expect(frame).toBeVisible()
    const long = ticketNode(window, 40)
    await expect(long).toBeVisible()

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })

      // Nothing on a card is cut (worfy-canvas ticket 18): the whole title, reason and blockers
      // line, each on as many lines as it takes, inside a card as tall as its content.
      const title = long.locator('.w-ticket__title')
      await expect(title).toHaveText(LONG_TICKET_TITLE)
      await expectWhole(title, 'the Ticket title')
      for (const num of [40, 41, 42]) {
        await expectRowsInside(ticketNode(window, num), `Ticket ${num}`)
        expect(await ticketCardCuts(ticketNode(window, num)), `nothing is cut on Ticket ${num}`).toEqual([])
      }
      const reason = ticketNode(window, 41).locator('.w-ticket__reason')
      await expect(reason).toHaveText('waits for the owner to answer which payment provider the platform uses in production')
      await expectWhole(reason, 'the blocked reason')
      const blockers = ticketNode(window, 42).locator('.w-ticket__meta')
      await expect(blockers).toHaveText(`blocked by ${Array.from({ length: 33 }, (_, i) => String(i + 1).padStart(2, '0')).join(', ')} · done`)
      await expectWhole(blockers, 'the blockers line')
      // Taller cards push the next ones down: no two cards of the frame overlap, nor a card and the
      // done stack. All of them in one pass, once the layout has settled (helpers.ts).
      const cards = window.locator(`[data-testid="ticket-node"][data-epic="${LONG_EPIC}"]`)
      await expect(cards, 'the three open Tickets').toHaveCount(3)
      await expect(window.getByTestId('done-stack')).toHaveCount(1)
      const nums = await cards.evaluateAll((nodes) => nodes.map((node) => (node as unknown as { getAttribute(name: string): string | null }).getAttribute('data-ticket')))
      await expectSettledWithoutOverlaps(
        window,
        [
          { name: 'the done stack', selector: '[data-testid="done-stack"]' },
          ...nums.map((num) => ({ name: `Ticket ${num}`, selector: `[data-testid="ticket-node"][data-epic="${LONG_EPIC}"][data-ticket="${num}"]` })),
        ],
        'cards that overlap',
      )

      // The frame title: the Epic's whole name, the spec title whole or in the tooltip.
      const heading = frame.locator('.w-epic__title')
      await expectWholeOrTitled(heading, `${LONG_EPIC} — ${LONG_SPEC_TITLE}`, 'the frame title')
      const titleSelector = `[data-testid="epic-frame"][data-epic="${LONG_EPIC}"] .w-epic__title`
      const { heading: headingBox, name: nameBox } = await settledBoxes(window, { heading: titleSelector, name: `${titleSelector} .w-mono` }, 'the boxes of the frame title and the Epic name')
      expect(nameBox.x + nameBox.width, 'the Epic name ends inside the frame title').toBeLessThanOrEqual(headingBox.x + headingBox.width + 0.5)
      expect(nameBox.y + nameBox.height, 'the Epic name is on the first line').toBeLessThanOrEqual(headingBox.y + headingBox.height + 0.5)

      // The done stack: its count and label whole, the list whole or in the tooltip.
      const stack = window.getByTestId('done-stack')
      await expectWhole(stack.locator('.w-epic__stack-title'), 'the done stack label')
      await expect(stack.locator('.w-epic__stack-title')).toHaveText('33 done')
      const { stack: stackBox, list: listBox } = await settledBoxes(
        window,
        { stack: '[data-testid="done-stack"]', list: '[data-testid="done-stack"] .w-epic__stack-list' },
        'the boxes of the done stack and its list',
      )
      expect(listBox.y + listBox.height, 'the done list ends inside the stack').toBeLessThanOrEqual(stackBox.y + stackBox.height + 0.5)
      await expectWholeOrTitled(
        stack.locator('.w-epic__stack-list'),
        Array.from({ length: 33 }, (_, i) => String(i + 1).padStart(2, '0')).join(' '),
        'the done list',
      )

      // The sidebar shows the Epic's whole name.
      const row = window.locator(`[data-testid="sidebar-epic"][data-epic="${LONG_EPIC}"]`)
      await expect(row).toContainText(LONG_EPIC)
      await expectWhole(row.locator(':scope > .w-mono').first(), 'the Epic name in the sidebar')
      await expectWhole(row, 'the sidebar row')

      await window.screenshot({ path: test.info().outputPath(`long-names-${scheme}.png`) })
    }
  } finally {
    await launched.close()
  }
})

// Checked by hand at --force-device-scale-factor 1, 1.25, 1.5 and 2 (worfy-windows 94).
test('the bordered state chip of an open Ticket has an explicit px line height that fits inside its border', async () => {
  // The open chip shows on a card only until the Pipeline snapshot puts the stepper in its place,
  // so the test does not wait for the app's own chip: it puts one with the same classes in the
  // card's top row and measures it there, under the card's own styles.
  // So it measures that inserted span, not the real StateChip (its svg icon is absent): enough, since the line height comes from the same classes under the same parent cascade.
  makeClaudeHome()
  makeProject((dir) => {
    const issues = join(dir, 'demo-epic', 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(dir, 'demo-epic', 'spec.md'), '# Demo\n')
    writeFileSync(join(issues, '01-open.md'), ticketText(1, 'open', '—'))
  })
  const launched = await launch()
  try {
    const card = ticketNode(launched.window, 1)
    await expect(card).toBeVisible()
    const chip = await card.evaluate((node) => {
      // The e2e typecheck has no DOM library: the few page types used here.
      type Element = { className: string; textContent: string | null; clientHeight: number; scrollHeight: number; getBoundingClientRect(): { height: number }; appendChild(child: Element): void; remove(): void }
      type Style = { lineHeight: string; borderTopWidth: string; borderBottomWidth: string; fontFamily: string }
      const page = globalThis as unknown as { document: { createElement(tag: string): Element }; getComputedStyle(element: Element): Style }
      const row = (node as unknown as { querySelector(selector: string): Element | null }).querySelector('.w-ticket__top')
      if (row === null) throw new Error('the card has no top row')
      const probe = page.document.createElement('span')
      probe.className = 'w-chip w-chip--open'
      probe.textContent = 'open'
      row.appendChild(probe)
      const style = page.getComputedStyle(probe)
      const inner = probe.getBoundingClientRect().height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      const read = { lineHeight: style.lineHeight, inner, scrollHeight: probe.scrollHeight, clientHeight: probe.clientHeight, font: style.fontFamily }
      probe.remove()
      return read
    })
    // An explicit length: `normal` takes the height of whatever font the system falls back to.
    expect(chip.lineHeight, `the chip's line height (${JSON.stringify(chip)})`).toMatch(/^\d+(\.\d+)?px$/)
    // Its line fits the box inside the border, measured as laid out and not rounded to whole pixels.
    expect(parseFloat(chip.lineHeight), `the chip's line inside its border (${JSON.stringify(chip)})`).toBeLessThanOrEqual(chip.inner + 0.05)
    expect(chip.scrollHeight, `the chip's content inside its box (${JSON.stringify(chip)})`).toBeLessThanOrEqual(chip.clientHeight)
  } finally {
    await launched.close()
  }
})

// ── an Auction-sized Project ────────────────────────────────────────────────

/** 42 Epics, 682 Tickets, the biggest Epic 97 Tickets; returns the epic-status answer. */
function generateAuction(dir: string): { json: string; biggest: string } {
  const sizes = [97, ...Array.from({ length: 41 }, (_, i) => 14 + (i < 11 ? 1 : 0))]
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(682)
  return generateEpics(dir, sizes)
}

/** One Epic per entry of `sizes`, with that many Tickets, the first Epic the biggest; returns the epic-status answer. */
function generateEpics(dir: string, sizes: readonly number[]): { json: string; biggest: string } {
  const states = ['done', 'open', 'open', 'work', 'done', 'open', 'blocked'] as const
  const answer = { ref: 'main', epics: [] as unknown[], tickets: [] as unknown[] }
  sizes.forEach((size, e) => {
    const epic = `epic-${String(e + 1).padStart(2, '0')}`
    const issues = join(dir, epic, 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(dir, epic, 'spec.md'), `# ${epic}: generated Epic\n`)
    answer.epics.push({ epic, hasSpec: true, hasMap: false })
    for (let num = 1; num <= size; num += 1) {
      // A wide tree: each Ticket is blocked by the one at half its number.
      const blockers = num > 1 ? [Math.floor(num / 2)] : []
      const state = states[num % states.length]!
      const statusRaw = state === 'work' ? 'claimed 2026-10-05T09:41Z' : state === 'blocked' ? 'blocked 2026-10-05T09:41Z' : state
      const blockedReason = state === 'blocked' ? 'waiting for review' : null
      const blockedRaw = blockers.length ? blockers.map((b) => String(b).padStart(2, '0')).join(', ') : '—'
      const slug = `generated-${num}`
      const text = [`# ${String(num).padStart(2, '0')} — Generated ticket ${num}`, '', `Status: ${statusRaw}`, ...(blockedReason ? [`Blocked reason: ${blockedReason}`] : []), `Blocked by: ${blockedRaw}`, '', '## Где в коде', '', `- \`src/${epic}/m${num}.ts\``, ''].join('\n')
      writeFileSync(join(issues, `${String(num).padStart(2, '0')}-${slug}.md`), text)
      answer.tickets.push({ epic, num, slug, title: `Generated ticket ${num}`, statusRaw, state, blockedReason, blockedRaw, blockedNums: blockers, blockedParsed: true })
    }
  })
  return { json: JSON.stringify(answer), biggest: 'epic-01' }
}

/** The page's DOM for the hover clock, typed for this file. */
interface PageClock {
  document: {
    body: object
    querySelector(selector: string): object | null
    addEventListener(type: string, listener: (event: { target: { closest?(selector: string): object | null } | null }) => void, capture: boolean): void
  }
  MutationObserver: new (callback: () => void) => { observe(target: object, options: object): void; disconnect(): void }
  performance: { now(): number }
  requestAnimationFrame(callback: () => void): number
  hoverAt?: number
  litAt?: number
}

/**
 * Hovers a Ticket of `epic` on screen that a drawn "Blocked by" Edge ends at, and returns the
 * milliseconds from the pointer's arrival on its Node to the frame that shows a lit Edge, both
 * taken inside the page.
 */
async function hoverUntilLit(window: Page, epic: string, pane: { x: number; y: number; width: number; height: number }): Promise<number> {
  const targets = await window
    .locator(`[data-testid^="rf__edge-blocks:${epic}/"]:has(path.react-flow__edge-path)`)
    .evaluateAll((edges) => edges.map((edge) => Number(/->(\d+)$/.exec(edge.getAttribute('data-testid') ?? '')?.[1])))
  let num: number | undefined
  for (const candidate of targets) {
    const found = await window.locator(`[data-testid="ticket-node"][data-epic="${epic}"][data-ticket="${candidate}"]`).boundingBox()
    if (found && found.x > pane.x && found.y > pane.y && found.x + found.width < pane.x + pane.width && found.y + found.height < pane.y + pane.height) {
      num = candidate
      break
    }
  }
  if (num === undefined) throw new Error(`no Ticket of ${epic} with a drawn Edge is on screen`)
  expect(await window.locator('path.react-flow__edge-path[data-focus="lit"]').count()).toBe(0)
  await window.evaluate((nodeId) => {
    const page = globalThis as unknown as PageClock
    page.hoverAt = undefined
    page.litAt = undefined
    page.document.addEventListener(
      'pointerover',
      (event) => {
        if (page.hoverAt === undefined && event.target?.closest?.(`.react-flow__node[data-id="${nodeId}"]`)) page.hoverAt = page.performance.now()
      },
      true,
    )
    const observer = new page.MutationObserver(() => {
      if (page.hoverAt === undefined || page.document.querySelector('path.react-flow__edge-path[data-focus="lit"]') === null) return
      observer.disconnect()
      page.requestAnimationFrame(() => {
        page.litAt = page.performance.now()
      })
    })
    observer.observe(page.document.body, { subtree: true, childList: true, attributes: true })
  }, `ticket:${epic}/${num}`)
  await window.locator(`[data-testid="ticket-node"][data-epic="${epic}"][data-ticket="${num}"]`).hover()
  await expect.poll(() => window.evaluate(() => (globalThis as unknown as PageClock).litAt !== undefined)).toBe(true)
  return window.evaluate(() => {
    const page = globalThis as unknown as PageClock
    return Math.round((page.litAt! - page.hoverAt!) * 10) / 10
  })
}

/**
 * Waits for the frame of `epic` and its first Ticket, then returns the milliseconds from the start
 * of the window's page load to the next frame: the renderer answers right away. Timed from the start
 * of the page load (performance.now() in the renderer), not from Date.now() after launchApp:
 * launchApp returns only once the window is shown, and a clock started then would leave out the
 * load up to the first paint. Before launchApp waited for `show`, the time from firstWindow was
 * 36–110 ms shorter than this one; this one is the stricter of the two.
 */
async function interactiveAfter(window: Page, epic: string): Promise<number> {
  await expect(window.locator(`[data-testid="epic-frame"][data-epic="${epic}"]`)).toBeVisible({ timeout: 20_000 })
  await expect(window.locator(`[data-testid="ticket-node"][data-epic="${epic}"]`).first()).toBeVisible({ timeout: 20_000 })
  return window.evaluate(
    () => new Promise<number>((done) => (globalThis as unknown as PageGlobals).requestAnimationFrame(() => done(Math.round((globalThis as unknown as PageGlobals).performance.now())))),
  )
}

/** One-Ticket starts behind the reference on GitHub Actions: a single start on the runner varied from 909 to 1274 ms. */
const REFERENCE_STARTS = 3

test('an Auction-sized Project is interactive within 3 s and pans and zooms smoothly over its biggest Epic', async () => {
  const answer = join(scratch, 'epic-status.json')
  makeClaudeHome(answer)
  // On GitHub Actions the budget is measured against the same start of a one-Ticket Project on the
  // runner (test/e2e/start-budget.ts); everywhere else it is 3 s and needs no reference.
  const starts: number[] = []
  if (measuresReference(process.env)) {
    let small: { json: string; biggest: string } | undefined
    makeProject((dir) => {
      small = generateEpics(dir, [1])
    })
    writeFileSync(answer, small!.json)
    for (let n = 0; n < REFERENCE_STARTS; n += 1) {
      const reference = await launch()
      try {
        starts.push(await interactiveAfter(reference.window, small!.biggest))
      } finally {
        await reference.close()
      }
    }
    // The Auction-sized Project in a Project folder and app data of its own.
    await removeDir(join(scratch, 'demo'))
    dataDir = join(scratch, 'data-auction')
    mkdirSync(dataDir)
  }
  const referenceMs = starts.length > 0 ? [...starts].sort((a, b) => a - b)[Math.floor(starts.length / 2)]! : 0

  let generated: { json: string; biggest: string } | undefined
  makeProject((dir) => {
    generated = generateAuction(dir)
  })
  writeFileSync(answer, generated!.json)
  const enforce = process.env.WORFY_PERF === '1'

  const launched = await launch()
  try {
    const { window } = launched
    const interactiveMs = await interactiveAfter(window, generated!.biggest)

    // Center on the biggest Epic through the sidebar, then pan and zoom for 5 s while counting frames.
    await window.locator(`[data-testid="sidebar-epic"][data-epic="${generated!.biggest}"]`).click()
    // The 250 ms centering is over before the frames are counted.
    await canvasReady({ window })
    const pane = await box(window.locator('.react-flow'))
    await window.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
    await window.evaluate(() => {
      const { requestAnimationFrame, performance } = globalThis as unknown as PageGlobals
      const w = globalThis as unknown as { __frames: number[]; __stop: boolean }
      w.__frames = []
      w.__stop = false
      let last = performance.now()
      const tick = (now: number) => {
        w.__frames.push(now - last)
        last = now
        if (!w.__stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const until = Date.now() + 5_000
    let step = 0
    while (Date.now() < until) {
      if (step % 40 < 20) await window.mouse.wheel(step % 80 < 40 ? 24 : -24, step % 80 < 40 ? 16 : -16)
      else {
        await window.keyboard.down('ControlOrMeta')
        await window.mouse.wheel(0, step % 80 < 60 ? 12 : -12)
        await window.keyboard.up('ControlOrMeta')
      }
      step += 1
    }
    const frames = await window.evaluate(() => {
      const w = globalThis as unknown as { __frames: number[]; __stop: boolean }
      w.__stop = true
      return w.__frames.slice(1)
    })
    const sorted = [...frames].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity
    const fps = Math.round((1000 / median) * 10) / 10
    const longest = Math.round(Math.max(...frames))
    const ticketsDrawn = await window.getByTestId('ticket-node').count()

    // Hovering a Ticket of the biggest frame lights its chain (worfy-week ticket 05): the time from
    // the pointer's arrival to the frame that shows it is printed, and checked with WORFY_PERF=1.
    await window.locator(`[data-testid="sidebar-epic"][data-epic="${generated!.biggest}"]`).click()
    await canvasReady({ window })
    await parkPointer(window)
    const hoverMs = await hoverUntilLit(window, generated!.biggest, pane)
    console.log(`auction-size: hover on a Ticket of ${generated!.biggest} to its lit chain ${hoverMs} ms`)
    test.info().annotations.push({ type: 'perf', description: `hoverToLit=${hoverMs}ms` })
    if (enforce) expect(hoverMs).toBeLessThanOrEqual(100)

    const budget = startBudget(referenceMs, process.env)
    const reference = starts.length > 0 ? `a one-Ticket Project ${starts.join(', ')} ms, median ${referenceMs} ms` : 'no one-Ticket reference off GitHub Actions'
    console.log(
      `auction-size: interactive ${interactiveMs} ms after the window's page started loading (${reference}; budget ${budget} ms); ` +
        `pan/zoom 5 s: ${frames.length} frames, median ${fps} fps, longest frame ${longest} ms; ${ticketsDrawn} Ticket Nodes in the DOM`,
    )
    test.info().annotations.push({ type: 'perf', description: `interactive=${interactiveMs}ms reference=${referenceMs}ms medianFps=${fps} longestFrame=${longest}ms frames=${frames.length}` })
    expect(interactiveMs, `interactive within ${budget} ms: 3 s, or on GitHub Actions ${START_RATIO} × the ${referenceMs} ms of a one-Ticket Project, at most ${RUNNER_START_CAP_MS} ms`).toBeLessThanOrEqual(budget)
    // Frame rates depend on the machine: CI only prints them, WORFY_PERF=1 on the developer's Mac checks them.
    if (enforce) {
      expect(fps).toBeGreaterThanOrEqual(55)
      expect(longest).toBeLessThanOrEqual(100)
    }
  } finally {
    await launched.close()
  }
})
