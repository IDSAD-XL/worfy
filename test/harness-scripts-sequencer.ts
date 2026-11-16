// The order vitest starts the test files of a run in (vitest.config.ts, sequence.sequencer): its own
// order, with the files that run the Harness shell tests (HARNESS_SCRIPTS_FILES) moved to the front,
// file 1 first. vitest orders the files by the duration its results cache holds, but only when the
// cache knows both files it compares; for any other pair it puts the larger file first. A fresh
// worktree and every CI checkout have no cache, and a harness-scripts file is three lines, so the four
// files started last of the project contract, at second 107 of a 405 s run on the owner's Mac
// (docs/research/2026-11-16-fake-timers.md), and file 1 ran on to its end (worfy-polish 120). They are
// the longest files of a run, so they start first and the short files fill the other workers around them.
import { relative, sep } from 'node:path'
import { BaseSequencer, type TestSpecification } from 'vitest/node'
import { HARNESS_SCRIPTS_FILES } from './harness-shell-tests'

/** vitest's BaseSequencer, with the HARNESS_SCRIPTS_FILES in the run first, in their own order. */
export class HarnessScriptsFirst extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files)
    const at = (spec: TestSpecification): number => HARNESS_SCRIPTS_FILES.indexOf(relative(this.ctx.config.root, spec.moduleId).split(sep).join('/'))
    return [...sorted.filter((spec) => at(spec) >= 0).sort((a, b) => at(a) - at(b)), ...sorted.filter((spec) => at(spec) < 0)]
  }
}

/**
 * The sequencer for a run started with `argv`: none (vitest's own) when the run shuffles, HarnessScriptsFirst
 * otherwise. vitest picks its RandomSequencer for --sequence.shuffle only when the config sets no
 * sequencer, and prints the seed only with it; linux-tests runs its shards with --sequence.shuffle.files
 * and repeats an order by that seed (.github/workflows/ci.yml). Those shards leave the harness-scripts
 * files out anyway.
 */
export function sequencerFor(argv: readonly string[]): typeof BaseSequencer | undefined {
  return argv.some((arg) => arg.startsWith('--sequence.shuffle')) ? undefined : HarnessScriptsFirst
}
