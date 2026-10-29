// The shell tests of the Harness (harness/{bin,hooks}/tests/*.test.sh), the test file of a run that
// runs each, and the part of them one Windows CI job runs. The test files HARNESS_SCRIPTS_FILES run
// them (test/harness-scripts-suite.ts), each its share (inFile), so vitest runs the shares on workers
// of their own. On Windows the shell tests took 354-617 s as one file, so CI runs those files in jobs
// of their own, each job with a part of the shell tests (.github/workflows/windows-tests.yml,
// HARNESS_SCRIPTS_PART). test/contract/ci-workflow.test.ts checks with the same functions that every
// shell test runs in exactly one of those jobs.
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

/** The test files that run the shell tests: file n (from 1) is at index n - 1 and calls harnessScripts(n). */
export const HARNESS_SCRIPTS_FILES = [1, 2, 3, 4].map((n) => `test/contract/harness-scripts-${n}.test.ts`)

/** Seconds a shell test took, by name as shellTests() spells it. */
export type Seconds = Readonly<Record<string, number>>

/** The seconds of a shell test that `measured` does not name: a new one, or one skipped where it was measured. */
export const UNMEASURED_SECONDS = 20

/**
 * Seconds each shell test took, five at a time in one file: `windows` on the GitHub Windows runner (CI run
 * 40927995527 of 2026-10-29, jobs `harness-scripts 1/2` and `2/2`; qmd.test.sh is skipped there), `other`
 * on the owner's Mac in a whole `pnpm test --maxWorkers=9` (2026-10-29), used on macOS and Linux. They
 * split the shell tests across HARNESS_SCRIPTS_FILES (inFile) and set the order they start in (startOrder).
 * shortcut: a measured snapshot, redo it when the harness-scripts files of a full run end further apart than the longest shell test takes.
 * It does not follow a shell test that grows slower, and a new one counts UNMEASURED_SECONDS.
 */
export const MEASURED_SECONDS: { windows: Seconds; other: Seconds } = {
  windows: {
    'bin/tests/land.test.sh': 123,
    'bin/tests/wave-gate-lock.test.sh': 104,
    'bin/tests/wave-gate.test.sh': 101,
    'hooks/tests/guard-silent.test.sh': 91,
    'bin/tests/silent-mode.test.sh': 87,
    'bin/tests/preflight.test.sh': 79,
    'bin/tests/profile-schema2.test.sh': 78,
    'bin/tests/wave-gate-merge.test.sh': 74,
    'bin/tests/project-connect.test.sh': 62,
    'bin/tests/profile-attribution.test.sh': 61,
    'bin/tests/profile-user.test.sh': 54,
    'bin/tests/skill-blocks-gate.test.sh': 54,
    'bin/tests/epic-wave-ship-ticket.test.sh': 48,
    'bin/tests/harness-home.test.sh': 44,
    'bin/tests/wave-gate-heartbeat.test.sh': 42,
    'bin/tests/plugin-neutral.test.sh': 40,
    'bin/tests/wave-brief.test.sh': 39,
    'bin/tests/profile-set.test.sh': 38,
    'bin/tests/eval-env.test.sh': 34,
    'hooks/tests/gate-verdict.test.sh': 32,
    'bin/tests/skill-blocks.test.sh': 29,
    'hooks/tests/gate-file-size.test.sh': 26,
    'bin/tests/ticket-mark.test.sh': 21,
    'bin/tests/start-context.test.sh': 19,
    'bin/tests/agents-text.test.sh': 18,
    'hooks/tests/gate-verdict-inside.test.sh': 17,
    'bin/tests/decision-log.test.sh': 15,
    'hooks/tests/session-hooks.test.sh': 15,
    'bin/tests/profile.test.sh': 14,
    'bin/tests/tickets-root.test.sh': 14,
    'hooks/tests/gate-timings.test.sh': 14,
    'hooks/tests/rules-hooks.test.sh': 14,
    'bin/tests/epic-status.test.sh': 13,
    'bin/tests/ticket-header.test.sh': 13,
    'hooks/tests/gate-log.test.sh': 13,
    'hooks/tests/gate-notverified.test.sh': 12,
    'hooks/tests/gate-scope.test.sh': 12,
    'bin/tests/gate-queue.test.sh': 9,
    'bin/tests/wave-gate-screen.test.sh': 9,
    'hooks/tests/gh-token-env.test.sh': 9,
    'bin/tests/gh-override.test.sh': 8,
    'bin/tests/review-depth.test.sh': 8,
    'hooks/tests/gate-shim.test.sh': 7,
    'hooks/tests/gate-verdict-signals.test.sh': 7,
    'bin/tests/qmd-collections.test.sh': 6,
    'bin/tests/wave-gate-lock-killed.test.sh': 5,
    'hooks/tests/gate-args.test.sh': 5,
    'bin/tests/max-review.test.sh': 4,
    'bin/tests/real-home.test.sh': 4,
    'hooks/tests/gate-unregistered.test.sh': 4,
    'bin/tests/gh-stand-in.test.sh': 3,
    'bin/tests/shortcut-ledger.test.sh': 3,
    'bin/tests/skills-allowed.test.sh': 3,
    'bin/tests/skill-positional-tokens.test.sh': 1,
  },
  other: {
    'bin/tests/wave-gate.test.sh': 59,
    'bin/tests/silent-mode.test.sh': 55,
    'bin/tests/wave-gate-lock.test.sh': 54,
    'bin/tests/preflight.test.sh': 53,
    'hooks/tests/guard-silent.test.sh': 50,
    'bin/tests/land.test.sh': 38,
    'bin/tests/qmd-collections.test.sh': 32,
    'bin/tests/profile-set.test.sh': 31,
    'bin/tests/wave-gate-merge.test.sh': 31,
    'hooks/tests/gate-verdict-signals.test.sh': 29,
    'bin/tests/wave-gate-screen.test.sh': 27,
    'bin/tests/project-connect.test.sh': 25,
    'bin/tests/wave-gate-heartbeat.test.sh': 23,
    'bin/tests/harness-home.test.sh': 22,
    'bin/tests/skill-blocks-gate.test.sh': 21,
    'hooks/tests/gate-shim.test.sh': 21,
    'bin/tests/epic-wave-ship-ticket.test.sh': 20,
    'bin/tests/profile-user.test.sh': 19,
    'bin/tests/wave-brief.test.sh': 18,
    'bin/tests/eval-env.test.sh': 16,
    'bin/tests/profile-schema2.test.sh': 16,
    'bin/tests/profile-attribution.test.sh': 14,
    'bin/tests/skill-blocks.test.sh': 14,
    'hooks/tests/gate-verdict.test.sh': 12,
    'bin/tests/plugin-neutral.test.sh': 11,
    'hooks/tests/gate-file-size.test.sh': 11,
    'bin/tests/ticket-mark.test.sh': 10,
    'hooks/tests/gate-scope.test.sh': 8,
    'hooks/tests/gate-verdict-inside.test.sh': 8,
    'bin/tests/profile.test.sh': 7,
    'bin/tests/qmd.test.sh': 7,
    'bin/tests/tickets-root.test.sh': 7,
    'bin/tests/decision-log.test.sh': 6,
    'bin/tests/epic-status.test.sh': 6,
    'bin/tests/start-context.test.sh': 6,
    'bin/tests/gh-override.test.sh': 5,
    'hooks/tests/gate-log.test.sh': 5,
    'hooks/tests/gate-timings.test.sh': 5,
    'hooks/tests/session-hooks.test.sh': 5,
    'bin/tests/agents-text.test.sh': 4,
    'bin/tests/wave-gate-lock-killed.test.sh': 4,
    'hooks/tests/gate-notverified.test.sh': 4,
    'hooks/tests/rules-hooks.test.sh': 4,
    'bin/tests/review-depth.test.sh': 3,
    'bin/tests/ticket-header.test.sh': 3,
    'bin/tests/gate-queue.test.sh': 2,
    'bin/tests/shortcut-ledger.test.sh': 2,
    'hooks/tests/gate-args.test.sh': 2,
    'hooks/tests/gh-token-env.test.sh': 2,
    'bin/tests/gh-stand-in.test.sh': 1,
    'bin/tests/max-review.test.sh': 1,
    'bin/tests/real-home.test.sh': 1,
    'bin/tests/skill-positional-tokens.test.sh': 1,
    'bin/tests/skills-allowed.test.sh': 1,
    'hooks/tests/gate-unregistered.test.sh': 1,
  },
}

const secondsOf = (measured: Seconds, name: string): number => measured[name] ?? UNMEASURED_SECONDS

/** The names in the order they start: the longest by `measured` first, so the last ones to finish are short; equal seconds by name. */
export function startOrder(names: readonly string[], measured: Seconds): string[] {
  return [...names].sort((a, b) => secondsOf(measured, b) - secondsOf(measured, a) || (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The names test file `index` of `count` (both from 1) runs, split by measured seconds, not by count:
 * in start order each name goes to the file with the fewest seconds so far, the lowest index on a tie
 * (longest processing time first). Every name is in exactly one of the files 1/count … count/count.
 */
export function inFile(names: readonly string[], index: number, count: number, measured: Seconds): string[] {
  const load = Array.from({ length: count }, () => 0)
  const share: string[] = []
  for (const name of startOrder(names, measured)) {
    const least = load.indexOf(Math.min(...load))
    load[least] = (load[least] ?? 0) + secondsOf(measured, name)
    if (least === index - 1) share.push(name)
  }
  return share
}

/**
 * The shell tests test file `file` of `count` runs, in the order they start. With a part (a Windows CI
 * job, HARNESS_SCRIPTS_PART) file 1 runs the whole part, as the one file did before, and the other
 * files run none: the part already is the split of that job, and a second split across the files would
 * run five shell tests per file at once on a 4-CPU runner. Without a part, file n runs inFile(n).
 */
export function shareOf(names: readonly string[], file: number, count: number, part: Part | undefined, measured: Seconds): string[] {
  if (part) return file === 1 ? startOrder(inPart(names, part), measured) : []
  return startOrder(inFile(names, file, count, measured), measured)
}
