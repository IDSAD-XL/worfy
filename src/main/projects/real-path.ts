// The spelling of a folder that worfy compares: one helper for the projects code (store.ts,
// connect.ts), the Project of a Session's cwd (mcp/canvas-server.ts) and the checks of the Harness
// move (harness/migrate/apply.ts).

import { realpathSync } from 'node:fs'

/**
 * The folder's own spelling, for comparing a typed path with git's root. The native realpath, like git,
 * gives the long name of a short 8.3 one, the target of a `subst` drive and the letter case on disk;
 * fs.realpathSync keeps all three as typed. The plain realpath is the fallback for a drive the native
 * call cannot read (a RAM disk, some network or virtual drives), so such a drive compares as it did
 * before. Throws when neither can read the path.
 */
export function realpathOnDisk(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return realpathSync(path)
  }
}

/** realpathOnDisk, or the path as given when neither realpath can read it. */
export function realpathOrSelf(path: string): string {
  try {
    return realpathOnDisk(path)
  } catch {
    return path
  }
}
