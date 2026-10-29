import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { decodePng, MAGENTA } from './browser-pixels'
import { canvasReady, launchApp, openSecondWindow, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// The resize of a Browser frame and the page viewport set apart from it (worfy-browser ticket 18,
// ADR-0087): the frame is resized by its handle like any Node, and its page follows the body; the
// settings sidebar gives the page a viewport of its own, which the page sees as its window size while
// the frame keeps its size on the Canvas. Both are in the Layout and survive a restart. The page is a
// local fixture (test/fixtures/browser/page.html) served on 127.0.0.1: no outside site, no sign-in.
// A second window, which shows the frames of the page instead of the page, draws them fitted the same
// way and sends a click on what it shows to the same point of the page.
// With WORFY_EVIDENCE_DIR set, the snapshots are copied there as 18-<name>.png.

const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const PROJECT = 'browser-00000018'
const WINDOW = { width: 1400, height: 900 }
const FRAME = { id: 'b1', x: 120, y: 80, w: 640, h: 440 }
/** The smallest frame (BROWSER_FRAME_MIN, src/renderer/canvas/nodes/browser-viewport.ts). */
const FRAME_MIN = { w: 360, h: 200 }

/**
 * A page for the frames of another window: a magenta square on a cream page, and where the last
 * click landed (`data-hit`): `square`, or `miss x,y` in the page's CSS px.
 */
const TARGET = `<!doctype html><title>Target</title><body style="margin:0;background:#fdf6e3" data-ready="yes">
<div id="square" style="position:absolute;left:900px;top:220px;width:120px;height:120px;background:#ff00ff"></div>
<script>document.addEventListener('click', (event) => { document.body.dataset.hit = event.target.id === 'square' ? 'square' : 'miss ' + event.clientX + ',' + event.clientY })</script>
</body>`
/** The frame's border and header, around and above the page (browserPageRect). */
const CHROME = { w: 2, h: 30 }

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
  server = createServer((request, response) => {
    if (request.url === '/target.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TARGET)
      return
    }
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
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-viewport-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const dataDir = () => join(scratch, 'data')
const layoutFile = () => join(dataDir(), PROJECT, 'layout.json')

/** Writes a Project whose Layout holds the Browser frame `FRAME` on its fixture page, with `data` added to the Node's. */
function seed(data: Record<string, unknown> = {}, url = pageUrl): void {
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const node = { ...FRAME, kind: 'browser', hidden: false, locked: false, pinned: false, tags: [], data: { url, ...data } }
  mkdirSync(join(dataDir(), PROJECT), { recursive: true })
  writeFileSync(join(dataDir(), 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(layoutFile(), JSON.stringify({ nodes: [node], viewport: { x: 0, y: 0, zoom: 1 } }))
}

/** Starts the app over the seeded data folder and waits for the fixture page in the <webview>. */
async function start(): Promise<Page> {
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir(), HOME: join(scratch, 'home') } })
  const { window } = launched
  await canvasReady(launched, { size: WINDOW, visible: [frameNode(window)] })
  await expect.poll(() => pageSize().then((size) => size !== null), { timeout: 15_000, message: 'the fixture page has loaded in the <webview>' }).toBe(true)
  return window
}

/** Runs `expression` in the one <webview> guest, read in main; null while there is none. */
async function inPage<T>(expression: string): Promise<T | null> {
  if (launched === undefined) return null
  return launched.app.evaluate(async ({ webContents }, expression) => {
    const guests = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview')
    if (guests.length !== 1) return null
    return (await guests[0]!.executeJavaScript(expression)) as T
  }, expression)
}

/** The fixture page's window size; null while there is no page or it has not run. */
const pageSize = () => inPage<{ innerWidth: number; innerHeight: number } | null>('document.body?.dataset.ready === undefined ? null : { innerWidth, innerHeight }')

/** The Browser Node as layout.json keeps it. */
function savedNode(): { w: number; h: number; data: Record<string, unknown> } {
  const layout = JSON.parse(readFileSync(layoutFile(), 'utf8')) as { nodes: { id: string; w: number; h: number; data: Record<string, unknown> }[] }
  const node = layout.nodes.find((each) => each.id === FRAME.id)
  if (node === undefined) throw new Error('layout.json has no Browser Node')
  return node
}

const frameNode = (window: Page) => window.locator(`.react-flow__node[data-id="${FRAME.id}"]`)

async function frameBox(window: Page): Promise<{ width: number; height: number }> {
  const box = await frameNode(window).boundingBox()
  if (!box) throw new Error('the Browser frame is not on screen')
  return { width: Math.round(box.width), height: Math.round(box.height) }
}

/** Copies a PNG into WORFY_EVIDENCE_DIR as 18-<name>.png, when the variable is set. */
function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `18-${name}.png`))
}

async function snapshots(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, name)
  evidence(shots.light, `${name}-light`)
  evidence(shots.dark, `${name}-dark`)
}

test('a Browser frame is resized by its handle: the page follows the body, and the size survives a restart', async () => {
  seed()
  let window = await start()
  expect(await pageSize()).toEqual({ innerWidth: FRAME.w - CHROME.w, innerHeight: FRAME.h - CHROME.h })
  await snapshots(window, 'browser-resize-before')

  // Selected by a press on the free right end of its header, then resized by the bottom-right handle.
  const header = frameNode(window).locator('.w-browser-frame__header')
  const headerBox = await header.boundingBox()
  if (!headerBox) throw new Error('no header')
  await header.click({ position: { x: headerBox.width - 16, y: headerBox.height / 2 } })
  const handle = frameNode(window).locator('.react-flow__resize-control.handle.bottom.right')
  await expect(handle).toBeVisible()
  const corner = await handle.boundingBox()
  if (!corner) throw new Error('no handle')
  await window.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
  await window.mouse.down()
  await window.mouse.move(corner.x + corner.width / 2 - 200, corner.y + corner.height / 2 - 100, { steps: 12 })
  await window.mouse.up()

  const resized = await frameBox(window)
  expect(resized.width).toBeLessThan(FRAME.w - 150)
  expect(resized.height).toBeLessThan(FRAME.h - 60)
  await expect.poll(pageSize, { message: 'the page follows the body of the resized frame' }).toEqual({ innerWidth: resized.width - CHROME.w, innerHeight: resized.height - CHROME.h })
  await snapshots(window, 'browser-resize-after')

  await launched!.close()
  launched = undefined
  expect(savedNode()).toMatchObject({ w: resized.width, h: resized.height })

  window = await start()
  expect(await frameBox(window)).toEqual(resized)
  expect(await pageSize()).toEqual({ innerWidth: resized.width - CHROME.w, innerHeight: resized.height - CHROME.h })
})

test('a Browser frame resized past its minimum stops at 360 × 200, where its header still fits', async () => {
  seed()
  const window = await start()
  const header = frameNode(window).locator('.w-browser-frame__header')
  const headerBox = await header.boundingBox()
  if (!headerBox) throw new Error('no header')
  await header.click({ position: { x: headerBox.width - 16, y: headerBox.height / 2 } })
  const corner = await frameNode(window).locator('.react-flow__resize-control.handle.bottom.right').boundingBox()
  if (!corner) throw new Error('no handle')
  await window.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
  await window.mouse.down()
  await window.mouse.move(corner.x - FRAME.w, corner.y - FRAME.h, { steps: 16 })
  await window.mouse.up()
  expect(await frameBox(window)).toEqual({ width: FRAME_MIN.w, height: FRAME_MIN.h })
  await expect.poll(pageSize).toEqual({ innerWidth: FRAME_MIN.w - CHROME.w, innerHeight: FRAME_MIN.h - CHROME.h })
  // The address bar and the sidebar's button are still inside the header.
  const bar = await frameNode(window).getByTestId('browser-address').boundingBox()
  const settings = await frameNode(window).getByTestId('browser-settings').boundingBox()
  expect(bar!.width).toBeGreaterThan(40)
  expect(settings!.x + settings!.width).toBeLessThanOrEqual(headerBox.x + FRAME_MIN.w)
})

test('the viewport set in the sidebar is the page\'s window size while the frame keeps its own; it survives a restart, and «Fit to card» undoes it', async () => {
  seed()
  let window = await start()
  const frame = await frameBox(window)

  await frameNode(window).getByTestId('browser-settings').click()
  const sidebar = frameNode(window).getByTestId('browser-sidebar')
  await expect(sidebar).toBeVisible()
  await sidebar.getByTestId('browser-viewport-1440x900').check()
  await expect.poll(pageSize, { message: 'the page is laid out at the viewport' }).toEqual({ innerWidth: 1440, innerHeight: 900 })
  expect(await frameBox(window)).toEqual(frame)
  // Only the size: the page keeps the window's devicePixelRatio under the scale, and no touch pointer.
  expect(await inPage<number>('devicePixelRatio')).toBe(await window.evaluate<number>('devicePixelRatio'))
  expect(await inPage<boolean>("matchMedia('(pointer: coarse)').matches")).toBe(false)
  await snapshots(window, 'browser-viewport-sidebar')

  // A size of its own, typed.
  await sidebar.getByTestId('browser-viewport-custom').check()
  await sidebar.getByTestId('browser-viewport-width').fill('1024')
  await sidebar.getByTestId('browser-viewport-height').fill('700')
  await sidebar.getByTestId('browser-viewport-apply').click()
  await expect.poll(pageSize).toEqual({ innerWidth: 1024, innerHeight: 700 })
  await sidebar.getByTestId('browser-sidebar-close').click()
  await expect(sidebar).toHaveCount(0)
  await snapshots(window, 'browser-viewport-custom')

  await launched!.close()
  launched = undefined
  expect(savedNode()).toMatchObject({ w: FRAME.w, h: FRAME.h, data: { viewport: { w: 1024, h: 700 } } })

  window = await start()
  expect(await pageSize()).toEqual({ innerWidth: 1024, innerHeight: 700 })
  expect(await frameBox(window)).toEqual(frame)

  await frameNode(window).getByTestId('browser-settings').click()
  await frameNode(window).getByTestId('browser-viewport-card').check()
  await expect.poll(pageSize, { message: '«Fit to card»: the page is the body again' }).toEqual({ innerWidth: FRAME.w - CHROME.w, innerHeight: FRAME.h - CHROME.h })
})

test('a second window fits the frames of a page whose viewport is wider than the body as the page lies, and a click on what it shows hits the same point', async () => {
  test.setTimeout(120_000)
  // 1280 × 400 in a 638 × 410 body: scaled by 638 / 1280, with an empty strip under the picture.
  seed({ viewport: { w: 1280, h: 400 } }, `${pageUrl.replace('/page.html', '/target.html')}`)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir(), HOME: join(scratch, 'home') } })
  const first = launched.window
  await canvasReady(launched, { size: WINDOW, visible: [frameNode(first)] })
  await expect.poll(() => inPage<string>('document.body?.dataset.ready ?? ""'), { timeout: 15_000 }).toBe('yes')
  expect(await inPage<number>('innerWidth')).toBe(1280)

  const second = await openSecondWindow(launched, { size: { width: 1100, height: 760 } })
  await canvasReady({ window: second }, { visible: [frameNode(second)] })
  const frames = frameNode(second).getByTestId('browser-frames')
  await expect(frames).toHaveAttribute('data-frame', 'shown', { timeout: 15_000 })
  // Where the square is in what the second window shows: the centre of its magenta pixels.
  const box = await frames.boundingBox()
  if (!box) throw new Error('no frames')
  const image = decodePng(await frames.screenshot())
  const scale = image.width / box.width
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4
      if (MAGENTA(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!) < 60) continue
      sx += x
      sy += y
      n += 1
    }
  }
  expect(n, 'the square shows in the frames').toBeGreaterThan(0)
  const shown = { x: sx / n / scale, y: sy / n / scale }
  // The picture lies from the top-left corner, as the page does: the square's centre (960, 280) at 638 / 1280.
  const fit = (FRAME.w - CHROME.w) / 1280
  expect(Math.abs(shown.x - 960 * fit)).toBeLessThan(4)
  expect(Math.abs(shown.y - 280 * fit)).toBeLessThan(4)

  await frames.click({ position: shown })
  await expect.poll(() => inPage<string>('document.body.dataset.hit ?? ""'), { timeout: 15_000, message: 'the click on the square in the frames hit the square' }).toBe('square')
})
