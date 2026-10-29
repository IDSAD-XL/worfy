import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// The resize of a Browser frame and the page viewport set apart from it (worfy-browser ticket 18,
// ADR-0087): the frame is resized by its handle like any Node, and its page follows the body; the
// settings sidebar gives the page a viewport of its own, which the page sees as its window size while
// the frame keeps its size on the Canvas. Both are in the Layout and survive a restart. The page is a
// local fixture (test/fixtures/browser/page.html) served on 127.0.0.1: no outside site, no sign-in.
// With WORFY_EVIDENCE_DIR set, the snapshots are copied there as 18-<name>.png.

const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')
const PROJECT = 'browser-00000018'
const WINDOW = { width: 1400, height: 900 }
const FRAME = { id: 'b1', x: 120, y: 80, w: 640, h: 440 }
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

/** Writes a Project whose Layout holds the Browser frame `FRAME` on its fixture page. */
function seed(): void {
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const node = { ...FRAME, kind: 'browser', hidden: false, locked: false, pinned: false, tags: [], data: { url: pageUrl } }
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

/** The fixture page's window size, read in main from the one <webview> guest; null while there is none or it has not run. */
async function pageSize(): Promise<{ innerWidth: number; innerHeight: number } | null> {
  if (launched === undefined) return null
  return launched.app.evaluate(async ({ webContents }) => {
    const guests = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview')
    if (guests.length !== 1) return null
    return (await guests[0]!.executeJavaScript('document.body?.dataset.ready === undefined ? null : { innerWidth, innerHeight }')) as { innerWidth: number; innerHeight: number } | null
  })
}

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
