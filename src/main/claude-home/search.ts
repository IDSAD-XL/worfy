// Text search over the transcripts of a Project's Sessions (`claudeHome.search`): every Session
// Claude Code recorded for the Project, wherever it was started — worfy, a terminal, Claude
// Desktop. The transcripts are those of the Project's history (ClaudeHomeRegistry.sessions),
// newest first.
//
// What is searched is what the Session view shows as the conversation: the user's messages and
// Claude's replies (src/shared/transcript/parse.ts). Tool calls, their output, thinking, hooks and
// the records of Subagents are not. The match ignores case.
//
// One search reads at most `files` transcripts and `bytes` bytes and stops at `hits` Sessions; the
// answer says when a limit left transcripts unsearched. The text of a transcript is kept in memory
// for the next search, under its file's size and modification time: a changed file is read again.
// The list of the Project's Sessions follows the same rule (ClaudeHomeRegistry.sessions keeps the
// history entry of each transcript), so a search over unchanged transcripts only lists folders
// and stats files. A large transcript is parsed a slice at a time, giving the main process's event
// loop a turn between slices.
//
// The search also reads the threads of another Vendor's Sessions of the Project (worfy-multi-vendor
// ticket 28: Codex's, src/main/vendors/codex/sessions-on-canvas.ts): the threads its last list of the
// Project found, merged with the transcripts by time, newest first, under the same limits and the same
// snippet rule. A thread counts as one transcript read and its messages' UTF-8 bytes against `bytes`
// (its size is known only once it is read). Its text is kept in memory under the thread's time: a
// thread whose time changed is read again, one without a time on every search. A Vendor that fails a
// read is not asked again in that search, and the answer says transcripts were left unsearched. Each
// hit of such a thread names its Vendor (`vendor`); a hit of Claude Code names none.
//
// Read only: nothing here writes, and no hit, query or snippet is logged — a transcript may hold
// secrets, and the snippet goes only to the window that asked.
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEvent } from '../../shared/agent/events'
import { sessionIdSchema, TRANSCRIPT_SEARCH, type TranscriptHit } from '../../shared/ipc/claude-home'
import { mainThreadEvents, parseTranscriptLines } from '../../shared/transcript/parse'
import { rootPath, type ClaudeHomeRegistry, type RegistryRoot } from './registry'

export interface SearchLimits {
  /** Transcripts read per search. */
  files: number
  /** Bytes of transcripts per search; a transcript larger than what is left is skipped. */
  bytes: number
  /** Sessions found per search. */
  hits: number
}

export const SEARCH_LIMITS: Readonly<SearchLimits> = { files: 200, bytes: 64 * 1024 * 1024, hits: TRANSCRIPT_SEARCH.hits }

/** Longest snippet, in characters, the ellipses included. */
const SNIPPET_LENGTH = TRANSCRIPT_SEARCH.snippet

/**
 * Bytes of a transcript decoded and parsed between two turns of the event loop: a transcript of
 * tens of megabytes parsed in one go held the main process for more than 100 ms.
 */
const PARSE_SLICE = 1024 * 1024

/** Characters of transcript text kept in memory between searches, all transcripts together. */
const CACHE_CHARS = 32 * 1024 * 1024

/** A thread of another Vendor's Session of the Project, as its last list found it. */
export interface VendorThread {
  id: string
  title: string | null
  /** When it last changed, in epoch milliseconds; null when the Vendor does not say. */
  updatedAt: number | null
}

/** The Sessions of the Project another Vendor ran, which the search reads too. */
export interface VendorThreads {
  /** The VendorId its hits carry. */
  vendor: string
  /** The Project's threads its last list found, without asking the Vendor. */
  cached(projectRoot: string): readonly VendorThread[]
  /** The events of the Project's thread `id`; null when the last list did not name it. */
  transcript(projectRoot: string, id: string): Promise<AgentEvent[] | null>
}

export interface SearchResult {
  hits: TranscriptHit[]
  /** True when a limit left some of the Project's transcripts unsearched. */
  limited: boolean
}

interface CachedText {
  size: number
  modifiedAt: number
  /** The searchable messages, inner whitespace collapsed to one space. */
  messages: string[]
  chars: number
}

const TRANSCRIPT = /^([A-Za-z0-9][A-Za-z0-9-]*)\.jsonl$/

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The messages among the events of a Session's own thread: the user's and the agent's text, nothing else. */
export function eventMessages(events: readonly AgentEvent[]): string[] {
  const messages: string[] = []
  for (const event of events) {
    const text = event.type === 'text' ? event.text : event.type === 'notice' && event.kind === 'user' ? event.text : undefined
    if (text === undefined) continue
    const collapsed = collapse(text)
    if (collapsed !== '') messages.push(collapsed)
  }
  return messages
}

/** The messages of a transcript the search looks in: the user's and Claude's text, nothing else. */
export function searchableMessages(lines: readonly string[]): string[] {
  return eventMessages(mainThreadEvents(parseTranscriptLines(lines)))
}

const nextTurn = (): Promise<void> => new Promise((done) => setImmediate(done))

/**
 * searchableMessages() of a whole transcript, a slice of about PARSE_SLICE bytes at a time with a
 * turn of the event loop between slices. A slice ends after a line break, so no line is split (a
 * line break byte is never part of a multi-byte UTF-8 character).
 */
async function messagesOf(bytes: Buffer): Promise<string[]> {
  const messages: string[] = []
  let start = 0
  while (start < bytes.length) {
    const lineEnd = start + PARSE_SLICE < bytes.length ? bytes.indexOf(0x0a, start + PARSE_SLICE) : -1
    const end = lineEnd === -1 ? bytes.length : lineEnd + 1
    const lines = bytes.subarray(start, end).toString('utf8').split('\n').filter((line) => line.trim() !== '')
    for (const message of searchableMessages(lines)) messages.push(message)
    start = end
    if (start < bytes.length) await nextTurn()
  }
  return messages
}

/** A case-insensitive matcher of the query as literal text. */
function matcher(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
}

/** Moves a cut off the middle of a surrogate pair. */
function cutAt(text: string, index: number): number {
  const code = text.charCodeAt(index)
  return index > 0 && index < text.length && code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
}

/** Up to SNIPPET_LENGTH characters of `text` around the match at `index`, with `…` where it is cut. */
export function snippetAround(text: string, index: number, length: number): string {
  if (text.length <= SNIPPET_LENGTH) return text
  const room = SNIPPET_LENGTH - 2 // both ellipses, at most
  let start = Math.max(0, index - Math.floor(Math.max(0, room - length) / 2))
  const end = Math.min(text.length, start + room)
  start = Math.max(0, end - room)
  const from = cutAt(text, start)
  const to = cutAt(text, end)
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

/** Transcript files of the Project's folders by Session id, in the registry's folder order. */
async function transcriptFiles(registry: ClaudeHomeRegistry, projectRoot: RegistryRoot): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const { path: dir } of await registry.transcriptDirs(await registry.roots(projectRoot))) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue // removed since the listing
    }
    for (const name of names.sort()) {
      const sessionId = TRANSCRIPT.exec(name)?.[1]
      if (sessionId !== undefined && !files.has(sessionId)) files.set(sessionId, join(dir, name))
    }
  }
  return files
}

/** A Session the search may read: a transcript of Claude Code, or a thread of another Vendor. */
type Candidate =
  | { kind: 'claude'; sessionId: string; title?: string | undefined; at: number }
  | { kind: 'vendor'; sessionId: string; title?: string | undefined; at: number; source: VendorThreads }

/** The key of a Vendor's thread in the text cache: no file path starts with a NUL. */
const threadKey = (vendor: string, id: string): string => `\0${vendor}\0${id}`

export class TranscriptSearch {
  /** Transcript texts by path (a Vendor's thread by threadKey), oldest use first. */
  private readonly cache = new Map<string, CachedText>()
  private cachedChars = 0

  constructor(
    private readonly registry: ClaudeHomeRegistry,
    private readonly limits: Readonly<SearchLimits> = SEARCH_LIMITS,
    private readonly vendors: readonly VendorThreads[] = [],
  ) {}

  /** The Sessions of the Project at `projectRoot` whose conversation contains `query`, newest first. */
  async search(projectRoot: RegistryRoot, query: string): Promise<SearchResult> {
    const wanted = collapse(query)
    if (wanted.length < TRANSCRIPT_SEARCH.minQuery) return { hits: [], limited: false }
    const pattern = matcher(wanted)
    // The history decides which transcripts are the Project's: it leaves out those of another
    // Project whose folder name looks like one of this Project's.
    const [{ history }, files] = await Promise.all([this.registry.sessions(projectRoot), transcriptFiles(this.registry, projectRoot)])
    const root = rootPath(projectRoot)
    const candidates: Candidate[] = history.map((session) => ({ kind: 'claude', sessionId: session.sessionId, title: session.title, at: session.modifiedAt }))
    for (const source of this.vendors) {
      for (const thread of source.cached(root)) {
        // As in the history (codexHomeSession): a thread whose id could not name a Session there is left out.
        if (!sessionIdSchema.safeParse(thread.id).success) continue
        candidates.push({ kind: 'vendor', sessionId: thread.id, ...(thread.title === null ? {} : { title: thread.title }), at: thread.updatedAt ?? 0, source })
      }
    }
    // The order of the history (ClaudeHomeRegistry.sessions), which the merged history of claudeHome.sessions keeps too.
    candidates.sort((a, b) => b.at - a.at || a.sessionId.localeCompare(b.sessionId))
    const hits: TranscriptHit[] = []
    const seen = new Set<string>()
    const failed = new Set<VendorThreads>()
    let read = 0
    let bytes = 0
    let limited = false
    for (const candidate of candidates) {
      if (seen.has(candidate.sessionId)) continue
      if (hits.length >= this.limits.hits || read >= this.limits.files) {
        limited = true // this Session and any after it stay unsearched
        break
      }
      seen.add(candidate.sessionId)
      let text: CachedText | 'too-big' | 'failed' | undefined
      if (candidate.kind === 'claude') {
        const path = files.get(candidate.sessionId)
        if (path === undefined) continue
        text = await this.text(path, this.limits.bytes - bytes)
      } else {
        if (failed.has(candidate.source)) {
          limited = true
          continue
        }
        text = await this.threadText(candidate.source, root, candidate, this.limits.bytes - bytes)
        if (text === 'failed') {
          // A Vendor that could not answer one read (no binary, no answer within its time limit) is not
          // asked for the rest of the threads: each could wait as long.
          failed.add(candidate.source)
          limited = true
          continue
        }
      }
      if (text === 'too-big') {
        limited = true
        continue
      }
      if (text === undefined) continue
      read += 1
      bytes += text.size
      const hit = this.find(candidate, text.messages, pattern, wanted.length)
      if (hit !== undefined) hits.push(hit)
    }
    return { hits, limited }
  }

  private find(candidate: Candidate, messages: readonly string[], pattern: RegExp, length: number): TranscriptHit | undefined {
    for (const message of messages) {
      const match = pattern.exec(message)
      if (match === null) continue
      return {
        sessionId: candidate.sessionId,
        ...(candidate.title === undefined ? {} : { title: candidate.title }),
        at: candidate.at,
        snippet: snippetAround(message, match.index, Math.max(length, match[0].length)),
        ...(candidate.kind === 'vendor' ? { vendor: candidate.source.vendor } : {}),
      }
    }
    return undefined
  }

  /**
   * The searchable text of a Vendor's thread, from memory while its time is the one it was read at;
   * `too-big` when its messages take more than `budget` bytes, `failed` when the Vendor could not
   * read it, undefined when its last list no longer names it.
   */
  private async threadText(source: VendorThreads, root: string, candidate: Candidate, budget: number): Promise<CachedText | 'too-big' | 'failed' | undefined> {
    const key = threadKey(source.vendor, candidate.sessionId)
    // A thread without a time cannot tell it changed: it is read on every search.
    const at = candidate.at === 0 ? undefined : candidate.at
    const cached = at === undefined ? undefined : this.cache.get(key)
    let text: CachedText
    if (cached !== undefined && cached.modifiedAt === at) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      text = cached
    } else {
      let events: AgentEvent[] | null
      try {
        events = await source.transcript(root, candidate.sessionId)
      } catch {
        return 'failed'
      }
      if (events === null) return undefined
      const messages = eventMessages(events)
      const size = messages.reduce((sum, message) => sum + Buffer.byteLength(message), 0)
      text = { size, modifiedAt: at ?? 0, messages, chars: messages.reduce((sum, message) => sum + message.length, 0) }
      if (at !== undefined) this.keep(key, text)
    }
    return text.size > budget ? 'too-big' : text
  }
  /**
   * The searchable text of the transcript at `path`, from memory when the file has not changed;
   * `too-big` when the file is larger than `budget` bytes, undefined when it is gone.
   */
  private async text(path: string, budget: number): Promise<CachedText | 'too-big' | undefined> {
    let file: Awaited<ReturnType<typeof open>>
    try {
      file = await open(path, 'r')
    } catch {
      return undefined
    }
    try {
      const { size, mtimeMs } = await file.stat()
      if (size > budget) return 'too-big'
      const cached = this.cache.get(path)
      if (cached !== undefined && cached.size === size && cached.modifiedAt === mtimeMs) {
        this.cache.delete(path)
        this.cache.set(path, cached)
        return cached
      }
      // Only the bytes the stat counted: what Claude Code appends meanwhile waits for the next search.
      const buffer = Buffer.alloc(size)
      let filled = 0
      while (filled < size) {
        const { bytesRead } = await file.read(buffer, filled, size - filled, filled)
        if (bytesRead === 0) break
        filled += bytesRead
      }
      const messages = await messagesOf(buffer.subarray(0, filled))
      const text: CachedText = { size, modifiedAt: mtimeMs, messages, chars: messages.reduce((sum, message) => sum + message.length, 0) }
      this.keep(path, text)
      return text
    } finally {
      await file.close()
    }
  }

  private keep(path: string, text: CachedText): void {
    const old = this.cache.get(path)
    if (old !== undefined) {
      this.cache.delete(path)
      this.cachedChars -= old.chars
    }
    if (text.chars > CACHE_CHARS) return
    this.cache.set(path, text)
    this.cachedChars += text.chars
    for (const [oldest, entry] of this.cache) {
      if (this.cachedChars <= CACHE_CHARS) break
      this.cache.delete(oldest)
      this.cachedChars -= entry.chars
    }
  }
}
