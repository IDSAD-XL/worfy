// What a killed test run leaves behind, removed when vitest.config.ts loads. It lies here, not in
// the config, so that a test runs the same removal on a folder of its own instead of the system
// temporary folder (worfy-windows ticket 51).
//
// Removal goes through removeTree of src/main/storage/remove.ts, the removal of the application. A
// folder found in the temporary folder is anyone's: a run of another checkout, another version of
// the code, or a folder made up to look like one. What lies in it is not looked at, and under the
// Node of Electron on Windows fs.rmSync with `recursive` goes through a junction in it and empties
// the folder behind it (ticket 23). removeTree removes a link as a link.
//
// removeTree is imported from its module, not through removeTestTree of test/remove.ts: that file
// also loads the Layout store, and Vite would make every module behind it a file of the config —
// an edit there would restart vitest in watch mode. The module itself imports node:fs and node:path
// alone.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { removeTree } from '../src/main/storage/remove'

/**
 * Discovery tests no longer write probe files into src/ (ADR-0036). A run of an older version that
 * was killed mid-test could still have left one behind, and Vite would then find it in a glob, so
 * every run starts by deleting src/**\/ZzVitestProbe*.
 */
export function removeStaleProbes(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) removeStaleProbes(path)
    else if (entry.name.startsWith('ZzVitestProbe')) removeTree(path)
  }
}

/**
 * The folders test runs make in the temporary folder: test/unit/glob-probe.tsx builds its copies of
 * src/ modules in worfy-glob-probe-*, test/global-setup-contract.ts makes the folder of a run's
 * Claude homes, worfy-contract-claude-homes-*, and test/contract/harness-evals.test.ts makes the
 * folders of its stand-in claude in worfy-eval-stub-* (one holds a copy of Git's sh.exe, about 22 MB).
 */
export const STALE_PREFIXES = ['worfy-glob-probe-', 'worfy-contract-claude-homes-', 'worfy-eval-stub-'] as const

/** How old a folder of a run is when no run still uses it: a whole run takes minutes. */
export const STALE_AFTER_MS = 60 * 60 * 1000

/**
 * Removes the folders of `tempDir` that a run made and that are older than `staleAfterMs` at `now`;
 * a killed run leaves them behind. Younger ones may belong to a run in another checkout and stay.
 */
export function removeStaleTempFolders(tempDir: string, now: number, staleAfterMs = STALE_AFTER_MS): void {
  for (const name of readdirSync(tempDir)) {
    if (!STALE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
    const path = join(tempDir, name)
    try {
      if (now - statSync(path).mtimeMs > staleAfterMs) removeTree(path)
    } catch {
      // Deleted meanwhile by another run's cleanup, or held by a process now. On Windows what could go
      // is gone, and the folder's mtime is now: a run an hour later tries again.
    }
  }
}
