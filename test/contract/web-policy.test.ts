// The app-wide web policy of src/main/window.ts over a mocked `electron` module: which windows a
// page may open, which permissions it is granted and where its frames may navigate. These are
// main's own decisions, checked here without the Card iframe's sandbox in front of them: a Card's
// popup reaches main with an empty referrer, so the decision must not depend on who opened it.
import type { HandlerDetails, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appUrlMatcher } from '../../src/main/ipc/index'
import { grantsPermission, installWebPolicy, windowOpenResponse } from '../../src/main/window'
import { APP_URL as INDEX_URL, INDEX_HTML } from '../app-url'

const APP_URL = `${INDEX_URL}#/canvas`
const CARD = 'worfy-card://c1.0a1b2c3d/index.html'

type Listener = (...args: unknown[]) => void

const electron = vi.hoisted(() => ({
  appListeners: new Map<string, ((...args: unknown[]) => void)[]>(),
  permissionHandler: undefined as undefined | ((...args: unknown[]) => void),
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: Listener) => {
      electron.appListeners.set(event, [...(electron.appListeners.get(event) ?? []), listener])
    },
  },
  BrowserWindow: {},
  screen: {},
  session: {
    defaultSession: {
      setPermissionRequestHandler: (handler: Listener) => {
        electron.permissionHandler = handler
      },
    },
    // The session of a Browser partition; its own handlers are pinned in test/unit/window-options.test.ts.
    fromPartition: () => ({ setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined }),
  },
}))

const isAppUrl = appUrlMatcher({ indexHtml: INDEX_HTML })

function details(url: string, referrer: string): HandlerDetails {
  return { url, referrer: { url: referrer, policy: 'no-referrer' }, frameName: '', features: '', disposition: 'new-window' } as HandlerDetails
}

/** A web contents as installWebPolicy sees it: its event listeners and its window-open handler. */
function fakeContents() {
  const listeners = new Map<string, Listener>()
  let openHandler: ((details: HandlerDetails) => unknown) | undefined
  const contents = {
    getType: () => 'window',
    on: (event: string, listener: Listener) => listeners.set(event, listener),
    setWindowOpenHandler: (handler: (details: HandlerDetails) => unknown) => {
      openHandler = handler
    },
  }
  return {
    contents: contents as unknown as WebContents,
    navigate: (navigation: { isMainFrame: boolean; frameUrl: string; url: string }) => {
      const preventDefault = vi.fn()
      listeners.get('will-frame-navigate')?.({ isMainFrame: navigation.isMainFrame, frame: { url: navigation.frameUrl }, url: navigation.url, preventDefault })
      return preventDefault.mock.calls.length === 0
    },
    open: (request: HandlerDetails) => openHandler?.(request),
  }
}

describe('main refuses every new window, whoever asks', () => {
  const cases: [string, HandlerDetails][] = [
    ['a Card opens a web page; its no-referrer policy leaves the referrer empty', details('https://127.0.0.1:9/', '')],
    ['a Card opens about:blank', details('about:blank', '')],
    ['a Card opens another Card', details('worfy-card://c2.0a1b2c3d/index.html', '')],
    ['a page with a Card referrer opens the web', details('https://example.com/', CARD)],
    ['the app window opens a web page', details('https://example.com/', APP_URL)],
    ['the app window opens a file', details('file:///etc/hosts', APP_URL)],
  ]
  for (const [name, request] of cases) {
    it(`denies: ${name}`, () => {
      expect(windowOpenResponse(request)).toEqual({ action: 'deny' })
    })
  }
})

describe('main grants web permissions to the app renderer only', () => {
  const cases: [string, string, boolean][] = [
    ['the app renderer', APP_URL, true],
    ['a Card', CARD, false],
    ['a web page', 'https://example.com/', false],
    ['another file', 'file:///tmp/other/index.html', false],
    ['a frame with no URL yet', '', false],
    ['about:blank', 'about:blank', false],
  ]
  for (const [name, url, granted] of cases) {
    it(`${granted ? 'grants' : 'refuses'}: ${name}`, () => {
      expect(grantsPermission(url, isAppUrl)).toBe(granted)
    })
  }
})

describe('installWebPolicy puts the decisions on every web contents and the session', () => {
  beforeEach(() => {
    electron.appListeners.clear()
    electron.permissionHandler = undefined
    installWebPolicy(isAppUrl)
  })

  function created() {
    const fake = fakeContents()
    const listeners = electron.appListeners.get('web-contents-created') ?? []
    expect(listeners).toHaveLength(1)
    for (const listener of listeners) listener({}, fake.contents)
    return fake
  }

  it('refuses a window that a Card frame asks for with an empty referrer, and one the window asks for', () => {
    const fake = created()
    expect(fake.open(details('https://127.0.0.1:9/', ''))).toEqual({ action: 'deny' })
    expect(fake.open(details('https://example.com/', APP_URL))).toEqual({ action: 'deny' })
  })

  it('keeps a Card frame on its own origin and the window off Cards', () => {
    const fake = created()
    expect(fake.navigate({ isMainFrame: false, frameUrl: CARD, url: 'worfy-card://c1.0a1b2c3d/page.html' })).toBe(true)
    expect(fake.navigate({ isMainFrame: false, frameUrl: CARD, url: 'worfy-card://c2.0a1b2c3d/index.html' })).toBe(false)
    expect(fake.navigate({ isMainFrame: false, frameUrl: CARD, url: 'https://example.com/' })).toBe(false)
    expect(fake.navigate({ isMainFrame: true, frameUrl: APP_URL, url: CARD })).toBe(false)
    expect(fake.navigate({ isMainFrame: true, frameUrl: '', url: APP_URL })).toBe(true)
  })

  it('answers permission requests: the renderer yes, a Card and anything else no', () => {
    const answer = (requestingUrl: string): unknown => {
      const callback = vi.fn()
      electron.permissionHandler?.({}, 'notifications', callback, { requestingUrl })
      expect(callback).toHaveBeenCalledTimes(1)
      return callback.mock.calls[0]?.[0]
    }
    expect(answer(APP_URL)).toBe(true)
    expect(answer(CARD)).toBe(false)
    expect(answer('https://example.com/')).toBe(false)
    expect(answer('')).toBe(false)
  })
})
