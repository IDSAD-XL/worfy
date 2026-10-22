// A Browser and the life of the Session that opened it (worfy-browser ticket 06, ADR-0078 item 11):
// the Browsers a Session opened leave the Canvas with it — Hide, Remove — in the same Layout
// operation, pinned and Keep or not; showing the Session again and Restore do not bring them back,
// ⌘Z of the user's step does, at their former places (owner decision 2026-10-22); a Browser the user
// opened and another Session's stay, and so does one the user took over or whose page has unsaved
// changes, as the user's own (owner decision 2026-10-22); the Session's control of the user's
// Browser ends with it; a Session drives no Browser another Session opened.
//
// The Browsers are opened the way a Session opens them — the tools of `worfy-browser` through
// browserToolCaller (src/main/mcp/browser-server.ts) — over main's LayoutStore and LiveBrowsers
// (src/main/browser/live.ts), wired to each other as the app wires them (`layoutChanges`). The
// "window" draws each Browser Node on the Canvas with a fake guest page whose debugger answers the
// few CDP commands the tools send, and closes the page of one that left the Canvas, as the Browser
// layer does. The user's steps go through the undo history of a screen (src/renderer/canvas/history.ts).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CdpContents, CdpDebugger } from '../../src/main/browser/cdp'
import type { LiveBrowsers as LiveBrowsersClass } from '../../src/main/browser/live'
import type { LayoutChange, LayoutStore as LayoutStoreClass } from '../../src/main/layout/store'
import type { BrowserContext, BrowserToolResult } from '../../src/main/mcp/browser-server'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import { shownOnCanvas } from '../../src/shared/layout/derived'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

const PROJECT = 'demo-0a1b2c3d'
const A = 'sess-a'
const B = 'sess-b'
const NODE_A = `session:${A}`
const NODE_B = `session:${B}`
/** The Browser the user opened, from the palette: no `openedBy`. */
const USER = 'browser-user'
const SCREEN = 'screen-1'
const PROFILE: BrowserProfile = { id: 'admin-aaaaaa', name: 'admin', origins: ['http://127.0.0.1:4100'], autopilot: false }

type Listener = (...args: unknown[]) => void

/**
 * A guest page whose debugger answers the commands of attach(), of a screenshot and of a click on a
 * selector; it keeps every command sent, and `onCommand` lets a test act as a command arrives.
 */
class FakePage implements CdpContents {
  private static next = 1
  readonly id = FakePage.next++
  destroyed = false
  private attached = false
  private readonly listeners = new Map<string, Set<Listener>>()
  readonly sent: string[] = []
  /** The page has a `beforeunload` handler: unsaved changes. */
  unsaved = false
  onCommand: ((method: string) => void | Promise<void>) | undefined
  readonly debugger: CdpDebugger = {
    attach: () => void (this.attached = true),
    isAttached: () => this.attached,
    sendCommand: async (method) => {
      this.sent.push(method)
      await this.onCommand?.(method)
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
      if (method === 'Page.captureScreenshot') return { data: 'iVBORw0KGgo=' }
      if (method === 'Runtime.evaluate') return { result: { objectId: 'button-1' } }
      if (method === 'Runtime.callFunctionOn') return { result: { value: { x: 10, y: 10, w: 20, h: 20 } } }
      if (method === 'DOMDebugger.getEventListeners') return { listeners: this.unsaved ? [{ type: 'beforeunload' }] : [] }
      return {}
    },
    on: ((event: string, listener: Listener) => this.listen(`debugger:${event}`, listener)) as CdpDebugger['on'],
  }
  /** Chromium pauses the request for a whole new page of the main frame (the Fetch domain). */
  pausesNavigation(url: string): void {
    for (const listener of this.listeners.get('debugger:message') ?? []) listener({}, 'Fetch.requestPaused', { requestId: `request-${this.sent.length}`, frameId: 'main', request: { url } })
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return 'about:blank'
  }
  getTitle(): string {
    return ''
  }
  readonly on = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['on']
  readonly once = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['once']
  private listen(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }
  /** A click of the user on the page, as Electron's `input-event` reports it. */
  click(): void {
    for (const listener of this.listeners.get('input-event') ?? []) listener({}, { type: 'mouseDown' })
  }
  close(): void {
    this.destroyed = true
    for (const listener of this.listeners.get('destroyed') ?? []) listener()
  }
}

let store: LayoutStoreClass
let live: LiveBrowsersClass
let server: typeof import('../../src/main/mcp/browser-server')
let history: typeof import('../../src/renderer/canvas/history')
/** Each change of control main told the windows of: the Browser and who drives it now. */
let controls: [string, string | null][]
/** Every change of the Layout, as main's listeners hear it. */
let changes: LayoutChange[]
/** The pages the "window" draws, by Browser Node id. */
let pages: Map<string, FakePage>
/** The rules of sleep the Live Browsers read; a test may change them. */
let sleep: { maxLive: number; offscreenMs: number; idleMs: number; minZoom: number }

const nodes = (): LayoutNode[] => store.get(PROJECT).layout.nodes
const nodeOf = (id: string): LayoutNode | undefined => nodes().find((node) => node.id === id)
const browserIds = (): string[] => nodes().filter((node) => node.kind === 'browser').map((node) => node.id).sort()
const shownBrowsers = (): string[] => nodes().filter((node) => node.kind === 'browser' && shownOnCanvas(node)).map((node) => node.id)

/** The window after a change of the Layout: a page for each Browser on the Canvas, none for one that left it. */
function draw(): void {
  const shown = new Set(shownBrowsers())
  for (const [id, page] of pages) {
    if (shown.has(id)) continue
    page.close()
    pages.delete(id)
  }
  for (const id of shown) {
    if (pages.has(id)) continue
    const page = new FakePage()
    pages.set(id, page)
    live.register(PROJECT, id, page)
  }
}

beforeEach(async () => {
  vi.resetModules()
  const { LayoutStore } = await import('../../src/main/layout/store')
  const { LiveBrowsers } = await import('../../src/main/browser/live')
  server = await import('../../src/main/mcp/browser-server')
  history = await import('../../src/renderer/canvas/history')
  history.resetHistories()
  store = new LayoutStore(() => '/nonexistent/worfy-browser-lifecycle', { write: () => undefined, delayMs: 60_000, maxDelayMs: 60_000 })
  controls = []
  changes = []
  pages = new Map()
  // Room for every Browser of a test, and no sleep while it runs: this file is not about sleep.
  sleep = { maxLive: 10, offscreenMs: 3_600_000, idleMs: 3_600_000, minZoom: 0 }
  store.onChange((change) => changes.push(change))
  // Each change is drawn at once, as an open window draws it.
  store.onChange(() => queueMicrotask(draw))
  live = new LiveBrowsers({
    profileOf: () => ({ name: PROFILE.name, origins: PROFILE.origins }),
    changed: (_projectId, nodeId, mode) => controls.push([nodeId, mode]),
    pressing: () => undefined,
    browsersOf: () => shownBrowsers(),
    sleepSettings: () => sleep,
    layoutChanges: (listener) => store.onChange(listener),
    browserKeeper: (keeps, ask) => store.setBrowserKeeper(keeps, ask),
  })
  await live.screen(1, { projectId: PROJECT, visible: [], zoom: 1 })
  const session = (sessionId: string, x: number): LayoutOpInput => ({
    op: 'create',
    node: { id: `session:${sessionId}`, kind: 'session', x, y: 0, w: 300, h: 120, data: { sessionId, origin: 'external', source: 'terminal', cwd: '/p' } },
  })
  store.apply(PROJECT, session(A, 0))
  store.apply(PROJECT, session(B, 2000))
  // The user's Browser, as the palette's «New Browser» makes it (a step of the user's, with a screen).
  store.apply(PROJECT, { op: 'create', node: { id: USER, kind: 'browser', x: 0, y: 4000, w: 640, h: 440, data: { profile: PROFILE.id } } }, SCREEN)
})

afterEach(() => {
  live.stop()
  for (const page of pages.values()) page.close()
})

const context = (sessionId: string | null): BrowserContext => ({
  projectId: PROJECT,
  layout: { get: (projectId) => store.get(projectId), apply: (projectId, op) => store.apply(projectId, op) },
  profiles: () => [PROFILE],
  live,
  sessionId: () => sessionId,
  liveWaitMs: 500,
})

const textOf = (answer: BrowserToolResult): string => {
  const [first] = answer.content
  return first?.type === 'text' ? first.text : ''
}
/** Calls a tool of `worfy-browser` as Session `sessionId` does. */
const call = (sessionId: string | null, name: Parameters<ReturnType<typeof server.browserToolCaller>>[0], args: Record<string, unknown> = {}) => server.browserToolCaller(context(sessionId))(name, args)
/** Session `sessionId` opens a Browser under the profile; its id. */
async function opens(sessionId: string): Promise<string> {
  const answer = await call(sessionId, 'browser_open', { profile: PROFILE.id })
  expect(answer.isError, textOf(answer)).toBeFalsy()
  return (JSON.parse(textOf(answer)) as { id: string }).id
}
/** Session `sessionId` drives Browser `id` with a screenshot. */
async function drives(sessionId: string, id: string): Promise<void> {
  const answer = await call(sessionId, 'browser_screenshot', { id })
  expect(answer.isError, textOf(answer)).toBeFalsy()
}

/** main's Layout and the Browsers the user has taken over, as mainNowOf (history.ts) reads them over IPC. */
const mainNow = () => Promise.resolve({ layout: store.get(PROJECT).layout, takenOver: new Set(live.controlsOf(PROJECT).filter((control) => control.mode === 'user').map((control) => control.nodeId)) })
/**
 * The screen of the user: its Canvas sends through main as the layout.apply handler does — the
 * pages of a leaving Session's Browsers asked first (src/main/ipc/layout.ts) — and records each step.
 */
const channel = {
  send: (op: LayoutOpInput) => apply(op),
  layout: () => store.get(PROJECT).layout,
  mainNow,
  hold: (nodeId: string, sessionId: string) => Promise.resolve(void live.holdForUser(PROJECT, nodeId, sessionId)),
}
async function apply(op: LayoutOpInput): Promise<string | undefined> {
  try {
    await store.askBrowsersFirst(PROJECT, op)
    store.apply(PROJECT, op, SCREEN)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
const user = (op: LayoutOpInput) => history.applyRecorded(PROJECT, op, channel)
const undo = () => history.historyOf(PROJECT).undo()
const redo = () => history.historyOf(PROJECT).redo()

describe('a Session’s Browsers leave the Canvas with its Node (ADR-0078, item 11)', () => {
  it('Hide of the Session Node removes its Browsers in the same operation; the user’s Browser and another Session’s stay', async () => {
    const a1 = await opens(A)
    const a2 = await opens(A)
    const b1 = await opens(B)
    expect(browserIds()).toEqual([a1, a2, b1, USER].sort())
    await Promise.resolve()
    changes.length = 0
    expect(await user({ op: 'hide', id: NODE_A, hidden: true })).toBeUndefined()
    // One operation, one revision: the Session hidden and its Browsers gone in the same change.
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ op: { op: 'hide', id: NODE_A, hidden: true }, screen: SCREEN, sessionsLeft: [A] })
    expect(changes[0]!.layout.nodes.map((node) => node.id)).not.toContain(a1)
    expect(browserIds()).toEqual([b1, USER].sort())
    expect(nodeOf(NODE_A)?.hidden).toBe(true)
    // The window closes their pages, and main forgets their life at its next check.
    await Promise.resolve()
    expect(pages.has(a1) || pages.has(a2)).toBe(false)
    await live.check()
    expect(live.lives(PROJECT).map((life) => life.nodeId).sort()).toEqual([b1, USER].sort())
  })

  it('Remove of the Session Node removes its Browsers in the same operation; the user’s Browser and another Session’s stay', async () => {
    const a1 = await opens(A)
    const b1 = await opens(B)
    changes.length = 0
    expect(await user({ op: 'remove', id: NODE_A })).toBeUndefined()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ op: { op: 'remove', id: NODE_A }, sessionsLeft: [A] })
    expect(nodeOf(a1)).toBeUndefined()
    expect(browserIds()).toEqual([b1, USER].sort())
  })

  for (const [what, op] of [
    ['pinned', { op: 'pin', id: NODE_A, pinned: true, x: 40, y: 40, w: 300, h: 120 }],
    ['with Keep', { op: 'keep', id: NODE_A, keep: true }],
  ] as const) {
    it(`a Session ${what}: Hide and Remove take its Browsers too`, async () => {
      expect(await user(op)).toBeUndefined()
      const a1 = await opens(A)
      expect(await user({ op: 'hide', id: NODE_A, hidden: true })).toBeUndefined()
      expect(nodeOf(a1)).toBeUndefined()
      expect(await user({ op: 'hide', id: NODE_A, hidden: false })).toBeUndefined()
      const a2 = await opens(A)
      expect(await user({ op: 'remove', id: NODE_A })).toBeUndefined()
      expect(nodeOf(a2)).toBeUndefined()
      expect(browserIds()).toEqual([USER])
    })
  }

  it('showing a hidden Session again does not bring its Browsers back, nor does a Restore of an archived one', async () => {
    const a1 = await opens(A)
    await user({ op: 'hide', id: NODE_A, hidden: true })
    await user({ op: 'hide', id: NODE_A, hidden: false })
    expect(nodeOf(NODE_A)?.hidden).toBe(false)
    expect(nodeOf(a1)).toBeUndefined()
    const a2 = await opens(A)
    // The archive's batch, as main's timer sends it: without a screen.
    store.apply(PROJECT, { op: 'archive', batch: 'batch-1', nodes: [{ id: NODE_A, rule: 'idle' }] }, null)
    expect(nodeOf(a2)).toBeUndefined()
    await user({ op: 'restore', ids: [NODE_A] })
    expect(nodeOf(NODE_A)?.archived ?? null).toBeNull()
    expect(browserIds()).toEqual([USER])
  })

  it('a Remove main refuses (a locked Session Node) removes no Browser', async () => {
    const a1 = await opens(A)
    store.apply(PROJECT, { op: 'create', node: { id: 'session:locked', kind: 'session', x: 0, y: 8000, w: 300, h: 120, locked: true, data: { sessionId: A, origin: 'external', source: 'terminal', cwd: '/p' } } })
    await user({ op: 'hide', id: NODE_A, hidden: true })
    // Another Node of the Session is still on the Canvas: its Browser stays.
    expect(nodeOf(a1)).toBeDefined()
    expect(await user({ op: 'remove', id: 'session:locked' })).toMatch(/locked/)
    expect(nodeOf(a1)).toBeDefined()
    expect(nodeOf('session:locked')).toBeDefined()
  })

  it('a Browser the user locked stays when its Session leaves', async () => {
    const a1 = await opens(A)
    store.apply(PROJECT, { op: 'patchData', id: a1, data: {} })
    const locked = nodeOf(a1)!
    store.apply(PROJECT, { op: 'remove', id: a1 })
    store.apply(PROJECT, { op: 'create', node: { ...locked, locked: true } })
    await user({ op: 'remove', id: NODE_A })
    expect(nodeOf(a1)?.locked).toBe(true)
  })
})

describe('control ends with the Session’s place on the Canvas', () => {
  it('the Session’s control of the user’s Browser ends when it leaves: the banner goes, and another Session may drive it', async () => {
    await drives(A, USER)
    expect(live.control(PROJECT, USER)).toEqual({ mode: 'claude', sessionId: A })
    expect(textOf(await call(B, 'browser_screenshot', { id: USER }))).toMatch(/Another Session drives this Browser/)
    controls.length = 0
    await user({ op: 'hide', id: NODE_A, hidden: true })
    expect(controls).toEqual([[USER, null]])
    expect(live.control(PROJECT, USER)).toBeNull()
    expect(nodeOf(USER)).toBeDefined()
    await drives(B, USER)
    expect(live.control(PROJECT, USER)).toEqual({ mode: 'claude', sessionId: B })
  })

  it('a takeover of the user ends too: «Return control to Claude» is gone with the Session', async () => {
    await drives(A, USER)
    pages.get(USER)!.click()
    expect(live.control(PROJECT, USER)?.mode).toBe('user')
    store.apply(PROJECT, { op: 'archive', batch: 'batch-1', nodes: [{ id: NODE_A, rule: 'idle' }] }, null)
    expect(live.control(PROJECT, USER)).toBeNull()
    expect(controls.at(-1)).toEqual([USER, null])
  })

  it('a Session that keeps a Node on the Canvas keeps its control; another Session leaving changes nothing', async () => {
    await drives(A, USER)
    controls.length = 0
    await user({ op: 'hide', id: NODE_B, hidden: true })
    await user({ op: 'move', id: NODE_A, x: 0, y: 300 })
    expect(controls).toEqual([])
    expect(live.control(PROJECT, USER)).toEqual({ mode: 'claude', sessionId: A })
  })
})

describe('a call running while its Session leaves the Canvas', () => {
  it('stops before its next command with an answer that the Session left, and the page it leads to is still checked until it ends', async () => {
    await drives(A, USER)
    const page = pages.get(USER)!
    page.sent.length = 0
    let failedWhileLeaving = 0
    page.onCommand = (method) => {
      // The Session's click has found its element: the user hides the Session now, and a redirect of
      // the page arrives before the call ends.
      if (method !== 'Runtime.callFunctionOn') return
      page.onCommand = undefined
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: true }, SCREEN)
      page.pausesNavigation('http://elsewhere.test/')
      failedWhileLeaving = page.sent.filter((each) => each === 'Fetch.failRequest').length
    }
    const answer = await call(A, 'browser_click', { id: USER, selector: '#go' })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/^This Session left the Canvas: its Node was hidden/)
    expect(textOf(answer)).not.toMatch(/Return control to Claude/)
    expect(page.sent.filter((each) => each.startsWith('Input.'))).toEqual([])
    expect(failedWhileLeaving).toBe(1)
    expect(live.control(PROJECT, USER)).toBeNull()
    // The call is over: the Browser is the user's, and their pages are not the Session's to check.
    page.pausesNavigation('http://elsewhere.test/')
    expect(page.sent.filter((each) => each === 'Fetch.continueRequest')).toHaveLength(1)
  })

  it('a click of the user on the page while that call ends is not held to the origins', async () => {
    await drives(A, USER)
    const page = pages.get(USER)!
    page.onCommand = (method) => {
      if (method !== 'Runtime.callFunctionOn') return
      page.onCommand = undefined
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: true }, SCREEN)
      page.click()
      page.pausesNavigation('http://elsewhere.test/')
    }
    page.sent.length = 0
    const answer = await call(A, 'browser_click', { id: USER, selector: '#go' })
    expect(page.sent.filter((each) => each === 'Fetch.failRequest')).toEqual([])
    expect(page.sent.filter((each) => each === 'Fetch.continueRequest')).toHaveLength(1)
    // The call still answers that its Session left: no «Return control to Claude» to wait for.
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/^This Session left the Canvas/)
    expect(textOf(answer)).not.toMatch(/Return control to Claude/)
    expect(page.sent.filter((each) => each.startsWith('Input.'))).toEqual([])
  })

  it('another Session that takes the Browser meanwhile drives it, and the call of the Session that left still sends nothing', async () => {
    await drives(A, USER)
    const page = pages.get(USER)!
    let byB: BrowserToolResult | undefined
    page.onCommand = async (method) => {
      if (method !== 'Runtime.callFunctionOn') return
      page.onCommand = undefined
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: true }, SCREEN)
      // Session B clicks on the user's Browser while A's click is still in flight.
      byB = await call(B, 'browser_click', { id: USER, selector: '#go' })
    }
    page.sent.length = 0
    const answer = await call(A, 'browser_click', { id: USER, selector: '#go' })
    expect(byB?.isError, byB && textOf(byB)).toBeFalsy()
    expect(live.control(PROJECT, USER)).toEqual({ mode: 'claude', sessionId: B })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/^This Session left the Canvas/)
    // Three mouse events: B's press and release, none of A's.
    expect(page.sent.filter((each) => each === 'Input.dispatchMouseEvent')).toHaveLength(3)
    page.sent.length = 0
    await drives(B, USER)
    expect((await call(B, 'browser_click', { id: USER, selector: '#go' })).isError).toBeFalsy()
    expect(page.sent.filter((each) => each === 'Input.dispatchMouseEvent')).toHaveLength(3)
  })

  it('a Session shown again drives again at once, though its call from before is still in flight', async () => {
    await drives(A, USER)
    const page = pages.get(USER)!
    let again: BrowserToolResult | undefined
    page.onCommand = async (method) => {
      if (method !== 'Runtime.callFunctionOn') return
      page.onCommand = undefined
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: true }, SCREEN)
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: false }, SCREEN)
      again = await call(A, 'browser_click', { id: USER, selector: '#go' })
    }
    await call(A, 'browser_click', { id: USER, selector: '#go' })
    expect(again?.isError, again && textOf(again)).toBeFalsy()
    expect(live.control(PROJECT, USER)).toEqual({ mode: 'claude', sessionId: A })
  })
})

describe('whose Browsers a Session drives (worfy-polish 36: a Session drove any Browser of its Project)', () => {
  it('another Session’s Browser is refused before anything is taken or woken; its own and the user’s are not', async () => {
    const a1 = await opens(A)
    expect(live.control(PROJECT, a1)).toEqual({ mode: 'claude', sessionId: A })
    // Session A's Browser is no longer driven, as after a start of worfy: still not Session B's.
    live.release(PROJECT, a1)
    const wake = vi.spyOn(live, 'wake')
    const holds = vi.spyOn(live, 'sessionDrives')
    for (const name of ['browser_screenshot', 'browser_read', 'browser_navigate', 'browser_click'] as const) {
      const answer = await call(B, name, { id: a1, url: 'http://127.0.0.1:4100/', selector: '#x' })
      expect(answer.isError).toBe(true)
      expect(textOf(answer)).toMatch(/opened by another Session/)
    }
    expect(wake).not.toHaveBeenCalled()
    expect(holds).not.toHaveBeenCalled()
    expect(live.control(PROJECT, a1)).toBeNull()
    wake.mockRestore()
    holds.mockRestore()
    await drives(A, a1)
    await drives(B, USER)
  })

  it('a Session whose Node is hidden opens no Browser, before anything is woken; a Session without a Node opens one', async () => {
    await user({ op: 'hide', id: NODE_A, hidden: true })
    const wake = vi.spyOn(live, 'wake')
    const answer = await call(A, 'browser_open', { profile: PROFILE.id })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/not on the Canvas/)
    expect(wake).not.toHaveBeenCalled()
    expect(browserIds()).toEqual([USER])
    wake.mockRestore()
    const loose = await opens('sess-no-node')
    expect(nodeOf(loose)?.data.openedBy).toBe('sess-no-node')
  })

  it('a Session whose Node is hidden drives no Browser, the user’s included, before anything is taken or woken', async () => {
    await user({ op: 'hide', id: NODE_A, hidden: true })
    const wake = vi.spyOn(live, 'wake')
    const holds = vi.spyOn(live, 'sessionDrives')
    controls.length = 0
    for (const name of ['browser_screenshot', 'browser_read', 'browser_navigate', 'browser_click'] as const) {
      const answer = await call(A, name, { id: USER, url: 'http://127.0.0.1:4100/', selector: '#x' })
      expect(answer.isError).toBe(true)
      expect(textOf(answer)).toMatch(/not on the Canvas .* so it drives no Browser/)
    }
    expect(wake).not.toHaveBeenCalled()
    expect(holds).not.toHaveBeenCalled()
    expect(controls).toEqual([])
    expect(live.control(PROJECT, USER)).toBeNull()
    wake.mockRestore()
    holds.mockRestore()
    // Shown again, it drives as before.
    await user({ op: 'hide', id: NODE_A, hidden: false })
    await drives(A, USER)
  })

  it('a Session hidden while the Browser wakes for its call takes no control: no banner is left that nothing would take away', async () => {
    const wake = live.wake.bind(live)
    vi.spyOn(live, 'wake').mockImplementationOnce(async (...args) => {
      const woken = await wake(...args)
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: true }, SCREEN)
      return woken
    })
    controls.length = 0
    const answer = await call(A, 'browser_screenshot', { id: USER })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/so it drives no Browser/)
    expect(live.control(PROJECT, USER)).toBeNull()
    expect(controls).toEqual([])
  })

  it('a Session hidden while its new Browser wakes gets no Browser Node, and main forgets the woken life', async () => {
    const wake = live.wake.bind(live)
    vi.spyOn(live, 'wake').mockImplementationOnce(async (...args) => {
      const woken = await wake(...args)
      store.apply(PROJECT, { op: 'hide', id: NODE_A, hidden: true }, SCREEN)
      return woken
    })
    const answer = await call(A, 'browser_open', { profile: PROFILE.id })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/not on the Canvas .* so it opens no Browser/)
    expect(browserIds()).toEqual([USER])
    await live.check()
    expect(live.lives(PROJECT).map((life) => life.nodeId)).toEqual([USER])
  })
})

describe('the Orchestrator’s Node is a Session Node too', () => {
  const ORCH = 'sess-orch'
  beforeEach(() => {
    store.apply(PROJECT, { op: 'create', node: { id: 'orch', kind: 'orchestrator', x: 0, y: 6000, w: 300, h: 200, data: { sessionId: ORCH } } })
  })

  it('its Browsers leave with it, and off the Canvas it opens none', async () => {
    const o1 = await opens(ORCH)
    changes.length = 0
    expect(await user({ op: 'hide', id: 'orch', hidden: true })).toBeUndefined()
    expect(changes[0]).toMatchObject({ sessionsLeft: [ORCH] })
    expect(nodeOf(o1)).toBeUndefined()
    expect(browserIds()).toEqual([USER])
    const wake = vi.spyOn(live, 'wake')
    const answer = await call(ORCH, 'browser_open', { profile: PROFILE.id })
    expect(textOf(answer)).toMatch(/not on the Canvas/)
    expect(wake).not.toHaveBeenCalled()
    wake.mockRestore()
  })
})

describe('the Live Browsers stopped', () => {
  it('no longer hear the Layout: stop() unsubscribes from its changes', async () => {
    const { LiveBrowsers } = await import('../../src/main/browser/live')
    const unsubscribe = vi.fn()
    const other = new LiveBrowsers({ profileOf: () => null, changed: () => undefined, pressing: () => undefined, browsersOf: () => [], layoutChanges: () => unsubscribe })
    expect(unsubscribe).not.toHaveBeenCalled()
    other.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('a Browser the user took over or with unsaved changes stays as the user’s own (owner decision 2026-10-22)', () => {
  it('taken over: Hide of its Session leaves it on the Canvas without its Session, and any Session may drive it as the user’s', async () => {
    const a1 = await opens(A)
    const a2 = await opens(A)
    await drives(A, a1)
    pages.get(a1)!.click()
    expect(live.control(PROJECT, a1)?.mode).toBe('user')
    expect(textOf(await call(B, 'browser_screenshot', { id: a1 }))).toMatch(/opened by another Session/)
    const place = nodeOf(a1)!
    expect(await user({ op: 'hide', id: NODE_A, hidden: true })).toBeUndefined()
    expect(nodeOf(a1)).toMatchObject({ x: place.x, y: place.y })
    expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
    expect(nodeOf(a2)).toBeUndefined()
    // The Session's control went with it: no banner, and the Browser is the user's for any Session.
    expect(live.control(PROJECT, a1)).toBeNull()
    await drives(B, a1)
  })

  it('unsaved changes: a page with a beforeunload handler keeps its Browser on the Canvas when the archive takes the Session', async () => {
    const a1 = await opens(A)
    const a2 = await opens(A)
    await Promise.resolve()
    pages.get(a1)!.unsaved = true
    // Off every screen and idle: main asks the pages before they sleep and marks a1 unsaved.
    sleep = { ...sleep, offscreenMs: -1, idleMs: -1 }
    await live.check()
    expect(live.lives(PROJECT).find((life) => life.nodeId === a1)).toMatchObject({ live: true, unsaved: true })
    expect(live.staysWithUser(PROJECT, a1)).toBe(true)
    expect(live.staysWithUser(PROJECT, a2)).toBe(false)
    store.apply(PROJECT, { op: 'archive', batch: 'batch-1', nodes: [{ id: NODE_A, rule: 'idle' }] }, null)
    expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
    expect(nodeOf(a2)).toBeUndefined()
  })

  it('a Browser given back with «Return control to Claude» leaves with its Session again', async () => {
    const a1 = await opens(A)
    await drives(A, a1)
    pages.get(a1)!.click()
    expect(live.giveBack(PROJECT, a1)).toBe(true)
    await user({ op: 'remove', id: NODE_A })
    expect(nodeOf(a1)).toBeUndefined()
  })

  it('the Live Browsers stopped give the rule back: a Browser taken over then leaves with its Session', async () => {
    const a1 = await opens(A)
    await drives(A, a1)
    pages.get(a1)!.click()
    live.stop()
    await user({ op: 'hide', id: NODE_A, hidden: true })
    expect(nodeOf(a1)).toBeUndefined()
  })
})

describe('⌘Z (ADR-0016): the user’s Hide and Remove are steps; the archive is none', () => {
  it('⌘Z of the user’s Hide shows the Session again with its Browsers at their former places; ⇧⌘Z hides it and takes them again', async () => {
    const a1 = await opens(A)
    const a2 = await opens(A)
    const places = [nodeOf(a1)!, nodeOf(a2)!]
    await user({ op: 'hide', id: NODE_A, hidden: true })
    expect(browserIds()).toEqual([USER])
    expect(await undo()).toBe(true)
    expect(nodeOf(NODE_A)?.hidden).toBe(false)
    for (const node of places) expect(nodeOf(node.id)).toMatchObject({ x: node.x, y: node.y, w: node.w, h: node.h, data: { openedBy: A, profile: PROFILE.id } })
    // The window draws them again: their pages open, and the Session drives them as before.
    await Promise.resolve()
    expect(pages.has(a1) && pages.has(a2)).toBe(true)
    await drives(A, a1)
    expect(await redo()).toBe(true)
    expect(nodeOf(NODE_A)?.hidden).toBe(true)
    expect(browserIds()).toEqual([USER])
  })

  it('⌘Z of the user’s Remove brings the Session Node back with its Browsers', async () => {
    const a1 = await opens(A)
    const place = nodeOf(a1)!
    await user({ op: 'remove', id: NODE_A })
    expect(await undo()).toBe(true)
    expect(nodeOf(NODE_A)).toMatchObject({ kind: 'session', data: { sessionId: A } })
    expect(nodeOf(a1)).toMatchObject({ x: place.x, y: place.y, data: { openedBy: A } })
    expect(browserIds()).toEqual([a1, USER].sort())
  })

  it('⌘Z gives a taken-over Browser its Session and the user’s takeover back: the Session waits for «Return control to Claude»; ⇧⌘Z keeps it with the user again', async () => {
    const a1 = await opens(A)
    const a2 = await opens(A)
    await drives(A, a1)
    pages.get(a1)!.click()
    await user({ op: 'hide', id: NODE_A, hidden: true })
    expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
    expect(live.control(PROJECT, a1)).toBeNull()
    expect(await undo()).toBe(true)
    expect(nodeOf(a1)?.data).toMatchObject({ openedBy: A })
    expect(nodeOf(a2)).toMatchObject({ data: { openedBy: A } })
    expect(live.control(PROJECT, a1)).toEqual({ mode: 'user', sessionId: A })
    expect(controls.at(-1)).toEqual([a1, 'user'])
    expect(textOf(await call(A, 'browser_screenshot', { id: a1 }))).toMatch(/the user is using it now/)
    expect(await redo()).toBe(true)
    expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
    expect(nodeOf(a2)).toBeUndefined()
  })

  it('a page the user typed into is asked right before the Hide: its Browser stays though main never asked it before', async () => {
    const a1 = await opens(A)
    const a2 = await opens(A)
    await Promise.resolve()
    // No check() ran: main has not asked a1's page anything yet.
    expect(live.lives(PROJECT).find((life) => life.nodeId === a1)).toMatchObject({ unsaved: false })
    pages.get(a1)!.unsaved = true
    await user({ op: 'hide', id: NODE_A, hidden: true })
    expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
    expect(nodeOf(a2)).toBeUndefined()
    expect(pages.get(a1)?.sent).toContain('DOMDebugger.getEventListeners')
  })

  it('⌘Z of the user’s Delete to the trash restores the Session Node with its Browsers and the user’s takeover; ⇧⌘Z keeps the taken-over one again', async () => {
    const { TrashStore } = await import('../../src/main/layout/trash')
    const dataDir = mkdtempSync(join(tmpdir(), 'worfy-browser-lifecycle-trash-'))
    try {
      const trashStore = new TrashStore({ dataDirOf: () => dataDir, cardPaths: () => ({ folder: join(dataDir, 'cards'), data: join(dataDir, 'card.json') }), layout: store })
      const asked = <T>(act: () => T): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
        try {
          return Promise.resolve({ ok: true, value: act() })
        } catch (error) {
          return Promise.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      // The screen's trash client, as ipcTrash reaches main: the trash, main's Layout, the Layout's operations.
      // trash.put asks the pages first, as its handler does (src/main/ipc/trash.ts).
      const trash = {
        put: async (projectId: string, nodeId: string, keep?: readonly string[]) => {
          await store.askBrowsersFirst(projectId, { op: 'remove', id: nodeId })
          return asked(() => trashStore.put(projectId, nodeId, SCREEN, keep))
        },
        restore: (projectId: string, label: string) => asked(() => trashStore.restore(projectId, label, SCREEN)),
        mainNow: () => mainNow(),
        send: (_projectId: string, op: LayoutOpInput) => apply(op),
        hold: (projectId: string, nodeId: string, sessionId: string) => Promise.resolve(void live.holdForUser(projectId, nodeId, sessionId)),
      }
      const a1 = await opens(A)
      const a2 = await opens(A)
      const place = nodeOf(a2)!
      await drives(A, a1)
      pages.get(a1)!.click()
      expect(await history.deleteToTrash(PROJECT, [nodeOf(NODE_A)!], trash)).toEqual([])
      expect(nodeOf(NODE_A)).toBeUndefined()
      expect(nodeOf(a2)).toBeUndefined()
      expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
      expect(await undo()).toBe(true)
      expect(nodeOf(NODE_A)).toMatchObject({ kind: 'session', data: { sessionId: A } })
      expect(nodeOf(a2)).toMatchObject({ x: place.x, y: place.y, w: place.w, h: place.h, data: { openedBy: A } })
      expect(nodeOf(a1)?.data).toMatchObject({ openedBy: A })
      // The takeover is the user's again, and ⇧⌘Z keeps the Browser with the user as the step did.
      expect(live.control(PROJECT, a1)).toEqual({ mode: 'user', sessionId: A })
      expect(await redo()).toBe(true)
      expect(browserIds()).toEqual([a1, USER].sort())
      expect(nodeOf(a1)?.data).not.toHaveProperty('openedBy')
    } finally {
      removeTestTree(dataDir)
    }
  })

  it('the archive’s batch is no step: ⌘Z after it undoes the user’s own move, and the Session and its Browsers stay off the Canvas', async () => {
    await user({ op: 'move', id: NODE_B, x: 2000, y: 600 })
    const a1 = await opens(A)
    store.apply(PROJECT, { op: 'archive', batch: 'batch-1', nodes: [{ id: NODE_A, rule: 'idle' }] }, null)
    expect(await undo()).toBe(true)
    expect(nodeOf(NODE_B)).toMatchObject({ x: 2000, y: 0 })
    expect(nodeOf(NODE_A)?.archived).toMatchObject({ batch: 'batch-1' })
    expect(nodeOf(a1)).toBeUndefined()
    expect(await undo()).toBe(false)
  })
})
