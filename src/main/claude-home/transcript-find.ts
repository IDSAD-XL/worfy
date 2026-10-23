// Find in the part of a Session's transcript the Session view has not read yet
// (`claudeHome.transcriptFind`, worfy-ui ticket 26). The view reads a transcript from its end, a
// window at a time (tail.ts, readLinesBefore; ticket 21); ⌘F counts the matches of the whole
// history, so main counts those before the first line the view holds and says which lines they are
// in. The view loads windows only up to the match the reader goes to.
//
// The lines are counted in the fields find looks in (src/shared/transcript/find.ts), the same the
// renderer counts in the rows it holds. A line whose text cannot hold the query is not parsed: most
// lines of a long transcript are tool results, and parsing all of 40 MB costs hundreds of
// milliseconds. The file is read a slice at a time, with a turn of the main process's event loop
// between slices.
//
// Read only; nothing found is logged: a transcript may hold secrets.
import { open, type FileHandle } from 'node:fs/promises'
import type { AgentEvent } from '../../shared/agent/events'
import { TRANSCRIPT_FIND } from '../../shared/ipc/claude-home'
import { mayShow } from '../../shared/markdown/visible-text'
import { eventMatches } from '../../shared/transcript/find'
import { parseTranscriptLine, type TranscriptEntry } from '../../shared/transcript/parse'

/** A line of the transcript with matches: where it starts, in bytes, and how many it holds. */
export interface FindHit {
  offset: number
  count: number
}

export interface TranscriptFindResult {
  found: boolean
  /** Lines with matches, oldest first; only the latest `hits` of them (FindLimits). */
  hits: FindHit[]
  /** Matches in all the lines searched. */
  total: number
  /** Matches in the lines left out of `hits`, all of them before its first line. */
  skipped: number
}

export interface FindLimits {
  /** Bytes read and parsed between two turns of the event loop. */
  slice: number
  /** Lines given in `hits`, the latest ones: those the reader reaches first going back. */
  hits: number
}

export const FIND_LIMITS: Readonly<FindLimits> = { slice: 1024 * 1024, hits: TRANSCRIPT_FIND.hits }

const NEWLINE = 0x0a

/** Whether JSON writes a character of `needle` escaped (a quote, a backslash, a control character): then the raw line cannot show it. */
const escapedInJson = (needle: string): boolean => [...needle].some((char) => char === '"' || char === '\\' || char.charCodeAt(0) < 0x20)

const nextTurn = (): Promise<void> => new Promise((done) => setImmediate(done))

/**
 * Whether the raw JSON line may hold `needle` in its text. Claude's answers count as their markdown
 * shows (`**foo** bar` shows «foo bar»), so the letters of the query need only be in the line in
 * order (mayShow), not side by side. A character JSON writes as `\uXXXX` would not be seen in the
 * line at all: such a line is parsed anyway; a `/` written as `\/` keeps its `/`.
 */
function mayHold(line: string, needle: string, raw: boolean): boolean {
  if (!raw) return true
  return line.includes('\\u') || mayShow(line, needle)
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled)
    if (bytesRead === 0) break
    filled += bytesRead
  }
  return buffer.subarray(0, filled)
}

/**
 * The matches of `needle` (src/shared/transcript/find.ts, findNeedle) in the complete lines of
 * `file` from byte `from` (where a line starts: an `earlier` searched before) to byte `before`. `events` picks the events a line's entries give, as the reads of
 * the transcript pick them (the Session's own thread, or every record of a Subagent's file). A
 * line not ended before `before` is not counted. A missing file is `found: false`.
 */
export async function findInTranscript(
  file: string,
  needle: string,
  before: number,
  events: (entries: TranscriptEntry[]) => AgentEvent[],
  limits: Readonly<FindLimits> = FIND_LIMITS,
  from = 0,
): Promise<TranscriptFindResult> {
  let handle: FileHandle
  try {
    handle = await open(file, 'r')
  } catch {
    return { found: false, hits: [], total: 0, skipped: 0 }
  }
  const hits: FindHit[] = []
  let total = 0
  try {
    const end = Math.min(before, (await handle.stat()).size)
    const raw = !escapedInJson(needle)
    let position = Math.min(from, end)
    let carry: Buffer = Buffer.alloc(0)
    while (position < end) {
      const chunk = await readAt(handle, position, Math.min(limits.slice, end - position))
      if (chunk.length === 0) break
      const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
      const base = position - carry.length
      position += chunk.length
      let start = 0
      for (let index = bytes.indexOf(NEWLINE); index !== -1; index = bytes.indexOf(NEWLINE, start)) {
        let stop = index
        if (stop > start && bytes[stop - 1] === 0x0d) stop -= 1
        if (stop > start) {
          const line = bytes.toString('utf8', start, stop)
          if (mayHold(line, needle, raw)) {
            let count = 0
            for (const event of events(parseTranscriptLine(line))) count += eventMatches(event, needle)
            if (count > 0) {
              hits.push({ offset: base + start, count })
              total += count
            }
          }
        }
        start = index + 1
      }
      carry = bytes.subarray(start)
      if (position < end) await nextTurn()
    }
  } finally {
    await handle.close()
  }
  if (hits.length <= limits.hits) return { found: true, hits, total, skipped: 0 }
  const kept = hits.slice(hits.length - limits.hits)
  const skipped = hits.slice(0, hits.length - limits.hits).reduce((sum, hit) => sum + hit.count, 0)
  return { found: true, hits: kept, total, skipped }
}
