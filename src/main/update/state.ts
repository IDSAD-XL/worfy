// The state of Update (worfy-update epic): worfy's own file `<dataRoot>/update/state.json`
// (ADR-0005, ADR-0089 point 3), the folder the clone of ticket 03 shares. The schema is the whole
// epic's (src/shared/ipc/update.ts); ticket 01 writes the check, the later tickets their fields.
//
// The file goes through src/main/storage/json-file.ts: the write is atomic, and a file that does not
// read is set aside as `state.json.unreadable-<time>` and the state starts empty. Each change is one
// synchronous read-modify-write, so two writers in this process never drop each other's field.
import { join } from 'node:path'
import { updateStateSchema, type UpdateState } from '../../shared/ipc/update'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { dataRoot } from '../storage/paths'

/** The folder of Update in worfy's data folder. */
export function updateDir(root: string = dataRoot()): string {
  return join(root, 'update')
}

export function updateStateFile(root: string = dataRoot()): string {
  return join(updateDir(root), 'state.json')
}

/** The state of a new install: nothing checked, built or rolled back. */
export function emptyUpdateState(): UpdateState {
  return updateStateSchema.parse({})
}

/** The state in `file`; the empty state when it is missing or did not read. */
export function readUpdateState(file: string = updateStateFile()): UpdateState {
  return readJsonFile(file, updateStateSchema) ?? emptyUpdateState()
}

/** Changes the state in `file` and answers the state written. */
export function changeUpdateState(change: (state: UpdateState) => UpdateState, file: string = updateStateFile()): UpdateState {
  const next = change(readUpdateState(file))
  writeJsonFile(file, updateStateSchema, next)
  return updateStateSchema.parse(next)
}
