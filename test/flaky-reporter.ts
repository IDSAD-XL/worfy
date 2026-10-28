// A vitest reporter (vitest.config.ts) that prints a FLAKY line for every test that failed and
// then passed on a retry: test/flaky.ts says when CI retries and why the lines are printed.
//
// The GitHub job summary is not written here: vitest's own github-actions reporter, among the
// default reporters in GitHub Actions, already appends a "Flaky Tests" section to it. A run that
// names its own reporters on the command line (`--reporter=dot`) replaces both. The line of a test
// comes from vitest's `includeTaskLocation`, which vitest.config.ts turns on.
import type { Reporter, TestModule } from 'vitest/node'
import { reportFlaky, type FlakyTest } from './flaky'

export function flakyTests(testModules: ReadonlyArray<TestModule>): FlakyTest[] {
  return testModules.flatMap((module) =>
    [...module.children.allTests()]
      .filter((test) => test.diagnostic()?.flaky === true)
      .map((test) => ({ file: module.relativeModuleId.replaceAll('\\', '/'), line: test.location?.line, name: test.fullName })),
  )
}

export default class FlakyReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    reportFlaky('vitest', flakyTests(testModules))
  }
}
