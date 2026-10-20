// The spelling of a folder that the projects code compares: one helper for store.ts, connect.ts
// and the Project of a Session's cwd (mcp/canvas-server.ts).

import { realpathSync } from 'node:fs'

/**
 * The folder's own spelling, for comparing a typed path with git's root. The native realpath, like git,
 * gives the long name of a short 8.3 one, the target of a `subst` drive and the letter case on disk;
 * fs.realpathSync keeps all three as typed. The plain realpath is the fallback for a drive the native
 * call cannot read (a RAM disk, some network or virtual drives), so such a drive compares as it did
 * before; a path neither can read stays as given.
 */
export function realpathOrSelf(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
}
