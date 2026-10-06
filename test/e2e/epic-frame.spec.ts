import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { codeSection } from '../../src/main/workflow/reader'
import { layoutEpic, stackFrames } from '../../src/renderer/canvas/epic-layout'
import { epicStatusSchema, type Ticket } from '../../src/shared/workflow/types'
import { readyWave, ticketLevels } from '../../src/shared/workflow/waves'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'

// Epic frames on the Canvas of the built app, over Projects in temporary git repositories and a
// stub `bin/epic-status` in a temporary WORFY_CLAUDE_HOME that reads the Ticket files the way the
// real script does. Projects are written into projects.json up front.

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
  const parts = path.split('/')
  const epic = parts[1]
  if (!epics.has(epic)) epics.set(epic, { epic, hasSpec: false, hasMap: false })
  if (parts.length === 3 && parts[2] === 'spec.md') epics.get(epic).hasSpec = true
  if (parts.length !== 4 || parts[2] !== 'issues' || !parts[3].endsWith('.md')) continue
  const m = /^(\d+)-(.*)\.md$/.exec(parts[3])
  if (!m) continue
  const text = read()
  const last = (name) => { let v = null; for (const l of text.split('\n')) { const x = new RegExp('^' + name + ':\\s*(.*)$', 'i').exec(l); if (x) v = x[1] } return v }
  const status = last('Status')
  const blocked = last('Blocked by')
  const word = (status ?? '').split(/\s/)[0]
  const state = status === null ? 'none' : /^done$/i.test(word) ? 'done' : /^claimed$/i.test(word) ? 'work' : /^blocked$/i.test(word) ? 'blocked' : 'open'
  const nums = blocked && !/^[—-]$/.test(blocked.trim()) ? blocked.split(',').map((s) => Number(s.trim())) : []
  tickets.push({ epic, num: Number(m[1]), slug: m[2], title: (text.split('\n')[0] || '').replace(/^#\s*/, ''), statusRaw: status, state,
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

/** A Claude home whose bin/epic-status is the stub above, or `cat` of a ready answer. */
function makeClaudeHome(answer?: string): void {
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const js = join(claudeHome, 'stub.cjs')
  writeFileSync(js, STUB_JS)
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, answer === undefined ? `#!/bin/sh\nexec '${process.execPath}' '${js}' "$@"\n` : `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(script, 0o755)
}

const PROJECT_ID = 'demo-0000000d'

/** A git repository with a `.scratch`, listed as the only and active Project; the Canvas starts at `viewport`. */
function makeProject(fill: (scratchDir: string) => void, viewport = { x: 40, y: 40, zoom: 1 }): string {
  const repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch'), { recursive: true })
  fill(join(repo, '.scratch'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes: [], viewport }))
  return repo
}

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

function ticketText(num: number, status: string, blocked: string): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Что делаем', '', 'text', ''].join('\n')
}

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

/** A Ticket's place relative to its frame. */
async function inFrame(window: Page, epic: string, num: number): Promise<{ x: number; y: number }> {
  const frame = await flowPosition(window, `epic:${epic}`)
  const ticket = await flowPosition(window, `ticket:${epic}/${num}`)
  return { x: Math.round(ticket.x - frame.x), y: Math.round(ticket.y - frame.y) }
}

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
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

test('the worfy-mvp Epic: columns by level, the ready Wave framed, blocking arrows as "Blocked by" says, a status change shown within a second', async () => {
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
  try {
    const { window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="worfy-mvp"]')
    await expect(frame).toBeVisible()
    await expect(window.getByTestId('epic-progress')).toHaveText(`0/${tickets.length}`)
    await expect(window.getByTestId('ticket-node')).toHaveCount(tickets.length)

    // Columns: one x per dependency level, left to right in level order.
    const levels = ticketLevels(tickets, 'worfy-mvp')
    const xByLevel = new Map<number, number>()
    for (const ticket of tickets) {
      const level = levels.get(ticket.num)
      if (level?.kind !== 'level') throw new Error(`ticket ${ticket.num} has no level`)
      const { x } = await inFrame(window, 'worfy-mvp', ticket.num)
      const known = xByLevel.get(level.level)
      if (known === undefined) xByLevel.set(level.level, x)
      else expect(x, `ticket ${ticket.num}`).toBe(known)
    }
    const ordered = [...xByLevel].sort(([a], [b]) => a - b).map(([, x]) => x)
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b))
    expect(new Set(ordered).size).toBe(ordered.length)

    // The ready Wave: exactly the Tickets of Wave 1, inside the dashed box.
    const ready = readyWave(tickets, 'worfy-mvp').ready.map((entry) => entry.num)
    expect(ready.length).toBeGreaterThan(0)
    const marked = await window.locator('[data-testid="ticket-node"][data-ready="true"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-ticket'))))
    expect(marked.sort((a, b) => a - b)).toEqual(ready)
    await expect(frame.getByText(`Ready wave · ${ready.length}`)).toBeVisible()
    const wave = await box(window.getByTestId('ready-wave'))
    for (const num of ready) {
      const ticket = await box(ticketNode(window, num))
      expect(ticket.x).toBeGreaterThanOrEqual(wave.x)
      expect(ticket.y).toBeGreaterThanOrEqual(wave.y)
      expect(ticket.x + ticket.width).toBeLessThanOrEqual(wave.x + wave.width)
      expect(ticket.y + ticket.height).toBeLessThanOrEqual(wave.y + wave.height)
    }

    // One arrow per "Blocked by" entry, from the blocker to the blocked Ticket.
    const expected = tickets.flatMap((t) => t.blockedNums.map((b) => `rf__edge-blocks:worfy-mvp/${b}->${t.num}`)).sort()
    expect(expected.length).toBeGreaterThan(20)
    await expect
      .poll(async () => (await window.locator('[data-testid^="rf__edge-blocks:"]').evaluateAll((edges) => edges.map((e) => e.getAttribute('data-testid')))).sort())
      .toEqual(expected)

    // `ticket claim` rewrites the Status line; the chip follows without a restart.
    const first = join(repo, '.scratch', 'worfy-mvp', 'issues', readdirSync(join(repo, '.scratch', 'worfy-mvp', 'issues')).find((f) => f.startsWith('01-'))!)
    // The moment the chip changes is taken inside the page by a MutationObserver, so the polling
    // interval of Playwright's assertions is not counted. Both clocks are this machine's.
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
    setStatus(first, 'claimed — 2026-10-05')
    await expect(ticketNode(window, 1)).toHaveAttribute('data-state', 'work', { timeout: 5_000 })
    const shownAt = await window.evaluate(() => (globalThis as unknown as { claimedAt?: number }).claimedAt)
    expect(shownAt).toBeDefined()
    const elapsed = shownAt! - started
    console.log(`status change shown after ${elapsed} ms`)
    expect(elapsed).toBeLessThanOrEqual(1_000)
    await expect(ticketNode(window, 1).getByText('claimed')).toBeVisible()
    // Wave 1 is taken: nothing is ready now.
    await expect(window.getByTestId('ready-wave')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

// ── manual offsets ──────────────────────────────────────────────────────────

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

test('a Ticket and a frame moved by hand keep their offsets after a restart and after a neighbour changes', async () => {
  makeClaudeHome()
  const repo = makeProject((dir) => {
    writeDemo(dir)
    writeZeta(dir)
  })
  const issues = join(repo, '.scratch', 'demo', 'issues')

  const autoOf = (states: Record<number, Ticket['state']>, num: number) => {
    const placed = layoutEpic({ tickets: demoTickets(states), collapsed: false, doneExpanded: false }).tickets.find((t) => t.num === num)!
    return placed.auto
  }
  /** The automatic place of zeta's frame: under demo's frame. */
  const zetaAuto = (states: Record<number, Ticket['state']>, demoCollapsed = false) => {
    const demoHeight = layoutEpic({ tickets: demoTickets(states), collapsed: demoCollapsed, doneExpanded: false }).height
    return stackFrames([
      { epic: 'demo', height: demoHeight },
      { epic: 'zeta', height: 0 },
    ]).get('zeta')!.auto
  }
  let frameOffset: { dx: number; dy: number }

  let offset: { dx: number; dy: number }
  const first = await launch()
  try {
    const { window } = first
    const three = ticketNode(window, 3)
    await expect(three).toBeVisible()
    expect(await inFrame(window, 'demo', 3)).toEqual(autoOf({}, 3))

    // Dragged at zoom 1: screen pixels are canvas units.
    const start = await box(three.locator('.w-ticket__title'))
    await window.mouse.move(start.x + 20, start.y + 5)
    await window.mouse.down()
    await window.mouse.move(start.x + 20 + 90, start.y + 5 + 140, { steps: 12 })
    await window.mouse.up()

    await expect.poll(async () => (await layoutNodes(window)).find((node) => node.id === 'epic:demo')?.data['offset:3']).toBeTruthy()
    const saved = (await layoutNodes(window)).find((node) => node.id === 'epic:demo')!
    expect(saved).toMatchObject({ kind: 'epic-frame', x: 0, y: 0 })
    offset = saved.data['offset:3'] as { dx: number; dy: number }
    expect(offset.dx).toBeGreaterThan(60)
    expect(offset.dy).toBeGreaterThan(100)
    const auto = autoOf({}, 3)
    await expect.poll(() => inFrame(window, 'demo', 3)).toEqual({ x: auto.x + offset.dx, y: auto.y + offset.dy })

    // The second frame, dragged by its header: the Layout keeps the shift from its automatic
    // place (below demo), not the place itself.
    expect(await flowPosition(window, 'epic:zeta')).toEqual(zetaAuto({}))
    const handle = await box(window.locator('[data-testid="epic-frame"][data-epic="zeta"] .w-epic__drag .w-epic__tag'))
    await window.mouse.move(handle.x + 5, handle.y + 5)
    await window.mouse.down()
    await window.mouse.move(handle.x + 5 + 120, handle.y + 5 + 80, { steps: 12 })
    await window.mouse.up()
    await expect.poll(async () => (await layoutNodes(window)).find((node) => node.id === 'epic:zeta')).toBeTruthy()
    const zeta = (await layoutNodes(window)).find((node) => node.id === 'epic:zeta')!
    expect(zeta.kind).toBe('epic-frame')
    frameOffset = { dx: zeta.x, dy: zeta.y }
    // React Flow starts the drag on the first mouse step, so the frame travels a bit less than
    // the mouse; what matters is that the saved offset is where the frame was dropped.
    expect(frameOffset.dx).toBeGreaterThan(60)
    expect(frameOffset.dy).toBeGreaterThan(40)
    const zetaPlace = zetaAuto({})
    const dropped = await flowPosition(window, 'epic:zeta')
    expect({ dx: Math.round(dropped.x - zetaPlace.x), dy: Math.round(dropped.y - zetaPlace.y) }).toEqual(frameOffset)
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const { window } = second
    await expect(ticketNode(window, 3)).toBeVisible()
    const before = autoOf({}, 3)
    expect(await inFrame(window, 'demo', 3)).toEqual({ x: before.x + offset.dx, y: before.y + offset.dy })
    const zetaBefore = zetaAuto({})
    expect(await flowPosition(window, 'epic:zeta')).toEqual({ x: zetaBefore.x + frameOffset.dx, y: zetaBefore.y + frameOffset.dy })

    // Ticket 02 is done: it folds into a Done column, 04 loses its blocker and the levels move;
    // 03 keeps its shift from its new automatic place.
    setStatus(join(issues, '02-t2.md'), 'done')
    const after = autoOf({ 2: 'done' }, 3)
    expect(after).not.toEqual(before)
    await expect.poll(() => inFrame(window, 'demo', 3), { timeout: 5_000 }).toEqual({ x: after.x + offset.dx, y: after.y + offset.dy })
    await expect(ticketNode(window, 2)).toHaveCount(0)
    // A Ticket nobody moved sits at its automatic place.
    expect(await inFrame(window, 'demo', 4)).toEqual(autoOf({ 2: 'done' }, 4))
    await expect.poll(() => flowPosition(window, 'epic:zeta')).toEqual({ x: zetaBefore.x + frameOffset.dx, y: zetaBefore.y + frameOffset.dy })
    // demo's frame is collapsed to its header, so zeta's automatic place moves up; zeta keeps its
    // shift from it.
    await window.getByRole('button', { name: 'Collapse epic demo' }).click()
    const zetaAfter = zetaAuto({ 2: 'done' }, true)
    expect(zetaAfter.y).toBeLessThan(zetaBefore.y)
    await expect.poll(() => flowPosition(window, 'epic:zeta')).toEqual({ x: zetaAfter.x + frameOffset.dx, y: zetaAfter.y + frameOffset.dy })
  } finally {
    await second.close()
  }
  // Moving a Ticket and a frame is saved in worfy's own data, never in the repository (ADR-0005);
  // the status edit above is the test's own change to a tracked file.
  expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('M .scratch/demo/issues/02-t2.md')
})

// ── states, themes, sidebar ─────────────────────────────────────────────────

const hexToRgb = (hex: string): string => {
  const value = hex.trim().replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

test('state chips use the F tokens in both themes and always carry a label; the done stack, collapsing and the sidebar work', async () => {
  makeClaudeHome()
  const repo = makeProject((dir) => {
    const issues = join(dir, 'demo', 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(dir, 'demo', 'spec.md'), '# demo: a small Epic\n')
    writeFileSync(join(issues, '01-t1.md'), ticketText(1, 'done', '—'))
    writeFileSync(join(issues, '02-t2.md'), ticketText(2, 'claimed — 2026-10-05', '01'))
    writeFileSync(join(issues, '03-t3.md'), ticketText(3, 'blocked — needs Stripe test keys', '01'))
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

    const chips = [
      { num: 1, status: 'done', label: 'done', bg: '--done-bg', fg: '--done-text' },
      { num: 2, status: 'working', label: 'claimed', bg: '--working-bg', fg: '--working-text' },
      { num: 3, status: 'blocked', label: 'blocked', bg: '--blocked-bg', fg: '--blocked-text' },
      { num: 4, status: 'open', label: 'open', bg: '--surface-raised', fg: '--text-secondary' },
    ]
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      for (const chip of chips) {
        const element = ticketNode(window, chip.num).locator(`.w-chip[data-status="${chip.status}"]`)
        await expect(element).toHaveText(chip.label)
        // Every state chip has an icon next to its label.
        await expect(element.locator('svg')).toHaveCount(1)
        const colors = await element.evaluate(
          (node, names) => {
            const { document, getComputedStyle } = globalThis as unknown as PageGlobals
            const root = getComputedStyle(document.documentElement)
            const style = getComputedStyle(node)
            return { bg: style.backgroundColor, fg: style.color, tokenBg: root.getPropertyValue(names.bg), tokenFg: root.getPropertyValue(names.fg) }
          },
          { bg: chip.bg, fg: chip.fg },
        )
        expect(colors.bg, `${scheme} ${chip.status} background`).toBe(hexToRgb(colors.tokenBg))
        expect(colors.fg, `${scheme} ${chip.status} text`).toBe(hexToRgb(colors.tokenFg))
      }
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
    await expect.poll(async () => (await box(frame)).x).toBeLessThan(pane.x)
    // The pan has ended (React Flow ends a wheel pan after a pause) before the centering starts.
    await canvasReady({ window })
    await row.click()
    await expect
      .poll(async () => {
        const b = await box(frame)
        return Math.abs(b.x + b.width / 2 - (pane.x + pane.width / 2)) < 4 && Math.abs(b.y + b.height / 2 - (pane.y + pane.height / 2)) < 4
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

// ── an Auction-sized Project ────────────────────────────────────────────────

/** 42 Epics, 682 Tickets, the biggest Epic 97 Tickets; returns the epic-status answer. */
function generateAuction(dir: string): { json: string; biggest: string } {
  const sizes = [97, ...Array.from({ length: 41 }, (_, i) => 14 + (i < 11 ? 1 : 0))]
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(682)
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
      const statusRaw = state === 'work' ? 'claimed — 2026-10-05' : state === 'blocked' ? 'blocked — waiting for review' : state
      const blockedRaw = blockers.length ? blockers.map((b) => String(b).padStart(2, '0')).join(', ') : '—'
      const slug = `generated-${num}`
      const text = [`# ${String(num).padStart(2, '0')} — Generated ticket ${num}`, '', `Status: ${statusRaw}`, `Blocked by: ${blockedRaw}`, '', '## Где в коде', '', `- \`src/${epic}/m${num}.ts\``, ''].join('\n')
      writeFileSync(join(issues, `${String(num).padStart(2, '0')}-${slug}.md`), text)
      answer.tickets.push({ epic, num, slug, title: `Generated ticket ${num}`, statusRaw, state, blockedRaw, blockedNums: blockers, blockedParsed: true })
    }
  })
  return { json: JSON.stringify(answer), biggest: 'epic-01' }
}

test('an Auction-sized Project is interactive within 3 s and pans and zooms smoothly over its biggest Epic', async () => {
  let generated: { json: string; biggest: string } | undefined
  makeProject((dir) => {
    generated = generateAuction(dir)
  })
  const answer = join(scratch, 'epic-status.json')
  writeFileSync(answer, generated!.json)
  makeClaudeHome(answer)
  const enforce = process.env.WORFY_PERF === '1'

  const launched = await launch()
  try {
    const { window } = launched
    const opened = Date.now()
    await expect(window.locator(`[data-testid="epic-frame"][data-epic="${generated!.biggest}"]`)).toBeVisible({ timeout: 20_000 })
    await expect(window.locator(`[data-testid="ticket-node"][data-epic="${generated!.biggest}"]`).first()).toBeVisible({ timeout: 20_000 })
    // Interactive: the renderer answers right away.
    await window.evaluate(() => new Promise((done) => (globalThis as unknown as PageGlobals).requestAnimationFrame(() => done(null))))
    const interactiveMs = Date.now() - opened
    const sinceNavigation = await window.evaluate(() => Math.round((globalThis as unknown as PageGlobals).performance.now()))

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
        await window.keyboard.down('Meta')
        await window.mouse.wheel(0, step % 80 < 60 ? 12 : -12)
        await window.keyboard.up('Meta')
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
    console.log(
      `auction-size: interactive ${interactiveMs} ms after the window opened (${sinceNavigation} ms since navigation); ` +
        `pan/zoom 5 s: ${frames.length} frames, median ${fps} fps, longest frame ${longest} ms; ${ticketsDrawn} Ticket Nodes in the DOM`,
    )
    test.info().annotations.push({ type: 'perf', description: `interactive=${interactiveMs}ms medianFps=${fps} longestFrame=${longest}ms frames=${frames.length}` })
    expect(interactiveMs).toBeLessThanOrEqual(3_000)
    // Frame rates depend on the machine: CI only prints them, WORFY_PERF=1 on the developer's Mac checks them.
    if (enforce) {
      expect(fps).toBeGreaterThanOrEqual(55)
      expect(longest).toBeLessThanOrEqual(100)
    }
  } finally {
    await launched.close()
  }
})
