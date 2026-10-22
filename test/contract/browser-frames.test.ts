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
  private attached = false
  private readonly listeners = new Map<string, Set<Listener>>()
  readonly sent: { method: string; params: unknown }[] = []
  readonly debugger: CdpDebugger = {
    attach: () => void (this.attached = true),
    isAttached: () => this.attached,
    sendCommand: (method, params) => {
      this.sent.push({ method, params })
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: [0, 0], objectId: 'window-1' } })
      if (method === 'DOMDebugger.getEventListeners') return Promise.resolve({ listeners: [] })
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

let page: FakePage

describe('frames and input of a Live Browser for a Linked machine', () => {
  it('a read-only Linked machine gets no frames: its watch is refused, and the frames a full one gets never reach it', async () => {
    await windowShows(1, [NODE])
    page = draws(1)
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
    const full = linked('mac-full', 'all')
    const readOnly = linked('mac-ro', 'read')
    const click = { kind: 'mouse', type: 'mousePressed', x: 12, y: 30, button: 'left', clickCount: 1, modifiers: 0 }
    const before = page.sent.length
    expect(await readOnly.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: click })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(await readOnly.call('browser.navigate', { projectId: PROJECT, nodeId: NODE, url: 'https://example.com/' })).toEqual({ ok: false, error: readOnlyRefusal(MACHINE) })
    expect(page.sent.slice(before).map((each) => each.method)).not.toContain('Input.dispatchMouseEvent')

    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: click })).toEqual({ ok: true, value: {} })
    expect(page.sent).toContainEqual({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 12, y: 30, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 } })
    const key = { kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', keyCode: 65, modifiers: 0 }
    expect(await full.call('browser.input', { projectId: PROJECT, nodeId: NODE, input: key })).toEqual({ ok: true, value: {} })
    expect(page.sent).toContainEqual({ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a', windowsVirtualKeyCode: 65, modifiers: 0 } })
    const wheel = { kind: 'wheel', x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 }
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
    await live.liveBrowsers().input(PROJECT, NODE, { kind: 'mouse', type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1, modifiers: 0 }, 2)
    await live.liveBrowsers().input(PROJECT, NODE, { kind: 'mouse', type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1, modifiers: 0 }, 2)
    await vi.waitFor(() => expect(here(second)).toBe(true), { timeout: 5_000 })
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
