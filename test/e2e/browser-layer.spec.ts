import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// The prototype of the layer of live Browsers (worfy-browser ticket 01, ADR-0078 item 12): the
// Canvas draws a Browser Node as an empty frame, and a separate layer draws the frame's <webview>
// inside the Canvas viewport transform, at the frame's place and size. The layer does not depend on
// React Flow's onlyRenderVisibleElements, so a frame that leaves the screen keeps its page.
// The <webview> tag is on in every window since worfy-browser ticket 02 (src/main/window.ts), which
// dropped the prototype's flag. The page is a local fixture (test/fixtures/browser/page.html) served by a
// server this file starts on 127.0.0.1: no outside site.
// Every measurement is printed as a `[browser-layer] <what>: <json>` line, for the ticket's result
// section. With WORFY_EVIDENCE_DIR set, the snapshots are copied there as 01-<name>.png.

const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const PROJECT = 'browser-0000000a'
const WINDOW = { width: 1400, height: 900 }
const FRAME = { id: 'b1', x: 120, y: 80, w: 640, h: 440 }

let server: Server
let pageUrl: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeAll(async () => {
  // Serves page.html and nothing else.
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
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Starts the app over a Project whose Layout holds the Browser frame `FRAME` and `extra` Nodes. */
async function start(viewport: Viewport, extra: Record<string, unknown>[] = []): Promise<Page> {
  const dataDir = join(scratch, 'data')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const nodes = [{ ...FRAME, kind: 'browser', ...base, data: { url: pageUrl } }, ...extra.map((node) => ({ ...base, ...node }))]
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: home } })
  const { window } = launched
  await canvasReady(launched, { size: WINDOW, visible: [window.locator(`.react-flow__node[data-id="${FRAME.id}"]`)] })
  await expect.poll(() => guestState().then((state) => state?.ready), { timeout: 15_000, message: 'the fixture page has loaded in the <webview>' }).toBe('yes')
  return window
}

interface GuestState {
  ready: string | undefined
  load: string | undefined
  count: number
  wheels: number
  scrollY: number
  /** The page's viewport, in its own CSS px. */
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
}

/** The fixture page's state, read in main from the one <webview> guest; null while there is none. */
async function guestState(): Promise<GuestState | null> {
  if (launched === undefined) return null
  return launched.app.evaluate(async ({ webContents }) => {
    const guests = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview')
    if (guests.length !== 1) return null
    return (await guests[0]!.executeJavaScript(
      '({ ready: document.body?.dataset.ready, load: document.body?.dataset.load, count: Number(document.body?.dataset.count ?? 0), wheels: Number(document.body?.dataset.wheels ?? 0), scrollY, innerWidth, innerHeight, devicePixelRatio })',
    )) as GuestState
  })
}

const frameNode = (window: Page) => window.locator(`.react-flow__node[data-id="${FRAME.id}"]`)
const webview = (window: Page) => window.locator(`webview[data-browser-id="${FRAME.id}"]`)

/** A point on the empty plane right of the frame: the frame never passes under it while the Canvas pans left and back. */
async function planePoint(window: Page): Promise<{ x: number; y: number }> {
  const box = await frameNode(window).boundingBox()
  if (!box) throw new Error('the Browser frame is not on screen')
  return { x: box.x + box.width + 120, y: box.y + box.height / 2 }
}

test('a Browser frame that leaves the screen and comes back keeps its page: the counter goes on, the page is not reloaded', async () => {
  const window = await start({ x: 0, y: 0, zoom: 1 })
  await expect(webview(window)).toHaveCount(1)
  const before = await guestState()
  expect(before?.load).toBeTruthy()

  // Pan the Canvas with the wheel over the empty plane until React Flow stops drawing the frame
  // (onlyRenderVisibleElements): the frame is off the screen.
  const point = await planePoint(window)
  await window.mouse.move(point.x, point.y)
  let panned = 0
  while ((await frameNode(window).count()) > 0) {
    await window.mouse.wheel(600, 0)
    panned += 600
    expect(panned, 'the frame leaves the screen').toBeLessThan(20_000)
  }
  // Off the screen the page lives on: the layer keeps the <webview>, and the counter grows.
  await expect(webview(window)).toHaveCount(1)
  const away = (await guestState())!.count
  await expect.poll(async () => (await guestState())?.count ?? 0, { message: 'the counter goes on off the screen' }).toBeGreaterThan(away + 5)

  // Back: the same page, the counter did not start again.
  await window.mouse.wheel(-panned, 0)
  await expect(frameNode(window)).toHaveCount(1)
  const after = await guestState()
  expect(after?.load, 'the page was not reloaded').toBe(before?.load)
  expect(after!.count, 'the counter did not reset').toBeGreaterThan(away)
})

// ── Pixels ──────────────────────────────────────────────────────────────────

interface Image {
  width: number
  height: number
  /** RGBA, row by row. */
  data: Uint8Array
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG, the kind Chromium writes (PNG spec, sections 7 and 9). */
function decodePng(png: Buffer): Image {
  let width = 0
  let height = 0
  let channels = 0
  const chunks: Buffer[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]]
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, colour type ${color}, interlace ${interlace}`)
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') chunks.push(data)
    else if (type === 'IEND') break
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  let current = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels]! : 0
      const b = previous[i]!
      const c = i >= channels ? previous[i - channels]! : 0
      let value = line[i]!
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      current[i] = value & 255
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4
      out[to] = current[x * channels]!
      out[to + 1] = current[x * channels + 1]!
      out[to + 2] = current[x * channels + 2]!
      out[to + 3] = channels === 4 ? current[x * channels + 3]! : 255
    }
    ;[previous, current] = [current, previous]
  }
  return { width, height, data: out }
}

type Weight = (r: number, g: number, b: number) => number
/** How much a pixel is the fixture page's magenta edge line. */
const MAGENTA: Weight = (r, g, b) => Math.max(0, Math.min(r, b) - g - 20)
/** How much a pixel is the green outline the test puts around the frame's body. */
const GREEN: Weight = (r, g, b) => Math.max(0, g - Math.max(r, b) - 20)
/** Whether a pixel is the fixture page's cream background (#fdf6e3). */
const isCream = (r: number, g: number, b: number): boolean => Math.abs(r - 0xfd) <= 3 && Math.abs(g - 0xf6) <= 3 && Math.abs(b - 0xe3) <= 3

/** The weighted centre, in device pixels, of the pixels along one row (`axis` 'x') or one column ('y') between `from` and `to`; null when there are none. */
function centroid(image: Image, axis: 'x' | 'y', fixed: number, from: number, to: number, weight: Weight): number | null {
  let sum = 0
  let total = 0
  for (let at = Math.max(0, Math.floor(from)); at <= Math.min((axis === 'x' ? image.width : image.height) - 1, Math.ceil(to)); at += 1) {
    const [x, y] = axis === 'x' ? [at, Math.round(fixed)] : [Math.round(fixed), at]
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
    const i = (y * image.width + x) * 4
    const w = weight(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)
    sum += w * at
    total += w
  }
  return total === 0 ? null : sum / total
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

type Edge = 'left' | 'right' | 'top' | 'bottom'

/** Whether a pixel is the page's own: its cream, or its magenta edge line, also blended with what is next to it. */
const isPage = (r: number, g: number, b: number): boolean =>
  (Math.abs(r - 0xfd) <= 6 && Math.abs(g - 0xf6) <= 6 && Math.abs(b - 0xe3) <= 6) || MAGENTA(r, g, b) > 40

/**
 * How far, in CSS pixels, the page's own edge is from the frame's edge on each `edges` side of
 * `body` (the frame's body in CSS pixels at the time of the capture), along the row or column
 * through the middle of the body. The frame's edge: the centre of the green outline the test puts
 * just outside the body, one line (`zoom` CSS px) wide, so the body's edge is half a line inward of
 * it. The page's edge: the outermost pixel of the page (cream or magenta), found from outside in.
 * 0 when the page sits exactly in the body; a pixel blended at the border counts as up to one device
 * pixel. The page's own magenta line is not used for the position: at zoom 0.25 the minified page
 * loses its last row and column of pixels, line and all. An edge where the outline or the page is
 * not found counts as Infinity.
 */
function edgeErrors(image: Image, scale: number, body: Box, zoom: number, edges: readonly Edge[]): Record<Edge, number> {
  const reach = (6 * zoom + 3) * scale
  const mid = { x: (body.x + body.width / 2) * scale, y: (body.y + body.height / 2) * scale }
  const result = {} as Record<Edge, number>
  for (const edge of edges) {
    const vertical = edge === 'left' || edge === 'right'
    const outward = edge === 'left' || edge === 'top' ? -1 : 1
    const at = (edge === 'left' ? body.x : edge === 'right' ? body.x + body.width : edge === 'top' ? body.y : body.y + body.height) * scale
    const axis = vertical ? 'x' : 'y'
    const fixed = Math.round(vertical ? mid.y : mid.x)
    const green = centroid(image, axis, fixed, at - reach, at + reach, GREEN)
    let pageEdge: number | null = null
    // From outside in: the first pixel of the page; its outer side is the page's edge.
    for (let step = Math.ceil(reach); step >= -Math.ceil(reach) && pageEdge === null; step -= 1) {
      const index = Math.floor(at) + outward * step
      const [x, y] = vertical ? [index, fixed] : [fixed, index]
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const i = (y * image.width + x) * 4
      if (isPage(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)) pageEdge = outward < 0 ? index : index + 1
    }
    if (green === null || pageEdge === null) {
      result[edge] = Number.POSITIVE_INFINITY
      continue
    }
    // The green centre is half a line outside the body's edge; the page's edge should be on the body's edge.
    const greenCentre = green + 0.5
    result[edge] = Math.abs((outward * (greenCentre - pageEdge)) / scale - zoom / 2)
  }
  return result
}

/** Pixels of the page (its cream or its magenta line) outside `inside` (CSS px, widened by one device pixel). */
function pagePixelsOutside(image: Image, scale: number, inside: Box): number {
  const left = inside.x * scale - 1
  const right = (inside.x + inside.width) * scale + 1
  const top = inside.y * scale - 1
  const bottom = (inside.y + inside.height) * scale + 1
  let count = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x >= left && x < right && y >= top && y < bottom) continue
      const i = (y * image.width + x) * 4
      const [r, g, b] = [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      if (isCream(r, g, b) || MAGENTA(r, g, b) > 60) count += 1
    }
  }
  return count
}

/**
 * Pixels of the page's cream inside `box` (CSS px), shrunk by `inset` CSS px: the rounded corners
 * of a Node or a menu leave the page visible in the corners of their bounding box.
 */
function creamInside(image: Image, scale: number, box: Box, inset: number): number {
  let count = 0
  const pad = Math.ceil(inset * scale)
  for (let y = Math.ceil(box.y * scale) + pad; y < Math.floor((box.y + box.height) * scale) - pad; y += 1) {
    for (let x = Math.ceil(box.x * scale) + pad; x < Math.floor((box.x + box.width) * scale) - pad; x += 1) {
      const i = (y * image.width + x) * 4
      if (isCream(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)) count += 1
    }
  }
  return count
}

// ── Measuring the layer ─────────────────────────────────────────────────────

const GREEN_OUTLINE = `.react-flow__node[data-id="${FRAME.id}"] [data-testid="browser-frame-body"] { outline: 1px solid #00ff00 !important; }`

/** Where the frame's body and the <webview> are on screen, in CSS pixels. */
async function boxes(window: Page): Promise<{ body: Box | null; page: Box | null; zoom: number }> {
  return window.evaluate((id) => {
    const dom = globalThis as unknown as { document: { querySelector(selector: string): { getBoundingClientRect(): Box; style: { transform: string } } | null } }
    const rect = (selector: string): Box | null => {
      const element = dom.document.querySelector(selector)
      if (element === null) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const viewport = dom.document.querySelector('.react-flow__viewport')
    const zoom = viewport === null ? 1 : Number(/scale\(([\d.]+)\)/.exec(viewport.style.transform)?.[1] ?? 1)
    return { body: rect(`.react-flow__node[data-id="${id}"] [data-testid="browser-frame-body"]`), page: rect(`webview[data-browser-id="${id}"]`), zoom }
  }, FRAME.id)
}

/**
 * Starts recording, in every animation frame of the window, the frame's body and the <webview> as
 * getBoundingClientRect() sees them; stopFrames() ends it and returns the record.
 */
async function recordFrames(window: Page): Promise<void> {
  await window.evaluate((id) => {
    type Rect = { x: number; y: number; width: number; height: number }
    const dom = globalThis as unknown as {
      document: { querySelector(selector: string): { getBoundingClientRect(): Rect } | null }
      requestAnimationFrame(callback: (time: number) => void): number
      __browserFrames?: { stop: boolean; samples: { t: number; body: Rect | null; page: Rect | null }[] }
    }
    const record = { stop: false, samples: [] as { t: number; body: Rect | null; page: Rect | null }[] }
    dom.__browserFrames = record
    const rect = (selector: string): Rect | null => {
      const r = dom.document.querySelector(selector)?.getBoundingClientRect()
      return r === undefined ? null : { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const tick = (t: number): void => {
      if (record.stop) return
      record.samples.push({ t, body: rect(`.react-flow__node[data-id="${id}"] [data-testid="browser-frame-body"]`), page: rect(`webview[data-browser-id="${id}"]`) })
      dom.requestAnimationFrame(tick)
    }
    dom.requestAnimationFrame(tick)
  }, FRAME.id)
}

interface Sample {
  t: number
  body: Box | null
  page: Box | null
}

async function stopFrames(window: Page): Promise<Sample[]> {
  return window.evaluate(() => {
    const dom = globalThis as unknown as { __browserFrames: { stop: boolean; samples: Sample[] } }
    dom.__browserFrames.stop = true
    return dom.__browserFrames.samples
  })
}

/** The largest gap between two boxes' edges, in CSS px. */
const boxGap = (a: Box, b: Box): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.width - (b.x + b.width)), Math.abs(a.y + a.height - (b.y + b.height)))

/**
 * What the record says: in how many frames the frame moved, the largest gap between the frame's
 * body and the page in one frame, and the largest lag: the number of frames between the frame
 * reaching a place and the page reaching it (0 when the page is always where its frame is).
 */
function frameReport(samples: Sample[]): { frames: number; moving: number; maxGapPx: number; maxLagFrames: number; meanFrameMs: number } {
  const both = samples.filter((sample): sample is Sample & { body: Box; page: Box } => sample.body !== null && sample.page !== null)
  let moving = 0
  let maxGap = 0
  let maxLag = 0
  for (let i = 0; i < both.length; i += 1) {
    if (i > 0 && boxGap(both[i]!.body, both[i - 1]!.body) > 0) moving += 1
    maxGap = Math.max(maxGap, boxGap(both[i]!.body, both[i]!.page))
    let lag = 0
    while (lag <= i && boxGap(both[i - lag]!.body, both[i]!.page) > 1) lag += 1
    maxLag = Math.max(maxLag, lag)
  }
  const spans = both.slice(1).map((sample, i) => sample.t - both[i]!.t)
  const meanFrameMs = spans.length === 0 ? 0 : spans.reduce((sum, span) => sum + span, 0) / spans.length
  return { frames: both.length, moving, maxGapPx: round(maxGap), maxLagFrames: maxLag, meanFrameMs: round(meanFrameMs) }
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * What the window shows, as a PNG: main's capturePage() of the window, `rect` (CSS px) or all of it.
 * Not Playwright's page.screenshot(): that one (CDP Page.captureScreenshot) leaves out the last
 * CSS pixel of the <webview> page on its right and bottom edges, which the window itself does show
 * (compared pixel by pixel while this test was written), so it would measure its own capture.
 */
async function capture(rect?: Box): Promise<Buffer> {
  const base64 = await launched!.app.evaluate(async ({ BrowserWindow }, area) => {
    const [main] = BrowserWindow.getAllWindows()
    const image = await main!.webContents.capturePage(area)
    return image.toPNG().toString('base64')
  }, rect === undefined ? undefined : { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  return Buffer.from(base64, 'base64')
}

/** A capture of the whole window, decoded, with its device pixels per CSS pixel. */
async function screenshot(window: Page): Promise<{ png: Buffer; image: Image; scale: number }> {
  const png = await capture()
  const image = decodePng(png)
  const innerWidth = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  return { png, image, scale: image.width / innerWidth }
}

/** Measurements of this run, printed for the ticket's result section. */
function report(name: string, value: unknown): void {
  console.log(`[browser-layer] ${name}: ${JSON.stringify(value)}`)
}

/** Copies a PNG into WORFY_EVIDENCE_DIR as 01-<name>.png, when the variable is set. */
function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `01-${name}.png`))
}

/** Saves a PNG under test-results/snapshots/<folder>/<name>.png and returns its path. */
function savePng(png: Buffer, folder: string, name: string): string {
  const dir = join(test.info().project.outputDir, 'snapshots', folder)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.png`)
  writeFileSync(file, png)
  return file
}

/** Steps of a pan or a drag, and the steps after which a screenshot is taken at once. */
const STEPS = 30
const STEP_PX = 10
const SHOT_AT = new Set([6, 12, 18, 24, 30])
const ALL_EDGES: readonly Edge[] = ['left', 'right', 'top', 'bottom']

/**
 * Moves the mouse from `from` by STEPS steps of STEP_PX right and half of it down (`up`: up) with `button` held, recording
 * every animation frame and taking a screenshot after the steps in SHOT_AT without waiting for
 * anything. Returns the frame record's report and the largest edge error of each screenshot.
 */
async function measureGesture(window: Page, name: string, from: { x: number; y: number }, button: 'left' | 'middle', up = false): Promise<{ frames: ReturnType<typeof frameReport>; shotsPx: number[] }> {
  await window.addStyleTag({ content: GREEN_OUTLINE })
  await window.mouse.move(from.x, from.y)
  await recordFrames(window)
  await window.mouse.down({ button })
  const shots: { png: Buffer; body: Box; zoom: number }[] = []
  for (let step = 1; step <= STEPS; step += 1) {
    await window.mouse.move(from.x + step * STEP_PX, from.y + (up ? -1 : 1) * step * (STEP_PX / 2))
    if (!SHOT_AT.has(step)) continue
    const { body, zoom } = await boxes(window)
    const png = await capture()
    shots.push({ png, body: body!, zoom })
  }
  await window.mouse.up({ button })
  const frames = frameReport(await stopFrames(window))
  const innerWidth = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  const shotsPx = shots.map(({ png, body, zoom }, index) => {
    const image = decodePng(png)
    const file = savePng(png, `browser-layer-${name}`, `point-${index + 1}`)
    if (index === 2) evidence(file, `browser-layer-${name}-point-3`)
    const errors = edgeErrors(image, image.width / innerWidth, body, zoom, ALL_EDGES)
    return round(Math.max(...Object.values(errors)))
  })
  return { frames, shotsPx }
}

test('pan: the page stays in its frame, within one frame and one pixel', async () => {
  const window = await start({ x: 0, y: 0, zoom: 1 })
  // The middle button pans (Canvas.tsx, panOnDrag); pressed on the plane left of the frame, which
  // moves right with the pointer, so the pointer never passes over the page.
  const frame = (await frameNode(window).boundingBox())!
  const result = await measureGesture(window, 'pan', { x: frame.x - 60, y: frame.y + frame.height / 2 }, 'middle')
  report('pan', result)
  expect(result.frames.moving, 'the Canvas moved during the pan').toBeGreaterThan(10)
  expect(result.frames.maxLagFrames).toBeLessThanOrEqual(1)
  expect(result.frames.maxGapPx).toBeLessThanOrEqual(1)
  for (const error of result.shotsPx) expect(error, 'edge of the page against the edge of the frame on a screenshot').toBeLessThanOrEqual(1)
})

test('drag of the frame: the page follows within one frame and one pixel', async () => {
  // The app puts the Orchestrator's Node below the frame. The frame is dragged right and up, away
  // from it: a frame dragged over another Node would show the snapping outline of where it lands
  // (snapping.ts) over its page, and the measure would read that outline instead of the page.
  const window = await start({ x: 0, y: 200, zoom: 1 })
  const header = await frameNode(window).locator('.w-browser-frame__header').boundingBox()
  if (!header) throw new Error('no frame header')
  // From the header's right part, so the pointer stays on the header the whole way.
  const result = await measureGesture(window, 'drag', { x: header.x + header.width - 60, y: header.y + header.height / 2 }, 'left', true)
  report('drag', result)
  expect(result.frames.moving, 'the frame moved during the drag').toBeGreaterThan(10)
  expect(result.frames.maxLagFrames).toBeLessThanOrEqual(1)
  expect(result.frames.maxGapPx).toBeLessThanOrEqual(1)
  for (const error of result.shotsPx) expect(error, 'edge of the page against the edge of the frame on a screenshot').toBeLessThanOrEqual(1)
})

/**
 * The cameras of the zoom check. At 2 the frame is bigger than the Canvas: its left part lies past
 * the Canvas's left edge, under the sidebar, and its bottom past the window's.
 */
const ZOOMS = [
  { zoom: 0.25, viewport: { x: 40, y: 20, zoom: 0.25 }, edges: ALL_EDGES },
  { zoom: 0.5, viewport: { x: 40, y: 20, zoom: 0.5 }, edges: ALL_EDGES },
  { zoom: 1, viewport: { x: 40, y: 20, zoom: 1 }, edges: ALL_EDGES },
  { zoom: 2, viewport: { x: -400, y: -100, zoom: 2 }, edges: ['right', 'top'] as const },
] as const

for (const { zoom, viewport, edges } of ZOOMS) {
  test(`zoom ${zoom}: the page scales with its frame and is clipped at the frame's edge and the Canvas's`, async () => {
    const window = await start(viewport)
    await window.addStyleTag({ content: GREEN_OUTLINE })
    await canvasReady(launched!)
    const { body, page, zoom: shown } = await boxes(window)
    expect(shown).toBeCloseTo(zoom, 5)
    // The <webview> box is the frame's body, scaled with the Canvas.
    expect(boxGap(body!, page!)).toBeLessThanOrEqual(1)
    expect(Math.abs(page!.width - (FRAME.w - 2) * zoom)).toBeLessThanOrEqual(1)
    const { png, image, scale } = await screenshot(window)
    const file = savePng(png, 'browser-layer-clip', `zoom-${zoom}`)
    if (zoom !== 0.25) evidence(file, `browser-layer-clip-zoom-${zoom}`)
    const errors = edgeErrors(image, scale, body!, zoom, edges)
    // Clipped: no pixel of the page outside the part of the frame's body that is on the Canvas.
    const canvas = (await window.getByTestId('canvas').boundingBox())!
    const visible = intersect(body!, canvas)
    const outside = pagePixelsOutside(image, scale, visible)
    const sidebar = canvas.x > 0 ? pagePixelsOutside(image, scale, { x: canvas.x, y: 0, width: image.width / scale, height: image.height / scale }) : 0
    const guest = (await guestState())!
    report(`zoom ${zoom}`, { guestViewport: [guest.innerWidth, guest.innerHeight, guest.devicePixelRatio], edgeErrorsPx: Object.fromEntries(Object.entries(errors).map(([edge, value]) => [edge, round(value)])), pagePixelsOutsideFrame: outside, pagePixelsLeftOfCanvas: sidebar, pageWidthPx: round(page!.width) })
    for (const edge of edges) expect(errors[edge], `${edge} edge`).toBeLessThanOrEqual(1)
    expect(outside, 'page pixels outside the frame').toBe(0)
    expect(sidebar, 'page pixels left of the Canvas').toBe(0)
    if (zoom !== 1) return

    // At 1 the page reads the same as in a plain Electron window of the same size.
    const clip = { x: Math.round(page!.x), y: Math.round(page!.y), width: Math.round(page!.width), height: Math.round(page!.height) }
    const inLayer = await capture(clip)
    const plain = await plainWindowShot(clip.width, clip.height)
    const diff = diffRatio(decodePng(inLayer), decodePng(plain))
    report('zoom 1 against a plain window', { size: clip, diffPercent: round(diff * 100) })
    evidence(savePng(inLayer, 'browser-layer-zoom', 'in-layer'), 'browser-layer-zoom-1-in-layer')
    evidence(savePng(plain, 'browser-layer-zoom', 'plain-window'), 'browser-layer-zoom-1-plain-window')
    expect(diff).toBeLessThanOrEqual(0.01)
    // The same comparison through Playwright's own: the plain window's PNG stands as the snapshot.
    const snapshot = test.info().snapshotPath('browser-layer-zoom-1.png')
    mkdirSync(dirname(snapshot), { recursive: true })
    writeFileSync(snapshot, plain)
    try {
      expect(inLayer).toMatchSnapshot('browser-layer-zoom-1.png', { maxDiffPixelRatio: 0.01 })
    } finally {
      await removeDir(dirname(snapshot))
    }
  })
}

const intersect = (a: Box, b: Box): Box => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
}

/** The fixture page in a plain Electron window of `width` × `height` CSS px, as a PNG of the same device scale. */
async function plainWindowShot(width: number, height: number): Promise<Buffer> {
  const base64 = await launched!.app.evaluate(async ({ BrowserWindow }, { url, width: w, height: h }) => {
    const plain = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, frame: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await plain.loadURL(url)
      await plain.webContents.executeJavaScript('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))')
      return (await plain.webContents.capturePage()).toPNG().toString('base64')
    } finally {
      plain.destroy()
    }
  }, { url: pageUrl, width, height })
  return Buffer.from(base64, 'base64')
}

/** The share of pixels that differ by more than a tenth on any channel; images of different sizes differ entirely. */
function diffRatio(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let differ = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i]! - b.data[i]!) > 25 || Math.abs(a.data[i + 1]! - b.data[i + 1]!) > 25 || Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 25) differ += 1
  }
  return differ / (a.width * a.height)
}

/** Larger than the corner radius of a Node (8 px) and of a menu (10 px), F-SPEC tokens. */
const CORNER = 12

test('another Node dragged over the frame and the Canvas menu are drawn over the page', async () => {
  const window = await start({ x: 0, y: 0, zoom: 1 }, [{ id: 'n1', kind: 'note', x: 820, y: 80, w: 220, h: 120, data: { text: 'over the page' } }])
  const note = window.locator('.react-flow__node[data-id="n1"]')
  const body = (await boxes(window)).body!
  const header = (await note.locator('.w-note__header').boundingBox())!
  // Hold the Note over the middle of the frame's body: Nodes never overlap once dropped
  // (ADR-0038), so the overlap is looked at while the Note is dragged.
  await window.mouse.move(header.x + 20, header.y + header.height / 2)
  await window.mouse.down()
  const target = { x: body.x + body.width / 2 - 90, y: body.y + body.height / 2 - 40 }
  for (let step = 1; step <= 10; step += 1) {
    await window.mouse.move(header.x + 20 + ((target.x - header.x) * step) / 10, header.y + header.height / 2 + ((target.y - header.y) * step) / 10)
  }
  await canvasReady(launched!, { frames: 5 })
  const over = (await note.boundingBox())!
  expect(intersect(over, body).width * intersect(over, body).height, 'the Note lies over the frame').toBeGreaterThan(0.9 * over.width * over.height)
  const held = await screenshot(window)
  const underNote = creamInside(held.image, held.scale, intersect(over, body), CORNER)
  const shots = await snapshotThemes(window, 'browser-layer-overlap')
  evidence(shots.light, 'browser-layer-overlap-light')
  evidence(shots.dark, 'browser-layer-overlap-dark')
  await window.mouse.up()

  // The Canvas menu, opened just left of the frame so that it reaches over the page.
  await canvasReady(launched!)
  const now = (await boxes(window)).body!
  await window.mouse.click(now.x - 40, now.y + 60, { button: 'right' })
  const menu = window.getByRole('menu')
  await expect(menu).toBeVisible()
  const menuBox = (await menu.boundingBox())!
  expect(intersect(menuBox, now).width, 'the menu reaches over the page').toBeGreaterThan(40)
  const opened = await screenshot(window)
  const underMenu = creamInside(opened.image, opened.scale, intersect(menuBox, now), CORNER)
  const menuShots = await snapshotThemes(window, 'browser-layer-overlap-menu')
  evidence(menuShots.light, 'browser-layer-overlap-menu-light')
  evidence(menuShots.dark, 'browser-layer-overlap-menu-dark')
  report('overlap', { pagePixelsUnderNote: underNote, pagePixelsUnderMenu: underMenu })
  expect(underNote, 'page pixels under the Note').toBe(0)
  expect(underMenu, 'page pixels under the menu').toBe(0)
})

// Open question 3 of the ticket: what a wheel over the page does when nothing decides it. The page
// takes the mouse through the frame's body (BrowserNode.css), so the wheel goes to the page: the page
// scrolls and the Canvas stays. Playwright's wheel is a CDP input event, routed the way a real one
// is: to the frame under the pointer. (Electron's webContents.sendInputEvent on the window would
// not do here: it hands the event to the window's own page, which pans the Canvas.)
test('the wheel over the page scrolls the page and leaves the Canvas where it is', async () => {
  const window = await start({ x: 0, y: 0, zoom: 1 })
  const transform = () => window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const before = { guest: (await guestState())!, transform: await transform() }
  const { body } = await boxes(window)
  const at = { x: body!.x + body!.width / 2, y: body!.y + body!.height / 2 }
  const hit = await window.evaluate((point) => {
    const element = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { tagName: string } | null } }).document.elementFromPoint(point.x, point.y)
    return element?.tagName.toLowerCase() ?? null
  }, at)
  expect(hit, 'the <webview> is what lies under the pointer in the frame').toBe('webview')
  await window.mouse.move(at.x, at.y)
  await window.mouse.wheel(0, 400)
  await expect.poll(async () => (await guestState())!.scrollY, { message: 'the page scrolls' }).toBeGreaterThan(0)
  await canvasReady(launched!)
  const after = { guest: (await guestState())!, transform: await transform() }
  report('wheel over the page', { pageWheels: after.guest.wheels - before.guest.wheels, pageScrollY: after.guest.scrollY, canvasMoved: after.transform !== before.transform })
  expect(after.transform, 'the Canvas did not move').toBe(before.transform)
})
