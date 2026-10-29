// The multiplier of every time limit of the test run: vitest.config.ts, playwright.config.ts,
// playwright.acceptance.config.ts and each limit a test sets for itself (through ms below).
// test/contract/test-timeout-scale.test.ts fails on a literal limit that bypasses ms.

/**
 * The multiplier when WORFY_TEST_TIMEOUT_SCALE is unset: one value on every machine and platform,
 * so no limit depends on where the run happens (owner's decision 2026-10-29, worfy-throughput 57).
 * Three is the Windows multiplier this replaced, so no limit on Windows got shorter; under load the
 * owner's PC still ran some tests to 1.5x a limit that was already tripled. The value is to be set
 * from a measurement on that PC (limit and actual time of each test that hit its limit).
 * A test that really hangs still fails, only later.
 */
export const DEFAULT_TIMEOUT_SCALE = 3

/**
 * Reads the multiplier from `value` (WORFY_TEST_TIMEOUT_SCALE): unset or empty gives the default;
 * anything else must be a finite number of at least 1, so no limit is shorter than written.
 */
export function readTimeoutScale(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_TIMEOUT_SCALE
  const scale = Number(value)
  if (!Number.isFinite(scale) || scale < 1) {
    throw new Error(`WORFY_TEST_TIMEOUT_SCALE must be a number of at least 1, got "${value}"`)
  }
  return scale
}

export const timeScale = readTimeoutScale(process.env.WORFY_TEST_TIMEOUT_SCALE)

/** A time limit of a test, in milliseconds, times the run's multiplier. */
export function ms(limit: number): number {
  return Math.round(limit * timeScale)
}
