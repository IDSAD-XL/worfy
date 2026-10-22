// The sleep rules of Browsers (ADR-0078 items 6, 7, 15 and 16; worfy-browser ticket 05) as plain
// functions of the Browsers' state, what each screen shows, the time and the settings. main makes
// the one decision for every window from them (src/main/browser/live.ts); each window only tells
// main what it shows (`browser.screen`, src/shared/ipc/browser.ts).
//
// The screens are every screen of the Project (worfy-browser ticket 07): the windows of this
// Machine, and the windows of the Linked machines with full access, which see the Browser's frames.
// A Browser one of them shows at a readable zoom does not sleep for being off screen. A window here
// says when it closes; a Linked machine's screen may vanish with its connection or its window
// without a word, so its report counts for LINKED_SCREEN_MS after it came (screensNow), and the
// screen renews it sooner than that (BROWSER_SCREEN_RENEW_MS, src/shared/ipc/browser.ts).
//
// A Live Browser goes to sleep when
// - no screen shows it at a readable zoom for longer than `offscreenMs`: off every screen, or shown
//   only where the Canvas is zoomed out below `minZoom` (on every screen that shows it; one screen
//   that shows it readable is enough to keep it). Both share the one threshold, so zooming out for a
//   look at the whole Canvas does not reload every page;
// - nothing used it — no focus, no click on its frame, no call of a Session — for longer than
//   `idleMs`.
// It never sleeps while a Session drives it now (`drivenNow`) or while its page has a
// `beforeunload` handler (`unsaved`, which main asks the page over CDP before each sleep).
//
// At most `maxLive` Browsers of the Machine are Live (admit): the one opened or woken beyond that
// puts to sleep the Live Browser used longest ago that may sleep. When none may — each is driven by
// a Session or has unsaved changes — the user's Browser opens over the limit, flagged so, and a
// Session's call is refused with ALL_LIVE_BUSY.

/** The answer a Session's call gets while every Live Browser is busy (ADR-0078 item 15). */
export const ALL_LIVE_BUSY = 'All Live Browsers are busy'

export interface SleepSettings {
  /** How many Browsers may be Live at once. */
  maxLive: number
  /** How long a Browser no screen shows at a readable zoom stays Live. */
  offscreenMs: number
  /** How long a Browser nothing used stays Live. */
  idleMs: number
  /** The zoom of the Canvas from which a page counts as readable. */
  minZoom: number
}

/** A Session's hold on a Browser, as main knows it. */
export interface SessionUse {
  /** The Session drives the Browser (it was not taken over by the user). */
  driving: boolean
  /** How many of its calls on the Browser are running now. */
  calls: number
  /** When its last call on the Browser ended (or began, while one runs). */
  lastCallAt: number
}

export interface BrowserNow {
  /** One key per Browser of the Machine: `<Project id>\n<Node id>` (src/main/browser/live.ts). */
  id: string
  live: boolean
  /** The last time anything used it: the focus, a click on its frame, a Session's call, its wake. */
  usedAt: number
  /** The last time a screen showed it at a readable zoom; its wake counts as seen. */
  seenAt: number
  /** Its page has the keyboard focus now. */
  focused: boolean
  /** Its page had a `beforeunload` handler the last time main asked. */
  unsaved: boolean
  session: SessionUse | null
}

/** What one screen — a window of this Machine or of a Linked machine — shows now. */
export interface ScreenNow {
  /** The keys of the Browsers whose frame is in the window. */
  visible: readonly string[]
  /** The zoom of its Canvas. */
  zoom: number
  /** When a Linked machine's screen told it; absent for a window of this Machine, which counts until it closes. */
  toldAt?: number
}

/** How long the report of a Linked machine's screen counts. */
export const LINKED_SCREEN_MS = 60_000

/** The screens whose reports count at `now`: every window here, and each Linked machine's screen told within LINKED_SCREEN_MS. */
export function screensNow(screens: readonly ScreenNow[], now: number): ScreenNow[] {
  return screens.filter((screen) => screen.toldAt === undefined || now - screen.toldAt <= LINKED_SCREEN_MS)
}

export type SleepReason = 'offscreen' | 'far' | 'idle'

/** A Session drives the Browser now: a call runs, or its last call ended less than `idleMs` ago. */
export function drivenNow(browser: Pick<BrowserNow, 'session'>, now: number, settings: Pick<SleepSettings, 'idleMs'>): boolean {
  const { session } = browser
  return session !== null && session.driving && (session.calls > 0 || now - session.lastCallAt < settings.idleMs)
}

/** Whether some screen shows Browser `id` at a readable zoom now. */
export function readableNow(id: string, screens: readonly ScreenNow[], settings: Pick<SleepSettings, 'minZoom'>): boolean {
  return screens.some((screen) => screen.visible.includes(id) && screen.zoom >= settings.minZoom)
}

/** Why Live Browser `browser` should sleep now, or null when it should stay Live. */
export function sleepReason(browser: BrowserNow, screens: readonly ScreenNow[], now: number, settings: SleepSettings): SleepReason | null {
  if (!browser.live || browser.unsaved || drivenNow(browser, now, settings)) return null
  const { focused } = browser
  if (!readableNow(browser.id, screens, settings) && !focused && now - browser.seenAt > settings.offscreenMs) {
    return screens.some((screen) => screen.visible.includes(browser.id)) ? 'far' : 'offscreen'
  }
  if (!focused && now - browser.usedAt > settings.idleMs) return 'idle'
  return null
}

/** The Live Browsers that should sleep now, each with its reason. */
export function browsersToSleep(browsers: readonly BrowserNow[], screens: readonly ScreenNow[], now: number, settings: SleepSettings): { id: string; reason: SleepReason }[] {
  return browsers.flatMap((browser) => {
    const reason = sleepReason(browser, screens, now, settings)
    return reason === null ? [] : [{ id: browser.id, reason }]
  })
}

/** Who opens or wakes a Browser. */
export type Waker = 'user' | 'session'

export type Admission =
  /** Live now; `evict` go to sleep first; `overLimit` — Live beyond `maxLive`, since none of the others may sleep. */
  | { kind: 'live'; evict: string[]; overLimit: boolean }
  /** A Session's call, while every Live Browser is busy: nothing changes. */
  | { kind: 'busy' }

/** Used longest ago first; a tie by key, so the choice does not depend on the order of the list. */
const longestUnused = (a: BrowserNow, b: BrowserNow): number => a.usedAt - b.usedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * What opening or waking Browser `id` does under the limit of Live Browsers (ADR-0078 items 7 and
 * 15): the Live Browsers used longest ago that may sleep make room for it.
 */
export function admit(browsers: readonly BrowserNow[], id: string, by: Waker, now: number, settings: SleepSettings): Admission {
  const others = browsers.filter((browser) => browser.live && browser.id !== id)
  const need = others.length + 1 - settings.maxLive
  if (need <= 0) return { kind: 'live', evict: [], overLimit: false }
  const free = others.filter((browser) => !browser.unsaved && !drivenNow(browser, now, settings)).sort(longestUnused)
  if (free.length >= need) return { kind: 'live', evict: free.slice(0, need).map((browser) => browser.id), overLimit: false }
  if (by === 'session') return { kind: 'busy' }
  return { kind: 'live', evict: free.map((browser) => browser.id), overLimit: true }
}

/**
 * The limit was lowered (Settings → Browser): which Live Browsers go to sleep now, longest unused
 * first among those that may, and which stay Live over the limit because no other one may sleep —
 * the ones used last.
 */
export function fitLimit(browsers: readonly BrowserNow[], now: number, settings: SleepSettings): { evict: string[]; over: string[] } {
  const live = browsers.filter((browser) => browser.live)
  const need = live.length - settings.maxLive
  if (need <= 0) return { evict: [], over: [] }
  const evict = live
    .filter((browser) => !browser.unsaved && !drivenNow(browser, now, settings))
    .sort(longestUnused)
    .slice(0, need)
    .map((browser) => browser.id)
  const left = live.filter((browser) => !evict.includes(browser.id)).sort(longestUnused)
  return { evict, over: left.slice(left.length - (need - evict.length)).map((browser) => browser.id) }
}
