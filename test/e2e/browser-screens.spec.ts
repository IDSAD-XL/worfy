import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// One Live page of a Browser for every window of its Project (worfy-browser ticket 07, ADR-0078
// item 16), in the real app: the first window draws the page; a second window of the Project shows
// the frames of that page (CDP `Page.startScreencast`) in the Browser's frame, and a click there
// reaches the page; once the user has worked in the second window, the page moves there — the first
// window shows the frames then — and there is never more than one page of the Browser. The page is
// a fixture on 127.0.0.1. The look of the frames in both themes is kept as the snapshot
// `browser-frames`; with WORFY_EVIDENCE_DIR set it is copied there as 07-browser-frames-<theme>.png.

const PROJECT = 'browser-00000007'
const NODE = 'b1'

let site: Server
let origin: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** A page with a wide button that counts its clicks into the address (`#clicked-N`), and goes on counting from there after a reload. */
const PAGE = `<!doctype html><title>Frames</title><body style="margin:0;font:28px sans-serif;background:#fdf6e3" data-ready="yes">
<button id="go" style="display:block;width:100%;height:240px;border:0;background:#268bd2;color:#fff;font-size:40px">Click me</button>
<p id="count" style="padding:16px">Not clicked</p>
<script>let n = Number(location.hash.replace('#clicked-', '')) || 0; document.getElementById('go').addEventListener('click', () => { n++; document.getElementById('count').textContent = 'Clicked ' + n; location.hash = 'clicked-' + n })</script>
</body>`

test.beforeAll(async () => {
  site = createServer((_request, response) => void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE))
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-screens-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `${name}.png`))
}

/** The addresses of every Browser page of the app — the guests of <webview>s — read in main. */
async function pages(): Promise<string[]> {
  return launched!.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
      .map((contents) => contents.getURL()),
  )
}

const frameOf = (window: Page): Locator => window.locator(`[data-testid="browser-frame"][data-node-id="${NODE}"]`)
const webviews = (window: Page): Promise<number> => window.locator(`webview[data-browser-id="${NODE}"]`).count()

test('a second window shows the frames of the Browser\'s one page, its click reaches the page, and the page moves to the window worked in', async () => {
  test.setTimeout(ms(120_000))
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  const dataDir = join(scratch, 'data')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const url = `${origin}/`
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(
    join(dataDir, PROJECT, 'layout.json'),
    JSON.stringify({ nodes: [{ id: NODE, kind: 'browser', x: 40, y: 40, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { url, profile: 'default' } }], viewport: { x: 0, y: 0, zoom: 1 } }),
  )
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: home } })
  const first = launched.window
  await canvasReady(launched, { size: { width: 1100, height: 760 }, visible: [frameOf(first)] })
  await expect.poll(pages, { timeout: ms(20_000), message: 'the first window draws the page' }).toEqual([url])
  await expect(frameOf(first)).toHaveAttribute('data-page', 'here')

  // The second window shows the frames of that page: no page of its own.
  const second = await openSecondWindow(launched, { size: { width: 1000, height: 700 } })
  await canvasReady({ window: second }, { visible: [frameOf(second)] })
  await expect(frameOf(second)).toHaveAttribute('data-page', 'frames', { timeout: ms(15_000) })
  const frames = frameOf(second).getByTestId('browser-frames')
  await expect(frames).toHaveAttribute('data-frame', 'shown', { timeout: ms(15_000) })
  expect(await webviews(second), 'no page in the second window').toBe(0)
  expect(await pages(), 'one page of the Browser').toEqual([url])

  // A click in the frames reaches the fixture page, as a click on the page itself.
  await frames.click({ position: { x: 200, y: 80 } })
  await expect.poll(pages, { timeout: ms(15_000), message: 'the page counted the click' }).toEqual([`${url}#clicked-1`])

  // The user worked in the second window: the page moves there, and the first one shows its frames.
  await expect(frameOf(second)).toHaveAttribute('data-page', 'here', { timeout: ms(15_000) })
  await expect.poll(() => webviews(second), { timeout: ms(15_000) }).toBe(1)
  await expect.poll(() => webviews(first), { timeout: ms(15_000) }).toBe(0)
  await expect(frameOf(first)).toHaveAttribute('data-page', 'frames')
  // It opened the address the page had reached, and is the one page of the Browser.
  await expect.poll(pages, { timeout: ms(20_000) }).toEqual([`${url}#clicked-1`])
  await expect(frameOf(first).getByTestId('browser-frames')).toHaveAttribute('data-frame', 'shown', { timeout: ms(15_000) })
  await canvasReady({ window: first })
  const shots = await snapshotThemes(first, 'browser-frames')
  evidence(shots.light, '07-browser-frames-light')
  evidence(shots.dark, '07-browser-frames-dark')

  // A click in the first window's frames reaches the moved page too.
  await frameOf(first).getByTestId('browser-frames').click({ position: { x: 200, y: 80 } })
  await expect.poll(pages, { timeout: ms(15_000), message: 'the second click reached the page' }).toEqual([`${url}#clicked-2`])
})
