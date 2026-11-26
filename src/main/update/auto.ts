// Which Update gets built (worfy-update ticket 03, ADR-0089 points 5 and 6; spec items 7 and 8).
//
// "Update automatically" (app-settings.json, `autoUpdate`, on by default) builds a new Available
// update by itself after the check that found it, unless it is quiet (the commit the user rolled
// back from). A build that failed on a SHA is not started again by itself: the next SHA is, or the
// same one when the user asks for it ("Check now", then `update.install`). Asked for, an Update is
// built even with "Update automatically" off (spec R5), and even quiet; one built already or
// building is not built again.
//
// By itself it builds a head only once main has been quiet for UPDATE_QUIET_MS (worfy-polish ticket
// 156): the service checks again when the head's commit is that old, and a newer head found then
// waits in its turn (src/main/ipc/update.ts).
import type { AvailableUpdate, UpdateState } from '../../shared/ipc/update'

type Build = Pick<UpdateState, 'available' | 'build'>

/** The Available update a check makes worfy build by itself, or null. */
export function autoBuildFor({ available, build }: Build, autoUpdate: boolean): AvailableUpdate | null {
  if (!autoUpdate || available === null || available.quiet) return null
  // Ready, building or failed on this SHA: once is enough.
  if (build.sha === available.sha && build.phase !== 'idle') return null
  return available
}

/** The Available update `update.install` builds, or null. */
export function installTarget({ available, build }: Build): AvailableUpdate | null {
  if (available === null) return null
  if (build.sha === available.sha && (build.phase === 'ready' || build.phase === 'building')) return null
  return available
}

/**
 * How long main must have been quiet before "Update automatically" builds its head (worfy-polish
 * ticket 156, issue #2252): a series of merges is built once, after the last of them, not once per
 * check. "Update worfy" builds at once.
 */
export const UPDATE_QUIET_MS = 20 * 60_000

/** UPDATE_QUIET_MS, or WORFY_UPDATE_QUIET_MINUTES when it is a whole number of minutes (0: no wait). */
export function updateQuietMs(env: Readonly<Record<string, string | undefined>>): number {
  const minutes = env.WORFY_UPDATE_QUIET_MINUTES ?? ''
  return /^\d+$/u.test(minutes) ? Number(minutes) * 60_000 : UPDATE_QUIET_MS
}

/**
 * How long "Update automatically" still waits before it builds `update`: what is left of `quietMs`
 * since its commit, 0 when the commit is older or its time is not known. A commit dated in the future
 * (the clocks of GitHub and of the machine differ) waits `quietMs` at most.
 */
export function quietWaitMs(update: AvailableUpdate, now: Date, quietMs: number): number {
  if (update.committedAt === undefined) return 0
  const age = now.getTime() - Date.parse(update.committedAt)
  return Math.min(quietMs, Math.max(0, quietMs - age))
}
