// The wait for the app's first window to be on screen (launchApp in helpers.ts). It runs inside the
// app's main process, so test/unit/first-window-shown.test.ts checks it with fake windows and fake
// timers instead of a real app.
//
// Why it polls: on macOS Electron emits a window's 'show' only from the occlusion-change
// notification of its NSWindow delegate, not from show() or showInactive(), and isVisible() reads
// the occlusion state too. When that notification does not come, no 'show' event comes, while
// isVisible() turns true later. A wait for 'show' alone then hung for its whole 30 s with a window
// on screen (gate full on main 9ae4bca7, three e2e workers).

/** How often the wait looks at the first window again. */
export const SHOW_POLL_MS = 100

/** How the wait ended, and how long after its start. */
export interface ShowWait {
  /** visible: isVisible() was true; show-event: the window emitted 'show'; no-window: the app has no live window; timeout: none of these in time. */
  how: 'visible' | 'show-event' | 'no-window' | 'timeout'
  afterMs: number
}

/** The part of a BrowserWindow the wait reads. */
export interface WatchedWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  once(event: 'show', listener: () => void): unknown
  removeListener(event: 'show', listener: () => void): unknown
}

/**
 * Resolves once the app's first live window is visible or emits 'show', once the app has no live
 * window, or after `timeoutMs`. The first window is read again on every tick, so a window that is
 * destroyed or replaced is followed; its 'show' listener moves with it. The interval and the
 * listener are removed when the wait ends.
 * Passed to app.evaluate whole: Playwright sends its source text to main, so the body uses only its
 * arguments and the globals of main, never anything else of this module.
 */
export function waitForFirstWindowShown(
  electron: { BrowserWindow: { getAllWindows(): WatchedWindow[] } },
  options: { intervalMs: number; timeoutMs: number },
): Promise<ShowWait> {
  const start = Date.now()
  return new Promise<ShowWait>((done) => {
    let watched: WatchedWindow | undefined
    let finished = false
    let timer: ReturnType<typeof setInterval> | undefined
    const finish = (how: ShowWait['how']): void => {
      finished = true
      if (timer !== undefined) clearInterval(timer)
      if (watched !== undefined && !watched.isDestroyed()) watched.removeListener('show', onShow)
      watched = undefined
      done({ how, afterMs: Date.now() - start })
    }
    function onShow(): void {
      // once() has removed the listener already.
      watched = undefined
      if (!finished) finish('show-event')
    }
    const check = (): void => {
      if (finished) return
      const first = electron.BrowserWindow.getAllWindows().find((each) => !each.isDestroyed())
      if (first === undefined) return finish('no-window')
      if (first.isVisible()) return finish('visible')
      if (Date.now() - start >= options.timeoutMs) return finish('timeout')
      if (first !== watched) {
        if (watched !== undefined && !watched.isDestroyed()) watched.removeListener('show', onShow)
        watched = first
        first.once('show', onShow)
      }
    }
    check()
    if (!finished) timer = setInterval(check, options.intervalMs)
  })
}
