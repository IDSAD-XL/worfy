import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'

// A gesture that runs over a Card's iframe ends on the release (worfy-week ticket 09). A Card's
// page lives on another origin, worfy-card://, so while the pointer is over its iframe the mouse
// events go to the Card, not to the worfy window. A quick jerk outruns the Node: the pointer lands
// on the iframe, the window never sees the mouseup, and React Flow keeps the gesture going. Here
// each gesture moves in the steps that hung the app in the manual check M23 (14.3 px every 25 ms),
// is released, and then a click on the Card's page must still reach the page. The Canvas starts at
// zoom 1, so screen pixels are canvas units.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'drag-0000000a'
const VIEWPORT = { x: -800, y: 0, zoom: 1 }
/** The steps of the manual check M23 that hung the drag. */
const STEP_PX = 14.3
const STEP_MS = 25
/** Snapping moves a dropped Node to the 8 px grid (ticket 06). */
const GRID = 8

interface StateNode {
  id: string
  x: number
  y: number
  w: number
  h: number
}
interface SavedLayout {
  nodes: StateNode[]
  viewport: { x: number; y: number; zoom: number }
}
type Point = { x: number; y: number }

let scratch: string
let dataDir: string
let launched: LaunchedApp | undefined

const base = { hidden: false, locked: false, pinned: false, tags: [] }
const cardNode = (id: string, x: number, y: number) => ({ id, kind: 'card', x, y, w: 300, h: 220, ...base, data: {} })
const noteNode = (id: string, x: number, y: number) => ({ id, kind: 'note', x, y, w: 220, h: 120, ...base, data: { text: id } })

/** A Card page that counts the clicks it receives in body[data-clicks]. */
const CARD_HTML = `<!doctype html><html><head><title>Counter</title><style>html,body{margin:0;height:100%}</style></head>
<body data-clicks="0"><p id="count">clicks: 0</p><script>
document.addEventListener('click', () => {
  document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1)
  document.getElementById('count').textContent = 'clicks: ' + document.body.dataset.clicks
})
document.body.dataset.ready = 'yes'
</script></body></html>`

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** The only and active Project with the saved `nodes`; Card c1 has its page. */
function makeProject(nodes: unknown[], viewport: SavedLayout['viewport'] = VIEWPORT): void {
  const repo = join(scratch, 'demo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  const projectDir = join(dataDir, PROJECT_ID)
  mkdirSync(join(projectDir, 'cards', 'c1'), { recursive: true })
  writeFileSync(join(projectDir, 'cards', 'c1', 'index.html'), CARD_HTML)
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(projectDir, 'layout.json'), JSON.stringify({ nodes, viewport }))
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-card-drag-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

async function start(nodes: unknown[], viewport: SavedLayout['viewport'] = VIEWPORT): Promise<Page> {
  makeProject(nodes, viewport)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const { window } = launched
  await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: nodes.map((node) => nodeElement(window, (node as StateNode).id)) })
  await expect(window.frameLocator('[data-card-id="c1"] iframe').locator('body[data-ready="yes"]')).toHaveCount(1)
  return window
}

/** layout.json as main saved it. */
const saved = (): SavedLayout => JSON.parse(readFileSync(join(dataDir, PROJECT_ID, 'layout.json'), 'utf8')) as SavedLayout
/**
 * The camera main saved for the Canvas: this machine's own in viewports.json (worfy-link ticket 06),
 * or, while it has none, the one layout.json was written with.
 */
const savedCamera = (): SavedLayout['viewport'] => {
  const file = join(dataDir, 'viewports.json')
  const own = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, SavedLayout['viewport']>)[PROJECT_ID] : undefined
  return own ?? saved().viewport
}
const savedNode = (id: string): StateNode => {
  const node = saved().nodes.find((each) => each.id === id)
  if (!node) throw new Error(`no Node ${id} in layout.json`)
  return node
}

const nodeElement = (window: Page, id: string) => window.getByTestId(`rf__node-${id}`)
const header = (window: Page, id: string) => nodeElement(window, id).locator('.w-note__header')
const cardFrame = (window: Page) => window.locator('[data-card-id="c1"] iframe')

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** React Flow's viewport transform on the screen. */
const viewportTransform = (window: Page): Promise<string> =>
  window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)

/**
 * Presses at `from`, moves by `by` in steps of about STEP_PX, one every STEP_MS, and releases.
 * Returns how far a dragged Node follows: React Flow starts a Node drag on the first move and
 * measures from there, so the Node moves by all steps but the first.
 */
async function jerk(window: Page, from: Point, by: Point, button: 'left' | 'middle' = 'left'): Promise<Point> {
  await window.mouse.move(from.x, from.y)
  await window.mouse.down({ button })
  const steps = Math.ceil(Math.hypot(by.x, by.y) / STEP_PX)
  for (let step = 1; step <= steps; step += 1) {
    await window.mouse.move(from.x + (by.x * step) / steps, from.y + (by.y * step) / steps)
    // Not a wait for anything: the pace of the gesture under test, the one that hung the drag in
    // the manual check M23. Shorter or longer, it is another gesture.
    await window.waitForTimeout(STEP_MS)
  }
  await window.mouse.up({ button })
  return { x: (by.x * (steps - 1)) / steps, y: (by.y * (steps - 1)) / steps }
}

/**
 * A click in the middle of the Card's page reaches the page. The page takes the mouse only while
 * the Card is the active Node (worfy-week ticket 16), so a Card that is not yet active is first
 * made active by a click, which does not reach the page.
 */
async function clickReachesCard(window: Page, clicks: number): Promise<void> {
  const frame = await box(cardFrame(window))
  const middle = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  const page = window.frameLocator('[data-card-id="c1"] iframe').locator('body')
  if (!/\bw-node--active\b/.test((await nodeElement(window, 'c1').getAttribute('class')) ?? '')) {
    await window.mouse.click(middle.x, middle.y)
    await expect(nodeElement(window, 'c1')).toHaveClass(/\bw-node--active\b/)
    await expect(page).toHaveAttribute('data-clicks', String(clicks - 1))
    // The page is in another process: the window hands it the mouse only once frames without
    // pointer-events: none on the iframe have been drawn.
    await window.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const page = globalThis as unknown as { requestAnimationFrame(cb: () => void): void }
          page.requestAnimationFrame(() => page.requestAnimationFrame(() => resolve()))
        }),
    )
  }
  await window.mouse.click(middle.x, middle.y)
  await expect(page).toHaveAttribute('data-clicks', String(clicks))
}

// Held in the middle of the header, the drag starts and the Card then falls behind the pointer
// (M23: the Node stayed `dragging` after the release). Held at the lower end, the very first step
// is on the iframe, before React Flow has seen a move at all.
for (const [where, below] of [['the middle', 0.5], ['the lower end', 1]] as const) {
  test(`a Card jerked by ${where} of its header ends its drag on the release, lands where it was dropped, and the viewport stays`, async () => {
    const window = await start([cardNode('c1', 1000, 200)])
    const viewportBefore = await viewportTransform(window)
    const title = await box(header(window, 'c1'))
    const moved = await jerk(window, { x: title.x + title.width / 2, y: title.y + Math.min(title.height * below, title.height - 4) }, { x: 0, y: 172 })

    await expect(nodeElement(window, 'c1')).not.toHaveClass(/\bdragging\b/)
    await expect.poll(() => savedNode('c1').y).not.toBe(200)
    const dropped = savedNode('c1')
    expect(dropped.x).toBe(1000)
    expect(Math.abs(dropped.y - (200 + moved.y))).toBeLessThanOrEqual(GRID)
    expect(await viewportTransform(window)).toBe(viewportBefore)
    expect(savedCamera()).toEqual(VIEWPORT)
    await clickReachesCard(window, 1)
  })
}

test('a Note jerked across a Card iframe ends its drag on the release and lands where it was dropped', async () => {
  // At zoom 0.5 the Note stands 8 screen px left of the Card (16 on the Canvas, ADR-0038). Held at
  // the right end of its header and pulled right: the first step puts the pointer on the Card's
  // iframe, and the pull carries the Note across the Card to beyond it.
  const viewport = { x: -400, y: 0, zoom: 0.5 }
  const window = await start([noteNode('n1', 1064, 300), cardNode('c1', 1300, 200)], viewport)
  const title = await box(header(window, 'n1'))
  const moved = await jerk(window, { x: title.x + title.width - 2, y: title.y + title.height / 2 }, { x: 360, y: 0 })

  await expect(nodeElement(window, 'n1')).not.toHaveClass(/\bdragging\b/)
  await expect.poll(() => savedNode('n1').x).not.toBe(1064)
  expect(savedCamera()).toEqual(viewport)
  expect(Math.abs(savedNode('n1').x - (1064 + moved.x / viewport.zoom))).toBeLessThanOrEqual(GRID)
  expect(savedNode('n1').y).toBe(300)
  await clickReachesCard(window, 1)
})

test('a Card shrunk by its corner so the pointer falls onto its iframe ends the resize on the release and keeps the size', async () => {
  const window = await start([cardNode('c1', 1000, 200)])
  await header(window, 'c1').click()
  const corner = await box(nodeElement(window, 'c1').locator('.react-flow__resize-control.handle.bottom.right'))
  await jerk(window, { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, { x: -100, y: -80 })

  await expect.poll(() => savedNode('c1').w).not.toBe(300)
  const resized = savedNode('c1')
  expect(resized.w).toBeLessThan(300 - 60)
  expect(resized.h).toBeLessThan(220 - 40)
  // The size on the screen is the saved one, and the release ended the resize: moving the mouse afterwards changes nothing.
  const after = await box(nodeElement(window, 'c1'))
  expect({ w: Math.round(after.width), h: Math.round(after.height) }).toEqual({ w: resized.w, h: resized.h })
  await window.mouse.move(after.x + after.width + 60, after.y + after.height + 60, { steps: 4 })
  expect(await box(nodeElement(window, 'c1'))).toEqual(after)
  await clickReachesCard(window, 1)
})

test('the Canvas panned with the middle button across a Card ends the pan on the release', async () => {
  const window = await start([cardNode('c1', 1000, 200)])
  const card = await box(nodeElement(window, 'c1'))
  // Pressed on the plane just right of the Card and pulled left: the first step puts the pointer on the Card's iframe.
  await jerk(window, { x: card.x + card.width + 6, y: card.y + card.height / 2 }, { x: -172, y: 0 }, 'middle')

  await expect(window.locator('.react-flow__pane')).not.toHaveClass(/\bdragging\b/)
  await expect.poll(() => savedCamera().x).not.toBe(VIEWPORT.x)
  // The pan follows the pointer from the press, give or take the first step.
  expect(Math.abs(savedCamera().x - (VIEWPORT.x - 172))).toBeLessThanOrEqual(STEP_PX)
  // The pan changed this machine's camera, not the Layout's.
  expect(saved().viewport).toEqual(VIEWPORT)
  const panned = await viewportTransform(window)
  await window.mouse.move(card.x - 100, card.y, { steps: 4 })
  expect(await viewportTransform(window)).toBe(panned)
  await clickReachesCard(window, 1)
})
