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
// - Control ends with the Session's place on the Canvas (worfy-browser ticket 06, ADR-0078 item
//   11): once an operation takes the last Node of a Session off it — Hide, Remove, the archive —
//   main drops every control of that Session (`sessionsLeft` of the Layout change). Its own
//   Browsers left the Canvas in the same operation (src/main/layout/store.ts), all but those the
//   user took over or whose page has unsaved changes (`staysWithUser`): these stay as the user's
//   own, like a Browser of the user it drove. Such a Browser stays, its banner — «Claude is driving» or «Return control to Claude» — goes, and
//   the user has it to themselves. A call of that Session still running on it stops before its next
//   command to the page, with an answer that the Session left (`left` of the page's guard), even
//   when another Session or the user has the Browser by then: the mark is kept by Browser and
//   Session, and each command asks it for the Session of its own call (`asSession`, an
//   AsyncLocalStorage around the call). Until the calls on it end and the user has not used the
//   page, the pages such a call leads to are still checked against the origins (`walled`); and the
//   Session takes no Browser again while it is off the Canvas (src/main/mcp/browser-server.ts).
//
// One Live page for every screen (worfy-browser ticket 07, ADR-0078 item 16): of the windows of this
// Machine that show a Project, only the owner of a Browser (owner.ts) draws its page — `here` of its
// life, told to each window for itself; a page another window hands main is refused. The other
// windows and the Linked machines with full access show its frames (screencast.ts) and send their
// input to it (`input`, `navigate`): the user's own input, which takes the Browser over from a Session
// as a click on the page does. Once the user's input in another window of this Machine has rested for
// MOVE_REST_MS, the page moves there: main keeps where it is scrolled, the old window closes the page,
// and the new one opens the Node's address again — a reload, as a wake is (question 2 of the ticket).
// A page with a `beforeunload` handler does not move, so an unsaved form is not lost by the move;
// nor does a page a Session drives or has a call running on, so the call does not fail on a closed
// page; that window keeps showing frames (the answer to question 2, taken without the owner).
// A Linked machine never owns the page. Its screens (`screen` with a string id) count for the rules
// of sleep, as a window does, for LINKED_SCREEN_MS after each report; they do not open a Project's
// Browsers, since no window of this Machine would draw their pages.
//
// Live and Asleep (worfy-browser ticket 05, ADR-0078 items 6, 7, 15 and 16): main keeps the life of
// every Browser of the Machine — Live or Asleep — and makes the one decision for all windows by the
// rules of sleep.ts. Each window tells main which Browser frames it shows and at which zoom
// (`screen`); main sees itself which page has the keyboard focus and which one the user presses,
// types in or scrolls (`used`). A window draws a page only for a Live Browser
// (`browser.lives.changed`, src/shared/ipc/browser.ts). Every second (`check`) main puts to sleep
// the Browsers the rules name: it asks the page over CDP for a `beforeunload` handler first — a page
// with one stays Live and its frame says «Unsaved changes» — then keeps a picture of the page and
// where it is scrolled, and the window closes the page. A click on the frame (`wake`, by the user)
// or a Session's call (`sessionDrives` then `wake`, by the Session) wakes it: the page loads the
// Node's address again and main scrolls it back. Opening or waking one beyond the limit puts to
// sleep the Live Browser used longest ago that may sleep; when none may, the user's opens over the
// limit, flagged so, and the Session's call is refused with ALL_LIVE_BUSY and repeated later by the
// Session itself (the answer to question 4 of the ticket, taken without the owner).
// When main first hears of a Project's screen (after a start of worfy, or after the Project was
// closed) the Browsers it shows, then the others, wake by themselves up to the limit; the rest are
// Asleep without a picture (question 3). A place counts as free then when its Browser has no page
// and no screen shows it (the Browsers of the Project the window showed before): giving it up loses
// nothing. The same holds for an Asleep Browser without a picture that a screen shows readable: it
// wakes by itself when such a place is there. Pictures are kept in main's memory only, never in the
// Layout a Linked machine reads (question 2); the records of a Project no window shows are dropped
// once all its Browsers sleep.
// A Session's call wakes a Browser only while a window of this Machine shows its Project: no other
// window would draw its page (NOT_SHOWN).
// shortcut: a picture does not outlive a restart of worfy (an Asleep Browser shows an empty frame after it), redo if the owner wants the pictures kept in the Project's data folder.
// A Browser whose frame asks for a profile has no page and no life: it is opened once it has one.
import { AsyncLocalStorage } from 'node:async_hooks'
import { originRefusal } from './origins'
import { CdpPage, type CdpContents, type PagePicture } from './cdp'
import { browserProfileStore } from './profiles'
import { NO_OWNER, nextOwners, ownersAmong, type Owners, type WindowId } from './owner'
import { admit, ALL_LIVE_BUSY, browsersToSleep, drivenNow, fitLimit, readableNow, screensNow, type BrowserNow, type ScreenNow, type SleepSettings, type Waker } from './sleep'
import { toEveryWindow } from '../broadcast'
import { isWindowId, type ClientId } from '../clients'
import { emit } from '../ipc'
import { layoutStore, type LayoutChange } from '../layout/store'
import { projectStore } from '../projects/store'
import { appSettingsStore } from '../settings/store'
import { BROWSER_KIND, TAKEN_OVER, type BrowserControlMode } from '../../shared/browser/tools'
import { browserControlChanged, browserLivesChanged, browserPressing, type BrowserInput, type BrowserLife } from '../../shared/ipc/browser'
import { shownOnCanvas } from '../../shared/layout/derived'
import { BROWSER_SLEEP_DEFAULTS, browserSleepOf, type BrowserSleep } from '../../shared/settings/app-settings'

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
  /** Told when a click of the Session on Browser Node `nodeId` starts and ends. */
  pressing(projectId: string, nodeId: string, phase: 'start' | 'end'): void
  /** The sleep settings in force; BROWSER_SLEEP_DEFAULTS without it. */
  sleepSettings?(): SleepSettings
  /** The clock; Date.now without it. */
  now?(): number
  /**
   * The Browser Nodes of the Project shown on its Canvas that have a page (a profile); null when this
   * Machine has no such Project (deleted, or a Linked machine's). Without it, every Browser main knows of.
   */
  browsersOf?(projectId: string): readonly string[] | null
  /** Told after a Browser of the Project woke, went to sleep or changed its marks. */
  livesChanged?(projectId: string, lives: BrowserLife[]): void
  /** Subscribes to every change of a Layout (LayoutStore.onChange); returns the unsubscribe. */
  layoutChanges?(listener: (change: Pick<LayoutChange, 'projectId' | 'sessionsLeft'>) => void): () => void
  /**
   * Gives the Layout the rule of which Browsers stay with the user when their Session leaves the
   * Canvas, and how to ask their pages first (LayoutStore.setBrowserKeeper); returns what takes it back.
   */
  browserKeeper?(keeps: (projectId: string, nodeId: string) => boolean, ask: (projectId: string, nodeIds: readonly string[]) => Promise<void>): () => void
}

/** What main keeps of one Browser between its pages (worfy-browser ticket 05). */
interface Life {
  projectId: string
  nodeId: string
  live: boolean
  usedAt: number
  seenAt: number
  /** A page of it had a `beforeunload` handler the last time main asked. */
  unsaved: boolean
  /** A page of it could not be asked (its DevTools open, no answer in time): it stays Live, without the «Unsaved changes» mark. */
  unasked: boolean
  /** When main asked last, to ask a page with a handler again a few seconds later. */
  askedAt: number
  /** Live beyond the limit, opened by the user while every other Live Browser was busy. */
  overLimit: boolean
  picture: (PagePicture & { version: number }) | null
  /** Where the next page of the Browser is scrolled once it loads: the place it went to sleep at. */
  restore: { x: number; y: number } | null
}

/** The sleep settings of Settings → Browser as the rules count them, in milliseconds. */
export function sleepSettingsOf(chosen: BrowserSleep): SleepSettings {
  return { maxLive: chosen.maxLive, offscreenMs: chosen.offscreenSeconds * 1000, idleMs: chosen.idleMinutes * 60_000, minZoom: chosen.zoom }
}
/** How often main checks the rules of sleep. */
const CHECK_MS = 1_000
/** How long a page with a `beforeunload` handler stays Live before main asks it again. */
const ASK_AGAIN_MS = 5_000
/** How long main waits for a page's answer before sleep; a page that does not answer stays Live. */
const ASK_MS = 3_000
/** How long the user's input in the frames of another window rests before the page moves there. */
export const MOVE_REST_MS = 1_500

/** The answer to input or an address for a Browser whose page is not Live now. */
export const NO_LIVE_PAGE = 'This Browser has no Live page now: wake it first.'

/** `promise`, or a rejection after `ms`. */
function soon<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<never>((_resolve, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)))]).finally(() => clearTimeout(timer))
}

/** A call a Session may not make on a Browser now; its message is the tool's answer. */
export class ControlError extends Error {}

/** The answer of a Session's call on a Browser of a Project no window of this Machine shows. */
export const NOT_SHOWN = "No window of worfy on this Machine shows this Project's Canvas, so none of its Browsers can be Live. Ask the user to open the Project, then call again."

/** What main knows of a Project's Browsers: their ids; 'any' — no list, every one; 'gone' — no such Project here; 'unknown' — the list could not be read now. */
type BrowsersNow = readonly string[] | 'any' | 'gone' | 'unknown'

const keyOf = (projectId: string, nodeId: string): string => `${projectId}\n${nodeId}`

/**
 * A screen main counts for the rules of sleep: a window of this Machine, by its id, or one window of a
 * Linked machine, "<client id> <screen id>" — the windows of a Linked machine share one client.
 */
export type ScreenKey = WindowId | `${string} ${string}`

/** The key of the screen `screen` of client `client` (a window's own id for a window here). */
export function screenKey(client: ClientId, screen: string | undefined): ScreenKey {
  return isWindowId(client) ? client : `${client} ${screen ?? ''}`
}

/** Whether screen `key` is one of Linked machine client `client`. */
const screenOfClient = (key: ScreenKey, client: string): boolean => !isWindowId(key) && key.startsWith(`${client} `)

/** The Session whose tool call runs now, for each command that call sends to a page. */
const callingSession = new AsyncLocalStorage<string>()

export class LiveBrowsers {
  /** The page a Session drives, of each Live Browser: the one a window told main of last. */
  private readonly pages = new Map<string, CdpPage>()
  /** Every page of each Live Browser, by the id of its web contents: one per window that draws it. */
  private readonly drawn = new Map<string, Map<number, CdpPage>>()
  private readonly controls = new Map<string, BrowserControl>()
  private readonly waiting = new Map<string, Set<(page: CdpPage) => void>>()
  private readonly lifes = new Map<string, Life>()
  /** The calls of Sessions running on each Browser, and when the last one began or ended. */
  private readonly calls = new Map<string, { running: number; lastCallAt: number }>()
  /**
   * What each screen shows: a window of this Machine by the id of its web contents, a window of a
   * Linked machine by `<client id> <screen id>` (a string). A Map keeps the order the screens came in.
   */
  private readonly screens = new Map<ScreenKey, { projectId: string; screen: ScreenNow }>()
  /** Which window of this Machine draws the page of each Browser (owner.ts). */
  private readonly owners = new Map<string, Owners>()
  /** The window of the user's latest input in the frames of each Browser, until it rests and the page moves there. */
  private readonly moving = new Map<string, { window: WindowId; timer: ReturnType<typeof setTimeout> }>()
  /** Told of every new page of a Browser (screencast.ts). */
  private readonly pageListeners = new Set<(projectId: string, nodeId: string) => void>()
  /** The Projects main has heard a screen of since worfy started. */
  private readonly seen = new Set<string>()
  /** Every change of lives, one after another: a sleep, a wake, a check. */
  private queue: Promise<unknown> = Promise.resolve()
  private checking = false
  private timer: ReturnType<typeof setInterval> | undefined
  private pictures = 0
  /** The limit of the last check: a lower one puts Browsers to sleep at once. */
  private lastMaxLive: number | undefined
  /** The Projects whose Browsers could not be read, told to the log once until they can again. */
  private readonly unread = new Set<string>()

  private readonly unsubscribe: (() => void) | undefined
  private readonly unkeep: (() => void) | undefined
  /**
   * The Browsers whose driving Session left the Canvas while a call of it was running on them, until
   * the calls on them end: which Sessions left, and whether their pages are still checked against
   * the origins (until the user uses the page).
   */
  private readonly leftMidCall = new Map<string, { sessions: Set<string>; walled: boolean }>()

  constructor(private readonly deps: LiveBrowsersDeps) {
    this.unsubscribe = deps.layoutChanges?.((change) => this.sessionsLeft(change.projectId, change.sessionsLeft ?? []))
    this.unkeep = deps.browserKeeper?.(
      (projectId, nodeId) => this.staysWithUser(projectId, nodeId),
      (projectId, nodeIds) => this.askUnsaved(projectId, nodeIds),
    )
  }

  /**
   * True when Browser Node `nodeId` stays on the Canvas as the user's own when the Session that opened
   * it leaves (owner decision 2026-10-22, ADR-0078 Amendments): the user took it over and has not
   * given it back, or its page has unsaved changes — a `beforeunload` handler the last time main asked
   * (askUnsaved asks just before such an operation). A page that could not answer is kept too, as
   * sleep keeps it: what it holds is not known.
   */
  staysWithUser(projectId: string, nodeId: string): boolean {
    const key = keyOf(projectId, nodeId)
    if (this.controls.get(key)?.mode === 'user') return true
    const life = this.lifes.get(key)
    return life !== undefined && life.live && (life.unsaved || life.unasked)
  }

  /**
   * Asks every page of the Live Browsers `nodeIds` whether it has a `beforeunload` handler, right
   * before an operation that may take them off the Canvas with their Session: the user may be typing
   * in a page main never asked (it asks before sleep only). Each page answers within ASK_MS.
   */
  async askUnsaved(projectId: string, nodeIds: readonly string[]): Promise<void> {
    await Promise.all(
      nodeIds.map((nodeId) => {
        const life = this.lifes.get(keyOf(projectId, nodeId))
        return life?.live === true ? this.ask(life) : undefined
      }),
    )
  }

  /**
   * The ⌘Z of a step that took Session `sessionId` off the Canvas while the user had Browser
   * `nodeId` taken over from it: the user has it taken over from that Session again, so the Session
   * waits for «Return control to Claude». False when somebody drives it by now.
   */
  holdForUser(projectId: string, nodeId: string, sessionId: string): boolean {
    const key = keyOf(projectId, nodeId)
    if (this.controls.has(key)) return false
    this.controls.set(key, { mode: 'user', sessionId })
    this.deps.changed(projectId, nodeId, 'user')
    return true
  }

  /** Sessions of Project `projectId` left the Canvas: nobody drives what they drove. */
  private sessionsLeft(projectId: string, sessions: readonly string[]): void {
    if (sessions.length === 0) return
    const prefix = keyOf(projectId, '')
    for (const [key, control] of [...this.controls]) {
      if (!key.startsWith(prefix) || !sessions.includes(control.sessionId)) continue
      if (control.mode === 'claude' && (this.calls.get(key)?.running ?? 0) > 0) {
        const mark = this.leftMidCall.get(key) ?? { sessions: new Set<string>(), walled: true }
        mark.sessions.add(control.sessionId)
        mark.walled = true
        this.leftMidCall.set(key, mark)
      }
      this.controls.delete(key)
      this.deps.changed(projectId, key.slice(prefix.length), null)
    }
  }

  /**
   * The page of Browser Node `nodeId` is `contents` from now on, until it is closed. Null — refused —
   * while the Browser is Asleep: the window that drew it closes it on the next `browser.lives.changed`.
   */
  register(projectId: string, nodeId: string, contents: CdpContents, window?: WindowId): CdpPage | null {
    const key = keyOf(projectId, nodeId)
    const life = this.lifes.get(key)
    if (life !== undefined && !life.live) return null
    // Only the owner draws the page; a window before any owner (its report has not come yet) becomes it.
    if (window !== undefined) {
      const owner = this.ownerOf(projectId, nodeId)
      if (owner !== null && owner !== window) return null
      if (owner === null) this.owners.set(key, nextOwners(this.owners.get(key) ?? NO_OWNER, { kind: 'work', window }))
    }
    if (life === undefined) this.lifes.set(key, this.born(projectId, nodeId, true))
    const drawn = this.drawn.get(key) ?? new Map<number, CdpPage>()
    this.drawn.set(key, drawn)
    const known = drawn.get(contents.id)
    if (known !== undefined && !contents.isDestroyed()) {
      this.pages.set(key, known)
      return known
    }
    const page = new CdpPage(contents, {
      driving: () => this.controls.get(key)?.mode === 'claude',
      left: () => {
        const mark = this.leftMidCall.get(key)
        const caller = callingSession.getStore()
        // Outside a call (an event of the page) any Session that left counts.
        return mark !== undefined && (caller === undefined ? mark.sessions.size > 0 : mark.sessions.has(caller))
      },
      walled: () => this.leftMidCall.get(key)?.walled === true,
      refusal: (url) => {
        const profile = this.deps.profileOf(projectId, nodeId)
        return profile === null ? 'This Browser has no Browser profile any more, so a Session may open no page in it.' : originRefusal(url, profile.name, profile.origins)
      },
      onUserInput: () => {
        // The user's own browsing is not held to the origins of a call that is ending; that call
        // still answers that its Session left.
        const mark = this.leftMidCall.get(key)
        if (mark !== undefined) mark.walled = false
        this.takeOver(projectId, nodeId)
      },
      used: () => {
        const life = this.lifes.get(key)
        if (life !== undefined) life.usedAt = this.now()
        // Work on the page itself: its window stays the owner, before the ones worked in earlier.
        if (window !== undefined && this.ownerOf(projectId, nodeId) === window) this.owners.set(key, nextOwners(this.owners.get(key) ?? NO_OWNER, { kind: 'work', window }))
      },
      pressing: (phase) => this.deps.pressing(projectId, nodeId, phase),
    })
    this.pages.set(key, page)
    drawn.set(contents.id, page)
    contents.once('destroyed', () => {
      const still = this.drawn.get(key)
      if (still?.get(contents.id) === page) still.delete(contents.id)
      if (this.pages.get(key) !== page) return
      // The page of another window that draws the Browser is the one a Session drives from now on.
      const other = this.pagesOf(key)[0]
      if (other === undefined) this.pages.delete(key)
      else this.pages.set(key, other)
    })
    const waiters = this.waiting.get(key)
    this.waiting.delete(key)
    for (const resolve of waiters ?? []) resolve(page)
    const restore = this.lifes.get(key)?.restore ?? null
    if (restore !== null) {
      this.lifes.get(key)!.restore = null
      page.restoreScroll(restore).catch((error: unknown) => console.warn(`Browser ${nodeId}: could not scroll the woken page back`, error))
    }
    for (const listener of [...this.pageListeners]) listener(projectId, nodeId)
    return page
  }

  /** Calls `listener` with every new page of a Browser; returns the unsubscribe. */
  onPage(listener: (projectId: string, nodeId: string) => void): () => void {
    this.pageListeners.add(listener)
    return () => this.pageListeners.delete(listener)
  }

  /** The windows of this Machine that show Project `projectId`, in the order they came. */
  private showing(projectId: string): WindowId[] {
    return [...this.screens].flatMap(([id, each]) => (isWindowId(id) && each.projectId === projectId ? [id] : []))
  }

  /** The window of this Machine that draws the page of Browser `nodeId`; null while no window shows its Project. */
  ownerOf(projectId: string, nodeId: string): WindowId | null {
    const key = keyOf(projectId, nodeId)
    const owners = ownersAmong(this.owners.get(key) ?? NO_OWNER, this.showing(projectId))
    this.owners.set(key, owners)
    return owners.owner
  }

  /** Some window of this Machine shows the Canvas of Project `projectId`, so a page of its Browsers can be drawn. */
  shownHere(projectId: string): boolean {
    return this.shown(projectId)
  }

  /**
   * The user's input in the frames of Browser `nodeId` on another screen: window `from` of this
   * Machine, or a Linked machine (a string). It goes to the page as the user's, takes the Browser over
   * from a Session at a press, and uses it; from a window here, the page moves there once it rests.
   */
  async input(projectId: string, nodeId: string, input: BrowserInput, from?: ClientId): Promise<void> {
    const press = (input.kind === 'mouse' && input.type === 'mousePressed') || (input.kind === 'key' && input.type === 'keyDown')
    const page = this.userPage(projectId, nodeId, press)
    await page.userInput(input)
    this.workedIn(projectId, nodeId, from)
  }

  /** The address bar of another screen sends the page of Browser `nodeId` to `url`: the user's own navigation. */
  async navigate(projectId: string, nodeId: string, url: string, from?: ClientId): Promise<void> {
    const page = this.userPage(projectId, nodeId, true)
    await page.userNavigate(url)
    this.workedIn(projectId, nodeId, from)
  }

  /** The page of Browser `nodeId` for the user's own input: used now, and taken over from a Session at a press. */
  private userPage(projectId: string, nodeId: string, press: boolean): CdpPage {
    const page = this.page(projectId, nodeId)
    if (page === undefined) throw new ControlError(NO_LIVE_PAGE)
    const key = keyOf(projectId, nodeId)
    const life = this.lifes.get(key)
    if (life !== undefined) life.usedAt = this.now()
    if (press) {
      // As onUserInput of the page: the user's own browsing is not held to the origins of a call that
      // is ending; that call still answers that its Session left.
      const mark = this.leftMidCall.get(key)
      if (mark !== undefined) mark.walled = false
      this.takeOver(projectId, nodeId)
    }
    return page
  }

  /** The user worked with Browser `nodeId` in window `from`: once that rests, the page moves there. */
  private workedIn(projectId: string, nodeId: string, from: ClientId | undefined): void {
    if (from === undefined || !isWindowId(from)) return
    const key = keyOf(projectId, nodeId)
    const before = this.moving.get(key)
    if (before !== undefined) clearTimeout(before.timer)
    if (this.ownerOf(projectId, nodeId) === from) {
      this.moving.delete(key)
      this.owners.set(key, nextOwners(this.owners.get(key) ?? NO_OWNER, { kind: 'work', window: from }))
      return
    }
    const timer = setTimeout(() => {
      if (this.moving.get(key)?.timer !== timer) return
      this.moving.delete(key)
      this.serial(() => this.moveTo(projectId, nodeId, from)).catch((error: unknown) => console.warn(`Browser ${nodeId}: its page could not move to another window`, error))
    }, MOVE_REST_MS)
    timer.unref?.()
    this.moving.set(key, { window: from, timer })
  }

  /**
   * The page of Browser `nodeId` moves to window `window`, unless its page has a beforeunload handler,
   * or a Session drives it or has a call running on it: the move reloads the page, so the call would
   * fail on a closed page and the Session would go on with a page that lost what it typed. Then the
   * window keeps the frames; its next input after that tries again.
   */
  private async moveTo(projectId: string, nodeId: string, window: WindowId): Promise<void> {
    const key = keyOf(projectId, nodeId)
    const life = this.lifes.get(key)
    if (life === undefined) return
    const stays = () => !life.live || this.sessionOn(key) || !this.showing(projectId).includes(window) || this.ownerOf(projectId, nodeId) === window
    if (stays()) return
    await this.ask(life)
    // Asked again after the question: a call may have begun while the page answered.
    if (life.unsaved || life.unasked || stays()) return
    const page = this.page(projectId, nodeId)
    if (page !== undefined) {
      life.restore = await soon(page.scroll(), ASK_MS).catch((error: unknown) => {
        console.warn(`Browser ${nodeId}: where its page is scrolled could not be read before it moved`, error)
        return null
      })
      // Asked again after the scroll, which may take ASK_MS: a call may have begun meanwhile.
      if (stays()) {
        life.restore = null
        return
      }
    }
    this.owners.set(key, nextOwners(this.owners.get(key) ?? NO_OWNER, { kind: 'work', window }))
    // A Session's next call waits for the page the new window draws, not for the one that closes.
    this.pages.delete(key)
    this.drawn.delete(key)
    this.announce(projectId)
  }

  /** A Session drives Browser `key`, or a call of one runs on it. */
  private sessionOn(key: string): boolean {
    return this.controls.get(key)?.mode === 'claude' || (this.calls.get(key)?.running ?? 0) > 0
  }

  /** Every page of Browser `key` a window draws now. */
  private pagesOf(key: string): CdpPage[] {
    return [...(this.drawn.get(key)?.values() ?? [])].filter((page) => !page.contents.isDestroyed())
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

  /** Throws ControlError, as `drive` would, when Session `sessionId` may not drive Browser Node `nodeId` now; changes nothing. */
  mayDrive(projectId: string, nodeId: string, sessionId: string): void {
    const control = this.controls.get(keyOf(projectId, nodeId))
    if (control?.mode === 'user') throw new ControlError(`${TAKEN_OVER}: the user is using it now. Wait until they press «Return control to Claude» in it, or ask them in the chat.`)
    if (control !== undefined && control.sessionId !== sessionId) throw new ControlError('Another Session drives this Browser now. Open a Browser of your own with browser_open.')
  }

  /**
   * Session `sessionId` drives Browser Node `nodeId` from now on. Throws ControlError when the user
   * took it over and has not given it back, or when another Session drives it.
   */
  drive(projectId: string, nodeId: string, sessionId: string): void {
    this.mayDrive(projectId, nodeId, sessionId)
    const key = keyOf(projectId, nodeId)
    if (this.controls.has(key)) return
    // Back on the Canvas and driving again, the Session's own calls go on; another Session's mark stays.
    this.leftMidCall.get(key)?.sessions.delete(sessionId)
    this.controls.set(key, { mode: 'claude', sessionId })
    this.deps.changed(projectId, nodeId, 'claude')
  }

  /** Nobody drives Browser Node `nodeId` any more: the call that took it could not go on. */
  release(projectId: string, nodeId: string): void {
    if (this.controls.delete(keyOf(projectId, nodeId))) this.deps.changed(projectId, nodeId, null)
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

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private settings(): SleepSettings {
    return this.deps.sleepSettings?.() ?? sleepSettingsOf(BROWSER_SLEEP_DEFAULTS)
  }

  private born(projectId: string, nodeId: string, live: boolean): Life {
    const now = this.now()
    return { projectId, nodeId, live, usedAt: now, seenAt: now, unsaved: false, unasked: false, askedAt: 0, overLimit: false, picture: null, restore: null }
  }

  /** Runs `act` after every change of lives queued before it. */
  private serial<T>(act: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(act, act)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** The Browsers of Project `projectId` now; a list that cannot be read is told to the log once. */
  private browsersNow(projectId: string): BrowsersNow {
    if (this.deps.browsersOf === undefined) return 'any'
    try {
      const ids = this.deps.browsersOf(projectId)
      this.unread.delete(projectId)
      return ids ?? 'gone'
    } catch (error) {
      if (!this.unread.has(projectId)) console.warn(`Browser sleep: the Browsers of Project ${projectId} could not be read`, error)
      this.unread.add(projectId)
      return 'unknown'
    }
  }

  /** The life of a Browser as the rules of sleep.ts read it. */
  private asRule(key: string, life: Life): BrowserNow {
    const control = this.controls.get(key)
    const calls = this.calls.get(key)
    const running = calls?.running ?? 0
    // A call that has not taken the Browser yet (browser_open, a wake before drive) drives it too.
    const session = control === undefined && running === 0 ? null : { driving: control === undefined || control.mode === 'claude', calls: running, lastCallAt: calls?.lastCallAt ?? 0 }
    const focused = this.pagesOf(key).some((page) => page.contents.isFocused?.() === true)
    // A page that could not be asked may not lose its page either.
    return { id: key, live: life.live, usedAt: Math.max(life.usedAt, calls?.lastCallAt ?? 0), seenAt: life.seenAt, focused, unsaved: life.unsaved || life.unasked, session }
  }

  /**
   * Every screen whose report counts now: the windows here, and the Linked machines' screens told
   * lately of a Project a window here shows — without such a window no page of it is drawn, so a
   * Linked machine has no frames of it to keep awake.
   */
  private allScreens(): ScreenNow[] {
    return screensNow(
      [...this.screens].filter(([id, each]) => isWindowId(id) || this.shown(each.projectId)).map(([, each]) => each.screen),
      this.now(),
    )
  }

  /** Some window of this Machine shows the Canvas of Project `projectId`. */
  private shown(projectId: string): boolean {
    return [...this.screens].some(([id, each]) => isWindowId(id) && each.projectId === projectId)
  }

  private announce(projectId: string): void {
    this.deps.livesChanged?.(projectId, this.lives(projectId))
  }

  /**
   * Every Browser of Project `projectId` main keeps a life of: Live or Asleep, and its marks, as
   * client `client` reads them: `here` — that window of this Machine draws the page.
   */
  lives(projectId: string, client?: ClientId): BrowserLife[] {
    return [...this.lifes.values()]
      .filter((life) => life.projectId === projectId)
      .map((life) => ({
        nodeId: life.nodeId,
        live: life.live,
        unsaved: life.live && life.unsaved,
        overLimit: life.live && life.overLimit,
        picture: life.picture?.version ?? null,
        here: life.live && client !== undefined && isWindowId(client) && this.ownerOf(projectId, life.nodeId) === client,
      }))
  }

  /** The picture an Asleep Browser shows, and where its page was scrolled; null while it has none. */
  pictureOf(projectId: string, nodeId: string): PagePicture | null {
    const picture = this.lifes.get(keyOf(projectId, nodeId))?.picture
    return picture === undefined || picture === null ? null : { image: picture.image, scroll: { ...picture.scroll } }
  }

  /**
   * What window `windowId` of this Machine shows now: the Browser frames in it and its zoom. The
   * first screen of a Project wakes its Browsers up to the limit, the shown ones first; a Browser main
   * has not heard of that a screen shows is one the user has just opened, and wakes as by a click; an
   * Asleep one without a picture that it shows readable wakes when a place is free.
   */
  screen(windowId: ScreenKey, report: { projectId: string; visible: readonly string[]; zoom: number }): Promise<void> {
    const { projectId } = report
    const before = this.screens.get(windowId)?.projectId
    const linked = !isWindowId(windowId)
    this.screens.set(windowId, { projectId, screen: { visible: report.visible.map((id) => keyOf(projectId, id)), zoom: report.zoom, ...(linked ? { toldAt: this.now() } : {}) } })
    this.timer ??= setInterval(() => {
      this.check().catch((error: unknown) => console.warn('Browser sleep: a check of the rules failed', error))
    }, CHECK_MS)
    this.timer.unref?.()
    // A Linked machine's screen only counts for the rules: no window of it draws a page here.
    if (linked) return Promise.resolve()
    return this.serial(async () => {
      const all = this.browsersNow(projectId)
      // The window left another Project: that Project's Browsers may have another owner now. Told
      // before the return below, which a window that moved to a Linked machine's Project takes.
      const left = before !== undefined && before !== projectId ? before : undefined
      // A Project this Machine does not have (a Linked machine's) has no Browsers of its own here.
      if (all === 'gone' || all === 'unknown') {
        if (left !== undefined) this.announce(left)
        return
      }
      const changed = new Set<string>([projectId])
      if (!this.seen.has(projectId)) {
        this.seen.add(projectId)
        const ids = all === 'any' ? report.visible : all
        const first = [...report.visible.filter((id) => ids.includes(id)), ...ids.filter((id) => !report.visible.includes(id))]
        for (const nodeId of first) {
          const key = keyOf(projectId, nodeId)
          if (this.lifes.has(key)) continue
          this.lifes.set(key, this.born(projectId, nodeId, await this.freePlace(key, changed)))
        }
      } else {
        await this.openShown(projectId, report.visible, all)
        if (report.zoom >= this.settings().minZoom) {
          for (const nodeId of report.visible) {
            const key = keyOf(projectId, nodeId)
            const life = this.lifes.get(key)
            if (life === undefined || life.live || life.picture !== null || !(await this.freePlace(key, changed))) continue
            Object.assign(life, { live: true, usedAt: this.now(), seenAt: this.now(), unsaved: false, unasked: false, askedAt: 0, overLimit: false, restore: null })
          }
        }
      }
      if (left !== undefined) changed.add(left)
      for (const each of changed) this.announce(each)
    })
  }

  /**
   * Whether Browser `key` can be Live without closing a page: a place under the limit is free, or one
   * is held by a Live Browser that has no page and that no screen shows — that one goes to sleep.
   */
  private async freePlace(key: string, changed: Set<string>): Promise<boolean> {
    const settings = this.settings()
    if ([...this.lifes].filter(([other, life]) => other !== key && life.live).length < settings.maxLive) return true
    const onScreen = new Set(this.allScreens().flatMap((screen) => screen.visible))
    // admit evicts only Browsers that may sleep: one with a page or on a screen is counted as one that may not.
    const rules = [...this.lifes].map(([each, life]) => {
      const rule = this.asRule(each, life)
      return this.pagesOf(each).length > 0 || onScreen.has(each) ? { ...rule, unsaved: true } : rule
    })
    const admission = admit(rules, key, 'session', this.now(), settings)
    if (admission.kind === 'busy') return false
    for (const evicted of admission.evict) {
      const life = this.lifes.get(evicted)
      if (life === undefined) continue
      await this.sleep(evicted, life)
      changed.add(life.projectId)
    }
    return true
  }

  /**
   * Opens, as the user's, each Browser of `visible` that main has no life for and that has a page
   * (`all`): a Browser just made, or one whose profile was just chosen.
   */
  private async openShown(projectId: string, visible: readonly string[], all: BrowsersNow): Promise<void> {
    if (all === 'gone' || all === 'unknown') return
    for (const nodeId of visible) {
      if (!this.lifes.has(keyOf(projectId, nodeId)) && (all === 'any' || all.includes(nodeId))) await this.admitNow(projectId, nodeId, 'user')
    }
  }

  /**
   * Window `windowId` closed, or shows no Canvas: it shows no Browser any more, and the pages it drew
   * go to another window of their Project (owner.ts). A string — the screen of a Linked machine.
   */
  dropScreen(windowId: ScreenKey): void {
    const projectId = this.screens.get(windowId)?.projectId
    this.screens.delete(windowId)
    if (projectId !== undefined && isWindowId(windowId)) this.announce(projectId)
  }

  /** The connection of Linked machine client `client` closed: none of its screens counts any more. */
  dropScreensOf(client: string): void {
    for (const id of [...this.screens.keys()]) if (screenOfClient(id, client)) this.screens.delete(id)
  }

  /** A call of a Session on Browser `nodeId` begins: while it runs, and for the idle threshold after it, the Browser does not sleep. */
  sessionDrives(projectId: string, nodeId: string): void {
    const key = keyOf(projectId, nodeId)
    this.calls.set(key, { running: (this.calls.get(key)?.running ?? 0) + 1, lastCallAt: this.now() })
  }

  /** The call of a Session on Browser `nodeId` ended. A refused call leaves nothing of it: a Browser it never woke has no life. */
  sessionReleases(projectId: string, nodeId: string): void {
    const key = keyOf(projectId, nodeId)
    const running = Math.max(0, (this.calls.get(key)?.running ?? 0) - 1)
    if (running === 0) this.leftMidCall.delete(key)
    if (running === 0 && !this.lifes.has(key)) this.calls.delete(key)
    else this.calls.set(key, { running, lastCallAt: this.now() })
  }

  /**
   * Browser `nodeId` is Live from now on, woken or opened by `by`: a click of the user on its frame, a
   * Session's call or its browser_open. Answers whether it is Live over the limit. A Session's call
   * throws ControlError and changes nothing while every Live Browser is busy (ALL_LIVE_BUSY), or while
   * no window shows the Project to draw the page (NOT_SHOWN).
   */
  wake(projectId: string, nodeId: string, by: Waker): Promise<{ overLimit: boolean }> {
    return this.serial(() => this.admitNow(projectId, nodeId, by))
  }

  private async admitNow(projectId: string, nodeId: string, by: Waker): Promise<{ overLimit: boolean }> {
    const key = keyOf(projectId, nodeId)
    if (by === 'session' && this.page(projectId, nodeId) === undefined && !this.shown(projectId)) throw new ControlError(NOT_SHOWN)
    const life = this.lifes.get(key)
    if (life?.live === true) {
      life.usedAt = this.now()
      return { overLimit: life.overLimit }
    }
    const settings = this.settings()
    const others = [...this.lifes].filter(([other, each]) => other !== key && each.live)
    // A Live Browser leaves its place only after its page was asked afresh for a beforeunload handler.
    if (others.length + 1 > settings.maxLive) for (const [, each] of others) await this.ask(each)
    const now = this.now()
    const rules = [...this.lifes].map(([each, state]) => this.asRule(each, state))
    const admission = admit(rules, key, by, now, settings)
    if (admission.kind === 'busy') {
      throw new ControlError(`${ALL_LIVE_BUSY}: each of the ${settings.maxLive} Live Browsers is driven by a Session, has unsaved changes, or has a page that could not be asked (its DevTools may be open). Call again in a minute, or ask the user to close one.`)
    }
    for (const evicted of admission.evict) {
      const each = this.lifes.get(evicted)
      if (each !== undefined) await this.sleep(evicted, each)
    }
    const woken = life ?? this.born(projectId, nodeId, true)
    woken.restore = woken.picture?.scroll ?? null
    Object.assign(woken, { live: true, usedAt: now, seenAt: now, unsaved: false, unasked: false, askedAt: 0, overLimit: admission.overLimit })
    this.lifes.set(key, woken)
    this.announce(projectId)
    for (const projectOf of new Set(admission.evict.map((each) => this.lifes.get(each)?.projectId))) if (projectOf !== undefined && projectOf !== projectId) this.announce(projectOf)
    return { overLimit: admission.overLimit }
  }

  /**
   * Asks every page of Live Browser `life` whether it has a beforeunload handler. A handler in any of
   * them marks it unsaved; a page that cannot answer keeps it Live without that mark (`unasked`).
   */
  private async ask(life: Life): Promise<void> {
    const pages = this.pagesOf(keyOf(life.projectId, life.nodeId))
    const before = life.unsaved
    const answers = await Promise.all(pages.map((page) => soon(page.hasBeforeUnload(), ASK_MS).catch(() => null)))
    life.unsaved = answers.includes(true)
    life.unasked = !life.unsaved && answers.includes(null)
    life.askedAt = this.now()
    if (life.unsaved !== before) this.announce(life.projectId)
  }

  /** Puts Live Browser `key` to sleep: keeps a picture of its page, then the window closes the page. */
  private async sleep(key: string, life: Life): Promise<void> {
    const page = this.page(life.projectId, life.nodeId)
    // Without a page now, or without a picture of it, an older picture would show the wrong place.
    const picture =
      page === undefined
        ? null
        : await soon(page.picture(), ASK_MS).catch((error: unknown) => {
            console.warn(`Browser ${life.nodeId}: no picture of its page before sleep`, error)
            return null
          })
    if (picture === null) life.picture = null
    else {
      this.pictures += 1
      life.picture = { ...picture, version: this.pictures }
    }
    Object.assign(life, { live: false, unsaved: false, unasked: false, overLimit: false, restore: null })
    // A Session's next call waits for the page the window draws when it wakes, not for this one.
    this.pages.delete(key)
    this.drawn.delete(key)
  }

  /**
   * One check of the rules: Browsers gone from the Canvas are forgotten, the shown and focused ones
   * are marked seen and used, a page with a beforeunload handler is asked again, and the Browsers the
   * rules name go to sleep — each after its page was asked for a handler once more.
   */
  check(): Promise<void> {
    if (this.checking) return Promise.resolve()
    this.checking = true
    return this.serial(async () => {
      try {
        await this.checkNow()
      } finally {
        this.checking = false
      }
    })
  }

  private async checkNow(): Promise<void> {
    const settings = this.settings()
    const screens = this.allScreens()
    const changed = new Set<string>()
    // The Projects a window of this Machine shows: a Linked machine's screen draws no page here.
    const onScreen = new Set([...this.screens].filter(([id]) => isWindowId(id)).map(([, each]) => each.projectId))
    const browsers = new Map<string, BrowsersNow>()
    const browsersOf = (projectId: string): BrowsersNow => {
      if (!browsers.has(projectId)) browsers.set(projectId, this.browsersNow(projectId))
      return browsers.get(projectId)!
    }
    // Only the Projects a window shows are read: the Browsers of the others sleep off screen and are
    // dropped below, with no read of their files every second.
    for (const [key, life] of [...this.lifes]) {
      if (!onScreen.has(life.projectId) || !this.seen.has(life.projectId)) continue
      const shown = browsersOf(life.projectId)
      // A list that cannot be read keeps every record until it can: a Browser it would drop may still
      // be on the Canvas, and an Asleep one would lose the picture it shows.
      if (shown === 'any' || shown === 'unknown') continue
      // Not one a running call works on: browser_open wakes its Browser before it puts the Node on the Canvas.
      if ((shown === 'gone' || !shown.includes(life.nodeId)) && (this.calls.get(key)?.running ?? 0) === 0) {
        this.lifes.delete(key)
        this.calls.delete(key)
        changed.add(life.projectId)
      }
    }
    for (const [projectId, shown] of browsers) if (shown === 'gone') this.seen.delete(projectId)
    // A shown Browser that has just got a page — its profile chosen in its frame — opens as by a click.
    for (const [id, { projectId, screen }] of [...this.screens]) {
      if (!isWindowId(id) || !this.seen.has(projectId)) continue
      const prefix = keyOf(projectId, '')
      const visible = screen.visible.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
      if (visible.some((nodeId) => !this.lifes.has(keyOf(projectId, nodeId)))) await this.openShown(projectId, visible, browsersOf(projectId))
    }
    const now = this.now()
    for (const [key, life] of this.lifes) {
      if (!life.live) continue
      if (readableNow(key, screens, settings)) life.seenAt = now
      if (this.asRule(key, life).focused) life.usedAt = now
      if ((life.unsaved || life.unasked) && now - life.askedAt >= ASK_AGAIN_MS) await this.ask(life)
    }
    const rules = [...this.lifes].map(([key, life]) => this.asRule(key, life))
    for (const { id } of browsersToSleep(rules, screens, this.now(), settings)) {
      const life = this.lifes.get(id)
      if (life === undefined || !life.live || drivenNow(this.asRule(id, life), this.now(), settings)) continue
      await this.ask(life)
      if (life.unsaved || life.unasked) continue
      await this.sleep(id, life)
      changed.add(life.projectId)
    }
    // A limit lowered in Settings → Browser holds at once: the Browsers beyond it that may sleep do,
    // the rest are marked over it.
    if (this.lastMaxLive !== undefined && settings.maxLive < this.lastMaxLive) await this.fitLowerLimit(settings, changed)
    this.lastMaxLive = settings.maxLive
    // The Browsers over the limit are within it again once enough of the others sleep.
    const live = [...this.lifes.values()].filter((life) => life.live)
    if (live.length <= settings.maxLive) {
      for (const life of live) {
        if (!life.overLimit) continue
        life.overLimit = false
        changed.add(life.projectId)
      }
    }
    // A Project no window shows, all of whose Browsers sleep, is forgotten: its next screen is a first one.
    for (const projectId of new Set([...this.lifes.values()].map((life) => life.projectId))) {
      if (onScreen.has(projectId)) continue
      const its = [...this.lifes].filter(([, life]) => life.projectId === projectId)
      if (its.some(([key, life]) => life.live || (this.calls.get(key)?.running ?? 0) > 0)) continue
      for (const [key] of its) {
        this.lifes.delete(key)
        this.calls.delete(key)
      }
      this.seen.delete(projectId)
      changed.add(projectId)
    }
    for (const projectId of changed) this.announce(projectId)
  }

  private async fitLowerLimit(settings: SleepSettings, changed: Set<string>): Promise<void> {
    const live = [...this.lifes.values()].filter((life) => life.live)
    if (live.length <= settings.maxLive) return
    for (const life of live) await this.ask(life)
    const fit = fitLimit([...this.lifes].map(([key, life]) => this.asRule(key, life)), this.now(), settings)
    for (const id of fit.evict) {
      const life = this.lifes.get(id)
      if (life === undefined) continue
      await this.sleep(id, life)
      changed.add(life.projectId)
    }
    for (const id of fit.over) {
      const life = this.lifes.get(id)
      if (life === undefined || life.overLimit) continue
      life.overLimit = true
      changed.add(life.projectId)
    }
  }

  /** Runs the tool call `act` of Session `sessionId`: the commands it sends to pages know whose they are. */
  asSession<T>(sessionId: string | null, act: () => Promise<T>): Promise<T> {
    return sessionId === null ? act() : callingSession.run(sessionId, act)
  }

  /** Stops the checks of the rules: the app quits. */
  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
    for (const { timer } of this.moving.values()) clearTimeout(timer)
    this.moving.clear()
    this.unsubscribe?.()
    this.unkeep?.()
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
    pressing: (projectId, nodeId, phase) => toEveryWindow((client) => emit(client, browserPressing, { projectId, nodeId, phase })),
    sleepSettings: () => sleepSettingsOf(browserSleepOf(appSettingsStore().get())),
    browsersOf: (projectId) => {
      // A Project deleted since, or a Linked machine's shown in a window here: none of its Browsers is this Machine's.
      if (projectStore().find(projectId) === undefined) return null
      const profiles = new Set(browserProfileStore().list(projectId).map((profile) => profile.id))
      // A page is drawn for a Browser whose profile the Project has, or for one saved before profiles
      // existed (no `profile` key; browserProfileChoice keeps it on Default); not while its frame asks
      // for a profile.
      const hasPage = (profile: unknown): boolean => (typeof profile === 'string' ? profiles.has(profile) : profile === undefined)
      return layoutStore()
        .get(projectId)
        .layout.nodes.filter((node) => node.kind === BROWSER_KIND && shownOnCanvas(node) && hasPage(node.data.profile))
        .map((node) => node.id)
    },
    // Each client reads whether it draws the page itself (`here`).
    livesChanged: (projectId) => toEveryWindow((client) => emit(client, browserLivesChanged, { projectId, lives: liveBrowsers().lives(projectId, client.id) })),
    layoutChanges: (listener) => layoutStore().onChange(listener),
    browserKeeper: (keeps, ask) => layoutStore().setBrowserKeeper(keeps, ask),
  })
  return shared
}

/** The app quits: the checks of sleep stop. */
export function stopLiveBrowsers(): void {
  shared?.stop()
}
