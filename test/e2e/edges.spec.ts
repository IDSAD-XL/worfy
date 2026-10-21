import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { epicStatusSchema } from '../../src/shared/workflow/types'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// "Blocked by" Edges on the built app (worfy-week ticket 05), over the worfy-mvp Epic of the
// fixtures with Tickets 01 and 02 done: by default every Edge is thin and pale and the Edges from
// the done Tickets are not drawn; hovering a Ticket lights exactly the Edges of its chain (who
// blocks it, up to the end, and whom it blocks, down to the end), those from done Tickets
// included, within 100 ms; a selected Ticket keeps its chain lit. The Epic comes from a stub
// `bin/epic-status` in a temporary WORFY_CLAUDE_HOME that prints a ready answer.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'demo-0000000d'
const EPIC = 'worfy-mvp'
const FIXTURE = join(repoRoot, 'test', 'fixtures', 'worfy-mvp-epic')
const DONE = new Set([1, 2])

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
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

let scratch: string
let dataDir: string
let claudeHome: string

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** The fixture Epic with the DONE Tickets done; returns each Ticket's blockers. */
function makeProject(): Map<number, number[]> {
  const snapshot = epicStatusSchema.parse(JSON.parse(readFileSync(join(FIXTURE, 'epic-status.json'), 'utf8')))
  const tickets = snapshot.tickets.map((ticket) => (DONE.has(ticket.num) ? { ...ticket, state: 'done' as const, statusRaw: 'done — 2026-10-07' } : ticket))

  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(join(repo, '.scratch', EPIC), { recursive: true })
  cpSync(join(FIXTURE, 'spec.md'), join(repo, '.scratch', EPIC, 'spec.md'))
  cpSync(join(FIXTURE, 'issues'), issues, { recursive: true })
  for (const name of readdirSync(issues)) {
    if (DONE.has(Number(name.slice(0, 2)))) writeFileSync(join(issues, name), readFileSync(join(issues, name), 'utf8').replace(/^Status: .*$/m, 'Status: done — 2026-10-07'))
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(scratch, 'epic-status.json')
  writeFileSync(answer, JSON.stringify({ ...snapshot, tickets }))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  // Zoomed out so the whole frame is on screen: React Flow draws only visible Nodes.
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.3 } }))
  return new Map(tickets.map((ticket) => [ticket.num, ticket.blockedNums]))
}

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

const edgeId = (blocker: number, blocked: number): string => `blocks:${EPIC}/${blocker}->${blocked}`

/** The Edges on every path through `num`: up through its blockers, down through whom it blocks. */
function chain(blockers: ReadonlyMap<number, readonly number[]>, num: number): string[] {
  const edges = [...blockers].flatMap(([blocked, list]) => list.map((blocker) => ({ blocker, blocked })))
  const found = new Set<string>()
  const walk = (next: (at: number) => { edge: string; far: number }[]) => {
    const seen = new Set([num])
    const queue = [num]
    while (queue.length > 0) {
      for (const { edge, far } of next(queue.shift()!)) {
        found.add(edge)
        if (!seen.has(far)) {
          seen.add(far)
          queue.push(far)
        }
      }
    }
  }
  walk((at) => edges.filter((e) => e.blocked === at).map((e) => ({ edge: edgeId(e.blocker, e.blocked), far: e.blocker })))
  walk((at) => edges.filter((e) => e.blocker === at).map((e) => ({ edge: edgeId(e.blocker, e.blocked), far: e.blocked })))
  return [...found].sort()
}

const ticketNode = (window: Page, num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)

/** The ids of the Edges whose line is drawn, with the given look. */
const drawn = (window: Page, focus: 'lit' | 'pale'): Promise<string[]> =>
  window
    .locator(`[data-testid^="rf__edge-blocks:"] path.react-flow__edge-path[data-focus="${focus}"]`)
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('id') ?? '').sort())

/** The drawn line of an Edge. */
const edgePath = (window: Page, id: string): Locator => window.locator(`[data-testid="rf__edge-${id}"] path.react-flow__edge-path`)

/** The computed stroke colour of a line; empty while the path has no computed style yet. */
const stroke = (path: Locator): Promise<string> =>
  path.evaluate((element) => (globalThis as unknown as { getComputedStyle(e: object): { stroke: string } }).getComputedStyle(element).stroke)

/** The pale Edges' colour token, `#rrggbb`; read until the stylesheet has set it. */
async function paleToken(window: Page): Promise<string> {
  const read = (): Promise<string> =>
    window.evaluate(() => {
      const page = globalThis as unknown as { getComputedStyle(e: object): { getPropertyValue(name: string): string }; document: { documentElement: object } }
      return page.getComputedStyle(page.document.documentElement).getPropertyValue('--border-strong').trim()
    })
  let token = ''
  await expect.poll(async () => (token = await read()), { message: 'the --border-strong token is set' }).toMatch(/^#[0-9a-f]{6}$/i)
  return token
}

/** The pointer on the empty plane, at the Canvas's bottom-left corner, off every Node. */
async function awayFromNodes(window: Page): Promise<void> {
  const pane = await window.locator('.react-flow').boundingBox()
  if (!pane) throw new Error('the Canvas has no box')
  await mark(window, 'move away from the Nodes')
  await window.mouse.move(pane.x + 8, pane.y + pane.height - 8)
}

// Diagnostics for a flaky failure: in full e2e runs at 3 workers the chain of the hovered Ticket
// 04 went dark 10-30 ms after it lit (3 runs of 5, at the two checks right after the hover), while
// the test sent no input. The app's trace showed no change on the page then but the Edges: no
// Node moved, none was replaced, the selection and the done stack stayed as they were. The page
// therefore logs what it sees of the pointer, and a failure attaches the log with the window's
// state and the real cursor's place from main: a pointerout or pointerleave that the test did
// not cause names an input from outside the page; a darkening with no event names the app.

/** One line of the page's pointer log. */
interface PointerEntry {
  /** performance.now() of the page, ms. */
  t: number
  type: string
  x?: number
  y?: number
  /** The Node id under the event, else `canvas`, else the element's tag. */
  target?: string
  related?: string | null
  trusted?: boolean
  /** For `lit`: how many lit Edge lines the page has now. */
  lit?: number
  note?: string
}

/** The page's DOM for the pointer log, typed for this file. */
interface LogTarget {
  nodeName?: string
  closest?(selector: string): { getAttribute(name: string): string | null } | null
  classList?: { contains(name: string): boolean }
}
interface PointerPage {
  pointerLog?: PointerEntry[]
  performance: { now(): number }
  addEventListener(type: string, listener: (event: { target: LogTarget | null; relatedTarget?: LogTarget | null; clientX?: number; clientY?: number; isTrusted: boolean }) => void, capture: boolean): void
  document: {
    body: object
    documentElement: object
    visibilityState: string
    addEventListener(type: string, listener: () => void): void
    querySelectorAll(selector: string): { length: number }
  }
  MutationObserver: new (callback: () => void) => { observe(target: object, options: object): void }
}

const POINTER_LOG_LIMIT = 400

/** Starts the page's pointer log: pointer and focus events, and each change of the number of lit Edges. */
async function recordPointer(window: Page): Promise<void> {
  await window.evaluate((limit) => {
    const page = globalThis as unknown as PointerPage
    const log: PointerEntry[] = []
    page.pointerLog = log
    const push = (entry: Omit<PointerEntry, 't'>) => {
      if (log.length < limit) log.push({ t: Math.round(page.performance.now() * 10) / 10, ...entry })
    }
    const describe = (target: LogTarget | null | undefined): string => {
      if (!target) return 'none'
      const node = target.closest?.('.react-flow__node')?.getAttribute('data-id')
      if (node) return node
      if (target.classList?.contains('react-flow') === true) return 'canvas'
      return (target.nodeName ?? 'window').toLowerCase()
    }
    for (const type of ['pointerover', 'pointerout', 'pointermove', 'pointerleave']) {
      page.addEventListener(
        type,
        (event) => {
          // A leave goes to every element the pointer left; only the Canvas's and the page's own are kept.
          if (type === 'pointerleave' && event.target?.classList?.contains('react-flow') !== true && (event.target as object | null) !== page.document.documentElement) return
          push({ type, x: event.clientX, y: event.clientY, target: describe(event.target), related: event.relatedTarget === undefined ? undefined : describe(event.relatedTarget), trusted: event.isTrusted })
        },
        true,
      )
    }
    for (const type of ['blur', 'focus']) {
      page.addEventListener(
        type,
        (event) => {
          if ((event.target as object | null) === page) push({ type })
        },
        true,
      )
    }
    page.document.addEventListener('visibilitychange', () => push({ type: 'visibility', note: page.document.visibilityState }))
    let lit = -1
    new page.MutationObserver(() => {
      const now = page.document.querySelectorAll('path.react-flow__edge-path[data-focus="lit"]').length
      if (now === lit) return
      lit = now
      push({ type: 'lit', lit: now })
    }).observe(page.document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-focus'] })
  }, POINTER_LOG_LIMIT)
}

/** A line in the pointer log for an input the test is about to send. */
async function mark(window: Page, note: string): Promise<void> {
  await window.evaluate((text) => {
    const page = globalThis as unknown as PointerPage
    page.pointerLog?.push({ t: Math.round(page.performance.now() * 10) / 10, type: 'test', note: text })
  }, note)
}

/** How long the failure report waits for each answer from the app. */
const REPORT_ANSWER_MS = 2_000

/**
 * Attaches the pointer log, the windows' state and the real cursor's place on the screen to the
 * failed test, and prints the log from the test's last input on. Never throws: the test's own
 * failure is the one to report.
 */
async function reportPointer(launched: LaunchedApp): Promise<void> {
  // Bounded: a hung renderer or main would otherwise hold this until the test's own timeout, which
  // would then be reported instead of the failed check, and the app would not be closed.
  const bounded = <T>(work: Promise<T>): Promise<T> =>
    Promise.race([work, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`no answer within ${REPORT_ANSWER_MS} ms`)), REPORT_ANSWER_MS).unref())])
  try {
    const log = await bounded(launched.window.evaluate(() => (globalThis as unknown as PointerPage).pointerLog ?? []))
    const main = await bounded(
      launched.app.evaluate(({ BrowserWindow, screen }) => ({
        cursor: screen.getCursorScreenPoint(),
        windows: BrowserWindow.getAllWindows().map((each) => ({ bounds: each.getBounds(), focused: each.isFocused(), visible: each.isVisible() })),
      })),
    )
    // A file in the test's own folder, which a failed run keeps, rather than a body only the JSON report holds.
    const file = test.info().outputPath('pointer-log.json')
    writeFileSync(file, JSON.stringify({ main, log }, null, 2))
    await test.info().attach('pointer-log', { path: file, contentType: 'application/json' })
    let from = 0
    log.forEach((entry, at) => {
      if (entry.type === 'test') from = at
    })
    const line = (entry: PointerEntry): string =>
      [entry.t, entry.type, entry.note, entry.target, entry.related === undefined ? undefined : `from/to ${entry.related}`, entry.x === undefined ? undefined : `${entry.x},${entry.y}`, entry.lit, entry.trusted === false ? 'untrusted' : undefined]
        .filter((part) => part !== undefined)
        .join(' ')
    console.log(`edges pointer log (cursor ${JSON.stringify(main.cursor)}, windows ${JSON.stringify(main.windows)}):\n  ${log.slice(from).map(line).join('\n  ')}`)
  } catch (error) {
    console.log(`edges pointer log not read: ${String(error)}`)
  }
}

/**
 * Hovers a Ticket and returns the milliseconds from the pointer's arrival on its Node to the frame
 * that shows a lit Edge. Both moments are taken inside the page, so Playwright's polling interval
 * is not counted.
 */
async function hoverUntilLit(window: Page, num: number): Promise<number> {
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
  }, `ticket:${EPIC}/${num}`)
  await mark(window, `hover Ticket ${num}`)
  await ticketNode(window, num).hover()
  await expect.poll(() => window.evaluate(() => (globalThis as unknown as PageClock).litAt !== undefined)).toBe(true)
  return window.evaluate(() => {
    const page = globalThis as unknown as PageClock
    return Math.round((page.litAt! - page.hoverAt!) * 10) / 10
  })
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-edges-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Edges are thin and pale, those from done Tickets hidden; hovering a Ticket lights exactly its chain within 100 ms; a selected Ticket keeps it lit', async () => {
  const blockers = makeProject()
  const all = [...blockers].flatMap(([blocked, list]) => list.map((blocker) => edgeId(blocker, blocked))).sort()
  const fromDone = [...blockers].flatMap(([blocked, list]) => list.filter((blocker) => DONE.has(blocker)).map((blocker) => edgeId(blocker, blocked))).sort()
  const waiting = all.filter((id) => !fromDone.includes(id))
  expect(fromDone.length).toBeGreaterThan(3)

  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 } })
    await recordPointer(window)
    await expect(window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)).toBeVisible()
    // The done Tickets are folded into the stack until it is opened; then every Edge is in the DOM.
    await mark(window, 'click the done stack')
    await window.getByTestId('done-stack').click()
    await expect(ticketNode(window, 1)).toBeVisible()
    await expect
      .poll(async () => (await window.locator('[data-testid^="rf__edge-blocks:"]').evaluateAll((edges) => edges.map((e) => e.getAttribute('data-testid')))).sort())
      .toEqual(all.map((id) => `rf__edge-${id}`).sort())
    await awayFromNodes(window)

    // Default: the Edges from done Tickets are not drawn; the others are pale, 1 px, in the pale token.
    await expect.poll(() => drawn(window, 'pale')).toEqual(waiting)
    await expect.poll(() => drawn(window, 'lit')).toEqual([])
    // The style is read until it is there: a path React Flow has just replaced has no computed
    // style yet (an empty stroke width), and a single read caught that under load.
    const token = await paleToken(window)
    const paleStroke = hexToRgb(token)
    const palePath = edgePath(window, waiting[0]!)
    await expect(palePath).toHaveCSS('stroke-width', '1px')
    await expect(palePath).toHaveCSS('stroke', paleStroke)
    const quiet = await snapshotThemes(window, 'edges-default')
    console.log(`edges by default: ${quiet.light} ${quiet.dark}`)

    // Hover Ticket 04 (blocked by 02, done, and 03): exactly its chain is lit, the Edges from the
    // done Tickets on it included, within 100 ms.
    const chainOf4 = chain(blockers, 4)
    expect(chainOf4).toContain(edgeId(1, 3))
    expect(chainOf4).toContain(edgeId(2, 4))
    const ms = await hoverUntilLit(window, 4)
    console.log(`edges: hover to lit chain ${ms} ms`)
    test.info().annotations.push({ type: 'perf', description: `hoverToLit=${ms}ms` })
    expect(ms).toBeLessThanOrEqual(100)
    await expect.poll(() => drawn(window, 'lit')).toEqual(chainOf4)
    await expect.poll(() => drawn(window, 'pale')).toEqual(waiting.filter((id) => !chainOf4.includes(id)))
    // A lit line has a colour of its own: polled until the path has one, and it is not the pale one.
    await expect
      .poll(async () => {
        const value = await stroke(edgePath(window, edgeId(5, 8)))
        return { stroke: value, pale: value === paleStroke }
      })
      .toEqual({ stroke: expect.stringMatching(/^rgb/), pale: false })
    const hovered = await snapshotThemes(window, 'edges-chain')
    console.log(`edges, chain of 04: ${hovered.light} ${hovered.dark}`)

    // The pointer leaves: back to the default.
    await awayFromNodes(window)
    await expect.poll(() => drawn(window, 'lit')).toEqual([])
    await expect.poll(() => drawn(window, 'pale')).toEqual(waiting)

    // A selected Ticket keeps its chain lit; hovering another adds that one's chain.
    await mark(window, 'click Ticket 4')
    await ticketNode(window, 4).click()
    await awayFromNodes(window)
    await expect.poll(() => drawn(window, 'lit')).toEqual(chainOf4)
    await mark(window, 'hover Ticket 20')
    await ticketNode(window, 20).hover()
    await expect.poll(() => drawn(window, 'lit')).toEqual([...new Set([...chainOf4, ...chain(blockers, 20)])].sort())
    await awayFromNodes(window)
    await expect.poll(() => drawn(window, 'lit')).toEqual(chainOf4)
    // Clicking the empty plane clears the selection, and the chain with it.
    await mark(window, 'click the empty plane')
    await window.mouse.click(...(await emptySpot(window)))
    await expect.poll(() => drawn(window, 'lit')).toEqual([])
    await expect.poll(() => drawn(window, 'pale')).toEqual(waiting)

    // A closer look for the reviewer: Ticket 04 selected, zoomed in on it.
    await mark(window, 'click Ticket 4')
    await ticketNode(window, 4).click()
    await awayFromNodes(window)
    await expect.poll(() => drawn(window, 'lit')).toEqual(chainOf4)
    const at = await ticketNode(window, 4).boundingBox()
    if (!at) throw new Error('Ticket 04 has no box')
    await mark(window, 'move onto Ticket 4 to zoom')
    await window.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
    await window.keyboard.down('ControlOrMeta')
    for (let step = 0; step < 6; step += 1) await window.mouse.wheel(0, -40)
    await window.keyboard.up('ControlOrMeta')
    await awayFromNodes(window)
    await canvasReady({ window })
    const close = await snapshotThemes(window, 'edges-chain-close')
    console.log(`edges, chain of 04 up close: ${close.light} ${close.dark}`)
  } catch (error) {
    await reportPointer(launched)
    throw error
  } finally {
    await launched.close()
  }
})

/** `#rrggbb` as the computed `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (value === undefined) throw new Error(`not a #rrggbb colour: ${hex}`)
  const n = Number.parseInt(value, 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

/** A point on the empty plane: the Canvas's bottom-left corner. */
async function emptySpot(window: Page): Promise<[number, number]> {
  const pane = await window.locator('.react-flow').boundingBox()
  if (!pane) throw new Error('the Canvas has no box')
  return [pane.x + 8, pane.y + pane.height - 8]
}
