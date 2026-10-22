import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// Live and Asleep Browsers (worfy-browser ticket 05, ADR-0078 items 6, 7 and 15), in the real app:
// - at most three Browsers are Live: a fourth one opened from the Canvas menu puts to sleep the
//   Browser used longest ago — not the one with the first id, not the newest — and its frame shows
//   the picture of its page under «Asleep · Click to wake»; a click wakes it on the same address,
//   scrolled where it was, and puts the next one used longest ago to sleep;
// - a page with a beforeunload handler (added with addEventListener, or set as onbeforeunload) does
//   not sleep and its frame says «Unsaved changes»; a page without one sleeps once it has been off
//   the screen longer than the threshold (here 3 s, set in app-settings.json).
// main decides from what the window reports (src/main/browser/live.ts); a page is a guest
// <webview> read in main. With WORFY_EVIDENCE_DIR set, the snapshots are copied there as
// 05-browser-asleep-<theme>.png and 05-browser-unsaved-<theme>.png.

const PROJECT = 'browser-00000005'
const WINDOW = { width: 1500, height: 950 }

let site: Server
let origin: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** A cream page three thousand pixels long, so it can be scrolled. */
const page = (title: string, script = ''): string =>
  `<!doctype html><title>${title}</title><body style="margin:0;padding:16px;font:24px sans-serif;background:#fdf6e3;height:3000px" data-ready="yes"><h1>${title}</h1>${Array.from({ length: 30 }, (_, at) => `<p>${title}, line ${at + 1}</p>`).join('')}<script>${script}</script></body>`

test.beforeAll(async () => {
  site = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const html = (body: string) => void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body)
    if (url.pathname === '/unsaved') return html(page('Unsaved form', "addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })"))
    if (url.pathname === '/unsaved-attr') return html(page('Unsaved attribute', "window.onbeforeunload = () => 'Leave?'"))
    html(page(`Page ${url.searchParams.get('n') ?? '0'}`))
  })
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-sleep-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const dataDir = (): string => join(scratch, 'data')

/** A Project whose Layout holds Browsers `nodes` under its one Browser profile, Default, at `zoom`; the app settings `settings`. */
async function start(nodes: { id: string; x: number; y: number; w?: number; h?: number; url: string }[], zoom: number, settings: Record<string, unknown> = {}): Promise<Page> {
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const layout = nodes.map(({ id, x, y, w = 640, h = 440, url }) => ({ ...base, id, kind: 'browser', x, y, w, h, data: { url, profile: 'default' } }))
  mkdirSync(join(dataDir(), PROJECT), { recursive: true })
  writeFileSync(join(dataDir(), 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir(), PROJECT, 'layout.json'), JSON.stringify({ nodes: layout, viewport: { x: 0, y: 0, zoom } }))
  writeFileSync(join(dataDir(), 'app-settings.json'), JSON.stringify(settings))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir(), HOME: home } })
  await canvasReady(launched, { size: WINDOW })
  return launched.window
}

interface Guest {
  url: string
  ready: string | undefined
  scrollY: number
}

/** Every Browser page of the app — the guest of a <webview> — read in main, by address. */
async function guests(): Promise<Guest[]> {
  if (launched === undefined) return []
  const all = await launched.app.evaluate(async ({ webContents }) => {
    const pages = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
    return Promise.all(
      pages.map(async (contents) => ({
        url: contents.getURL(),
        ...((await contents.executeJavaScript('({ ready: document.body?.dataset.ready, scrollY: Math.round(scrollY) })').catch(() => ({ ready: undefined, scrollY: -1 }))) as { ready: string | undefined; scrollY: number }),
      })),
    )
  })
  return all.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
}
const urls = async (): Promise<string[]> => (await guests()).map((guest) => guest.url)

/** Runs `code` in the Browser page at `url`. */
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

const frame = (window: Page, id: string): Locator => window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)

/** Whether the picture of the Asleep frame `id` holds the cream of the fixture page: the canvas's own pixels, under no CSS filter. */
async function pictureIsThePage(window: Page, id: string): Promise<boolean> {
  // A string: the e2e tests are typed without the DOM.
  return window.evaluate(`(() => {
    const canvas = document.querySelector('[data-node-id="${id}"] [data-testid="browser-picture"]')
    if (canvas === null || canvas.width === 0) return false
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let cream = 0
    for (let at = 0; at + 3 < pixels.length; at += 4) {
      if (Math.abs(pixels[at] - 0xfd) <= 8 && Math.abs(pixels[at + 1] - 0xf6) <= 8 && Math.abs(pixels[at + 2] - 0xe3) <= 8) cream += 1
    }
    return cream / (pixels.length / 4) > 0.5
  })()`)
}

/** A click of the user into the page of frame `id`: main sees the press on the page and marks the Browser used. */
async function usePage(window: Page, id: string): Promise<void> {
  const body = (await frame(window, id).getByTestId('browser-frame-body').boundingBox())!
  await window.mouse.click(body.x + body.width / 2, body.y + body.height - 20)
  // Apart in time from the next use: the order of uses is what the test is about.
  await window.waitForTimeout(1_200)
}

/** Copies a PNG into WORFY_EVIDENCE_DIR as <name>.png, when the variable is set. */
function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `${name}.png`))
}

test('four Browsers: three are Live, the fourth puts to sleep the one used longest ago; a click wakes it on the same address and scroll', async () => {
  const at = (n: number) => `${origin}/page?n=${n}`
  // At zoom 0.5 the three frames and a fourth one fit in the window.
  const window = await start(
    [
      { id: 'b1', x: 40, y: 40, url: at(1) },
      { id: 'b2', x: 740, y: 40, url: at(2) },
      { id: 'b3', x: 40, y: 560, url: at(3) },
    ],
    0.5,
  )
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000, message: 'three Live pages' }).toEqual([
    [at(1), 'yes'],
    [at(2), 'yes'],
    [at(3), 'yes'],
  ])
  for (const id of ['b1', 'b2', 'b3']) await expect(frame(window, id)).toHaveAttribute('data-life', 'live')

  // b2 is left alone, scrolled down; b1, then b3, are used. b2 is the one used longest ago, though b1 has the first id.
  await inGuest(at(2), 'scrollTo(0, 600)')
  await expect.poll(async () => (await guests()).find((guest) => guest.url === at(2))?.scrollY).toBe(600)
  await usePage(window, 'b1')
  await usePage(window, 'b3')

  // A fourth Browser from the Canvas menu, on the empty plane right of b3.
  const empty = (await frame(window, 'b3').boundingBox())!
  await window.mouse.click(empty.x + empty.width + 120, empty.y + 40, { button: 'right' })
  await window.getByRole('menuitem', { name: 'New browser' }).click()
  await expect(window.getByTestId('browser-frame')).toHaveCount(4)
  await expect(frame(window, 'b2')).toHaveAttribute('data-life', 'asleep', { timeout: 10_000 })
  await expect.poll(urls, { timeout: 15_000, message: 'b2\'s page is closed, the new one is open' }).toEqual(['about:blank', at(1), at(3)])
  for (const id of ['b1', 'b3']) await expect(frame(window, id)).toHaveAttribute('data-life', 'live')

  // Asleep: the picture of its page under «Asleep · Click to wake».
  const asleep = frame(window, 'b2').getByTestId('browser-asleep')
  await expect(asleep).toBeVisible()
  await expect(asleep).toContainText('Asleep')
  await expect(asleep).toContainText('Click to wake')
  await expect.poll(() => pictureIsThePage(window, 'b2'), { message: 'the frame shows the picture of the page' }).toBe(true)
  await canvasReady(launched!)
  const shots = await snapshotThemes(window, 'browser-asleep')
  evidence(shots.light, '05-browser-asleep-light')
  evidence(shots.dark, '05-browser-asleep-dark')

  // A click wakes it on the same address, scrolled where it was; b1, now the one used longest ago, sleeps.
  await asleep.click()
  await expect(frame(window, 'b2')).toHaveAttribute('data-life', 'live', { timeout: 10_000 })
  await expect(frame(window, 'b1')).toHaveAttribute('data-life', 'asleep', { timeout: 10_000 })
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000, message: 'b2 Live again, b1 asleep' }).toEqual([
    ['about:blank', undefined],
    [at(2), 'yes'],
    [at(3), 'yes'],
  ])
  await expect.poll(async () => (await guests()).find((guest) => guest.url === at(2))?.scrollY, { timeout: 15_000, message: 'b2 is scrolled where it went to sleep' }).toBe(600)
  await expect(frame(window, 'b2').getByTestId('browser-address')).toHaveValue(at(2))
})

test('a page with a beforeunload handler stays Live and says «Unsaved changes»; a page off the screen sleeps after the threshold', async () => {
  const window = await start(
    [
      { id: 'u1', x: 60, y: 60, w: 420, h: 320, url: `${origin}/unsaved` },
      { id: 'u2', x: 520, y: 60, w: 420, h: 320, url: `${origin}/unsaved-attr` },
      { id: 'p3', x: 980, y: 60, w: 420, h: 320, url: `${origin}/page?n=3` },
    ],
    1,
    { browserSleep: { offscreenSeconds: 3 } },
  )
  const all = [`${origin}/page?n=3`, `${origin}/unsaved`, `${origin}/unsaved-attr`]
  await expect.poll(async () => (await guests()).map((guest) => [guest.url, guest.ready]), { timeout: 15_000 }).toEqual(all.map((url) => [url, 'yes']))

  // The three frames leave the screen, panned away over the empty plane.
  await window.mouse.move(700, 800)
  let panned = 0
  while ((await window.getByTestId('browser-frame').count()) > 0) {
    await window.mouse.wheel(600, 0)
    panned += 600
    expect(panned, 'the frames leave the screen').toBeLessThan(20_000)
  }
  const left = Date.now()
  // Under the threshold every page is still there.
  expect(await urls()).toEqual(all)

  await expect.poll(urls, { timeout: 15_000, message: 'the page without a handler sleeps' }).toEqual([`${origin}/unsaved`, `${origin}/unsaved-attr`])
  expect(Date.now() - left, 'not before the threshold of 3 s').toBeGreaterThanOrEqual(2_500)
  // Twice the threshold later, the pages with a handler are still Live.
  await window.waitForTimeout(6_000)
  expect(await urls()).toEqual([`${origin}/unsaved`, `${origin}/unsaved-attr`])

  // Back on the screen: «Unsaved changes» on both, the third Asleep with the picture of its page.
  await window.mouse.wheel(-panned, 0)
  await expect(window.getByTestId('browser-frame')).toHaveCount(3)
  for (const id of ['u1', 'u2']) {
    await expect(frame(window, id)).toHaveAttribute('data-life', 'live')
    await expect(frame(window, id).getByTestId('browser-unsaved')).toHaveText('Unsaved changes')
  }
  await expect(frame(window, 'p3')).toHaveAttribute('data-life', 'asleep')
  await expect(frame(window, 'p3').getByTestId('browser-unsaved')).toHaveCount(0)
  await expect.poll(() => pictureIsThePage(window, 'p3'), { message: 'the picture of a page that slept off the screen' }).toBe(true)
  await canvasReady(launched!)
  const shots = await snapshotThemes(window, 'browser-unsaved')
  evidence(shots.light, '05-browser-unsaved-light')
  evidence(shots.dark, '05-browser-unsaved-dark')
})
