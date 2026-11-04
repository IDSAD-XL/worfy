// A vitest reporter (vitest.config.ts) that writes a failure record for every failed test into the
// file the Harness gate names in GATE_FAILURES_FILE: test/failure-records.ts says what a record holds
// and why. Without the variable it does nothing.
//
// Three kinds of record: a failed test; a test file that failed as a whole (an import that threw, an
// error in a hook outside every test) with `name: null`; and the errors of the run outside every file
// (vitest's unhandled errors) as one record with `file: null`.
//
// The rerun of a test is `node scripts/vitest-electron.mjs <file> -t ^<full name>$`, the full name
// escaped for a regular expression: vitest's -t is a regular expression without anchors, so the rerun
// of a test "a" would also run a test "a b" next to it. vitest matches it against the names of the
// describe blocks and the test joined with " > ", the same text as TestCase.fullName.
import type { Reporter, SerializedError, TestCase, TestModule } from 'vitest/node'
import { failureRecord, writeFailureRecords, type FailureRecord } from './failure-records'

type ErrorLike = Pick<SerializedError, 'message'> & { name?: string }

/** The script `pnpm test` runs, from the root of the repository. */
export const VITEST_SCRIPT = 'scripts/vitest-electron.mjs'

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The argv that runs one test of `file` (`name`), or the whole file when `name` is null. */
export function vitestRerun(file: string, name: string | null): string[] {
  return name === null ? ['node', VITEST_SCRIPT, file] : ['node', VITEST_SCRIPT, file, '-t', `^${escapeRegExp(name)}$`]
}

function errorText(errors: readonly ErrorLike[] | undefined): string {
  const error = errors?.[0]
  if (!error) return 'failed without an error'
  const message = String(error.message ?? '')
  const name = error.name ?? ''
  return name !== '' && name !== 'Error' && !message.startsWith(name) ? `${name}: ${message}` : message || name
}

function testRecord(file: string, test: TestCase): FailureRecord {
  const diagnostic = test.diagnostic()
  return failureRecord({
    runner: 'vitest',
    file,
    line: test.location?.line ?? null,
    name: test.fullName,
    ms: diagnostic?.duration ?? null,
    error: errorText(test.result().errors),
    attempt: (diagnostic?.retryCount ?? 0) + 1,
    rerun: vitestRerun(file, test.fullName),
  })
}

export function failureRecords(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<ErrorLike> = []): FailureRecord[] {
  const records = testModules.flatMap((module) => {
    const file = module.relativeModuleId.replaceAll('\\', '/')
    const failed = [...module.children.allTests()].filter((test) => test.result().state === 'failed').map((test) => testRecord(file, test))
    const errors = module.errors()
    if (errors.length === 0) return failed
    const whole = failureRecord({ runner: 'vitest', file, line: null, name: null, ms: null, error: errorText(errors), attempt: 1, rerun: vitestRerun(file, null) })
    return [whole, ...failed]
  })
  if (unhandledErrors.length > 0) {
    records.push(failureRecord({ runner: 'vitest', file: null, line: null, name: null, ms: null, error: errorText(unhandledErrors), attempt: 1, rerun: null }))
  }
  return records
}

export default class FailuresReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>): void {
    // Nothing is collected without the file: a run outside the gate pays nothing for this reporter.
    if (!process.env.GATE_FAILURES_FILE) return
    writeFailureRecords(failureRecords(testModules, unhandledErrors))
  }
}
