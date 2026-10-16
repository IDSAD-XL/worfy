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
import { launchApp, type LaunchedApp } from './helpers'

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
    // Only macOS has a Dock (app.dock is undefined elsewhere).
    if (process.platform === 'darwin') {
      expect(await launched.app.evaluate(({ app }) => app.dock?.isVisible())).toBe(false)
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

test('a window worfy opens later is quiet too: shown inactive, transparent, and the mouse goes through it', async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    const reopened = await launched.app.evaluate(async ({ app, BrowserWindow }) => {
      const calls: string[] = []
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
      await new Promise<void>((done) => {
        first.once('closed', () => done())
        first.close()
      })
      // A second start with no window open: worfy opens one (src/main/index.ts, second-instance).
      app.emit('second-instance', {}, [], process.cwd(), {})
      const [next] = BrowserWindow.getAllWindows()
      if (next === undefined) throw new Error('no window after the second start')
      if (!next.isVisible()) await new Promise<void>((done) => next.once('show', () => done()))
      return { calls, visible: next.isVisible(), focused: next.isFocused(), opacity: next.getOpacity() }
    })
    expect(reopened.visible).toBe(true)
    expect(reopened.focused).toBe(false)
    if (process.platform !== 'linux') expect(reopened.opacity).toBe(0)
    expect(reopened.calls).toContain('setIgnoreMouseEvents(true)')
    expect(reopened.calls).toContain('showInactive()')
    expect(reopened.calls).not.toContain('show()')
    expect(reopened.calls).not.toContain('focus()')
  } finally {
    await launched.close()
  }
})

test("Playwright's screenshot of the transparent window still shows the page", async () => {
  const launched = await launchApp({ env: QUIET })
  try {
    await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
    // The same call helpers.ts makes for the screenshot a failing test keeps.
    const png = await launched.window.screenshot({ timeout: 5_000 })
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
