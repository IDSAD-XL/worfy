// Incremental reading of a Claude Code transcript (JSONL) by byte offset.
//
// Claude Code appends to the transcript while a Session runs, so the last line may be half
// written when we read. The cursor only ever advances past complete lines: a half line is left
// for the next read and is returned exactly once, whole. Reads are bytes, not strings, so a
// multi-byte character cut by the writer is never decoded in two halves.
//
// The file is opened read-only; nothing here writes anywhere.
import { open, type FileHandle } from 'node:fs/promises'

/** Where the next read starts. `fileId` tells a replaced file from the one we were reading. */
export interface TailCursor {
  /** Byte offset just past the last complete line already returned. */
  offset: number
  /** `<dev>:<ino>` of the file at the time of the read; null while the file does not exist. */
  fileId: string | null
}

export interface TailChunk {
  /** Complete lines after the cursor, without line ends; empty lines are skipped. */
  lines: string[]
  /** Byte offset in the file where each of `lines` starts. */
  offsets: number[]
  /** Pass this to the next read. */
  cursor: TailCursor
  /** True when the file was truncated or replaced and these lines start from its beginning. */
  reset: boolean
  /** True when the read stopped at `maxBytes` and more complete lines are already there. */
  more: boolean
  /** Bytes this call read from the file, the check of the byte before the cursor included. */
  bytesRead: number
}

export interface TailOptions {
  /** Soft limit of bytes read per call; a single line longer than this is still returned whole. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 1024 * 1024
const NEWLINE = 0x0a

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

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

/** Splits bytes at line ends, decodes each line, drops a trailing `\r` and empty lines. */
export function splitLines(bytes: Buffer): string[] {
  return splitLinesAt(bytes, 0).lines
}

/** splitLines, with the byte offset of each line: `base` is the offset of `bytes[0]` in the file. */
function splitLinesAt(bytes: Buffer, base: number): { lines: string[]; offsets: number[] } {
  const lines: string[] = []
  const offsets: number[] = []
  let start = 0
  for (let index = bytes.indexOf(NEWLINE); index !== -1; index = bytes.indexOf(NEWLINE, start)) {
    let end = index
    if (end > start && bytes[end - 1] === 0x0d) end -= 1
    if (end > start) {
      lines.push(bytes.toString('utf8', start, end))
      offsets.push(base + start)
    }
    start = index + 1
  }
  return { lines, offsets }
}

/**
 * Reads the complete lines written after `cursor` (from the start without one). A truncated file,
 * a file replaced by another one (new inode) or a file rewritten in place (the byte before the
 * cursor is no longer a line end) is read again from the start, with `reset: true`.
 */
export async function readNewLines(file: string, cursor?: TailCursor, options: TailOptions = {}): Promise<TailChunk> {
  const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES)
  let handle: FileHandle
  try {
    handle = await open(file, 'r')
  } catch (error) {
    if (isMissing(error)) return { lines: [], offsets: [], cursor: { offset: 0, fileId: null }, reset: cursor !== undefined && cursor.offset > 0, more: false, bytesRead: 0 }
    throw error
  }
  try {
    const stats = await handle.stat()
    const fileId = `${stats.dev}:${stats.ino}`
    const size = stats.size

    let start = cursor?.offset ?? 0
    let reset = false
    let bytesRead = 0
    if (cursor && start > 0) {
      const replaced = cursor.fileId !== null && cursor.fileId !== fileId
      const truncated = size < start
      let rewritten = false
      if (!replaced && !truncated) {
        const before = await readAt(handle, start - 1, 1)
        bytesRead += before.length
        rewritten = before[0] !== NEWLINE
      }
      if (replaced || truncated || rewritten) {
        start = 0
        reset = true
      }
    }

    // Read up to maxBytes; if that window holds no line end, keep reading until one appears or
    // the file ends, so a line longer than the window is still returned whole.
    let length = Math.min(size - start, maxBytes)
    let bytes = await readAt(handle, start, length)
    bytesRead += bytes.length
    while (bytes.lastIndexOf(NEWLINE) === -1 && start + length < size) {
      length = Math.min(size - start, length * 2)
      bytes = await readAt(handle, start, length)
      bytesRead += bytes.length
    }

    const lastNewline = bytes.lastIndexOf(NEWLINE)
    const complete = lastNewline === -1 ? Buffer.alloc(0) : bytes.subarray(0, lastNewline + 1)
    const offset = start + complete.length
    return {
      ...splitLinesAt(complete, start),
      cursor: { offset, fileId },
      reset,
      more: start + length < size,
      bytesRead,
    }
  } finally {
    await handle.close()
  }
}

export interface WindowChunk {
  /** Complete lines of the window, oldest first, without line ends; empty lines are skipped. */
  lines: string[]
  /** Byte offset in the file where each of `lines` starts. */
  offsets: number[]
  /** Where the first line of the window starts: the end of the window before it; 0 at the start of the file. */
  start: number
  /**
   * Just past the last complete line of the window. For the window at the end of the file, the
   * cursor that `readNewLines` continues from: a half-written last line is left to it.
   */
  cursor: TailCursor
  /** True when `before` no longer names a line start of this file: it was truncated, replaced or rewritten. */
  reset: boolean
  /** Bytes this call read from the file. */
  bytesRead: number
}

export interface WindowOptions {
  /** Bytes the window spans; it grows back only when no line starts inside it. */
  windowBytes: number
  /** The window ends here (a line start an earlier window began at); at the end of the file without it. */
  before?: TailCursor
}

/**
 * Reads the complete lines of the window of `windowBytes` that ends at `before` — at the end of
 * the file without it — reading backward instead of from the start. A line that began before the
 * window is cut by it and left out: it belongs to the window before, which `start` names. When no
 * line starts inside the window (one line longer than it), the window grows back until one does,
 * so every call returns at least one line unless the window reaches the start of the file empty.
 * A missing file reads as empty.
 */
export async function readLinesBefore(file: string, options: WindowOptions): Promise<WindowChunk> {
  const windowBytes = Math.max(1, options.windowBytes)
  const { before } = options
  let handle: FileHandle
  try {
    handle = await open(file, 'r')
  } catch (error) {
    if (isMissing(error)) return { lines: [], offsets: [], start: 0, cursor: { offset: 0, fileId: null }, reset: before !== undefined && before.offset > 0, bytesRead: 0 }
    throw error
  }
  try {
    const stats = await handle.stat()
    const fileId = `${stats.dev}:${stats.ino}`
    const end = before?.offset ?? stats.size
    let bytesRead = 0
    if (before !== undefined && end > 0) {
      const replaced = before.fileId !== null && before.fileId !== fileId
      const truncated = stats.size < end
      let rewritten = false
      if (!replaced && !truncated) {
        const last = await readAt(handle, end - 1, 1)
        bytesRead += last.length
        rewritten = last[0] !== NEWLINE
      }
      if (replaced || truncated || rewritten) return { lines: [], offsets: [], start: 0, cursor: { offset: 0, fileId }, reset: true, bytesRead }
    }

    let length = Math.min(windowBytes, end)
    for (;;) {
      const low = end - length
      // One byte before the window too: a line end there means the window begins with a whole line.
      const from = low > 0 ? low - 1 : 0
      const bytes = await readAt(handle, from, end - from)
      bytesRead += bytes.length
      const stop = bytes.lastIndexOf(NEWLINE) + 1
      const first = low > 0 ? bytes.indexOf(NEWLINE) + 1 : 0
      if ((first === 0 && low > 0) || first >= stop) {
        // No line starts inside the window and ends in it: grow it back, unless it holds the file's start.
        if (low > 0) {
          length = Math.min(end, length * 2)
          continue
        }
        return { lines: [], offsets: [], start: 0, cursor: { offset: 0, fileId }, reset: false, bytesRead }
      }
      return { ...splitLinesAt(bytes.subarray(first, stop), from + first), start: from + first, cursor: { offset: from + stop, fileId }, reset: false, bytesRead }
    }
  } finally {
    await handle.close()
  }
}
