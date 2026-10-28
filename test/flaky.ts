// Retries in CI and the report of the tests that passed only on a retry (ADR-0083, amendment of
// 2026-10-28).
//
// In CI a failed test runs once more: vitest's `retry` (vitest.config.ts) and Playwright's
// `retries` (playwright.config.ts) are CI_RETRIES. A flake of a runner would otherwise turn every
// PR red. Locally nothing retries: a test that fails on the developer's machine fails the run.
//
// A test that passed only on the retry is a flaky test, and it must stay visible: the reporters
// test/flaky-reporter.ts (vitest) and test/e2e/flaky-reporter.ts (Playwright) print one line per
// such test into the log of the run, in one form for both runners, at the start of the line:
// `FLAKY <runner> <file>:<line> > <test>`, so `grep '^FLAKY '` over a job log (after the time stamp
// GitHub puts in front) finds every one of them. The Playwright
// reporter also appends the lines to the summary page of the GitHub Actions job
// (GITHUB_STEP_SUMMARY); for vitest its own github-actions reporter, on in GitHub Actions, already
// writes a "Flaky Tests" section there. A flaky test still counts for the quarantine rules
// (test/quarantine.ts).
import { appendFileSync } from 'node:fs'

/** How many times CI runs a failed test again; `CI` is set on every GitHub Actions runner. */
export const CI_RETRIES = process.env.CI ? 1 : 0

export type FlakyRunner = 'vitest' | 'playwright'

export interface FlakyTest {
  /** The test file, from the root of the repository, with forward slashes. */
  file: string
  /** The line of the test's declaration; unknown only when the runner did not collect it. */
  line: number | undefined
  /** The names of the enclosing describe blocks and of the test, joined with " > ". */
  name: string
}

export const flakyLine = (runner: FlakyRunner, { file, line, name }: FlakyTest): string =>
  `FLAKY ${runner} ${file}${line === undefined ? '' : `:${line}`} > ${name}`

/**
 * Prints a FLAKY line for each test on stdout and, with `summaryFile` (GITHUB_STEP_SUMMARY in
 * GitHub Actions), appends the same lines under a heading to the job summary. No flaky test, no
 * output. The report is a help to whoever reads the run, so a summary that cannot be written does
 * not fail the run: a line on stderr says so.
 */
export function reportFlaky(runner: FlakyRunner, tests: readonly FlakyTest[], summaryFile?: string): void {
  if (tests.length === 0) return
  const lines = tests.map((test) => flakyLine(runner, test))
  process.stdout.write(`\n${lines.join('\n')}\n`)
  if (!summaryFile) return
  const summary = [`### Flaky tests (${runner})`, '', `${tests.length} passed only on the retry:`, '', '```', ...lines, '```', ''].join('\n')
  try {
    appendFileSync(summaryFile, `${summary}\n`)
  } catch (error) {
    process.stderr.write(`flaky report: the job summary ${summaryFile} was not written: ${(error as Error).message}\n`)
  }
}
