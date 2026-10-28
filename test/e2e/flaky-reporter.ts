// A Playwright reporter (playwright.config.ts) that prints a FLAKY line for every e2e test that
// failed and then passed on a retry, and appends the lines to the GitHub job summary
// (GITHUB_STEP_SUMMARY): test/flaky.ts says when CI retries and why. The list reporter names flaky
// tests in its own last lines too; this reporter gives them the same form as the vitest ones and
// puts them on the job's summary page, which no built-in Playwright reporter writes.
import { relative } from 'node:path'
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter'
import { reportFlaky, type FlakyTest } from '../flaky'

/** The describe blocks around the test and the test itself, outermost first. */
function testName(test: TestCase): string {
  const names = [test.title]
  for (let suite = test.parent; suite.type === 'describe'; suite = suite.parent!) names.unshift(suite.title)
  return names.join(' > ')
}

export function flakyTests(root: Suite, cwd: string): FlakyTest[] {
  return root
    .allTests()
    .filter((test) => test.outcome() === 'flaky')
    .map((test) => ({ file: relative(cwd, test.location.file).replaceAll('\\', '/'), name: testName(test) }))
}

export default class FlakyReporter implements Reporter {
  private root: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite): void {
    this.root = suite
  }

  onEnd(): void {
    if (this.root) reportFlaky('Playwright', flakyTests(this.root, process.cwd()), process.env.GITHUB_STEP_SUMMARY)
  }

  printsToStdio(): boolean {
    return false
  }
}
