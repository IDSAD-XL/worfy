// The Browser MCP server `worfy-browser` (src/main/mcp/browser-server.ts, worfy-browser ticket 04)
// through its in-process instance, the way Claude Code talks to it: JSON-RPC over a transport, so
// the server's own schema check runs too (like test/contract/canvas-tools.test.ts). New Browsers go
// through the app's LayoutStore; the page of a Browser is a fake guest whose debugger answers the
// CDP commands the page sends (src/main/browser/cdp.ts) and plays the events a test asks for: a
// paused request of a navigation the origin wall must stop, a click of the user.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryRequest } from '../../src/main/agent/session'
import type { CdpContents, CdpDebugger, CdpInputEvent } from '../../src/main/browser/cdp'
import type { LiveBrowsers } from '../../src/main/browser/live'
import type { LayoutStore } from '../../src/main/layout/store'
import type { BrowserContext, BrowserToolResult } from '../../src/main/mcp/browser-server'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import { BROWSER_LOG_LIMIT, BROWSER_SERVER_NAME, BROWSER_TOOL_NAMES, PASSWORD_REFUSED, TAKEN_OVER } from '../../src/shared/browser/tools'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import type { LayoutNode } from '../../src/shared/layout/types'
import { removeTestTree, saveLayoutNow } from '../remove'

const PROJECT = 'demo-0a1b2c3d'
const SESSION = 'sess-a'
const SITE = 'http://127.0.0.1:4100'
const ELSEWHERE = 'http://127.0.0.1:4200'

const mocks = vi.hoisted(() => ({ query: vi.fn(), agentEnv: vi.fn() }))

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), query: mocks.query }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

/** What the fake element under a selector or ref is. */
interface FakeElement {
  password?: boolean
  focusable?: boolean
  /** Where a click on it sends the main frame: a paused request of that address. */
  navigatesTo?: string
}

type Listener = (...args: unknown[]) => void

/** A guest page whose debugger answers like Chromium's, far enough for the tools. */
class FakePage implements CdpContents {
  private static next = 1
  readonly id = FakePage.next++
  readonly sent: { method: string; params: Record<string, unknown> }[] = []
  readonly elements = new Map<string, FakeElement>()
  url = 'about:blank'
  destroyed = false
  private attached = false
  private readonly on_ = new Map<string, Set<Listener>>()
  private paused = 0
  /** A redirect of the next navigation to this address, through a paused request. */
  redirectTo: string | null = null

  readonly debugger: CdpDebugger = {
    attach: () => {
      this.attached = true
    },
    isAttached: () => this.attached,
    sendCommand: (method, params) => this.command(method, (params ?? {}) as Record<string, unknown>),
    on: ((event: string, listener: Listener) => this.listen(`debugger:${event}`, listener)) as CdpDebugger['on'],
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return this.url
  }
  getTitle(): string {
    return 'Fixture'
  }
  readonly on = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['on']
  readonly once = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['once']
  private listen(event: string, listener: Listener): this {
    const set = this.on_.get(event) ?? new Set()
    set.add(listener)
    this.on_.set(event, set)
    return this
  }
  private fire(event: string, ...args: unknown[]): void {
    for (const listener of this.on_.get(event) ?? []) listener(...args)
  }

  /** A CDP event of the page. */
  emit(method: string, params: Record<string, unknown>): void {
    this.fire('debugger:message', {}, method, params)
  }
  /** An input event as Electron's `input-event` reports it. */
  input(type: CdpInputEvent['type']): void {
    this.fire('input-event', {}, { type })
  }
  close(): void {
    this.destroyed = true
    this.fire('destroyed')
  }
  commands(method: string): Record<string, unknown>[] {
    return this.sent.filter((each) => each.method === method).map((each) => each.params)
  }

  /** A whole-page request of the main frame for `url`, as the Fetch domain pauses it; resolves with how the page answered it. */
  async pauseRequest(url: string, frameId = 'main'): Promise<'continued' | 'failed'> {
    this.paused += 1
    const requestId = `paused-${this.paused}`
    const before = this.sent.length
    this.emit('Fetch.requestPaused', { requestId, request: { url, method: 'GET' }, frameId, resourceType: 'Document' })
    for (let wait = 0; wait < 100; wait += 1) {
      const answer = this.sent.slice(before).find((each) => each.params.requestId === requestId)
      if (answer?.method === 'Fetch.continueRequest') {
        if (frameId === 'main') this.url = url
        return 'continued'
      }
      if (answer?.method === 'Fetch.failRequest') return 'failed'
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`the paused request ${url} was never answered`)
  }

  private async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ method, params })
    const element = (key: string | number): FakeElement | undefined => this.elements.get(String(key))
    switch (method) {
      case 'Page.getFrameTree':
        return { frameTree: { frame: { id: 'main' } } }
      case 'Page.navigate': {
        const target = String(params.url)
        this.emit('Page.frameStartedLoading', { frameId: 'main' })
        const first = await this.pauseRequest(target)
        let errorText: string | undefined = first === 'failed' ? 'net::ERR_ABORTED' : undefined
        if (first === 'continued' && this.redirectTo !== null) {
          const hop = this.redirectTo
          this.redirectTo = null
          if ((await this.pauseRequest(hop)) === 'failed') {
            this.url = 'about:blank'
            errorText = 'net::ERR_ABORTED'
          }
        }
        this.emit('Page.frameStoppedLoading', { frameId: 'main' })
        return { frameId: 'main', loaderId: 'l1', ...(errorText === undefined ? {} : { errorText }) }
      }
      case 'Runtime.evaluate': {
        const selector = /^document\.querySelector\((.*)\)$/.exec(String(params.expression))?.[1]
        const key = selector === undefined ? '' : (JSON.parse(selector) as string)
        return this.elements.has(key) ? { result: { type: 'object', objectId: `obj:${key}` } } : { result: { type: 'object', subtype: 'null', value: null } }
      }
      case 'DOM.resolveNode':
        if (!this.elements.has(String(params.backendNodeId))) throw new Error('No node with given id found')
        return { object: { type: 'object', objectId: `obj:${String(params.backendNodeId)}` } }
      case 'Runtime.callFunctionOn': {
        const found = element(String(params.objectId).slice('obj:'.length))
        const code = String(params.functionDeclaration)
        if (code.includes('getBoundingClientRect')) return { result: { type: 'object', value: { x: 50, y: 20, w: 100, h: 30 } } }
        if (code.includes('isPassword')) return { result: { type: 'string', value: found?.password === true ? 'password' : found?.focusable === false ? 'none' : 'ok' } }
        return { result: { type: 'undefined' } }
      }
      case 'Input.dispatchMouseEvent':
        // Chromium reports the Session's own input through the same path as the user's.
        if (params.type === 'mousePressed') this.input('mouseDown')
        if (params.type === 'mouseReleased') {
          const target = [...this.elements.values()].find((each) => each.navigatesTo !== undefined)?.navigatesTo
          if (target !== undefined) {
            this.emit('Page.frameStartedLoading', { frameId: 'main' })
            void this.pauseRequest(target).then(() => this.emit('Page.frameStoppedLoading', { frameId: 'main' }))
          }
        }
        return {}
      case 'Input.dispatchKeyEvent':
        if (params.type === 'keyDown') this.input('keyDown')
        return {}
      case 'Page.captureScreenshot':
        return { data: 'iVBORw0KGgo=' }
      case 'Accessibility.getFullAXTree':
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Fixture' }, childIds: ['2', '3'] },
            { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 12, childIds: ['4'] },
            { nodeId: '4', parentId: '2', role: { value: 'StaticText' }, name: { value: 'Save' } },
            { nodeId: '3', parentId: '1', role: { value: 'textbox' }, name: { value: 'Email' }, value: { value: 'a@b.c' }, backendDOMNodeId: 13 },
          ],
        }
      default:
        return {}
    }
  }
}

let scratch: string
let store: LayoutStore
let live: LiveBrowsers
let server: typeof import('../../src/main/mcp/browser-server')
let profiles: BrowserProfile[]
let changes: [string, string | null][]
/** The pages the "window" draws, by Browser Node id: each new Browser Node gets one at once. */
let pages: Map<string, FakePage>

beforeEach(async () => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-browser-tools-')))
  const dataDir = join(scratch, 'data')
  mkdirSync(join(scratch, 'repo'))
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: join(scratch, 'repo') }], activeId: PROJECT }))
  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  store = (await import('../../src/main/layout/store')).layoutStore()
  const { LiveBrowsers } = await import('../../src/main/browser/live')
  profiles = [
    { id: 'admin-aaaaaa', name: 'admin', origins: [SITE], autopilot: false },
    { id: 'none-bbbbbb', name: 'nobody', origins: [], autopilot: false },
  ]
  changes = []
  pages = new Map()
  live = new LiveBrowsers({
    profileOf: (projectId, nodeId) => {
      const id = store.get(projectId).layout.nodes.find((node) => node.id === nodeId)?.data.profile
      const profile = profiles.find((each) => each.id === id)
      return profile === undefined ? null : { name: profile.name, origins: profile.origins }
    },
    changed: (_projectId, nodeId, mode) => changes.push([nodeId, mode]),
  })
  server = await import('../../src/main/mcp/browser-server')
  mocks.query.mockReset().mockImplementation(() => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: '/Users/tester', PATH: '/usr/bin' }, from: 'login-shell' })
})

afterEach(async () => {
  await saveLayoutNow()
  delete process.env.WORFY_DATA_DIR
  removeTestTree(scratch)
})

/** The window draws every Browser Node: a page for it, told to main as the Browser layer does. */
function drawBrowsers(): void {
  for (const node of store.get(PROJECT).layout.nodes) {
    if (node.kind !== 'browser' || pages.has(node.id)) continue
    const page = new FakePage()
    pages.set(node.id, page)
    live.register(PROJECT, node.id, page)
  }
}

const context = (overrides: Partial<BrowserContext> = {}): BrowserContext => ({
  projectId: PROJECT,
  // Each change of the Layout is drawn at once, as an open window draws it.
  layout: {
    get: (projectId) => store.get(projectId),
    apply: (projectId, op) => {
      const state = store.apply(projectId, op)
      queueMicrotask(drawBrowsers)
      return state
    },
  },
  profiles: () => profiles,
  live,
  sessionId: () => SESSION,
  liveWaitMs: 200,
  ...overrides,
})

interface Rpc {
  request(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }>
  call(name: string, args?: Record<string, unknown>): Promise<BrowserToolResult>
}

/** Connects to a server for `ctx` as Claude Code would: initialize, then requests. */
async function connect(ctx: BrowserContext = context()): Promise<Rpc> {
  const config = await server.createBrowserServer(ctx)
  expect(config).toMatchObject({ type: 'sdk', name: BROWSER_SERVER_NAME })
  type Message = { id?: number; result?: unknown; error?: unknown }
  const pending = new Map<number, (message: Message) => void>()
  const transport: { onmessage?: (message: unknown) => void; start(): Promise<void>; close(): Promise<void>; send(message: Message): Promise<void> } = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: (message) => {
      const resolve = message.id === undefined ? undefined : pending.get(message.id)
      if (resolve && message.id !== undefined) {
        pending.delete(message.id)
        resolve(message)
      }
      return Promise.resolve()
    },
  }
  await config.instance.connect(transport as never)
  let next = 0
  const request: Rpc['request'] = (method, params) =>
    new Promise((resolve) => {
      next += 1
      pending.set(next, resolve)
      transport.onmessage?.({ jsonrpc: '2.0', id: next, method, params })
    })
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    request,
    call: async (name, args = {}) => {
      const answer = await request('tools/call', { name, arguments: args })
      if (answer.error !== undefined) return { content: [{ type: 'text', text: JSON.stringify(answer.error) }], isError: true }
      return answer.result as BrowserToolResult
    },
  }
}

const textOf = (result: BrowserToolResult): string => {
  const [first] = result.content
  return first?.type === 'text' ? first.text : ''
}
const json = <T>(result: BrowserToolResult): T => {
  expect(result.isError, textOf(result)).toBeFalsy()
  return JSON.parse(textOf(result)) as T
}
const refused = (result: BrowserToolResult): string => {
  expect(result.isError, textOf(result)).toBe(true)
  return textOf(result)
}
const browserNodes = (): LayoutNode[] => store.get(PROJECT).layout.nodes.filter((node) => node.kind === 'browser')

/** A Session Node at (0, 0), 300 × 120, and a note right of it where a Browser would go first. */
function sessionAndNeighbour(): void {
  store.apply(PROJECT, { op: 'create', node: { id: `session:${SESSION}`, kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId: SESSION } } })
  store.apply(PROJECT, { op: 'create', node: { id: 'note-1', kind: 'note', x: 340, y: 0, w: 640, h: 200, data: { text: 'in the way' } } })
}

/** A Browser opened by the Session under «admin», driven by it. */
async function opened(rpc: Rpc): Promise<{ id: string; page: FakePage }> {
  const { id } = json<{ id: string }>(await rpc.call('browser_open', { profile: 'admin-aaaaaa' }))
  const page = pages.get(id)
  if (page === undefined) throw new Error('the Browser was not drawn')
  return { id, page }
}

describe('the tools of worfy-browser', () => {
  it('are listed with their schemas', async () => {
    const rpc = await connect()
    const { result } = await rpc.request('tools/list', {})
    const tools = (result as { tools: { name: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } }[] }).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual([...BROWSER_TOOL_NAMES].sort())
    const schema = (name: string) => tools.find((tool) => tool.name === name)!.inputSchema
    expect(schema('browser_open').required).toEqual(['profile'])
    expect(schema('browser_navigate').required?.sort()).toEqual(['id', 'url'])
    expect(schema('browser_type').required?.sort()).toEqual(['id', 'text'])
    expect(Object.keys(schema('browser_click').properties).sort()).toEqual(['id', 'ref', 'selector'])
    expect(schema('browser_list').properties).toEqual({})
  })

  it('refuse wrong arguments before anything happens', async () => {
    const rpc = await connect()
    expect(refused(await rpc.call('browser_open', { profile: 'Not An Id' }))).toMatch(/profile/i)
    expect(refused(await rpc.call('browser_navigate', { id: 'browser-1' }))).toMatch(/url/i)
    expect(browserNodes()).toEqual([])
  })
})

describe('browser_list', () => {
  it("names the Project's Browser profiles with their origins, and its Browsers", async () => {
    store.apply(PROJECT, { op: 'create', node: { id: 'browser-user', kind: 'browser', x: 0, y: 400, w: 640, h: 440, data: { profile: 'admin-aaaaaa', url: `${SITE}/x` } } })
    const listed = json<{ profiles: unknown[]; browsers: unknown[] }>(await (await connect()).call('browser_list'))
    expect(listed.profiles).toEqual([
      { id: 'admin-aaaaaa', name: 'admin', origins: [SITE] },
      { id: 'none-bbbbbb', name: 'nobody', origins: [] },
    ])
    expect(listed.browsers).toEqual([{ id: 'browser-user', profile: 'admin-aaaaaa', url: `${SITE}/x`, openedBy: null, live: false, control: null }])
  })
})

describe('browser_open', () => {
  it('under a Browser profile the Project does not have is refused, naming the ones it has, and makes no Browser', async () => {
    const text = refused(await (await connect()).call('browser_open', { profile: 'gone-cccccc' }))
    expect(text).toContain('gone-cccccc')
    expect(text).toContain('admin-aaaaaa (admin)')
    expect(browserNodes()).toEqual([])
  })

  it('with no profile at all says only the user creates them', async () => {
    profiles = []
    expect(refused(await (await connect()).call('browser_open', { profile: 'admin-aaaaaa' }))).toMatch(/only the user creates them/)
  })

  it('at an address outside the origins is refused before a Browser is made', async () => {
    const text = refused(await (await connect()).call('browser_open', { profile: 'admin-aaaaaa', url: `${ELSEWHERE}/` }))
    expect(text).toContain(ELSEWHERE)
    expect(browserNodes()).toEqual([])
  })

  it("makes a Browser of the profile next to the Session's Node without covering any Node, opened by the Session, and drives it", async () => {
    sessionAndNeighbour()
    const rpc = await connect()
    const answer = json<{ id: string; x: number; y: number; w: number; h: number; url: string }>(await rpc.call('browser_open', { profile: 'admin-aaaaaa', url: `${SITE}/home` }))
    const [node] = browserNodes()
    expect(node).toMatchObject({ id: answer.id, data: { profile: 'admin-aaaaaa', openedBy: SESSION } })
    // Right of the Session's Node, below the note that took the first place.
    expect(node!.x).toBe(340)
    expect(node!.y).toBeGreaterThanOrEqual(200)
    for (const other of store.get(PROJECT).layout.nodes.filter((each) => each.id !== node!.id)) {
      const apart = node!.x >= other.x + other.w || other.x >= node!.x + node!.w || node!.y >= other.y + other.h || other.y >= node!.y + node!.h
      expect(apart, other.id).toBe(true)
    }
    expect(answer.url).toBe(`${SITE}/home`)
    expect(pages.get(answer.id)!.commands('Page.navigate')).toEqual([{ url: `${SITE}/home` }])
    expect(live.control(PROJECT, answer.id)).toEqual({ mode: 'claude', sessionId: SESSION })
    expect(changes).toEqual([[answer.id, 'claude']])
  })

  it('says so when no window draws the Browser', async () => {
    const ctx = context()
    ctx.layout = { get: (projectId) => store.get(projectId), apply: (projectId, op) => store.apply(projectId, op) }
    expect(refused(await (await connect(ctx)).call('browser_open', { profile: 'admin-aaaaaa', url: `${SITE}/` }))).toMatch(/no live page/)
  })
})

describe('the origins of the Browser profile', () => {
  it('refuse browser_navigate to another port, scheme or host without moving the page', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    for (const url of [`${ELSEWHERE}/`, 'https://127.0.0.1:4100/', 'http://localhost:4100/', 'about:blank', 'javascript:alert(1)']) {
      expect(refused(await rpc.call('browser_navigate', { id, url })), url).toContain('outside the origins')
    }
    expect(page.commands('Page.navigate')).toEqual([])
    expect(json<{ url: string }>(await rpc.call('browser_navigate', { id, url: `${SITE}/ok` })).url).toBe(`${SITE}/ok`)
  })

  it('stop a redirect to another origin: the navigation is cancelled, and the answer names the origin', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.redirectTo = `${ELSEWHERE}/landing`
    const text = refused(await rpc.call('browser_navigate', { id, url: `${SITE}/redirect` }))
    expect(text).toContain(ELSEWHERE)
    expect(text).toContain('The page was not changed')
    expect(page.commands('Fetch.failRequest')).toEqual([{ requestId: 'paused-2', errorReason: 'Aborted' }])
  })

  it('stop a link the Session clicks to another origin, and let one in the list through', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.elements.set('a#away', { navigatesTo: `${ELSEWHERE}/` })
    const text = refused(await rpc.call('browser_click', { id, selector: 'a#away' }))
    expect(text).toContain(`${ELSEWHERE} is outside the origins`)
    expect(page.commands('Fetch.failRequest')).toHaveLength(1)
    page.elements.set('a#away', { navigatesTo: `${SITE}/next` })
    expect(json<{ url: string }>(await rpc.call('browser_click', { id, selector: 'a#away' })).url).toBe(`${SITE}/next`)
  })

  it('stop any whole-page navigation while a Session drives, a frame inside the page never, and nothing once the user took over', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    expect(await page.pauseRequest(`${ELSEWHERE}/by-a-script`)).toBe('failed')
    expect(await page.pauseRequest(`${ELSEWHERE}/widget`, 'frame-2')).toBe('continued')
    expect(await page.pauseRequest(`${SITE}/fine`)).toBe('continued')
    expect(live.takeOver(PROJECT, id)).toBe(true)
    // The user goes anywhere by hand.
    expect(await page.pauseRequest(`${ELSEWHERE}/by-hand`)).toBe('continued')
  })

  it('with an empty list let the Session open no page at all', async () => {
    const rpc = await connect()
    const { id } = json<{ id: string }>(await rpc.call('browser_open', { profile: 'none-bbbbbb' }))
    expect(refused(await rpc.call('browser_navigate', { id, url: `${SITE}/` }))).toContain('lists no origins')
  })
})

describe('browser_click, browser_type and the page', () => {
  it('click the middle of the element, by selector or by a ref of browser_read', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.elements.set('#save', {})
    page.elements.set('12', {})
    json(await rpc.call('browser_click', { id, selector: '#save' }))
    json(await rpc.call('browser_click', { id, ref: 12 }))
    expect(page.commands('Input.dispatchMouseEvent').filter((each) => each.type === 'mousePressed')).toEqual([
      { type: 'mousePressed', x: 50, y: 20, button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mousePressed', x: 50, y: 20, button: 'left', buttons: 1, clickCount: 1 },
    ])
    expect(refused(await rpc.call('browser_click', { id, selector: '#missing' }))).toContain('no element "#missing"')
    expect(refused(await rpc.call('browser_click', { id, ref: 99 }))).toContain('[ref=99]')
    expect(refused(await rpc.call('browser_click', { id }))).toContain('selector')
    expect(refused(await rpc.call('browser_click', { id, selector: '#save', ref: 12 }))).toContain('not both')
  })

  it('type text into a field and press Enter with submit', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.elements.set('#email', {})
    json(await rpc.call('browser_type', { id, selector: '#email', text: 'a@b.c', submit: true }))
    expect(page.commands('Input.insertText')).toEqual([{ text: 'a@b.c' }])
    expect(page.commands('Input.dispatchKeyEvent').map((each) => [each.type, each.key])).toEqual([
      ['keyDown', 'Enter'],
      ['keyUp', 'Enter'],
    ])
  })

  it('never type into a password field: the user logs in', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.elements.set('#password', { password: true })
    const text = refused(await rpc.call('browser_type', { id, selector: '#password', text: 'hunter2' }))
    expect(text).toContain(PASSWORD_REFUSED)
    expect(text).toMatch(/the user logs in/)
    expect(page.commands('Input.insertText')).toEqual([])
    expect(page.commands('Input.dispatchKeyEvent')).toEqual([])
  })

  it('answer a screenshot as a PNG image, and the page as an accessibility snapshot with refs', async () => {
    const rpc = await connect()
    const { id } = await opened(rpc)
    expect((await rpc.call('browser_screenshot', { id })).content).toEqual([{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }])
    const snapshot = textOf(await rpc.call('browser_read', { id }))
    expect(snapshot.split('\n')).toEqual(['Page: Fixture — about:blank', '- button "Save" [ref=12]', '- textbox "Email" value="a@b.c" [ref=13]'])
  })

  it(`keep the last ${BROWSER_LOG_LIMIT} console messages and network requests, without bodies`, async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    for (let n = 0; n < BROWSER_LOG_LIMIT + 5; n += 1) {
      page.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: `line ${n}` }, { type: 'number', value: n }] })
      page.emit('Network.requestWillBeSent', { requestId: `r${n}`, request: { url: `${SITE}/api/${n}`, method: 'POST', postData: 'secret body' }, type: 'Fetch' })
      page.emit('Network.responseReceived', { requestId: `r${n}`, response: { status: 201 } })
    }
    page.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is undefined' }, url: `${SITE}/app.js`, lineNumber: 9 } })
    const { messages } = json<{ messages: { level: string; text: string; source?: string }[] }>(await rpc.call('browser_console', { id }))
    expect(messages).toHaveLength(BROWSER_LOG_LIMIT)
    expect(messages[0]).toEqual({ level: 'log', text: 'line 6 6' })
    expect(messages.at(-1)).toEqual({ level: 'exception', text: 'TypeError: x is undefined', source: `${SITE}/app.js:10` })
    const { requests } = json<{ requests: Record<string, unknown>[] }>(await rpc.call('browser_network', { id }))
    expect(requests).toHaveLength(BROWSER_LOG_LIMIT)
    expect(requests[0]).toEqual({ method: 'POST', url: `${SITE}/api/5`, type: 'Fetch', status: 201 })
    expect(JSON.stringify(requests)).not.toContain('secret body')
  })
})

describe('taking a Browser over', () => {
  it("refuses every call after the user's click on the page, until they give it back; then the Session drives again", async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.input('mouseDown')
    expect(live.control(PROJECT, id)?.mode).toBe('user')
    expect(changes.at(-1)).toEqual([id, 'user'])
    for (const [name, args] of [
      ['browser_navigate', { id, url: `${SITE}/` }],
      ['browser_screenshot', { id }],
      ['browser_read', { id }],
    ] as const) {
      expect(refused(await rpc.call(name, args)), name).toContain(TAKEN_OVER)
    }
    // Still refused: nobody gave it back.
    expect(refused(await rpc.call('browser_console', { id }))).toContain('Return control to Claude')
    expect(live.giveBack(PROJECT, id)).toBe(true)
    expect(changes.at(-1)).toEqual([id, 'claude'])
    expect(json<{ url: string }>(await rpc.call('browser_navigate', { id, url: `${SITE}/again` })).url).toBe(`${SITE}/again`)
  })

  it('a key of the user takes it over too; a mouse move or a scroll does not', async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.input('mouseMove')
    page.input('mouseWheel')
    expect(live.control(PROJECT, id)?.mode).toBe('claude')
    page.input('rawKeyDown')
    expect(live.control(PROJECT, id)?.mode).toBe('user')
  })

  it("the Session's own clicks and keys are not a takeover", async () => {
    const rpc = await connect()
    const { id, page } = await opened(rpc)
    page.elements.set('#field', {})
    json(await rpc.call('browser_click', { id, selector: '#field' }))
    json(await rpc.call('browser_type', { id, selector: '#field', text: 'x', submit: true }))
    expect(live.control(PROJECT, id)?.mode).toBe('claude')
  })

  it('another Session may not drive a Browser one drives', async () => {
    const { id } = await opened(await connect())
    const other = await connect(context({ sessionId: () => 'sess-b' }))
    expect(refused(await other.call('browser_screenshot', { id }))).toMatch(/Another Session drives this Browser/)
  })

  it('a Browser nobody drives is not taken over by a click', async () => {
    store.apply(PROJECT, { op: 'create', node: { id: 'browser-mine', kind: 'browser', x: 0, y: 0, w: 640, h: 440, data: { profile: 'admin-aaaaaa' } } })
    drawBrowsers()
    pages.get('browser-mine')!.input('mouseDown')
    expect(live.control(PROJECT, 'browser-mine')).toBeNull()
    expect(changes).toEqual([])
  })
})

describe('the Browser server of a Session', () => {
  const request = (cwd: string, more: Partial<QueryRequest> = {}): QueryRequest => ({
    prompt: (async function* () {})(),
    cwd,
    resume: undefined,
    stderr: () => undefined,
    settings: DEFAULT_SETTINGS,
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }),
    ...more,
  })
  const options = (): Record<string, unknown> => (mocks.query.mock.calls.at(-1) as [{ options: Record<string, unknown> }])[0].options
  const canvas = { attachment: { server: { type: 'sdk', name: CANVAS_SERVER_NAME } as never, cardsDir: '/data/cards', instructions: 'canvas' }, observe: <T>(query: T) => query }

  it("is passed to a Session in a Project with the Profile's list naming worfy-canvas, with its instructions after the canvas ones", async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    await sdkQueryFactory(() => Promise.resolve(canvas), () => Promise.resolve(['qmd', CANVAS_SERVER_NAME]))(request(join(scratch, 'repo')))
    expect(options().mcpServers).toMatchObject({ [CANVAS_SERVER_NAME]: { name: CANVAS_SERVER_NAME }, [BROWSER_SERVER_NAME]: { type: 'sdk', name: BROWSER_SERVER_NAME } })
    expect((options().systemPrompt as { append: string }).append).toMatch(/^canvas\n[\s\S]*worfy-browser/)
  })

  it('is not passed to an unattended Session: Autopilot uses only the profiles marked for it (worfy-browser ticket 08)', async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    await sdkQueryFactory(() => Promise.resolve(canvas), () => Promise.resolve(['qmd', CANVAS_SERVER_NAME]))(request(join(scratch, 'repo'), { unattended: true }))
    expect(options().mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvas.attachment.server })
  })

  it('is not passed when the list leaves worfy-browser out', async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    await sdkQueryFactory(() => Promise.resolve(canvas), () => Promise.resolve(['qmd']))(request(join(scratch, 'repo')))
    expect(options()).not.toHaveProperty('mcpServers')
  })
})
