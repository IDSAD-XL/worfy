import type { HarnessStatus } from '../../../shared/ipc/harness'
import type { UpdateSnapshot } from '../../../shared/ipc/update'
import { codexPartOf, harnessPart } from '../../harness/harness-lines'
import { updateSignal, updateText } from '../../update/update-signal'

// The dot of the version chip (worfy-layout ticket 03; the spec's section on the version chip; owner's decision Q14):
// one dot for everything the popover offers to do, the worst first.
// - red: the Harness needs the user — "Harness unavailable", a Harness not installed or broken while this
//   run may install it (Install, Retry), or an old Harness to move ("Move old Harness…");
// - amber: an update waits — the Update of worfy where its chip had the dot (a quiet Available update has
//   none), a Harness to update ("Update Harness" with the accent), a Harness disabled in Claude Code
//   ("Enable", with the accent too: worfy-polish ticket 167), or a Codex line with a button or
//   "Codex: approve hooks";
// - none otherwise. "Replace Harness" (the same semver from another commit) is no signal, as its button
//   carries no accent; a dev run without `canInstall` offers no button, so no dot either.

export interface VersionDot {
  tone: 'red' | 'amber'
  /** What the dot is for, after the version in the chip's tooltip and name. */
  reason: string
}

/**
 * The dot for the Update snapshot, the Harness status (undefined until main answered, and while an install
 * runs), whether a move of the old Harness is offered, and the failure of the Harness's last call.
 */
export function versionDot(update: UpdateSnapshot | null, harness: HarnessStatus | undefined, migration: boolean, failure: string | undefined): VersionDot | null {
  if (failure !== undefined) return { tone: 'red', reason: 'Harness unavailable' }
  const harnessBehind = update?.enabled === true ? update.harnessBehind : null
  const part = harness === undefined ? undefined : harnessPart(harness, harnessBehind)
  if (harness !== undefined && part?.button != null && (harness.state.kind === 'not-installed' || harness.state.kind === 'error')) {
    return { tone: 'red', reason: `Harness needs ${part.button.label}` }
  }
  if (migration) return { tone: 'red', reason: 'old Harness to move' }
  if (updateSignal(update)?.dot === true) return { tone: 'amber', reason: updateText(update) ?? 'worfy update' }
  if (part?.button?.accent === true) return { tone: 'amber', reason: `Harness needs ${part.button.label}` }
  const codex = codexPartOf({ status: harness, busy: false, failure })
  if (codex !== null && harness !== undefined && ((codex.button !== undefined && harness.canInstall) || codex.state === 'hooks')) {
    return { tone: 'amber', reason: codex.state === 'hooks' ? codex.text : `Codex needs ${codex.button?.label ?? 'attention'}` }
  }
  return null
}
