// The Subagent entries the user hid with «Hide» (worfy-polish ticket 45, ADR-0085): by Session id,
// in `hidden-subagents.json` of the Project's own data folder (ADR 0005), never under the Claude
// home — those are Claude Code's files. The Canvas and the Session rail leave the entries out, and
// «Show hidden Subagents» brings a Session's entries back.
import { join } from 'node:path'
import { HIDDEN_PER_SESSION, hiddenSubagentsSchema, type HiddenSubagents as HiddenAnswer } from '../../shared/ipc/claude-home'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const HIDDEN_SUBAGENTS_FILE = 'hidden-subagents.json'

/** The file holds what the channels answer; a file that does not match is set aside (json-file.ts). */
const fileSchema = hiddenSubagentsSchema

export class HiddenSubagents {
  /** `dataDir`: the Project's own data folder, by Project id (src/main/projects/store.ts, dataDir()). */
  constructor(private readonly dataDir: (projectId: string) => string) {}

  private file(projectId: string): string {
    return join(this.dataDir(projectId), HIDDEN_SUBAGENTS_FILE)
  }

  /** Every hidden entry of the Project, by Session id; none when nothing was hidden. */
  list(projectId: string): HiddenAnswer {
    return { sessions: readJsonFile(this.file(projectId), fileSchema)?.sessions ?? {} }
  }

  /** Hides `ids` of the Session; an entry hidden already stays once. Keeps the latest HIDDEN_PER_SESSION of a Session. */
  hide(projectId: string, sessionId: string, ids: readonly string[]): HiddenAnswer {
    const { sessions } = this.list(projectId)
    const kept = new Set(sessions[sessionId] ?? [])
    for (const id of ids) {
      // Hidden again: it goes to the end, so the cap drops the entries hidden longest ago.
      kept.delete(id)
      kept.add(id)
    }
    return this.write(projectId, { ...sessions, [sessionId]: [...kept].slice(-HIDDEN_PER_SESSION) })
  }

  /** Shows every hidden entry of the Session again. */
  show(projectId: string, sessionId: string): HiddenAnswer {
    const { sessions } = this.list(projectId)
    if (!(sessionId in sessions)) return { sessions }
    const rest = { ...sessions }
    delete rest[sessionId]
    return this.write(projectId, rest)
  }

  private write(projectId: string, sessions: Record<string, string[]>): HiddenAnswer {
    writeJsonFile(this.file(projectId), fileSchema, { sessions })
    return { sessions }
  }
}
