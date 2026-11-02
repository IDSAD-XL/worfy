// The history part of the Claude driver: Claude Code's transcripts, the JSONL files under
// <claude home>/projects, as src/main/claude-home/ reads them today — the list of a Project's
// Sessions (ClaudeHomeRegistry.sessions) and a transcript's lines (tail.ts), parsed by the
// transcript reader (src/shared/transcript/parse.ts).
import { parseTranscriptLines } from '../../../shared/transcript/parse'
import type { HistoryPart, HistorySession } from '../history'

/** The ClaudeHomeRegistry of the Claude home, loaded at the call: it stays out of the Session registry's imports. */
async function registry() {
  const [{ ClaudeHomeRegistry }, { claudeHome }] = await Promise.all([import('../../claude-home/registry'), import('../../storage/paths')])
  return new ClaudeHomeRegistry({ home: claudeHome() })
}

/**
 * Where a Session was started, by the `entrypoint` Claude Code wrote for it: `sdk-ts` is written by
 * every program on the Agent SDK, worfy among them, so it tells nothing (src/renderer/claude-home/session-nodes.ts).
 */
const originOf = (entrypoint: string | undefined): HistorySession['origin'] => (entrypoint === undefined || entrypoint === 'sdk-ts' ? null : 'external')

export const claudeHistory: HistoryPart = {
  // The Sessions of `cwd` and of its git worktrees, as the Project's history lists them.
  async list(cwd) {
    const { history } = await (await registry()).sessions(cwd)
    return history.map((session) => ({
      id: session.sessionId,
      cwd: session.cwd ?? null,
      title: session.title ?? null,
      updatedAt: session.modifiedAt,
      origin: originOf(session.entrypoint),
    }))
  },
  async read(id, cwd) {
    const path = await (await registry()).transcriptPath(cwd, id)
    if (path === null) throw new Error(`no transcript of the Claude Code Session ${id} in ${cwd}`)
    const [{ readNewLines }, { imageRef }] = await Promise.all([import('../../claude-home/tail'), import('../../agent/attachments')])
    const lines: string[] = []
    let chunk = await readNewLines(path)
    lines.push(...chunk.lines)
    while (chunk.more) {
      chunk = await readNewLines(path, chunk.cursor)
      lines.push(...chunk.lines)
    }
    // Images named by the hash of their copy, as the Session view reads them (src/main/ipc/claude-home.ts).
    return parseTranscriptLines(lines, { imageRef })
  },
}
