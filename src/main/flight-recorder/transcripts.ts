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
// Run's files on from where the last read stopped (src/main/claude-home/tail.ts) and keeps the lines,
// and the `parses` of the Run (TranscriptParses, ticket 27): each file's parse is kept from one read
// to the next and takes only the lines that came since, so a step costs what was appended, not the file.
// The worktree of an agent is handed over by `canonicalWorktree` (worktree-path.ts), the helper reader
// 16 calls too, so an agent and a gate run of one worktree meet.
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { LostFact, TurnFact, WaveFact, WorkFact } from '../../shared/flight-recorder/facts'
import { SubagentParse, TranscriptParse, transcriptCwd, wavePromptTimes } from '../../shared/flight-recorder/from-transcript'
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
/**
 * How many files are read at once. A step of a live Run waits mostly on the reads of the Subagents'
 * files (a hundred in a long Run), not on its own work: read one after the other, they took most of it.
 */
const READ_AT_ONCE = 16
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

/**
 * The lines of a file, empty ones left out; null when there is no such file. A source that reads a
 * file on from where it stopped may hand back the same array, grown at its end, while the file only
 * grows (TailLines of service.ts does), and must hand a new array when the file was read again from
 * its start: TranscriptParses takes the lines past those it parsed only from the array it parsed.
 */
export type ReadLines = (file: string) => Promise<readonly string[] | null>

export interface TranscriptReadOptions extends CanonicalOptions {
  env?: Env
  /** Where the lines come from: a streamed read of the whole file by default; ticket 17 tails. */
  readLines?: ReadLines
  /** The parses kept from the last read (ticket 27); none by default: every file is parsed whole. */
  parses?: TranscriptParses
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

/** A parse and the lines it was fed: the array, and how many of its lines. */
interface Fed<P> {
  lines: readonly string[]
  taken: number
  parse: P
}

/**
 * The parses of a live Run's transcript files, kept from one read to the next (worfy-flight-recorder
 * ticket 27): a file whose lines come as the same array, grown, is parsed on from the lines it had
 * (ReadLines); another array — the first read, a file truncated or replaced — is parsed from its
 * start. A file the read does not look at again is let go at its end.
 */
export class TranscriptParses {
  private readonly orchestrators = new Map<string, Fed<TranscriptParse>>()
  private readonly subagents = new Map<string, Fed<SubagentParse>>()
  private used = new Set<string>()
  /** How each file was parsed in the last read: from its start, or on from the last read, and how many lines. */
  readonly last = new Map<string, { from: 'start' | 'cursor'; lines: number }>()

  /** How many Orchestrator transcripts have a parse. */
  get size(): number {
    return this.orchestrators.size
  }

  /** Starts a read: the files it does not look at are let go at `settle`. */
  begin(): void {
    this.used = new Set()
    this.last.clear()
  }

  settle(): void {
    for (const files of [this.orchestrators, this.subagents]) for (const file of files.keys()) if (!this.used.has(file)) files.delete(file)
  }

  clear(): void {
    this.orchestrators.clear()
    this.subagents.clear()
    this.last.clear()
  }

  orchestrator(file: string, lines: readonly string[]): TranscriptParse {
    return this.feed(this.orchestrators, file, lines, () => new TranscriptParse())
  }

  subagent(file: string, lines: readonly string[]): SubagentParse {
    return this.feed(this.subagents, file, lines, () => new SubagentParse())
  }

  private feed<P extends { append(lines: readonly string[]): P }>(parses: Map<string, Fed<P>>, file: string, lines: readonly string[], make: () => P): P {
    this.used.add(file)
    const known = parses.get(file)
    if (known !== undefined && known.lines === lines && lines.length >= known.taken) {
      known.parse.append(lines.slice(known.taken))
      this.last.set(file, { from: 'cursor', lines: lines.length - known.taken })
      known.taken = lines.length
      return known.parse
    }
    const parse = make().append(lines)
    parses.set(file, { lines, taken: lines.length, parse })
    this.last.set(file, { from: 'start', lines: lines.length })
    return parse
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

/**
 * Waits for every promise, then throws the first error, if any: no read of the step is still going
 * when the step is over. A read left going would share its file's cursor with the next recompute's
 * read (TailLines of service.ts), and both would take the same lines.
 */
async function settled<T extends readonly unknown[]>(promises: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const results = await Promise.allSettled(promises)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed !== undefined) throw failed.reason
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as unknown as T
}

/**
 * `each` of every item, at most `limit` at once; the answers in the order of the items. After an
 * error no item is started, the ones under way are waited for, and the first error is thrown.
 */
async function inParallel<T, R>(items: readonly T[], limit: number, each: (item: T) => Promise<R>): Promise<R[]> {
  const answers = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        answers[index] = await each(items[index]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await settled(Array.from({ length: Math.min(limit, items.length) }, worker))
  return answers
}

/** The files of the Subagents `ids` of a Session, parsed; an id that names no file is left out. */
async function subagentFiles(dir: string, session: string, ids: ReadonlySet<string>, readLines: ReadLines, parses: TranscriptParses): Promise<Map<string, { meta: unknown; parse: SubagentParse }>> {
  const folder = join(dir, session, 'subagents')
  const read = await inParallel([...ids].filter((id) => FILE_ID.test(id)), READ_AT_ONCE, async (id) => {
    const file = join(folder, `agent-${id}.jsonl`)
    const [lines, metaLines] = await settled<[readonly string[] | null, readonly string[] | null]>([readLines(file), readLines(join(folder, `agent-${id}.meta.json`))])
    let meta: unknown
    try {
      meta = metaLines === null ? null : JSON.parse(metaLines.join('\n'))
    } catch {
      meta = null
    }
    return lines !== null || metaLines !== null ? { id, file, meta, lines: lines ?? [] } : null
  })
  const files = new Map<string, { meta: unknown; parse: SubagentParse }>()
  for (const each of read) if (each !== null) files.set(each.id, { meta: each.meta, parse: parses.subagent(each.file, each.lines) })
  return files
}

const ms = (iso: Iso): number => Date.parse(iso)

/** The facts of the transcripts of a Run. */
export async function readRunTranscripts(run: TranscriptRun, options: TranscriptReadOptions = {}): Promise<RunTranscripts> {
  const platform = options.platform ?? process.platform
  const readLines = options.readLines ?? streamLines
  const parses = options.parses ?? new TranscriptParses()
  parses.begin()
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
    const parse = parses.orchestrator(join(dir, `${session}.jsonl`), read.get(session)!)
    const inside = (at: Iso) => ms(at) >= window.start && ms(at) <= window.end
    const subagents = await subagentFiles(dir, session, parse.agentIdsIn(inside), readLines, parses)
    const facts = parse.facts({ session, epic: run.epic, tickets, subagents, inside })
    const placed = await inParallel(
      facts.work,
      READ_AT_ONCE,
      async (fact) => (fact.worktree === undefined ? fact : { ...fact, worktree: await canonicalWorktree(fact.worktree, options) }),
    )
    work.push(...placed)
    turns.push(...facts.turns)
  }

  // An agent with no Ticket of its own: the Ticket of an agent in the same worktree, else the Run's.
  const ticketOfWorktree = new Map<string, string>()
  for (const fact of work) if (typeof fact.ticket === 'string' && fact.worktree !== undefined) ticketOfWorktree.set(fact.worktree, fact.ticket)
  for (const fact of work) if (fact.ticket === undefined) fact.ticket = ticketOfWorktree.get(fact.worktree ?? '') ?? null
  parses.settle()
  return { work, turns, lost }
}
