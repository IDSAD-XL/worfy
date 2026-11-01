// The canonical form of a worktree path, the one every reader of Flight Recorder hands over in
// `WorkFact.worktree` and `LostFact.worktree` (the rule is in src/shared/flight-recorder/facts.ts):
// the span model compares worktrees as strings, so a gate run (reader 16, gate-logs.ts) lands on the
// Ticket of an agent (reader 14, transcripts) only when both readers call this one helper.
import { realpath } from 'node:fs'
import { promisify } from 'node:util'
import { comparablePath } from '../../shared/flight-recorder/from-gate'

const realpathNative = promisify(realpath.native)

export interface CanonicalOptions {
  /** `process.platform` by default; `win32` checks the Windows rules on any system. */
  platform?: string
  /** realpath(3) by default. */
  realpath?: (path: string) => Promise<string>
}

/**
 * A worktree path in the form the model compares: realpath(3) (`realpath.native`: on Windows it
 * expands an 8.3 short name like `RUNNER~1` and gives the on-disk case of the drive letter), then
 * `comparablePath` (on Windows `/` for `\`, lower case, no `\\?\` prefix; everywhere no trailing
 * separator). A path realpath cannot resolve (the worktree is gone) keeps its spelling, folded the same way.
 */
export async function canonicalWorktree(path: string, options: CanonicalOptions = {}): Promise<string> {
  const resolve = options.realpath ?? ((target: string) => realpathNative(target))
  let real = path
  try {
    real = await resolve(path)
  } catch {
    // A worktree that is gone keeps the spelling it was written with.
  }
  return comparablePath(real, options.platform ?? process.platform)
}
