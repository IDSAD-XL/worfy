// The sleep rules of Browsers (src/main/browser/sleep.ts, worfy-browser ticket 05, ADR-0078 items 6,
// 7, 15 and 16): when a Live Browser goes to sleep, and what opening or waking one does under the
// limit of Live Browsers. Plain functions of the Browsers, the screens, the time and the settings.
// Then the same rules through main's LiveBrowsers (src/main/browser/live.ts) and the tools of
// worfy-browser (src/main/mcp/browser-server.ts), with fake pages whose debugger answers the CDP
// commands of sleep: a Session's call while every Live Browser is busy is refused before anything
// changes, and wakes an Asleep Browser once one may sleep. Electron's own behaviour — the real
// beforeunload check, the picture, the scroll — is in test/e2e/browser-sleep.spec.ts.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CdpContents, CdpDebugger } from '../../src/main/browser/cdp'
import type { LiveBrowsers } from '../../src/main/browser/live'
import { admit, ALL_LIVE_BUSY, browsersToSleep, drivenNow, sleepReason, type BrowserNow, type ScreenNow, type SleepSettings } from '../../src/main/browser/sleep'
import type { LayoutStore } from '../../src/main/layout/store'
import type { BrowserLife } from '../../src/shared/ipc/browser'
import type { LayoutNode } from '../../src/shared/layout/types'
import { removeTestTree, saveLayoutNow } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

const SETTINGS: SleepSettings = { maxLive: 3, offscreenMs: 30_000, idleMs: 300_000, minZoom: 0.4 }
const NOW = 1_000_000

/** A Live Browser used and seen at `NOW`, nobody driving it. */
const browser = (id: string, over: Partial<BrowserNow> = {}): BrowserNow => ({ id, live: true, usedAt: NOW, seenAt: NOW, focused: false, unsaved: false, session: null, ...over })
const screen = (visible: string[], zoom = 1): ScreenNow => ({ visible, zoom })

describe('sleepReason: when a Live Browser goes to sleep', () => {
  it('off every screen: Live until the threshold, asleep after it', () => {
    const away = browser('a', { seenAt: NOW - 30_000 })
    expect(sleepReason(away, [screen([])], NOW, SETTINGS)).toBeNull()
    expect(sleepReason({ ...away, seenAt: NOW - 30_001 }, [screen([])], NOW, SETTINGS)).toBe('offscreen')
    // No window at all is no screen that shows it either.
    expect(sleepReason({ ...away, seenAt: NOW - 30_001 }, [], NOW, SETTINGS)).toBe('offscreen')
  })

  it('on a screen whose Canvas is zoomed out below the readable zoom: asleep after the same threshold', () => {
    const far = browser('a', { seenAt: NOW - 30_001 })
    expect(sleepReason(far, [screen(['a'], 0.39)], NOW, SETTINGS)).toBe('far')
    // At the readable zoom itself it is read.
    expect(sleepReason(far, [screen(['a'], 0.4)], NOW, SETTINGS)).toBeNull()
    // Zoomed out on every screen that shows it, so it sleeps, whatever another screen without it shows.
    expect(sleepReason(far, [screen(['a'], 0.2), screen(['a'], 0.3), screen(['b'], 1)], NOW, SETTINGS)).toBe('far')
    // One screen that shows it readable keeps it.
    expect(sleepReason(far, [screen(['a'], 0.2), screen(['a'], 0.75)], NOW, SETTINGS)).toBeNull()
  })

  it('without the focus and without a Session\'s call for longer than the threshold; the focus keeps it', () => {
    const idle = browser('a', { usedAt: NOW - 300_001 })
    expect(sleepReason({ ...idle, usedAt: NOW - 300_000 }, [screen(['a'])], NOW, SETTINGS)).toBeNull()
    expect(sleepReason(idle, [screen(['a'])], NOW, SETTINGS)).toBe('idle')
    expect(sleepReason({ ...idle, focused: true }, [screen(['a'])], NOW, SETTINGS)).toBeNull()
  })

  it('never while a Session drives it: a call running, or its last call less than the idle threshold ago', () => {
    const lost = browser('a', { usedAt: NOW - 900_000, seenAt: NOW - 900_000 })
    const running = { ...lost, session: { driving: true, calls: 1, lastCallAt: NOW - 900_000 } }
    expect(sleepReason(running, [], NOW, SETTINGS)).toBeNull()
    const between = { ...lost, session: { driving: true, calls: 0, lastCallAt: NOW - 299_999 } }
    expect(drivenNow(between, NOW, SETTINGS)).toBe(true)
    expect(sleepReason(between, [], NOW, SETTINGS)).toBeNull()
    // A Session silent for longer than the idle threshold drives it no more.
    const gone = { ...lost, session: { driving: true, calls: 0, lastCallAt: NOW - 300_000 } }
    expect(sleepReason(gone, [], NOW, SETTINGS)).toBe('offscreen')
    // Taken over by the user, it is the user's: the rules as for any Browser.
    const taken = { ...lost, session: { driving: false, calls: 0, lastCallAt: NOW } }
    expect(sleepReason(taken, [], NOW, SETTINGS)).toBe('offscreen')
  })

  it('never while its page has a beforeunload handler', () => {
    expect(sleepReason(browser('a', { usedAt: 0, seenAt: 0, unsaved: true }), [], NOW, SETTINGS)).toBeNull()
  })

  it('a Browser shown in the second window only does not sleep; one shown in neither does', () => {
    const shownThere = browser('a', { seenAt: NOW - 60_000 })
    expect(sleepReason(shownThere, [screen(['b']), screen(['a'])], NOW, SETTINGS)).toBeNull()
    expect(browsersToSleep([shownThere, browser('b', { seenAt: NOW - 60_000 })], [screen([]), screen(['a'])], NOW, SETTINGS)).toEqual([{ id: 'b', reason: 'offscreen' }])
  })

  it('an Asleep Browser has nothing to sleep', () => {
    expect(sleepReason(browser('a', { live: false, seenAt: 0, usedAt: 0 }), [], NOW, SETTINGS)).toBeNull()
  })
})

describe('admit: the limit of Live Browsers', () => {
  it('under the limit nothing sleeps', () => {
    expect(admit([browser('a'), browser('b')], 'c', 'user', NOW, SETTINGS)).toEqual({ kind: 'live', evict: [], overLimit: false })
  })

  it('the N+1-th puts to sleep the Browser used longest ago, whoever opens it', () => {
    const live = [browser('new', { usedAt: NOW - 10 }), browser('oldest', { usedAt: NOW - 3_000 }), browser('middle', { usedAt: NOW - 2_000 })]
    expect(admit(live, 'fourth', 'user', NOW, SETTINGS)).toEqual({ kind: 'live', evict: ['oldest'], overLimit: false })
    expect(admit(live, 'fourth', 'session', NOW, SETTINGS)).toEqual({ kind: 'live', evict: ['oldest'], overLimit: false })
    // Waking one that is Asleep counts it not among the Live.
    expect(admit([...live, browser('fourth', { live: false, usedAt: 0 })], 'fourth', 'user', NOW, SETTINGS)).toEqual({ kind: 'live', evict: ['oldest'], overLimit: false })
  })

  it('skips the Browsers that may not sleep: driven by a Session, or with unsaved changes', () => {
    const live = [
      browser('driven', { usedAt: NOW - 9_000, session: { driving: true, calls: 1, lastCallAt: NOW } }),
      browser('form', { usedAt: NOW - 8_000, unsaved: true }),
      browser('free', { usedAt: NOW - 10 }),
    ]
    expect(admit(live, 'fourth', 'user', NOW, SETTINGS)).toEqual({ kind: 'live', evict: ['free'], overLimit: false })
  })

  it('all N busy: the user\'s Browser opens over the limit, a Session\'s call is refused and nothing sleeps', () => {
    const live = [
      browser('driven', { session: { driving: true, calls: 0, lastCallAt: NOW - 1_000 } }),
      browser('form', { unsaved: true }),
      browser('form-2', { unsaved: true }),
    ]
    expect(admit(live, 'fourth', 'user', NOW, SETTINGS)).toEqual({ kind: 'live', evict: [], overLimit: true })
    expect(admit(live, 'fourth', 'session', NOW, SETTINGS)).toEqual({ kind: 'busy' })
    expect(ALL_LIVE_BUSY).toBe('All Live Browsers are busy')
  })

  it('a smaller limit than the Browsers Live puts several to sleep, longest unused first', () => {
    const live = [browser('a', { usedAt: 3 }), browser('b', { usedAt: 1 }), browser('c', { usedAt: 2 })]
    expect(admit(live, 'd', 'user', NOW, { ...SETTINGS, maxLive: 2 })).toEqual({ kind: 'live', evict: ['b', 'c'], overLimit: false })
  })
})

describe('LiveBrowsers and the Session\'s calls under the limit', () => {
  const PROJECT = 'sleep-0a1b2c3d'
  const SESSION = 'sess-a'
  const SITE = 'http://127.0.0.1:4100'
  type Listener = (...args: unknown[]) => void

  /** A guest page: its debugger answers the commands of sleep; `unsaved` — it has a beforeunload handler. */
  class FakePage implements CdpContents {
    private static next = 1
    readonly id = FakePage.next++
    unsaved = false
    destroyed = false
    private attached = false
    readonly sent: string[] = []
    private readonly on_ = new Map<string, Set<Listener>>()
    readonly debugger: CdpDebugger = {
      attach: () => {
        this.attached = true
      },
      isAttached: () => this.attached,
      sendCommand: (method, params) => {
        this.sent.push(method)
        const expression = (params as { expression?: string } | undefined)?.expression
        if (method === 'Runtime.evaluate' && expression === 'window') return Promise.resolve({ result: { type: 'object', objectId: 'window' } })
        if (method === 'Runtime.evaluate' && expression === '[scrollX, scrollY]') return Promise.resolve({ result: { type: 'object', value: [0, 240] } })
        if (method === 'DOMDebugger.getEventListeners') return Promise.resolve({ listeners: this.unsaved ? [{ type: 'beforeunload' }] : [{ type: 'click' }] })
        if (method === 'Page.captureScreenshot') return Promise.resolve({ data: '/9j/4AAQ' })
        if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'main' } } })
        return Promise.resolve({})
      },
      on: ((event: string, listener: Listener) => this.listen(`debugger:${event}`, listener)) as CdpDebugger['on'],
    }
    isDestroyed = (): boolean => this.destroyed
    getURL = (): string => `${SITE}/`
    getTitle = (): string => 'Fixture'
    readonly on = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['on']
    readonly once = ((event: string, listener: Listener) => this.listen(event, listener)) as CdpContents['once']
    private listen(event: string, listener: Listener): this {
      const set = this.on_.get(event) ?? new Set()
      set.add(listener)
      this.on_.set(event, set)
      return this
    }
    close(): void {
      this.destroyed = true
      for (const listener of this.on_.get('destroyed') ?? []) listener()
    }
  }

  let scratch: string
  let store: LayoutStore
  let live: LiveBrowsers
  let server: typeof import('../../src/main/mcp/browser-server')
  let pages: Map<string, FakePage>
  let lives: BrowserLife[]
  let clock: number

  const browserNode = (id: string): LayoutNode => ({ id, kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { profile: 'admin-aaaaaa' } })

  /** The window: it draws a page for every Live Browser it was told of, and closes the page of an Asleep one. */
  function draw(): void {
    for (const life of lives) {
      const page = pages.get(life.nodeId)
      if (life.live && page === undefined) {
        const fresh = new FakePage()
        pages.set(life.nodeId, fresh)
        live.register(PROJECT, life.nodeId, fresh)
      } else if (!life.live && page !== undefined) {
        pages.delete(life.nodeId)
        page.close()
      }
    }
  }

  beforeEach(async () => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-browser-sleep-')))
    const dataDir = join(scratch, 'data')
    mkdirSync(join(scratch, 'repo'))
    mkdirSync(join(dataDir, PROJECT), { recursive: true })
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: join(scratch, 'repo') }], activeId: PROJECT }))
    vi.resetModules()
    process.env.WORFY_DATA_DIR = dataDir
    store = (await import('../../src/main/layout/store')).layoutStore()
    for (const id of ['b1', 'b2', 'b3', 'b4']) store.apply(PROJECT, { op: 'create', node: browserNode(id) })
    const { LiveBrowsers } = await import('../../src/main/browser/live')
    pages = new Map()
    lives = []
    clock = 1_000_000
    live = new LiveBrowsers({
      profileOf: () => ({ name: 'admin', origins: [SITE] }),
      changed: () => undefined,
      pressing: () => undefined,
      sleepSettings: () => SETTINGS,
      now: () => clock,
      browsersOf: (projectId) => store.get(projectId).layout.nodes.filter((node) => node.kind === 'browser').map((node) => node.id),
      livesChanged: (_projectId, next) => {
        lives = next
        queueMicrotask(draw)
      },
    })
    server = await import('../../src/main/mcp/browser-server')
    // The window shows the four: the first three wake, the fourth stays Asleep.
    await live.screen(1, { projectId: PROJECT, visible: ['b1', 'b2', 'b3', 'b4'], zoom: 1 })
    await vi.waitFor(() => expect([...pages.keys()].sort()).toEqual(['b1', 'b2', 'b3']))
  })

  afterEach(async () => {
    live.stop()
    await saveLayoutNow()
    delete process.env.WORFY_DATA_DIR
    removeTestTree(scratch)
  })

  const call = (name: Parameters<ReturnType<typeof server.browserToolCaller>>[0], args: unknown, session = SESSION) =>
    server.browserToolCaller({
      projectId: PROJECT,
      layout: { get: (projectId) => store.get(projectId), apply: (projectId, op) => store.apply(projectId, op) },
      profiles: () => [{ id: 'admin-aaaaaa', name: 'admin', origins: [SITE], autopilot: false }],
      live,
      sessionId: () => session,
      liveWaitMs: 500,
    })(name, args)
  const textOf = (result: { content: { type: string; text?: string }[] }): string => result.content[0]?.text ?? ''
  const lifeOf = (id: string): BrowserLife | undefined => live.lives(PROJECT).find((each) => each.nodeId === id)

  /** Every Live Browser busy: b1 and b2 with a beforeunload handler, b3 driven by another Session's call that runs now. */
  function allBusy(): void {
    pages.get('b1')!.unsaved = true
    pages.get('b2')!.unsaved = true
    live.drive(PROJECT, 'b3', 'sess-other')
    live.sessionDrives(PROJECT, 'b3')
  }

  it('all Live Browsers busy: the Session\'s call on an Asleep Browser is refused with «All Live Browsers are busy», and nothing changes', async () => {
    allBusy()
    const answer = await call('browser_screenshot', { id: 'b4' })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toContain(ALL_LIVE_BUSY)
    expect(lifeOf('b4')?.live).toBe(false)
    expect(['b1', 'b2', 'b3'].map((id) => lifeOf(id)?.live)).toEqual([true, true, true])
    // The refused call took nothing: no «Claude is driving» on b4.
    expect(live.control(PROJECT, 'b4')).toBeNull()
  })

  it('all Live Browsers busy: browser_open is refused and makes no Browser', async () => {
    allBusy()
    const answer = await call('browser_open', { profile: 'admin-aaaaaa' })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toContain(ALL_LIVE_BUSY)
    expect(store.get(PROJECT).layout.nodes.map((node) => node.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('a Session\'s call wakes an Asleep Browser and puts to sleep the Live one used longest ago that may sleep, keeping its picture', async () => {
    allBusy()
    // b2's form is saved: its page has no handler any more.
    pages.get('b2')!.unsaved = false
    clock += 1_000
    const answer = await call('browser_screenshot', { id: 'b4' })
    expect(answer.isError, textOf(answer)).toBeFalsy()
    expect(answer.content[0]).toMatchObject({ type: 'image' })
    expect(lifeOf('b4')).toMatchObject({ live: true, overLimit: false })
    expect(lifeOf('b2')).toMatchObject({ live: false })
    expect(lifeOf('b2')?.picture).not.toBeNull()
    expect(live.pictureOf(PROJECT, 'b2')).toEqual({ image: '/9j/4AAQ', scroll: { x: 0, y: 240 } })
    expect(['b1', 'b3'].map((id) => lifeOf(id)?.live)).toEqual([true, true])
    // The page of b4 the window drew is the one the call used.
    await vi.waitFor(() => expect(pages.has('b2')).toBe(false))
  })

  it('the user\'s click on an Asleep Browser while all are busy opens it over the limit', async () => {
    allBusy()
    expect(await live.wake(PROJECT, 'b4', 'user')).toEqual({ overLimit: true })
    expect(lifeOf('b4')).toMatchObject({ live: true, overLimit: true })
    expect(['b1', 'b2', 'b3'].map((id) => lifeOf(id)?.live)).toEqual([true, true, true])
    // b1's and b2's pages were asked: their frames say «Unsaved changes».
    expect(['b1', 'b2'].map((id) => lifeOf(id)?.unsaved)).toEqual([true, true])
  })

  it('a check of the rules does not put to sleep a Browser a Session drives, though no screen shows it any more', async () => {
    live.drive(PROJECT, 'b1', SESSION)
    live.sessionDrives(PROJECT, 'b1')
    live.sessionReleases(PROJECT, 'b1')
    await live.screen(1, { projectId: PROJECT, visible: [], zoom: 1 })
    clock += 60_000
    await live.check()
    expect(lifeOf('b1')?.live).toBe(true)
    expect(['b2', 'b3'].map((id) => lifeOf(id)?.live)).toEqual([false, false])
  })
})
