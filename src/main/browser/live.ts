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
// When main first hears of a Project's screen (after a start of worfy) the Browsers it shows, then
// the others, wake by themselves up to the limit; the rest are Asleep without a picture (question
// 3). Pictures are kept in main's memory only, never in the Layout a Linked machine reads (question 2).
// shortcut: a picture does not outlive a restart of worfy (an Asleep Browser shows an empty frame after it), redo if the owner wants the pictures kept in the Project's data folder.
// A Browser whose frame asks for a profile has no page and no life: it is opened once it has one.
import { originRefusal } from './origins'
import { CdpPage, type CdpContents, type PagePicture } from './cdp'
import { browserProfileStore } from './profiles'
import { admit, ALL_LIVE_BUSY, browsersToSleep, drivenNow, readableNow, type BrowserNow, type ScreenNow, type SleepSettings, type Waker } from './sleep'
import { toEveryWindow } from '../broadcast'
import { emit } from '../ipc'
import { layoutStore } from '../layout/store'
import { appSettingsStore } from '../settings/store'
import { TAKEN_OVER, type BrowserControlMode } from '../../shared/browser/tools'
import { browserControlChanged, browserLivesChanged, browserPressing, type BrowserLife } from '../../shared/ipc/browser'
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
  /** The Browser Nodes of the Project shown on its Canvas that have a page (a profile); without it, every Browser main knows of. */
  browsersOf?(projectId: string): readonly string[]
  /** Told after a Browser of the Project woke, went to sleep or changed its marks. */
  livesChanged?(projectId: string, lives: BrowserLife[]): void
}

/** What main keeps of one Browser between its pages (worfy-browser ticket 05). */
interface Life {
  projectId: string
  nodeId: string
  live: boolean
  usedAt: number
  seenAt: number
  /** Its page had a `beforeunload` handler (or could not be asked) the last time main asked. */
  unsaved: boolean
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

/** `promise`, or a rejection after `ms`. */
function soon<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<never>((_resolve, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)))]).finally(() => clearTimeout(timer))
}

/** A call a Session may not make on a Browser now; its message is the tool's answer. */
export class ControlError extends Error {}

const keyOf = (projectId: string, nodeId: string): string => `${projectId}\n${nodeId}`

export class LiveBrowsers {
  private readonly pages = new Map<string, CdpPage>()
  private readonly controls = new Map<string, BrowserControl>()
  private readonly waiting = new Map<string, Set<(page: CdpPage) => void>>()
  private readonly lifes = new Map<string, Life>()
  /** The calls of Sessions running on each Browser, and when the last one began or ended. */
  private readonly calls = new Map<string, { running: number; lastCallAt: number }>()
  /** What each window of this Machine shows, by the id of its web contents. */
  private readonly screens = new Map<number, { projectId: string; screen: ScreenNow }>()
  /** The Projects main has heard a screen of since worfy started. */
  private readonly seen = new Set<string>()
  /** Every change of lives, one after another: a sleep, a wake, a check. */
  private queue: Promise<unknown> = Promise.resolve()
  private checking = false
  private timer: ReturnType<typeof setInterval> | undefined
  private pictures = 0

  constructor(private readonly deps: LiveBrowsersDeps) {}

  /**
   * The page of Browser Node `nodeId` is `contents` from now on, until it is closed. Null — refused —
   * while the Browser is Asleep: the window that drew it closes it on the next `browser.lives.changed`.
   */
  register(projectId: string, nodeId: string, contents: CdpContents): CdpPage | null {
    const key = keyOf(projectId, nodeId)
    const life = this.lifes.get(key)
    if (life !== undefined && !life.live) return null
    if (life === undefined) this.lifes.set(key, this.born(projectId, nodeId, true))
    const current = this.pages.get(key)
    if (current !== undefined && current.contents.id === contents.id && !contents.isDestroyed()) return current
    const page = new CdpPage(contents, {
      driving: () => this.controls.get(key)?.mode === 'claude',
      refusal: (url) => {
        const profile = this.deps.profileOf(projectId, nodeId)
        return profile === null ? 'This Browser has no Browser profile any more, so a Session may open no page in it.' : originRefusal(url, profile.name, profile.origins)
      },
      onUserInput: () => this.takeOver(projectId, nodeId),
      used: () => {
        const life = this.lifes.get(key)
        if (life !== undefined) life.usedAt = this.now()
      },
      pressing: (phase) => this.deps.pressing(projectId, nodeId, phase),
    })
    this.pages.set(key, page)
    contents.once('destroyed', () => {
      if (this.pages.get(key) === page) this.pages.delete(key)
    })
    const waiters = this.waiting.get(key)
    this.waiting.delete(key)
    for (const resolve of waiters ?? []) resolve(page)
    const restore = this.lifes.get(key)?.restore ?? null
    if (restore !== null) {
      this.lifes.get(key)!.restore = null
      page.restoreScroll(restore).catch((error: unknown) => console.warn(`Browser ${nodeId}: could not scroll the woken page back`, error))
    }
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
    return { projectId, nodeId, live, usedAt: now, seenAt: now, unsaved: false, askedAt: 0, overLimit: false, picture: null, restore: null }
  }

  /** Runs `act` after every change of lives queued before it. */
  private serial<T>(act: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(act, act)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** The life of a Browser as the rules of sleep.ts read it. */
  private asRule(key: string, life: Life): BrowserNow {
    const control = this.controls.get(key)
    const calls = this.calls.get(key)
    const running = calls?.running ?? 0
    // A call that has not taken the Browser yet (browser_open, a wake before drive) drives it too.
    const session = control === undefined && running === 0 ? null : { driving: control === undefined || control.mode === 'claude', calls: running, lastCallAt: calls?.lastCallAt ?? 0 }
    const page = this.pages.get(key)
    const focused = page !== undefined && !page.contents.isDestroyed() && page.contents.isFocused?.() === true
    return { id: key, live: life.live, usedAt: Math.max(life.usedAt, calls?.lastCallAt ?? 0), seenAt: life.seenAt, focused, unsaved: life.unsaved, session }
  }

  private allScreens(): ScreenNow[] {
    return [...this.screens.values()].map((each) => each.screen)
  }

  private announce(projectId: string): void {
    this.deps.livesChanged?.(projectId, this.lives(projectId))
  }

  /** Every Browser of Project `projectId` main keeps a life of: Live or Asleep, and its marks. */
  lives(projectId: string): BrowserLife[] {
    return [...this.lifes.values()]
      .filter((life) => life.projectId === projectId)
      .map((life) => ({ nodeId: life.nodeId, live: life.live, unsaved: life.live && life.unsaved, overLimit: life.live && life.overLimit, picture: life.picture?.version ?? null }))
  }

  /** The picture an Asleep Browser shows, and where its page was scrolled; null while it has none. */
  pictureOf(projectId: string, nodeId: string): PagePicture | null {
    const picture = this.lifes.get(keyOf(projectId, nodeId))?.picture
    return picture === undefined || picture === null ? null : { image: picture.image, scroll: { ...picture.scroll } }
  }

  /**
   * What window `windowId` of this Machine shows now: the Browser frames in it and its zoom. The
   * first screen of a Project since worfy started wakes its Browsers up to the limit, the shown ones
   * first; a Browser main has not heard of that a screen shows is one the user has just opened, and
   * wakes as by a click.
   */
  screen(windowId: number, report: { projectId: string; visible: readonly string[]; zoom: number }): Promise<void> {
    const { projectId } = report
    this.screens.set(windowId, { projectId, screen: { visible: report.visible.map((id) => keyOf(projectId, id)), zoom: report.zoom } })
    this.timer ??= setInterval(() => void this.check(), CHECK_MS)
    this.timer.unref?.()
    return this.serial(async () => {
      if (!this.seen.has(projectId)) {
        this.seen.add(projectId)
        const all = this.deps.browsersOf?.(projectId) ?? []
        const first = [...report.visible.filter((id) => all.includes(id)), ...all.filter((id) => !report.visible.includes(id))]
        for (const nodeId of first) {
          const key = keyOf(projectId, nodeId)
          if (this.lifes.has(key)) continue
          const live = [...this.lifes.values()].filter((life) => life.live).length < this.settings().maxLive
          this.lifes.set(key, this.born(projectId, nodeId, live))
        }
        this.announce(projectId)
        return
      }
      await this.openShown(projectId, report.visible, this.deps.browsersOf?.(projectId))
    })
  }

  /**
   * Opens, as the user's, each Browser of `visible` that main has no life for and that has a page
   * (`all`): a Browser just made, or one whose profile was just chosen.
   */
  private async openShown(projectId: string, visible: readonly string[], all: readonly string[] | undefined): Promise<void> {
    for (const nodeId of visible) {
      if (!this.lifes.has(keyOf(projectId, nodeId)) && (all === undefined || all.includes(nodeId))) await this.admitNow(projectId, nodeId, 'user')
    }
  }

  /** Window `windowId` closed, or shows no Canvas: it shows no Browser any more. */
  dropScreen(windowId: number): void {
    this.screens.delete(windowId)
  }

  /** A call of a Session on Browser `nodeId` begins: while it runs, and for the idle threshold after it, the Browser does not sleep. */
  sessionDrives(projectId: string, nodeId: string): void {
    const key = keyOf(projectId, nodeId)
    this.calls.set(key, { running: (this.calls.get(key)?.running ?? 0) + 1, lastCallAt: this.now() })
  }

  /** The call of a Session on Browser `nodeId` ended. */
  sessionReleases(projectId: string, nodeId: string): void {
    const key = keyOf(projectId, nodeId)
    this.calls.set(key, { running: Math.max(0, (this.calls.get(key)?.running ?? 0) - 1), lastCallAt: this.now() })
  }

  /**
   * Browser `nodeId` is Live from now on, woken or opened by `by`: a click of the user on its frame, a
   * Session's call or its browser_open. Answers whether it is Live over the limit. A Session's call
   * while every Live Browser is busy throws ControlError(ALL_LIVE_BUSY) and changes nothing.
   */
  wake(projectId: string, nodeId: string, by: Waker): Promise<{ overLimit: boolean }> {
    return this.serial(() => this.admitNow(projectId, nodeId, by))
  }

  private async admitNow(projectId: string, nodeId: string, by: Waker): Promise<{ overLimit: boolean }> {
    const key = keyOf(projectId, nodeId)
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
      throw new ControlError(`${ALL_LIVE_BUSY}: each of the ${settings.maxLive} Live Browsers is driven by a Session or has unsaved changes. Call again in a minute, or ask the user to close one.`)
    }
    for (const evicted of admission.evict) {
      const each = this.lifes.get(evicted)
      if (each !== undefined) await this.sleep(evicted, each)
    }
    const woken = life ?? this.born(projectId, nodeId, true)
    if (woken.picture !== null) woken.restore = woken.picture.scroll
    Object.assign(woken, { live: true, usedAt: now, seenAt: now, unsaved: false, askedAt: 0, overLimit: admission.overLimit })
    this.lifes.set(key, woken)
    this.announce(projectId)
    for (const projectOf of new Set(admission.evict.map((each) => this.lifes.get(each)?.projectId))) if (projectOf !== undefined && projectOf !== projectId) this.announce(projectOf)
    return { overLimit: admission.overLimit }
  }

  /** Asks the page of Live Browser `life` whether it has a beforeunload handler; one that cannot answer counts as having one. */
  private async ask(life: Life): Promise<void> {
    const page = this.page(life.projectId, life.nodeId)
    const before = life.unsaved
    if (page === undefined) life.unsaved = false
    else life.unsaved = await soon(page.hasBeforeUnload(), ASK_MS).catch(() => true)
    life.askedAt = this.now()
    if (life.unsaved !== before) this.announce(life.projectId)
  }

  /** Puts Live Browser `key` to sleep: keeps a picture of its page, then the window closes the page. */
  private async sleep(key: string, life: Life): Promise<void> {
    const page = this.page(life.projectId, life.nodeId)
    if (page !== undefined) {
      const picture = await soon(page.picture(), ASK_MS).catch((error: unknown) => {
        console.warn(`Browser ${life.nodeId}: no picture of its page before sleep`, error)
        return null
      })
      if (picture !== null) {
        this.pictures += 1
        life.picture = { ...picture, version: this.pictures }
      }
    }
    Object.assign(life, { live: false, unsaved: false, overLimit: false, restore: null })
    // A Session's next call waits for the page the window draws when it wakes, not for this one.
    this.pages.delete(key)
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
    const browsers = new Map<string, readonly string[] | undefined>()
    const browsersOf = (projectId: string): readonly string[] | undefined => {
      if (!browsers.has(projectId)) browsers.set(projectId, this.deps.browsersOf?.(projectId))
      return browsers.get(projectId)
    }
    for (const [key, life] of [...this.lifes]) {
      const shown = browsersOf(life.projectId)
      // Not one a running call works on: browser_open wakes its Browser before it puts the Node on the Canvas.
      if (shown !== undefined && this.seen.has(life.projectId) && !shown.includes(life.nodeId) && (this.calls.get(key)?.running ?? 0) === 0) {
        this.lifes.delete(key)
        this.calls.delete(key)
        changed.add(life.projectId)
      }
    }
    // A shown Browser that has just got a page — its profile chosen in its frame — opens as by a click.
    for (const { projectId, screen } of [...this.screens.values()]) {
      if (!this.seen.has(projectId)) continue
      const prefix = keyOf(projectId, '')
      const visible = screen.visible.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
      if (visible.some((nodeId) => !this.lifes.has(keyOf(projectId, nodeId)))) await this.openShown(projectId, visible, browsersOf(projectId))
    }
    const now = this.now()
    for (const [key, life] of this.lifes) {
      if (!life.live) continue
      if (readableNow(key, screens, settings)) life.seenAt = now
      if (this.asRule(key, life).focused) life.usedAt = now
      if (life.unsaved && now - life.askedAt >= ASK_AGAIN_MS) await this.ask(life)
    }
    const rules = [...this.lifes].map(([key, life]) => this.asRule(key, life))
    for (const { id } of browsersToSleep(rules, screens, this.now(), settings)) {
      const life = this.lifes.get(id)
      if (life === undefined || !life.live || drivenNow(this.asRule(id, life), this.now(), settings)) continue
      await this.ask(life)
      if (life.unsaved) continue
      await this.sleep(id, life)
      changed.add(life.projectId)
    }
    // The Browsers over the limit are within it again once enough of the others sleep.
    const live = [...this.lifes.values()].filter((life) => life.live)
    if (live.length <= settings.maxLive) {
      for (const life of live) {
        if (!life.overLimit) continue
        life.overLimit = false
        changed.add(life.projectId)
      }
    }
    for (const projectId of changed) this.announce(projectId)
  }

  /** Stops the checks of the rules: the app quits. */
  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
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
      const profiles = new Set(browserProfileStore().list(projectId).map((profile) => profile.id))
      // A page is drawn for a Browser whose profile the Project has, or for one saved before profiles
      // existed (no `profile` key; browserProfileChoice keeps it on Default); not while its frame asks
      // for a profile.
      const hasPage = (profile: unknown): boolean => (typeof profile === 'string' ? profiles.has(profile) : profile === undefined)
      return layoutStore()
        .get(projectId)
        .layout.nodes.filter((node) => node.kind === 'browser' && shownOnCanvas(node) && hasPage(node.data.profile))
        .map((node) => node.id)
    },
    livesChanged: (projectId, lives) => toEveryWindow((client) => emit(client, browserLivesChanged, { projectId, lives })),
  })
  return shared
}
