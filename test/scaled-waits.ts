// The default time limit of a wait for a condition, times the run's multiplier (test/time-scale.ts).
// vi.waitFor and vi.waitUntil give up after 1 s when a call names no timeout, whatever the machine:
// under load a 1 s wait on a loaded Mac or a Windows runner fails on time alone. test/setup-waits.ts
// puts the wrappers below on vi in every test file; vitest.config.ts scales the default of expect.poll,
// and test/setup-dom.ts the default of Testing Library's waitFor and findBy*. A call that names its own
// timeout keeps it (test/contract/test-timeout-scale.test.ts makes that limit go through ms), and the
// interval between checks stays as it was.

/** vitest 5.0.3's timeout of vi.waitFor, vi.waitUntil and expect.poll, and Testing Library's asyncUtilTimeout. */
// unscaled: the bare default of vitest and Testing Library, which ms multiplies where it is used
export const WAIT_DEFAULT_TIMEOUT = 1_000

/** The options vi.waitFor and vi.waitUntil take: a timeout in milliseconds, or an object. */
export type WaitOptions = number | { timeout?: number; interval?: number }

type Wait = (callback: never, options?: WaitOptions) => unknown

/** The waits a wrapper replaces: vi, or a stand-in of it in a test. */
export interface Waits {
  waitFor: Wait
  waitUntil: Wait
}

const SCALED = Symbol('worfy:scaled-wait-timeout')

type Scaled<W extends Wait> = W & { [SCALED]?: number }

/** `options` with `timeout` filled in when the caller named none; a timeout the caller named stays. */
export function withDefaultTimeout(options: WaitOptions | undefined, timeout: number): WaitOptions {
  if (typeof options === 'number') return options
  if (options?.timeout !== undefined) return options
  return { ...options, timeout }
}

/** The default timeout a scaled wait gives a call that names none; undefined for a wait as vitest made it. */
export function scaledTimeoutOf(wait: Wait): number | undefined {
  return (wait as Scaled<Wait>)[SCALED]
}

function scaled<W extends Wait>(wait: W, timeout: number): W {
  const original = wait
  const wrapped = ((callback: never, options?: WaitOptions) => original(callback, withDefaultTimeout(options, timeout))) as Scaled<W>
  wrapped[SCALED] = timeout
  return wrapped
}

/**
 * Replaces waitFor and waitUntil of `target` with wrappers whose default timeout is
 * WAIT_DEFAULT_TIMEOUT times `scale`. vitest itself is loaded once per worker and runs the setup
 * file again for each test file, so a wait already scaled is left as it is, not wrapped twice.
 */
export function scaleWaits(target: Waits, scale: number): void {
  const timeout = Math.round(WAIT_DEFAULT_TIMEOUT * scale)
  for (const name of ['waitFor', 'waitUntil'] as const) {
    if (scaledTimeoutOf(target[name]) === undefined) target[name] = scaled(target[name], timeout)
  }
}
