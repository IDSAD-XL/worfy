import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { removeStaleProbes, removeStaleTempFolders } from './test/stale-leftovers'
import { timeScale } from './test/time-scale'

// Worktrees of other tickets live under .claude/worktrees/ inside this checkout;
// their tests must never be picked up by a run here.
const exclude = [...configDefaults.exclude, '.claude/worktrees/**', 'out/**', 'test/e2e/**', 'test/acceptance/**']

// What a killed test run leaves behind — probe files of an older version in src/, and the folders
// of a run in the system temporary folder — is removed before each run (test/stale-leftovers.ts).
// The removal goes through the removal of the application: a folder in the temporary folder may
// hold a junction, and under the Node of Electron on Windows fs.rmSync with `recursive` empties the
// folder behind it (worfy-windows ticket 51).
removeStaleProbes(join(import.meta.dirname, 'src'))
const tempDir = realpathSync(tmpdir())
removeStaleTempFolders(tempDir, Date.now())

// On Windows every time limit is three times the default: see test/time-scale.ts.

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
    testTimeout: 5_000 * timeScale,
    hookTimeout: 10_000 * timeScale,
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
          // 5 s default, and fail on time alone. A test that really hangs still fails at 15 s (45 s on Windows).
          testTimeout: 15_000 * timeScale,
          // Every test file gets a new empty WORFY_CLAUDE_HOME unless the run set one, so no contract
          // test reads the ~/.claude of the machine it runs on; the homes lie in one folder per run,
          // removed at its end.
          globalSetup: ['test/global-setup-contract.ts'],
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
