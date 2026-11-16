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

test('a window worfy opens later is quiet too: shown inactive, transparent, and the mouse goes through it', async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    // The first window stays open. This test used to destroy it and let a second start open the next
    // one, and on the macOS runner main then hung (worfy-polish 112): destroy() of a shown window can
    // emit 'hide' on the destroyed window, Electron's own visibility listener on it
    // (lib/browser/api/browser-window.ts, visibilityChanged) calls isVisible() and throws "Object has
    // been destroyed", and Electron answers that uncaught exception of main with a modal error box
    // that holds main's thread. Instead, main's list of windows reads empty for the moment of a
    // second start, so worfy's own second-instance handler (src/main/index.ts) opens the next window
    // through createMainWindow, as it does after the last window has closed.
    const opened = await bounded('the second start and the wait for its window', ms(45_000), launched.app.evaluate(async ({ app, BrowserWindow }, { waitSource, intervalMs, timeoutMs }) => {
      const calls: string[] = []
      const proto = BrowserWindow.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
      const unwrap: Array<() => void> = []
      for (const name of ['show', 'showInactive', 'focus', 'setIgnoreMouseEvents', 'setOpacity']) {
        const original = proto[name] as (...args: unknown[]) => unknown
        // Most of these live on BaseWindow's prototype: the wrapper on BrowserWindow's is removed, not replaced.
        const own = Object.getOwnPropertyDescriptor(proto, name)
        unwrap.push(() => (own === undefined ? delete proto[name] : Object.defineProperty(proto, name, own)))
        proto[name] = function (this: unknown, ...args: unknown[]) {
          calls.push(`${name}(${args.map((arg) => JSON.stringify(arg)).join(',')})`)
          return original.apply(this, args)
        }
      }
      try {
        const [first] = BrowserWindow.getAllWindows()
        if (first === undefined) throw new Error('no window')
        const getAllWindows = BrowserWindow.getAllWindows
        BrowserWindow.getAllWindows = () => []
        try {
          app.emit('second-instance', {}, [], process.cwd(), {})
        } finally {
          BrowserWindow.getAllWindows = getAllWindows
        }
        const next = BrowserWindow.getAllWindows().find((each) => each !== first && !each.isDestroyed())
        if (next === undefined) throw new Error('no new window after the second start')
        // Polled, not on 'show' alone: on macOS 'show' comes only with an occlusion change and can
        // fail to come (first-window-shown.ts). The helper watches the first live window of the list
        // it is given, so it is given the new window alone. It arrives as source text, as
        // app.evaluate sends any function to main.
        const wait = new Function(`return (${waitSource})`)() as typeof waitForFirstWindowShown
        const shown = await wait({ BrowserWindow: { getAllWindows: () => [next] } }, { intervalMs, timeoutMs })
        return { shown: shown.how, calls: [...calls], visible: next.isVisible(), focused: next.isFocused(), anyFocused: BrowserWindow.getFocusedWindow() !== null, opacity: next.getOpacity() }
      } finally {
        // The wrappers go: the quit at the end of the test closes both windows through the real methods.
        for (const undo of unwrap) undo()
      }
    }, { waitSource: String(waitForFirstWindowShown), intervalMs: SHOW_POLL_MS, timeoutMs: ms(30_000) }))
    expect(opened.visible, `the wait for the window ended: ${opened.shown}`).toBe(true)
    expect(opened.focused).toBe(false)
    expect(opened.anyFocused).toBe(false)
    if (process.platform !== 'linux') expect(opened.opacity).toBe(0)
    expect(opened.calls).toContain('setIgnoreMouseEvents(true)')
    expect(opened.calls).toContain('showInactive()')
    expect(opened.calls).not.toContain('show()')
    expect(opened.calls).not.toContain('focus()')
  } finally {
    await launched.close()
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
