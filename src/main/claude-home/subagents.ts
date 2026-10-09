// The Subagents of a Session as Claude Code records them (ticket 15): the Agent calls in the
// Session's transcript, and `<sessionId>/subagents/agent-<agentId>.jsonl` with its
// `agent-<agentId>.meta.json` next to the transcript. The tree itself is built from these by the
// pure src/shared/transcript/subagents.ts, in the renderer, where a live Session's own events join
// them.
//
// Every file is read incrementally (tail.ts): a transcript already read is only read past its
// cursor on the next call, so asking again while a Session runs costs the new lines only. Besides
// `subagents/` itself, only `subagents/workflows/wf_*/` is listed — the agents of workflow scripts
// and their run's `journal.jsonl` (ticket worfy-daily/17, ADR-0035) — and nothing deeper.
// Nothing here writes anywhere (ADR 0005).
//
// Whether the Session still runs is read from the Claude home's `sessions/<pid>.json` (as
// registry.ts reads it): a Session whose process is gone gets a `session-closed` signal, which
// ends every Subagent that never reported its end (ADR-0031).
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  emptySubagentFile,
  extendSubagentFile,
  readWorkflowJournal,
  subagentSignalsOfLines,
  workflowAgentFile,
  WORKFLOW_RUN_ID,
  type SubagentFile,
  type SubagentSignal,
  type WorkflowAgent,
} from '../../shared/transcript/subagents'
import { lastPathSegment } from '../../shared/paths'
import { processState } from './registry'
import { readNewLines, type TailCursor } from './tail'

/**
 * The id of the Session whose transcript is at `path`: the file name without `.jsonl`. The path is
 * split at `/` and `\`: on Windows it comes from the file system with `\` (worfy-windows ticket 08).
 */
export const transcriptSessionId = (path: string): string => lastPathSegment(path).replace(/\.jsonl$/, '')

/** A Subagent id: letters, digits, `-` and `_` only. */
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
/** `agent-<id>.jsonl` or `agent-<id>.meta.json`; the id is letters, digits, `-` and `_` only. */
const AGENT_FILE =/^agent-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.(jsonl|meta\.json)$/
/** A meta file bigger than this is not read (real ones are a few hundred bytes). */
const META_MAX_BYTES = 64 * 1024
/** The folder of a Session's workflow runs, inside its `subagents/`; each run is a `wf_*` folder. */
const WORKFLOWS = 'workflows'
const JOURNAL = 'journal.jsonl'
/** At most this many runs of one Session are read (the busiest Session on this machine had 31 on 2026-10-07). */
const MAX_WORKFLOW_RUNS = 200

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

interface Journal {
  cursor: TailCursor | undefined
  agents: Map<string, WorkflowAgent>
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/** Reads every complete line after `cursor`, however many chunks that takes. */
async function readAll(path: string, cursor: TailCursor | undefined): Promise<{ lines: string[]; cursor: TailCursor; reset: boolean; bytesRead: number }> {
  const lines: string[] = []
  let reset = false
  let bytesRead = 0
  let at = cursor
  for (;;) {
    const chunk = await readNewLines(path, at)
    bytesRead += chunk.bytesRead
    if (chunk.reset) {
      lines.length = 0
      reset = true
    }
    lines.push(...chunk.lines)
    at = chunk.cursor
    if (!chunk.more) return { lines, cursor: at, reset, bytesRead }
  }
}

/** The names of the entries of `dir` that `keep` accepts; empty when there is no such folder. */
async function entriesOf(dir: string, keep: (entry: { isFile(): boolean; isDirectory(): boolean; name: string }) => boolean): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter(keep).map((entry) => entry.name)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

/** The run folders of a Session's workflow scripts (`subagents/workflows/wf_*`), by name, at most MAX_WORKFLOW_RUNS. */
async function workflowRuns(folder: string): Promise<string[]> {
  const names = await entriesOf(join(folder, WORKFLOWS), (entry) => entry.isDirectory() && WORKFLOW_RUN_ID.test(entry.name))
  return names.sort().slice(0, MAX_WORKFLOW_RUNS)
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
  private readonly journals = new Map<string, Journal>()
  private readonly processState: NonNullable<SubagentReaderOptions['processState']>
  private read = 0

  constructor(options: SubagentReaderOptions = {}) {
    this.processState = options.processState ?? processState
  }

  /** Bytes read so far from transcripts and journals (meta files aside): asking again costs what was appended. */
  get bytesRead(): number {
    return this.read
  }

  /** readAll(), counted. */
  private async readAll(path: string, cursor: TailCursor | undefined): ReturnType<typeof readAll> {
    const result = await readAll(path, cursor)
    this.read += result.bytesRead
    return result
  }

  /** The Subagent signals of a Session's own transcript at `path`. */
  async signals(path: string): Promise<SubagentSignal[]> {
    let thread = this.threads.get(path)
    if (thread === undefined) {
      thread = { cursor: undefined, calls: new Set(), signals: [] }
      this.threads.set(path, thread)
    }
    const read = await this.readAll(path, thread.cursor)
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

  /**
   * What the files in a Session's `subagents/` folder say, by agentId; empty when there is no
   * folder. Then the agents of each workflow run in `subagents/workflows/wf_<id>/`, run by run.
   */
  async files(folder: string): Promise<SubagentFile[]> {
    const own = await this.agentFiles(folder, await entriesOf(folder, (entry) => entry.isFile()))
    const runs = await Promise.all((await workflowRuns(folder)).map((runId) => this.runFiles(join(folder, WORKFLOWS, runId), runId)))
    return [...own, ...runs.flat()]
  }

  /** The agents of one workflow run: their files, and the run's journal (an agent it names may have no file yet). */
  private async runFiles(dir: string, runId: string): Promise<SubagentFile[]> {
    const [names, journal] = await Promise.all([entriesOf(dir, (entry) => entry.isFile()), this.journal(join(dir, JOURNAL))])
    const files = await this.agentFiles(dir, names)
    const seen = new Set(files.map((file) => file.agentId))
    for (const agentId of journal.keys()) if (!seen.has(agentId) && AGENT_ID.test(agentId)) files.push(emptySubagentFile(agentId, null))
    return files.map((file) => workflowAgentFile(file, runId, journal.get(file.agentId)))
  }

  /** What a run's journal says so far, read past its cursor. */
  private async journal(path: string): Promise<Map<string, WorkflowAgent>> {
    let known = this.journals.get(path)
    const read = await this.readAll(path, known?.cursor)
    if (known === undefined || read.reset) known = { cursor: undefined, agents: new Map() }
    known.cursor = read.cursor
    readWorkflowJournal(read.lines, known.agents)
    this.journals.set(path, known)
    return known.agents
  }

  /** The Subagent files among `names` in `folder`, by agentId. */
  private async agentFiles(folder: string, names: readonly string[]): Promise<SubagentFile[]> {
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
    const sessionId = transcriptSessionId(path)
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
      read = await this.readAll(path, known?.cursor)
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

const isFileAt = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Where one Subagent's transcript is, next to its Session's transcript: in `subagents/`, or in one
 * of its workflow runs (`subagents/workflows/wf_<id>/`). Null for a bad id or no file.
 */
export async function subagentTranscriptPath(sessionTranscript: string, agentId: string): Promise<string | null> {
  if (!AGENT_ID.test(agentId)) return null
  const sessionId = transcriptSessionId(sessionTranscript)
  const folder = join(dirname(sessionTranscript), sessionId, 'subagents')
  const name = `agent-${agentId}.jsonl`
  if (await isFileAt(join(folder, name))) return join(folder, name)
  for (const runId of await workflowRuns(folder)) {
    const path = join(folder, WORKFLOWS, runId, name)
    if (await isFileAt(path)) return path
  }
  return null
}
