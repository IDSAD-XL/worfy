// The failure records of a test run, for the Harness gate (Epic worfy-failures, ticket 03).
//
// The gate gives each script it runs the variable GATE_FAILURES_FILE: the path of a temporary file
// (harness/hooks/gate-failures.mjs, its header, says what the gate does with it). The reporters
// test/failures-reporter.ts (vitest) and test/e2e/failures-reporter.ts (Playwright) append one line of
// JSON to it for every failed test: the runner, the file and line of the test, its name, how long it
// took, the first line of its error, the attempt and the argv that runs this test alone. After the
// script the gate reads the lines, adds the step, scrubs every text of personal data itself (the
// reporters do not look for it) and keeps them in the run file of a red run.
//
// Without GATE_FAILURES_FILE (CI, a `pnpm test` by hand) nothing is written and nothing is printed.
// The records are a help to whoever reads a red run later, so a file that cannot be written does not
// fail the run: one line on stderr says so, as reportFlaky (test/flaky.ts) does for the job summary.
import { appendFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'

export type FailureRunner = 'vitest' | 'playwright'

/** The longest `error` the gate keeps (ERROR_CHARS of harness/hooks/gate-failures.mjs). */
export const ERROR_CHARS = 200

export interface FailureRecord {
  runner: FailureRunner
  /** The test file from the root of the repository with "/"; null for an error outside every file. */
  file: string | null
  /** The line of the test's declaration, or null. */
  line: number | null
  /** The describe blocks and the test joined with " > "; null for a file that failed as a whole. */
  name: string | null
  /** `<runner> <file> > <name>`, the id the gate compares runs by; null without a file or a name. */
  test: string | null
  /** How long the (last attempt of the) test took, in whole milliseconds, or null. */
  ms: number | null
  /** The first line of the error, without ANSI sequences, at most ERROR_CHARS characters. */
  error: string
  /** 1 and up; above 1 only where the run retries (CI, test/flaky.ts). */
  attempt: number
  /** The argv that runs this test alone from the root of the repository, "node" first; or null. */
  rerun: string[] | null
}

/** The first line of `text` that holds anything, without ANSI sequences, cut to ERROR_CHARS ("…" last). */
export function firstErrorLine(text: string): string {
  const line = (stripVTControlCharacters(text).split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? '').trim()
  const chars = [...line]
  return chars.length <= ERROR_CHARS ? line : `${chars.slice(0, ERROR_CHARS - 1).join('')}…`
}

/** A record of one failure; the test id follows from the runner, the file and the name. */
export function failureRecord(fields: Omit<FailureRecord, 'test' | 'error'> & { error: string }): FailureRecord {
  const { runner, file, line, name, ms, error, attempt, rerun } = fields
  return {
    runner,
    file,
    line,
    name,
    test: file !== null && name !== null ? `${runner} ${file} > ${name}` : null,
    ms: ms === null ? null : Math.max(0, Math.round(ms)),
    error: firstErrorLine(error),
    attempt,
    rerun,
  }
}

/**
 * Appends one JSON line per record to `file` (process.env.GATE_FAILURES_FILE by default). No file,
 * or no record: nothing happens. A failed write is one line on stderr, never an exception.
 */
export function writeFailureRecords(records: readonly FailureRecord[], file = process.env.GATE_FAILURES_FILE): void {
  if (!file || records.length === 0) return
  try {
    appendFileSync(file, records.map((record) => `${JSON.stringify(record)}\n`).join(''))
  } catch (error) {
    process.stderr.write(`failure records: ${file} was not written: ${(error as Error).message}\n`)
  }
}
