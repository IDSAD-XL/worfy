// The rules of a Session worfy continues or closes (ticket 18).
//
// Resume is only for a finished Session. A Session that has a live Claude Code process in the
// registry under ~/.claude (a terminal, Claude desktop), or that worfy runs itself, is not
// continued: two processes would write one transcript. A Session goes on in the cwd its transcript
// records, not in the Project root: Claude Code keeps transcripts by cwd, so a Session started in a
// worktree is found only from that worktree — and when that folder is gone, it is found nowhere.
import { RESUME_LABELS, type ResumeRefusal, type ResumeVerdict } from '../../shared/ipc/sessions'
import type { LiveSession } from '../../shared/ipc/claude-home'
import type { SessionState } from '../../shared/agent/events'

export interface ResumeInput {
  /** The SDK session to continue. */
  sessionId: string
  projectRoot: string
  /** Live Claude Code processes of the Project, from the registry under the Claude home. */
  live: readonly Pick<LiveSession, 'sessionId' | 'entrypoint'>[]
  /** Ids of the Sessions worfy runs now: temporary and SDK ids alike. */
  running: Iterable<string>
  /** What the Project's transcript of the Session records; undefined when there is no transcript. */
  recorded: { cwd?: string | undefined } | undefined
  /** Whether a folder exists; a failing check counts as no. */
  isDirectory(path: string): Promise<boolean>
}

const refuse = (reason: ResumeRefusal): ResumeVerdict => ({ resumable: false, reason, label: RESUME_LABELS[reason] })

export async function resumeVerdict(input: ResumeInput): Promise<ResumeVerdict> {
  const { sessionId } = input
  if (new Set(input.running).has(sessionId)) return refuse('open')
  const process = input.live.find((live) => live.sessionId === sessionId)
  if (process !== undefined) return refuse(process.entrypoint === 'claude-desktop' ? 'desktop' : 'running')
  if (input.recorded === undefined) return refuse('unknown')
  // A transcript whose first records name no cwd: Claude Code found it under the root's folder.
  const cwd = input.recorded.cwd ?? input.projectRoot
  const exists = await input.isDirectory(cwd).catch(() => false)
  return exists ? { resumable: true, cwd } : refuse('folder-missing')
}

/** Why a Session in this state may not be closed, or null when it may: a running turn is interrupted first. */
export function closeRefusal(state: SessionState): string | null {
  return state === 'busy' ? 'The Session is in a turn: Interrupt it before closing' : null
}
