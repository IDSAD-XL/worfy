// The listener launchApp installs in the app's main (test/e2e/uncaught-exit.ts), with a fake process
// and a fake app: in e2e it runs inside main, where Electron's error box once held a test for a minute.
// And the failure launchApp's close() and failed start give a test whose app exited with its code.
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { exitOnUncaught, UNCAUGHT_EXIT_CODE, uncaughtExitProblem } from '../e2e/uncaught-exit'

/**
 * The function rebuilt from its source text, as app.evaluate sends it to main: a name from outside
 * its body fails here with a ReferenceError instead of only in main.
 */
const fromSource = new Function(`return (${String(exitOnUncaught)})`)() as typeof exitOnUncaught

function setUp() {
  const host = new EventEmitter()
  const exit = vi.fn<(code: number) => void>()
  const lines: string[] = []
  fromSource({ app: { exit } }, { code: UNCAUGHT_EXIT_CODE }, { host, write: (text) => void lines.push(text) })
  return { host, exit, lines }
}

describe('exitOnUncaught', () => {
  it('ends the app with exit code 70 and writes one line that names the exception and the code', () => {
    const { host, exit, lines } = setUp()
    host.emit('uncaughtException', new TypeError('Object has been destroyed'), 'uncaughtException')
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(70)
    expect(lines).toEqual([
      "[e2e] uncaught exception in main (uncaughtException): TypeError: Object has been destroyed; the app exits with code 70 instead of Electron's error box (the stack is in worfy's own line above)\n",
    ])
  })

  it('adds one uncaughtException listener and no uncaughtExceptionMonitor one', () => {
    const { host } = setUp()
    // In main this is the second listener, next to Electron's own (lib/browser/init.ts), which shows
    // its box only while it is the only one. worfy's own report (src/main/diagnostics/uncaught-stderr.ts)
    // is a monitor and stays the only one there.
    expect(host.listenerCount('uncaughtException')).toBe(1)
    expect(host.listenerCount('uncaughtExceptionMonitor')).toBe(0)
  })

  it('names a thrown value that is not an Error', () => {
    const { host, lines } = setUp()
    host.emit('uncaughtException', 'plain text', 'unhandledRejection')
    expect(lines[0]).toContain('(unhandledRejection): plain text;')
  })

  it('ends the app once: an exception thrown while app.exit closes the windows is not reported again', () => {
    const { host, exit, lines } = setUp()
    host.emit('uncaughtException', new Error('first'), 'uncaughtException')
    host.emit('uncaughtException', new Error('second'), 'uncaughtException')
    expect(exit).toHaveBeenCalledTimes(1)
    expect(lines).toHaveLength(1)
  })

  it('still ends the app when stderr cannot be written', () => {
    const host = new EventEmitter()
    const exit = vi.fn<(code: number) => void>()
    fromSource({ app: { exit } }, { code: UNCAUGHT_EXIT_CODE }, {
      host,
      write: () => {
        throw new Error('EPIPE')
      },
    })
    host.emit('uncaughtException', new Error('boom'), 'uncaughtException')
    expect(exit).toHaveBeenCalledWith(70)
  })

  it("with two arguments, as Playwright calls it, writes to fd 2 of main's own process", () => {
    const host = new EventEmitter()
    const writeSync = vi.fn<(fd: number, text: string) => number>(() => 0)
    const getBuiltinModule = vi.fn(() => ({ writeSync }))
    const exit = vi.fn<(code: number) => void>()
    // Only for the two calls below: vitest itself runs on the real process.
    vi.stubGlobal('process', Object.assign(host, { getBuiltinModule }))
    try {
      fromSource({ app: { exit } }, { code: UNCAUGHT_EXIT_CODE })
      host.emit('uncaughtException', new Error('boom'), 'uncaughtException')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(getBuiltinModule).toHaveBeenCalledWith('node:fs')
    expect(writeSync).toHaveBeenCalledTimes(1)
    expect(writeSync.mock.calls[0]?.[0]).toBe(2)
    expect(writeSync.mock.calls[0]?.[1]).toContain('[e2e] uncaught exception in main (uncaughtException): Error: boom;')
    expect(exit).toHaveBeenCalledWith(70)
  })
})

describe('uncaughtExitProblem', () => {
  it('is null for any exit but 70', () => {
    for (const code of [null, 0, 1, 137]) expect(uncaughtExitProblem(code, '[e2e] uncaught exception in main (x): y\n')).toBeNull()
  })

  it("quotes the app's output from worfy's own report to the [e2e] line exitOnUncaught wrote", () => {
    const { host, lines } = setUp()
    host.emit('uncaughtException', new TypeError('Object has been destroyed'), 'uncaughtException')
    const output = [
      '[worfy] the window was shown on ready-to-show',
      '[worfy] uncaught exception in main (uncaughtException): TypeError: Object has been destroyed',
      '    at BrowserWindow.visibilityChanged (node:electron/js2c/browser_init:1:18097)',
      lines[0]?.trimEnd(),
      '[worfy] a line after the exit began',
    ].join('\n')
    expect(uncaughtExitProblem(70, output)).toBe(
      [
        'an uncaught exception of main ended the app with exit code 70:',
        '[worfy] uncaught exception in main (uncaughtException): TypeError: Object has been destroyed',
        '    at BrowserWindow.visibilityChanged (node:electron/js2c/browser_init:1:18097)',
        "[e2e] uncaught exception in main (uncaughtException): TypeError: Object has been destroyed; the app exits with code 70 instead of Electron's error box (the stack is in worfy's own line above)",
      ].join('\n'),
    )
  })

  it('quotes the [e2e] line alone when the output lost the report before it, and says when it has neither', () => {
    expect(uncaughtExitProblem(70, 'noise\r\n[e2e] uncaught exception in main (x): Error: y; ...\r\n')).toBe(
      'an uncaught exception of main ended the app with exit code 70:\n[e2e] uncaught exception in main (x): Error: y; ...',
    )
    expect(uncaughtExitProblem(70, '')).toBe("an uncaught exception of main ended the app with exit code 70:\n(the app's output has no report of it)")
  })
})
