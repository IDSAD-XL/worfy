import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// The Browser Node (worfy-browser ticket 02, ADR-0078): "New browser" in the Canvas menu makes an
// empty frame, an address typed into its address bar opens the page in the Browser layer, the
// address the page reaches is kept in the Node and opened again after a restart, and a second
// window of the Project shows the same Node. The owner's answers of worfy-browser ticket 10: the
// page keeps its cookies after a restart (a persist: partition per Project), back, forward and
// reload left of the address bar, a target="_blank" link and window.open open in the same Browser.
// The pages are local fixtures (test/fixtures/browser/) served by a server this file starts on
// 127.0.0.1: no outside site. With WORFY_EVIDENCE_DIR set, the snapshots are copied there as
// <ticket>-<name>.png.

const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const PROJECT = 'browser-0000000b'
const WINDOW = { width: 1400, height: 900 }

let server: Server
let origin: string
/** The same pages on a second origin (another port): a third-party frame. */
let otherServer: Server
let otherOrigin: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

const PAGES = new Set(['page.html', 'next.html', 'blank.html', 'framed.html', 'popper.html'])

/** A server of the fixture pages and nothing else. */
function fixtureServer(): Server {
  return createServer((request, response) => {
    const name = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1)
    if (!PAGES.has(name)) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(FIXTURES, name)))
  })
}

test.beforeAll(async () => {
  server = fixtureServer()
  otherServer = fixtureServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  await new Promise<void>((done) => otherServer.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  otherOrigin = `http://127.0.0.1:${(otherServer.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
  await new Promise<void>((done) => otherServer.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-node-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const dataDir = (): string => join(scratch, 'data')

/** Writes a Project whose Layout holds `nodes`, at zoom 1. */
function project(nodes: Record<string, unknown>[]): void {
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  mkdirSync(join(dataDir(), PROJECT), { recursive: true })
  writeFileSync(join(dataDir(), 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir(), PROJECT, 'layout.json'), JSON.stringify({ nodes: nodes.map((node) => ({ ...base, ...node })), viewport: { x: 0, y: 0, zoom: 1 } }))
}

/** Starts the app over the Project of `project()`; the data folder outlives the app, so a second start finds it again. */
async function start(): Promise<Page> {
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir(), HOME: join(scratch, 'home') } })
  await canvasReady(launched, { size: WINDOW })
  return launched.window
}

/** The Browser Nodes of the Layout main saved. */
function savedBrowsers(): { id: string; data: { url?: string } }[] {
  const file = join(dataDir(), PROJECT, 'layout.json')
  if (!existsSync(file)) return []
  const layout = JSON.parse(readFileSync(file, 'utf8')) as { nodes: { id: string; kind: string; data: { url?: string } }[] }
  return layout.nodes.filter((node) => node.kind === 'browser')
}

interface Guest {
  url: string
  ready: string | undefined
  moves: number
}

/** Every Browser page (the guest of a <webview>) of the app, read in main. */
async function guests(): Promise<Guest[]> {
  if (launched === undefined) return []
  return launched.app.evaluate(async ({ webContents }) => {
    const all = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
    return Promise.all(
      all.map(async (contents) => ({
        url: contents.getURL(),
        ...((await contents.executeJavaScript('({ ready: document.body?.dataset.ready, moves: Number(document.body?.dataset.moves ?? 0) })')) as { ready: string | undefined; moves: number }),
      })),
    )
  })
}

/** Runs `code` in the one Browser page at `url`, as after a click of the user unless `userGesture` is false. */
async function inGuest(url: string, code: string, userGesture = true): Promise<unknown> {
  return launched!.app.evaluate(
    async ({ webContents }, { url, code, userGesture }) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && contents.getURL() === url)
      if (!guest) throw new Error(`no Browser page at ${url}`)
      return guest.executeJavaScript(code, userGesture)
    },
    { url, code, userGesture },
  )
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The share of pixels in `box` (CSS px of the first window) that have the fixture page's cream
 * background, from main's capturePage() of the window: Playwright's screenshot (CDP) drops the last
 * CSS px of a <webview> page (worfy-browser ticket 01), capturePage shows what the window shows.
 */
async function creamShare(box: Box): Promise<number> {
  return launched!.app.evaluate(async ({ BrowserWindow }, box) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.webContents.getURL().includes('/renderer/index.html'))
    if (!window) throw new Error('no worfy window')
    const rect = { x: Math.ceil(box.x), y: Math.ceil(box.y), width: Math.floor(box.width) - 1, height: Math.floor(box.height) - 1 }
    const bitmap = (await window.webContents.capturePage(rect)).toBitmap()
    let cream = 0
    // BGRA; the page's background is #fdf6e3.
    for (let at = 0; at + 3 < bitmap.length; at += 4) {
      if (Math.abs(bitmap[at]! - 0xe3) <= 6 && Math.abs(bitmap[at + 1]! - 0xf6) <= 6 && Math.abs(bitmap[at + 2]! - 0xfd) <= 6) cream += 1
    }
    return cream / (bitmap.length / 4)
  }, box)
}

/** Copies a PNG into WORFY_EVIDENCE_DIR as <name>.png, when the variable is set. */
function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `${name}.png`))
}

/** The windows of the app, read in main. */
async function windowCount(): Promise<number> {
  return launched!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

/** The Browser pages as [address, ready] pairs. */
async function pageStates(): Promise<[string, string | undefined][]> {
  return (await guests()).map((guest) => [guest.url, guest.ready])
}

test('New browser from the Canvas menu opens the typed address; the address the page reaches survives a restart; a second window shows the same Node', async () => {
  project([])
  let window = await start()
  const pageUrl = `${origin}/page.html`
  const nextUrl = `${origin}/next.html`

  // The Canvas menu on the empty plane, below the Orchestrator's Node the app puts at the top left:
  // New browser makes an empty frame with an empty page.
  await window.mouse.click(560, 300, { button: 'right' })
  await window.getByRole('menuitem', { name: 'New browser' }).click()
  const frame = window.getByTestId('browser-frame')
  await expect(frame).toBeVisible()
  const address = frame.getByTestId('browser-address')
  await expect(address).toHaveValue('')
  await expect(address).toHaveAttribute('placeholder', 'Enter an address')
  await expect.poll(() => savedBrowsers().length, { message: 'main saved the new Browser' }).toBe(1)
  const id = savedBrowsers()[0]!.id
  expect(savedBrowsers()[0]!.data.url).toBeUndefined()
  await expect.poll(async () => (await guests()).map((guest) => guest.url), { message: 'the empty page' }).toEqual(['about:blank'])

  // The address typed and Enter: the page opens, the bar and the Node keep the address.
  await address.click()
  await address.fill(pageUrl)
  await address.press('Enter')
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000, message: 'the fixture page has loaded' }).toEqual([[pageUrl, 'yes']])
  await expect(address).toHaveValue(pageUrl)
  await expect.poll(() => savedBrowsers()[0]?.data.url, { message: 'the address is kept in the Node' }).toBe(pageUrl)

  // The page is seen in the frame's body.
  await canvasReady(launched!)
  const body = (await frame.getByTestId('browser-frame-body').boundingBox())!
  expect(await creamShare(body), 'the page fills the frame body').toBeGreaterThan(0.6)
  const shots = await snapshotThemes(window, 'browser-node')
  evidence(shots.light, '02-browser-node-light')
  evidence(shots.dark, '02-browser-node-dark')

  // The page goes on by itself: the bar shows where it is, the Node keeps that address.
  await inGuest(pageUrl, `location.href = ${JSON.stringify(nextUrl)}`)
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000 }).toEqual([[nextUrl, 'yes']])
  await expect(address).toHaveValue(nextUrl)
  await expect.poll(() => savedBrowsers()[0]?.data.url, { message: 'the address the page reached is kept' }).toBe(nextUrl)

  // A restart opens the same address again.
  await launched!.close()
  launched = undefined
  window = await start()
  await expect(window.getByTestId('browser-frame').getByTestId('browser-address')).toHaveValue(nextUrl)
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000, message: 'the page after the restart' }).toEqual([[nextUrl, 'yes']])

  // A second window of the Project (ADR-0053) shows the same Node, with its page.
  const second = await openSecondWindow(launched!)
  const secondFrame = second.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)
  await expect(secondFrame).toBeVisible({ timeout: 15_000 })
  await expect(secondFrame.getByTestId('browser-address')).toHaveValue(nextUrl)
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000, message: 'a page in each window' }).toEqual([
    [nextUrl, 'yes'],
    [nextUrl, 'yes'],
  ])
})

// worfy-browser ticket 01 found that a press begun outside a Browser frame did not keep the page
// off the mouse: only a Card set the press mark (frames-step-aside.ts). Here no Card is on the
// Canvas. The Note lies right next to the frame, and the pointer goes from the Note onto the page
// with its first move, before React Flow marks anything `dragging`, so only the press mark keeps
// the page from taking that move and the ones after it.
test('on a Canvas without a Card, a Note dragged across the page of a Browser follows the pointer to the release point, and the page gets no mouse move', async () => {
  const pageUrl = `${origin}/page.html`
  project([
    { id: 'b1', kind: 'browser', x: 300, y: 60, w: 480, h: 440, data: { url: pageUrl } },
    { id: 'n1', kind: 'note', x: 120, y: 240, w: 160, h: 100, data: { text: 'dragged across' } },
  ])
  const window = await start()
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000 }).toEqual([[pageUrl, 'yes']])
  expect(await window.locator('[data-testid="card-node"]').count(), 'no Card on the Canvas').toBe(0)

  const note = window.locator('.react-flow__node[data-id="n1"]')
  const header = (await note.locator('.w-note__header').boundingBox())!
  const body = (await window.getByTestId('browser-frame-body').boundingBox())!
  const onPage = { x: body.x + 40, y: header.y + header.height / 2 + 40 }
  const hit = await window.evaluate((point) => {
    const element = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { tagName: string } | null } }).document.elementFromPoint(point.x, point.y)
    return element?.tagName.toLowerCase() ?? null
  }, onPage)
  expect(hit, 'the page lies under the pointer where the first move goes').toBe('webview')

  const press = { x: header.x + header.width - 12, y: header.y + header.height / 2 }
  const release = { x: body.x + body.width + 260, y: onPage.y + 30 }
  const movesBefore = (await guests())[0]!.moves
  await window.mouse.move(press.x, press.y)
  await window.mouse.down()
  // The first move lands on the page; React Flow starts the drag on the first move it sees, so
  // where the Note is after it is where the rest of the gesture counts from.
  await window.mouse.move(onPage.x, onPage.y)
  const started = (await note.boundingBox())!
  // On across the page to the plane right of the frame.
  for (let step = 1; step <= 10; step += 1) {
    await window.mouse.move(onPage.x + ((release.x - onPage.x) * step) / 10, onPage.y + ((release.y - onPage.y) * step) / 10)
  }
  await window.mouse.up()
  await canvasReady(launched!)

  // The Note went the whole way with the pointer (within the 8 px grid it snaps to) and lies past the frame.
  const after = (await note.boundingBox())!
  expect(Math.abs(after.x - (started.x + release.x - onPage.x)), `the Note's left edge: ${after.x}`).toBeLessThanOrEqual(8)
  expect(Math.abs(after.y - (started.y + release.y - onPage.y)), `the Note's top edge: ${after.y}`).toBeLessThanOrEqual(8)
  expect(after.x, 'the Note lies right of the frame').toBeGreaterThan(body.x + body.width)
  expect((await guests())[0]!.moves - movesBefore, 'mouse moves the page got').toBe(0)
})

// worfy-browser ticket 10, question 1: the partition of a Project's Browsers is persist:, so a
// cookie the page sets is there again after a restart. Its data lives in the worfy data folder
// (Electron's userData), here the test's own temporary one.
test('a cookie the page sets is there again after a restart, kept in the Project\'s own partition inside the data folder', async () => {
  const pageUrl = `${origin}/page.html`
  project([{ id: 'b1', kind: 'browser', x: 300, y: 60, w: 480, h: 440, data: { url: pageUrl } }])
  await start()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[pageUrl, 'yes']])
  await inGuest(pageUrl, "document.cookie = 'kept=yes; max-age=86400; path=/'")
  expect(await inGuest(pageUrl, 'document.cookie')).toContain('kept=yes')
  const storage = await launched!.app.evaluate(({ webContents }) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
    return guest?.session.storagePath ?? null
  })
  expect(storage, 'the page is on a persist: partition, with storage on disk').not.toBeNull()
  expect(storage!.startsWith(dataDir()), `the partition's storage ${storage} is inside the data folder`).toBe(true)
  expect(storage!.endsWith('worfy-browser-0000000b-default'), `the partition of Project ${PROJECT}: ${storage}`).toBe(true)

  await launched!.close()
  launched = undefined
  const window = await start()
  await expect.poll(pageStates, { timeout: 15_000, message: 'the page after the restart' }).toEqual([[pageUrl, 'yes']])
  expect(await inGuest(pageUrl, 'document.cookie'), 'the cookie after the restart').toContain('kept=yes')
  await canvasReady(launched!)
  const body = (await window.getByTestId('browser-frame-body').boundingBox())!
  expect(await creamShare(body), 'the page is drawn in the frame').toBeGreaterThan(0.6)
})

// worfy-browser ticket 10, question 2: back, forward and reload left of the address bar; back and
// forward inactive when the page has nowhere to go that way.
test('back, forward and reload left of the address bar move the page through its history and are inactive at its ends', async () => {
  const pageUrl = `${origin}/page.html`
  const nextUrl = `${origin}/next.html`
  project([{ id: 'b1', kind: 'browser', x: 300, y: 60, w: 640, h: 440, data: { url: pageUrl } }])
  const window = await start()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[pageUrl, 'yes']])
  const frame = window.getByTestId('browser-frame')
  const address = frame.getByTestId('browser-address')
  const back = frame.getByRole('button', { name: 'Back' })
  const forward = frame.getByRole('button', { name: 'Forward' })
  const reload = frame.getByRole('button', { name: 'Reload' })

  // In this order, left of the address bar.
  const lefts = await Promise.all([back, forward, reload, address].map(async (element) => (await element.boundingBox())!.x))
  expect([...lefts].sort((a, b) => a - b), 'back, forward, reload, then the address bar').toEqual(lefts)

  // One page in the history: nowhere to go.
  await expect(reload).toBeEnabled()
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()

  // Reload loads the page again (its load mark changes) and adds nothing to the history.
  const firstLoad = await inGuest(pageUrl, 'document.body.dataset.load')
  await reload.click()
  const loadedAgain = async (): Promise<boolean> => {
    const load = await inGuest(pageUrl, 'document.body?.dataset.ready === "yes" ? document.body.dataset.load : null').catch(() => null)
    return typeof load === 'string' && load !== firstLoad
  }
  await expect.poll(loadedAgain, { timeout: 15_000, message: 'the page loaded again' }).toBe(true)
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()

  // The page goes on by a link: back is active, forward still not.
  await inGuest(pageUrl, `location.href = ${JSON.stringify(nextUrl)}`)
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[nextUrl, 'yes']])
  await expect(back).toBeEnabled()
  await expect(forward).toBeDisabled()
  await canvasReady(launched!)
  const shots = await snapshotThemes(window, 'browser-nav')
  evidence(shots.light, '10-browser-nav-light')
  evidence(shots.dark, '10-browser-nav-dark')

  // Back: the first page again, in the bar and the Node too; now only forward is active.
  await back.click()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[pageUrl, 'yes']])
  await expect(address).toHaveValue(pageUrl)
  await expect.poll(() => savedBrowsers()[0]?.data.url).toBe(pageUrl)
  await expect(back).toBeDisabled()
  await expect(forward).toBeEnabled()

  // Forward: the next page again; forward inactive at the end of the history.
  await forward.click()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[nextUrl, 'yes']])
  await expect(address).toHaveValue(nextUrl)
  await expect(back).toBeEnabled()
  await expect(forward).toBeDisabled()
})

// worfy-browser ticket 10, question 5: a target="_blank" link and window.open of the page open in
// the same Browser; no window appears and no second page.
test('a target="_blank" link and window.open of the page open in the same Browser, with no new window', async () => {
  const blankUrl = `${origin}/blank.html`
  const nextUrl = `${origin}/next.html`
  const pageUrl = `${origin}/page.html`
  project([{ id: 'b1', kind: 'browser', x: 300, y: 60, w: 640, h: 440, data: { url: blankUrl } }])
  const window = await start()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[blankUrl, 'yes']])
  expect(await windowCount()).toBe(1)
  const frame = window.getByTestId('browser-frame')

  await inGuest(blankUrl, "document.getElementById('blank').click()")
  await expect.poll(pageStates, { timeout: 15_000, message: 'the link opened in the same Browser' }).toEqual([[nextUrl, 'yes']])
  await expect(frame.getByTestId('browser-address')).toHaveValue(nextUrl)
  await expect.poll(() => savedBrowsers()[0]?.data.url).toBe(nextUrl)
  await expect(frame.getByRole('button', { name: 'Back' })).toBeEnabled()
  expect(await windowCount(), 'no new window').toBe(1)

  await frame.getByRole('button', { name: 'Back' }).click()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[blankUrl, 'yes']])
  await inGuest(blankUrl, "document.getElementById('open').click()")
  await expect.poll(pageStates, { timeout: 15_000, message: 'window.open opened in the same Browser' }).toEqual([[pageUrl, 'yes']])
  await expect(frame.getByTestId('browser-address')).toHaveValue(pageUrl)
  // A moment more for a late window: still one window and one page.
  await window.waitForTimeout(1_000)
  expect(await windowCount(), 'no new window').toBe(1)
  expect(await pageStates()).toEqual([[pageUrl, 'yes']])
})

// Review of PR #609: the window-open handler is not told which frame asks, nor whether the user
// clicked. A frame of another origin (an ad) that calls window.open on load must not replace the
// page; a window.open of the page's own origin with no click still opens in the same Browser, which
// shows that Electron lets a request without a user gesture through to main's handler, and so that
// the origin check is what keeps the third-party frame's request off the page.
test('a frame of another origin that calls window.open on load leaves the page where it is; the page\'s own window.open without a click opens in the same Browser', async () => {
  const framedUrl = `${origin}/framed.html?frame=${encodeURIComponent(`${otherOrigin}/popper.html`)}`
  const nextUrl = `${origin}/next.html`
  project([{ id: 'b1', kind: 'browser', x: 300, y: 60, w: 640, h: 440, data: { url: framedUrl } }])
  const window = await start()
  await expect.poll(pageStates, { timeout: 15_000 }).toEqual([[framedUrl, 'yes']])

  // The frame has loaded and called window.open, with no click.
  const frameAsked = (): Promise<unknown> =>
    launched!.app.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
      const frame = guest?.mainFrame.frames[0]
      return frame === undefined ? null : frame.executeJavaScript('document.body?.dataset.asked ?? null')
    })
  await expect.poll(frameAsked, { timeout: 15_000, message: 'the third-party frame asked for a window' }).toBe('yes')
  // A moment more for a late navigation: the page is still where it was, in one window.
  await window.waitForTimeout(1_500)
  expect(await pageStates(), 'the page did not leave its address').toEqual([[framedUrl, 'yes']])
  expect(await windowCount(), 'no new window').toBe(1)
  await expect(window.getByTestId('browser-frame').getByTestId('browser-address')).toHaveValue(framedUrl)

  // The page's own window.open, with no user gesture: Electron passes it to main's handler, and
  // the page goes to the address in the same Browser.
  await inGuest(framedUrl, "window.open('next.html')", false)
  await expect.poll(pageStates, { timeout: 15_000, message: 'the page\'s own window.open without a click' }).toEqual([[nextUrl, 'yes']])
  expect(await windowCount(), 'no new window').toBe(1)
})
