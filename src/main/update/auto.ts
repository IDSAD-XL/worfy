// Which Update gets built (worfy-update ticket 03, ADR-0089 points 5 and 6; spec items 7 and 8).
//
// "Update automatically" (app-settings.json, `autoUpdate`, on by default) builds a new Available
// update by itself after the check that found it, unless it is quiet (the commit the user rolled
// back from). A build that failed on a SHA is not started again by itself: the next SHA is, or the
// same one when the user asks for it ("Check now", then `update.install`). Asked for, an Update is
// built even with "Update automatically" off (spec R5), and even quiet; one built already or
// building is not built again.
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
