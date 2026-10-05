// The model, effort and permission mode the user picked for a Session Node (ticket 19), kept in
// worfy's own data folder (ADR 0005) rather than in the Layout: ADR-0010 keeps the Orchestrator
// Node's data to the SDK session id and the cost.
//
// One file per Project, `<Project data folder>/session-settings.json`, keyed by the Node id. The
// Node id, not the SDK session id: the picks belong to the Node the user sees, so they outlive a
// saved session that cannot be resumed (a new session starts under the same Node), and a pick made
// before Claude Code has reported its session id has a key already.
//
// Reads and writes go through src/main/storage/json-file.ts: the write is atomic, and a file that
// cannot be parsed is set aside and read as empty. A damaged field of one Node's picks falls back
// to its default and keeps the others (readSettings).
import { join } from 'node:path'
import { z } from 'zod'
import { readSettings, sessionSettingsSchema, type SessionSettings } from '../../shared/agent/settings'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const SESSION_SETTINGS_FILE = 'session-settings.json'

const nodeId = z.string().min(1)

/** The file as read: each Node's picks field by field, over the defaults. */
const readSchema = z.object({ nodes: z.record(nodeId, z.unknown().transform(readSettings)) })
/** The file as written: only whole, valid picks. */
const writeSchema = z.object({ nodes: z.record(nodeId, sessionSettingsSchema) })

export class SessionSettingsStore {
  /** `dirOf` gives a Project's data folder and throws for a Project that is not in the list. */
  constructor(private readonly dirOf: (projectId: string) => string) {}

  file(projectId: string): string {
    return join(this.dirOf(projectId), SESSION_SETTINGS_FILE)
  }

  /** The picks saved for a Node, or undefined when there are none. I/O errors other than a missing file throw. */
  read(projectId: string, nodeId: string): SessionSettings | undefined {
    return readJsonFile(this.file(projectId), readSchema)?.nodes[nodeId]
  }

  /** Saves the picks of one Node and keeps the other Nodes'. */
  write(projectId: string, nodeId: string, settings: SessionSettings): void {
    const file = this.file(projectId)
    const nodes = readJsonFile(file, readSchema)?.nodes ?? {}
    writeJsonFile(file, writeSchema, { nodes: { ...nodes, [nodeId]: settings } })
  }
}
