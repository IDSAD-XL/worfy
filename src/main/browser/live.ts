// The Live Browsers of this Machine and who drives each one (ADR-0078 items 8 and 12, worfy-browser
// ticket 04). A Browser is Live while a window draws its <webview>: the Browser layer of that window
// tells main the page's web contents (`browser.page.live`, src/main/ipc/browser.ts), and main keeps
// one CdpPage per Browser Node (src/main/browser/cdp.ts) until the page is closed.
//
// Control (the owner's decision 3):
// - A Session drives a Browser from its first call on it (`drive`): the Browser shows «Claude is
//   driving», and every whole-page navigation outside the origins of its profile is refused.
// - A click or a key of the user in that Browser — on the page or on its frame — takes it over
//   (`takeOver`): the banner goes, the user goes anywhere, and every call of a Session on it is
//   refused with TAKEN_OVER until the user presses «Return control to Claude» (`giveBack`). Then the
//   Session that drove it drives it again.
// - One Session at a time: another Session's call is refused while one drives it.
// Control is kept by Browser Node, not by page: a page the window draws again (a reload of the
// window, a Browser moved back from the Trash) keeps it.
// shortcut: control outlives the Session that drove the Browser (the banner stays after it ends), redo when worfy-browser ticket 06 ties a Browser to its Session's life.
// shortcut: a Browser drawn by two windows of one Project is driven in the window that told main last, redo with worfy-browser ticket 07 (one Live page for every screen).
import { originRefusal } from './origins'
import { CdpPage, type CdpContents } from './cdp'
import { browserProfileStore } from './profiles'
import { toEveryWindow } from '../broadcast'
import { emit } from '../ipc'
import { layoutStore } from '../layout/store'
import { TAKEN_OVER, type BrowserControlMode } from '../../shared/browser/tools'
import { browserControlChanged } from '../../shared/ipc/browser'

/** Who drives a Browser, and which Session drove it last. */
export interface BrowserControl {
  mode: BrowserControlMode
  sessionId: string
}

export interface LiveBrowsersDeps {
  /** The name and origins of the Browser profile of Browser Node `nodeId`; null when the Node or its profile is gone. */
  profileOf(projectId: string, nodeId: string): { name: string; origins: readonly string[] } | null
  /** Told after the control of a Browser changed: null when nobody drives it any more. */
  changed(projectId: string, nodeId: string, mode: BrowserControlMode | null): void
}

/** A call a Session may not make on a Browser now; its message is the tool's answer. */
export class ControlError extends Error {}

const keyOf = (projectId: string, nodeId: string): string => `${projectId}\n${nodeId}`

export class LiveBrowsers {
  private readonly pages = new Map<string, CdpPage>()
  private readonly controls = new Map<string, BrowserControl>()
  private readonly waiting = new Map<string, Set<(page: CdpPage) => void>>()

  constructor(private readonly deps: LiveBrowsersDeps) {}

  /** The page of Browser Node `nodeId` is `contents` from now on, until it is closed. */
  register(projectId: string, nodeId: string, contents: CdpContents): CdpPage {
    const key = keyOf(projectId, nodeId)
    const current = this.pages.get(key)
    if (current !== undefined && current.contents.id === contents.id && !contents.isDestroyed()) return current
    const page = new CdpPage(contents, {
      driving: () => this.controls.get(key)?.mode === 'claude',
      refusal: (url) => {
        const profile = this.deps.profileOf(projectId, nodeId)
        return profile === null ? 'This Browser has no Browser profile any more, so a Session may open no page in it.' : originRefusal(url, profile.name, profile.origins)
      },
      onUserInput: () => this.takeOver(projectId, nodeId),
    })
    this.pages.set(key, page)
    contents.once('destroyed', () => {
      if (this.pages.get(key) === page) this.pages.delete(key)
    })
    const waiters = this.waiting.get(key)
    this.waiting.delete(key)
    for (const resolve of waiters ?? []) resolve(page)
    return page
  }

  /** The page of Browser Node `nodeId` while it is Live. */
  page(projectId: string, nodeId: string): CdpPage | undefined {
    const page = this.pages.get(keyOf(projectId, nodeId))
    return page === undefined || page.contents.isDestroyed() ? undefined : page
  }

  /** The page of Browser Node `nodeId`, waiting at most `ms` for a window to draw it; undefined after that. */
  whenLive(projectId: string, nodeId: string, ms: number): Promise<CdpPage | undefined> {
    const now = this.page(projectId, nodeId)
    if (now !== undefined) return Promise.resolve(now)
    const key = keyOf(projectId, nodeId)
    return new Promise((resolve) => {
      const waiters = this.waiting.get(key) ?? new Set()
      this.waiting.set(key, waiters)
      const done = (page: CdpPage | undefined) => {
        clearTimeout(timer)
        waiters.delete(done)
        resolve(page)
      }
      const timer = setTimeout(() => done(undefined), ms)
      waiters.add(done)
    })
  }

  control(projectId: string, nodeId: string): BrowserControl | null {
    return this.controls.get(keyOf(projectId, nodeId)) ?? null
  }

  /** The Browsers of Project `projectId` somebody drives, with who drives each one. */
  controlsOf(projectId: string): { nodeId: string; mode: BrowserControlMode }[] {
    const prefix = keyOf(projectId, '')
    return [...this.controls].filter(([key]) => key.startsWith(prefix)).map(([key, control]) => ({ nodeId: key.slice(prefix.length), mode: control.mode }))
  }

  /**
   * Session `sessionId` drives Browser Node `nodeId` from now on. Throws ControlError when the user
   * took it over and has not given it back, or when another Session drives it.
   */
  drive(projectId: string, nodeId: string, sessionId: string): void {
    const key = keyOf(projectId, nodeId)
    const control = this.controls.get(key)
    if (control?.mode === 'user') throw new ControlError(`${TAKEN_OVER}: the user is using it now. Wait until they press «Return control to Claude» in it, or ask them in the chat.`)
    if (control !== undefined && control.sessionId !== sessionId) throw new ControlError('Another Session drives this Browser now. Open a Browser of your own with browser_open.')
    if (control !== undefined) return
    this.controls.set(key, { mode: 'claude', sessionId })
    this.deps.changed(projectId, nodeId, 'claude')
  }

  /** The user took Browser Node `nodeId` over: true when a Session was driving it. */
  takeOver(projectId: string, nodeId: string): boolean {
    const key = keyOf(projectId, nodeId)
    const control = this.controls.get(key)
    if (control?.mode !== 'claude') return false
    this.controls.set(key, { mode: 'user', sessionId: control.sessionId })
    this.deps.changed(projectId, nodeId, 'user')
    return true
  }

  /** The user pressed «Return control to Claude»: the Session that drove the Browser drives it again. True when it was taken over. */
  giveBack(projectId: string, nodeId: string): boolean {
    const key = keyOf(projectId, nodeId)
    const control = this.controls.get(key)
    if (control?.mode !== 'user') return false
    this.controls.set(key, { mode: 'claude', sessionId: control.sessionId })
    this.deps.changed(projectId, nodeId, 'claude')
    return true
  }
}

let shared: LiveBrowsers | undefined

/** The Live Browsers of the running app: profiles from the Project's Layout and Browser profiles, changes to every window. */
export function liveBrowsers(): LiveBrowsers {
  shared ??= new LiveBrowsers({
    profileOf: (projectId, nodeId) => {
      const node = layoutStore().get(projectId).layout.nodes.find((each) => each.id === nodeId)
      const id = node?.data.profile
      const profile = typeof id === 'string' ? browserProfileStore().list(projectId).find((each) => each.id === id) : undefined
      return profile === undefined ? null : { name: profile.name, origins: profile.origins }
    },
    changed: (projectId, nodeId, mode) => toEveryWindow((client) => emit(client, browserControlChanged, { projectId, nodeId, mode })),
  })
  return shared
}
