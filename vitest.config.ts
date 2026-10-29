import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { CI_RETRIES } from './test/flaky'
import { removeStaleProbes, removeStaleTempFolders } from './test/stale-leftovers'
import { ms } from './test/time-scale'

// Worktrees of other tickets live under .claude/worktrees/ inside this checkout;
// their tests must never be picked up by a run here.
// WORFY_TEST_EXCLUDE: files a Windows CI shard leaves out because a job of its own runs them
// (.github/workflows/windows-tests.yml), paths from the repository root separated by spaces. vitest
// 5.0.3's --exclude does not reach the projects below, which extend this config. Unset elsewhere.
const ciExclude = (process.env.WORFY_TEST_EXCLUDE ?? '').split(/\s+/).filter(Boolean)
const exclude = [...configDefaults.exclude, '.claude/worktrees/**', 'out/**', 'test/e2e/**', 'test/acceptance/**', ...ciExclude]

// What a killed test run leaves behind — probe files of an older version in src/, and the folders
// of a run in the system temporary folder — is removed before each run (test/stale-leftovers.ts).
// The removal goes through the removal of the application: a folder in the temporary folder may
// hold a junction, and under the Node of Electron on Windows fs.rmSync with `recursive` empties the
// folder behind it (worfy-windows ticket 51).
removeStaleProbes(join(import.meta.dirname, 'src'))
// realpath(3), as Vite spells the files it checks against server.fs.allow: the JavaScript realpath
// keeps an 8.3 short name (C:\Users\RUNNER~1 on the GitHub Windows runner).
const tempDir = realpathSync.native(tmpdir())
removeStaleTempFolders(tempDir, Date.now())

// Every time limit below is times the run's multiplier, one value on every machine: see test/time-scale.ts.

export default defineConfig({
  server: {
    fs: {
      // test/unit/glob-probe.tsx builds its copies of src/ modules under the system temp directory;
      // Vite refuses to load files outside the allowed directories.
      allow: [searchForWorkspaceRoot(process.cwd()), tempDir],
    },
  },
  test: {
    exclude,
    // vitest's own reporters as they were (minimal under an agent, default otherwise, github-actions
    // in GitHub Actions), and test-results/vitest-timings.json with the time of each test file
    // (test/timings-reporter.ts; read by scripts/test-timings.mjs). test-results/ is not in git.
    // test/flaky-reporter.ts prints a FLAKY line for each test that passed only on the retry.
    reporters: [...configDefaults.reporters, './test/timings-reporter.ts', './test/flaky-reporter.ts'],
    // A failed test runs once more in CI, never locally (test/flaky.ts). The time limits below are
    // per attempt: a test that runs into its limit and is retried takes twice its limit.
    retry: CI_RETRIES,
    // The FLAKY line names the line of the test's declaration (test/flaky.ts); vitest collects it only
    // with this option, at the cost of one stack trace per declared test.
    includeTaskLocation: true,
    testTimeout: ms(5_000),
    hookTimeout: ms(10_000),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'contract',
          environment: 'node',
          include: ['test/contract/**/*.test.ts'],
          // Contract tests start real processes (bash, git, node, the Harness scripts). Alone one
          // takes about a second; in a full run on a loaded Mac they reach 4–5 s, past vitest's
          // 5 s default, and fail on time alone. A test that really hangs still fails at 15 s times the multiplier.
          testTimeout: ms(15_000),
          // How many concurrent tests of one file run at once: the shell tests of the Harness
          // (test/contract/harness-scripts.test.ts) are the only ones. Five keeps that file near
          // 100 s on the Mac; more would load the machine further in a full run, where
          // wave-gate.test.sh has already hit its 120 s limit once (docs/lessons/testing.md).
          // Five is also vitest 5.0.3's default; it is set here on purpose, so a new default in a
          // vitest update does not change the load on the Mac unnoticed.
          maxConcurrency: 5,
          // Every test file gets a new empty WORFY_CLAUDE_HOME unless the run set one, so no contract
          // test reads the ~/.claude of the machine it runs on; the homes lie in one folder per run,
          // removed at its end. On Windows one Git Bash runs for the whole run, so /tmp of every Git
          // Bash a test starts is the system temp folder (test/global-setup-git-bash.ts).
          globalSetup: ['test/global-setup-contract.ts', 'test/global-setup-git-bash.ts'],
          setupFiles: ['test/setup-contract.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['test/unit/**/*.test.tsx', 'test/contract/**/*.test.tsx'],
          setupFiles: ['test/setup-dom.ts'],
        },
      },
    ],
  },
})
