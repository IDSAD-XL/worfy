// The time an Auberge-sized Project may take to become interactive, in the start test of
// test/e2e/epic-frame.spec.ts. A pure function, so test/unit/e2e-start-budget.test.ts checks it
// without a window.

/** The budget everywhere but on GitHub Actions: the start holds it on the owner's Mac (564 ms measured). */
export const START_MS = 3_000

/**
 * On the GitHub macOS runner every Project starts several times slower than on the owner's Mac, so
 * there the budget is this many times the runner's own start of a one-Ticket Project in the same
 * test (the median of three starts, R). Over 108 macos-e2e jobs of main 2026-11-09..25 the
 * Auberge-sized start N against R was 3.33 at the median, 4.63 at the 95th percentile and 5.44 at
 * most, on the code before worfy-polish ticket 152; that ticket took the two late redraws of every
 * card (831 and 1080 ms of a 5511 ms start on the runner) out of N, and its first run measured
 * 2338 against 930 ms (2.51). 5 is above that 95th percentile, so the start before the fix would
 * have passed in 103 of the 108 jobs, and 5 × R reaches the ceiling only from R = 1460 ms: R, not
 * the ceiling, sets the budget in 83 of the 108 jobs (6 × R, the ratio before, did in 56).
 */
export const START_RATIO = 5

/**
 * The ceiling of the runner's budget: a one-Ticket start that got slower must not raise the budget
 * with it. The slowest Auberge-sized start the runner measured is 4853 ms (3717–4853 ms over the
 * runs of 2026-10-28); 4853 × 1.5 = 7280, rounded up to 7.3 s. The margin of 1.5 holds the runner's
 * spread between runs: its Auberge-sized start ranged from 1736 to 4853 ms.
 */
export const RUNNER_START_CAP_MS = 7_300

/**
 * The budget for an Auberge-sized start, given the median one-Ticket start `referenceMs` on the
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
