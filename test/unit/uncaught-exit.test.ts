// The listener launchApp installs in the app's main (test/e2e/uncaught-exit.ts), with a fake process
// and a fake app: in e2e it runs inside main, where Electron's error box once held a test for a minute.
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { exitOnUncaught, UNCAUGHT_EXIT_CODE } from '../e2e/uncaught-exit'

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
})
