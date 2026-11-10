// The reader of the transcripts for Work track (worfy-work-track ticket 05): the turns and the
// Subagents of every Session of a Project on this Machine over a period, as the facts of the model
// (src/shared/work-track/facts.ts) — the Sessions on the Canvas, the hidden ones and those with no
// Node, of Claude Code and of Codex. Unlike the reader of Flight Recorder
// (src/main/flight-recorder/transcripts.ts) it is bound to no Run: it takes every file.
//
// - Where: the folders under `<Claude home>/projects/` named like the Project's root or like a folder
//   inside it (a worktree under `.claude/worktrees/`), as the registry matches them
//   (src/main/claude-home/registry.ts): `<session>.jsonl`, the Subagents in
//   `<session>/subagents/agent-<id>.jsonl` and `.meta.json`. A folder name is no proof: a Session is
//   the Project's when the first `cwd` its records name lies in the root.
// - Which files: those whose modification time is in the period or after its start — the one still
//   being written among them. A file last written before the period holds nothing of it.
// - How: streamed line by line, and each line cut down at once to names only (NamesOnly): the times,
//   the type of the record, an `Agent` call's name, description and type, the ids and the status of a
//   Subagent's result. The text of a prompt, an answer, a report or a tool's output never outlives its
//   line (owner decision 7). What is left is parsed as the Flight Recorder parses a Run's transcript
//   (src/shared/flight-recorder/from-transcript.ts): a turn runs from a prompt to its last answer, a
//   Subagent from its call to its report. A Subagent's own file gives the times of its records (where
//   one that never reported was last seen) and the Subagents it started itself (`parent`).
// - Still going: a turn or a Subagent with no end is going on while its file was written within
//   LIVE_MS of `now`; otherwise its Claude Code stopped, and it is cut off at its last record.
// - Gaps: Claude Code deletes the transcripts last written more than `cleanupPeriodDays` ago (its
//   settings.json, read only; 30 by default). The part of the period before that limit and before the
//   oldest transcript left is a `SourceGap` with that reason.
// - Codex: the Project's threads from the history part of its driver (src/main/vendors/codex/history.ts),
//   read when updated in the period. That part lists no archived threads: they are a gap on a lane of
//   their own (CODEX_ARCHIVED_SESSION).
// - A Session's name: the title of its Node on the Canvas (a hidden Node too); with no Node, «Session
//   <first 4 of the id> · <worktree>», and it is `archived` (owner's decision: the title Claude Code
//   writes into a transcript is the model's text).
//
// The parse of each file is kept in memory by (path, modification time, size) for the life of the
// app (TranscriptCache), a Codex thread by its update time; nothing is written anywhere (ADR-0005,
// ADR-0092).
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { WorkFact as RecorderFact, TurnFact } from '../../shared/flight-recorder/facts'
import { SubagentParse, TranscriptParse } from '../../shared/flight-recorder/from-transcript'
import { AGENT_TOOLS } from '../../shared/transcript/subagents'
import type { VendorId } from '../../shared/vendors/vendor'
import type { Period, SessionInfo, SourceGap, WorkFact, WorkSource } from '../../shared/work-track/facts'
import { periodBounds } from '../../shared/work-track/lanes'
import { findVerdict } from '../../shared/workflow/verdict.mjs'
import { isInsidePath, projectDirName } from '../claude-home/registry'
import { claudeHome } from '../storage/paths'
import type { HistoryPart } from '../vendors/history'

type Env = Readonly<Record<string, string | undefined>>
type Iso = string
type Json = Record<string, unknown>

/**
 * How long after its last write a file still counts as written: a Session or a Subagent waiting on a
 * tool call writes nothing until it returns, and Claude Code lets a command run 10 minutes at most.
 */
export const LIVE_MS = 15 * 60_000
/** `cleanupPeriodDays` when Claude Code's settings name none. */
export const DEFAULT_CLEANUP_DAYS = 30
/** The lane that stands for the Codex threads the history does not list. */
export const CODEX_ARCHIVED_SESSION = 'codex-archived'
const CODEX_ARCHIVED_NAME = 'Codex archived threads'
/** Where the cache keeps the Codex threads, by id: a name that is no folder. */
const CODEX_THREADS = 'codex:'
/** How many files are read at once. */
const READ_AT_ONCE = 8
const DAY_MS = 24 * 60 * 60_000
const SESSION_FILE = /^([A-Za-z0-9_-]{1,128})\.jsonl$/u
const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,128})\.jsonl$/u
const SEND_TOOL = 'SendMessage'
const LAUNCHED = /^\s*Async agent launched/iu

/** A Session that has a Node on the Canvas. */
export interface CanvasSession {
  id: string
  /** The title of its Node. */
  title: string
  hidden: boolean
}

export interface ProjectTranscriptsInput {
  /** The Project's root. */
  root: string
  period: Period
  /** The moment it is read: what still goes on lasts until then. */
  now: Iso
  /** The Sessions with a Node on the Canvas; any other is named by its id and worktree. */
  canvas: readonly CanvasSession[]
}

export interface ProjectTranscriptsOptions {
  env?: Env
  platform?: NodeJS.Platform
  /** The parses kept from earlier reads; the app's own (appTranscriptCache) by default. */
  cache?: TranscriptCache
  /** The history part of the Codex driver; none — no Codex threads are read. */
  codex?: HistoryPart | null
  /** Where the lines of a file come from; fileLines by default. */
  lines?: (file: string) => AsyncIterable<string>
}

export interface ProjectTranscripts {
  facts: WorkFact[]
  sessions: SessionInfo[]
  gaps: SourceGap[]
}

// ── names only ───────────────────────────────────────────────────────────────

const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

function only(value: Json, fields: readonly string[]): Json {
  const kept: Json = {}
  for (const field of fields) if (value[field] !== undefined) kept[field] = value[field]
  return kept
}

function tagOf(text: string, name: string): string {
  const value = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'u').exec(text)?.[1]?.trim()
  return value === undefined ? '' : `<${name}>${value}</${name}>`
}

/** A verifier's verdict, the one word of a report the facts take: from its first line that starts with VERIFIED or REJECTED. */
const verdictOf = (text: string): string => findVerdict(text)?.verdict ?? ''

/**
 * A text of a record as the facts need it: a task-notification keeps the id, the call and the status
 * of its Subagent and the verdict of its result; any other text is emptied.
 */
function textOf(text: unknown): string {
  if (typeof text !== 'string' || !text.trimStart().startsWith('<task-notification>')) return ''
  const result = /<result>([\s\S]*?)<\/result>/u.exec(text)?.[1] ?? ''
  const verdict = verdictOf(result)
  return `<task-notification>${tagOf(text, 'task-id')}${tagOf(text, 'tool-use-id')}${tagOf(text, 'status')}${verdict === '' ? '' : `<result>${verdict}</result>`}</task-notification>`
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block: unknown) => (isJson(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')
}

const KEPT_FIELDS = ['type', 'timestamp', 'cwd', 'isSidechain', 'isMeta', 'isCompactSummary', 'operation'] as const
const AGENT_INPUT = ['name', 'subagent_type', 'description'] as const
const SEND_INPUT = ['to', 'recipient'] as const
const AGENT_RESULT = ['agentId', 'status', 'resumedAgentId', 'description', 'agentType'] as const

/**
 * Cuts each line of one transcript file down to what the facts read, with no text: one instance per
 * file, as it remembers the agent calls whose results follow them. A Subagent's own file is read as
 * the transcript of a Session (`sidechain: false` drops its `isSidechain`), so the Subagents it
 * started are found the same way.
 */
export class NamesOnly {
  private readonly calls = new Set<string>()

  constructor(private readonly sidechain = true) {}

  /** The record of the line cut down; null for a line that is not a JSON object. */
  record(line: string): Json | null {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      return null
    }
    if (!isJson(record)) return null
    const kept = only(record, KEPT_FIELDS)
    if (!this.sidechain) delete kept.isSidechain
    if (typeof record.content === 'string') kept.content = textOf(record.content)
    if (isJson(record.attachment) && record.attachment.type === 'queued_command') kept.attachment = { type: 'queued_command', prompt: textOf(record.attachment.prompt) }
    const message = record.message
    let ofAgent = false
    if (isJson(message)) {
      const content = Array.isArray(message.content)
        ? message.content.flatMap((block: unknown): Json[] => {
            if (!isJson(block)) return []
            if (block.type === 'text') return [{ type: 'text', text: textOf(block.text) }]
            if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string' && (AGENT_TOOLS.has(block.name) || block.name === SEND_TOOL)) {
              this.calls.add(block.id)
              return [{ type: 'tool_use', id: block.id, name: block.name, input: isJson(block.input) ? only(block.input, block.name === SEND_TOOL ? SEND_INPUT : AGENT_INPUT) : {} }]
            }
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && this.calls.has(block.tool_use_id)) {
              ofAgent = true
              const text = resultText(block.content)
              return [{ type: 'tool_result', tool_use_id: block.tool_use_id, is_error: block.is_error === true, content: LAUNCHED.test(text) ? 'Async agent launched' : verdictOf(text) }]
            }
            // Another tool's call or result, thinking, an image: none of them a fact reads.
            return []
          })
        : textOf(message.content)
      kept.message = { role: message.role, content }
    }
    if (ofAgent && isJson(record.toolUseResult)) kept.toolUseResult = only(record.toolUseResult, AGENT_RESULT)
    return kept
  }
}

// ── the files ────────────────────────────────────────────────────────────────

const missing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code ?? '')

/** The lines of a file, streamed, empty ones left out. */
export async function* fileLines(file: string): AsyncIterable<string> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) if (line !== '') yield line
  } finally {
    stream.destroy()
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
}

async function statOf(file: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const { mtimeMs, size } = await stat(file)
    return { mtimeMs, size }
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

/** `each` of every item, at most `limit` at once; the answers in the order of the items. */
async function inParallel<T, R>(items: readonly T[], limit: number, each: (item: T) => Promise<R>): Promise<R[]> {
  const answers = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      answers[index] = await each(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return answers
}

/** What a file's parse is kept as, with the stamp it was read at. */
interface Kept {
  mtimeMs: number
  size: number
  value: unknown
}

/**
 * The parses of the transcript files read so far, by path, each with the modification time and the
 * size it was read at: a file is read again only when either changed. In memory only, for the life
 * of the app; a file gone from its folder is let go at the next read of the folder.
 */
export class TranscriptCache {
  /** By folder, then by file name. */
  private readonly kept = new Map<string, Map<string, Kept>>()

  async get<T>(dir: string, name: string, mtimeMs: number, size: number, read: () => Promise<T>): Promise<T> {
    const files = this.kept.get(dir) ?? new Map<string, Kept>()
    this.kept.set(dir, files)
    const known = files.get(name)
    if (known !== undefined && known.mtimeMs === mtimeMs && known.size === size) return known.value as T
    const value = await read()
    files.set(name, { mtimeMs, size, value })
    return value
  }

  /** Lets go the files of `dir` that are not among `names`. */
  prune(dir: string, names: ReadonlySet<string>): void {
    const files = this.kept.get(dir)
    if (files === undefined) return
    for (const name of files.keys()) if (!names.has(name)) files.delete(name)
    if (files.size === 0) this.kept.delete(dir)
  }
}

/** The cache of the app: kept from one opening of Work track to the next. */
export const appTranscriptCache = new TranscriptCache()

/** What one Session file says, its text dropped. */
interface SessionParse {
  /** The first `cwd` its records name: whose Session it is. */
  cwd: string | undefined
  firstAt: Iso | undefined
  lastAt: Iso | undefined
  parse: TranscriptParse
}

/** What one Subagent file says: the times of its records, and the parse of the Subagents it started. */
interface AgentParse {
  times: Float64Array
  parse: TranscriptParse
}

async function readSession(lines: AsyncIterable<string>): Promise<SessionParse> {
  const names = new NamesOnly()
  const parse = new TranscriptParse()
  let cwd: string | undefined
  let firstAt: Iso | undefined
  let lastAt: Iso | undefined
  for await (const line of lines) {
    const record = names.record(line)
    if (record === null) continue
    cwd ??= str(record.cwd)
    const at = str(record.timestamp)
    if (at !== undefined && Number.isFinite(Date.parse(at))) {
      firstAt ??= at
      lastAt = at
    }
    parse.append([JSON.stringify(record)])
  }
  return { cwd, firstAt, lastAt, parse }
}

async function readAgent(lines: AsyncIterable<string>): Promise<AgentParse> {
  const names = new NamesOnly(false)
  const parse = new TranscriptParse()
  const times: number[] = []
  for await (const line of lines) {
    const record = names.record(line)
    if (record === null) continue
    const at = Date.parse(String(record.timestamp))
    if (Number.isFinite(at)) times.push(at)
    parse.append([JSON.stringify(record)])
  }
  return { times: Float64Array.from(times), parse }
}

async function readMeta(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** `cleanupPeriodDays` of Claude Code's settings: a positive number, else the default. */
async function cleanupDays(home: string): Promise<number> {
  const settings = await readMeta(join(home, 'settings.json'))
  const days = isJson(settings) ? settings.cleanupPeriodDays : undefined
  return typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : DEFAULT_CLEANUP_DAYS
}

// ── the facts ────────────────────────────────────────────────────────────────

/** A turn or a Subagent as a parse gives it, before it is placed in the period. */
interface Raw {
  kind: 'turn' | 'subagent'
  id: string
  title: string
  start: Iso
  end: Iso | null
  outcome: WorkFact['outcome']
  parent?: string
  /** Where a stretch with no end was last seen; its start when nothing later is known. */
  lastSeen: Iso
  /** Its file is still being written. */
  live: boolean
}

const later = (a: Iso, b: Iso | undefined): Iso => (b !== undefined && Date.parse(b) > Date.parse(a) ? b : a)

/** What a Subagent's stretch of work is read as: the Flight Recorder's agent fact, its names and times only. */
type Stretch = Pick<RecorderFact, 'id' | 'name' | 'start' | 'end' | 'outcome' | 'lastSeenAt' | 'agent'>

/** A Subagent of the Flight Recorder's parse as a raw fact of the Session `session`. */
function rawAgent(fact: Stretch, session: string, live: (agent: string | undefined) => boolean, parent?: string): Raw {
  const raw: Raw = {
    kind: 'subagent',
    id: `subagent:${session}:${fact.id}`,
    title: fact.name,
    start: fact.start,
    end: fact.end,
    outcome: fact.end === null ? null : (fact.outcome ?? 'ok'),
    lastSeen: later(fact.start, fact.lastSeenAt),
    live: live(fact.agent),
  }
  if (parent !== undefined) raw.parent = parent
  return raw
}

/** The facts of one Session from its parse: its turns, then its Subagents and those they started. */
function sessionFacts(session: string, title: string, main: SessionParse, agents: ReadonlyMap<string, { parse: AgentParse; live: boolean; meta: unknown }>, mainLive: boolean): Raw[] {
  const subagents = new Map(
    [...agents].map(([id, agent]) => {
      const parse = new SubagentParse()
      for (const at of agent.parse.times) parse.records.push({ at: new Date(at).toISOString(), ms: at, cwd: undefined, text: null })
      return [id, { meta: agent.meta, parse }] as const
    }),
  )
  const live = (agent: string | undefined): boolean => (agent === undefined ? mainLive : (agents.get(agent)?.live ?? mainLive))
  const facts = main.parse.facts({ session, epic: '', subagents })
  const raws: Raw[] = facts.turns.map((turn, index) => ({
    kind: 'turn',
    id: `turn:${turn.id}`,
    title,
    start: turn.start,
    end: turn.end,
    outcome: turn.end === null ? null : 'ok',
    // The last turn was last seen at the file's last record; an earlier one ended before the next prompt.
    lastSeen: index === facts.turns.length - 1 ? later(turn.start, main.lastAt) : turn.start,
    live: mainLive && index === facts.turns.length - 1,
  }))
  // The Subagents, then those each started in its own file, nested under the stretch of it that was going then.
  let level: { fact: Stretch; parent?: string }[] = facts.work.map((fact) => ({ fact }))
  const seen = new Set<string>()
  while (level.length > 0) {
    const next: typeof level = []
    const byAgent = new Map<string, Stretch[]>()
    for (const { fact, parent } of level) {
      raws.push(rawAgent(fact, session, live, parent))
      if (fact.agent !== undefined && !seen.has(fact.agent)) byAgent.set(fact.agent, [...(byAgent.get(fact.agent) ?? []), fact])
    }
    for (const [id, own] of byAgent) {
      seen.add(id)
      for (const fact of agents.get(id)?.parse.parse.facts({ session, epic: '', subagents }).work ?? []) {
        const by = own.findLast((stretch) => Date.parse(stretch.start) <= Date.parse(fact.start)) ?? own[0]!
        next.push({ fact, parent: `subagent:${session}:${by.id}` })
      }
    }
    level = next
  }
  return raws
}

/** The raw facts placed in the period: an open one still going lasts until now, one that stopped is cut off where it was last seen. */
function placed(raws: readonly Raw[], session: string, source: WorkSource, bounds: { start: number; end: number }): WorkFact[] {
  return raws.flatMap((raw) => {
    let { end, outcome } = raw
    if (end === null && !raw.live) [end, outcome] = [raw.lastSeen, 'cut-off']
    const start = Date.parse(raw.start)
    if (start >= bounds.end || (end !== null && Date.parse(end) < bounds.start)) return []
    const fact: WorkFact = { id: raw.id, kind: raw.kind, start: raw.start, end, outcome, session, source, title: raw.title }
    if (raw.parent !== undefined) fact.parent = raw.parent
    return [fact]
  })
}

/** The last part of a path, by either separator. */
const lastPart = (path: string): string => path.split(/[\\/]/u).filter((part) => part !== '').at(-1) ?? path

function sessionInfo(id: string, vendor: VendorId, cwd: string | null | undefined, canvas: ReadonlyMap<string, CanvasSession>): SessionInfo {
  const node = canvas.get(id)
  if (node !== undefined) return { id, name: node.title, vendor, hidden: node.hidden, archived: false }
  const name = `Session ${id.slice(0, 4)}${cwd ? ` · ${lastPart(cwd)}` : ''}`
  return { id, name, vendor, hidden: false, archived: true }
}

const firstStart = (facts: readonly WorkFact[]): number => facts.reduce((first, fact) => Math.min(first, Date.parse(fact.start)), Infinity)

interface Read {
  facts: WorkFact[]
  sessions: { info: SessionInfo; first: number }[]
  gaps: SourceGap[]
}

/** The Claude Code Sessions of the Project. */
async function readClaude(input: ProjectTranscriptsInput, options: ProjectTranscriptsOptions, cache: TranscriptCache, canvas: ReadonlyMap<string, CanvasSession>): Promise<Read> {
  const platform = options.platform ?? process.platform
  const lines = options.lines ?? fileLines
  const bounds = periodBounds(input.period)
  const now = Date.parse(input.now)
  const home = claudeHome(options.env)
  const projects = join(home, 'projects')
  const own = projectDirName(input.root)
  const dirs = (await listDir(projects)).filter((name) => name === own || name.startsWith(`${own}-`)).map((name) => join(projects, name))
  const root = input.root.normalize('NFC')

  // The oldest record of the Project the files still hold: a file last written before the period began before it.
  let oldest = Infinity
  const read: Read = { facts: [], sessions: [], gaps: [] }
  for (const dir of dirs) {
    const names = await listDir(dir)
    cache.prune(dir, new Set(names))
    const sessions = names.flatMap((name) => {
      const id = SESSION_FILE.exec(name)?.[1]
      return id === undefined ? [] : [{ id, name, file: join(dir, name) }]
    })
    const found = await inParallel(sessions, READ_AT_ONCE, async ({ id, name, file }) => {
      const stamp = await statOf(file)
      if (stamp === null) return null
      if (stamp.mtimeMs < bounds.start) {
        oldest = Math.min(oldest, stamp.mtimeMs)
        return null
      }
      const main = await cache.get(dir, name, stamp.mtimeMs, stamp.size, () => readSession(lines(file)))
      if (main.cwd === undefined || !isInsidePath(main.cwd.normalize('NFC'), root, platform)) return null
      if (main.firstAt !== undefined) oldest = Math.min(oldest, Date.parse(main.firstAt))
      return { id, main, live: now - stamp.mtimeMs < LIVE_MS }
    })
    for (const session of found) {
      if (session === null) continue
      const folder = join(dir, session.id, 'subagents')
      const agentNames = await listDir(folder)
      cache.prune(folder, new Set(agentNames))
      const agentFiles = agentNames.flatMap((name) => {
        const id = AGENT_FILE.exec(name)?.[1]
        return id === undefined ? [] : [{ id, name, file: join(folder, name), metaName: `agent-${id}.meta.json` }]
      })
      const agents = new Map<string, { parse: AgentParse; live: boolean; meta: unknown }>()
      const parsed = await inParallel(agentFiles, READ_AT_ONCE, async ({ id, name, file, metaName }) => {
        const stamp = await statOf(file)
        if (stamp === null || stamp.mtimeMs < bounds.start) return null
        const parse = await cache.get(folder, name, stamp.mtimeMs, stamp.size, () => readAgent(lines(file)))
        const metaFile = join(folder, metaName)
        const metaStamp = await statOf(metaFile)
        const meta = metaStamp === null ? null : await cache.get(folder, metaName, metaStamp.mtimeMs, metaStamp.size, () => readMeta(metaFile))
        return { id, value: { parse, live: now - stamp.mtimeMs < LIVE_MS, meta } }
      })
      for (const each of parsed) if (each !== null) agents.set(each.id, each.value)
      const info = sessionInfo(session.id, 'claude', session.main.cwd, canvas)
      const facts = placed(sessionFacts(session.id, info.name, session.main, agents, session.live), session.id, 'transcript', bounds)
      if (facts.length === 0) continue
      read.facts.push(...facts)
      read.sessions.push({ info, first: firstStart(facts) })
    }
  }

  const days = await cleanupDays(home)
  const end = Math.min(oldest, now - days * DAY_MS, bounds.end)
  if (end > bounds.start) {
    read.gaps.push({
      source: 'transcript',
      start: new Date(bounds.start).toISOString(),
      end: new Date(end).toISOString(),
      why: `Claude Code deletes transcripts after ${days} days (cleanupPeriodDays): none is left from this time`,
    })
  }
  return read
}

/** The Codex threads of the Project. */
async function readCodex(input: ProjectTranscriptsInput, history: HistoryPart, cache: TranscriptCache, canvas: ReadonlyMap<string, CanvasSession>): Promise<Read> {
  const bounds = periodBounds(input.period)
  const now = Date.parse(input.now)
  const whole = { start: new Date(bounds.start).toISOString(), end: new Date(Math.min(bounds.end, now)).toISOString() }
  let listed: Awaited<ReturnType<HistoryPart['list']>>
  try {
    listed = await history.list(input.root)
  } catch {
    return { facts: [], sessions: [], gaps: [{ source: 'codex', ...whole, why: 'Codex history did not answer' }] }
  }
  const read: Read = { facts: [], sessions: [], gaps: [] }
  if (listed.length > 0) {
    // The history lists no archived thread (history.ts asks `archived: false`): they are a lane of no data.
    read.sessions.push({ info: { id: CODEX_ARCHIVED_SESSION, name: CODEX_ARCHIVED_NAME, vendor: 'codex', hidden: false, archived: true }, first: Infinity })
    read.gaps.push({ source: 'codex', session: CODEX_ARCHIVED_SESSION, ...whole, why: 'Codex archived threads are not read: the Codex history lists only the threads that are not archived' })
  }
  for (const thread of listed) {
    if (thread.updatedAt !== null && thread.updatedAt < bounds.start) continue
    const info = sessionInfo(thread.id, 'codex', thread.cwd, canvas)
    // Only the times and the names are kept: a reason of the parse is the first line of a report.
    const entries = async (): Promise<{ facts: { turns: Pick<TurnFact, 'id' | 'start' | 'end'>[]; work: Stretch[] }; lastAt: Iso | undefined } | null> => {
      try {
        const all = await history.read(thread.id, input.root)
        const { turns, work } = new TranscriptParse().appendEntries(all).facts({ session: thread.id, epic: '' })
        return {
          facts: {
            turns: turns.map(({ id, start, end }) => ({ id, start, end })),
            work: work.map(({ id, name, start, end, outcome, lastSeenAt, agent }) => ({ id, name, start, end, ...(outcome === undefined ? {} : { outcome }), ...(lastSeenAt === undefined ? {} : { lastSeenAt }), ...(agent === undefined ? {} : { agent }) })),
          },
          lastAt: all.findLast((entry) => entry.timestamp !== undefined)?.timestamp,
        }
      } catch {
        return null
      }
    }
    const parsed = thread.updatedAt === null ? await entries() : await cache.get(CODEX_THREADS, thread.id, thread.updatedAt, 0, entries)
    if (parsed === null) {
      read.gaps.push({ source: 'codex', session: thread.id, ...whole, why: 'Codex did not give this thread' })
      read.sessions.push({ info, first: bounds.start })
      continue
    }
    const live = thread.updatedAt !== null && now - thread.updatedAt < LIVE_MS
    const { turns, work } = parsed.facts
    const raws: Raw[] = [
      ...turns.map(
        (turn, index): Raw => ({
          kind: 'turn',
          id: `turn:${turn.id}`,
          title: info.name,
          start: turn.start,
          end: turn.end,
          outcome: turn.end === null ? null : 'ok',
          lastSeen: index === turns.length - 1 ? later(turn.start, parsed.lastAt) : turn.start,
          live: live && index === turns.length - 1,
        }),
      ),
      ...work.map((fact) => rawAgent(fact, thread.id, () => live)),
    ]
    const facts = placed(raws, thread.id, 'codex', bounds)
    if (facts.length === 0) continue
    read.facts.push(...facts)
    read.sessions.push({ info, first: firstStart(facts) })
  }
  return read
}

/** The turns and the Subagents of every Session of the Project over the period, its Sessions and the gaps. */
export async function readProjectTranscripts(input: ProjectTranscriptsInput, options: ProjectTranscriptsOptions = {}): Promise<ProjectTranscripts> {
  const cache = options.cache ?? appTranscriptCache
  const canvas = new Map(input.canvas.map((session) => [session.id, session]))
  const parts = [await readClaude(input, options, cache, canvas)]
  if (options.codex) parts.push(await readCodex(input, options.codex, cache, canvas))
  const ms = (iso: Iso) => Date.parse(iso)
  return {
    facts: parts.flatMap((part) => part.facts).sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id)),
    sessions: parts
      .flatMap((part) => part.sessions)
      .sort((a, b) => a.first - b.first || a.info.id.localeCompare(b.info.id))
      .map((session) => session.info),
    gaps: parts.flatMap((part) => part.gaps),
  }
}
