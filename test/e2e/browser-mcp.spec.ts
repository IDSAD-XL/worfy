import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// A Session drives a Browser through the MCP server `worfy-browser` (worfy-browser ticket 04,
// ADR-0078 items 4, 5 and 8): it opens a Browser under the Browser profile «admin» next to its
// Node, goes to a page, clicks, types, takes a screenshot, reads the page, its console and its
// network; a page outside the profile's origins is refused whatever leads there — the Session's
// address, a link it clicks, a redirect, a link whose site has a service worker — and the page stays
// where it was; a password field takes no text from it, wherever it sits; a field takes text with
// no click of the Session before; and a page of another site the user left it on is the Session's
// only to leave. While it drives, the frame shows «Claude is driving»; a click of the user on the
// page takes the Browser over, every call is refused until «Return control to Claude», and then the
// Session drives again. The fake agent calls no MCP tool, so the test calls the tools in main as
// the Session would (globalThis.worfyBrowserTool, src/main/mcp/browser-server.ts), over the same
// CDP session. The pages come from two servers this file starts on 127.0.0.1: the profile's origin
// and another one, outside it. With WORFY_EVIDENCE_DIR set, the snapshots are copied there as
// 04-browser-claude-drives-<theme>.png.

const PROJECT = 'browser-00000004'
const SESSION = 'f0000000-0000-4000-8000-000000000004'
const PROFILE = 'admin-0a0a0a'
const WINDOW = { width: 1500, height: 950 }

let site: Server
let elsewhere: Server
let origin: string
let away: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

const SERVICE_WORKER = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(new Response('<!doctype html><title>Worker</title><h1>From the worker</h1>', { headers: { 'content-type': 'text/html' } }))
})`

const page = (title: string, body: string): string => `<!doctype html><title>${title}</title><body style="margin:0;padding:16px;font:16px sans-serif;background:#fdf6e3" data-ready="yes">${body}</body>`

test.beforeAll(async () => {
  elsewhere = createServer((request, response) => {
    const path = request.url ?? '/'
    const html = (title: string, body: string) => void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(title, body))
    // A service worker that answers every page of this site itself.
    if (path === '/sw.js') return void response.writeHead(200, { 'content-type': 'text/javascript' }).end(SERVICE_WORKER)
    if (path === '/sw') return html('Worker setup', `<h1>Worker setup</h1><script>navigator.serviceWorker.register('/sw.js', { scope: '/' })</script>`)
    // A sign-in form of another site, its password field focused: the page of a frame.
    if (path === '/form') return html('Sign in', `<input id="pw" type="password"><script>document.getElementById('pw').focus()</script>`)
    html('Elsewhere', '<h1>Another site</h1>')
  })
  await new Promise<void>((done) => elsewhere.listen(0, '127.0.0.1', done))
  away = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`
  site = createServer((request, response) => {
    const path = request.url ?? '/'
    if (path === '/redirect') return void response.writeHead(302, { location: `${away}/landing` }).end()
    if (path === '/api/ping') return void response.writeHead(200, { 'content-type': 'application/json' }).end('{"pong":true}')
    if (path === '/next') return void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page('Next', '<h1>Next page</h1>'))
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
      page(
        'Home',
        `<h1>Home</h1>
         <p><a id="next" href="/next">Next</a> <a id="away" href="${away}/">Away</a></p>
         <p><label>Search <input id="q"></label> <label>Password <input id="pw" type="password"></label></p>
         <form id="login"><label>Password in a form <input id="pw-form" type="password" name="password"></label></form>
         <p><label>Moves the focus <input id="sneaky" onfocus="document.querySelector('#pw').focus()"></label>
            <label>Moves it to a field <input id="moves" onfocus="document.querySelector('#q').focus()"></label></p>
         <p id="pw-host" tabindex="-1"></p>
         <script>document.querySelector('#pw-host').attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML = '<input id="inner-pw" type="password">'</script>
         <iframe id="frame-pw" width="160" height="40" srcdoc="<input id=&quot;p&quot; type=&quot;password&quot;><script>const p = document.getElementById(&quot;p&quot;); p.focus(); addEventListener(&quot;focus&quot;, () => p.focus())</script>"></iframe>
         <iframe id="frame-away" width="160" height="40" src="${away}/form"></iframe>
         <button id="log" onclick="console.log('clicked log'); fetch('/api/ping')">Log</button>`,
      ),
    )
  })
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()))
  await new Promise<void>((done) => elsewhere.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-mcp-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const dataDir = (): string => join(scratch, 'data')
const repo = (): string => join(scratch, 'alpha')

/** A Project with a Session Node and a note right of it, and the Browser profile «admin» of `origin`. */
async function start(): Promise<Page> {
  mkdirSync(join(scratch, 'home'))
  mkdirSync(repo())
  git(repo(), 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const nodes = [
    { id: `session:${SESSION}`, kind: 'session', x: 40, y: 40, w: 300, h: 120, ...base, data: { sessionId: SESSION, origin: 'external', source: 'terminal', cwd: repo() } },
    { id: 'note-1', kind: 'note', x: 380, y: 40, w: 300, h: 140, ...base, data: { text: 'in the way' } },
  ]
  mkdirSync(join(dataDir(), PROJECT), { recursive: true })
  writeFileSync(join(dataDir(), 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo() }], activeId: PROJECT }))
  writeFileSync(join(dataDir(), PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 0, y: 0, zoom: 0.75 } }))
  writeFileSync(join(dataDir(), PROJECT, 'browser-profiles.json'), JSON.stringify({ profiles: [{ id: PROFILE, name: 'admin', origins: [origin], autopilot: false }] }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir(), HOME: join(scratch, 'home') } })
  await canvasReady(launched, { size: WINDOW })
  await expect.poll(() => launched!.app.evaluate(() => typeof (globalThis as { worfyBrowserTool?: unknown }).worfyBrowserTool), { message: 'the Browser tools in main' }).toBe('function')
  return launched.window
}

interface ToolAnswer {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  isError?: boolean
}

/** Calls a tool of worfy-browser in main, as the Session would. */
function tool(name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
  return launched!.app.evaluate(
    (_electron, { project, session, name, args }) =>
      (globalThis as unknown as { worfyBrowserTool: (p: string, s: string, n: string, a: unknown) => Promise<unknown> }).worfyBrowserTool(project, session, name, args) as Promise<ToolAnswer>,
    { project: PROJECT, session: SESSION, name, args },
  )
}
const textOf = (answer: ToolAnswer): string => {
  const [first] = answer.content
  return first?.type === 'text' ? first.text : ''
}
async function ok<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const answer = await tool(name, args)
  expect(answer.isError, `${name}: ${textOf(answer)}`).toBeFalsy()
  return JSON.parse(textOf(answer)) as T
}
async function refused(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const answer = await tool(name, args)
  expect(answer.isError, `${name} should be refused: ${textOf(answer)}`).toBe(true)
  return textOf(answer)
}

/** Where the Browser's page is, read in main from its guest. */
function pageUrl(): Promise<string[]> {
  return launched!.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
      .map((contents) => contents.getURL()),
  )
}
/** Runs `code` in the Browser's page. */
function inPage(code: string): Promise<unknown> {
  return launched!.app.evaluate(async ({ webContents }, code) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
    if (!guest) throw new Error('no Browser page')
    return guest.executeJavaScript(code, true)
  }, code)
}

/** The Nodes main saved, by id. */
function savedNodes(): Record<string, { kind: string; x: number; y: number; w: number; h: number; data: Record<string, unknown> }> {
  const file = join(dataDir(), PROJECT, 'layout.json')
  if (!existsSync(file)) return {}
  const layout = JSON.parse(readFileSync(file, 'utf8')) as { nodes: { id: string; kind: string; x: number; y: number; w: number; h: number; data: Record<string, unknown> }[] }
  return Object.fromEntries(layout.nodes.map((node) => [node.id, node]))
}

function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `${name}.png`))
}

test('a Session opens a Browser next to its Node and drives it: page, click, typing, screenshot, page text, console and network', async () => {
  const window = await start()
  const opened = await ok<{ id: string; url: string }>('browser_open', { profile: PROFILE, url: `${origin}/` })
  expect(opened.url).toBe(`${origin}/`)
  const frame = window.locator(`[data-testid="browser-frame"][data-node-id="${opened.id}"]`)
  await expect(frame).toBeVisible()
  await expect(frame.getByTestId('browser-claude-drives')).toHaveText(/Claude is driving/)

  // Opened by the Session, next to its Node, on no other Node.
  await expect.poll(() => savedNodes()[opened.id]?.data.openedBy, { message: 'openedBy in the saved Layout' }).toBe(SESSION)
  const nodes = savedNodes()
  const browser = nodes[opened.id]!
  expect(browser.data.profile).toBe(PROFILE)
  const session = nodes[`session:${SESSION}`]!
  expect(browser.x).toBeGreaterThanOrEqual(session.x + session.w)
  expect(browser.x - (session.x + session.w)).toBeLessThanOrEqual(80)
  for (const [id, other] of Object.entries(nodes)) {
    if (id === opened.id) continue
    const apart = browser.x >= other.x + other.w || other.x >= browser.x + browser.w || browser.y >= other.y + other.h || other.y >= browser.y + browser.h
    expect(apart, `the Browser covers ${id}`).toBe(true)
  }

  // Go, click, type.
  expect((await ok<{ url: string }>('browser_navigate', { id: opened.id, url: `${origin}/next` })).url).toBe(`${origin}/next`)
  expect(await pageUrl()).toEqual([`${origin}/next`])
  await ok('browser_navigate', { id: opened.id, url: `${origin}/` })
  expect((await ok<{ url: string }>('browser_click', { id: opened.id, selector: '#next' })).url).toBe(`${origin}/next`)
  await ok('browser_navigate', { id: opened.id, url: `${origin}/` })
  await ok('browser_type', { id: opened.id, selector: '#q', text: 'roles' })
  expect(await inPage("document.querySelector('#q').value")).toBe('roles')

  // A screenshot is a PNG.
  const shot = await tool('browser_screenshot', { id: opened.id })
  expect(shot.isError).toBeFalsy()
  const image = shot.content[0]
  expect(image?.type).toBe('image')
  expect(Buffer.from(image?.type === 'image' ? image.data : '', 'base64').subarray(1, 4).toString()).toBe('PNG')

  // The page as an accessibility snapshot, with refs a click takes.
  const snapshot = textOf(await tool('browser_read', { id: opened.id }))
  expect(snapshot).toContain(`Page: Home — ${origin}/`)
  expect(snapshot).toMatch(/- heading "Home"/)
  const ref = /- button "Log" \[ref=(\d+)\]/.exec(snapshot)?.[1]
  expect(ref, snapshot).toBeDefined()
  await ok('browser_click', { id: opened.id, ref: Number(ref) })

  // The click logged a message and fetched /api/ping.
  await expect
    .poll(async () => (await ok<{ messages: { level: string; text: string }[] }>('browser_console', { id: opened.id })).messages)
    .toContainEqual({ level: 'log', text: 'clicked log' })
  await expect
    .poll(async () => (await ok<{ requests: { method: string; url: string; status?: number }[] }>('browser_network', { id: opened.id })).requests)
    .toContainEqual(expect.objectContaining({ method: 'GET', url: `${origin}/api/ping`, status: 200 }))
})

test('a page outside the origins is refused whoever leads there, and the page stays; a password field takes no text', async () => {
  await start()
  const { id } = await ok<{ id: string }>('browser_open', { profile: PROFILE, url: `${origin}/` })

  // The Session's own address.
  expect(await refused('browser_navigate', { id, url: `${away}/` })).toContain(`${away} is outside the origins`)
  expect(await pageUrl()).toEqual([`${origin}/`])

  // A link the Session clicks.
  const link = await refused('browser_click', { id, selector: '#away' })
  expect(link).toContain(`${away} is outside the origins`)
  expect(link).toContain('The page was not changed')
  expect(await pageUrl()).toEqual([`${origin}/`])
  expect(await inPage("document.querySelector('h1').textContent")).toBe('Home')

  // A redirect of a page in the list to a page outside it.
  expect(await refused('browser_navigate', { id, url: `${origin}/redirect` })).toContain(away)
  expect(await pageUrl()).toEqual([`${origin}/`])
  expect(await inPage("document.querySelector('h1').textContent")).toBe('Home')

  // A password: the user logs in. Wherever the text would go — the field itself, one in a form, a
  // field the page moves the focus to, one in a shadow root the element hands its focus to, or one
  // in a frame — and a frame of another site, whose focus cannot be seen, is refused too.
  for (const selector of ['#pw', '#pw-form', '#sneaky', '#pw-host', '#frame-pw']) {
    expect(await refused('browser_type', { id, selector, text: 'hunter2' }), selector).toMatch(/This is a password field: the user logs in/)
  }
  expect(await refused('browser_type', { id, selector: '#frame-away', text: 'hunter2' })).toMatch(/a frame of another site/)
  const typed = `[...document.querySelectorAll('input')].map((e) => e.value).join('')
    + document.querySelector('#pw-host').shadowRoot.querySelector('input').value
    + document.querySelector('#frame-pw').contentDocument.querySelector('input').value`
  expect(await inPage(typed)).toBe('')
  // The text goes into the element asked for or nowhere: not into the field focused before it, nor
  // into one the page moves the focus to.
  await ok('browser_type', { id, selector: '#q', text: 'kept' })
  expect(await refused('browser_type', { id, selector: 'h1', text: 'lost' })).toMatch(/does not take text/)
  expect(await refused('browser_type', { id, selector: '#moves', text: 'lost' })).toMatch(/moves the focus away from it/)
  expect(await inPage("document.querySelector('#q').value + document.querySelector('#moves').value")).toBe('kept')
})

test('a field takes text as the first call on a new page, with no click before it', async () => {
  await start()
  const { id } = await ok<{ id: string }>('browser_open', { profile: PROFILE, url: `${origin}/` })
  await ok('browser_type', { id, selector: '#q', text: 'first' })
  expect(await inPage("document.querySelector('#q').value")).toBe('first')
})

test("a service worker of another site does not let the Session's navigation past the origins", async () => {
  const window = await start()
  const { id } = await ok<{ id: string }>('browser_open', { profile: PROFILE, url: `${origin}/` })
  const frame = window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)
  // The user, by hand, visits the other site, which installs a worker answering its pages, and comes back.
  const body = (await frame.getByTestId('browser-frame-body').boundingBox())!
  await window.mouse.click(body.x + body.width / 2, body.y + 60)
  await expect(frame.getByTestId('browser-taken-over')).toBeVisible()
  await inPage(`location.href = ${JSON.stringify(`${away}/sw`)}`)
  await expect.poll(pageUrl).toEqual([`${away}/sw`])
  await expect.poll(() => inPage('navigator.serviceWorker.ready.then((registration) => registration.active?.state ?? null)'), { message: 'the worker of the other site' }).toBe('activated')
  await inPage(`location.href = ${JSON.stringify(`${origin}/`)}`)
  await expect.poll(pageUrl).toEqual([`${origin}/`])
  await frame.getByTestId('browser-return-control').click()
  await expect(frame.getByTestId('browser-claude-drives')).toBeVisible()

  // The worker would answer the page of the other site itself, before any request leaves the page.
  const link = await refused('browser_click', { id, selector: '#away' })
  expect(link).toContain(`${away} is outside the origins`)
  expect(await pageUrl()).toEqual([`${origin}/`])
  expect(await inPage("document.querySelector('h1').textContent")).toBe('Home')
})

test('«Claude is driving» goes at a click of the user on the page; calls are refused until «Return control to Claude»', async () => {
  const window = await start()
  const { id } = await ok<{ id: string }>('browser_open', { profile: PROFILE, url: `${origin}/` })
  const frame = window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)
  await expect(frame.getByTestId('browser-claude-drives')).toBeVisible()
  await expect(frame).toHaveAttribute('data-control', 'claude')
  const shots = await snapshotThemes(window, 'browser-claude-drives')
  evidence(shots.light, '04-browser-claude-drives-light')
  evidence(shots.dark, '04-browser-claude-drives-dark')

  // The user clicks into the page.
  const body = (await frame.getByTestId('browser-frame-body').boundingBox())!
  await window.mouse.click(body.x + body.width / 2, body.y + 60)
  await expect(frame.getByTestId('browser-claude-drives')).toHaveCount(0)
  await expect(frame.getByTestId('browser-taken-over')).toBeVisible()
  expect(await refused('browser_navigate', { id, url: `${origin}/next` })).toContain('The user took over this Browser')
  expect(await refused('browser_read', { id })).toContain('Return control to Claude')

  // While the user has it, they go anywhere: the origins hold the Session only.
  await inPage("document.querySelector('#away').click()")
  await expect.poll(pageUrl).toEqual([`${away}/`])

  // «Return control to Claude»: the Session drives again — but not on the page of the other site
  // the user left it on; it may only go back to a page in the list.
  await frame.getByTestId('browser-return-control').click()
  await expect(frame.getByTestId('browser-claude-drives')).toBeVisible()
  expect(await refused('browser_read', { id })).toContain(`shows a page of ${away}, outside the origins`)
  expect((await ok<{ url: string }>('browser_navigate', { id, url: `${origin}/next` })).url).toBe(`${origin}/next`)

  // A click on the frame's own header takes it over too.
  await frame.getByTestId('browser-address').click()
  await expect(frame.getByTestId('browser-taken-over')).toBeVisible()
  expect(await refused('browser_screenshot', { id })).toContain('The user took over this Browser')
})
