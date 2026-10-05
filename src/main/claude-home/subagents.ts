// The Subagents of a Session as Claude Code records them (ticket 15): the Agent calls in the
// Session's transcript, and `<sessionId>/subagents/agent-<agentId>.jsonl` with its
// `agent-<agentId>.meta.json` next to the transcript. The tree itself is built from these by the
// pure src/shared/transcript/subagents.ts, in the renderer, where a live Session's own events join
// them.
//
// Every file is read incrementally (tail.ts): a transcript already read is only read past its
// cursor on the next call, so asking again while a Session runs costs the new lines only. Only
// `subagents/` itself is listed: Subagents of workflow scripts (`subagents/workflows/wf_*/`) are
// not part of the tree. Nothing here writes anywhere (ADR 0005).
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseTranscriptLines } from '../../shared/transcript/parse'
import { emptySubagentFile, extendSubagentFile, subagentSignals, type SubagentFile, type SubagentSignal } from '../../shared/transcript/subagents'
import { readNewLines, type TailCursor } from './tail'

/** `agent-<id>.jsonl` or `agent-<id>.meta.json`; the id is letters, digits, `-` and `_` only. */
const AGENT_FILE = /^agent-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.(jsonl|meta\.json)$/
/** A meta file bigger than this is not read (real ones are a few hundred bytes). */
const META_MAX_BYTES = 64 * 1024

export interface SessionSubagents {
  /** Signals of the Session's own thread (src/shared/transcript/subagents.ts). */
  signals: SubagentSignal[]
  /** One per Subagent that has a transcript or a meta file, by agentId. */
  files: SubagentFile[]
}

interface Thread {
  cursor: TailCursor | undefined
  calls: Set<string>
  signals: SubagentSignal[]
}

interface AgentTranscript {
  cursor: TailCursor | undefined
  file: SubagentFile
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/** Reads every complete line after `cursor`, however many chunks that takes. */
async function readAll(path: string, cursor: TailCursor | undefined): Promise<{ lines: string[]; cursor: TailCursor; reset: boolean }> {
  const lines: string[] = []
  let reset = false
  let at = cursor
  for (;;) {
    const chunk = await readNewLines(path, at)
    if (chunk.reset) {
      lines.length = 0
      reset = true
    }
    lines.push(...chunk.lines)
    at = chunk.cursor
    if (!chunk.more) return { lines, cursor: at, reset }
  }
}

async function readMeta(path: string): Promise<unknown> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > META_MAX_BYTES) return null
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    // Missing, half written or not JSON: the Subagent is shown from what else is known.
    return null
  }
}

/** Keeps what was read of each file, so the next call reads only what was appended. */
export class SubagentReader {
  private readonly threads = new Map<string, Thread>()
  private readonly agents = new Map<string, AgentTranscript>()

  /** The Subagent signals of a Session's own transcript at `path`. */
  async signals(path: string): Promise<SubagentSignal[]> {
    let thread = this.threads.get(path)
    if (thread === undefined) {
      thread = { cursor: undefined, calls: new Set(), signals: [] }
      this.threads.set(path, thread)
    }
    const read = await readAll(path, thread.cursor)
    if (read.reset) {
      thread.calls = new Set()
      thread.signals = []
    }
    thread.cursor = read.cursor
    if (read.lines.length > 0) {
      // Records an older Claude Code wrote for a Subagent into the Session's file are the Subagent's, not the Session's.
      const entries = parseTranscriptLines(read.lines).filter((entry) => !entry.sidechain)
      thread.signals = [...thread.signals, ...subagentSignals(entries, thread.calls)]
    }
    return thread.signals
  }

  /** What the files in a Session's `subagents/` folder say, by agentId; empty when there is no folder. */
  async files(folder: string): Promise<SubagentFile[]> {
    let names: string[]
    try {
      names = (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const kinds = new Map<string, { transcript: boolean; meta: boolean }>()
    for (const name of names) {
      const match = AGENT_FILE.exec(name)
      if (!match) continue
      const agentId = match[1]!
      const entry = kinds.get(agentId) ?? { transcript: false, meta: false }
      if (match[2] === 'jsonl') entry.transcript = true
      else entry.meta = true
      kinds.set(agentId, entry)
    }
    const files = await Promise.all(
      [...kinds].sort(([a], [b]) => a.localeCompare(b)).map(async ([agentId, has]) => {
        const meta = has.meta ? await readMeta(join(folder, `agent-${agentId}.meta.json`)) : null
        if (!has.transcript) return emptySubagentFile(agentId, meta)
        return this.transcript(join(folder, `agent-${agentId}.jsonl`), agentId, meta)
      }),
    )
    return files
  }

  /** Both, for the Session whose transcript is at `path`. */
  async session(path: string): Promise<SessionSubagents> {
    const sessionId = path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
    const [signals, files] = await Promise.all([this.signals(path), this.files(join(dirname(path), sessionId, 'subagents'))])
    return { signals, files }
  }

  private async transcript(path: string, agentId: string, meta: unknown): Promise<SubagentFile> {
    let known = this.agents.get(path)
    let read: Awaited<ReturnType<typeof readAll>>
    try {
      read = await readAll(path, known?.cursor)
    } catch (error) {
      if (isMissing(error)) return emptySubagentFile(agentId, meta)
      throw error
    }
    if (known === undefined || read.reset) known = { cursor: undefined, file: emptySubagentFile(agentId, meta, true) }
    known.cursor = read.cursor
    // The meta file may appear or change after the transcript: the latest one is used.
    known.file = extendSubagentFile({ ...known.file, meta: emptySubagentFile(agentId, meta).meta }, read.lines)
    this.agents.set(path, known)
    return known.file
  }
}

/** Where one Subagent's transcript is, next to its Session's transcript; null for a bad id or no file. */
export async function subagentTranscriptPath(sessionTranscript: string, agentId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(agentId)) return null
  const sessionId = sessionTranscript.slice(sessionTranscript.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
  const path = join(dirname(sessionTranscript), sessionId, 'subagents', `agent-${agentId}.jsonl`)
  try {
    return (await stat(path)).isFile() ? path : null
  } catch {
    return null
  }
}
