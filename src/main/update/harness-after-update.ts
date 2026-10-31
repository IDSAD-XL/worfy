// The Harness of the new copy at the first start after an Update or a roll back (worfy-update
// ticket 05; spec R5, R8; ADR-0089 point 5). The press of "Restart now" or "Roll back" was the
// consent to the Harness of that copy too, so it is installed without a second dialog; "Update
// Harness" in the toolbar stays for every other case. Claude Code takes the new Harness from the next
// Session on.
//
// `update/restart.json` (src/main/update/restart.ts) says that the last run ended in such a restart
// and which copy it went to. The start reads it after settleLastRestart and takes it: the file is
// removed before anything is installed, so an install that fails, or a worfy that ends during it, is
// never tried again without a press. When the copy that runs is not the one the file names (the swap
// or the roll back did not happen) nothing is installed.
//
// Nothing here imports electron: src/main/index.ts gives it the app's installer, and its tests a
// sandboxed one.
import { existsSync } from 'node:fs'
import type { HarnessInstaller } from '../harness/install'
import { readJsonFile } from '../storage/json-file'
import { removeFile } from '../storage/remove'
import { restartFile, restartRecordSchema, type RestartRecord } from './restart'
import { changeUpdateState } from './state'

/**
 * What the start did: no restart.json (`none`), one for another copy (`other-copy`), the Harness of
 * this copy there already or in a state an install does not mend (`current`), installed, or failed.
 */
export type AfterUpdateOutcome = 'none' | 'other-copy' | 'current' | 'installed' | 'failed'

export interface AfterUpdateOptions {
  /** `<dataRoot>/update`, where restart.json lies. */
  dir: string
  stateFile: string
  /** The build version of the Harness this copy carries (bundledHarnessVersion). */
  bundled: string | undefined
  installer: Pick<HarnessInstaller, 'status' | 'install'>
  /** Hears a change of the Update state (the snapshot goes to every window). */
  onChange?: () => void
}

/** The commit of a build version, `abc1234` of `0.3.0+abc1234[.dirty]`. */
const commitOf = (version: string): string | undefined => /\+([0-9a-f]{7,})/u.exec(version)?.[1]

/**
 * Whether restart.json names the copy whose Harness is `bundled`: by its version, or by the commit
 * of the build version. The commit counts as well because a roll back names the previous copy by its
 * short SHA when no record of it is left (previousCopy in restart.ts).
 */
export function isRestartCopy(record: RestartRecord, bundled: string | undefined): boolean {
  if (bundled === undefined) return false
  if (record.version === bundled) return true
  const commit = commitOf(bundled)
  const sha = record.sha.toLowerCase()
  return commit !== undefined && sha !== '' && (sha.startsWith(commit) || commit.startsWith(sha))
}

/**
 * Takes restart.json: reads it and removes it, once. Undefined when there is none, when it does not
 * read (readJsonFile sets such a file aside), or when it could not be removed: an install kept on
 * every start without a press would be worse than one missed.
 */
function takeRecord(dir: string): RestartRecord | undefined {
  const file = restartFile(dir)
  if (!existsSync(file)) return undefined
  let record: RestartRecord | undefined
  try {
    record = readJsonFile(file, restartRecordSchema)
  } catch (error) {
    console.warn(`[update] ${file} could not be read`, error)
  }
  try {
    removeFile(file)
  } catch (error) {
    console.warn(`[update] ${file} could not be removed, so the Harness of the new copy is not installed by it`, error)
    return undefined
  }
  return record
}

/**
 * At the start, after the result of the last restart is settled: installs the Harness of this copy
 * when restart.json names it and the installed one is outdated or missing. A failure is the Harness
 * state `error`, as any install's (Health and the toolbar's Retry), and `harnessAfterUpdate: 'failed'`
 * in the Update state for the toast. Never rejects.
 */
export async function installHarnessAfterUpdate({ dir, stateFile, bundled, installer, onChange }: AfterUpdateOptions): Promise<AfterUpdateOutcome> {
  const record = takeRecord(dir)
  if (record === undefined) return 'none'
  if (!isRestartCopy(record, bundled)) return 'other-copy'

  let outcome: AfterUpdateOutcome
  try {
    const before = await installer.status()
    if (before.state.kind !== 'outdated' && before.state.kind !== 'not-installed') return 'current'
    // No dialog: the press of the restart was the consent (spec R5).
    const result = await installer.install(() => Promise.resolve(true))
    outcome = result.status.state.kind === 'error' ? 'failed' : 'installed'
    if (outcome === 'failed') console.warn(`[update] the Harness of ${record.version} was not installed after the ${record.action}`, result.status.state)
  } catch (error) {
    console.warn(`[update] the Harness of ${record.version} was not installed after the ${record.action}`, error)
    outcome = 'failed'
  }
  try {
    changeUpdateState((state) => ({ ...state, harnessAfterUpdate: outcome === 'failed' ? 'failed' : null }), stateFile)
  } catch (error) {
    console.error(`[update] how the Harness install after the ${record.action} ended could not be written`, error)
  }
  try {
    onChange?.()
  } catch (error) {
    console.error('[update] the change of the state could not be sent', error)
  }
  return outcome
}
