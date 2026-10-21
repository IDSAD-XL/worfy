// When a window created hidden (show: false) is put on screen. Electron's 'ready-to-show' comes
// once the page has painted, and worfy shows its window on it so the window never appears blank.
// That event can fail to come: in e2e runs with several Electron starts at once the page had
// loaded and still no 'ready-to-show' came within 30 s, and the window stayed hidden for good. So
// a window whose page has finished loading (did-finish-load) is shown after a grace period even
// without 'ready-to-show', and the app's output says which of the two showed it.

/**
 * How long after did-finish-load the window waits for 'ready-to-show' before it is shown anyway.
 * A whole start shows its window in about 0.6 s, six starts at once included, and the first paint
 * follows the load within a frame or two; 3 s is five times the whole start, so a slow but healthy
 * paint is not overtaken (overtaking it costs only a blank frame), and it still leaves an e2e start
 * 27 s of its 30 s budget for the first window.
 */
export const READY_TO_SHOW_FALLBACK_MS = 3_000

/** Which event showed the window. */
export type ShowPath = 'ready-to-show' | 'fallback'

export interface WindowShowDeps {
  /** Puts the window on screen: show() or showInactive(), as the window's mode says. */
  show: () => void
  /** Whether the window is gone; a closed window is never shown. */
  isDestroyed: () => boolean
  /** Where the line naming the path goes (the app's output by default). */
  log: (line: string) => void
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (timer: unknown) => void
  fallbackMs?: number
}

export interface WindowShow {
  /** Call on the window's 'ready-to-show'. */
  readyToShow: () => void
  /** Call on its webContents' 'did-finish-load' (main frame): starts the fallback timer once. */
  didFinishLoad: () => void
  /** Call when the window closes: no timer outlives it. */
  dispose: () => void
  /** The path that showed the window, or null while it is hidden. */
  shownBy: () => ShowPath | null
}

/** The window's show decision: shown exactly once, by whichever of the two paths comes first. */
export function windowShow(deps: WindowShowDeps): WindowShow {
  const fallbackMs = deps.fallbackMs ?? READY_TO_SHOW_FALLBACK_MS
  let shown: ShowPath | null = null
  let timer: unknown
  let timerSet = false

  const stopTimer = (): void => {
    if (!timerSet) return
    deps.clearTimer(timer)
    timerSet = false
  }
  const showBy = (path: ShowPath): void => {
    stopTimer()
    if (shown !== null || deps.isDestroyed()) return
    shown = path
    deps.show()
    deps.log(
      path === 'ready-to-show'
        ? '[worfy] the window was shown on ready-to-show'
        : `[worfy] the window was shown by the fallback: no ready-to-show within ${fallbackMs} ms of did-finish-load`,
    )
  }

  return {
    readyToShow: () => showBy('ready-to-show'),
    didFinishLoad: () => {
      // A reload before the window is shown fires did-finish-load again; the first timer stands.
      if (shown !== null || timerSet) return
      timer = deps.setTimer(() => {
        timerSet = false
        showBy('fallback')
      }, fallbackMs)
      timerSet = true
    },
    dispose: stopTimer,
    shownBy: () => shown,
  }
}
