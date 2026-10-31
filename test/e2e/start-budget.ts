// The time an Auction-sized Project may take to become interactive, in the start test of
// test/e2e/epic-frame.spec.ts. A pure function, so test/unit/e2e-start-budget.test.ts checks it
// without a window.

/** The budget on the owner's Mac: the start holds it there (564 ms measured). */
export const START_MS = 3_000

/**
 * On the GitHub macOS runner every Project starts several times slower than on the owner's Mac, so
 * there the budget is this many times the runner's own start of a one-Ticket Project in the same
 * test (the median of three starts). Measured on the runner 2026-10-28, an Auction-sized start
 * against a one-Ticket one: 3897 against 1274 ms (3.1×) and 3911 against 909 ms (4.3×) from single
 * starts; 2739 against a median of 721 ms (3.8×) and 1736 against 565 ms (3.07×) from three. 6 is
 * the highest 4.3 with a margin of 1.4.
 */
export const START_RATIO = 6

/**
 * The ceiling of the runner's budget: a one-Ticket start that got slower must not raise the budget
 * with it. The slowest Auction-sized start the runner measured is 4853 ms (3717–4853 ms over the
 * runs of 2026-10-28); 4853 × 1.5 = 7280, rounded up to 7.3 s. The margin of 1.5 holds the runner's
 * spread between runs: its Auction-sized start ranged from 1736 to 4853 ms.
 */
export const RUNNER_START_CAP_MS = 7_300

/**
 * Whether the budget is relative to the machine's own one-Ticket start: on GitHub Actions
 * (GITHUB_ACTIONS=true) and on Windows (`platform` win32). The owner's Windows PC runs the e2e suite
 * with 8 workers in its gate full: under that load an Auction-sized start took 3394 ms there against
 * 1300 ms alone on the same commit, 1248-1951 ms in nine earlier gate full runs (worfy-polish 47).
 * The reference starts in the same test take the same load, as the runner's take its slowness. The
 * 3 s were set from the Mac only; nothing recorded held Windows to them (#874 made the ratio for the
 * runner alone).
 */
function relativeBudget(env: Readonly<Record<string, string | undefined>>, platform: string): boolean {
  return env.GITHUB_ACTIONS === 'true' || platform === 'win32'
}

/**
 * The budget for an Auction-sized start, given the median one-Ticket start `referenceMs` on the
 * same machine: START_MS, except where the budget is relative (relativeBudget: GitHub Actions,
 * Windows), where it is START_RATIO times the reference, no less than START_MS and no more than
 * RUNNER_START_CAP_MS.
 */
export function startBudget(referenceMs: number, env: Readonly<Record<string, string | undefined>>, platform: string): number {
  if (!relativeBudget(env, platform)) return START_MS
  return Math.min(RUNNER_START_CAP_MS, Math.max(START_MS, START_RATIO * referenceMs))
}

/** Whether the start test measures the one-Ticket reference: only where the budget depends on it. */
export function measuresReference(env: Readonly<Record<string, string | undefined>>, platform: string): boolean {
  return relativeBudget(env, platform)
}
