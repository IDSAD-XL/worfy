import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { BROWSER_PARTITION } from '../../src/shared/browser/partition'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'

// main's guard of the Browser's <webview> (worfy-browser ticket 02, ADR-0078 item 3), against the
// real Electron: a <webview> with a preload, with web security off, on another partition or on the
// app's own session does not attach; one on the Browser partition without a preload attaches and is drawn; its page gets
// no permission. This is the test to run when Electron is updated: the guard rests on Electron's
// `will-attach-webview` and on the permission handlers of a session, and an update that changes
// either shows here first. The <webview>s are put into the window's DOM by the test itself, as a
// page that got into the window could do.

const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const PROJECT = 'browser-0000000c'

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
    if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== '/page.html') {
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
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-webview-guard-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

/** Starts the app over a Project with an empty Canvas: no <webview> of its own. */
async function start(): Promise<Page> {
  const dataDir = join(scratch, 'data')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: home } })
  await canvasReady(launched, { size: { width: 1400, height: 900 } })
  return launched.window
}

/** Puts a <webview> with `attributes` into the window's DOM, fixed over the Canvas at `left`. */
async function insertWebview(window: Page, name: string, left: number, attributes: Record<string, string>): Promise<void> {
  await window.evaluate(
    ({ name, left, attributes }) => {
      interface Element {
        setAttribute(key: string, value: string): void
        style: { cssText: string }
      }
      const dom = (globalThis as unknown as { document: { createElement(tag: string): Element; body: { appendChild(element: Element): void } } }).document
      const element = dom.createElement('webview')
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
      element.setAttribute('data-guard', name)
      element.style.cssText = `position: fixed; left: ${left}px; top: 120px; width: 240px; height: 200px; z-index: 1000; display: flex;`
      dom.body.appendChild(element)
    },
    { name, left, attributes },
  )
}

/** The URL of every Browser page (the guest of a <webview>) of the app, read in main. */
async function guestUrls(): Promise<string[]> {
  return launched!.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
      .map((contents) => contents.getURL()),
  )
}

/** Runs `code` in the Browser page at `url`, as after a click (a user gesture). */
async function inGuest(url: string, code: string): Promise<unknown> {
  return launched!.app.evaluate(
    async ({ webContents }, { url, code }) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && contents.getURL() === url)
      if (!guest) throw new Error(`no Browser page at ${url}`)
      return guest.executeJavaScript(code, true)
    },
    { url, code },
  )
}

test('a <webview> with a preload, with web security off, on another partition or on the app session does not attach; one on the Browser partition attaches and is drawn', async () => {
  const window = await start()
  expect(await guestUrls()).toEqual([])
  const preload = pathToFileURL(join(FIXTURES, 'preload.js')).href
  // The refused ones first: the attach requests reach main in order, so once the good page is
  // there, main has answered every one before it.
  await insertWebview(window, 'preload', 20, { src: `${pageUrl}?preload`, partition: BROWSER_PARTITION, preload })
  await insertWebview(window, 'other-partition', 280, { src: `${pageUrl}?other`, partition: 'persist:not-a-browser' })
  await insertWebview(window, 'app-session', 540, { src: `${pageUrl}?app-session` })
  await insertWebview(window, 'no-web-security', 800, { src: `${pageUrl}?no-web-security`, partition: BROWSER_PARTITION, disablewebsecurity: '' })
  await insertWebview(window, 'good', 1060, { src: `${pageUrl}?good`, partition: BROWSER_PARTITION })

  const good = `${pageUrl}?good`
  await expect.poll(() => guestUrls(), { timeout: 15_000, message: 'the good <webview> has a page' }).toContain(good)
  await expect.poll(() => inGuest(good, 'document.body?.dataset.ready ?? null'), { timeout: 15_000 }).toBe('yes')
  // A moment more for anything late: still only the good page.
  await window.waitForTimeout(1_000)
  expect(await guestUrls()).toEqual([good])
  expect(await inGuest(good, 'document.body.dataset.preloaded ?? null'), 'no preload ran in the good page').toBeNull()

  // The good page is drawn: capturePage of the window at its box shows the page's cream background
  // (Playwright's screenshot drops the last CSS px of a <webview> page, worfy-browser ticket 01).
  const box = (await window.locator('webview[data-guard="good"]').boundingBox())!
  const share = await launched!.app.evaluate(async ({ BrowserWindow }, box) => {
    const main = BrowserWindow.getAllWindows()[0]!
    const bitmap = (await main.webContents.capturePage({ x: Math.ceil(box.x), y: Math.ceil(box.y), width: Math.floor(box.width) - 1, height: Math.floor(box.height) - 1 })).toBitmap()
    let cream = 0
    for (let at = 0; at + 3 < bitmap.length; at += 4) {
      if (Math.abs(bitmap[at]! - 0xe3) <= 6 && Math.abs(bitmap[at + 1]! - 0xf6) <= 6 && Math.abs(bitmap[at + 2]! - 0xfd) <= 6) cream += 1
    }
    return cream / (bitmap.length / 4)
  }, box)
  expect(share, 'the good page is drawn').toBeGreaterThan(0.5)
})

test('the page of a Browser gets no permission: notifications are denied, a permission check answers denied', async () => {
  const window = await start()
  const url = `${pageUrl}?permissions`
  await insertWebview(window, 'permissions', 20, { src: url, partition: BROWSER_PARTITION })
  await expect.poll(() => guestUrls(), { timeout: 15_000 }).toContain(url)
  await expect.poll(() => inGuest(url, 'document.body?.dataset.ready ?? null'), { timeout: 15_000 }).toBe('yes')

  expect(await inGuest(url, 'Notification.requestPermission()'), 'the request for notifications').toBe('denied')
  expect(await inGuest(url, 'Notification.permission'), 'the check of notifications').toBe('denied')
  expect(await inGuest(url, "navigator.permissions.query({ name: 'geolocation' }).then((status) => status.state)"), 'the check of geolocation').toBe('denied')
})
