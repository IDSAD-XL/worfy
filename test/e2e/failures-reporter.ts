// A Playwright reporter (playwright.config.ts) that writes a failure record for every e2e test whose
// outcome is unexpected into the file the Harness gate names in GATE_FAILURES_FILE:
// test/failure-records.ts says what a record holds and why. Without the variable it does nothing.
//
// A flaky test (failed, then passed on the retry) and a skipped one give no record. `attempt` and
// `ms` are those of the last attempt. The rerun of a test is
// `node <Playwright's CLI> test <file>:<line>`, the CLI path from the root of the repository, so the
// argv needs no shell and is the same on macOS and Windows; a test tagged @packaged gets the flags of
// `pnpm test:package` (package.json) too, since it drives the packaged app, not out/.
import { createRequire } from 'node:module'
import { relative } from 'node:path'
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter'
import { failureRecord, writeFailureRecords, type FailureRecord } from '../failure-records'

/** Playwright's command line, as an absolute path. */
export const playwrightCli = (): string => createRequire(import.meta.url).resolve('@playwright/test/cli')

const PACKAGED_FLAGS = ['--output', 'test-results/package', '--grep', '@packaged', '--workers=1']

/** The describe blocks around the test and the test itself, outermost first. */
function testName(test: TestCase): string {
  const names = [test.title]
  for (let suite = test.parent; suite.type === 'describe'; suite = suite.parent!) names.unshift(suite.title)
  return names.join(' > ')
}

const slashes = (path: string): string => path.replaceAll('\\', '/')

export function failureRecords(root: Suite, cwd: string, cli = playwrightCli()): FailureRecord[] {
  return root
    .allTests()
    .filter((test) => test.outcome() === 'unexpected')
    .map((test) => {
      const file = slashes(relative(cwd, test.location.file))
      const last = test.results.at(-1)
      const error = last?.error?.message ?? last?.errors[0]?.message ?? `${last?.status ?? 'not run'}, expected ${test.expectedStatus}`
      const rerun = ['node', slashes(relative(cwd, cli)), 'test', `${file}:${test.location.line}`]
      if (test.tags.includes('@packaged')) rerun.push(...PACKAGED_FLAGS)
      return failureRecord({
        runner: 'playwright',
        file,
        line: test.location.line,
        name: testName(test),
        ms: last?.duration ?? null,
        error,
        attempt: (last?.retry ?? 0) + 1,
        rerun,
      })
    })
}

export default class FailuresReporter implements Reporter {
  private root: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite): void {
    this.root = suite
  }

  onEnd(): void {
    if (this.root && process.env.GATE_FAILURES_FILE) writeFailureRecords(failureRecords(this.root, process.cwd()))
  }

  printsToStdio(): boolean {
    return false
  }
}
