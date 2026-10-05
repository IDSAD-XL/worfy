// What the Orchestrator's Node shows from a Session's transcript before the live Session says
// anything: the model of its last answer and its last status block. Claude Code records both in the
// transcript (~/.claude/projects/<dir>/<sessionId>.jsonl), so worfy reads them there instead of
// keeping a copy (ADR 0002, ADR 0005) — a Session continued from a terminal while worfy was closed
// shows its newest block on the next start.
//
// The file is read from its end, a chunk at a time, and only as far back as needed: an
// Orchestrator's transcript grows for as long as the Project lives. Nothing here writes.
import { open } from 'node:fs/promises'
import { findStatusBlock } from '../../shared/agent/status-block'
import { parseTranscriptRecord } from '../../shared/transcript/parse'

export interface TranscriptFacts {
  /** `message.model` of the Orchestrator's last answer. */
  model: string | null
  /** The last status block of the Orchestrator's own answers, verbatim. */
  statusBlock: string | null
}

/** Claude Code marks text it wrote itself (an API error, an interruption notice) with this model. */
const SYNTHETIC_MODEL = '<synthetic>'
const NEWLINE = 0x0a
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
  /** Bytes read per step from the end; tests make it small to cut lines between chunks. */
  chunkBytes?: number
}

/** The model and the last status block of the transcript at `file`, reading it from the end. */
export async function readTranscriptFacts(file: string, options: ReadFactsOptions = {}): Promise<TranscriptFacts> {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  const facts: Partial<TranscriptFacts> = {}
  const handle = await open(file, 'r')
  try {
    let position = (await handle.stat()).size
    // Bytes after `position` that do not start with a whole line yet: the head of a line whose
    // beginning lies in an earlier chunk.
    let carry: Buffer = Buffer.alloc(0)
    while (position > 0 && (facts.model === undefined || facts.statusBlock === undefined)) {
      const length = Math.min(chunkBytes, position)
      position -= length
      const chunk = Buffer.alloc(length)
      const { bytesRead } = await handle.read(chunk, 0, length, position)
      let data = Buffer.concat([chunk.subarray(0, bytesRead), carry])
      if (position > 0) {
        const first = data.indexOf(NEWLINE)
        if (first === -1) {
          carry = data
          continue
        }
        carry = data.subarray(0, first)
        data = data.subarray(first + 1)
      } else {
        carry = Buffer.alloc(0)
      }
      const lines = data.toString('utf8').split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim()
        if (line) takeLine(line, facts)
        if (facts.model !== undefined && facts.statusBlock !== undefined) break
      }
    }
  } finally {
    await handle.close()
  }
  return { model: facts.model ?? null, statusBlock: facts.statusBlock ?? null }
}
