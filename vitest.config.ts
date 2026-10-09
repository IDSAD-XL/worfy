import { readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

// Worktrees of other tickets live under .claude/worktrees/ inside this checkout;
// their tests must never be picked up by a run here.
const exclude = [...configDefaults.exclude, '.claude/worktrees/**', 'out/**', 'test/e2e/**']

// Discovery tests no longer write probe files into src/ (ADR-0036). A run of an older version
// that was killed mid-test could still have left one behind, and Vite would then find it in a
// glob, so every run starts by deleting src/**/ZzVitestProbe*.
function removeStaleProbes(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) removeStaleProbes(path)
    else if (entry.name.startsWith('ZzVitestProbe')) rmSync(path, { force: true })
  }
}
removeStaleProbes(join(import.meta.dirname, 'src'))

// test/unit/glob-probe.tsx builds its copies of src/ modules in temporary directories named
// worfy-glob-probe-*, and a killed run leaves them behind. One older than an hour belongs to no
// run still going (a whole run takes minutes), so it is deleted; younger ones may belong to a
// run in another checkout and stay.
const tempDir = realpathSync(tmpdir())
for (const name of readdirSync(tempDir)) {
  if (!name.startsWith('worfy-glob-probe-')) continue
  const path = join(tempDir, name)
  try {
    if (Date.now() - statSync(path).mtimeMs > 60 * 60 * 1000) rmSync(path, { recursive: true, force: true })
  } catch {
    // Deleted meanwhile by another run's cleanup.
  }
}

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
          // 5 s default, and fail on time alone. A test that really hangs still fails at 15 s.
          testTimeout: 15_000,
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
