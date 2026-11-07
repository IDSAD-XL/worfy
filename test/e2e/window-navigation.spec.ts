import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { ms } from '../time-scale'

// The main frame of the app window stays on the app's own address (audit-security-2026-11-07
// ticket 02, installWebPolicy of src/main/window.ts), against the real Electron: a page-started
// navigation of the window to a web page is refused in main, and a link dropped on the Canvas
// leaves the window where it is. A foreign page in the window would get the preload and every
// event main sends the window. The web page is a local server's, so the test needs no network.

let server: Server
let foreignUrl: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>foreign</title><p>a foreign page</p>')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  foreignUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/foreign.html`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-window-navigation-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

/** Starts the app over a Project with an empty Canvas. */
async function start(): Promise<Page> {
  const project = 'alpha-0000000e'
  const dataDir = join(scratch, 'data')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  mkdirSync(join(dataDir, project), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: project, name: 'alpha', path: repo }], activeId: project }))
  writeFileSync(join(dataDir, project, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: home } })
  await canvasReady(launched, { size: { width: 1400, height: 900 } })
  return launched.window
}

/** The address the app window shows, read in main. */
async function windowUrl(): Promise<string> {
  return launched!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL())
}

/**
 * Records in main what becomes of each main-frame navigation of the app window: `refused <url>` or
 * `allowed <url>` as the app's own will-frame-navigate listener, which runs before this one, has
 * answered it, and `loaded <url>` when a page commits. The list is read with `outcomes()`.
 */
async function recordOutcomes(): Promise<void> {
  await launched!.app.evaluate(({ BrowserWindow }) => {
    const seen: string[] = []
    ;(globalThis as { navigationOutcomes?: string[] }).navigationOutcomes = seen
    const contents = BrowserWindow.getAllWindows()[0]!.webContents
    contents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) seen.push(`${details.defaultPrevented ? 'refused' : 'allowed'} ${details.url}`)
    })
    contents.on('did-navigate', (_event, url) => seen.push(`loaded ${url}`))
  })
}

async function outcomes(): Promise<string[]> {
  return launched!.app.evaluate(() => [...((globalThis as { navigationOutcomes?: string[] }).navigationOutcomes ?? [])])
}

test('a page-started navigation of the app window to a web page is refused in main, and the window keeps the app', async () => {
  const window = await start()
  const appUrl = await windowUrl()
  await recordOutcomes()

  // What a link in the window, or a script that got into it, does: the window's own frame goes.
  await window.evaluate((url) => {
    ;(globalThis as unknown as { location: { href: string } }).location.href = url
  }, foreignUrl)

  await expect.poll(() => outcomes(), { timeout: ms(10_000), message: 'main has answered the navigation' }).not.toEqual([])
  expect(await outcomes()).toEqual([`refused ${foreignUrl}`])
  // The page still answers, on the app's address: the navigation was cancelled, not left pending.
  expect(await window.evaluate(() => (globalThis as unknown as { location: { href: string } }).location.href)).toBe(appUrl)
  expect(await windowUrl()).toBe(appUrl)
  expect(await outcomes()).toEqual([`refused ${foreignUrl}`])
  // Read through evaluate, not a locator: Playwright saw the navigation start and its locators wait
  // for an end that a cancelled navigation never reports to it.
  expect(await window.evaluate(() => (globalThis as unknown as { document: { querySelector(selector: string): unknown } }).document.querySelector('.react-flow') !== null)).toBe(true)
})

test('a link dropped on the Canvas does not change the page of the window', async () => {
  const window = await start()
  const appUrl = await windowUrl()
  await recordOutcomes()
  // The drop reaches the page: a listener of the test's own sees the drag over the Canvas.
  await window.evaluate(() => {
    const target = globalThis as unknown as { dragOvers: number; addEventListener(type: string, listener: () => void, capture: boolean): void }
    target.dragOvers = 0
    target.addEventListener('dragover', () => (target.dragOvers += 1), true)
  })

  const pane = (await window.locator('.react-flow__pane').boundingBox())!
  const at = { x: Math.round(pane.x + pane.width / 2), y: Math.round(pane.y + pane.height / 2) }
  // A drag from another app or from a Browser page, as Chromium gets it from the system: a link
  // (text/uri-list), copy, link and move allowed.
  const data = { items: [{ mimeType: 'text/uri-list', data: foreignUrl }, { mimeType: 'text/plain', data: foreignUrl }], dragOperationsMask: 1 | 2 | 16 }
  const cdp = await window.context().newCDPSession(window)
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data })
  await cdp.detach()

  expect(await window.evaluate(() => (globalThis as unknown as { dragOvers: number }).dragOvers)).toBeGreaterThan(0)
  // Anything the drop started has reached main by now (a navigation is asked for while the drop is
  // handled); a round trip through the page and through main once more to be sure.
  expect(await window.evaluate(() => (globalThis as unknown as { location: { href: string } }).location.href)).toBe(appUrl)
  expect(await windowUrl()).toBe(appUrl)
  // No navigation of the window was asked for, let alone made (Electron's navigateOnDragDrop is off).
  expect(await outcomes()).toEqual([])
  await expect(window.locator('.react-flow')).toBeVisible()
})
