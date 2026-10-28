// The stack of an uncaught exception of main goes out before Electron's error box blocks the main
// thread (src/main/diagnostics/uncaught-stderr.ts): only through `uncaughtExceptionMonitor`, which
// leaves Electron's own handling of the exception as it was.
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { reportUncaughtToStderr, uncaughtReport } from '../../src/main/diagnostics/uncaught-stderr'

describe('uncaughtReport', () => {
  it('names the origin and gives the stack of an Error', () => {
    const error = new Error('Object has been destroyed')
    error.stack = 'TypeError: Object has been destroyed\n    at WebContents.<anonymous> (index.js:1:2)'
    expect(uncaughtReport(error, 'uncaughtException')).toBe(
      '[worfy] uncaught exception in main (uncaughtException): TypeError: Object has been destroyed\n    at WebContents.<anonymous> (index.js:1:2)\n',
    )
  })

  it('gives the name and message of an Error without a stack, and any other value as it reads', () => {
    const error = new RangeError('too far')
    error.stack = undefined
    expect(uncaughtReport(error, 'unhandledRejection')).toBe('[worfy] uncaught exception in main (unhandledRejection): RangeError: too far\n')
    expect(uncaughtReport('plain', 'uncaughtException')).toBe('[worfy] uncaught exception in main (uncaughtException): plain\n')
  })
})

describe('reportUncaughtToStderr', () => {
  it('writes each uncaught exception, and listens to the monitor event only: Electron keeps its own handling', () => {
    const source = new EventEmitter()
    const written: string[] = []
    reportUncaughtToStderr(source, (text) => written.push(text))
    expect(source.listenerCount('uncaughtException')).toBe(0)
    source.emit('uncaughtExceptionMonitor', new Error('first'), 'uncaughtException')
    source.emit('uncaughtExceptionMonitor', 'second', 'uncaughtException')
    expect(written).toHaveLength(2)
    expect(written[0]).toMatch(/^\[worfy\] uncaught exception in main \(uncaughtException\): Error: first\n/)
    expect(written[1]).toBe('[worfy] uncaught exception in main (uncaughtException): second\n')
  })

  it('does not throw when stderr cannot be written', () => {
    const source = new EventEmitter()
    reportUncaughtToStderr(source, () => {
      throw new Error('EBADF')
    })
    expect(() => source.emit('uncaughtExceptionMonitor', new Error('x'), 'uncaughtException')).not.toThrow()
  })
})
