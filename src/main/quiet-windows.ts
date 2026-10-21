// Quiet windows: a mode for the e2e tests only, turned on by WORFY_QUIET_WINDOWS=1 (playwright.config.ts
// sets it for every e2e run). Each e2e test starts its own worfy, and on macOS window.show() makes the
// app active: its window comes to the front, takes the keyboard, and a Dock icon appears, dozens of
// times per run, while the owner works on the same Mac. In quiet mode the window is shown without
// activating worfy, worfy stays out of the Dock and ⌘Tab, the window is transparent and lets the
// mouse through, and notes are not shown as system notifications. The window still is on screen, so
// tests of its size and place hold, and Playwright, which sends input and takes screenshots over
// CDP, needs neither the focus nor the mouse.
//
// A normal start (`pnpm dev`, the packaged app, the stable copy) does not set the variable, and any
// value other than "1" counts as not set: the window shows itself and takes the focus as before.
//
// Kept painting: WORFY_KEEP_PAINTING=1, also set by playwright.config.ts for every e2e run, turns on
// only the Chromium switches and backgroundThrottling: false that quiet mode has, so a window that
// macOS counts as covered or in the background is still painted and gets its 'ready-to-show'. It
// also covers the specs that turn quiet mode off for the real focus (test/e2e/linked-notify.spec.ts):
// focus and system notifications stay as in a normal start. The same rule: only "1" turns it on.

/** What src/main/index.ts, src/main/window.ts and src/main/notify.ts do about showing worfy's windows and notes. */
export interface QuietWindows {
  /** Whether quiet mode is on. */
  quiet: boolean
  /** How a window shows itself once its page is ready: show() activates the app, showInactive() does not. */
  show: 'show' | 'showInactive'
  /**
   * Whether worfy brings its window to the front and takes the keyboard: focus() on a second start,
   * focus() and app.focus() on a click on a notification (notify.ts, openNote).
   */
  takesFocus: boolean
  /**
   * Whether a note is shown as a system notification (notify.ts). A quiet window never has the
   * focus, so every finished turn would otherwise put a banner on the screen of whoever uses the
   * Mac; the note is still decided on and still goes to the Linked machines.
   */
  systemNotifications: boolean
  /**
   * The activation policy set before the first window (macOS only): 'accessory' has no Dock icon,
   * no place in ⌘Tab and does not take over the menu bar. null leaves the app's own ('regular').
   */
  activationPolicy: 'accessory' | null
  /**
   * Chromium switches appended before the app is ready: a transparent or covered window is
   * otherwise counted as hidden and not painted, and the tests would wait for the first window
   * until their timeout.
   */
  chromiumSwitches: readonly string[]
  /** webPreferences.backgroundThrottling of a window; undefined keeps Electron's default. */
  backgroundThrottling: false | undefined
  /** The window's opacity (macOS and Windows; Linux has none); undefined keeps Electron's default. */
  opacity: 0 | undefined
  /** Whether the window lets every mouse event through to whatever is under it. */
  ignoreMouseEvents: boolean
  /**
   * Whether the window keeps out from under the real mouse pointer (macOS only; window.ts,
   * keepOffPointer). setIgnoreMouseEvents does not cover the tracking area of Chromium's web view
   * (ui/base/cocoa/base_view.mm, NSTrackingActiveAlways): when a window appears or goes away under
   * a still pointer, AppKit still sends the view mouse entered and exited, and the page gets a
   * mouseleave or a mousemove at the pointer in the middle of a test that hovers over CDP. A window
   * that does not contain the pointer gets none of them.
   */
  avoidPointer: boolean
}

/** The normal start: what worfy did before quiet mode existed. */
export const NORMAL_WINDOWS: QuietWindows = Object.freeze({
  quiet: false,
  show: 'show',
  takesFocus: true,
  systemNotifications: true,
  activationPolicy: null,
  chromiumSwitches: Object.freeze([]),
  backgroundThrottling: undefined,
  opacity: undefined,
  ignoreMouseEvents: false,
  avoidPointer: false,
})

/** The switches that keep a covered or background window painted (quiet mode and WORFY_KEEP_PAINTING=1). */
export const KEEP_PAINTING_SWITCHES: readonly string[] = Object.freeze(['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'])

/** A normal start that is still painted when covered: what WORFY_KEEP_PAINTING=1 alone gives. */
export const KEEP_PAINTING_WINDOWS: QuietWindows = Object.freeze({
  ...NORMAL_WINDOWS,
  chromiumSwitches: KEEP_PAINTING_SWITCHES,
  backgroundThrottling: false,
})

/** Reads WORFY_QUIET_WINDOWS and WORFY_KEEP_PAINTING and answers how worfy shows its windows. */
export function quietWindows(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): QuietWindows {
  if (env.WORFY_QUIET_WINDOWS !== '1') return env.WORFY_KEEP_PAINTING === '1' ? KEEP_PAINTING_WINDOWS : NORMAL_WINDOWS
  return {
    quiet: true,
    show: 'showInactive',
    takesFocus: false,
    systemNotifications: false,
    activationPolicy: platform === 'darwin' ? 'accessory' : null,
    chromiumSwitches: [...KEEP_PAINTING_SWITCHES],
    backgroundThrottling: false,
    opacity: 0,
    ignoreMouseEvents: true,
    avoidPointer: platform === 'darwin',
  }
}
