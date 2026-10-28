// The time an Auction-sized Project may take to become interactive, in the start test of
// test/e2e/epic-frame.spec.ts. A pure function, so test/unit/e2e-start-budget.test.ts checks it
// without a window.

/** The budget everywhere but on GitHub Actions: the start holds it on the owner's Mac (564 ms measured). */
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
 * The budget for an Auction-sized start, given the median one-Ticket start `referenceMs` on the
 * same machine: START_MS, except on GitHub Actions (GITHUB_ACTIONS=true), where it is START_RATIO
 * times the reference, no less than START_MS and no more than RUNNER_START_CAP_MS.
 */
export function startBudget(referenceMs: number, env: Readonly<Record<string, string | undefined>>): number {
  if (env.GITHUB_ACTIONS !== 'true') return START_MS
  return Math.min(RUNNER_START_CAP_MS, Math.max(START_MS, START_RATIO * referenceMs))
}

/** Whether the start test measures the one-Ticket reference: only where the budget depends on it. */
export function measuresReference(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.GITHUB_ACTIONS === 'true'
}
