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
  const lines: string[] = []
  let start = 0
  for (let index = bytes.indexOf(NEWLINE); index !== -1; index = bytes.indexOf(NEWLINE, start)) {
    let end = index
    if (end > start && bytes[end - 1] === 0x0d) end -= 1
    if (end > start) lines.push(bytes.toString('utf8', start, end))
    start = index + 1
  }
  return lines
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
    if (isMissing(error)) return { lines: [], cursor: { offset: 0, fileId: null }, reset: cursor !== undefined && cursor.offset > 0, more: false, bytesRead: 0 }
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
      lines: splitLines(complete),
      cursor: { offset, fileId },
      reset,
      more: start + length < size,
      bytesRead,
    }
  } finally {
    await handle.close()
  }
}
