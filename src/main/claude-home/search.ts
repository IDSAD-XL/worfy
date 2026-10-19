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
// Read only: nothing here writes, and no hit, query or snippet is logged — a transcript may hold
// secrets, and the snippet goes only to the window that asked.
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { TRANSCRIPT_SEARCH, type HistorySession, type TranscriptHit } from '../../shared/ipc/claude-home'
import { mainThreadEvents, parseTranscriptLines } from '../../shared/transcript/parse'
import type { ClaudeHomeRegistry, RegistryRoot } from './registry'

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

/** The messages of a transcript the search looks in: the user's and Claude's text, nothing else. */
export function searchableMessages(lines: readonly string[]): string[] {
  const messages: string[] = []
  for (const event of mainThreadEvents(parseTranscriptLines(lines))) {
    const text = event.type === 'text' ? event.text : event.type === 'notice' && event.kind === 'user' ? event.text : undefined
    if (text === undefined) continue
    const collapsed = collapse(text)
    if (collapsed !== '') messages.push(collapsed)
  }
  return messages
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

export class TranscriptSearch {
  /** Transcript texts by path, oldest use first. */
  private readonly cache = new Map<string, CachedText>()
  private cachedChars = 0

  constructor(
    private readonly registry: ClaudeHomeRegistry,
    private readonly limits: Readonly<SearchLimits> = SEARCH_LIMITS,
  ) {}

  /** The Sessions of the Project at `projectRoot` whose conversation contains `query`, newest first. */
  async search(projectRoot: RegistryRoot, query: string): Promise<SearchResult> {
    const wanted = collapse(query)
    if (wanted.length < TRANSCRIPT_SEARCH.minQuery) return { hits: [], limited: false }
    const pattern = matcher(wanted)
    // The history decides which transcripts are the Project's: it leaves out those of another
    // Project whose folder name looks like one of this Project's.
    const [{ history }, files] = await Promise.all([this.registry.sessions(projectRoot), transcriptFiles(this.registry, projectRoot)])
    const hits: TranscriptHit[] = []
    const seen = new Set<string>()
    let read = 0
    let bytes = 0
    let limited = false
    for (const session of history) {
      if (seen.has(session.sessionId)) continue
      if (hits.length >= this.limits.hits || read >= this.limits.files) {
        limited = true // this Session and any after it stay unsearched
        break
      }
      seen.add(session.sessionId)
      const path = files.get(session.sessionId)
      if (path === undefined) continue
      const text = await this.text(path, this.limits.bytes - bytes)
      if (text === 'too-big') {
        limited = true
        continue
      }
      if (text === undefined) continue
      read += 1
      bytes += text.size
      const hit = this.find(session, text.messages, pattern, wanted.length)
      if (hit !== undefined) hits.push(hit)
    }
    return { hits, limited }
  }

  private find(session: HistorySession, messages: readonly string[], pattern: RegExp, length: number): TranscriptHit | undefined {
    for (const message of messages) {
      const match = pattern.exec(message)
      if (match === null) continue
      return {
        sessionId: session.sessionId,
        ...(session.title === undefined ? {} : { title: session.title }),
        at: session.modifiedAt,
        snippet: snippetAround(message, match.index, Math.max(length, match[0].length)),
      }
    }
    return undefined
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
