import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { creamInside, decodePng, pagePixelsOutside, type Box, type Image } from './browser-pixels'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'

// A Browser in focus mode (worfy-browser ticket 17). The page of a Browser is a <webview> of the
// Browser layer on the Canvas (src/renderer/canvas/overlays/BrowserLayer.tsx); focus mode draws its
// tiles over the Canvas (src/renderer/focus/FocusMode.tsx). The page must show in the tile — the
// same <webview>, not a new page — take the mouse and the keys there, and go back into its frame
// on the Canvas with its history, scroll and typed text when focus mode closes.
// The page is the local fixture of the Browser layer test (test/fixtures/browser/page.html), served
// by a server this file starts on 127.0.0.1 at two addresses: no outside site.

const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const PROJECT = 'browser-0000000f'
const WINDOW = { width: 1400, height: 900 }
const FRAME = { id: 'b1', x: 120, y: 80, w: 640, h: 440 }
/** A Note on the Canvas that lies under the tile's lower part at both zooms: none of it may show over the page. */
const NOTE = { id: 'n1', kind: 'note', x: 800, y: 560, w: 400, h: 300, data: { text: 'under focus mode' } }
/** From this far down the tile's body (CSS px) the fixture page is only its cream: its text ends above. */
const PLAIN_FROM = 300
/** Larger than the corner radius of a Node (8 px, F-SPEC tokens). */
const CORNER = 12

let server: Server
let origin: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeAll(async () => {
  // The fixture page at two addresses, so the page has a history to go back through.
  server = createServer((request, response) => {
    if (request.url !== '/page.html' && request.url !== '/second.html' && request.url !== '/other.html') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(FIXTURES, 'page.html')))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-focus-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

interface StartOptions {
  /** More Nodes of the Layout. */
  extra?: Record<string, unknown>[]
  /** Cards of the Project: id → its index.html. */
  cards?: Record<string, string>
}

/** Starts the app over a Project whose Layout holds the Browser frame `FRAME` on the first address, `NOTE` and `extra`, the Canvas at `zoom`. */
async function start(zoom: number, { extra = [], cards = {} }: StartOptions = {}): Promise<Page> {
  const dataDir = join(scratch, 'data')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const nodes = [{ ...FRAME, kind: 'browser', ...base, data: { url: `${origin}/page.html` } }, { ...NOTE, ...base }, ...extra.map((node) => ({ ...base, ...node }))]
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  for (const [id, html] of Object.entries(cards)) {
    mkdirSync(join(dataDir, PROJECT, 'cards', id), { recursive: true })
    writeFileSync(join(dataDir, PROJECT, 'cards', id, 'index.html'), html)
  }
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 40, y: 20, zoom } }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: home } })
  const { window } = launched
  await canvasReady(launched, { size: WINDOW, visible: [window.locator(`.react-flow__node[data-id="${FRAME.id}"]`)] })
  await expect.poll(() => guestState('/page.html').then((state) => state?.ready), { timeout: 15_000, message: 'the fixture page has loaded in the <webview>' }).toBe('yes')
  return window
}

interface GuestState {
  ready: string | undefined
  /** New on every load of the page: a reload changes it. */
  load: string | undefined
  path: string
  scrollY: number
  innerWidth: number
  innerHeight: number
  /** What is typed in the field the test puts on the page; null without the field. */
  typed: string | null
  /** The id of the page's element with the keyboard focus. */
  active: string
  /** A value the test leaves in the page's script: it survives anything but a new page. */
  mark: string | null
  /** Mouse moves the page saw. */
  moves: number | null
}

/**
 * Runs `script` in a <webview> guest: the one whose address has the path `path`, or the only one
 * without `path`; null while there is none.
 */
async function inGuest<T>(script: string, path?: string): Promise<T | null> {
  if (launched === undefined) return null
  return launched.app.evaluate(
    async ({ webContents }, { code, at }) => {
      const guests = webContents
        .getAllWebContents()
        .filter((contents) => contents.getType() === 'webview' && (at === undefined || (URL.canParse(contents.getURL()) && new URL(contents.getURL()).pathname === at)))
      if (guests.length !== 1) return null
      return (await guests[0]!.executeJavaScript(code)) as T
    },
    { code: script, at: path },
  )
}

const guestState = (path?: string): Promise<GuestState | null> =>
  inGuest<GuestState>(
    "({ ready: document.body?.dataset.ready, load: document.body?.dataset.load, path: location.pathname, scrollY, innerWidth, innerHeight, typed: document.getElementById('field')?.value ?? null, active: document.activeElement?.id ?? '', mark: window.__mark ?? null, moves: Number(document.body?.dataset.moves ?? 0) })",
    path,
  )

/** Types `text` into the one <webview> guest as key presses of its own web contents. */
const typeInGuest = (text: string): Promise<void> =>
  launched!.app.evaluate(({ webContents }, chars) => {
    const [guest] = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview')
    for (const char of chars) {
      guest!.sendInputEvent({ type: 'keyDown', keyCode: char })
      guest!.sendInputEvent({ type: 'char', keyCode: char })
      guest!.sendInputEvent({ type: 'keyUp', keyCode: char })
    }
  }, text)

/** A field fixed at the page's top left (in its own CSS px), and a value in the page's script. */
const FIELD = { x: 40, y: 40, w: 220, h: 28 }
const putField = (): Promise<unknown> =>
  inGuest(
    `(() => { window.__mark = 'kept'; const field = document.createElement('input'); field.id = 'field'; field.style.cssText = 'position:fixed;left:${FIELD.x}px;top:${FIELD.y}px;width:${FIELD.w}px;height:${FIELD.h}px;box-sizing:border-box;'; document.body.append(field); return true })()`,
  )

/** What the window shows, decoded: main's capturePage() of the window (see browser-layer.spec.ts for why not page.screenshot()). */
async function screenshot(window: Page, name: string): Promise<{ image: Image; scale: number }> {
  const base64 = await launched!.app.evaluate(async ({ BrowserWindow }) => {
    const [main] = BrowserWindow.getAllWindows()
    return (await main!.webContents.capturePage()).toPNG().toString('base64')
  })
  const png = Buffer.from(base64, 'base64')
  // Kept with the run's results for a look (test-results/e2e/<test>/<name>.png).
  writeFileSync(test.info().outputPath(`${name}.png`), png)
  const image = decodePng(png)
  const innerWidth = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  return { image, scale: image.width / innerWidth }
}

/** The box of the first element matching `selector`, in CSS px; null when there is none. */
async function rectOf(window: Page, selector: string): Promise<Box | null> {
  return window.evaluate((query) => {
    const element = (globalThis as unknown as { document: { querySelector(s: string): { getBoundingClientRect(): Box } | null } }).document.querySelector(query)
    if (element === null) return null
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  }, selector)
}

/** The tag of the element under a point of the window. */
const hitAt = (window: Page, point: { x: number; y: number }): Promise<string | null> =>
  window.evaluate((at) => {
    const element = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { tagName: string; className: string } | null } }).document.elementFromPoint(at.x, at.y)
    return element === null ? null : element.tagName.toLowerCase() === 'webview' ? 'webview' : `${element.tagName.toLowerCase()}.${element.className}`
  }, point)

/** The largest gap between two boxes' edges, in CSS px. */
const boxGap = (a: Box, b: Box): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.width - (b.x + b.width)), Math.abs(a.y + a.height - (b.y + b.height)))

const WEBVIEW = `webview[data-browser-id="${FRAME.id}"]`
const TILE_BODY = `[data-testid="focus-tile"][data-node-id="${FRAME.id}"] [data-testid="browser-frame-body"]`
const CANVAS_BODY = `.react-flow__node[data-id="${FRAME.id}"] [data-testid="browser-frame-body"]`

function report(name: string, value: unknown): void {
  console.log(`[browser-focus] ${name}: ${JSON.stringify(value)}`)
}

/** Opens focus mode on the Browser: a click on the free right part of its header selects it, then the Focus button. */
async function openFocus(window: Page): Promise<void> {
  const header = (await window.locator(`.react-flow__node[data-id="${FRAME.id}"] .w-browser-frame__header`).boundingBox())!
  await window.mouse.click(header.x + header.width - 30, header.y + header.height / 2)
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
  await window.getByRole('button', { name: /^Focus/ }).click()
  await expect(window.getByTestId('focus-mode')).toBeVisible()
}

for (const zoom of [1, 0.5]) {
  test(`zoom ${zoom}: the page shows in the focus tile and takes input there, and goes back to its frame with its history, scroll and text`, async () => {
    const window = await start(zoom)
    await putField()
    const before = (await guestState())!
    await openFocus(window)
    const tile = window.locator(`[data-testid="focus-tile"][data-node-id="${FRAME.id}"]`)

    // The tile's address bar sends the page elsewhere: the same <webview>, the same page script.
    const address = tile.getByRole('textbox', { name: 'Address' })
    await address.fill(`${origin}/second.html`)
    await address.press('Enter')
    await expect.poll(async () => (await guestState())?.ready === 'yes' && (await guestState())?.path, { message: 'the page went to the second address' }).toBe('/second.html')
    await putField()

    // The page is seen in the tile: its pixels fill the tile's body, and none are outside it.
    await canvasReady(launched!, { frames: 5 })
    const body = (await rectOf(window, TILE_BODY))!
    const shot = await screenshot(window, 'in-tile')
    const cream = creamInside(shot.image, shot.scale, body, CORNER)
    const area = Math.floor((body.width - 2 * CORNER) * shot.scale) * Math.floor((body.height - 2 * CORNER) * shot.scale)
    const outside = pagePixelsOutside(shot.image, shot.scale, body)
    // Nothing of the Canvas under focus mode shows over the page: the Note, the Browser's own frame
    // and the Orchestrator's Node lie there, and the page's lower part is all cream.
    const plain = { x: body.x, y: body.y + PLAIN_FROM, width: body.width, height: body.height - PLAIN_FROM }
    const plainCream = creamInside(shot.image, shot.scale, plain, CORNER)
    const plainArea = (Math.floor((plain.y + plain.height) * shot.scale) - Math.ceil(CORNER * shot.scale) - Math.ceil(plain.y * shot.scale) - Math.ceil(CORNER * shot.scale)) * (Math.floor((plain.x + plain.width) * shot.scale) - Math.ceil(CORNER * shot.scale) - Math.ceil(plain.x * shot.scale) - Math.ceil(CORNER * shot.scale))
    const laidOut = (await guestState())!
    const middle = { x: body.x + body.width / 2, y: body.y + body.height / 2 }
    report(`zoom ${zoom} in the tile`, { body, page: await rectOf(window, WEBVIEW), hit: await hitAt(window, middle), creamShare: Math.round((cream / area) * 1000) / 1000, plainCreamShare: Math.round((plainCream / plainArea) * 10000) / 10000, pagePixelsOutsideTile: outside, guestViewport: [laidOut.innerWidth, laidOut.innerHeight] })
    // The fixture's text and edge line take some of the body; the cream is the most of it.
    expect(cream / area, 'the page is seen in the tile').toBeGreaterThan(0.8)
    expect(outside, 'no page pixels outside the tile body').toBe(0)
    expect(plainCream / plainArea, 'nothing of the Canvas over the page in the tile').toBeGreaterThan(0.995)
    // The page is laid out at the tile's size, one CSS px of the page per CSS px of the window.
    expect(Math.abs(laidOut.innerWidth - body.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(laidOut.innerHeight - body.height)).toBeLessThanOrEqual(1)
    expect(boxGap((await rectOf(window, WEBVIEW))!, body), 'the <webview> lies on the tile body').toBeLessThanOrEqual(1)

    // The mouse and the keys reach the page in the tile.
    expect(await hitAt(window, middle), 'the <webview> lies under the pointer in the tile').toBe('webview')
    await window.mouse.move(middle.x, middle.y)
    await window.mouse.wheel(0, 300)
    await expect.poll(async () => (await guestState())!.scrollY, { message: 'the wheel in the tile scrolls the page' }).toBeGreaterThan(0)
    await window.mouse.click(body.x + FIELD.x + 20, body.y + FIELD.y + FIELD.h / 2)
    await expect.poll(async () => (await guestState())!.active, { message: 'a click in the tile focuses the field on the page' }).toBe('field')
    // The keyboard focus of the window is in the page: its <webview> is the window's focused element.
    // (Whether the window itself has the focus of the system depends on the other e2e workers'
    // windows, so it is not asked.)
    expect(await window.evaluate(() => (globalThis as unknown as { document: { activeElement: { tagName: string } | null } }).document.activeElement?.tagName.toLowerCase())).toBe('webview')
    // Neither Playwright's keyboard nor the window's sendInputEvent reaches a <webview> guest, on the
    // Canvas either (tried while this test was written): the keys are sent to the page's own web
    // contents, into the field the click focused.
    await typeInGuest('typed in focus')
    await expect.poll(async () => (await guestState())!.typed, { message: 'the keys reach the page' }).toBe('typed in focus')
    const inTile = (await guestState())!

    // Out of focus mode: the same page in the frame on the Canvas, not loaded again.
    await window.getByRole('button', { name: /Exit focus/ }).click()
    await expect(window.getByTestId('focus-mode')).toHaveCount(0)
    await canvasReady(launched!, { frames: 5 })
    const canvasBody = (await rectOf(window, CANVAS_BODY))!
    await expect.poll(async () => boxGap((await rectOf(window, WEBVIEW))!, canvasBody), { message: 'the <webview> is back on the frame body' }).toBeLessThanOrEqual(1)
    const after = (await guestState())!
    report(`zoom ${zoom} after focus mode`, { before: before.load, inTile: inTile.load, after: after.load, scrollY: [inTile.scrollY, after.scrollY], typed: after.typed })
    expect(after.load, 'the page was not loaded again').toBe(inTile.load)
    expect(after.mark, 'the page script is the same').toBe('kept')
    expect(after.path).toBe('/second.html')
    expect(after.scrollY, 'the scroll is kept').toBe(inTile.scrollY)
    expect(after.typed, 'the typed text is kept').toBe('typed in focus')
    const back = await screenshot(window, 'back-on-canvas')
    expect(creamInside(back.image, back.scale, canvasBody, CORNER), 'the page is seen in its frame again').toBeGreaterThan(0)
    // «Back» on the frame goes to the address before focus mode.
    const backButton = window.locator(`.react-flow__node[data-id="${FRAME.id}"]`).getByRole('button', { name: 'Back' })
    await expect(backButton).toBeEnabled()
    await backButton.click()
    await expect.poll(async () => (await guestState())?.path, { message: '«Back» goes to the first address' }).toBe('/page.html')
  })
}

test('with a Note beside it the page follows its tile when the tiling changes, and the Note tile is drawn as usual', async () => {
  const window = await start(1)
  const header = (await window.locator(`.react-flow__node[data-id="${FRAME.id}"] .w-browser-frame__header`).boundingBox())!
  await window.mouse.click(header.x + header.width - 30, header.y + header.height / 2)
  await window.locator(`.react-flow__node[data-id="${NOTE.id}"] .w-note__header`).click({ modifiers: ['ControlOrMeta'] })
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)
  await window.getByRole('button', { name: /^Focus/ }).click()
  const focus = window.getByTestId('focus-mode')
  await expect(focus.getByTestId('focus-tile')).toHaveCount(2)

  const movesBefore = (await guestState())!.moves ?? 0
  const onBody = async (): Promise<number> => boxGap((await rectOf(window, WEBVIEW))!, (await rectOf(window, TILE_BODY))!)
  await expect.poll(onBody, { message: 'the page lies on its tile body' }).toBeLessThanOrEqual(1)
  const before = (await rectOf(window, TILE_BODY))!
  for (const preset of ['Rows', 'Columns']) {
    await focus.getByRole('button', { name: preset, exact: true }).click()
    await expect.poll(onBody, { message: `the page follows its tile after «${preset}»` }).toBeLessThanOrEqual(1)
  }
  await focus.getByRole('button', { name: 'Rows', exact: true }).click()
  await expect.poll(onBody).toBeLessThanOrEqual(1)
  const after = (await rectOf(window, TILE_BODY))!
  report('tiling change', { before, after })
  expect(boxGap(before, after), 'the tile moved or changed size').toBeGreaterThan(50)

  // A divider dragged over the page: the drag stays focus mode's, the page does not take the mouse.
  await focus.getByRole('button', { name: 'Columns', exact: true }).click()
  await expect.poll(onBody).toBeLessThanOrEqual(1)
  const divider = (await focus.getByTestId('focus-divider').boundingBox())!
  const wide = (await rectOf(window, TILE_BODY))!
  const from = { x: divider.x + divider.width / 2, y: divider.y + divider.height / 2 }
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  for (let step = 1; step <= 20; step += 1) await window.mouse.move(from.x - step * 15, from.y)
  await window.mouse.up()
  await expect.poll(async () => wide.width - (await rectOf(window, TILE_BODY))!.width, { message: 'the divider followed the mouse over the page' }).toBeGreaterThan(250)
  await expect.poll(onBody).toBeLessThanOrEqual(1)
  expect((await guestState())!.moves ?? 0, 'the page saw none of the drag').toBe(movesBefore)

  // Beside the Note the page is seen in its tile and takes the mouse there.
  await canvasReady(launched!, { frames: 5 })
  const body = (await rectOf(window, TILE_BODY))!
  const seen = await screenshot(window, 'beside-note')
  const area = Math.floor((body.width - 2 * CORNER) * seen.scale) * Math.floor((body.height - 2 * CORNER) * seen.scale)
  const share = creamInside(seen.image, seen.scale, body, CORNER) / area
  const middle = { x: body.x + body.width / 2, y: body.y + body.height / 2 }
  report('beside the Note', { body, creamShare: Math.round(share * 1000) / 1000, hit: await hitAt(window, middle) })
  expect(share, 'the page is seen in its tile beside the Note').toBeGreaterThan(0.8)
  expect(await hitAt(window, middle), 'the <webview> lies under the pointer in its tile').toBe('webview')
  await window.mouse.move(middle.x, middle.y)
  await window.mouse.wheel(0, 300)
  await expect.poll(async () => (await guestState())!.scrollY, { message: 'the wheel in the tile scrolls the page' }).toBeGreaterThan(0)

  // The Note's tile keeps its own background and its text; the Note takes the keys as before.
  const noteTile = focus.locator(`[data-testid="focus-tile"][data-node-id="${NOTE.id}"]`)
  const text = noteTile.getByRole('textbox', { name: 'Note text' })
  await expect(text).toHaveValue('under focus mode')
  await text.click()
  await window.keyboard.press('End')
  await window.keyboard.type(' and typed')
  await expect(text).toHaveValue('under focus mode and typed')
  const noteBox = (await noteTile.boundingBox())!
  const shot = await screenshot(window, 'with-note')
  expect(creamInside(shot.image, shot.scale, noteBox, CORNER), 'no page pixels in the Note tile').toBe(0)
})

/** A second Browser, left on the Canvas while focus mode shows the first. */
const OTHER = { id: 'b2', kind: 'browser', x: 900, y: 80, w: 400, h: 300 }
/** A Card whose script keeps asking for the keyboard focus. */
const GRABBER = { id: 'c1', kind: 'card', x: 520, y: 600, w: 260, h: 200, data: {} }
const GRABBER_HTML = `<!doctype html><html><body><input id="grab"><script>window.__grab = setInterval(() => document.getElementById('grab').focus(), 100)</script></body></html>`

/** Whether the guest on `path` is on screen for itself: its visibility, and how many animation frames it ran in half a second. */
const guestLiveness = (path: string): Promise<{ visibility: string; frames: number } | null> =>
  inGuest(
    `new Promise((done) => { let frames = 0; const start = performance.now(); const tick = () => { frames += 1; if (performance.now() - start < 500) requestAnimationFrame(tick); else done({ visibility: document.visibilityState, frames }) }; requestAnimationFrame(tick); setTimeout(() => done({ visibility: document.visibilityState, frames }), 1500) })`,
    path,
  )

/** A capture of the guest on `path` by its own web contents, as main takes a Session's screenshot and the picture of a sleep; null when it does not come within 3 s. */
async function guestCapture(path: string): Promise<Image | null> {
  const base64 = await launched!.app.evaluate(async ({ webContents }, at) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && URL.canParse(contents.getURL()) && new URL(contents.getURL()).pathname === at)
    if (guest === undefined) return null
    const shot = await Promise.race([guest.capturePage(), new Promise<null>((done) => setTimeout(() => done(null), 3000))])
    return shot === null || shot.isEmpty() ? null : shot.toPNG().toString('base64')
  }, path)
  return base64 === null ? null : decodePng(Buffer.from(base64, 'base64'))
}

/** How many screencast frames (CDP Page.startScreencast, as main's screencast.ts asks) the guest on `path` sends in a second while its page changes. */
async function guestScreencastFrames(path: string): Promise<number> {
  await inGuest("(() => { const tick = document.createElement('div'); tick.id = 'tick'; tick.style.cssText = 'position:fixed;left:8px;top:8px;'; document.body.append(tick); setInterval(() => { tick.textContent = String(performance.now()) }, 30); return true })()", path)
  return launched!.app.evaluate(async ({ webContents }, at) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && URL.canParse(contents.getURL()) && new URL(contents.getURL()).pathname === at)
    if (guest === undefined || guest.debugger.isAttached()) return -1
    const debug = guest.debugger
    debug.attach('1.3')
    let frames = 0
    const onMessage = (_event: unknown, method: string, params: { sessionId?: number }) => {
      if (method !== 'Page.screencastFrame') return
      frames += 1
      debug.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined)
    }
    debug.on('message', onMessage)
    try {
      await debug.sendCommand('Page.startScreencast', { format: 'jpeg', quality: 40, everyNthFrame: 1 })
      await new Promise((done) => setTimeout(done, 1000))
      await debug.sendCommand('Page.stopScreencast')
    } finally {
      debug.removeListener('message', onMessage)
      debug.detach()
    }
    return frames
  }, path)
}

/** The colour the test gives the second Browser's page, so that it is told apart from the first's cream. */
const BLUE = 'rgb(0, 128, 255)'
// The window's capture turns it into about rgb(59, 130, 246) on a Mac's colour profile.
const isBlue = (r: number, g: number, b: number): boolean => r < 100 && Math.abs(g - 129) < 35 && b > 200

/**
 * How many pixels of `image` lie inside an area of the second page's blue: the pixel and its eight
 * neighbours are all blue. Text antialiasing (ClearType on Windows) puts single bluish pixels on the
 * edges of dark text anywhere in the window; they are no page.
 */
function bluePixels(image: Image): number {
  const { width, height, data } = image
  const blue = new Uint8Array(width * height)
  for (let at = 0; at < width * height; at += 1) blue[at] = isBlue(data[at * 4]!, data[at * 4 + 1]!, data[at * 4 + 2]!) ? 1 : 0
  let solid = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let all = true
      for (let dy = -1; dy <= 1 && all; dy += 1) for (let dx = -1; dx <= 1 && all; dx += 1) all = blue[(y + dy) * width + x + dx] === 1
      if (all) solid += 1
    }
  }
  return solid
}

/** Where the keyboard focus of the window is: the focused element's tag, whether it is under focus mode's cover, and whether it is the <webview> in the tile. */
const windowFocus = (window: Page): Promise<{ tag: string; covered: boolean; tilePage: boolean }> =>
  window.evaluate((id) => {
    interface Found {
      tagName: string
      getAttribute(name: string): string | null
      closest(selector: string): Found | null
    }
    const active = (globalThis as unknown as { document: { activeElement: Found | null } }).document.activeElement
    return {
      tag: active?.tagName.toLowerCase() ?? '',
      covered: active?.closest('[data-focus-covered], [inert]') != null,
      tilePage: active?.tagName.toLowerCase() === 'webview' && active.getAttribute('data-browser-id') === id && active.closest('[data-under-focus="shown"]') !== null,
    }
  }, FRAME.id)

test('a Browser left on the Canvas stays on screen for itself under focus mode, and nothing under the layer takes the keyboard', async () => {
  const window = await start(1, { extra: [{ ...OTHER, data: { url: `${origin}/other.html` } }, GRABBER], cards: { c1: GRABBER_HTML } })
  await expect.poll(() => guestState('/other.html').then((state) => state?.ready), { timeout: 15_000, message: 'the second Browser has loaded' }).toBe('yes')
  await expect(window.locator(`.react-flow__node[data-id="${GRABBER.id}"] iframe`)).toHaveCount(1)
  await inGuest(`(() => { document.documentElement.style.background = '${BLUE}'; document.body.style.background = '${BLUE}'; return true })()`, '/other.html')
  await canvasReady(launched!, { frames: 5 })
  const blueOnCanvas = bluePixels((await screenshot(window, 'second-on-canvas')).image)
  const onCanvas = { liveness: await guestLiveness('/other.html'), frames: await guestScreencastFrames('/other.html'), blue: blueOnCanvas }
  expect(blueOnCanvas, 'the second Browser is seen on the Canvas').toBeGreaterThan(10_000)
  await openFocus(window)
  await canvasReady(launched!, { frames: 5 })
  await expect.poll(async () => boxGap((await rectOf(window, WEBVIEW))!, (await rectOf(window, TILE_BODY))!)).toBeLessThanOrEqual(1)
  // Under the layer the second Browser is not seen: not over the tile, nor anywhere else.
  const blueUnder = bluePixels((await screenshot(window, 'second-under-focus')).image)

  // The second Browser under the layer: visible to itself, drawing, captured, sending its frames.
  const liveness = await guestLiveness('/other.html')
  const capture = await guestCapture('/other.html')
  const frames = await guestScreencastFrames('/other.html')
  // The Card asks for the keyboard focus ten times a second: under the layer it never gets it.
  await new Promise((done) => setTimeout(done, 800))
  const afterCard = await windowFocus(window)
  // Tab from the layer: the keyboard focus never goes under the layer, but for the page in the tile.
  // The Card stops asking first: a focus it takes is given back a moment later, and Tab is asked alone.
  const stopped = await launched!.app.evaluate(async ({ BrowserWindow }) => {
    const frame = BrowserWindow.getAllWindows()[0]!.webContents.mainFrame.framesInSubtree.find((each) => each.url.startsWith('worfy-card:'))
    return frame === undefined ? false : ((await frame.executeJavaScript('clearInterval(window.__grab), true')) as boolean)
  })
  expect(stopped, 'the Card stopped asking for the focus').toBe(true)
  await window.getByTestId('focus-mode').focus()
  const tabbed: { tag: string; covered: boolean; tilePage: boolean }[] = []
  for (let press = 0; press < 20; press += 1) {
    await window.keyboard.press('Tab')
    tabbed.push(await windowFocus(window))
  }
  report('under focus mode', { onCanvas, liveness, blueUnder, captureBlue: capture === null ? null : Math.round((bluePixels(capture) / (capture.width * capture.height)) * 1000) / 1000, frames, afterCard, tabbedUnder: tabbed.filter((each) => each.covered) })
  expect(liveness?.visibility, 'the second Browser is visible to itself').toBe('visible')
  // Invisible under the layer, its animation frames may be throttled (a few a second), never stopped.
  expect(liveness?.frames, 'the second Browser runs its animation frames').toBeGreaterThan(0)
  expect(capture, 'the second Browser can be captured').not.toBeNull()
  expect(bluePixels(capture!) / (capture!.width * capture!.height), 'the capture shows its page').toBeGreaterThan(0.5)
  expect(blueUnder, 'the second Browser is not seen under focus mode').toBe(0)
  expect(frames, 'the second Browser sends screencast frames').toBeGreaterThan(3)
  expect(afterCard.covered && !afterCard.tilePage, `the Card under the layer took the keyboard focus (${afterCard.tag})`).toBe(false)
  for (const each of tabbed) expect(each.covered && !each.tilePage, `Tab went under the layer (${each.tag})`).toBe(false)
})

test('two Browsers in tiles: each page lies on its own tile and is seen there', async () => {
  const window = await start(1, { extra: [{ ...OTHER, data: { url: `${origin}/other.html` } }] })
  await expect.poll(() => guestState('/other.html').then((state) => state?.ready), { timeout: 15_000, message: 'the second Browser has loaded' }).toBe('yes')
  const header = (await window.locator(`.react-flow__node[data-id="${FRAME.id}"] .w-browser-frame__header`).boundingBox())!
  await window.mouse.click(header.x + header.width - 30, header.y + header.height / 2)
  const otherHeader = window.locator(`.react-flow__node[data-id="${OTHER.id}"] .w-browser-frame__header`)
  const otherBox = (await otherHeader.boundingBox())!
  await otherHeader.click({ position: { x: otherBox.width - 30, y: otherBox.height / 2 }, modifiers: ['ControlOrMeta'] })
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)
  await window.getByRole('button', { name: /^Focus/ }).click()
  const focus = window.getByTestId('focus-mode')
  await expect(focus.getByTestId('focus-tile')).toHaveCount(2)

  const bodyOf = (id: string): string => `[data-testid="focus-tile"][data-node-id="${id}"] [data-testid="browser-frame-body"]`
  const gaps = async (): Promise<number[]> => {
    const result: number[] = []
    for (const id of [FRAME.id, OTHER.id]) result.push(boxGap((await rectOf(window, `webview[data-browser-id="${id}"]`))!, (await rectOf(window, bodyOf(id)))!))
    return result
  }
  await expect.poll(async () => Math.max(...(await gaps())), { message: 'each page lies on its own tile body' }).toBeLessThanOrEqual(1)
  await canvasReady(launched!, { frames: 5 })
  const shot = await screenshot(window, 'two-browsers')
  const shares: number[] = []
  for (const id of [FRAME.id, OTHER.id]) {
    const body = (await rectOf(window, bodyOf(id)))!
    const area = Math.floor((body.width - 2 * CORNER) * shot.scale) * Math.floor((body.height - 2 * CORNER) * shot.scale)
    shares.push(creamInside(shot.image, shot.scale, body, CORNER) / area)
  }
  report('two Browsers', { gaps: await gaps(), shares })
  for (const share of shares) expect(share, 'each page is seen in its tile').toBeGreaterThan(0.8)
})
