import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'

// The Card runtime against the built app: Cards are folders in the Project's data folder, the
// Canvas shows them in iframes on worfy-card://, a file change reloads the Card, and a Card reaches
// neither the window, nor another Card, nor files outside its folder. The Project's repository
// stays untouched throughout (ADR-0005).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const LABEL = '0000000a'

let scratch: string
let dataDir: string
let repo: string
let launched: LaunchedApp | undefined

const cardDir = (id: string) => join(dataDir, PROJECT, 'cards', id)
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

function cardHtml(title: string, version: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><p id="v">${version}</p><script>document.body.dataset.ready = 'yes'</script></body></html>`
}

function cardNode(id: string, x: number) {
  return { id, kind: 'card', x, y: 40, w: 300, h: 220, hidden: false, locked: false, pinned: false, tags: [], data: {} }
}

function writeLayout(zoom: number): void {
  const layout = { nodes: [cardNode('c1', 40), cardNode('c2', 380), cardNode('gone', 720)], viewport: { x: 0, y: 0, zoom } }
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify(layout))
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-cards-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'alpha')
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# alpha\n')
  git('add', '.')
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  mkdirSync(cardDir('c1'), { recursive: true })
  writeFileSync(join(cardDir('c1'), 'index.html'), cardHtml('Clock', 'v1'))
  mkdirSync(cardDir('c2'), { recursive: true })
  writeFileSync(join(cardDir('c2'), 'index.html'), cardHtml('Other', 'other'))
  writeFileSync(join(scratch, 'outside.html'), '<title>outside</title>')
  symlinkSync(join(scratch, 'outside.html'), join(cardDir('c1'), 'escape.html'))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

// Scripts that run inside a Card frame. They are source text: this file is compiled without the
// DOM library, and the code runs in the Card, not here.

/** What the Card can reach of its parent, the top window and the other Cards: 'reached' or the error name. */
const REACH_SCRIPT = `(() => {
  const attempt = (action) => { try { action(); return 'reached' } catch (error) { return error.name } }
  const siblings = Array.from({ length: window.parent.frames.length }, (_, index) => window.parent.frames[index]).filter((other) => other !== window)
  return {
    parentDocument: attempt(() => window.parent.document.title),
    topDocument: attempt(() => window.top.document.title),
    siblingCount: siblings.length,
    siblings: siblings.map((other) => attempt(() => other.document.title)),
  }
})()`

/** fetch() of other origins from the Card, and the CSP violations they raise. */
const fetchScript = (label: string) => `(async () => {
  const violations = []
  document.addEventListener('securitypolicyviolation', (event) => violations.push(event.blockedURI))
  const attempt = async (url) => { try { const response = await fetch(url); return 'status ' + response.status } catch (error) { return error.name } }
  const results = {
    otherCard: await attempt('worfy-card://c2.${label}/index.html'),
    ownFile: await attempt('worfy-card://c1.${label}/index.html'),
    file: await attempt('file:///etc/hosts'),
    https: await attempt('https://127.0.0.1:9/'),
  }
  await new Promise((done) => setTimeout(done, 100))
  return { results, violations }
})()`

const navigateScript = (url: string) => `location.href = ${JSON.stringify(url)}`

/** The frame of a Card once its document has run its script. */
async function cardFrame(window: Page, cardId: string): Promise<Frame> {
  const locator = window.frameLocator(`[data-card-id="${cardId}"] iframe`).locator('body[data-ready="yes"]')
  await expect(locator).toHaveCount(1)
  const frame = window.frames().find((candidate) => candidate.url().startsWith(`worfy-card://${cardId}.${LABEL}/`))
  if (!frame) throw new Error(`no frame for Card ${cardId}`)
  return frame
}

test('a Card is shown with its <title>, a file change reloads it within a second, and the Project repository stays clean', async () => {
  writeLayout(1)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const { window } = launched

  const c1 = window.locator('[data-testid="card-node"][data-card-id="c1"]')
  await expect(c1.getByTestId('card-title')).toHaveText('Clock')
  const content = window.frameLocator('[data-card-id="c1"] iframe').locator('#v')
  await expect(content).toHaveText('v1')
  await expect(window.locator('[data-card-id="gone"]').getByTestId('card-missing')).toHaveText('Card files missing')

  // The watch is up once a first rewrite has reloaded the Card; then the change is timed, made the
  // way an agent does: rewrite the file.
  await writeFile(join(cardDir('c1'), 'index.html'), cardHtml('Clock', 'v1, watched'))
  await expect(content).toHaveText('v1, watched')
  const started = Date.now()
  await writeFile(join(cardDir('c1'), 'index.html'), cardHtml('Clock v2', 'v2'))
  await expect(content).toHaveText('v2', { timeout: 1000 })
  expect(Date.now() - started).toBeLessThanOrEqual(1000)
  await expect(c1.getByTestId('card-title')).toHaveText('Clock v2')

  // A Card created while the app runs appears in its Node too.
  await removeDir(cardDir('c2'))
  await expect(window.locator('[data-card-id="c2"]').getByTestId('card-missing')).toHaveText('Card files missing')
  mkdirSync(cardDir('c2'))
  await writeFile(join(cardDir('c2'), 'index.html'), cardHtml('Other again', 'again'))
  await expect(window.frameLocator('[data-card-id="c2"] iframe').locator('#v')).toHaveText('again')

  expect(git('status', '--porcelain')).toBe('')
})

test('a Card reaches neither the window, another Card, file:// nor another worfy-card origin; https stays open to it', async () => {
  writeLayout(1)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const { app, window } = launched
  const frame = await cardFrame(window, 'c1')
  await cardFrame(window, 'c2')

  expect(await frame.evaluate('location.origin')).toBe(`worfy-card://c1.${LABEL}`)

  const reach = (await frame.evaluate(REACH_SCRIPT)) as { parentDocument: string; topDocument: string; siblingCount: number; siblings: string[] }
  expect(reach.parentDocument).toBe('SecurityError')
  expect(reach.topDocument).toBe('SecurityError')
  expect(reach.siblingCount).toBeGreaterThan(0)
  expect(reach.siblings.every((result) => result === 'SecurityError')).toBe(true)

  // fetch: the CSP refuses everything but https; an https request is let through by the CSP and
  // fails only on the network (nothing listens on port 9), so it raises no violation.
  const fetches = (await frame.evaluate(fetchScript(LABEL))) as { results: Record<string, string>; violations: string[] }
  expect(fetches.results).toEqual({ otherCard: 'TypeError', ownFile: 'TypeError', file: 'TypeError', https: 'TypeError' })
  // Chromium reports only the scheme of a blocked non-http URL. connect-src is https only, so even
  // the Card's own origin is refused to fetch; the https request is the one without a violation.
  expect(fetches.violations).toEqual(['worfy-card', 'worfy-card', 'file'])

  // Navigating away and opening windows are stopped; web permissions are refused.
  const before = app.windows().length
  expect(await frame.evaluate("window.open('https://example.com/') === null")).toBe(true)
  expect(await frame.evaluate('Notification.requestPermission()')).toBe('denied')

  // Another Card's origin: main stops the navigation, the Card keeps running as it was.
  await frame.evaluate(navigateScript(`worfy-card://c2.${LABEL}/index.html`))
  // A window in which nothing may happen: main refuses in will-frame-navigate and sends nothing
  // back, so there is no sign to wait for. A navigation it let through would load a Card page
  // served from this machine by main's protocol handler, which commits well within 300 ms.
  await window.waitForTimeout(300)
  const c1Frames = () => window.frames().filter((candidate) => candidate.url().startsWith(`worfy-card://c1.${LABEL}/`))
  expect(c1Frames()).toHaveLength(1)
  expect(await c1Frames()[0]?.evaluate("document.getElementById('v').textContent")).toBe('v1')

  // The web and file://: the window's own CSP (frame-src worfy-card:) refuses the frame before
  // main is asked; the frame ends on an error page, never on the target.
  const fileRefused = window.waitForEvent('console', (message) => message.text() === 'Not allowed to load local resource: file:///etc/hosts')
  for (const [cardId, target] of [
    ['c1', 'https://example.com/'],
    ['c2', 'file:///etc/hosts'],
  ] as const) {
    const card = window.frames().find((candidate) => candidate.url().startsWith(`worfy-card://${cardId}.${LABEL}/`))
    expect(card, cardId).toBeDefined()
    // The frame's document goes away when the refused navigation turns into an error page.
    await card?.evaluate(navigateScript(target)).catch(() => undefined)
  }
  // Both refusals are over: the web page leaves Card c1 on an error page, and Chromium refuses
  // file:// inside Card c2, says so on the console, and leaves the Card where it was.
  await expect.poll(() => window.frames().some((candidate) => candidate.url().startsWith(`worfy-card://c1.${LABEL}/`))).toBe(false)
  await fileRefused
  expect(window.frames().some((candidate) => candidate.url().startsWith('https:') || candidate.url().startsWith('file:///etc'))).toBe(false)
  expect(app.windows().length).toBe(before)
  await expect(window.locator('[data-testid="canvas"]')).toBeVisible()
})

test('main refuses every new window on its own, and a Card can neither open one nor navigate the window', async () => {
  writeLayout(1)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const { app, window } = launched
  const frame = await cardFrame(window, 'c1')
  const rendererUrl = window.url()
  const before = app.windows().length
  const contentsBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length)

  // The window itself has no iframe sandbox around it, so only main's window-open handler is
  // left to refuse here. A Card frame asks the same handler once its sandbox lets a popup through.
  expect(await window.evaluate("window.open('https://127.0.0.1:9/', '_blank') === null")).toBe(true)
  expect(await window.evaluate("window.open('about:blank', '_blank', 'noreferrer') === null")).toBe(true)
  // main answers window.open while the call is still running, and a window it let through would
  // have its web contents by the time the call returns: none was made.
  expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().length)).toBe(contentsBefore)
  expect(app.windows().length).toBe(before)

  // The sandbox of a Card's iframe is exactly scripts and its own origin: no popups, no top
  // navigation, no forms.
  await expect(window.locator('[data-card-id="c1"] iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  const topNavigation = await frame.evaluate(`(() => { try { top.location.href = 'https://127.0.0.1:9/'; return 'asked' } catch (error) { return error.name } })()`)
  // Refused inside the Card before any navigation started: there is nothing to wait for.
  expect(topNavigation).toBe('SecurityError')
  expect(window.url()).toBe(rendererUrl)
  await expect(window.locator('[data-testid="canvas"]')).toBeVisible()
  expect(app.windows().length).toBe(before)
})

test('the protocol in the running app sends the CSP and answers 404 outside the Card folder', async () => {
  writeLayout(1)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const { app, window } = launched
  await cardFrame(window, 'c1')

  const answers = await app.evaluate(async ({ net }, label) => {
    const ask = async (url: string) => {
      const response = await net.fetch(url)
      return { status: response.status, csp: response.headers.get('content-security-policy'), nosniff: response.headers.get('x-content-type-options') }
    }
    return {
      index: await ask(`worfy-card://c1.${label}/index.html`),
      dotted: await ask(`worfy-card://c1.${label}/../../layout.json`),
      encoded: await ask(`worfy-card://c1.${label}/..%2F..%2Flayout.json`),
      symlink: await ask(`worfy-card://c1.${label}/escape.html`),
    }
  }, LABEL)
  expect(answers.index).toEqual({
    status: 200,
    csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src https:; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'",
    nosniff: 'nosniff',
  })
  expect(answers.dotted.status).toBe(404)
  expect(answers.encoded.status).toBe(404)
  expect(answers.symlink.status).toBe(404)
})

test('below zoom 0.4 a Card is drawn as its title in a frame, without a live iframe', async () => {
  writeLayout(0.3)
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const { window } = launched
  const c1 = window.locator('[data-testid="card-node"][data-card-id="c1"]')
  await expect(c1.getByTestId('card-placeholder')).toHaveText('Clock')
  await expect(c1.locator('iframe')).toHaveCount(0)
})
