// Quiet windows (src/main/quiet-windows.ts): with WORFY_QUIET_WINDOWS=1, which playwright.config.ts
// sets for every e2e test, a worfy under test must not get in the way of whoever uses the Mac
// meanwhile. Its window is on screen (tests of the window's size and place still hold) but never
// takes the focus, worfy has no Dock icon, and the window is transparent and lets the mouse through.
// Playwright does not need any of that: it sends input and takes screenshots over CDP.
//
// The checks go through app.evaluate in main. Electron has no getter for "ignores mouse events",
// so that one is checked on a window the app opens itself after the test has wrapped the window
// methods in main: the first window is already shown when launchApp returns, and a later window
// is made by the same createMainWindow.
import { expect, test } from '@playwright/test'
import { SHOW_POLL_MS, waitForFirstWindowShown } from './first-window-shown'
import { launchApp, type LaunchedApp } from './helpers'
import { quarantined } from './quarantine'
import { ms } from '../time-scale'

const QUIET = { WORFY_QUIET_WINDOWS: '1' }

/** What main says about its first window. */
function windowState(launched: LaunchedApp) {
  return launched.app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows()
    if (window === undefined) throw new Error('no window')
    return {
      visible: window.isVisible(),
      focused: window.isFocused(),
      anyFocused: BrowserWindow.getFocusedWindow() !== null,
      opacity: window.getOpacity(),
    }
  })
}

test('the window is on screen but takes no focus, has no Dock icon and is transparent', async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    const state = await windowState(launched)
    expect(state.visible).toBe(true)
    expect(state.focused).toBe(false)
    expect(state.anyFocused).toBe(false)
    // Linux has no window opacity: getOpacity() answers 1 there whatever was set.
    if (process.platform !== 'linux') expect(state.opacity).toBe(0)
    // Only macOS has a Dock (app.dock is undefined elsewhere). The activation policy is set before
    // the first window, but macOS may take it in later on a loaded Mac: the Dock is read until it
    // says so, not once.
    if (process.platform === 'darwin') {
      await expect.poll(() => launched.app.evaluate(({ app }) => app.dock?.isVisible()), { message: 'the Dock icon' }).toBe(false)
    }
  } finally {
    await launched.close()
  }
})

test('a second start of worfy does not bring the quiet window to the front', async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    const focusCalls = await launched.app.evaluate(({ app, BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      if (window === undefined) throw new Error('no window')
      let calls = 0
      const focus = window.focus.bind(window)
      window.focus = () => {
        calls += 1
        focus()
      }
      // What Electron emits in the running worfy when another one is started over its data folder.
      app.emit('second-instance', {}, [], process.cwd(), {})
      return calls
    })
    expect(focusCalls).toBe(0)
    expect((await windowState(launched)).focused).toBe(false)
  } finally {
    await launched.close()
  }
})

/** `step` (an app.evaluate), or a failure that names it after `limitMs`: a call into main that never answers must not hold the test and its worker. */
async function bounded<T>(what: string, limitMs: number, step: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what}: no answer from main within ${limitMs / 1000} s`)), limitMs)
  })
  try {
    return await Promise.race([step, late])
  } finally {
    clearTimeout(timer)
  }
}

quarantined('quiet-windows-later-window-quiet')('a window worfy opens later is quiet too: shown inactive, transparent, and the mouse goes through it', async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    // Two calls into main, each bounded, so a hang names its step. In one call that destroyed the
    // first window and waited for the next, main twice gave no answer for a minute on the macOS runner,
    // and the quit in the worker's teardown hung after it (worfy-throughput 55).
    const destroyed = await bounded('wrapping the window methods and destroying the first window', ms(20_000), launched.app.evaluate(async ({ app, BrowserWindow }, closedMs) => {
      const calls: string[] = []
      // Read by the second call below.
      const kept = globalThis as { quietWindowCalls?: string[] }
      kept.quietWindowCalls = calls
      const proto = BrowserWindow.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
      for (const name of ['show', 'showInactive', 'focus', 'setIgnoreMouseEvents', 'setOpacity']) {
        const original = proto[name] as (...args: unknown[]) => unknown
        proto[name] = function (this: unknown, ...args: unknown[]) {
          calls.push(`${name}(${args.map((arg) => JSON.stringify(arg)).join(',')})`)
          return original.apply(this, args)
        }
      }
      // Closing the last window quits worfy on Windows and Linux; this test keeps it running so the
      // second start below opens a new window there too, as it does on macOS.
      app.removeAllListeners('window-all-closed')
      app.on('window-all-closed', () => undefined)
      const [first] = BrowserWindow.getAllWindows()
      if (first === undefined) throw new Error('no window')
      // destroy(), not close(): close() asks the page first and waits for its answer, and a page that
      // did not answer left 'closed' waiting past the test's timeout on the macOS runner. This test
      // checks the window opened after; how the first one goes is not its subject.
      return new Promise<string>((done) => {
        const timer = setTimeout(() => done(`no 'closed' within ${closedMs} ms; windows left: ${BrowserWindow.getAllWindows().length}`), closedMs)
        first.once('closed', () => {
          clearTimeout(timer)
          done('closed')
        })
        first.destroy()
      })
    }, ms(10_000)))
    expect(destroyed).toBe('closed')

    const reopened = await bounded('the second start and the wait for its window', ms(45_000), launched.app.evaluate(async ({ app, BrowserWindow }, { waitSource, intervalMs, timeoutMs }) => {
      // A second start with no window open: worfy opens one (src/main/index.ts, second-instance).
      app.emit('second-instance', {}, [], process.cwd(), {})
      const [next] = BrowserWindow.getAllWindows()
      if (next === undefined) throw new Error('no window after the second start')
      // Polled, not on 'show' alone: on macOS 'show' comes only with an occlusion change and can
      // fail to come (first-window-shown.ts). The helper arrives as source text, as app.evaluate
      // sends any function to main.
      const wait = new Function(`return (${waitSource})`)() as typeof waitForFirstWindowShown
      const shown = await wait({ BrowserWindow }, { intervalMs, timeoutMs })
      const calls = (globalThis as { quietWindowCalls?: string[] }).quietWindowCalls ?? []
      return { shown: shown.how, calls, visible: next.isVisible(), focused: next.isFocused(), opacity: next.getOpacity() }
    }, { waitSource: String(waitForFirstWindowShown), intervalMs: SHOW_POLL_MS, timeoutMs: ms(30_000) }))
    expect(reopened.visible, `the wait for the window ended: ${reopened.shown}`).toBe(true)
    expect(reopened.focused).toBe(false)
    if (process.platform !== 'linux') expect(reopened.opacity).toBe(0)
    expect(reopened.calls).toContain('setIgnoreMouseEvents(true)')
    expect(reopened.calls).toContain('showInactive()')
    expect(reopened.calls).not.toContain('show()')
    expect(reopened.calls).not.toContain('focus()')
  } finally {
    // The first window is gone: no screenshot of it, and a quit that hangs is ended with a kill.
    await launched.close({ windowGone: true })
  }
})

test("Playwright's screenshot of the transparent window still shows the page", async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
    // The same call helpers.ts makes for the screenshot a failing test keeps.
    const png = await launched.window.screenshot({ timeout: ms(5_000) })
    const colours = await launched.app.evaluate(({ nativeImage }, base64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
      const bitmap = image.toBitmap()
      const seen = new Set<number>()
      let opaque = 0
      // Every 97th pixel of the BGRA bitmap is enough to tell a page from an empty surface.
      for (let pixel = 0; pixel * 4 < bitmap.length; pixel += 97) {
        seen.add(bitmap.readUInt32LE(pixel * 4))
        if (bitmap[pixel * 4 + 3] === 255) opaque += 1
      }
      return { width: image.getSize().width, distinct: seen.size, opaque }
    }, png.toString('base64'))
    expect(colours.width).toBeGreaterThan(0)
    expect(colours.opaque).toBeGreaterThan(0)
    // A blank capture of a transparent window would be one colour.
    expect(colours.distinct).toBeGreaterThan(2)
  } finally {
    await launched.close()
  }
})
