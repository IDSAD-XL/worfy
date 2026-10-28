// A Browser of a Linked machine's Project (worfy-browser ticket 07; ADR-0078 items 9 and 14,
// ADR-0066) on two built worfy, A and B, linked through the UI. The Browser runs on B, the Machine
// of the Project; A shows it:
// - with full access, A's frame shows the frames of B's page, and A's click and keys reach the page:
//   what A types lands in the page's input on B; an Asleep Browser shows the picture of its page;
// - read-only, A's frame shows only the name of the Browser profile: no address bar and no address
//   anywhere on it, no frames, and no picture of the Asleep Browser.
// The page is a fixture on 127.0.0.1, served by this test.
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, type LaunchedApp } from './helpers'

test.setTimeout(180_000)

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const SIZE = { width: 1400, height: 900 }

/** A page with a tall input at its top, and a cream rest. */
const PAGE = `<!doctype html><title>Linked</title><body style="margin:0;font:28px sans-serif;background:#fdf6e3" data-ready="yes">
<input id="typed" style="display:block;box-sizing:border-box;width:100%;height:200px;font-size:40px" placeholder="Type here">
<p style="padding:16px">A page of B</p></body>`

let site: Server
let origin: string

test.beforeAll(async () => {
  site = createServer((_request, response) => void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE))
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()))
})

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

/** B: Project `beta` with two Browsers on the fixture page, and one Live Browser at a time. */
function prepareB(scratch: string, url: string): Record<string, string> {
  const repo = join(scratch, 'beta')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  const dataDir = dataFolder(join(scratch, 'b-data'), [{ id: BETA, name: 'beta', path: realpathSync.native(repo) }])
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  mkdirSync(join(dataDir, BETA), { recursive: true })
  writeFileSync(
    join(dataDir, BETA, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'b1', kind: 'browser', x: 40, y: 40, w: 560, h: 400, ...base, data: { url, profile: 'default' } },
        { id: 'b2', kind: 'browser', x: 660, y: 40, w: 560, h: 400, ...base, data: { url: `${url}?second`, profile: 'default' } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
  )
  writeFileSync(join(dataDir, 'app-settings.json'), JSON.stringify({ browserSleep: { maxLive: 1 } }))
  const home = join(scratch, 'b-home')
  mkdirSync(home, { recursive: true })
  return { WORFY_DATA_DIR: dataDir, HOME: home }
}

const frameOf = (window: Page, id: string): Locator => window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)

/** What the input of B's page holds, read in B's main. */
async function typedOnB(b: LaunchedApp): Promise<string | null> {
  return b.app.evaluate(async ({ webContents }) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && !contents.isDestroyed() && !contents.getURL().includes('?second'))
    return guest === undefined ? null : ((await guest.executeJavaScript("document.getElementById('typed')?.value ?? null")) as string | null)
  })
}

test('a Browser of B: full access shows its frames and types in its page; read-only shows only the frame with the profile name', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-browser-07-linked-')))
  const alpha = join(scratch, 'alpha')
  mkdirSync(alpha, { recursive: true })
  git(alpha, 'init', '-q')
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: ALPHA, name: 'alpha', path: realpathSync.native(alpha) }])
  const url = `${origin}/`
  const bEnv = prepareB(scratch, url)
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bEnv })
    await canvasReady(b, { size: SIZE, visible: [frameOf(b.window, 'b1')] })
    await canvasReady(a, { size: SIZE })
    // B draws the page of b1; b2 waits Asleep (one Live Browser at a time).
    await expect(frameOf(b.window, 'b1')).toHaveAttribute('data-page', 'here', { timeout: 20_000 })
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)

    // On B: access on, full for A.
    const settings = await openMachinesSettings(b)
    await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'all')
    await closeSettings(b.window)

    // A opens beta of B: b1's frame shows the frames of B's page, and A has no page of its own.
    const betaRow = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"] [data-testid="project-row"][data-project-id="${BETA}"]`)
    await betaRow.getByRole('button').click({ timeout: 20_000 })
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    const b1 = frameOf(a.window, 'b1')
    await canvasReady(a, { visible: [b1] })
    await expect(b1).toHaveAttribute('data-page', 'frames', { timeout: 20_000 })
    const frames = b1.getByTestId('browser-frames')
    await expect(frames).toHaveAttribute('data-frame', 'shown', { timeout: 20_000 })
    expect(await a.window.locator('webview').count(), 'A draws no page of B').toBe(0)
    expect(await a.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview').length), 'A has no page of B in main').toBe(0)

    // A clicks into the page's input and types: the text lands in B's page.
    await frames.click({ position: { x: 200, y: 60 } })
    await a.window.keyboard.type('hello')
    await expect.poll(() => typedOnB(b!), { timeout: 15_000, message: 'what A typed reached B\'s page' }).toBe('hello')

    // On B, b2 is woken by a click: b1 goes to sleep with a picture, which A with full access sees.
    await frameOf(b.window, 'b2').getByTestId('browser-asleep').click()
    await expect(frameOf(b.window, 'b1')).toHaveAttribute('data-life', 'asleep', { timeout: 20_000 })
    await expect(b1.getByTestId('browser-asleep')).toBeVisible({ timeout: 20_000 })
    await expect(b1.getByTestId('browser-picture')).toHaveCount(1, { timeout: 20_000 })

    // Read only for A: only the frame and the name of its Browser profile.
    const again = await openMachinesSettings(b)
    await chooseLevel(b.window, again.getByTestId(`link-machine-access-${aId}`), 'read')
    await closeSettings(b.window)
    await expect(a.window.getByTestId('canvas-read-only')).toBeVisible({ timeout: 20_000 })
    for (const id of ['b1', 'b2']) {
      const frame = frameOf(a.window, id)
      await expect(frame.getByTestId('browser-profile-name')).toHaveText('Default', { timeout: 20_000 })
      await expect(frame.getByTestId('browser-address')).toHaveCount(0)
      await expect(frame.getByTestId('browser-frames')).toHaveCount(0)
      await expect(frame.getByTestId('browser-asleep')).toHaveCount(0)
      await expect(frame.getByTestId('browser-picture')).toHaveCount(0)
      await expect(frame).not.toContainText('127.0.0.1')
    }
    // Not anywhere in A's window: the Layout A got has no address of a Browser.
    await expect(a.window.locator('body')).not.toContainText(origin)
    const values = await a.window.locator('input').evaluateAll((inputs) => inputs.map((input) => (input as unknown as { value: string }).value))
    expect(values.filter((value) => value.includes('127.0.0.1'))).toEqual([])
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
