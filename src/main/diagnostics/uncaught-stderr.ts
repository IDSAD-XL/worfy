// The stack of an uncaught exception of main, written to stderr at once. Electron answers such an
// exception with a modal error box ("A JavaScript error occurred in the main process") that blocks
// the main thread until someone clicks it, and console output still queued in a pipe never leaves
// the process: an e2e test then only sees an app that does not quit, and is killed without a
// word about why. writeSync puts the stack out before the box is shown.
//
// Through `uncaughtExceptionMonitor`, not `uncaughtException`: Electron shows the box only while
// its own `uncaughtException` listener is the only one, so a listener of that event would change
// what the app does after the exception. A monitor only watches; the box and everything after it
// stay as they were (measured with Electron 44: stack on stderr, then the box, the process blocked).
import { writeSync } from 'node:fs'

/** The text written for an uncaught exception: where it came from and its stack, or its value. */
export function uncaughtReport(error: unknown, origin: string): string {
  const what = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
  return `[worfy] uncaught exception in main (${origin}): ${what}\n`
}

/** The part of `process` reportUncaughtToStderr uses; the unit test passes an EventEmitter. */
export interface UncaughtSource {
  on(event: 'uncaughtExceptionMonitor', listener: (error: unknown, origin: string) => void): unknown
}

/** Writes every uncaught exception of `source` with `write` (fd 2, synchronously, by default). */
export function reportUncaughtToStderr(source: UncaughtSource = process, write: (text: string) => void = (text) => void writeSync(2, text)): void {
  source.on('uncaughtExceptionMonitor', (error, origin) => {
    try {
      write(uncaughtReport(error, origin))
    } catch {
      // stderr is closed: there is nowhere left to say it.
    }
  })
}
