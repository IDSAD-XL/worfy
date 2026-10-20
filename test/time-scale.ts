// The multiplier of every time limit of the test run, shared by vitest.config.ts and the tests that
// set a limit of their own, so such a limit grows on Windows the same way the defaults do.

/**
 * On Windows every time limit is three times the default. In a full run there, short tests run
 * 4-5x slower than alone (process start-up under load), and a different set reaches the limit
 * each run, so limits per test never settled (worfy-windows ticket 14, worfy-polish 30).
 * A test that really hangs still fails, only later.
 */
export const timeScale = process.platform === 'win32' ? 3 : 1
