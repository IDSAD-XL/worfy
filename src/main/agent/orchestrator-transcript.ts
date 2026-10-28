// What the Orchestrator's Node shows from a Session's transcript before the live Session says
// anything: the model of its last answer and its last status block. Claude Code records both in the
// transcript (~/.claude/projects/<dir>/<sessionId>.jsonl), so worfy reads them there instead of
// keeping a copy (ADR 0002, ADR 0005) — a Session continued from a terminal while worfy was closed
// shows its newest block on the next start.
//
// The file is read from its end, a window of whole lines at a time (readLinesBefore), and only as
// far back as needed: an Orchestrator's transcript grows for as long as the Project lives. Nothing
// here writes.
import { open, type FileHandle } from 'node:fs/promises'
import { findStatusBlock } from '../../shared/agent/status-block'
import { parseTranscriptRecord } from '../../shared/transcript/parse'
import { fileFacts, readLinesBefore, type TailCursor } from '../claude-home/tail'

export interface TranscriptFacts {
  /** `message.model` of the Orchestrator's last answer. */
  model: string | null
  /** The last status block of the Orchestrator's own answers, verbatim. */
  statusBlock: string | null
}

/** Claude Code marks text it wrote itself (an API error, an interruption notice) with this model. */
const SYNTHETIC_MODEL = '<synthetic>'
const DEFAULT_CHUNK_BYTES = 256 * 1024

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Takes what one transcript line tells about the Orchestrator into `facts`, unless a later line
 * already did. Only the Orchestrator's own answers count: not a Subagent's (`isSidechain`) and not
 * text Claude Code wrote (`<synthetic>` model) — the same rule the live Session follows.
 */
function takeLine(line: string, facts: Partial<TranscriptFacts>): void {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    // The last line may still be half written.
    return
  }
  if (!isObject(record) || record.type !== 'assistant' || record.isSidechain === true) return
  const model = isObject(record.message) ? record.message.model : undefined
  if (model === SYNTHETIC_MODEL) return
  if (facts.model === undefined && typeof model === 'string' && model !== '') facts.model = model
  if (facts.statusBlock !== undefined) return
  const texts = parseTranscriptRecord(record).flatMap(({ event }) => (event.type === 'text' ? [event.text] : []))
  for (const text of texts.reverse()) {
    const block = findStatusBlock(text)
    if (block !== null) {
      facts.statusBlock = block.text
      return
    }
  }
}

export interface ReadFactsOptions {
  /** Bytes of each window read back from the end; tests make it small to cut lines between windows. */
  chunkBytes?: number
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/**
 * The lines after `cursor`, the end of the last whole line of the first window: one still being
 * written, or a last line written without a line end, which readLinesBefore leaves out. A file
 * missing before that window too throws here. A file deleted or replaced by another one since the
 * window has no tail of its own: the window's lines are the answer.
 */
async function readTail(file: string, cursor: TailCursor): Promise<string[]> {
  let handle: FileHandle
  try {
    handle = await open(file, 'r')
  } catch (error) {
    if (cursor.fileId !== null && isMissing(error)) return []
    throw error
  }
  try {
    const { fileId, size } = await fileFacts(handle)
    if (fileId !== cursor.fileId) return []
    const { offset } = cursor
    const length = Math.max(0, size - offset)
    const tail = Buffer.alloc(length)
    const { bytesRead } = await handle.read(tail, 0, length, offset)
    return tail.subarray(0, bytesRead).toString('utf8').split('\n')
  } finally {
    await handle.close()
  }
}

/** The model and the last status block of the transcript at `file`, reading it from the end. */
export async function readTranscriptFacts(file: string, options: ReadFactsOptions = {}): Promise<TranscriptFacts> {
  const windowBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  const facts: Partial<TranscriptFacts> = {}
  const found = (): boolean => facts.model !== undefined && facts.statusBlock !== undefined
  // The last line first: an earlier line counts only for what the later ones did not tell.
  const take = (lines: string[]): void => {
    for (let index = lines.length - 1; index >= 0 && !found(); index -= 1) {
      const line = lines[index]?.trim()
      if (line) takeLine(line, facts)
    }
  }
  let window = await readLinesBefore(file, { windowBytes })
  take(await readTail(file, window.cursor))
  take(window.lines)
  // `reset`: the file was truncated or replaced since the window after this one; what was read
  // so far stays the answer.
  while (!found() && window.start > 0 && !window.reset) {
    window = await readLinesBefore(file, { windowBytes, before: { offset: window.start, fileId: window.cursor.fileId } })
    take(window.lines)
  }
  return { model: facts.model ?? null, statusBlock: facts.statusBlock ?? null }
}
