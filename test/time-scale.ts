// The multiplier of every time limit of the test run, shared by vitest.config.ts and the tests that
// set a limit of their own, so such a limit grows on Windows the same way the defaults do.

/**
 * On Windows every time limit is seven times the default. In a full run there, short tests run
 * 4-5x slower than alone (process start-up under load), and a different set reaches the limit
 * each run, so limits per test never settled (worfy-windows ticket 14, worfy-polish 30).
 * A test that really hangs still fails, only later.
 *
 * It was 3 until 2026-10-28. Since the evening of 2026-10-27 the windows-latest runner runs the
 * suite in about half the time (1344 s instead of 2551-2961 s) with more files at once, and the tests
 * that start many processes became slower: the Demo project's suite (test/contract/demo-template)
 * 1.1 s before, 12-69 s after; eval:harness --changed (test/contract/harness-evals) up to 54 s. Over
 * 16 Windows runs such tests passed the 45 s limit five times, four different tests (CI runs 40604951289,
 * 40605523606, 40606228458, 40607908878, 40608771875). 7 is the slowest of them, 68.7 s, times 1.5,
 * over the 15 s of a contract test: 105 s. The cost: a hanging test on Windows fails 60 s later.
 */
export const timeScale = process.platform === 'win32' ? 7 : 1
