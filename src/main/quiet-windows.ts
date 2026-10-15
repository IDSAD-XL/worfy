// Quiet windows: a mode for the e2e tests only, turned on by WORFY_QUIET_WINDOWS=1 (playwright.config.ts
// sets it for every e2e run). Each e2e test starts its own worfy, and on macOS window.show() makes the
// app active: its window comes to the front, takes the keyboard, and a Dock icon appears, dozens of
// times per run, while the owner works on the same Mac. In quiet mode the window is shown without
// activating worfy, worfy stays out of the Dock and ⌘Tab, and the window is transparent and lets the
// mouse through. It still is on screen, so tests of its size and place hold, and Playwright, which
// sends input and takes screenshots over CDP, needs neither the focus nor the mouse.
//
// A normal start (`pnpm dev`, the packaged app, the stable copy) does not set the variable, and any
// value other than "1" counts as not set: the window shows itself and takes the focus as before.

/** What src/main/index.ts and src/main/window.ts do about showing worfy's windows. */
export interface QuietWindows {
  /** Whether quiet mode is on. */
  quiet: boolean
  /** How a window shows itself once its page is ready: show() activates the app, showInactive() does not. */
  show: 'show' | 'showInactive'
  /** Whether a second start of worfy brings the open window to the front with focus(). */
  focusOnSecondInstance: boolean
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
}

/** The normal start: what worfy did before quiet mode existed. */
export const NORMAL_WINDOWS: QuietWindows = Object.freeze({
  quiet: false,
  show: 'show',
  focusOnSecondInstance: true,
  activationPolicy: null,
  chromiumSwitches: Object.freeze([]),
  backgroundThrottling: undefined,
  opacity: undefined,
  ignoreMouseEvents: false,
})

/** Reads WORFY_QUIET_WINDOWS and answers how worfy shows its windows. */
export function quietWindows(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): QuietWindows {
  if (env.WORFY_QUIET_WINDOWS !== '1') return NORMAL_WINDOWS
  return {
    quiet: true,
    show: 'showInactive',
    focusOnSecondInstance: false,
    activationPolicy: platform === 'darwin' ? 'accessory' : null,
    chromiumSwitches: ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'],
    backgroundThrottling: false,
    opacity: 0,
    ignoreMouseEvents: true,
  }
}
