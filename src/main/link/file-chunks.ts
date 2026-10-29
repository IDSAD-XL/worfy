// A file sent over the link in pieces: a file of a Card (`cards.file`, worfy-link ticket 10) and a
// stored image (`images.file`, worfy-canvas ticket 24) go the same way. Each channel has its own
// name, input and checks; the pieces, the limit and the answers are the same (cardFileAnswerSchema,
// src/shared/ipc/cards.ts), and so is the code on both ends, here.
//
// The Machine that keeps the file reads one piece of a file it has already found and checked
// (readFileChunk). The Machine that shows it asks for the pieces one after another and glues them
// together (fetchLinkedFile): what comes back is held to the channel's schema by the link
// (src/main/link/remote-calls.ts), and to the size limit here.
//
// The link service is loaded on the first request only (appLinkFiles): the protocol modules stay
// light for the tests and the start of the app.
import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { machineLabel } from '../../shared/cards/bridge'
import { CARD_FILE_CHUNK_BYTES, cardFileAnswerSchema, type CardFileAnswer } from '../../shared/ipc/cards'
import type { IpcResult } from '../../shared/ipc/channels'

/** The largest piece one answer carries (4 MB): well inside one message of a link connection (16 MB). */
export const FILE_CHUNK_BYTES = CARD_FILE_CHUNK_BYTES

/**
 * On the Machine that keeps it: one piece of `file`, a path already found and checked by the
 * caller, as it is on disk. Null `file` — nothing to serve. A file over `limit` is not read.
 * `length` is capped at FILE_CHUNK_BYTES.
 */
export async function readFileChunk(file: string | null, offset: number, length: number, limit: number): Promise<CardFileAnswer> {
  if (file === null) return { status: 'missing' }
  let handle
  try {
    handle = await open(file, 'r')
  } catch {
    return { status: 'missing' }
  }
  try {
    const { size, mtimeMs } = await handle.stat()
    if (size > limit) return { status: 'too-large', size }
    const start = Math.min(offset, size)
    const wanted = Math.min(length, FILE_CHUNK_BYTES, size - start)
    const buffer = Buffer.alloc(wanted)
    const { bytesRead } = wanted === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, wanted, start)
    return { status: 'file', extension: extname(file).toLowerCase(), size, mtimeMs, base64: buffer.subarray(0, bytesRead).toString('base64') }
  } catch {
    return { status: 'missing' }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** What the Machine that shows a file of a Linked machine gets. `extension` is the file's, in lower case. */
export type LinkedFile =
  | { status: 'file'; extension: string; bytes: Uint8Array }
  | { status: 'unknown-machine' }
  | { status: 'missing' }
  | { status: 'too-large' }
  | { status: 'unreachable'; reason: string }

/** What fetching a file needs of the link. */
export interface LinkedFileDeps {
  /** The Linked machines of this Machine, by id. */
  machines(): Promise<readonly { id: string }[]>
  /** Calls a channel on Linked machine `machine`; resolves with its result, never rejects. */
  call(machine: string, channel: string, input: unknown): Promise<IpcResult<unknown>>
}

/** One file of the Linked machine `machineLabel` names, asked for on `channel`. */
export interface LinkedFileRequest {
  machineLabel: string
  channel: string
  /** The channel's input for the piece from `offset` on, `length` bytes long. */
  input(offset: number, length: number): unknown
  /** HEAD: the type is enough, the bytes are not needed. */
  head: boolean
  /** The largest file taken; a Linked machine that sends more is not believed. */
  limit: number
}

/**
 * A file whose size, type or mtime changed between two pieces is not glued together: it is read
 * again from the start, at most this often.
 */
const READ_ATTEMPTS = 2

/** Finds the Linked machine of the label and reads the file from it, piece by piece. */
export async function fetchLinkedFile(deps: LinkedFileDeps, request: LinkedFileRequest): Promise<LinkedFile> {
  const matches = (await deps.machines()).filter((machine) => machineLabel(machine.id) === request.machineLabel)
  const [machine] = matches
  // None; two would mean two Linked machines with one id, which the link does not allow.
  if (matches.length !== 1 || machine === undefined) return { status: 'unknown-machine' }
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    const file = await readFrom(deps, machine.id, request)
    if (file !== 'changed') return file
  }
  return { status: 'missing' }
}

/** One read of the whole file; 'changed' when it changed between two pieces. */
async function readFrom(deps: LinkedFileDeps, machine: string, request: LinkedFileRequest): Promise<LinkedFile | 'changed'> {
  const chunks: Uint8Array[] = []
  let received = 0
  let first: { extension: string; size: number; mtimeMs: number } | undefined
  for (;;) {
    const length = request.head ? 0 : FILE_CHUNK_BYTES
    const result = await deps.call(machine, request.channel, request.input(received, length))
    if (!result.ok) return { status: 'unreachable', reason: result.error }
    const answer = cardFileAnswerSchema.safeParse(result.value)
    if (!answer.success) return { status: 'unreachable', reason: `${request.channel}: the Linked machine answered outside the contract` }
    const piece = answer.data
    if (piece.status === 'too-large') return { status: 'too-large' }
    if (piece.status === 'missing') return first === undefined ? { status: 'missing' } : 'changed'
    if (piece.size > request.limit) return { status: 'too-large' }
    if (first === undefined) first = { extension: piece.extension, size: piece.size, mtimeMs: piece.mtimeMs }
    // Rewritten with the same size between two pieces: only the mtime tells.
    else if (piece.size !== first.size || piece.extension !== first.extension || piece.mtimeMs !== first.mtimeMs) return 'changed'
    const bytes = Buffer.from(piece.base64, 'base64')
    if (bytes.byteLength > FILE_CHUNK_BYTES || received + bytes.byteLength > first.size) return 'changed'
    chunks.push(bytes)
    received += bytes.byteLength
    if (request.head || received === first.size) return { status: 'file', extension: first.extension, bytes: concat(chunks, received) }
    // A piece with nothing in it before the end: the file got shorter meanwhile.
    if (bytes.byteLength === 0) return 'changed'
  }
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1 && chunks[0] !== undefined) return chunks[0]
  const whole = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.byteLength
  }
  return whole
}

/** The Linked machines of the app's link service, called from main (worfy-link ticket 09). */
export const appLinkFiles: LinkedFileDeps = {
  machines: async () => {
    const { appLinkService } = await import('./service')
    return appLinkService()?.linkedMachines() ?? []
  },
  call: async (machine, channel, input) => {
    const { callOn } = await import('./remote-calls')
    return callOn(machine, channel, input)
  },
}
