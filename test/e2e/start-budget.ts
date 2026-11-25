// The time an Auberge-sized Project may take to become interactive, in the start test of
// test/e2e/epic-frame.spec.ts. A pure function, so test/unit/e2e-start-budget.test.ts checks it
// without a window.

/** The budget everywhere but on GitHub Actions: the start holds it on the owner's Mac (564 ms measured). */
export const START_MS = 3_000

/**
 * On the GitHub macOS runner every Project starts several times slower than on the owner's Mac, so
 * there the budget is this many times the runner's own start of a one-Ticket Project in the same
 * test (the median of three starts). Measured on the runner 2026-10-28, an Auberge-sized start
 * against a one-Ticket one: 3897 against 1274 ms (3.1×) and 3911 against 909 ms (4.3×) from single
 * starts; 2739 against a median of 721 ms (3.8×) and 1736 against 565 ms (3.07×) from three. 6 is
 * the highest 4.3 with a margin of 1.4. The first attempts of 84 macos-e2e jobs, 2026-11-22..25
 * (worfy-polish 150), measured 1.83 to 5.19 times, median 3.56: every one of them, the four red
 * against the former 7300 ms ceiling too, is inside 6.
 *
 * There is no ceiling in ms any more (worfy-polish 151): in 58 of those 84 jobs 6 × the reference
 * was above the former 7300 ms, so the runner's speed, not the Project against its base, set the
 * budget, and a slow runner turned the test red. The cost: a delay added to every start alike
 * raises the reference with it and is caught only by START_MS, off GitHub Actions.
 */
export const START_RATIO = 6

/**
 * The budget for an Auberge-sized start, given the median one-Ticket start `referenceMs` on the
 * same machine: START_MS, except on GitHub Actions (GITHUB_ACTIONS=true), where it is START_RATIO
 * times the reference, no less than START_MS.
 */
export function startBudget(referenceMs: number, env: Readonly<Record<string, string | undefined>>): number {
  if (env.GITHUB_ACTIONS !== 'true') return START_MS
  return Math.max(START_MS, START_RATIO * referenceMs)
}

/** Whether the start test measures the one-Ticket reference: only where the budget depends on it. */
export function measuresReference(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.GITHUB_ACTIONS === 'true'
}
