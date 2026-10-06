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
//
// Whether the Session still runs is read from the Claude home's `sessions/<pid>.json` (as
// registry.ts reads it): a Session whose process is gone gets a `session-closed` signal, which
// ends every Subagent that never reported its end (ADR-0031).
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { emptySubagentFile, extendSubagentFile, subagentSignalsOfLines, type SubagentFile, type SubagentSignal } from '../../shared/transcript/subagents'
import { processState } from './registry'
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

export interface SubagentReaderOptions {
  /**
   * Whether a `sessions/<pid>.json` entry's process runs: `alive`, `gone`, or `unknown` when it
   * cannot be told (`ps` failed); defaults to processState() (registry.ts).
   */
  processState?: (pid: number, procStart: string | undefined) => Promise<'alive' | 'gone' | 'unknown'>
}

const CLOSED: SubagentSignal = { kind: 'session-closed' }

/**
 * Whether the Session `sessionId` runs, by the `sessions/` folder of the Claude home that holds
 * `transcript` (`<home>/projects/<folder>/<sessionId>.jsonl`): true when an entry names it and its
 * process runs, false when none does. Null — not known, so not closed — when the transcript is not
 * under `projects/`, the home has no `sessions/` folder, an entry cannot be read (one being
 * rewritten may be the Session's own), or whether its process runs cannot be told.
 */
async function sessionRuns(transcript: string, sessionId: string, processOf: NonNullable<SubagentReaderOptions['processState']>): Promise<boolean | null> {
  const projects = dirname(dirname(transcript))
  if (basename(projects) !== 'projects') return null
  const dir = join(dirname(projects), 'sessions')
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name)).map((entry) => entry.name)
  } catch {
    return null
  }
  let unknown = false
  for (const name of names) {
    let entry: unknown
    try {
      entry = JSON.parse(await readFile(join(dir, name), 'utf8'))
    } catch (error) {
      // Removed since the listing: that Session has ended. Anything else: it may be this one.
      if (!isMissing(error)) unknown = true
      continue
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const { pid, sessionId: id, procStart } = entry as Record<string, unknown>
    if (id !== sessionId || typeof pid !== 'number') continue
    const state = await processOf(pid, typeof procStart === 'string' ? procStart : undefined)
    if (state === 'alive') return true
    if (state === 'unknown') unknown = true
  }
  return unknown ? null : false
}

/** Keeps what was read of each file, so the next call reads only what was appended. */
export class SubagentReader {
  private readonly threads = new Map<string, Thread>()
  private readonly agents = new Map<string, AgentTranscript>()
  private readonly processState: NonNullable<SubagentReaderOptions['processState']>

  constructor(options: SubagentReaderOptions = {}) {
    this.processState = options.processState ?? processState
  }

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
      thread.signals = [...thread.signals, ...subagentSignalsOfLines(read.lines, thread.calls)]
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

  /** Both, for the Session whose transcript is at `path`; a `session-closed` signal last when its process is gone. */
  async session(path: string): Promise<SessionSubagents> {
    const sessionId = path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
    // Asked before the files are read: a Session found closed has written every end it will
    // report, so a Subagent that ended just before the process did is read as ended, not cut off.
    const runs = await sessionRuns(path, sessionId, this.processState)
    const [signals, files] = await Promise.all([this.signals(path), this.files(join(dirname(path), sessionId, 'subagents'))])
    return { signals: runs === false ? [...signals, CLOSED] : signals, files }
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
