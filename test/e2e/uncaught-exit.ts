// An uncaught exception of the app's main ends the app under test at once, with its own exit code,
// instead of Electron's modal error box. launchApp (helpers.ts) installs it right after the launch.
//
// Electron answers an uncaught exception of main with "A JavaScript error occurred in the main
// process", a modal box that holds main's thread until someone clicks it, but only while its own
// `uncaughtException` listener is the only one (lib/browser/init.ts of Electron). On a CI runner
// nobody clicks: every later call into main got no answer, and the test only failed on its time
// limit. That is how quiet-windows' later-window test hung for a minute on the macOS runner
// (worfy-polish 112: destroy() of a shown window, then Electron's own visibilityChanged threw
// "Object has been destroyed"). A second listener turns the box off; this one then ends the app.
//
// worfy's own report of the exception is untouched: src/main/diagnostics/uncaught-stderr.ts watches
// through `uncaughtExceptionMonitor`, which Node calls before any `uncaughtException` listener, so
// the stack is already on stderr when this listener runs. This listener writes one line of its own
// and does not repeat the stack.

/** The exit code of an app that an uncaught exception of main ended in an e2e run. */
export const UNCAUGHT_EXIT_CODE = 70

/** The part of `process` the listener uses; the unit test passes an EventEmitter. */
export interface UncaughtHost {
  on(event: 'uncaughtException', listener: (error: unknown, origin: string) => void): unknown
}

/** What the listener listens on and where it writes; main's `process` and fd 2 by default. */
export interface UncaughtExitDeps {
  host: UncaughtHost
  write: (text: string) => void
}

/**
 * Adds an `uncaughtException` listener to main that writes one line to stderr, synchronously, and
 * ends the app with `options.code` through app.exit. Only the first exception ends it: app.exit
 * closes the windows, and an exception thrown while it does is not reported again.
 * Passed to app.evaluate whole: Playwright sends its source text to main, so the body uses only its
 * arguments and the globals of main, never anything else of this module. app.evaluate passes two
 * arguments, so `deps` takes main's `process` and fd 2; the unit test passes its own.
 */
export function exitOnUncaught(
  electron: { app: { exit(code: number): void } },
  options: { code: number },
  deps: UncaughtExitDeps = { host: process, write: (text) => void process.getBuiltinModule('node:fs').writeSync(2, text) },
): void {
  let ending = false
  deps.host.on('uncaughtException', (error, origin) => {
    if (ending) return
    ending = true
    const what = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    try {
      deps.write(`[e2e] uncaught exception in main (${origin}): ${what}; the app exits with code ${options.code} instead of Electron's error box (the stack is in worfy's own line above)\n`)
    } catch {
      // stderr is closed: the exit code still says it.
    }
    electron.app.exit(options.code)
  })
}
