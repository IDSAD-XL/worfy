// The frames of a Live Browser for the other screens (worfy-browser ticket 07, ADR-0078 items 9, 14
// and 16) over a mocked `electron` and a temporary WORFY_DATA_DIR: the real handler modules of the
// `browser` and `layout` domains (src/main/ipc/browser.ts, src/main/ipc/layout.ts), served to two
// Linked machines through the link adapter (src/main/link/ipc-adapter.ts) as a connection serves
// them — one with full access, one read-only — and to the windows of this Machine.
//
// The page of the Browser is a fake guest whose debugger keeps every CDP command and sends the
// events a test asks for (`Page.screencastFrame`). Never run here: a real Electron, the network.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CdpContents, CdpDebugger } from '../../src/main/browser/cdp'
import { addClient } from '../../src/main/broadcast'
import { createLinkIpc, LinkPeer, readOnlyRefusal, type LinkIpcAdapter } from '../../src/main/link/ipc-adapter'
import type { IpcResult } from '../../src/shared/ipc/channels'
import type { AccessLevel } from '../../src/shared/ipc/link'
import type { LayoutNode } from '../../src/shared/layout/types'
import { removeTestTree, saveLayoutNow } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the stores of the running app sit over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-browser-frames-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

/** A window of this Machine as main's clients see it: what it was sent. */
interface FakeWindow {
  id: number
  sent: [string, unknown][]
}

const windows = vi.hoisted(() => [] as { id: number; sent: [string, unknown][] }[])

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/', getVersion: () => '0.0.0' },
  BrowserWindow: {
    getAllWindows: () =>
      windows.map((window) => ({
        isDestroyed: () => false,
        webContents: { id: window.id, send: (channel: string, payload: unknown) => window.sent.push([channel.replace(/^worfy:/, ''), payload]), isDestroyed: () => false, once: () => undefined },
      })),
    fromWebContents: () => null,
  },
  webContents: { fromId: () => undefined },
  session: { fromPartition: () => ({}) },
}))

const PROJECT = 'demo-0a1b2c3d'
const NODE = 'b1'
const SECRET_URL = 'http://127.0.0.1:4100/admin/users?token=s3cret'
const MACHINE = 'Here'

type Listener = (...args: unknown[]) => void

/** The guest page of a Browser: its debugger keeps every command, and `event` sends a CDP event to its listeners. */
class FakePage implements CdpContents {
  private static next = 100
  readonly id = FakePage.next++
  destroyed = false
  /** Whether its window has a `beforeunload` handler: a form the user has not sent. */
  beforeunload = false
  /** While set, the page answers where it is scrolled only once this settles. */
  scrollHeld: Promise<void> | undefined
  /** The CDP commands that fail. */
  readonly failing = new Set<string>()
  private attached = false
  private readonly listeners = new Map<string, Set<Listener>>()
  readonly sent: { method: string; params: unknown }[] = []
  readonly debugger: CdpDebugger = {
    attach: () => void (this.attached = true),
    isAttached: () => this.attached,
    sendCommand: (method, params) => {
      this.sent.push({ method, params })
      if (this.failing.has(method)) return Promise.reject(new Error(`${method} failed`))
      if (method === 'Runtime.evaluate') {
        const answer = { result: { value: [0, 0], objectId: 'window-1' } }
        const expression = (params as { expression?: string } | undefined)?.expression
        return expression === '[scrollX, scrollY]' && this.scrollHeld !== undefined ? this.scrollHeld.then(() => answer) : Promise.resolve(answer)
      }
      if (method === 'DOMDebugger.getEventListeners') return Promise.resolve({ listeners: this.beforeunload ? [{ type: 'beforeunload' }] : [] })
      if (method === 'Page.captureScreenshot') return Promise.resolve({ data: '/9j/picture' })
      return Promise.resolve({})
    },
    on: ((event: string, listener: Listener) => this.listen(`debugger:${event}`, listener)) as CdpDebugger['on'],
  }
  methods(): string[] {
    return this.sent.map((each) => each.method)
  }
  /** A CDP event of the page, as the debugger's `message` hands it over. */
  event(method: string, params: Record<string, unknown>): void {
    for (const listener of this.listeners.get('debugger:message') ?? []) listener({}, method, params)
  }
  /** One frame of the screencast. */
  frame(data: string, sessionId: number): void {
    this.event('Page.screencastFrame', { data, sessionId, metadata: { deviceWidth: 640, deviceHeight: 400, offsetTop: 0, pageScaleFactor: 1, scrollOffsetX: 0, scrollOffsetY: 0 } })
  }
  /** How many listeners of `event` the page has. */
  listenersOf(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
  /** Something else took the debugger (DevTools): it detaches. */
  detach(): void {
    this.attached = false
    for (const listener of this.listeners.get('debugger:detach') ?? []) listener({}, 'target closed')
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return SECRET_URL
  }
  getTitle(): string {
    return ''
  }
  isFocused(): boolean {
    return false
  }
  readonly on = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['on']
  readonly once = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['once']
  private listen(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }
  close(): void {
    this.destroyed = true
    for (const listener of this.listeners.get('destroyed') ?? []) listener()
  }
}

/** A Linked machine on a connection to this one: what it was pushed, and its calls. */
interface Linked {
  peer: LinkPeer
  got: [string, unknown][]
  call(channel: string, input: unknown): Promise<IpcResult<unknown>>
  /** The payloads of event `channel` it was pushed. */
  events(channel: string): unknown[]
}

let adapter: LinkIpcAdapter
let live: typeof import('../../src/main/browser/live')
let screencast: typeof import('../../src/main/browser/screencast')
let layout: typeof import('../../src/main/layout/store')
const peers: LinkPeer[] = []

function linked(machineId: string, level: AccessLevel): Linked {
  const got: [string, unknown][] = []
  const peer = new LinkPeer({ machineId, describe: () => machineId, push: (channel, payload) => got.push([channel, payload]), local: () => ({ id: 'here', name: MACHINE, protocol: 1, build: 'test' }), addClient, warn: () => undefined })
  peer.setAccess(level)
  peers.push(peer)
  return {
    peer,
    got,
    call: (channel, input) => adapter.call(peer, channel, input, MACHINE),
    events: (channel) => got.filter(([name]) => name === channel).map(([, payload]) => payload),
  }
}

const browserNode: LayoutNode = { id: NODE, kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { profile: 'default', url: SECRET_URL } }

beforeAll(async () => {
  const dataDir = join(env.scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  mkdirSync(join(env.scratch, 'repo'), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: join(env.scratch, 'repo') }], activeId: PROJECT }))
  live = await import('../../src/main/browser/live')
  screencast = await import('../../src/main/browser/screencast')
  layout = await import('../../src/main/layout/store')
  adapter = await createLinkIpc({
    modules: {
      './browser.ts': () => import('../../src/main/ipc/browser').then((module) => module.default),
      './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default),
    },
    isLinked: () => true,
  })
  layout.layoutStore().apply(PROJECT, { op: 'create', node: browserNode })
})

afterAll(async () => {
  live.stopLiveBrowsers()
  await saveLayoutNow()
  removeTestTree(env.scratch)
})

afterEach(() => {
  vi.useRealTimers()
  for (const peer of peers.splice(0)) peer.close()
  // A test that let a Session drive the Browser leaves it to nobody.
  live.liveBrowsers().release(PROJECT, NODE)
})

/** Window `id` of this Machine shows the Project, with the Browser on screen or not. */
async function windowShows(id: number, visible: string[]): Promise<FakeWindow> {
  let window = windows.find((each) => each.id === id)
  if (window === undefined) {
    window = { id, sent: [] }
    windows.push(window)
  }
  await live.liveBrowsers().screen(id, { projectId: PROJECT, visible, zoom: 1 })
  return window
}

/** The page window `id` draws for the Browser, as its Browser layer tells main of it. */
function draws(id: number): FakePage {
  const page = new FakePage()
  expect(live.liveBrowsers().register(PROJECT, NODE, page, id)).not.toBeNull()
  return page
}

let current: FakePage | undefined

/**
 * The page of the Browser now, drawn by the window that owns it: window 1 shows the Browser, and the
 * Browser is woken and its page drawn when it has none. Each test takes it anew, so any one runs alone.
 */
async function livePage(): Promise<FakePage> {
  await windowShows(1, [NODE])
  const browsers = live.liveBrowsers()
  if (current !== undefined && browsers.page(PROJECT, NODE)?.contents === current) return current
  if (browsers.lives(PROJECT).find((each) => each.nodeId === NODE)?.live !== true) await browsers.wake(PROJECT, NODE, 'user')
  const owner = browsers.ownerOf(PROJECT, NODE)
  if (owner === null) throw new Error('no window owns the page')
  current = new FakePage()
  expect(browsers.register(PROJECT, NODE, current, owner)).not.toBeNull()
  return current
}

/** Only window 1 of this Machine shows the Project: window 2 closed, and the page drawn before is gone. */
function oneWindow(): void {
  const second = windows.findIndex((each) => each.id === 2)
  if (second >= 0) windows.splice(second, 1)
  live.liveBrowsers().dropScreen(2)
  current?.close()
}

/** Windows 1 and 2 show the Browser, and window 1 draws its page. */
async function twoWindows(): Promise<FakePage> {
  oneWindow()
  const page = await livePage()
  await windowShows(2, [NODE])
  expect(live.liveBrowsers().ownerOf(PROJECT, NODE)).toBe(1)
  return page
}

/** The user scrolls the frames of the Browser in window 2, then lets them rest past MOVE_REST_MS (fake timers). */
async function scrollInSecondWindow(): Promise<void> {
  await live.liveBrowsers().input(PROJECT, NODE, wheel, 2)
  await vi.advanceTimersByTimeAsync(live.MOVE_REST_MS + 100)
  await vi.advanceTimersByTimeAsync(5_000)
}

/** A window of this Machine as the `browser` handlers get it: a webContents that reports the documents it commits. */
interface FakeSender {
  id: number
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
  once(event: string, listener: Listener): void
  on(event: string, listener: Listener): void
  /** Emits a webContents event, as Electron does. */
  fire(event: string, ...args: unknown[]): void
}

function sender(id: number): FakeSender {
  const listeners = new Map<string, Listener[]>()
  const add = (event: string, listener: Listener) => void listeners.set(event, [...(listeners.get(event) ?? []), listener])
  return { id, send: () => undefined, isDestroyed: () => false, once: add, on: add, fire: (event, ...args) => listeners.get(event)?.forEach((listener) => listener(...args)) }
}

/** Window `from` reports what it shows through the real `browser.screen` handler (src/main/ipc/browser.ts). */
async function reportScreen(from: FakeSender, projectId: string, visible: string[]): Promise<void> {
  const handlers = (await import('../../src/main/ipc/browser')).default
  const screen = handlers.find((each) => each.channel.name === 'browser.screen')
  if (screen === undefined) throw new Error('browser.screen has no handler')
  await screen.handle({ projectId, visible, zoom: 1 } as never, { event: { sender: from } as never })
}

/** Whether the last `browser.lives.changed` of Project `projectId` that `window` got says it draws the page. */
function hereIn(window: FakeWindow, projectId = PROJECT): boolean | undefined {
  const last = window.sent.filter(([channel, payload]) => channel === 'browser.lives.changed' && (payload as { projectId: string }).projectId === projectId).at(-1)?.[1] as { lives: { nodeId: string; here: boolean }[] } | undefined
  return last?.lives.find((each) => each.nodeId === NODE)?.here
}

const click = { kind: 'mouse', type: 'mousePressed', x: 12, y: 30, button: 'left', clickCount: 1, modifiers: 0 } as const
const wheel = { kind: 'wheel', x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 } as const

describe('frames and input of a Live Browser for a Linked machine', () => {
  it('a read-only Linked machine gets no frames: its watch is refused, and the frames a full one gets never reach it', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    const readOnly = linked('mac-ro', 'read')
    // Nobody watches yet: the screencast is off.
    expect(page.methods()).not.toContain('Page.startScreencast')

    expect(await readOnly.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen: 'screen-ro', watch: true })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(page.methods()).not.toContain('Page.startScreencast')

    expect(await full.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen: 'screen-full', watch: true })).toEqual({ ok: true, value: {} })
    await vi.waitFor(() => expect(page.methods()).toContain('Page.startScreencast'))
    page.frame('/9j/frame-1', 7)
    await vi.waitFor(() => expect(full.events('browser.frame')).toHaveLength(1))
    expect(full.events('browser.frame')[0]).toEqual({ projectId: PROJECT, nodeId: NODE, image: '/9j/frame-1', width: 640, height: 400 })
    // Each frame is acknowledged, so Chromium sends the next one.
    await vi.waitFor(() => expect(page.sent).toContainEqual({ method: 'Page.screencastFrameAck', params: { sessionId: 7 } }))
    // The read-only Machine got none, and no other event that carries the page.
    expect(readOnly.events('browser.frame')).toEqual([])
    expect(readOnly.events('browser.lives.changed')).toEqual([])
  })

  it('a full Linked machine sends input to the page; a read-only one is refused before anything reaches it', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    const readOnly = linked('mac-ro', 'read')
    const before = page.sent.length
    expect(await readOnly.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: click })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(await readOnly.call('browser.navigate', { projectId: PROJECT, nodeId: NODE, url: 'https://example.com/' })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(page.sent.slice(before).map((each) => each.method)).not.toContain('Input.dispatchMouseEvent')

    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: click })).toEqual({ ok: true, value: {} })
    expect(page.sent).toContainEqual({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 12, y: 30, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 } })
    const key = { kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', keyCode: 65, modifiers: 0 }
    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: key })).toEqual({ ok: true, value: {} })
    expect(page.sent).toContainEqual({ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a', windowsVirtualKeyCode: 65, modifiers: 0 } })
    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: wheel })).toEqual({ ok: true, value: {} })
    expect(page.sent).toContainEqual({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 } })
  })

  it('a read-only Linked machine gets no picture of an Asleep page and no lives, but reads the Browser profile name', async () => {
    const readOnly = linked('mac-ro', 'read')
    const full = linked('mac-full', 'all')
    expect(await readOnly.call('browser.picture', { projectId: PROJECT, nodeId: NODE })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(await readOnly.call('browser.lives.list', { projectId: PROJECT })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(await readOnly.call('browser.wake', { projectId: PROJECT, nodeId: NODE })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(await readOnly.call('browser.screen', { projectId: PROJECT, visible: [NODE], zoom: 1, screen: 'screen-ro' })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(await readOnly.call('browser.profiles.list', { projectId: PROJECT })).toEqual({ ok: true, value: { profiles: [{ id: 'default', name: 'Default', origins: [], autopilot: false }] } })
    // A full one reads them; it never draws the page itself.
    const lives = await full.call('browser.lives.list', { projectId: PROJECT })
    expect(lives).toEqual({ ok: true, value: { projectId: PROJECT, lives: [expect.objectContaining({ nodeId: NODE, live: true, here: false })] } })
    expect(await full.call('browser.picture', { projectId: PROJECT, nodeId: NODE })).toEqual({ ok: true, value: { picture: null } })
  })

  it('the Layout a read-only Linked machine gets has no address of a Browser, in `layout.get` and in `layout.changed`', async () => {
    const readOnly = linked('mac-ro', 'read')
    const full = linked('mac-full', 'all')
    const got = await readOnly.call('layout.get', { projectId: PROJECT })
    if (!got.ok) throw new Error(got.error)
    const browser = (got.value as { layout: { nodes: LayoutNode[] } }).layout.nodes.find((node) => node.id === NODE)
    expect(browser?.data).toEqual({ profile: 'default' })
    const fullGot = await full.call('layout.get', { projectId: PROJECT })
    expect(fullGot.ok && (fullGot.value as { layout: { nodes: LayoutNode[] } }).layout.nodes.find((node) => node.id === NODE)?.data.url).toBe(SECRET_URL)

    const next = 'http://127.0.0.1:4100/admin/next?token=other'
    layout.layoutStore().apply(PROJECT, { op: 'patchData', id: NODE, data: { url: next } })
    const create: LayoutNode = { ...browserNode, id: 'b2', x: 2000, data: { profile: 'default', url: next } }
    layout.layoutStore().apply(PROJECT, { op: 'create', node: create })
    await vi.waitFor(() => expect(readOnly.events('layout.changed')).toHaveLength(2))
    expect(JSON.stringify(readOnly.events('layout.changed'))).not.toContain('127.0.0.1:4100')
    expect(JSON.stringify(full.events('layout.changed'))).toContain(next)
    // Another key of the same patch still reaches it.
    layout.layoutStore().apply(PROJECT, { op: 'patchData', id: NODE, data: { url: SECRET_URL, profile: 'default' } })
    await vi.waitFor(() => expect(readOnly.events('layout.changed')).toHaveLength(3))
    expect(readOnly.events('layout.changed')[2]).toMatchObject({ op: { op: 'patchData', id: NODE, data: { profile: 'default' } } })
    expect(JSON.stringify(readOnly.events('layout.changed'))).not.toContain('127.0.0.1:4100')
    layout.layoutStore().apply(PROJECT, { op: 'remove', id: 'b2' })
  })

  it('no frames while nobody watches: the last watcher stops the screencast, and a frame after it goes nowhere', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    expect(await full.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen: 'screen-full', watch: true })).toEqual({ ok: true, value: {} })
    expect(await full.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen: 'screen-full', watch: false })).toEqual({ ok: true, value: {} })
    await vi.waitFor(() => expect(page.methods().at(-1)).toBe('Page.stopScreencast'))
    page.frame('/9j/unwatched', 9)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(full.events('browser.frame')).toEqual([])
    // A watcher whose connection closes is no watcher any more.
    expect(await full.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen: 'screen-full', watch: true })).toEqual({ ok: true, value: {} })
    await vi.waitFor(() => expect(page.methods().at(-1)).toBe('Page.startScreencast'))
    full.peer.close()
    await vi.waitFor(() => expect(page.methods().at(-1)).toBe('Page.stopScreencast'))
  })

  it('a Browser seen on a Linked machine does not sleep while this Machine\'s window does not show it; it sleeps once no screen does', async () => {
    await livePage()
    vi.useFakeTimers({ toFake: ['Date'] })
    const full = linked('mac-full', 'all')
    await windowShows(1, [])
    expect(await full.call('browser.screen', { projectId: PROJECT, visible: [NODE], zoom: 1, screen: 'screen-full' })).toEqual({ ok: true, value: {} })
    vi.setSystemTime(Date.now() + 40_000)
    await live.liveBrowsers().check()
    expect(live.liveBrowsers().lives(PROJECT).find((each) => each.nodeId === NODE)?.live).toBe(true)
    // It keeps telling what it shows; then it shows the Browser no more.
    expect(await full.call('browser.screen', { projectId: PROJECT, visible: [], zoom: 1, screen: 'screen-full' })).toEqual({ ok: true, value: {} })
    vi.setSystemTime(Date.now() + 40_000)
    await live.liveBrowsers().check()
    expect(live.liveBrowsers().lives(PROJECT).find((each) => each.nodeId === NODE)?.live).toBe(false)
  })
})

describe('one Live page of a Browser for every window of this Machine', () => {
  it('only the window that works with it last draws the page; the others are told to show frames, and a page of another window is refused', async () => {
    oneWindow()
    // Woken again by a click on the frame of window 1.
    await live.liveBrowsers().wake(PROJECT, NODE, 'user')
    const first = await windowShows(1, [NODE])
    const second = await windowShows(2, [NODE])
    const here = (window: FakeWindow) => {
      const last = window.sent.filter(([channel]) => channel === 'browser.lives.changed').at(-1)?.[1] as { lives: { nodeId: string; here: boolean }[] } | undefined
      return last?.lives.find((each) => each.nodeId === NODE)?.here
    }
    expect(live.liveBrowsers().lives(PROJECT, 1)).toEqual([expect.objectContaining({ nodeId: NODE, live: true, here: true })])
    expect(live.liveBrowsers().lives(PROJECT, 2)).toEqual([expect.objectContaining({ nodeId: NODE, live: true, here: false })])
    const drawn = draws(1)
    // Window 2 cannot hand main a second page of the Browser.
    expect(live.liveBrowsers().register(PROJECT, NODE, new FakePage(), 2)).toBeNull()
    // The user works in the frames of window 2: once that rests, the page moves there.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await live.liveBrowsers().input(PROJECT, NODE, { kind: 'mouse', type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1, modifiers: 0 }, 2)
    await live.liveBrowsers().input(PROJECT, NODE, { kind: 'mouse', type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1, modifiers: 0 }, 2)
    await vi.advanceTimersByTimeAsync(live.MOVE_REST_MS - 100)
    expect(here(second)).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    await vi.waitFor(() => expect(here(second)).toBe(true))
    vi.useRealTimers()
    expect(here(first)).toBe(false)
    expect(live.liveBrowsers().register(PROJECT, NODE, new FakePage(), 1)).toBeNull()
    drawn.close()
    expect(live.liveBrowsers().register(PROJECT, NODE, new FakePage(), 2)).not.toBeNull()
    // Window 2 closes: window 1 draws the page again.
    windows.splice(windows.indexOf(second), 1)
    live.liveBrowsers().dropScreen(2)
    await vi.waitFor(() => expect(here(first)).toBe(true))
  })
})

describe('a move of the page to another window loses nothing', () => {
  it('the page does not move while a Session drives the Browser or a call of one runs on it; it moves once nobody does', async () => {
    const page = await twoWindows()
    const browsers = live.liveBrowsers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // A scroll is no takeover: the Session keeps driving, and the page it works on stays.
    browsers.drive(PROJECT, NODE, 'session-1')
    await scrollInSecondWindow()
    expect(browsers.control(PROJECT, NODE)?.mode).toBe('claude')
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(1)
    expect(browsers.page(PROJECT, NODE)?.contents).toBe(page)
    // The Session let go, but a call of it still runs.
    browsers.release(PROJECT, NODE)
    browsers.sessionDrives(PROJECT, NODE)
    await scrollInSecondWindow()
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(1)
    expect(browsers.page(PROJECT, NODE)?.contents).toBe(page)
    // The call ended: the next scroll moves the page.
    browsers.sessionReleases(PROJECT, NODE)
    await scrollInSecondWindow()
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(2)
    expect(browsers.page(PROJECT, NODE)).toBeUndefined()
  })

  it('a page with a beforeunload handler (a form the user has not sent) does not move; it moves once it has none', async () => {
    const page = await twoWindows()
    const browsers = live.liveBrowsers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    page.beforeunload = true
    await scrollInSecondWindow()
    expect(page.methods()).toContain('DOMDebugger.getEventListeners')
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(1)
    expect(browsers.page(PROJECT, NODE)?.contents).toBe(page)
    page.beforeunload = false
    await scrollInSecondWindow()
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(2)
  })

  it('a call that begins while main reads where the page is scrolled keeps the page where it is', async () => {
    const page = await twoWindows()
    const browsers = live.liveBrowsers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let answer = (): void => undefined
    page.scrollHeld = new Promise<void>((resolve) => (answer = resolve))
    const scrollAsked = () => page.sent.some((each) => (each.params as { expression?: string } | undefined)?.expression === '[scrollX, scrollY]')
    await browsers.input(PROJECT, NODE, wheel, 2)
    await vi.advanceTimersByTimeAsync(live.MOVE_REST_MS + 100)
    for (let turn = 0; turn < 50 && !scrollAsked(); turn += 1) await vi.advanceTimersByTimeAsync(0)
    expect(scrollAsked()).toBe(true)
    // A Session's call begins before the page answers.
    browsers.sessionDrives(PROJECT, NODE)
    answer()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(1)
    expect(browsers.page(PROJECT, NODE)?.contents).toBe(page)
    browsers.sessionReleases(PROJECT, NODE)
    page.scrollHeld = undefined
  })

  it('a takeover and a hold outlive the move, and the ask before a Session leaves reaches the page the new window draws', async () => {
    const page = await twoWindows()
    const browsers = live.liveBrowsers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // A click in the frames of window 2 takes the Browser over from the Session; the user drives
    // it no more, so the page moves there once the input rests, and the takeover goes with it.
    browsers.drive(PROJECT, NODE, 'session-1')
    await browsers.input(PROJECT, NODE, click, 2)
    await vi.advanceTimersByTimeAsync(live.MOVE_REST_MS + 100)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(2)
    expect(browsers.control(PROJECT, NODE)).toEqual({ mode: 'user', sessionId: 'session-1' })
    expect(browsers.staysWithUser(PROJECT, NODE)).toBe(true)
    page.close()
    const moved = draws(2)
    // Nobody drives it now; a form the user has not sent in the moved page keeps the Browser with
    // the user when its Session leaves: the ask goes to the new page, not the closed one.
    browsers.release(PROJECT, NODE)
    moved.beforeunload = true
    await browsers.askUnsaved(PROJECT, [NODE])
    expect(moved.methods()).toContain('DOMDebugger.getEventListeners')
    expect(browsers.staysWithUser(PROJECT, NODE)).toBe(true)
    moved.beforeunload = false
    await browsers.askUnsaved(PROJECT, [NODE])
    expect(browsers.staysWithUser(PROJECT, NODE)).toBe(false)
    // The ⌘Z of the Session's Hide gives the user the takeover again; a move back to window 1 keeps it.
    expect(browsers.holdForUser(PROJECT, NODE, 'session-1')).toBe(true)
    await browsers.input(PROJECT, NODE, wheel, 1)
    await vi.advanceTimersByTimeAsync(live.MOVE_REST_MS + 100)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(browsers.ownerOf(PROJECT, NODE)).toBe(1)
    expect(browsers.control(PROJECT, NODE)).toEqual({ mode: 'user', sessionId: 'session-1' })
    moved.close()
  })
})

describe('the owner window shows something else', () => {
  it('a new document in the owner window (a reload, a Linked machine\'s Project) hands the page to the other window', async () => {
    oneWindow()
    const page = await livePage()
    const first = sender(1)
    await reportScreen(first, PROJECT, [NODE])
    const second = await windowShows(2, [NODE])
    expect(live.liveBrowsers().ownerOf(PROJECT, NODE)).toBe(1)
    // Its new document reports to a Linked machine, not here: only the commit tells main.
    first.fire('did-navigate', {}, 'app://index.html', -1, '')
    expect(live.liveBrowsers().ownerOf(PROJECT, NODE)).toBe(2)
    expect(hereIn(second)).toBe(true)
    page.close()
    expect(live.liveBrowsers().register(PROJECT, NODE, new FakePage(), 2)).not.toBeNull()
    oneWindow()
    await windowShows(1, [NODE])
  })

  it('a window that moves to a Project main has no Browsers of tells the other windows of the old Project who draws the page now', async () => {
    oneWindow()
    const page = await livePage()
    const second = await windowShows(2, [NODE])
    expect(live.liveBrowsers().ownerOf(PROJECT, NODE)).toBe(1)
    second.sent.length = 0
    await live.liveBrowsers().screen(1, { projectId: 'linked-0a1b2c3d', visible: [], zoom: 1 })
    expect(live.liveBrowsers().ownerOf(PROJECT, NODE)).toBe(2)
    expect(hereIn(second)).toBe(true)
    page.close()
    oneWindow()
    await windowShows(1, [NODE])
  })
})

describe('the input and the address of another screen', () => {
  it('a click in the frames of a Linked machine takes the Browser over from a Session; a scroll does not', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    const browsers = live.liveBrowsers()
    const window = windows.find((each) => each.id === 1)
    browsers.drive(PROJECT, NODE, 'session-1')
    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: wheel })).toEqual({ ok: true, value: {} })
    expect(browsers.control(PROJECT, NODE)?.mode).toBe('claude')
    const before = window?.sent.length ?? 0
    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: click })).toEqual({ ok: true, value: {} })
    expect(page.methods().at(-1)).toBe('Input.dispatchMouseEvent')
    expect(browsers.control(PROJECT, NODE)).toEqual({ mode: 'user', sessionId: 'session-1' })
    // Every window shows the banner «Return control to Claude».
    expect(window?.sent.slice(before)).toContainEqual(['browser.control.changed', { projectId: PROJECT, nodeId: NODE, mode: 'user' }])
  })

  it('the address bar of another screen opens only an http or https address', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<p>hi</p>', 'about:blank', 'not an address']) {
      const result = await full.call('browser.navigate', { projectId: PROJECT, nodeId: NODE, url })
      expect(result.ok, url).toBe(false)
    }
    expect(page.methods()).not.toContain('Page.navigate')
    expect(await full.call('browser.navigate', { projectId: PROJECT, nodeId: NODE, url: 'https://example.com/a?b=1' })).toEqual({ ok: true, value: {} })
    expect(page.sent).toContainEqual({ method: 'Page.navigate', params: { url: 'https://example.com/a?b=1' } })
  })

  it('a Linked machine cannot wake a Browser while no window of this Machine shows its Project', async () => {
    await livePage()
    const full = linked('mac-full', 'all')
    live.liveBrowsers().dropScreen(1)
    live.liveBrowsers().dropScreen(2)
    const answer = await full.call('browser.wake', { projectId: PROJECT, nodeId: NODE })
    expect(answer.ok).toBe(false)
    expect(answer.ok ? '' : answer.error).toContain(live.NOT_SHOWN)
    await windowShows(1, [NODE])
    expect(await full.call('browser.wake', { projectId: PROJECT, nodeId: NODE })).toMatchObject({ ok: true })
  })
})

describe('a watch of the frames ends without its screen', () => {
  it('a watch not told again within FRAMES_WATCH_MS ends; a screen that tells it again keeps the frames', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    const frames = screencast.browserScreencasts()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const watch = (screen: string) => full.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen, watch: true })
    // Two windows of one Linked machine watch; one of them closes without a word.
    expect(await watch('screen-a')).toEqual({ ok: true, value: {} })
    expect(await watch('screen-b')).toEqual({ ok: true, value: {} })
    expect(page.methods().at(-1)).toBe('Page.startScreencast')
    expect(frames.watching(PROJECT, NODE)).toBe(2)
    await vi.advanceTimersByTimeAsync(screencast.FRAMES_WATCH_MS - 20_000)
    expect(await watch('screen-a')).toEqual({ ok: true, value: {} })
    await vi.advanceTimersByTimeAsync(20_000 + 100)
    await frames.sync(PROJECT, NODE)
    expect(frames.watching(PROJECT, NODE)).toBe(1)
    expect(page.methods().at(-1)).not.toBe('Page.stopScreencast')
    // The other stops telling it too: the screencast stops.
    await vi.advanceTimersByTimeAsync(screencast.FRAMES_WATCH_MS)
    await frames.sync(PROJECT, NODE)
    expect(frames.watching(PROJECT, NODE)).toBe(0)
    expect(page.methods().at(-1)).toBe('Page.stopScreencast')
  })

  it('the screencast starts again after the debugger detached, on the next page of the Browser, and after a start that failed', async () => {
    const page = await livePage()
    const full = linked('mac-full', 'all')
    const starts =(of: FakePage) => of.methods().filter((method) => method === 'Page.startScreencast').length
    const watch = () => full.call('browser.frames.watch', { projectId: PROJECT, nodeId: NODE, screen: 'screen-full', watch: true })
    expect(await watch()).toEqual({ ok: true, value: {} })
    const before = starts(page)
    // DevTools took the page: Chromium sends no frame any more, so main starts it again.
    page.detach()
    await vi.waitFor(() => expect(starts(page)).toBe(before + 1))
    page.frame('/9j/after-detach', 11)
    await vi.waitFor(() => expect(full.events('browser.frame')).toContainEqual(expect.objectContaining({ image: '/9j/after-detach' })))
    // A lost acknowledgement ends it the same way.
    page.failing.add('Page.screencastFrameAck')
    page.frame('/9j/unacked', 12)
    await vi.waitFor(() => expect(starts(page)).toBe(before + 2))
    page.failing.delete('Page.screencastFrameAck')
    // The window draws a new page: the screencast goes on there.
    page.close()
    const next = await livePage()
    await vi.waitFor(() => expect(starts(next)).toBe(1))
    const listening = next.listenersOf('destroyed')
    // A start that fails is not kept: the watch told again starts it.
    next.failing.add('Page.startScreencast')
    next.detach()
    await vi.waitFor(() => expect(starts(next)).toBe(2))
    next.failing.delete('Page.startScreencast')
    expect(await watch()).toEqual({ ok: true, value: {} })
    expect(starts(next)).toBe(3)
    // The page is listened to for its close once, however often its screencast started.
    expect(next.listenersOf('destroyed')).toBe(listening)
  })
})

describe('the screens of a Linked machine for the rules of sleep', () => {
  it('a report not told again counts no more after LINKED_SCREEN_MS, and none counts once the connection closes', async () => {
    await livePage()
    vi.useFakeTimers({ toFake: ['Date'] })
    const browsers = live.liveBrowsers()
    const liveNow = () => browsers.lives(PROJECT).find((each) => each.nodeId === NODE)?.live
    const full = linked('mac-full', 'all')
    await windowShows(1, [])
    expect(await full.call('browser.screen', { projectId: PROJECT, visible: [NODE], zoom: 1, screen: 'screen-full' })).toEqual({ ok: true, value: {} })
    vi.setSystemTime(Date.now() + 40_000)
    await browsers.check()
    expect(liveNow()).toBe(true)
    // Not told again: past LINKED_SCREEN_MS it counts no more, and the Browser is off every screen.
    vi.setSystemTime(Date.now() + 35_000)
    await browsers.check()
    expect(liveNow()).toBe(false)

    await browsers.wake(PROJECT, NODE, 'user')
    const other = linked('mac-other', 'all')
    expect(await other.call('browser.screen', { projectId: PROJECT, visible: [NODE], zoom: 1, screen: 'screen-other' })).toEqual({ ok: true, value: {} })
    other.peer.close()
    vi.setSystemTime(Date.now() + 40_000)
    await browsers.check()
    expect(liveNow()).toBe(false)
  })
})
