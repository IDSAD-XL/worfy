// The shell tests of the Harness (harness/{bin,hooks}/tests/*.test.sh) and the part of them one
// Windows CI job runs. test/contract/harness-scripts.test.ts runs them; on Windows that one file took
// 354-617 s, so CI runs it in jobs of its own, each with a part of the shell tests
// (.github/workflows/windows-tests.yml, HARNESS_SCRIPTS_PART). test/contract/ci-workflow.test.ts
// checks with the same functions that every shell test runs in exactly one of those jobs.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIRS = ['bin/tests', 'hooks/tests']

/** The shell test files under `harness`, as paths from it with forward slashes, sorted by name. */
export function shellTests(harness: string): string[] {
  return DIRS.flatMap((dir) =>
    existsSync(join(harness, dir))
      ? readdirSync(join(harness, dir))
          .filter((name) => name.endsWith('.test.sh'))
          .map((name) => `${dir}/${name}`)
      : [],
  ).sort()
}

/** Part `index` of `count`, both from 1. */
export type Part = { index: number; count: number }

/**
 * A part as CI spells it, `<index>/<count>` with 1 <= index <= count. Unset or empty is no part (every
 * shell test runs); anything else throws, so a misspelt part fails the run instead of running all or
 * none of the shell tests.
 */
export function parsePart(value: string | undefined): Part | undefined {
  if (value === undefined || value === '') return undefined
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value)
  const part = match ? { index: Number(match[1]), count: Number(match[2]) } : undefined
  if (!part || part.index > part.count) throw new Error(`HARNESS_SCRIPTS_PART must be <index>/<count>, 1 <= index <= count; got "${value}"`)
  return part
}

/**
 * The names of one part: sorted by name, the k-th name (from 0) goes to part k mod count + 1. Every
 * name is in exactly one of the parts 1/count … count/count. In the slow Windows run 40805903962 this
 * split the 52 shell tests into parts of 340 and 347 s at five at a time, with land.test.sh (306 s)
 * started first.
 */
export function inPart(names: readonly string[], part: Part): string[] {
  return [...names].sort().filter((_, at) => at % part.count === part.index - 1)
}
