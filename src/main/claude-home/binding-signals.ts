// The signals of Bindings (ticket 16) in a Session's transcript and in its Subagents' transcripts
// (`<sessionId>/subagents/agent-<agentId>.jsonl`), extracted by the pure
// src/shared/binding/signals.ts. Every file is read incrementally (tail.ts): asking again while a
// Session runs costs only the lines appended since. Only `subagents/` itself is listed, as for the
// Subagent tree (subagents.ts). Nothing here writes anywhere (ADR 0005).
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentSignals } from '../../shared/binding/resolve'
import { emptySignalState, extendSignals, type SignalState } from '../../shared/binding/signals'
import { transcriptSessionId } from './subagents'
import { readNewLines, type TailCursor } from './tail'

const AGENT_TRANSCRIPT = /^agent-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.jsonl$/

export interface SessionSignals {
  session: AgentSignals
  subagents: { agentId: string; signals: AgentSignals }[]
}

interface Known {
  cursor: TailCursor | undefined
  state: SignalState
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/** Keeps what was read of each file, so the next call reads only what was appended. */
export class BindingSignalReader {
  private readonly known = new Map<string, Known>()

  /** The signals of one transcript; the empty signals while it does not exist. */
  async file(path: string, subagent: boolean): Promise<AgentSignals> {
    let known = this.known.get(path) ?? { cursor: undefined, state: emptySignalState() }
    for (;;) {
      const chunk = await readNewLines(path, known.cursor)
      // A truncated or replaced file starts over.
      const state = chunk.reset ? emptySignalState() : known.state
      known = { cursor: chunk.cursor, state: extendSignals(state, chunk.lines, { subagent }) }
      if (!chunk.more) break
    }
    this.known.set(path, known)
    return known.state.signals
  }

  /** The signals of the Session whose transcript is at `path` and of each of its Subagents that has a transcript. */
  async session(path: string): Promise<SessionSignals> {
    const sessionId = transcriptSessionId(path)
    const folder = join(dirname(path), sessionId, 'subagents')
    let names: string[] = []
    try {
      names = (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const agentIds = names.flatMap((name) => AGENT_TRANSCRIPT.exec(name)?.[1] ?? []).sort()
    const [session, ...subagents] = await Promise.all([this.file(path, false), ...agentIds.map((agentId) => this.file(join(folder, `agent-${agentId}.jsonl`), true))])
    return { session: session!, subagents: agentIds.map((agentId, index) => ({ agentId, signals: subagents[index]! })) }
  }
}
