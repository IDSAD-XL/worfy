// The reader of the transcripts for Flight Recorder (worfy-flight-recorder ticket 14): finds the
// Orchestrator's transcript of each Wave of a Run under the Claude home, reads it and the files of
// the Subagents the Run started, and hands the facts of src/shared/flight-recorder/from-transcript.ts
// to the service (ticket 17) with the worktree paths canonical (facts.ts) and with what lies in the
// Run's Waves.
//
// - Where: `<Claude home>/projects/<projectDirName(root)>/<session>.jsonl`, the Subagents in
//   `<session>/subagents/agent-<id>.jsonl` and `.meta.json`. The folder name is no proof (it loses
//   the difference between `/`, `-` and any other sign; on Windows `C:\Users\Ann\repo` is
//   `C--Users-Ann-repo`): a transcript is the Project's when the `cwd` its records name lies in the
//   root, as the registry decides (src/main/claude-home/registry.ts).
// - Which: `wave-started.session` names it. A Journal without it has the Wave's text: the Session
//   whose prompt with that text lies nearest the Wave's start, within WAVE_SLACK_MS. With neither,
//   or with a file that is gone, the Wave's Orchestrator lane and its Tickets' agents are lost
//   («transcript deleted»): the Journal knows of them, the transcript holds nothing more.
// - Which Subagents: only those whose `Agent` call or resuming `SendMessage` lies in the Run's
//   Waves. A long Session keeps thousands of Subagent files (1.1 GB in one of worfy's own); a Run
//   uses a dozen.
// - An agent the transcript names no Ticket for, whose folder is the canonical worktree of an agent
//   of a Ticket, gets that Ticket; any other is the Run's (`ticket: null`), so it never vanishes.
// - Times: only the `timestamp` of the records; the time a file changed is never read.
//
// The lines come from `readLines` of the options, a streamed read of the whole file by default.
// The service (src/main/flight-recorder/service.ts, ticket 17) passes a `readLines` that reads a live
// Run's files on from where the last read stopped (src/main/claude-home/tail.ts) and keeps the lines.
// The worktree of an agent is handed over by `canonicalWorktree` (worktree-path.ts), the helper reader
// 16 calls too, so an agent and a gate run of one worktree meet.
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { LostFact, TurnFact, WaveFact, WorkFact } from '../../shared/flight-recorder/facts'
import { agentIdsIn, transcriptCwd, transcriptFacts, wavePromptTimes, type SubagentLines } from '../../shared/flight-recorder/from-transcript'
import { AGENT_TOOLS } from '../../shared/transcript/subagents'
import { isInsidePath, projectDirName } from '../claude-home/registry'
import { claudeHome } from '../storage/paths'
import { canonicalWorktree, type CanonicalOptions } from './worktree-path'

type Env = Readonly<Record<string, string | undefined>>
type Iso = string

/** How far the prompt of a Wave may lie from its `wave-started` for the search by text. */
export const WAVE_SLACK_MS = 60_000
/**
 * How long before its `wave-started` a Wave's own records may begin: worfy writes the line just
 * after it sends the prompt (29 ms in the night Run). Longer would take in the end of the Wave before.
 */
export const PROMPT_LEAD_MS = 5_000
/** A Session or agent id as Claude Code names its files; anything else (`../x`) names no file. */
const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/u

/** A Wave as the Journal gives it: `wave-started.session` and `wave-started.text` when it has them. */
export interface TranscriptWave extends Pick<WaveFact, 'number' | 'startedAt' | 'finishedAt' | 'tickets' | 'session'> {
  text?: string | undefined
}

/** What the reader needs of a Run. */
export interface TranscriptRun {
  epic: string
  /** The Project's root, as the Orchestrator's Sessions start in it. */
  root: string
  startedAt: Iso
  stoppedAt: Iso | null
  waves: readonly TranscriptWave[]
}

/** The lines of a file, empty ones left out; null when there is no such file. */
export type ReadLines = (file: string) => Promise<readonly string[] | null>

export interface TranscriptReadOptions extends CanonicalOptions {
  env?: Env
  /** Where the lines come from: a streamed read of the whole file by default; ticket 17 tails. */
  readLines?: ReadLines
}

export interface RunTranscripts {
  work: WorkFact[]
  turns: TurnFact[]
  lost: LostFact[]
}

const missing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code ?? '')

/** The tool that resumes an agent (from-transcript.ts). */
const SEND_TOOL = 'SendMessage'

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The fields of a record the facts of the transcripts read (from-transcript.ts and the parse it calls); the rest is dropped. */
const KEPT_FIELDS = ['type', 'timestamp', 'cwd', 'isSidechain', 'isMeta', 'isCompactSummary', 'operation'] as const
/** What the facts read of a call of an agent (`Agent`, `Task`) and of `SendMessage`, and of the result of either. */
const AGENT_INPUT = ['name', 'subagent_type', 'description', 'prompt'] as const
const SEND_INPUT = ['to', 'recipient'] as const
const AGENT_RESULT = ['agentId', 'status', 'resumedAgentId', 'description', 'agentType'] as const

/** Only these fields of an object, those it has. */
function only(value: Json, fields: readonly string[]): Json {
  const kept: Json = {}
  for (const field of fields) if (value[field] !== undefined) kept[field] = value[field]
  return kept
}

/**
 * Turns the lines of one transcript file, in file order, into the lines the facts are read from,
 * with only what from-transcript.ts reads: so a live Run keeps them in memory and parses them again
 * on each recompute at a fraction of the cost of the raw lines (worfy-flight-recorder ticket 17).
 * Dropped: the input of every tool call but `Agent`, `Task` and `SendMessage`, the content and the
 * `toolUseResult` of their results (a file read, a command's output), thinking and image blocks,
 * the attachments but a queued command, the content of a queue operation but an enqueue, and the
 * fields no reader looks at. Kept whole: the text of every message, the result of an agent's call
 * (its report); of the call itself and of its `toolUseResult`, the fields the facts read. A line that is
 * not a JSON object reads as nothing, as it does in from-transcript.ts. One instance per file: it
 * remembers the agent calls it has seen, whose results follow them in the file.
 */
export class TranscriptCompactor {
  private readonly agentCalls = new Set<string>()

  /** The line as the facts need it; null for a line no reader takes. */
  line(line: string): string | null {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      return null
    }
    if (!isJson(record)) return null
    const kept = only(record, KEPT_FIELDS)
    // A queue operation's text is read only when it is enqueued (a prompt typed early, a task-notification).
    if (typeof record.content === 'string' && (record.type !== 'queue-operation' || record.operation === 'enqueue')) kept.content = record.content
    const attachment = record.attachment
    if (isJson(attachment) && attachment.type === 'queued_command') kept.attachment = { type: attachment.type, prompt: attachment.prompt }
    const message = record.message
    let ofAgent = false
    if (isJson(message)) {
      const content = message.content
      const blocks = Array.isArray(content)
        ? content.flatMap((block: unknown) => {
            if (!isJson(block)) return [block]
            if (block.type === 'text') return [block]
            if (block.type === 'tool_use') {
              if (typeof block.id === 'string' && typeof block.name === 'string' && (AGENT_TOOLS.has(block.name) || block.name === SEND_TOOL)) {
                this.agentCalls.add(block.id)
                const input = isJson(block.input) ? only(block.input, block.name === SEND_TOOL ? SEND_INPUT : AGENT_INPUT) : block.input
                return [{ type: 'tool_use', id: block.id, name: block.name, input }]
              }
              return [{ type: 'tool_use', id: block.id, name: block.name, input: {} }]
            }
            if (block.type === 'tool_result') {
              if (typeof block.tool_use_id === 'string' && this.agentCalls.has(block.tool_use_id)) {
                ofAgent = true
                return [block]
              }
              return [{ type: 'tool_result', tool_use_id: block.tool_use_id, content: '' }]
            }
            return []
          })
        : content
      kept.message = { role: message.role, content: blocks }
    }
    if (ofAgent && isJson(record.toolUseResult)) kept.toolUseResult = only(record.toolUseResult, AGENT_RESULT)
    return JSON.stringify(kept)
  }
}

/** The default line source: the file streamed line by line, so no single string holds it whole. */
export const streamLines: ReadLines = async (file) => {
  const lines: string[] = []
  try {
    const stream = createReadStream(file, { encoding: 'utf8' })
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) if (line !== '') lines.push(line)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  return lines
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
}

/** The files of the Subagents `ids` of a Session; an id that names no file is left out. */
async function subagentFiles(dir: string, session: string, ids: ReadonlySet<string>, readLines: ReadLines): Promise<Map<string, SubagentLines>> {
  const folder = join(dir, session, 'subagents')
  const files = new Map<string, SubagentLines>()
  for (const id of ids) {
    if (!FILE_ID.test(id)) continue
    const lines = await readLines(join(folder, `agent-${id}.jsonl`))
    const metaLines = await readLines(join(folder, `agent-${id}.meta.json`))
    let meta: unknown
    try {
      meta = metaLines === null ? null : JSON.parse(metaLines.join('\n'))
    } catch {
      meta = null
    }
    if (lines !== null || metaLines !== null) files.set(id, { meta, lines: lines ?? [] })
  }
  return files
}

const ms = (iso: Iso): number => Date.parse(iso)

/** The facts of the transcripts of a Run. */
export async function readRunTranscripts(run: TranscriptRun, options: TranscriptReadOptions = {}): Promise<RunTranscripts> {
  const platform = options.platform ?? process.platform
  const readLines = options.readLines ?? streamLines
  const dir = join(claudeHome(options.env), 'projects', projectDirName(run.root))
  const tickets = [...new Set(run.waves.flatMap((wave) => wave.tickets))]
  const ofProject = (lines: readonly string[]): boolean => {
    const cwd = transcriptCwd(lines)
    return cwd !== undefined && isInsidePath(cwd.normalize('NFC'), run.root.normalize('NFC'), platform as NodeJS.Platform)
  }
  const read = new Map<string, readonly string[] | null>()
  const sessionLines = async (session: string): Promise<readonly string[] | null> => {
    if (!read.has(session)) {
      const lines = FILE_ID.test(session) ? await readLines(join(dir, `${session}.jsonl`)) : null
      read.set(session, lines !== null && ofProject(lines) ? lines : null)
    }
    return read.get(session) ?? null
  }

  // The prompts of the folder's transcripts, read once, for the Waves that have no session: only
  // the times are kept, so the files are not held while the others are read.
  let prompts: Map<string, Map<string, Iso[]>> | undefined
  const promptTimes = async (text: string): Promise<Map<string, Iso[]>> => {
    prompts ??= new Map()
    const known = prompts.get(text)
    if (known !== undefined) return known
    const found = new Map<string, Iso[]>()
    for (const name of (await listDir(dir)).sort()) {
      const session = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : ''
      if (!FILE_ID.test(session)) continue
      const lines = await readLines(join(dir, name))
      if (lines === null || !ofProject(lines)) continue
      const times = wavePromptTimes(lines, text)
      if (times.length > 0) found.set(session, times)
    }
    prompts.set(text, found)
    return found
  }

  const lost: LostFact[] = []
  const windows = new Map<string, { start: number; end: number }>()
  for (const wave of run.waves) {
    let session: string | undefined
    if (wave.session !== undefined) {
      if ((await sessionLines(wave.session)) !== null) session = wave.session
    } else if (wave.text !== undefined && wave.text.trim() !== '') {
      let nearest = WAVE_SLACK_MS + 1
      for (const [id, times] of await promptTimes(wave.text)) {
        for (const at of times) {
          const distance = Math.abs(ms(at) - ms(wave.startedAt))
          if (distance < nearest) [nearest, session] = [distance, id]
        }
      }
      if (session !== undefined && (await sessionLines(session)) === null) session = undefined
    }
    const end = wave.finishedAt ?? run.stoppedAt
    if (session === undefined) {
      lost.push({ kind: 'orchestrator-turn', name: 'Orchestrator', source: 'transcript-deleted', start: wave.startedAt, ...(end === null ? {} : { end }) })
      for (const ticket of wave.tickets) lost.push({ kind: 'agent', ticket, name: `impl-${/(\d+)$/u.exec(ticket)?.[1] ?? ticket}`, source: 'transcript-deleted' })
      continue
    }
    const window = windows.get(session) ?? { start: Infinity, end: -Infinity }
    window.start = Math.min(window.start, ms(wave.startedAt) - PROMPT_LEAD_MS)
    window.end = Math.max(window.end, end === null ? Infinity : ms(end))
    windows.set(session, window)
  }

  const work: WorkFact[] = []
  const turns: TurnFact[] = []
  for (const [session, window] of windows) {
    const lines = read.get(session)!
    const inside = (at: Iso) => ms(at) >= window.start && ms(at) <= window.end
    const subagents = await subagentFiles(dir, session, agentIdsIn(lines, inside), readLines)
    const facts = transcriptFacts({ session, epic: run.epic, tickets, lines, subagents })
    for (const fact of facts.work.filter((item) => inside(item.start))) work.push(fact.worktree === undefined ? fact : { ...fact, worktree: await canonicalWorktree(fact.worktree, options) })
    turns.push(...facts.turns.filter((item) => inside(item.start)))
  }

  // An agent with no Ticket of its own: the Ticket of an agent in the same worktree, else the Run's.
  const ticketOfWorktree = new Map<string, string>()
  for (const fact of work) if (typeof fact.ticket === 'string' && fact.worktree !== undefined) ticketOfWorktree.set(fact.worktree, fact.ticket)
  for (const fact of work) if (fact.ticket === undefined) fact.ticket = ticketOfWorktree.get(fact.worktree ?? '') ?? null
  return { work, turns, lost }
}
